import { isUsExchange, isUsShareClassTicker } from "../../utils/sec";

export function isWisesheetsEligibleSymbol(ticker: string, exchange = ""): boolean {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return false;
  const exchangeNorm = exchange.trim().toUpperCase();
  if (exchangeNorm && !isUsExchange(exchangeNorm)) return false;
  if (isUsShareClassTicker(normalized, exchange)) return true;
  return isUsExchange(exchangeNorm);
}
