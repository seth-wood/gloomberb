import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWisesheetsEligibleSymbol } from "./eligibility";
import { WisesheetsProvider } from "./index";
import { WisesheetsCredentialStore } from "./credentials";

const tempDirs: string[] = [];

async function tempDataDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "gloomberb-wisesheets-eligibility-"));
  tempDirs.push(path);
  return path;
}

afterEach(async () => {
  delete process.env.WISESHEETS_API_KEY;
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("isWisesheetsEligibleSymbol", () => {
  test("accepts plain US tickers and US share classes, rejects foreign names", () => {
    expect(isWisesheetsEligibleSymbol("AAPL")).toBe(true);
    expect(isWisesheetsEligibleSymbol("AAPL", "NASDAQ")).toBe(true);
    expect(isWisesheetsEligibleSymbol("BRK.B")).toBe(true);
    expect(isWisesheetsEligibleSymbol("BRK.B", "NYSE")).toBe(true);
    expect(isWisesheetsEligibleSymbol("VOD.L")).toBe(false);
    expect(isWisesheetsEligibleSymbol("VOD", "LSE")).toBe(false);
  });
});

describe("WisesheetsProvider.canProvide", () => {
  test("is false without a key and true for eligible US tickers with a key", async () => {
    delete process.env.WISESHEETS_API_KEY;
    const dataDir = await tempDataDir();
    const credentialStore = new WisesheetsCredentialStore(dataDir);
    const provider = new WisesheetsProvider(credentialStore);
    expect(await provider.canProvide("AAPL")).toBe(false);
    await credentialStore.setApiKey("test-key");
    expect(await provider.canProvide("AAPL")).toBe(true);
    expect(await provider.canProvide("BRK.B")).toBe(true);
    expect(await provider.canProvide("VOD", "LSE")).toBe(false);
  });
});
