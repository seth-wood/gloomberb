import type { BrokerAccount, BrokerCashBalance } from "../types/trading";

function sumFiniteNumbers(values: Array<number | undefined>): number | undefined {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return undefined;
  return finite.reduce((sum, value) => sum + value, 0);
}

export function mergeBrokerAccounts(accounts: BrokerAccount[]): BrokerAccount | null {
  if (accounts.length === 0) return null;

  const currency = accounts.find((account) => account.currency)?.currency;
  const cashByCurrency = new Map<string, BrokerCashBalance>();
  for (const account of accounts) {
    for (const balance of account.cashBalances ?? []) {
      const existing = cashByCurrency.get(balance.currency);
      cashByCurrency.set(balance.currency, {
        currency: balance.currency,
        quantity: (existing?.quantity ?? 0) + balance.quantity,
        baseValue: existing?.baseValue != null || balance.baseValue != null
          ? (existing?.baseValue ?? 0) + (balance.baseValue ?? 0)
          : undefined,
        baseCurrency: balance.baseCurrency ?? existing?.baseCurrency ?? currency,
      });
    }
  }

  const updatedAt = Math.max(...accounts.map((account) => account.updatedAt ?? 0));
  const hasFlexSource = accounts.some((account) => account.source === "flex");

  return {
    accountId: "combined",
    name: "Combined",
    currency,
    source: hasFlexSource ? "flex" : accounts[0]?.source,
    updatedAt,
    netLiquidation: sumFiniteNumbers(accounts.map((account) => account.netLiquidation)),
    grossPositionValue: sumFiniteNumbers(accounts.map((account) => account.grossPositionValue)),
    totalCashValue: sumFiniteNumbers(accounts.map((account) => account.totalCashValue)),
    settledCash: sumFiniteNumbers(accounts.map((account) => account.settledCash)),
    buyingPower: sumFiniteNumbers(accounts.map((account) => account.buyingPower)),
    availableFunds: sumFiniteNumbers(accounts.map((account) => account.availableFunds)),
    excessLiquidity: sumFiniteNumbers(accounts.map((account) => account.excessLiquidity)),
    initMarginReq: sumFiniteNumbers(accounts.map((account) => account.initMarginReq)),
    maintMarginReq: sumFiniteNumbers(accounts.map((account) => account.maintMarginReq)),
    dailyPnl: sumFiniteNumbers(accounts.map((account) => account.dailyPnl)),
    unrealizedPnl: sumFiniteNumbers(accounts.map((account) => account.unrealizedPnl)),
    realizedPnl: sumFiniteNumbers(accounts.map((account) => account.realizedPnl)),
    cashBalances: cashByCurrency.size > 0 ? [...cashByCurrency.values()] : undefined,
  };
}
