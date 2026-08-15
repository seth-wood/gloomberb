import { describe, expect, test } from "bun:test";
import { mapSchwabPortfolioSnapshot } from "./map-accounts";
import type { SchwabAccountPayload } from "./types";

describe("mapSchwabPortfolioSnapshot", () => {
  test("maps equity and short positions with balances", () => {
    const accounts: SchwabAccountPayload[] = [
      {
        securitiesAccount: {
          accountNumber: "HASH123",
          type: "MARGIN",
          currentBalances: {
            cashBalance: 5000,
            liquidationValue: 25000,
            buyingPower: 10000,
            longMarketValue: 20000,
            shortMarketValue: -1000,
          },
          positions: [
            {
              longQuantity: 10,
              shortQuantity: 0,
              averagePrice: 150,
              marketValue: 1800,
              longOpenProfitLoss: 300,
              instrument: {
                assetType: "EQUITY",
                symbol: "AAPL",
                description: "APPLE INC",
              },
            },
            {
              longQuantity: 0,
              shortQuantity: 5,
              averagePrice: 20,
              marketValue: -110,
              shortOpenProfitLoss: -50,
              instrument: {
                assetType: "EQUITY",
                symbol: "XYZ",
                description: "XYZ CORP",
              },
            },
            {
              longQuantity: 0,
              shortQuantity: 0,
              averagePrice: 1,
              marketValue: 0,
              instrument: {
                assetType: "EQUITY",
                symbol: "EMPTY",
              },
            },
          ],
        },
      },
    ];

    const snapshot = mapSchwabPortfolioSnapshot(accounts, [
      { accountNumber: "****1234", hashValue: "HASH123" },
    ], 1_700_000_000_000);

    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.accounts[0]).toMatchObject({
      accountId: "HASH123",
      name: "****1234",
      netLiquidation: 25000,
      totalCashValue: 5000,
      buyingPower: 10000,
      currency: "USD",
    });

    expect(snapshot.positions).toHaveLength(2);
    expect(snapshot.positions[0]).toMatchObject({
      ticker: "AAPL",
      shares: 10,
      side: "long",
      avgCost: 150,
      marketValue: 1800,
      unrealizedPnl: 300,
      accountId: "HASH123",
      brokerContract: {
        brokerId: "schwab",
        symbol: "AAPL",
        secType: "EQUITY",
      },
    });
    expect(snapshot.positions[1]).toMatchObject({
      ticker: "XYZ",
      shares: 5,
      side: "short",
      marketValue: -110,
      unrealizedPnl: -50,
      markPrice: 22,
    });
  });

  test("drops flat positions when long and short quantities match", () => {
    const snapshot = mapSchwabPortfolioSnapshot([
      {
        securitiesAccount: {
          accountNumber: "HASH123",
          positions: [
            {
              longQuantity: 10,
              shortQuantity: 10,
              averagePrice: 50,
              marketValue: 0,
              instrument: {
                assetType: "EQUITY",
                symbol: "FLAT",
              },
            },
          ],
        },
      },
    ], [{ accountNumber: "****1234", hashValue: "HASH123" }]);

    expect(snapshot.positions).toHaveLength(0);
  });
});
