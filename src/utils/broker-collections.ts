import type { AppConfig } from "../types/config";
import type { Portfolio } from "../types/ticker";
import {
  buildBrokerPortfolioId,
  getBrokerInstance,
  isBrokerPortfolioId,
} from "./broker-instances";

export const BROKER_COMBINED_ACCOUNT_ID = "combined";

export interface PortfolioCollectionTabEntry {
  id: string;
  name: string;
  kind: "portfolio";
}

export interface BrokerInstanceAccounts {
  portfolioIds: string[];
  accountIds: string[];
}

export interface BrokerInstancePortfolioGroup {
  instanceId: string;
  accountPortfolios: Portfolio[];
}

export function buildBrokerCombinedPortfolioId(brokerInstanceId: string): string {
  return buildBrokerPortfolioId(brokerInstanceId, BROKER_COMBINED_ACCOUNT_ID);
}

export function isBrokerCombinedPortfolioId(collectionId: string | null | undefined): boolean {
  if (!collectionId) return false;
  const parsed = parseBrokerCollectionId(collectionId);
  return parsed?.isCombined ?? false;
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

export function getBrokerInstanceAccounts(config: AppConfig, instanceId: string): BrokerInstanceAccounts {
  const portfolioIds: string[] = [];
  const accountIds: string[] = [];
  for (const portfolio of config.portfolios) {
    if (portfolio.brokerInstanceId === instanceId && portfolio.brokerAccountId) {
      portfolioIds.push(portfolio.id);
      accountIds.push(portfolio.brokerAccountId);
    }
  }
  return { portfolioIds, accountIds };
}

export function resolveCollectionPortfolioIds(config: AppConfig, collectionId: string): string[] {
  if (isBrokerCombinedPortfolioId(collectionId)) {
    const parsed = parseBrokerCollectionId(collectionId);
    if (!parsed) return [];
    return getBrokerInstanceAccounts(config, parsed.instanceId).portfolioIds;
  }
  return [collectionId];
}

export function groupBrokerPortfoliosByInstance(config: AppConfig): BrokerInstancePortfolioGroup[] {
  const groups = new Map<string, Portfolio[]>();
  for (const portfolio of config.portfolios) {
    if (!portfolio.brokerInstanceId || !portfolio.brokerAccountId) continue;
    const accountPortfolios = groups.get(portfolio.brokerInstanceId) ?? [];
    accountPortfolios.push(portfolio);
    groups.set(portfolio.brokerInstanceId, accountPortfolios);
  }
  return [...groups.entries()].map(([instanceId, accountPortfolios]) => ({
    instanceId,
    accountPortfolios,
  }));
}

export function buildPortfolioCollectionEntries(config: AppConfig): PortfolioCollectionTabEntry[] {
  const manualEntries: PortfolioCollectionTabEntry[] = config.portfolios
    .filter((portfolio) => !portfolio.brokerInstanceId || !portfolio.brokerAccountId)
    .map((portfolio) => ({
      id: portfolio.id,
      name: portfolio.name,
      kind: "portfolio",
    }));

  const brokerEntries: PortfolioCollectionTabEntry[] = [];
  for (const { instanceId, accountPortfolios } of groupBrokerPortfoliosByInstance(config)) {
    if (accountPortfolios.length >= 2) {
      const instance = getBrokerInstance(config.brokerInstances, instanceId);
      brokerEntries.push({
        id: buildBrokerCombinedPortfolioId(instanceId),
        name: instance?.label ?? instanceId,
        kind: "portfolio",
      });
    }
    for (const portfolio of accountPortfolios) {
      brokerEntries.push({
        id: portfolio.id,
        name: portfolio.name,
        kind: "portfolio",
      });
    }
  }

  return [...manualEntries, ...brokerEntries];
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
