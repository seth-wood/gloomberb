import type { AppConfig, BrokerInstanceConfig } from "../../../types/config";
import type { Portfolio } from "../../../types/ticker";
import { isPortfolioCollectionId } from "../../../utils/broker-collections";

export function resolveCollectionId(
  config: AppConfig,
  collectionId: string | null | undefined,
): string | null {
  if (!collectionId) return null;
  return isPortfolioCollectionId(config, collectionId) ? collectionId : null;
}

/** Broker account ids look like "U13268153" or "DU1234567": a letter prefix then digits. */
const RAW_ACCOUNT_ID = /^[A-Z]{1,2}\d{5,}$/;

/**
 * A portfolio auto-created from a broker sync is named after the raw account id,
 * which is meaningless on its own, so prefix it with the broker instance label.
 */
export function describePortfolioTab(
  portfolio: Portfolio,
  brokerInstances: BrokerInstanceConfig[] | undefined,
): string {
  const name = portfolio.name.trim();
  if (!RAW_ACCOUNT_ID.test(name)) return portfolio.name;
  const instance = brokerInstances?.find((candidate) => candidate.id === portfolio.brokerInstanceId);
  const prefix = instance?.label?.trim() || instance?.brokerType?.toUpperCase();
  return prefix ? `${prefix} ${name}` : name;
}

export function resolveTemplatePortfolioId(
  config: AppConfig,
  activeCollectionId: string | null,
): string | null {
  return resolveCollectionId(config, activeCollectionId) ?? config.portfolios[0]?.id ?? null;
}
