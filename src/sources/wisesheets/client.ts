import { httpFetch } from "../../utils/http-transport";
import { usShareClassTickerAliases } from "../../utils/sec";
import { createProviderMiss, ProviderMissError } from "../provider-errors";
import type { WisesheetsCredentialStore } from "./credentials";
import { isWisesheetsEligibleSymbol } from "./eligibility";
import {
  ANNUAL_METRICS,
  MAX_HISTORY_YEARS,
  QUARTERLY_METRICS,
} from "./metrics";
import {
  buildTickerFinancials,
  groupByTickerPeriod,
  mapCompanyProfile,
  mergePeriodLists,
  statementPeriodsFromPayload,
  type WisesheetsFinancialRow,
  type WisesheetsPeriodValues,
} from "./mappers";

const DEFAULT_BASE_URL = "https://api.wisesheets.io/v1";
const REQUEST_TIMEOUT_MS = 15_000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 4;
const PROVIDER_MISS_PATTERNS = [/data not found/i, /not found/i, /symbol.*missing or invalid/i];

export interface WisesheetsClientOptions {
  credentialStore: WisesheetsCredentialStore;
  baseUrl?: string;
  fetch?: typeof httpFetch;
}

function isProviderMissMessage(message: string): boolean {
  return PROVIDER_MISS_PATTERNS.some((pattern) => pattern.test(message));
}

function annualPeriod(years: number): string {
  const end = new Date().getFullYear();
  const depth = Math.min(years, MAX_HISTORY_YEARS);
  return `${end - depth + 1}..${end}`;
}

export class WisesheetsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof httpFetch;
  private historyYearsCache: number | null = null;

  constructor(private readonly options: WisesheetsClientOptions) {
    this.baseUrl = (options.baseUrl ?? process.env.WISESHEETS_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? httpFetch;
  }

  get credentialStore(): WisesheetsCredentialStore {
    return this.options.credentialStore;
  }

  async canProvide(ticker: string, exchange = ""): Promise<boolean> {
    if (!await this.credentialStore.hasApiKey()) return false;
    return isWisesheetsEligibleSymbol(ticker, exchange);
  }

  private async resolveApiKey(): Promise<string> {
    const apiKey = await this.credentialStore.resolveApiKey();
    if (!apiKey) throw createProviderMiss("Wisesheets API key is not configured");
    return apiKey;
  }

  private async requestJson(path: string, params: Record<string, string>): Promise<unknown> {
    const apiKey = await this.resolveApiKey();
    const query = new URLSearchParams(params);
    const url = `${this.baseUrl}${path}?${query.toString()}`;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
        continue;
      }

      if (response.status === 403) {
        const body = await response.text().catch(() => "");
        if (/POLICY_DENIED/i.test(body)) {
          throw createProviderMiss("Wisesheets request was denied by policy");
        }
      }

      if (response.status === 404 || response.status === 204) {
        throw createProviderMiss(`Wisesheets data not found for ${path}`);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const message = body || `Wisesheets request failed (${response.status})`;
        if (isProviderMissMessage(message)) throw createProviderMiss(message);
        throw new Error(message);
      }

      try {
        return await response.json();
      } catch (error) {
        throw createProviderMiss(`Wisesheets response was not JSON for ${path}`);
      }
    }

    throw createProviderMiss(`Wisesheets request failed after retries for ${path}`);
  }

  private unwrapData(payload: unknown, allowEmpty = false): unknown[] {
    if (!payload || typeof payload !== "object") throw createProviderMiss("Wisesheets response was empty");
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data)) throw createProviderMiss("Wisesheets response contained no data");
    if (data.length === 0) {
      if (allowEmpty) return [];
      throw createProviderMiss("Wisesheets returned no financial rows");
    }
    return data;
  }

  async getHistoryYears(): Promise<number> {
    if (this.historyYearsCache !== null) return this.historyYearsCache;
    try {
      const payload = await this.requestJson("/me/", {});
      const limits = (payload as { limits?: { historyYears?: number } }).limits;
      const years = limits?.historyYears;
      this.historyYearsCache = typeof years === "number" && Number.isFinite(years)
        ? Math.min(years, MAX_HISTORY_YEARS)
        : MAX_HISTORY_YEARS;
    } catch {
      this.historyYearsCache = MAX_HISTORY_YEARS;
    }
    return this.historyYearsCache;
  }

  private async fetchFinancials(
    ticker: string,
    metrics: string[],
    period: string,
    frequency: "annual" | "quarterly",
    options?: { allowEmpty?: boolean },
  ): Promise<WisesheetsPeriodValues[]> {
    const payload = await this.requestJson("/financials/", {
      tickers: ticker,
      metrics: metrics.join(","),
      period,
      frequency,
      layout: "long",
      include: "source",
    });
    const rows = this.unwrapData(payload, options?.allowEmpty) as WisesheetsFinancialRow[];
    if (rows.length === 0) return [];
    return this.periodsForTicker(rows, ticker);
  }

  private periodsForTicker(rows: WisesheetsFinancialRow[], ticker: string): WisesheetsPeriodValues[] {
    const grouped = groupByTickerPeriod(rows);
    const wanted = new Set(usShareClassTickerAliases(ticker));
    const match = Object.keys(grouped).find((key) => wanted.has(key.toUpperCase()));
    if (!match) {
      throw createProviderMiss(`Wisesheets returned no financial rows for ${ticker}`);
    }
    const byPeriod = grouped[match] ?? {};
    return Object.values(byPeriod).sort((left, right) => right.period_end.localeCompare(left.period_end));
  }

  private async fetchStatements(
    ticker: string,
    period: string,
    frequency: "annual" | "quarterly",
  ): Promise<WisesheetsPeriodValues[]> {
    try {
      const payload = await this.requestJson(`/statements/${ticker}`, {
        frequency,
        period,
        include: "source",
      });
      return statementPeriodsFromPayload(payload);
    } catch {
      return [];
    }
  }

  private async fetchCompanyProfile(ticker: string): Promise<ReturnType<typeof mapCompanyProfile>> {
    try {
      const payload = await this.requestJson(`/companies/${ticker}`, {});
      const data = (payload as { data?: Record<string, unknown> }).data;
      return mapCompanyProfile(data);
    } catch {
      return undefined;
    }
  }

  async getTickerFinancials(ticker: string, exchange = ""): Promise<ReturnType<typeof buildTickerFinancials>> {
    if (!await this.canProvide(ticker, exchange)) {
      throw createProviderMiss(`Wisesheets cannot provide financials for ${ticker}`);
    }

    const historyYears = await this.getHistoryYears();
    const annualRange = annualPeriod(historyYears);
    let lastError: unknown;
    for (const symbol of usShareClassTickerAliases(ticker)) {
      try {
        return await this.fetchTickerFinancialsForSymbol(symbol, annualRange);
      } catch (error) {
        if (!(error instanceof ProviderMissError)) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : createProviderMiss(`Wisesheets cannot provide financials for ${ticker}`);
  }

  private async fetchTickerFinancialsForSymbol(
    symbol: string,
    annualRange: string,
  ): Promise<ReturnType<typeof buildTickerFinancials>> {
    const [annualFinancials, quarterlyFinancials, annualStatements, quarterlyStatements, profile] = await Promise.all([
      this.fetchFinancials(symbol, ANNUAL_METRICS, annualRange, "annual"),
      this.fetchFinancials(symbol, QUARTERLY_METRICS, "last4q", "quarterly", { allowEmpty: true }),
      this.fetchStatements(symbol, annualRange, "annual"),
      this.fetchStatements(symbol, "last4q", "quarterly"),
      this.fetchCompanyProfile(symbol),
    ]);

    return buildTickerFinancials(
      mergePeriodLists(annualFinancials, annualStatements),
      mergePeriodLists(quarterlyFinancials, quarterlyStatements),
      profile,
    );
  }
}
