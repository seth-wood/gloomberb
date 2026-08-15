import { describe, expect, test } from "bun:test";
import {
  buildSchwabConfigFromValues,
  DEFAULT_SCHWAB_CALLBACK_URL,
  isSchwabCallbackUrlValid,
  isSchwabConfigured,
  normalizeSchwabConfig,
} from "./config";

describe("normalizeSchwabConfig", () => {
  test("fills callback URL default and trims credentials", () => {
    expect(normalizeSchwabConfig({
      appKey: "  key  ",
      appSecret: " secret ",
      callbackUrl: "",
    })).toEqual({
      appKey: "key",
      appSecret: "secret",
      callbackUrl: DEFAULT_SCHWAB_CALLBACK_URL,
    });
  });

  test("buildSchwabConfigFromValues trims values", () => {
    const config = buildSchwabConfigFromValues({
      appKey: "key",
      appSecret: "secret",
      callbackUrl: "https://127.0.0.1:8182",
    });
    expect(config.callbackUrl).toBe("https://127.0.0.1:8182");
  });

  test("isSchwabCallbackUrlValid requires an explicit high port", () => {
    expect(isSchwabCallbackUrlValid("https://127.0.0.1:8182")).toBe(true);
    expect(isSchwabCallbackUrlValid("https://127.0.0.1")).toBe(false);
    expect(isSchwabCallbackUrlValid("https://127.0.0.1:443")).toBe(false);
  });

  test("isSchwabConfigured requires app key, secret, and valid callback URL", () => {
    expect(isSchwabConfigured({ appKey: "k", appSecret: "s", callbackUrl: "https://127.0.0.1:8182" })).toBe(true);
    expect(isSchwabConfigured({ appKey: "k", appSecret: "s", callbackUrl: "https://127.0.0.1" })).toBe(false);
    expect(isSchwabConfigured({ appKey: "k", appSecret: "", callbackUrl: "https://127.0.0.1:8182" })).toBe(false);
  });
});
