import { afterEach, describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../test-support/plugin-persistence";
import { attachSchwabPersistence, getStoredSchwabTokens, resetSchwabPersistence, storeSchwabTokens } from "./token-store";
import {
  connectSchwabInstance,
  fetchSchwabAccountNumbers,
  importSchwabPortfolioSnapshot,
  setSchwabCallbackWaiterForTests,
  setSchwabFetchTransportForTests,
} from "./client";
import { setHttpFetchTransport } from "../../utils/http-transport";

const originalFetch = globalThis.fetch;

const SCHWAB_TEST_CONFIG = {
  appKey: "app-key",
  appSecret: "app-secret",
  callbackUrl: "https://127.0.0.1:8182",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetSchwabPersistence();
  setSchwabCallbackWaiterForTests(null);
  setSchwabFetchTransportForTests(null);
  setHttpFetchTransport(null);
});

describe("fetchSchwabAccountNumbers", () => {
  test("does not share in-flight GET responses across bearer tokens", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    setHttpFetchTransport(async (_url, init) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
      const token = auth.replace("Bearer ", "");
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return new Response(JSON.stringify([
        { accountNumber: `****${token}`, hashValue: `HASH-${token}` },
      ]), { status: 200 });
    });

    const [profileA, profileB] = await Promise.all([
      fetchSchwabAccountNumbers("token-a"),
      fetchSchwabAccountNumbers("token-b"),
    ]);

    expect(maxInFlight).toBe(2);
    expect(profileA[0]?.accountNumber).toBe("****token-a");
    expect(profileB[0]?.accountNumber).toBe("****token-b");
  });
});

describe("connectSchwabInstance", () => {
  test("exchanges a browser callback code", async () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    setSchwabCallbackWaiterForTests(async (options) => {
      const state = new URL(options.authUrl).searchParams.get("state");
      expect(state).toBeTruthy();
      expect(state!.length).toBeGreaterThanOrEqual(32);
      expect(options.expectedState).toBe(state);
      return "browser-code";
    });
    globalThis.fetch = async (_url, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      expect(body).toContain("grant_type=authorization_code");
      expect(body).toContain("code=browser-code");
      return new Response(JSON.stringify({
        access_token: "access-browser",
        refresh_token: "refresh-browser",
        expires_in: 1800,
        refresh_token_expires_in: 604800,
      }), { status: 200 });
    };

    const tokens = await connectSchwabInstance({
      id: "instance-browser",
      brokerType: "schwab",
      label: "Schwab",
      config: {
        appKey: "app-key",
        appSecret: "app-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
    });

    expect(tokens.accessToken).toBe("access-browser");
    expect(getStoredSchwabTokens("instance-browser")?.refreshToken).toBe("refresh-browser");
  });

  test("reuses stored tokens", async () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    storeSchwabTokens("instance-stored", {
      accessToken: "stored-access",
      refreshToken: "stored-refresh",
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 86_400_000,
      updatedAt: Date.now(),
    }, SCHWAB_TEST_CONFIG);

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 500 });
    };

    const tokens = await connectSchwabInstance({
      id: "instance-stored",
      brokerType: "schwab",
      label: "Schwab",
      config: {
        appKey: "app-key",
        appSecret: "app-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
    });

    expect(fetchCalled).toBe(false);
    expect(tokens.accessToken).toBe("stored-access");
  });

  test("opens browser re-auth when refresh expires", async () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    storeSchwabTokens("instance-expired", {
      accessToken: "stored-access",
      refreshToken: "stored-refresh",
      accessExpiresAt: Date.now() - 1,
      refreshExpiresAt: Date.now() - 1,
      updatedAt: Date.now() - 10_000,
    });
    setSchwabCallbackWaiterForTests(async () => "reauth-code");

    let tokenExchangeBody = "";
    globalThis.fetch = async (_url, init) => {
      tokenExchangeBody = typeof init?.body === "string" ? init.body : "";
      return new Response(JSON.stringify({
        access_token: "access-reauth",
        refresh_token: "refresh-reauth",
        expires_in: 1800,
        refresh_token_expires_in: 604800,
      }), { status: 200 });
    };

    const tokens = await connectSchwabInstance({
      id: "instance-expired",
      brokerType: "schwab",
      label: "Schwab",
      config: {
        appKey: "app-key",
        appSecret: "app-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
    });

    expect(tokenExchangeBody).toContain("grant_type=authorization_code");
    expect(tokenExchangeBody).toContain("code=reauth-code");
    expect(tokens.accessToken).toBe("access-reauth");
  });
});

describe("importSchwabPortfolioSnapshot", () => {
  test("fails with AUTH_REQUIRED instead of opening the browser when no tokens are stored", async () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    setSchwabCallbackWaiterForTests(async () => {
      throw new Error("background import should not open the browser");
    });

    await expect(importSchwabPortfolioSnapshot({
      id: "instance-import",
      brokerType: "schwab",
      label: "Schwab",
      config: {
        appKey: "app-key",
        appSecret: "app-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  test("fails with AUTH_REQUIRED when refresh expires instead of opening the browser", async () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    storeSchwabTokens("instance-import", {
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      accessExpiresAt: Date.now() - 1,
      refreshExpiresAt: Date.now() - 1,
      updatedAt: Date.now() - 10_000,
    });
    setSchwabCallbackWaiterForTests(async () => {
      throw new Error("background import should not open the browser");
    });

    await expect(importSchwabPortfolioSnapshot({
      id: "instance-import",
      brokerType: "schwab",
      label: "Schwab",
      config: {
        appKey: "app-key",
        appSecret: "app-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  test("imports positions when stored tokens are valid", async () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    storeSchwabTokens("instance-import", {
      accessToken: "access-import",
      refreshToken: "refresh-import",
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 86_400_000,
      updatedAt: Date.now(),
    }, SCHWAB_TEST_CONFIG);
    setSchwabFetchTransportForTests(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/accounts/accountNumbers")) {
        return new Response(JSON.stringify([
          { accountNumber: "****1234", hashValue: "HASH123" },
        ]), { status: 200 });
      }
      if (requestUrl.includes("/accounts?fields=positions")) {
        return new Response(JSON.stringify([
          {
            securitiesAccount: {
              accountNumber: "HASH123",
              type: "MARGIN",
              currentBalances: { liquidationValue: 1000 },
              positions: [],
            },
          },
        ]), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const snapshot = await importSchwabPortfolioSnapshot({
      id: "instance-import",
      brokerType: "schwab",
      label: "Schwab",
      config: {
        appKey: "app-key",
        appSecret: "app-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
    });

    expect(snapshot.accounts).toHaveLength(1);
    expect(getStoredSchwabTokens("instance-import")?.accessToken).toBe("access-import");
  });

  test("refreshes access token when API rejects a locally valid token", async () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    storeSchwabTokens("instance-import", {
      accessToken: "stale-access",
      refreshToken: "refresh-import",
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 86_400_000,
      updatedAt: Date.now(),
    }, SCHWAB_TEST_CONFIG);
    let accountRequestCount = 0;
    let refreshCalled = false;
    globalThis.fetch = async (_url, init) => {
      refreshCalled = true;
      const body = typeof init?.body === "string" ? init.body : "";
      expect(body).toContain("grant_type=refresh_token");
      return new Response(JSON.stringify({
        access_token: "access-refreshed",
        refresh_token: "refresh-import",
        expires_in: 1800,
        refresh_token_expires_in: 604800,
      }), { status: 200 });
    };
    setSchwabFetchTransportForTests(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/accounts/accountNumbers") || requestUrl.includes("/accounts?fields=positions")) {
        accountRequestCount += 1;
        if (accountRequestCount <= 2) {
          return new Response("{}", { status: 401 });
        }
        if (requestUrl.endsWith("/accounts/accountNumbers")) {
          return new Response(JSON.stringify([
            { accountNumber: "****1234", hashValue: "HASH123" },
          ]), { status: 200 });
        }
        return new Response(JSON.stringify([
          {
            securitiesAccount: {
              accountNumber: "HASH123",
              type: "MARGIN",
              currentBalances: { liquidationValue: 1000 },
              positions: [],
            },
          },
        ]), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    const snapshot = await importSchwabPortfolioSnapshot({
      id: "instance-import",
      brokerType: "schwab",
      label: "Schwab",
      config: {
        appKey: "app-key",
        appSecret: "app-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
    });

    expect(refreshCalled).toBe(true);
    expect(snapshot.accounts).toHaveLength(1);
    expect(getStoredSchwabTokens("instance-import")?.accessToken).toBe("access-refreshed");
  });

  test("fails with AUTH_REQUIRED when a 401 refresh expires instead of opening the browser", async () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    storeSchwabTokens("instance-import", {
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 86_400_000,
      updatedAt: Date.now(),
    });
    setSchwabCallbackWaiterForTests(async () => {
      throw new Error("background import should not open the browser");
    });
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: "invalid_grant",
      error_description: "refresh token is expired",
    }), { status: 400 });
    setSchwabFetchTransportForTests(async () => new Response("{}", { status: 401 }));

    await expect(importSchwabPortfolioSnapshot({
      id: "instance-import",
      brokerType: "schwab",
      label: "Schwab",
      config: {
        appKey: "app-key",
        appSecret: "app-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
