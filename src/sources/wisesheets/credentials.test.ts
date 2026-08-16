import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WisesheetsCredentialStore, resolveWisesheetsCredentialPath } from "./credentials";

const tempDirs: string[] = [];

async function tempDataDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "gloomberb-wisesheets-credentials-"));
  tempDirs.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  delete process.env.WISESHEETS_API_KEY;
});

describe("WisesheetsCredentialStore", () => {
  test("persists credentials outside AppConfig and never returns mutable storage references", async () => {
    const dataDir = await tempDataDir();
    const store = new WisesheetsCredentialStore(dataDir);
    await store.setApiKey("wisesheets-secret-key");

    const first = await store.readStoredApiKey();
    expect(first).toBe("wisesheets-secret-key");

    const reloaded = await new WisesheetsCredentialStore(dataDir);
    expect(await reloaded.readStoredApiKey()).toBe("wisesheets-secret-key");
    expect(resolveWisesheetsCredentialPath(dataDir)).toBe(join(dataDir, "wisesheets", "credentials.json"));

    if (process.platform !== "win32") {
      expect((await stat(resolveWisesheetsCredentialPath(dataDir))).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(resolveWisesheetsCredentialPath(dataDir)))).mode & 0o777).toBe(0o700);
    }
  });

  test("prefers the environment override over the credential file", async () => {
    const dataDir = await tempDataDir();
    const store = new WisesheetsCredentialStore(dataDir);
    await store.setApiKey("file-key");
    process.env.WISESHEETS_API_KEY = "env-key";
    expect(await store.resolveApiKey()).toBe("env-key");
    const status = await store.getStatus();
    expect(status).toMatchObject({ configured: true, source: "env" });
  });

  test("fails closed instead of overwriting a malformed credential file", async () => {
    const dataDir = await tempDataDir();
    const path = resolveWisesheetsCredentialPath(dataDir);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 1, apiKey: 123 }), "utf8");

    const store = new WisesheetsCredentialStore(dataDir);
    await expect(store.readStoredApiKey()).rejects.toThrow("apiKey must be a string");
    await expect(store.setApiKey("valid-key")).rejects.toThrow("apiKey must be a string");
    expect(await readFile(path, "utf8")).toContain('"apiKey":123');
  });
});
