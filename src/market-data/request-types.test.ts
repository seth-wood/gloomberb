import { describe, expect, test } from "bun:test";
import type { TickerRecord } from "../types/ticker";
import { instrumentFromTicker, quoteSubscriptionTargetFromTicker } from "./request-types";

function makeTicker(overrides: Partial<TickerRecord["metadata"]> = {}): TickerRecord {
  return {
    metadata: {
      ticker: "AAPL",
      exchange: "NASDAQ",
      currency: "USD",
      name: "Apple",
      broker_contracts: [],
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      ...overrides,
    },
  };
}

describe("quoteSubscriptionTargetFromTicker", () => {
  test("selects the broker contract that belongs to the active portfolio", () => {
    const ticker = makeTicker({
      ticker: "VICR",
      name: "Vicor",
      portfolios: [
        "broker:ibkr-live:DU111",
        "broker:ibkr-coldstart:DU222",
      ],
      positions: [
        {
          portfolio: "broker:ibkr-live:DU111",
          shares: 170,
          avgCost: 198,
          currency: "USD",
          broker: "ibkr",
          brokerInstanceId: "ibkr-live",
          brokerContractId: 275759,
        },
        {
          portfolio: "broker:ibkr-coldstart:DU222",
          shares: 350,
          avgCost: 290,
          currency: "USD",
          broker: "ibkr",
          brokerInstanceId: "ibkr-coldstart",
          brokerContractId: 275759,
        },
      ],
      broker_contracts: [
        {
          brokerId: "ibkr",
          brokerInstanceId: "ibkr-live",
          conId: 275759,
          symbol: "VICR",
          localSymbol: "VICR",
          exchange: "NASDAQ",
          currency: "USD",
          secType: "STK",
        },
        {
          brokerId: "ibkr",
          brokerInstanceId: "ibkr-coldstart",
          conId: 275759,
          symbol: "VICR",
          localSymbol: "VICR",
          exchange: "NASDAQ",
          currency: "USD",
          secType: "STK",
        },
      ],
    });

    expect(instrumentFromTicker(ticker, "VICR", { portfolioId: "broker:ibkr-coldstart:DU222" })).toMatchObject({
      symbol: "VICR",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-coldstart",
      instrument: ticker.metadata.broker_contracts?.[1],
    });
  });

  test("scopes broker contracts to member portfolios on combined tabs", () => {
    const ticker = makeTicker({
      ticker: "VICR",
      portfolios: [
        "broker:ibkr-live:DU111",
        "broker:ibkr-coldstart:DU222",
      ],
      positions: [
        {
          portfolio: "broker:ibkr-live:DU111",
          shares: 170,
          avgCost: 198,
          currency: "USD",
          broker: "ibkr",
          brokerInstanceId: "ibkr-live",
          brokerContractId: 275759,
        },
        {
          portfolio: "broker:ibkr-coldstart:DU222",
          shares: 350,
          avgCost: 290,
          currency: "USD",
          broker: "ibkr",
          brokerInstanceId: "ibkr-coldstart",
          brokerContractId: 275759,
        },
      ],
      broker_contracts: [
        {
          brokerId: "ibkr",
          brokerInstanceId: "ibkr-live",
          conId: 275759,
          symbol: "VICR",
          localSymbol: "VICR",
          exchange: "NASDAQ",
          currency: "USD",
          secType: "STK",
        },
        {
          brokerId: "ibkr",
          brokerInstanceId: "ibkr-coldstart",
          conId: 275759,
          symbol: "VICR",
          localSymbol: "VICR",
          exchange: "NASDAQ",
          currency: "USD",
          secType: "STK",
        },
      ],
    });

    expect(instrumentFromTicker(ticker, "VICR", {
      portfolioIds: ["broker:ibkr-coldstart:DU222"],
    })).toMatchObject({
      brokerInstanceId: "ibkr-coldstart",
      instrument: ticker.metadata.broker_contracts?.[1],
    });
    expect(instrumentFromTicker(ticker, "VICR", {
      portfolioId: "broker:combined:ignored",
    })).toMatchObject({
      brokerInstanceId: "ibkr-live",
      instrument: ticker.metadata.broker_contracts?.[0],
    });
  });

  test("preserves broker contract context for streaming targets", () => {
    const ticker = makeTicker({
      broker_contracts: [{
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-live",
        conId: 265598,
        symbol: "AAPL",
        localSymbol: "AAPL",
        exchange: "NASDAQ",
        currency: "USD",
        secType: "STK",
      }],
    });

    expect(quoteSubscriptionTargetFromTicker(ticker, ticker.metadata.ticker)).toEqual({
      symbol: "AAPL",
      exchange: "NASDAQ",
      route: "auto",
      context: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-live",
        instrument: ticker.metadata.broker_contracts?.[0],
      },
    });
  });

});
