import type { BrokerConfigField } from "../../types/broker";
import { parseSchwabCallbackListenTarget } from "./callback-server";

export const DEFAULT_SCHWAB_CALLBACK_URL = "https://127.0.0.1:8182";

export interface SchwabConfig {
  appKey: string;
  appSecret: string;
  callbackUrl: string;
}

export const SCHWAB_CONFIG_FIELDS: BrokerConfigField[] = [
  {
    key: "appKey",
    label: "App Key",
    type: "text",
    required: true,
    placeholder: "Schwab developer App Key",
  },
  {
    key: "appSecret",
    label: "App Secret",
    type: "password",
    required: true,
    placeholder: "Schwab developer App Secret",
  },
  {
    key: "callbackUrl",
    label: "Callback URL",
    type: "text",
    required: true,
    defaultValue: DEFAULT_SCHWAB_CALLBACK_URL,
    placeholder: DEFAULT_SCHWAB_CALLBACK_URL,
  },
];

function coerceString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function normalizeSchwabConfig(raw?: Record<string, unknown>): SchwabConfig {
  const input = raw ?? {};
  const callbackUrl = coerceString(input.callbackUrl, DEFAULT_SCHWAB_CALLBACK_URL).trim() || DEFAULT_SCHWAB_CALLBACK_URL;
  return {
    appKey: coerceString(input.appKey).trim(),
    appSecret: coerceString(input.appSecret).trim(),
    callbackUrl,
  };
}

export function buildSchwabConfigFromValues(values: Record<string, unknown>): SchwabConfig {
  return normalizeSchwabConfig(values);
}

export function isSchwabCallbackUrlValid(callbackUrl: string): boolean {
  try {
    parseSchwabCallbackListenTarget(callbackUrl);
    return true;
  } catch {
    return false;
  }
}

export function isSchwabConfigured(raw?: Record<string, unknown>): boolean {
  const config = normalizeSchwabConfig(raw);
  return !!config.appKey && !!config.appSecret && isSchwabCallbackUrlValid(config.callbackUrl);
}
