import type { AppConfig } from "../../../types/config";
import type { Portfolio } from "../../../types/ticker";
import { isPortfolioCollectionId, resolvePortfolioCollection } from "../../../utils/broker-collections";

export function resolveCollectionId(
  config: AppConfig,
  collectionId: string | null | undefined,
): string | null {
  if (!collectionId) return null;
  return isPortfolioCollectionId(config, collectionId) ? collectionId : null;
}

export function resolveTemplatePortfolioId(
  config: AppConfig,
  activeCollectionId: string | null,
): string | null {
  return resolveCollectionId(config, activeCollectionId) ?? config.portfolios[0]?.id ?? null;
}

export function resolveActivePortfolio(
  config: AppConfig,
  portfolioId: string | null | undefined,
): Portfolio | null {
  if (!portfolioId) return null;
  return resolvePortfolioCollection(config, portfolioId);
}
