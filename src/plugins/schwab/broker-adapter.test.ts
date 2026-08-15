import { afterEach, describe, expect, test } from "bun:test";
import { MemoryPluginPersistence } from "../../test-support/plugin-persistence";
import { schwabBroker } from "./broker-adapter";
import { normalizeSchwabConfig } from "./config";
import { clearSchwabStatus, getSchwabStatus, setSchwabStatus, subscribeSchwabStatus } from "./status";
import {
  attachSchwabPersistence,
  getStoredSchwabTokens,
  getStoredSchwabTokensForConfig,
  resetSchwabPersistence,
  storeSchwabTokens,
} from "./token-store";

afterEach(() => {
  resetSchwabPersistence();
});

function createInstance(id: string, config: Record<string, unknown> = {
  appKey: "app-key",
  appSecret: "app-secret",
  callbackUrl: "https://127.0.0.1:8182",
}) {
  return {
    id,
    brokerType: "schwab",
    label: "Schwab",
    config,
  };
}

describe("schwabBroker.fromConfigValues", () => {
  test("normalizes credentials without mutating tokens or status", () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    const previous = createInstance("instance-config", {
      appKey: "old-key",
      appSecret: "old-secret",
      callbackUrl: "https://127.0.0.1:8182",
    });
    storeSchwabTokens(previous.id, {
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 86_400_000,
      updatedAt: Date.now(),
    }, normalizeSchwabConfig(previous.config));
    setSchwabStatus(previous.id, {
      state: "connected",
      message: "Connected. Re-authorize by tomorrow.",
      mode: "oauth",
      updatedAt: Date.now(),
    });

    const next = schwabBroker.fromConfigValues?.({
      appKey: "new-key",
      appSecret: "new-secret",
      callbackUrl: "https://127.0.0.1:8182",
    }, previous);

    expect(next).toMatchObject({
      appKey: "new-key",
      appSecret: "new-secret",
      callbackUrl: "https://127.0.0.1:8182",
    });
    expect(getStoredSchwabTokens(previous.id)?.refreshToken).toBe("refresh");
    expect(getSchwabStatus(previous.id).state).toBe("connected");
  });
});

describe("schwabBroker.getSessionKey", () => {
  test("changes when app credentials change", () => {
    const previous = createInstance("instance-session");
    const next = createInstance("instance-session", {
      appKey: "other-key",
      appSecret: "app-secret",
      callbackUrl: "https://127.0.0.1:8182",
    });
    expect(schwabBroker.getSessionKey?.(previous)).not.toBe(schwabBroker.getSessionKey?.(next));
  });
});

describe("schwabBroker.getStatus", () => {
  test("reports connected from persisted tokens after a restart", () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    const instance = createInstance("instance-restart-status");
    clearSchwabStatus(instance.id);
    storeSchwabTokens(instance.id, {
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 86_400_000,
      updatedAt: Date.now(),
    }, normalizeSchwabConfig(instance.config));

    expect(getSchwabStatus(instance.id).state).toBe("disconnected");
    expect(schwabBroker.getStatus?.(instance)).toMatchObject({
      state: "connected",
      mode: "oauth",
    });
    expect(schwabBroker.getStatus?.(instance)?.message).toContain("Re-authorize by");
    expect(getSchwabStatus(instance.id).state).toBe("disconnected");
  });

  test("does not report connected from expired persisted tokens", () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    const instance = createInstance("instance-expired-status");
    clearSchwabStatus(instance.id);
    storeSchwabTokens(instance.id, {
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: Date.now() - 1,
      refreshExpiresAt: Date.now() - 1,
      updatedAt: Date.now() - 10_000,
    }, normalizeSchwabConfig(instance.config));

    expect(schwabBroker.getStatus?.(instance)).toMatchObject({
      state: "disconnected",
    });
    expect(schwabBroker.getStatus?.(instance)?.message).toContain("Sign in to Schwab");
  });

  test("derives disconnected when the in-memory status is stale connected", () => {
    const instance = createInstance("instance-stale-status");
    setSchwabStatus(instance.id, {
      state: "connected",
      message: "Connected. Re-authorize by tomorrow.",
      mode: "oauth",
      updatedAt: Date.now(),
    });

    expect(schwabBroker.getStatus?.(instance)).toMatchObject({
      state: "disconnected",
      mode: "oauth",
    });
    expect(schwabBroker.getStatus?.(instance)?.message).toContain("Sign in to Schwab");
    expect(getSchwabStatus(instance.id).state).toBe("connected");
  });

  test("ignores legacy tokens stored without a credential fingerprint", () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    const config = normalizeSchwabConfig({
      appKey: "app-key",
      appSecret: "app-secret",
      callbackUrl: "https://127.0.0.1:8182",
    });
    storeSchwabTokens("instance-legacy", {
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 86_400_000,
      updatedAt: Date.now(),
    });

    expect(getStoredSchwabTokensForConfig("instance-legacy", config)).toBeNull();
    expect(getStoredSchwabTokens("instance-legacy")?.refreshToken).toBe("refresh");
  });

  test("ignores tokens tied to a different credential fingerprint without deleting them", () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    const config = normalizeSchwabConfig({
      appKey: "app-key",
      appSecret: "app-secret",
      callbackUrl: "https://127.0.0.1:8182",
    });
    storeSchwabTokens("instance-config", {
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 86_400_000,
      updatedAt: Date.now(),
    }, config);

    const mismatched = getStoredSchwabTokensForConfig("instance-config", normalizeSchwabConfig({
      appKey: "other-key",
      appSecret: "app-secret",
      callbackUrl: "https://127.0.0.1:8182",
    }));
    expect(mismatched).toBeNull();
    expect(getStoredSchwabTokens("instance-config")?.refreshToken).toBe("refresh");
  });

  test("does not reuse stored tokens after the refresh token expires", () => {
    attachSchwabPersistence(new MemoryPluginPersistence());
    const config = normalizeSchwabConfig({
      appKey: "app-key",
      appSecret: "app-secret",
      callbackUrl: "https://127.0.0.1:8182",
    });
    storeSchwabTokens("instance-expired-tokens", {
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() - 1,
      updatedAt: Date.now() - 10_000,
    }, config);

    expect(getStoredSchwabTokensForConfig("instance-expired-tokens", config)).toBeNull();
    expect(getStoredSchwabTokens("instance-expired-tokens")?.refreshToken).toBe("refresh");
  });
});

describe("schwabBroker status notifications", () => {
  test("disconnect notifies subscribers and keeps the subscription", async () => {
    const instance = createInstance("instance-disconnect-status");
    setSchwabStatus(instance.id, {
      state: "connected",
      message: "Connected. Re-authorize by tomorrow.",
      mode: "oauth",
      updatedAt: Date.now(),
    });

    let notifications = 0;
    const unsubscribe = subscribeSchwabStatus(instance.id, () => {
      notifications += 1;
    });
    await schwabBroker.disconnect?.(instance);
    expect(notifications).toBe(1);
    expect(schwabBroker.getStatus?.(instance)).toMatchObject({
      state: "disconnected",
    });
    expect(schwabBroker.getStatus?.(instance)?.message).toContain("Sign in to Schwab");

    setSchwabStatus(instance.id, {
      state: "connecting",
      message: "Waiting for Schwab sign-in in your browser…",
      mode: "oauth",
      updatedAt: Date.now(),
    });
    expect(notifications).toBe(2);
    unsubscribe();
  });
});
