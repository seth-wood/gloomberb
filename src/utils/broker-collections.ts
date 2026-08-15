import type { AppConfig } from "../types/config";
import type { Portfolio } from "../types/ticker";
import {
  buildBrokerPortfolioId,
  getBrokerInstance,
  isBrokerPortfolioId,
} from "./broker-instances";

export const BROKER_COMBINED_ACCOUNT_ID = "combined";

export function buildBrokerCombinedPortfolioId(brokerInstanceId: string): string {
  return buildBrokerPortfolioId(brokerInstanceId, BROKER_COMBINED_ACCOUNT_ID);
}

export function isBrokerCombinedPortfolioId(collectionId: string | null | undefined): boolean {
  if (!collectionId || !isBrokerPortfolioId(collectionId)) return false;
  const suffix = collectionId.split(":").pop();
  return suffix === BROKER_COMBINED_ACCOUNT_ID;
}

export interface ParsedBrokerCollectionId {
  instanceId: string;
  accountId: string;
  isCombined: boolean;
}

export function parseBrokerCollectionId(collectionId: string): ParsedBrokerCollectionId | null {
  if (!isBrokerPortfolioId(collectionId)) return null;
  const colonIndex = collectionId.indexOf(":");
  const secondColonIndex = collectionId.indexOf(":", colonIndex + 1);
  if (colonIndex < 0 || secondColonIndex < 0) return null;
  const instanceId = collectionId.slice(colonIndex + 1, secondColonIndex);
  const accountId = collectionId.slice(secondColonIndex + 1);
  if (!instanceId || !accountId) return null;
  return {
    instanceId,
    accountId,
    isCombined: accountId === BROKER_COMBINED_ACCOUNT_ID,
  };
}

export function getBrokerInstanceAccountPortfolioIds(config: AppConfig, instanceId: string): string[] {
  return config.portfolios
    .filter((portfolio) => portfolio.brokerInstanceId === instanceId && portfolio.brokerAccountId)
    .map((portfolio) => portfolio.id);
}

export function getBrokerInstanceAccountIds(config: AppConfig, instanceId: string): string[] {
  return config.portfolios
    .filter((portfolio) => portfolio.brokerInstanceId === instanceId && portfolio.brokerAccountId)
    .map((portfolio) => portfolio.brokerAccountId!)
    .filter((accountId) => accountId.length > 0);
}

export function resolveCollectionPortfolioIds(config: AppConfig, collectionId: string): string[] {
  if (isBrokerCombinedPortfolioId(collectionId)) {
    const parsed = parseBrokerCollectionId(collectionId);
    if (!parsed) return [];
    return getBrokerInstanceAccountPortfolioIds(config, parsed.instanceId);
  }
  return [collectionId];
}

export function buildSyntheticCombinedPortfolio(config: AppConfig, collectionId: string): Portfolio | null {
  const parsed = parseBrokerCollectionId(collectionId);
  if (!parsed?.isCombined) return null;

  const instance = getBrokerInstance(config.brokerInstances, parsed.instanceId);
  if (!instance) return null;

  const accountPortfolios = config.portfolios.filter(
    (portfolio) => portfolio.brokerInstanceId === parsed.instanceId && portfolio.brokerAccountId,
  );
  const currency = accountPortfolios[0]?.currency ?? config.baseCurrency;

  return {
    id: collectionId,
    name: instance.label,
    currency,
    brokerId: instance.brokerType,
    brokerInstanceId: instance.id,
  };
}

export function isPortfolioCollectionId(config: AppConfig, collectionId: string): boolean {
  return config.portfolios.some((portfolio) => portfolio.id === collectionId)
    || isBrokerCombinedPortfolioId(collectionId);
}

export function resolvePortfolioCollection(
  config: AppConfig,
  collectionId: string,
): Portfolio | null {
  const direct = config.portfolios.find((portfolio) => portfolio.id === collectionId);
  if (direct) return direct;
  return buildSyntheticCombinedPortfolio(config, collectionId);
}
