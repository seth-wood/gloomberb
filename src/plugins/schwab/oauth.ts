import { randomBytes } from "node:crypto";
import { normalizeSchwabConfig, type SchwabConfig } from "./config";
import {
  SCHWAB_OAUTH_AUTHORIZE_URL,
  SCHWAB_OAUTH_TOKEN_URL,
  SchwabAuthError,
  type SchwabTokenState,
} from "./types";

interface SchwabTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

const DEFAULT_ACCESS_TTL_MS = 30 * 60 * 1000;
const DEFAULT_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function basicAuthHeader(appKey: string, appSecret: string): string {
  return `Basic ${Buffer.from(`${appKey}:${appSecret}`).toString("base64")}`;
}

function buildTokenState(response: SchwabTokenResponse, previous?: SchwabTokenState | null): SchwabTokenState {
  const now = Date.now();
  const accessToken = response.access_token?.trim();
  const refreshToken = response.refresh_token?.trim() || previous?.refreshToken;
  if (!accessToken || !refreshToken) {
    throw new SchwabAuthError("Schwab token response was missing access or refresh token.", "EXCHANGE_FAILED");
  }

  const accessExpiresInMs = typeof response.expires_in === "number" && response.expires_in > 0
    ? response.expires_in * 1000
    : DEFAULT_ACCESS_TTL_MS;
  const refreshExpiresAt = typeof response.refresh_token_expires_in === "number" && response.refresh_token_expires_in > 0
    ? now + response.refresh_token_expires_in * 1000
    : previous?.refreshExpiresAt ?? now + DEFAULT_REFRESH_TTL_MS;

  return {
    accessToken,
    refreshToken,
    accessExpiresAt: now + accessExpiresInMs,
    refreshExpiresAt,
    updatedAt: now,
  };
}

async function postTokenRequest(
  config: SchwabConfig,
  body: URLSearchParams,
  previous?: SchwabTokenState | null,
): Promise<SchwabTokenState> {
  const response = await fetch(SCHWAB_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config.appKey, config.appSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const payload = await response.json().catch(() => ({})) as SchwabTokenResponse;
  if (!response.ok) {
    const description = payload.error_description || payload.error || response.statusText;
    if (payload.error === "invalid_client") {
      throw new SchwabAuthError(
        "Schwab App Key or App Secret is invalid. Check the credentials in this profile.",
        "EXCHANGE_FAILED",
      );
    }
    if (description.toLowerCase().includes("refresh")) {
      throw new SchwabAuthError(
        "Schwab authorization expired. Connect again to sign in.",
        "TOKEN_EXPIRED",
      );
    }
    throw new SchwabAuthError(
      description || "Schwab token exchange failed.",
      "EXCHANGE_FAILED",
    );
  }

  return buildTokenState(payload, previous);
}

export function createSchwabOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function buildSchwabAuthorizationUrl(config: SchwabConfig, state?: string): string {
  const params = new URLSearchParams({
    client_id: config.appKey,
    redirect_uri: config.callbackUrl,
    response_type: "code",
  });
  if (state) params.set("state", state);
  return `${SCHWAB_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeSchwabAuthorizationCodeFromCode(
  rawConfig: Record<string, unknown>,
  code: string,
): Promise<SchwabTokenState> {
  const config = normalizeSchwabConfig(rawConfig);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.callbackUrl,
  });
  return postTokenRequest(config, body);
}

export async function refreshSchwabAccessToken(
  rawConfig: Record<string, unknown>,
  tokens: SchwabTokenState,
): Promise<SchwabTokenState> {
  if (Date.now() >= tokens.refreshExpiresAt) {
    throw new SchwabAuthError(
      "Schwab refresh token expired. Connect again to sign in.",
      "TOKEN_EXPIRED",
    );
  }

  const config = normalizeSchwabConfig(rawConfig);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  const next = await postTokenRequest(config, body, tokens);
  return {
    ...next,
    refreshToken: next.refreshToken || tokens.refreshToken,
  };
}

export function needsSchwabAccessRefresh(tokens: SchwabTokenState, now = Date.now()): boolean {
  return now >= tokens.accessExpiresAt - 60_000;
}

export function formatSchwabReauthDeadline(tokens: SchwabTokenState): string {
  return new Date(tokens.refreshExpiresAt).toLocaleString();
}
