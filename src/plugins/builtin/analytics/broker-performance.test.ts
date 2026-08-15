import { describe, expect, test } from "bun:test";
import { buildBrokerCombinedPortfolioId } from "../../../utils/broker-collections";
import { resolveBrokerAccountId } from "./broker-performance";

describe("resolveBrokerAccountId", () => {
  test("returns null for combined broker portfolio tabs", () => {
    expect(resolveBrokerAccountId({
      id: buildBrokerCombinedPortfolioId("schwab-main"),
      name: "Schwab",
      currency: "USD",
      brokerId: "schwab",
      brokerInstanceId: "schwab-main",
    })).toBeNull();
  });

  test("returns the broker account id for individual broker portfolios", () => {
    expect(resolveBrokerAccountId({
      id: "broker:ibkr-flex:DU12345",
      name: "Flex DU12345",
      currency: "USD",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-flex",
      brokerAccountId: "DU12345",
    })).toBe("DU12345");
  });
});
