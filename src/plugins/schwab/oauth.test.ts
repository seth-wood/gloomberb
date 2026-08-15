import { afterEach, describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../test-support/plugin-persistence";
import { attachSchwabPersistence, getStoredSchwabTokens, resetSchwabPersistence, storeSchwabTokens } from "./token-store";
import {
  buildSchwabAuthorizationUrl,
  exchangeSchwabAuthorizationCodeFromCode,
  needsSchwabAccessRefresh,
  refreshSchwabAccessToken,
} from "./oauth";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetSchwabPersistence();
});

describe("buildSchwabAuthorizationUrl", () => {
  test("includes client id, callback URL, and oauth state when provided", () => {
    const url = new URL(buildSchwabAuthorizationUrl({
      appKey: "app-key",
      appSecret: "secret",
      callbackUrl: "https://127.0.0.1:8182",
    }, "csrf-state"));
    expect(url.searchParams.get("client_id")).toBe("app-key");
    expect(url.searchParams.get("redirect_uri")).toBe("https://127.0.0.1:8182");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("csrf-state");
  });
});

describe("exchangeSchwabAuthorizationCodeFromCode", () => {
  test("returns tokens from the token endpoint", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 1800,
      refresh_token_expires_in: 604800,
    }), { status: 200 });

    const tokens = await exchangeSchwabAuthorizationCodeFromCode(
      {
        appKey: "app-key",
        appSecret: "app-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
      "auth-code",
    );

    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.refreshToken).toBe("refresh-1");
  });

  test("maps invalid_client to EXCHANGE_FAILED instead of expired authorization", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: "invalid_client",
      error_description: "Client authentication failed",
    }), { status: 400 });

    const error = await exchangeSchwabAuthorizationCodeFromCode(
      {
        appKey: "bad-key",
        appSecret: "bad-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
      "auth-code",
    ).catch((caught) => caught);

    expect(error).toMatchObject({ code: "EXCHANGE_FAILED" });
    expect(error.message).toContain("App Key or App Secret");
  });
});

describe("refreshSchwabAccessToken", () => {
  test("throws TOKEN_EXPIRED when refresh token is past expiry", async () => {
    await expect(refreshSchwabAccessToken(
      { appKey: "k", appSecret: "s", callbackUrl: "https://127.0.0.1:8182" },
      {
        accessToken: "old",
        refreshToken: "refresh",
        accessExpiresAt: Date.now() - 1,
        refreshExpiresAt: Date.now() - 1,
        updatedAt: Date.now() - 10_000,
      },
    )).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });

  test("refreshes access token before expiry window", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      access_token: "access-2",
      refresh_token: "refresh-2",
      expires_in: 1800,
      refresh_token_expires_in: 604800,
    }), { status: 200 });

    const next = await refreshSchwabAccessToken(
      { appKey: "k", appSecret: "s", callbackUrl: "https://127.0.0.1:8182" },
      {
        accessToken: "old",
        refreshToken: "refresh-1",
        accessExpiresAt: Date.now() + 30_000,
        refreshExpiresAt: Date.now() + 86_400_000,
        updatedAt: Date.now(),
      },
    );

    expect(next.accessToken).toBe("access-2");
    expect(needsSchwabAccessRefresh(next)).toBe(false);
  });

  test("preserves refresh expiry when API omits refresh_token_expires_in", async () => {
    const originalRefreshExpiresAt = Date.now() + 5 * 24 * 60 * 60 * 1000;
    globalThis.fetch = async () => new Response(JSON.stringify({
      access_token: "access-3",
      expires_in: 1800,
    }), { status: 200 });

    const next = await refreshSchwabAccessToken(
      { appKey: "k", appSecret: "s", callbackUrl: "https://127.0.0.1:8182" },
      {
        accessToken: "old",
        refreshToken: "refresh-1",
        accessExpiresAt: Date.now() - 1,
        refreshExpiresAt: originalRefreshExpiresAt,
        updatedAt: Date.now(),
      },
    );

    expect(next.accessToken).toBe("access-3");
    expect(next.refreshExpiresAt).toBe(originalRefreshExpiresAt);
  });
});

describe("token persistence", () => {
  test("stores exchanged tokens against an instance", async () => {
    const persistence = new MemoryPluginPersistence();
    attachSchwabPersistence(persistence);

    globalThis.fetch = async () => new Response(JSON.stringify({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 1800,
      refresh_token_expires_in: 604800,
    }), { status: 200 });

    const tokens = await exchangeSchwabAuthorizationCodeFromCode(
      {
        appKey: "app-key",
        appSecret: "app-secret",
        callbackUrl: "https://127.0.0.1:8182",
      },
      "auth-code",
    );
    storeSchwabTokens("instance-1", tokens);
    expect(getStoredSchwabTokens("instance-1")?.refreshToken).toBe("refresh-1");
  });
});
