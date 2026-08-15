import type { BrokerPosition } from "../../types/broker";
import type { BrokerAccount } from "../../types/trading";
import type {
  SchwabAccountNumber,
  SchwabAccountPayload,
  SchwabPosition,
  SchwabSecuritiesAccount,
} from "./types";

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function accountDisplayName(
  account: SchwabSecuritiesAccount,
  accountNumbers: SchwabAccountNumber[],
): string {
  const hash = account.accountNumber ?? "";
  const match = accountNumbers.find((entry) => entry.hashValue === hash);
  if (match?.accountNumber) return match.accountNumber;
  if (account.type) return account.type;
  return hash || "Schwab Account";
}

function unrealizedPnl(position: SchwabPosition, netQuantity: number): number | undefined {
  const longPnl = asNumber(position.longOpenProfitLoss);
  const shortPnl = asNumber(position.shortOpenProfitLoss);
  if (netQuantity < 0) return shortPnl ?? longPnl;
  if (netQuantity > 0) return longPnl ?? shortPnl;
  return longPnl ?? shortPnl;
}

function mapPosition(accountId: string, position: SchwabPosition): BrokerPosition | null {
  const symbol = position.instrument?.symbol?.trim();
  const longQuantity = asNumber(position.longQuantity) ?? 0;
  const shortQuantity = asNumber(position.shortQuantity) ?? 0;
  const netQuantity = longQuantity - shortQuantity;
  const shares = Math.abs(netQuantity);
  if (!symbol || shares === 0) return null;

  const marketValue = asNumber(position.marketValue);
  const avgCost = asNumber(position.averagePrice);
  const side = netQuantity < 0
    ? "short"
    : netQuantity > 0
      ? "long"
      : undefined;

  return {
    ticker: symbol,
    exchange: "",
    shares,
    avgCost,
    currency: "USD",
    accountId,
    name: position.instrument?.description || undefined,
    assetCategory: position.instrument?.assetType || position.instrument?.type || undefined,
    markPrice: marketValue != null && shares > 0 ? Math.abs(marketValue) / shares : undefined,
    marketValue,
    unrealizedPnl: unrealizedPnl(position, netQuantity),
    side,
    brokerContract: {
      brokerId: "schwab",
      symbol,
      secType: position.instrument?.assetType || position.instrument?.type,
      currency: "USD",
    },
  };
}

export function mapSchwabAccount(
  payload: SchwabAccountPayload,
  accountNumbers: SchwabAccountNumber[],
  updatedAt: number,
): { account: BrokerAccount; positions: BrokerPosition[] } | null {
  const securitiesAccount = payload.securitiesAccount;
  if (!securitiesAccount?.accountNumber) return null;

  const accountId = securitiesAccount.accountNumber;
  const balances = securitiesAccount.currentBalances;
  const positions = (securitiesAccount.positions ?? [])
    .map((position) => mapPosition(accountId, position))
    .filter((position): position is BrokerPosition => position != null);

  return {
    account: {
      accountId,
      name: accountDisplayName(securitiesAccount, accountNumbers),
      currency: "USD",
      updatedAt,
      netLiquidation: asNumber(balances?.liquidationValue) ?? asNumber(balances?.equity),
      grossPositionValue: (asNumber(balances?.longMarketValue) ?? 0) + Math.abs(asNumber(balances?.shortMarketValue) ?? 0),
      totalCashValue: asNumber(balances?.cashBalance),
      buyingPower: asNumber(balances?.buyingPower),
      availableFunds: asNumber(balances?.availableFunds),
      cashBalances: typeof balances?.cashBalance === "number"
        ? [{ currency: "USD", quantity: balances.cashBalance }]
        : undefined,
    },
    positions,
  };
}

export function mapSchwabPortfolioSnapshot(
  accounts: SchwabAccountPayload[],
  accountNumbers: SchwabAccountNumber[],
  updatedAt = Date.now(),
): { accounts: BrokerAccount[]; positions: BrokerPosition[] } {
  const mapped = accounts
    .map((payload) => mapSchwabAccount(payload, accountNumbers, updatedAt))
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);

  return {
    accounts: mapped.map((entry) => entry.account),
    positions: mapped.flatMap((entry) => entry.positions),
  };
}
