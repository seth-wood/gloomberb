import type { AppConfig } from "../../../types/config";
import { isPortfolioCollectionId } from "../../../utils/broker-collections";

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
