import type { PluginPersistence } from "../../types/plugin";
import { fnv1aHashString } from "../../utils/hash";
import type { SchwabConfig } from "./config";
import { SCHWAB_TOKEN_SCHEMA_VERSION, type SchwabTokenState } from "./types";

const TOKEN_KEY_PREFIX = "tokens:";

let schwabPersistence: PluginPersistence | null = null;

export function attachSchwabPersistence(persistence: PluginPersistence): void {
  schwabPersistence = persistence;
}

export function resetSchwabPersistence(): void {
  schwabPersistence = null;
}

function tokenKey(instanceId: string): string {
  return `${TOKEN_KEY_PREFIX}${instanceId}`;
}

function isTokenState(value: unknown): value is SchwabTokenState {
  const record = value as Partial<SchwabTokenState> | null;
  return !!record
    && typeof record === "object"
    && typeof record.accessToken === "string"
    && record.accessToken.length > 0
    && typeof record.refreshToken === "string"
    && record.refreshToken.length > 0
    && typeof record.accessExpiresAt === "number"
    && typeof record.refreshExpiresAt === "number"
    && typeof record.updatedAt === "number";
}

export function schwabCredentialKey(config: SchwabConfig): string {
  return fnv1aHashString(`${config.appKey}:${config.appSecret}`);
}

export function getStoredSchwabTokens(instanceId: string): SchwabTokenState | null {
  const tokens = schwabPersistence?.getState<unknown>(tokenKey(instanceId), {
    schemaVersion: SCHWAB_TOKEN_SCHEMA_VERSION,
  });
  return isTokenState(tokens) ? tokens : null;
}

export function getStoredSchwabTokensForConfig(
  instanceId: string,
  config: SchwabConfig,
): SchwabTokenState | null {
  const tokens = getStoredSchwabTokens(instanceId);
  if (!tokens) return null;

  const credentialKey = schwabCredentialKey(config);
  if (tokens.credentialKey && tokens.credentialKey !== credentialKey) {
    return null;
  }

  if (Date.now() >= tokens.refreshExpiresAt) {
    return null;
  }

  return tokens;
}

export function storeSchwabTokens(
  instanceId: string,
  tokens: SchwabTokenState,
  config?: SchwabConfig,
): void {
  const toStore = config
    ? { ...tokens, credentialKey: schwabCredentialKey(config) }
    : tokens;
  schwabPersistence?.setState(tokenKey(instanceId), toStore, {
    schemaVersion: SCHWAB_TOKEN_SCHEMA_VERSION,
  });
}

export function clearSchwabTokens(instanceId: string): void {
  schwabPersistence?.deleteState(tokenKey(instanceId));
}
