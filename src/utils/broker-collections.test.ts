import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../types/config";
import {
  buildBrokerCombinedPortfolioId,
  buildSyntheticCombinedPortfolio,
  buildPortfolioCollectionEntries,
  isBrokerCombinedPortfolioId,
  resolveCollectionPortfolioIds,
} from "./broker-collections";

describe("broker-collections", () => {
  test("builds a combined portfolio id and resolves member portfolios", () => {
    const config = createDefaultConfig("/tmp/broker-collections");
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
    expect(isBrokerCombinedPortfolioId(combinedId)).toBe(true);
    expect(resolveCollectionPortfolioIds(config, combinedId)).toEqual([
      "broker:schwab-main:HASH1",
      "broker:schwab-main:HASH2",
    ]);

    const synthetic = buildSyntheticCombinedPortfolio(config, combinedId);
    expect(synthetic).toMatchObject({
      id: combinedId,
      name: "Schwab",
      brokerInstanceId: "schwab-main",
    });
  });

  test("injects a combined tab before per-account broker tabs when an instance has 2+ accounts", () => {
    const config = createDefaultConfig("/tmp/broker-collections-tabs");
    config.brokerInstances = [{
      id: "ibkr-main",
      brokerType: "ibkr",
      label: "IBKR",
      config: {},
    }];
    config.portfolios.push(
      {
        id: "broker:ibkr-main:DU111",
        name: "DU111",
        currency: "USD",
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-main",
        brokerAccountId: "DU111",
      },
      {
        id: "broker:ibkr-main:DU222",
        name: "DU222",
        currency: "USD",
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-main",
        brokerAccountId: "DU222",
      },
    );

    const entries = buildPortfolioCollectionEntries(config);
    expect(entries.map((entry) => entry.id)).toEqual([
      "main",
      buildBrokerCombinedPortfolioId("ibkr-main"),
      "broker:ibkr-main:DU111",
      "broker:ibkr-main:DU222",
    ]);
    expect(entries[1]?.name).toBe("IBKR");
  });
});
