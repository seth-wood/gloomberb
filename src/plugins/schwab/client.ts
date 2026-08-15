import type { BrokerInstanceConfig } from "../../types/config";
import { createThrottledFetch } from "../../utils/throttled-fetch";
import {
  waitForSchwabAuthorizationCode,
} from "./callback-server";
import { normalizeSchwabConfig } from "./config";
import { mapSchwabPortfolioSnapshot } from "./map-accounts";
import {
  buildSchwabAuthorizationUrl,
  createSchwabOAuthState,
  exchangeSchwabAuthorizationCodeFromCode,
  needsSchwabAccessRefresh,
  refreshSchwabAccessToken,
} from "./oauth";
import {
  clearSchwabTokens,
  getStoredSchwabTokensForConfig,
  storeSchwabTokens,
} from "./token-store";
import {
  SCHWAB_TRADER_BASE_URL,
  SchwabAuthError,
  type SchwabAccountNumber,
  type SchwabAccountPayload,
  type SchwabTokenState,
  type SchwabUserPreference,
  type SchwabUserPreferenceAccount,
} from "./types";

const schwabClient = createThrottledFetch({
  requestsPerMinute: 60,
  maxRetries: 1,
  timeoutMs: 20_000,
  dedupeGetRequests: false,
});

let fetchTransportOverride: typeof fetch | null = null;
let waitForCallbackOverride: typeof waitForSchwabAuthorizationCode | null = null;

export function setSchwabFetchTransportForTests(transport: typeof fetch | null): void {
  fetchTransportOverride = transport;
}

export function setSchwabCallbackWaiterForTests(
  waiter: typeof waitForSchwabAuthorizationCode | null,
): void {
  waitForCallbackOverride = waiter;
}

async function schwabFetch(url: string, init?: RequestInit): Promise<Response> {
  if (fetchTransportOverride) {
    return fetchTransportOverride(url, init);
  }
  return schwabClient.fetch(url, init);
}

async function authorizedGet<T>(accessToken: string, path: string): Promise<T> {
  const response = await schwabFetch(`${SCHWAB_TRADER_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 401) {
      throw new SchwabAuthError("Schwab access token was rejected. Re-authorize this profile.", "TOKEN_EXPIRED");
    }
    throw new Error(body || `Schwab API request failed (${response.status}).`);
  }

  return response.json() as Promise<T>;
}

export async function fetchSchwabAccountNumbers(accessToken: string): Promise<SchwabAccountNumber[]> {
  return authorizedGet<SchwabAccountNumber[]>(accessToken, "/accounts/accountNumbers");
}

export async function fetchSchwabAccountsWithPositions(accessToken: string): Promise<SchwabAccountPayload[]> {
  return authorizedGet<SchwabAccountPayload[]>(accessToken, "/accounts?fields=positions");
}

function schwabAuthRequiredError(): SchwabAuthError {
  return new SchwabAuthError(
    "Schwab authorization required. Connect this profile to sign in.",
    "AUTH_REQUIRED",
  );
}

export async function ensureSchwabAccessToken(
  instance: BrokerInstanceConfig,
): Promise<SchwabTokenState> {
  const config = normalizeSchwabConfig(instance.config);
  const stored = getStoredSchwabTokensForConfig(instance.id, config);
  if (!stored) {
    throw schwabAuthRequiredError();
  }

  if (!needsSchwabAccessRefresh(stored)) {
    return stored;
  }

  try {
    const refreshed = await refreshSchwabAccessToken(instance.config, stored);
    storeSchwabTokens(instance.id, refreshed, config);
    return refreshed;
  } catch (error) {
    if (error instanceof SchwabAuthError && error.code === "TOKEN_EXPIRED") {
      clearSchwabTokens(instance.id);
      throw schwabAuthRequiredError();
    }
    throw error;
  }
}

async function authorizeSchwabInBrowser(instance: BrokerInstanceConfig): Promise<SchwabTokenState> {
  const config = normalizeSchwabConfig(instance.config);
  const state = createSchwabOAuthState();
  const authUrl = buildSchwabAuthorizationUrl(config, state);
  const waitForCallback = waitForCallbackOverride ?? waitForSchwabAuthorizationCode;
  try {
    const code = await waitForCallback({
      callbackUrl: config.callbackUrl,
      authUrl,
      expectedState: state,
    });
    const tokens = await exchangeSchwabAuthorizationCodeFromCode(instance.config, code);
    storeSchwabTokens(instance.id, tokens, config);
    return tokens;
  } catch (error) {
    if (error instanceof SchwabAuthError && error.code === "INVALID_REDIRECT") {
      throw new SchwabAuthError(
        `${error.message} Set the Schwab app callback to ${config.callbackUrl}, then Connect again.`,
        "AUTH_REQUIRED",
      );
    }
    throw error;
  }
}

export async function connectSchwabInstance(
  instance: BrokerInstanceConfig,
): Promise<SchwabTokenState> {
  try {
    return await ensureSchwabAccessToken(instance);
  } catch (error) {
    if (error instanceof SchwabAuthError && error.code === "AUTH_REQUIRED") {
      return authorizeSchwabInBrowser(instance);
    }
    throw error;
  }
}

async function withSchwabAuthorizedRequest<T>(
  instance: BrokerInstanceConfig,
  request: (accessToken: string) => Promise<T>,
): Promise<T> {
  const tokens = await ensureSchwabAccessToken(instance);
  const config = normalizeSchwabConfig(instance.config);

  try {
    return await request(tokens.accessToken);
  } catch (error) {
    if (!(error instanceof SchwabAuthError && error.code === "TOKEN_EXPIRED")) {
      throw error;
    }

    try {
      const refreshed = await refreshSchwabAccessToken(instance.config, tokens);
      storeSchwabTokens(instance.id, refreshed, config);
      return await request(refreshed.accessToken);
    } catch (refreshError) {
      if (refreshError instanceof SchwabAuthError && refreshError.code === "TOKEN_EXPIRED") {
        clearSchwabTokens(instance.id);
        throw schwabAuthRequiredError();
      }
      throw refreshError;
    }
  }
}

export async function fetchSchwabUserPreferenceAccounts(accessToken: string): Promise<SchwabUserPreferenceAccount[]> {
  try {
    const preference = await authorizedGet<SchwabUserPreference>(accessToken, "/userPreference");
    return preference.accounts ?? [];
  } catch {
    return [];
  }
}

export async function importSchwabPortfolioSnapshot(instance: BrokerInstanceConfig) {
  return withSchwabAuthorizedRequest(instance, async (accessToken) => {
    const [accountNumbers, accounts, userPreferences] = await Promise.all([
      fetchSchwabAccountNumbers(accessToken),
      fetchSchwabAccountsWithPositions(accessToken),
      fetchSchwabUserPreferenceAccounts(accessToken),
    ]);
    return mapSchwabPortfolioSnapshot(accounts, accountNumbers, Date.now(), userPreferences);
  });
}
