import type { AppConfig } from "../../../types/config";
import type { Portfolio } from "../../../types/ticker";
import { isPortfolioCollectionId, resolvePortfolioCollection } from "../../../utils/broker-collections";

export function resolvePortfolioId(
  config: AppConfig,
  portfolioId: string | null | undefined,
): string | null {
  if (!portfolioId) return null;
  return isPortfolioCollectionId(config, portfolioId) ? portfolioId : null;
}

export function resolveTemplatePortfolioId(
  config: AppConfig,
  activeCollectionId: string | null,
): string | null {
  return resolvePortfolioId(config, activeCollectionId) ?? config.portfolios[0]?.id ?? null;
}

export function resolveActivePortfolio(
  config: AppConfig,
  portfolioId: string | null | undefined,
): Portfolio | null {
  if (!portfolioId) return null;
  return resolvePortfolioCollection(config, portfolioId);
}
