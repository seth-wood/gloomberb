import type { TickerRecord } from "../types/ticker";

const US_EQUITY_EXCHANGES = new Set([
  "AMEX",
  "ARCA",
  "BATS",
  "BYX",
  "IEX",
  "NASDAQ",
  "NMS",
  "NYSE",
  "NYSEARCA",
  "OTC",
  "PINK",
]);

/** One-letter suffixes that are exchange codes, not US share classes. */
const FOREIGN_ONE_LETTER_SUFFIXES = new Set(["L", "T", "F", "V"]);
const SHARE_CLASS_TICKER = /^([A-Z0-9]{1,5})[.-]([A-Z])$/;

function normalize(value?: string): string {
  return (value ?? "").trim().toUpperCase();
}

export function isUsExchange(value?: string): boolean {
  return US_EQUITY_EXCHANGES.has(normalize(value));
}

function isEquityType(value?: string): boolean {
  const normalized = normalize(value);
  return normalized.length === 0 || normalized === "STK" || normalized === "EQUITY";
}

export function isUsEquityTicker(ticker: TickerRecord | null | undefined): boolean {
  if (!ticker) return false;

  const primaryContract = ticker.metadata.broker_contracts?.[0];
  const type = primaryContract?.secType ?? ticker.metadata.assetCategory;
  const currency = normalize(primaryContract?.currency ?? ticker.metadata.currency);
  const exchangeCandidates = [
    primaryContract?.primaryExchange,
    primaryContract?.exchange,
    ticker.metadata.exchange,
  ];

  return isEquityType(type)
    && currency === "USD"
    && exchangeCandidates.some((exchange) => isUsExchange(exchange));
}

/** `BRK.B`, `BRK-B`, and `BRKB` are the same US share class. */
export function usShareClassTickerAliases(ticker: string): string[] {
  const normalized = normalize(ticker);
  if (!normalized) return [];
  const aliases = new Set<string>([normalized]);
  const match = normalized.match(SHARE_CLASS_TICKER);
  if (!match) return [...aliases];
  const [, base, shareClass] = match;
  aliases.add(`${base}.${shareClass}`);
  aliases.add(`${base}-${shareClass}`);
  aliases.add(`${base}${shareClass}`);
  return [...aliases];
}

export function isUsShareClassTicker(ticker: string, exchange = ""): boolean {
  const normalized = normalize(ticker);
  const match = normalized.match(SHARE_CLASS_TICKER);
  if (!match) return false;
  if (exchange && !isUsExchange(exchange)) return false;
  if (FOREIGN_ONE_LETTER_SUFFIXES.has(match[2]!) && !isUsExchange(exchange)) return false;
  return true;
}
