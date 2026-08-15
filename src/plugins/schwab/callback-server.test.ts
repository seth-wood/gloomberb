import { describe, expect, test } from "bun:test";
import {
  listenForSchwabCallback,
  parseSchwabCallbackListenTarget,
  SCHWAB_CALLBACK_IN_USE_MESSAGE,
  waitForSchwabAuthorizationCode,
} from "./callback-server";
import { SchwabAuthError } from "./types";

describe("parseSchwabCallbackListenTarget", () => {
  test("parses the default https localhost callback", () => {
    expect(parseSchwabCallbackListenTarget("https://127.0.0.1:8182")).toEqual({
      hostname: "127.0.0.1",
      port: 8182,
      protocol: "https",
    });
  });

  test("rejects privileged ports so Connect can listen without admin", () => {
    expect(() => parseSchwabCallbackListenTarget("https://127.0.0.1")).toThrow(SchwabAuthError);
    expect(() => parseSchwabCallbackListenTarget("https://127.0.0.1:443")).toThrow(/8182/);
  });
});

describe("listenForSchwabCallback", () => {
  test("captures the authorization code from the localhost redirect", async () => {
    const listener = await listenForSchwabCallback({
      callbackUrl: "http://127.0.0.1:0",
      allowHttp: true,
    });
    try {
      const response = await fetch(`${listener.url}/?code=auth-code-1`);
      expect(response.ok).toBe(true);
      expect(await listener.code).toBe("auth-code-1");
    } finally {
      await listener.stop();
    }
  });

  test("ignores authorization codes that do not match the oauth state", async () => {
    const listener = await listenForSchwabCallback({
      callbackUrl: "http://127.0.0.1:0",
      allowHttp: true,
      expectedState: "expected-state-value",
    });
    try {
      const missingState = await fetch(`${listener.url}/?code=attacker-code`);
      expect(missingState.status).toBe(400);
      const wrongState = await fetch(`${listener.url}/?code=attacker-code&state=wrong`);
      expect(wrongState.status).toBe(400);
      const accepted = await fetch(`${listener.url}/?code=auth-code-1&state=expected-state-value`);
      expect(accepted.ok).toBe(true);
      expect(await listener.code).toBe("auth-code-1");
    } finally {
      await listener.stop();
    }
  });

  test("rejects a second listener on the same bound port", async () => {
    const first = await listenForSchwabCallback({
      callbackUrl: "http://127.0.0.1:0",
      allowHttp: true,
    });
    try {
      await expect(listenForSchwabCallback({
        callbackUrl: first.url,
        allowHttp: true,
      })).rejects.toMatchObject({
        name: "SchwabAuthError",
        message: SCHWAB_CALLBACK_IN_USE_MESSAGE,
        code: "AUTH_REQUIRED",
      });
    } finally {
      await first.stop();
    }

    const second = await listenForSchwabCallback({
      callbackUrl: first.url,
      allowHttp: true,
    });
    await second.stop();
  });
});

describe("waitForSchwabAuthorizationCode", () => {
  test("times out when the browser never returns", async () => {
    await expect(waitForSchwabAuthorizationCode({
      callbackUrl: "http://127.0.0.1:0",
      authUrl: "https://example.invalid/oauth",
      timeoutMs: 50,
      allowHttp: true,
      openUrl: async () => {},
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  test("fails immediately when the browser cannot be opened", async () => {
    await expect(waitForSchwabAuthorizationCode({
      callbackUrl: "http://127.0.0.1:0",
      authUrl: "https://example.invalid/oauth",
      timeoutMs: 5_000,
      allowHttp: true,
      openUrl: async () => {
        throw new Error("Could not open the Schwab sign-in page.");
      },
    })).rejects.toMatchObject({
      name: "SchwabAuthError",
      code: "AUTH_REQUIRED",
      message: expect.stringContaining("Could not open the Schwab sign-in page."),
    });
  });
});
