import { describe, expect, test } from "bun:test";
import { mergeBrokerAccounts } from "./merge-broker-accounts";

describe("mergeBrokerAccounts", () => {
  test("sums account metrics and cash balances across accounts", () => {
    const merged = mergeBrokerAccounts([
      {
        accountId: "HASH1",
        name: "****1111",
        currency: "USD",
        netLiquidation: 10000,
        totalCashValue: 1000,
        buyingPower: 5000,
        cashBalances: [{ currency: "USD", quantity: 1000 }],
      },
      {
        accountId: "HASH2",
        name: "****2222",
        currency: "USD",
        netLiquidation: 20000,
        totalCashValue: 2000,
        buyingPower: 8000,
        cashBalances: [{ currency: "USD", quantity: 2000 }],
      },
    ]);

    expect(merged?.netLiquidation).toBe(30000);
    expect(merged?.totalCashValue).toBe(3000);
    expect(merged?.buyingPower).toBe(13000);
    expect(merged?.cashBalances).toEqual([
      expect.objectContaining({ currency: "USD", quantity: 3000 }),
    ]);
  });
});
