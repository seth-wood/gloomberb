import type { AssetDataProvider, MarketDataRequestContext, SearchRequestContext } from "../../types/data-provider";
import type { InstrumentSearchResult } from "../../types/instrument";
import type { PricePoint, Quote, TickerFinancials } from "../../types/financials";
import type { TimeRange } from "../../time-series/range";
import { createProviderMiss } from "../provider-errors";
import { WisesheetsClient } from "./client";
import { WisesheetsCredentialStore } from "./credentials";

export class WisesheetsProvider implements AssetDataProvider {
  readonly id = "wisesheets";
  readonly name = "Wisesheets";
  readonly priority = 200;

  private readonly client: WisesheetsClient;

  constructor(credentialStore: WisesheetsCredentialStore) {
    this.client = new WisesheetsClient({ credentialStore });
  }

  getCredentialStore(): WisesheetsCredentialStore {
    return this.client.credentialStore;
  }

  async canProvide(ticker: string, exchange?: string, _context?: MarketDataRequestContext): Promise<boolean> {
    return await this.client.canProvide(ticker, exchange ?? "");
  }

  async getTickerFinancials(
    ticker: string,
    exchange = "",
    _context?: MarketDataRequestContext,
  ): Promise<TickerFinancials> {
    return await this.client.getTickerFinancials(ticker, exchange);
  }

  async getQuote(_ticker: string, _exchange = "", _context?: MarketDataRequestContext): Promise<Quote> {
    throw createProviderMiss("Wisesheets does not provide quotes");
  }

  async getExchangeRate(_fromCurrency: string): Promise<number> {
    throw createProviderMiss("Wisesheets does not provide exchange rates");
  }

  async search(_query: string, _context?: SearchRequestContext): Promise<InstrumentSearchResult[]> {
    throw createProviderMiss("Wisesheets does not provide search");
  }

  async getPriceHistory(
    _ticker: string,
    _exchange: string,
    _range: TimeRange,
    _context?: MarketDataRequestContext,
  ): Promise<PricePoint[]> {
    throw createProviderMiss("Wisesheets does not provide price history");
  }

  async getArticleSummary(_url: string): Promise<string | null> {
    throw createProviderMiss("Wisesheets does not provide article summaries");
  }
}

export function createWisesheetsProvider(dataDir: string): WisesheetsProvider {
  return new WisesheetsProvider(new WisesheetsCredentialStore(dataDir));
}
