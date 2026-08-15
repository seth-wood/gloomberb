import type { AppConfig } from "../../../types/config";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { getActiveQuoteDisplay } from "../../../market-data/market/status";
import { convertCurrency } from "../../../utils/format";
import { getCollectionTypeFromConfig } from "../portfolio-list/pane/data";
import { getPortfolioPositionMetrics, resolveBrokerFallbackMarketValue } from "../portfolio-list/position-metrics";

export function getPortfolioPositionValue({
  ticker,
  financials,
  activePortfolioIds,
  baseCurrency,
  exchangeRates,
}: {
  ticker: TickerRecord | null;
  financials: TickerFinancials | null;
  activePortfolioIds?: readonly string[];
  baseCurrency: string;
  exchangeRates: Map<string, number>;
}): number {
  if (!ticker) return 0;
  const quote = financials?.quote;
  const activeQuote = getActiveQuoteDisplay(quote);
  const quoteCurrency = quote?.currency || ticker.metadata.currency || baseCurrency;
  const metrics = getPortfolioPositionMetrics(ticker, activePortfolioIds, quoteCurrency);

  if (activeQuote && metrics.totalPriceUnits !== 0) {
    return convertCurrency(Math.abs(metrics.totalPriceUnits) * activeQuote.price, quoteCurrency, baseCurrency, exchangeRates);
  }

  const brokerFallback = resolveBrokerFallbackMarketValue(metrics);
  const positionCurrency = metrics.positionCurrency || quoteCurrency;
  return convertCurrency(Math.abs(brokerFallback ?? metrics.totalCost), positionCurrency, baseCurrency, exchangeRates);
}

export function resolveActivePortfolioId({
  requestedPortfolioId,
  activeCollectionId,
  symbol,
  ticker,
  config,
}: {
  requestedPortfolioId?: string | null;
  activeCollectionId: string | null;
  symbol: string | null;
  ticker: TickerRecord | null;
  config: AppConfig;
}): string | null {
  if (requestedPortfolioId && config.portfolios.some((portfolio) => portfolio.id === requestedPortfolioId)) {
    return requestedPortfolioId;
  }
  if (activeCollectionId && getCollectionTypeFromConfig(config, activeCollectionId) === "portfolio") {
    return activeCollectionId;
  }
  if (ticker) {
    const positionPortfolio = ticker.metadata.positions.find((position) => position.portfolio)?.portfolio;
    if (positionPortfolio) return positionPortfolio;
    if (ticker.metadata.portfolios[0]) return ticker.metadata.portfolios[0];
  }
  return symbol ? config.portfolios[0]?.id ?? null : null;
}
