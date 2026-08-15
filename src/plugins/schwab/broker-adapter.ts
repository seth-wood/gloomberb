import type { BrokerAdapter, BrokerConnectionStatus } from "../../types/broker";
import type { BrokerInstanceConfig } from "../../types/config";
import { t } from "../../i18n";
import { getSchwabAccountCachePolicy, getSchwabAccountCacheSourceKey } from "./account-cache";
import {
  buildSchwabConfigFromValues,
  isSchwabConfigured,
  normalizeSchwabConfig,
  SCHWAB_CONFIG_FIELDS,
} from "./config";
import { connectSchwabInstance, importSchwabPortfolioSnapshot } from "./client";
import {
  buildSchwabAuthorizationUrl,
  formatSchwabReauthDeadline,
} from "./oauth";
import { SchwabAuthError, type SchwabTokenState } from "./types";
import { clearSchwabStatus, getSchwabStatus, setSchwabStatus, subscribeSchwabStatus } from "./status";
import { clearSchwabTokens, getStoredSchwabTokensForConfig, schwabCredentialKey } from "./token-store";

function buildConnectedStatus(instanceId: string, message: string) {
  setSchwabStatus(instanceId, {
    state: "connected",
    message,
    mode: "oauth",
    updatedAt: Date.now(),
  });
}

function authRequiredStatus(config: ReturnType<typeof normalizeSchwabConfig>, updatedAt = 0): BrokerConnectionStatus {
  return {
    state: "disconnected",
    message: `Sign in to Schwab in your browser. If the window did not open, visit ${buildSchwabAuthorizationUrl(config)}`,
    mode: "oauth",
    updatedAt,
  };
}

function buildAuthRequiredStatus(instanceId: string, config: ReturnType<typeof normalizeSchwabConfig>) {
  setSchwabStatus(instanceId, authRequiredStatus(config, Date.now()));
}

function connectedStatusFromTokens(tokens: SchwabTokenState): BrokerConnectionStatus {
  return {
    state: "connected",
    message: `Connected. Re-authorize by ${formatSchwabReauthDeadline(tokens)}.`,
    mode: "oauth",
    updatedAt: tokens.updatedAt,
  };
}

async function importSchwabSnapshot(instance: BrokerInstanceConfig) {
  try {
    return await importSchwabPortfolioSnapshot(instance);
  } catch (error) {
    if (error instanceof SchwabAuthError && error.code === "AUTH_REQUIRED") {
      buildAuthRequiredStatus(instance.id, normalizeSchwabConfig(instance.config));
    }
    throw error;
  }
}

export const schwabBroker: BrokerAdapter = {
  id: "schwab",
  name: "Charles Schwab",
  configSchema: SCHWAB_CONFIG_FIELDS,
  getAccountCacheSourceKey: getSchwabAccountCacheSourceKey,
  getAccountCachePolicy: getSchwabAccountCachePolicy,
  getSessionKey(instance) {
    return schwabCredentialKey(normalizeSchwabConfig(instance.config));
  },
  getSetupGuide() {
    return {
      intro: t("You'll need a Schwab developer app and OAuth login:"),
      steps: [
        t("1. Create an Individual Trader API app at the Schwab Developer Portal"),
        t("2. Set the callback URL to https://127.0.0.1:8182 (must match exactly)"),
        t("3. Copy the App Key and App Secret into your broker profile"),
        t("4. Connect — Gloomberb opens Schwab in your browser. Continue past the 127.0.0.1 certificate warning if shown"),
        t("5. Every 7 days Schwab requires another browser sign-in (password/MFA). Gloomberb will reopen the login"),
      ],
      docsUrl: "https://developer.schwab.com",
    };
  },

  async validate(instance) {
    return isSchwabConfigured(instance.config);
  },

  async connect(instance) {
    const config = normalizeSchwabConfig(instance.config);
    setSchwabStatus(instance.id, {
      state: "connecting",
      message: "Waiting for Schwab sign-in in your browser…",
      mode: "oauth",
      updatedAt: Date.now(),
    });

    try {
      const tokens = await connectSchwabInstance(instance);
      const deadline = formatSchwabReauthDeadline(tokens);
      buildConnectedStatus(instance.id, `Connected. Re-authorize by ${deadline}.`);
    } catch (error) {
      if (error instanceof SchwabAuthError && error.code === "AUTH_REQUIRED") {
        buildAuthRequiredStatus(instance.id, config);
        throw error;
      }
      setSchwabStatus(instance.id, {
        state: "error",
        message: error instanceof Error ? error.message : "Schwab connection failed.",
        mode: "oauth",
        updatedAt: Date.now(),
      });
      throw error;
    }
  },

  async disconnect(instance) {
    clearSchwabTokens(instance.id);
    clearSchwabStatus(instance.id);
  },

  getStatus(instance) {
    const status = getSchwabStatus(instance.id);
    const config = normalizeSchwabConfig(instance.config);
    const tokens = getStoredSchwabTokensForConfig(instance.id, config);

    switch (status.state) {
      case "connecting":
      case "error":
        return status;
      case "connected":
      case "disconnected":
        return tokens ? connectedStatusFromTokens(tokens) : authRequiredStatus(config, status.updatedAt);
      default: {
        const _exhaustive: never = status.state;
        return _exhaustive;
      }
    }
  },

  subscribeStatus(instance, listener) {
    return subscribeSchwabStatus(instance.id, listener);
  },

  async importPositions(instance) {
    const snapshot = await importSchwabSnapshot(instance);
    return snapshot.positions;
  },

  async importPortfolioSnapshot(instance) {
    return importSchwabSnapshot(instance);
  },

  async listAccounts(instance) {
    const snapshot = await importSchwabSnapshot(instance);
    return snapshot.accounts;
  },

  toConfigValues(instance) {
    const config = normalizeSchwabConfig(instance.config);
    return {
      appKey: config.appKey,
      appSecret: config.appSecret,
      callbackUrl: config.callbackUrl,
    };
  },

  fromConfigValues(values) {
    return buildSchwabConfigFromValues(values) as unknown as Record<string, unknown>;
  },
};
