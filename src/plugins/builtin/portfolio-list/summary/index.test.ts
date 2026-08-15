import { describe, expect, test } from "bun:test";
import { resolvePortfolioAccountState } from "./index";

describe("resolvePortfolioAccountState", () => {
  test("does not reuse a single cached broker account for a different explicit portfolio account", () => {
    const accountState = resolvePortfolioAccountState({
      id: "broker:ibkr-flex:U12345",
      name: "U12345",
      currency: "USD",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-flex",
      brokerAccountId: "U12345",
    }, {
      config: {
        brokerInstances: [{
          id: "ibkr-flex",
          label: "IBKR Flex",
          brokerType: "ibkr",
          enabled: true,
          config: {},
        }],
      } as any,
      brokerAccounts: {
        "ibkr-flex": [{
          accountId: "alias-account",
          name: "alias-account",
          currency: "USD",
          source: "flex",
          updatedAt: new Date("2026-05-15T05:02:17.000Z").getTime(),
        }],
      },
    }, {
      status: null,
      accounts: [],
    });

    expect(accountState).toBeNull();
  });

  test("still uses the only cached broker account for legacy broker portfolios without an account id", () => {
    const accountState = resolvePortfolioAccountState({
      id: "broker:ibkr-flex:default",
      name: "IBKR Flex",
      currency: "USD",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-flex",
    }, {
      config: {
        brokerInstances: [{
          id: "ibkr-flex",
          label: "IBKR Flex",
          brokerType: "ibkr",
          enabled: true,
          config: {},
        }],
      } as any,
      brokerAccounts: {
        "ibkr-gateway": [{
          accountId: "U12345",
          name: "U12345",
          currency: "USD",
          source: "gateway",
          updatedAt: new Date("2026-05-14T05:02:17.000Z").getTime(),
          netLiquidation: 100000,
        }],
        "ibkr-flex": [{
          accountId: "U12345",
          name: "U12345",
          currency: "USD",
          source: "flex",
        }],
      },
    }, {
      status: null,
      accounts: [],
    });

    expect(accountState?.account.accountId).toBe("U12345");
  });

  test("uses exact cached account data from another profile for the same broker account", () => {
    const accountState = resolvePortfolioAccountState({
      id: "broker:ibkr-gateway:U12345",
      name: "U12345",
      currency: "USD",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-gateway",
      brokerAccountId: "U12345",
    }, {
      config: {
        brokerInstances: [
          {
            id: "ibkr-gateway",
            label: "IBKR Gateway",
            brokerType: "ibkr",
            enabled: true,
            config: {},
          },
          {
            id: "ibkr-flex",
            label: "IBKR Flex",
            brokerType: "ibkr",
            enabled: true,
            config: {},
          },
        ],
      } as any,
      brokerAccounts: {
        "ibkr-flex": [{
          accountId: "U12345",
          name: "U12345",
          currency: "USD",
          source: "flex",
          updatedAt: new Date("2026-05-15T05:02:17.000Z").getTime(),
          asOfDate: "2026-05-14",
          netLiquidation: 123456,
        }],
      },
    }, {
      status: null,
      accounts: [],
    });

    expect(accountState?.account.netLiquidation).toBe(123456);
    expect(accountState?.sourceLabel).toBe("Flex May 14");
  });

  test("uses the account as-of date when choosing the freshest cached Flex account", () => {
    const accountState = resolvePortfolioAccountState({
      id: "broker:ibkr-old:U12345",
      name: "U12345",
      currency: "USD",
      brokerId: "ibkr",
      brokerInstanceId: "ibkr-old",
      brokerAccountId: "U12345",
    }, {
      config: {
        brokerInstances: [
          {
            id: "ibkr-old",
            label: "IBKR Old",
            brokerType: "ibkr",
            enabled: true,
            config: {},
          },
          {
            id: "ibkr-new",
            label: "IBKR New",
            brokerType: "ibkr",
            enabled: true,
            config: {},
          },
        ],
      } as any,
      brokerAccounts: {
        "ibkr-old": [{
          accountId: "U12345",
          name: "U12345",
          currency: "USD",
          source: "flex",
          updatedAt: new Date("2026-06-16T10:00:00.000Z").getTime(),
          asOfDate: "2026-06-15",
          netLiquidation: 100000,
        }],
        "ibkr-new": [{
          accountId: "U12345",
          name: "U12345",
          currency: "USD",
          source: "flex",
          updatedAt: new Date("2026-06-15T10:00:00.000Z").getTime(),
          asOfDate: "2026-06-16",
          netLiquidation: 200000,
        }],
      },
    }, {
      status: null,
      accounts: [],
    });

    expect(accountState?.account.netLiquidation).toBe(200000);
    expect(accountState?.sourceLabel).toBe("Flex Jun 16");
  });

  test("sums cached accounts for a combined broker portfolio tab", () => {
    const accountState = resolvePortfolioAccountState({
      id: "broker:schwab-main:combined",
      name: "Schwab",
      currency: "USD",
      brokerId: "schwab",
      brokerInstanceId: "schwab-main",
    }, {
      config: {
        brokerInstances: [{
          id: "schwab-main",
          label: "Schwab",
          brokerType: "schwab",
          enabled: true,
          config: {},
        }],
        portfolios: [
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
        ],
      } as any,
      brokerAccounts: {
        "schwab-main": [
          {
            accountId: "HASH1",
            name: "****1111",
            currency: "USD",
            netLiquidation: 10000,
            totalCashValue: 1000,
            buyingPower: 5000,
          },
          {
            accountId: "HASH2",
            name: "****2222",
            currency: "USD",
            netLiquidation: 20000,
            totalCashValue: 2000,
            buyingPower: 8000,
          },
        ],
      },
    }, {
      status: null,
      accounts: [],
    });

    expect(accountState?.account.netLiquidation).toBe(30000);
    expect(accountState?.account.totalCashValue).toBe(3000);
    expect(accountState?.account.buyingPower).toBe(13000);
  });

});
