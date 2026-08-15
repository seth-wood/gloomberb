import { describe, expect, test } from "bun:test";
import type { TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import { createDefaultConfig } from "../../../types/config";
import { buildBrokerCombinedPortfolioId } from "../../../utils/broker-collections";
import { getPortfolioPositionValue, resolveActivePortfolioId } from "./portfolio";

function makeTicker(): TickerRecord {
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple",
      portfolios: ["broker:schwab-main:HASH1", "broker:schwab-main:HASH2"],
      watchlists: [],
      positions: [
        {
          portfolio: "broker:schwab-main:HASH1",
          shares: 10,
          avgCost: 100,
          currency: "USD",
          broker: "schwab",
          brokerInstanceId: "schwab-main",
          brokerAccountId: "HASH1",
        },
        {
          portfolio: "broker:schwab-main:HASH2",
          shares: 5,
          avgCost: 100,
          currency: "USD",
          broker: "schwab",
          brokerInstanceId: "schwab-main",
          brokerAccountId: "HASH2",
        },
      ],
      custom: {},
      tags: [],
    },
  };
}

const financials: TickerFinancials = {
  annualStatements: [],
  quarterlyStatements: [],
  priceHistory: [],
  quote: {
    symbol: "AAPL",
    price: 125,
    currency: "USD",
    change: 5,
    changePercent: 4.17,
    previousClose: 120,
    lastUpdated: Date.now(),
    marketState: "REGULAR",
  },
};

describe("getPortfolioPositionValue", () => {
  test("aggregates position value across combined broker portfolio ids", () => {
    const combinedValue = getPortfolioPositionValue({
      ticker: makeTicker(),
      financials,
      activePortfolioIds: ["broker:schwab-main:HASH1", "broker:schwab-main:HASH2"],
      baseCurrency: "USD",
      exchangeRates: new Map(),
    });
    const singleAccountValue = getPortfolioPositionValue({
      ticker: makeTicker(),
      financials,
      activePortfolioIds: ["broker:schwab-main:HASH1"],
      baseCurrency: "USD",
      exchangeRates: new Map(),
    });

    expect(combinedValue).toBe(1875);
    expect(singleAccountValue).toBe(1250);
    expect(combinedValue).toBeGreaterThan(singleAccountValue);
  });
});

describe("resolveActivePortfolioId", () => {
  test("accepts combined broker collection ids from the focused collection", () => {
    const config = createDefaultConfig("/tmp/kelly-combined-portfolio");
    config.brokerInstances = [{
      id: "schwab-main",
      brokerType: "schwab",
      label: "Schwab",
      config: {},
    }];
    config.portfolios.push(
      {
        id: "broker:schwab-main:HASH1",
        name: "****1111",
        currency: "USD",
        brokerId: "schwab",
        brokerInstanceId: "schwab-main",
        brokerAccountId: "HASH1",
      },
      {
        id: "broker:schwab-main:HASH2",
        name: "****2222",
        currency: "USD",
        brokerId: "schwab",
        brokerInstanceId: "schwab-main",
        brokerAccountId: "HASH2",
      },
    );
    const combinedId = buildBrokerCombinedPortfolioId("schwab-main");

    expect(resolveActivePortfolioId({
      requestedPortfolioId: null,
      activeCollectionId: combinedId,
      symbol: "AAPL",
      ticker: null,
      config,
    })).toBe(combinedId);
    expect(resolveActivePortfolioId({
      requestedPortfolioId: combinedId,
      activeCollectionId: null,
      symbol: "AAPL",
      ticker: null,
      config,
    })).toBe(combinedId);
  });
});
