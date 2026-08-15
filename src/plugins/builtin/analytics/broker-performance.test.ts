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
});
