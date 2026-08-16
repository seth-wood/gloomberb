import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHttpFetchTransport } from "../../utils/http-transport";
import { WisesheetsClient } from "./client";
import { WisesheetsCredentialStore } from "./credentials";

const tempDirs: string[] = [];

async function tempDataDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "gloomberb-wisesheets-client-"));
  tempDirs.push(path);
  return path;
}

afterEach(async () => {
  setHttpFetchTransport(null);
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("WisesheetsClient", () => {
  test("rejects financial rows for a different ticker than requested", async () => {
    const dataDir = await tempDataDir();
    const store = new WisesheetsCredentialStore(dataDir);
    await store.setApiKey("test-key");

    setHttpFetchTransport(async (url) => {
      if (url.includes("/me/")) {
        return new Response(JSON.stringify({ limits: { historyYears: 5 } }), { status: 200 });
      }
      if (url.includes("/financials/")) {
        return new Response(JSON.stringify({
          data: [{
            ticker: "MSFT",
            periodEnd: "2025-06-30",
            metric: "revenue",
            value: 100,
            fiscalYear: 2025,
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });

    const client = new WisesheetsClient({ credentialStore: store });
    await expect(client.getTickerFinancials("AAPL", "NASDAQ")).rejects.toThrow("Wisesheets returned no financial rows for AAPL");
  });

  test("returns annual financials when quarterly last4q is empty", async () => {
    const dataDir = await tempDataDir();
    const store = new WisesheetsCredentialStore(dataDir);
    await store.setApiKey("test-key");

    setHttpFetchTransport(async (url) => {
      if (url.includes("/me/")) {
        return new Response(JSON.stringify({ limits: { historyYears: 5 } }), { status: 200 });
      }
      if (url.includes("/financials/")) {
        const isQuarterly = url.includes("frequency=quarterly");
        if (isQuarterly) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({
          data: [{
            ticker: "AAPL",
            periodEnd: "2024-09-30",
            metric: "revenue",
            value: 100,
            fiscalYear: 2024,
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });

    const client = new WisesheetsClient({ credentialStore: store });
    const financials = await client.getTickerFinancials("AAPL", "NASDAQ");
    expect(financials.annualStatements).toHaveLength(1);
    expect(financials.quarterlyStatements).toHaveLength(0);
  });

  test("retries transient 503 responses and returns provider miss on empty data", async () => {
    const dataDir = await tempDataDir();
    const store = new WisesheetsCredentialStore(dataDir);
    await store.setApiKey("test-key");
    let attempts = 0;

    setHttpFetchTransport(async () => {
      attempts += 1;
      if (attempts < 2) {
        return new Response("upstream timeout", { status: 503 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    const client = new WisesheetsClient({ credentialStore: store });
    await expect(client.getTickerFinancials("AAPL", "NASDAQ")).rejects.toThrow("Wisesheets returned no financial rows");
    expect(attempts).toBeGreaterThanOrEqual(2);
  });
});
