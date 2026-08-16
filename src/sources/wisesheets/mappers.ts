import type { CompanyProfile, FinancialStatement, Fundamentals, TickerFinancials } from "../../types/financials";
import { areNearbyFinancialPeriodEnds } from "../../utils/financial-statements";
import {
  CURRENT_DEBT_FALLBACK_PARTS,
  CURRENT_DEBT_SOLE_CANDIDATE,
  LONG_TERM_DEBT_CANDIDATES,
  METRIC_BUYBACKS,
  METRIC_CAPEX,
  METRIC_CASH,
  METRIC_COST_OF_REVENUE,
  METRIC_DIVIDENDS_PAID,
  METRIC_DILUTED_SHARES,
  METRIC_EBITDA,
  METRIC_EPS_BASIC,
  METRIC_EPS_DILUTED,
  METRIC_FREE_CASH_FLOW,
  METRIC_GROSS_PROFIT,
  METRIC_GOODWILL_AND_INTANGIBLES,
  METRIC_INCOME_TAX,
  METRIC_INVESTED_CAPITAL,
  METRIC_INVENTORY,
  METRIC_LONG_TERM_INVESTMENTS,
  METRIC_NET_DEBT_ISSUANCE,
  METRIC_NET_INCOME,
  METRIC_NET_STOCK_ISSUANCE,
  METRIC_OPERATING_CF,
  METRIC_OPERATING_INCOME,
  METRIC_PAYABLES,
  METRIC_PPE,
  METRIC_PRETAX_INCOME,
  METRIC_RECEIVABLES,
  METRIC_RESEARCH_AND_DEVELOPMENT,
  METRIC_REVENUE,
  METRIC_SGA_PCT,
  METRIC_SHORT_TERM_INVESTMENTS,
  METRIC_STOCK_COMP,
  METRIC_TANGIBLE_BOOK_VALUE,
  METRIC_TOTAL_ASSETS,
  METRIC_TOTAL_DEBT_INCLUDING_LEASES,
  METRIC_TOTAL_EQUITY,
  METRIC_TOTAL_LIABILITIES,
  METRIC_TOTAL_LEASE_OBLIGATIONS,
  METRIC_DEPRECIATION_AMORTIZATION,
} from "./metrics";

export interface WisesheetsSourceBlock {
  kind?: string;
  filingDate?: string;
  tag?: string;
  taxonomy?: string;
  accession?: string;
  filingUrl?: string;
  isAmendment?: boolean;
  isSuperseded?: boolean;
}

export interface WisesheetsFinancialRow {
  ticker: string;
  periodEnd: string;
  metric: string;
  value: string | number;
  fiscalYear?: number;
  source?: WisesheetsSourceBlock;
}

export interface WisesheetsPeriodValues {
  period_end: string;
  fiscal_year?: number;
  sources: Record<string, WisesheetsSourceBlock>;
  [metric: string]: unknown;
}

interface ResolvedMetric {
  value?: number;
  sourceMetric?: string;
}

const DEBT_RESOLVED_METRICS = new Set<string>([
  ...LONG_TERM_DEBT_CANDIDATES,
  CURRENT_DEBT_SOLE_CANDIDATE,
  ...CURRENT_DEBT_FALLBACK_PARTS,
]);

const METRIC_TO_STATEMENT_FIELD: Record<string, keyof FinancialStatement> = {
  [METRIC_REVENUE]: "totalRevenue",
  [METRIC_GROSS_PROFIT]: "grossProfit",
  [METRIC_COST_OF_REVENUE]: "costOfRevenue",
  [METRIC_OPERATING_INCOME]: "operatingIncome",
  [METRIC_INCOME_TAX]: "taxProvision",
  [METRIC_PRETAX_INCOME]: "pretaxIncome",
  [METRIC_NET_INCOME]: "netIncome",
  [METRIC_EBITDA]: "ebitda",
  [METRIC_RESEARCH_AND_DEVELOPMENT]: "researchAndDevelopment",
  selling_general_and_administrative: "sellingGeneralAndAdministration",
  selling_general_and_administration: "sellingGeneralAndAdministration",
  sga: "sellingGeneralAndAdministration",
  operating_expense: "operatingExpense",
  operating_expenses: "operatingExpense",
  operating_revenue: "operatingRevenue",
  total_expenses: "totalExpenses",
  interest_expense: "interestExpense",
  other_income_expense: "otherIncomeExpense",
  [METRIC_OPERATING_CF]: "operatingCashFlow",
  net_cash_from_investing_activities: "investingCashFlow",
  net_cash_from_financing_activities: "financingCashFlow",
  [METRIC_CAPEX]: "capitalExpenditure",
  [METRIC_DEPRECIATION_AMORTIZATION]: "depreciationAndAmortization",
  [METRIC_FREE_CASH_FLOW]: "freeCashFlow",
  [METRIC_STOCK_COMP]: "stockBasedCompensation",
  [METRIC_BUYBACKS]: "repurchaseOfCapitalStock",
  [METRIC_DIVIDENDS_PAID]: "cashDividendsPaid",
  [METRIC_NET_STOCK_ISSUANCE]: "netCommonStockIssuance",
  [METRIC_NET_DEBT_ISSUANCE]: "netIssuancePaymentsOfDebt",
  change_in_working_capital: "changeInWorkingCapital",
  change_in_receivables: "changeInReceivables",
  change_in_inventory: "changeInInventory",
  change_in_accounts_payable: "changeInAccountPayable",
  deferred_income_tax: "deferredIncomeTax",
  purchase_of_ppe: "purchaseOfPPE",
  sale_of_ppe: "saleOfPPE",
  issuance_of_debt: "issuanceOfDebt",
  repayment_of_debt: "repaymentOfDebt",
  cash_at_beginning_of_period: "beginningCashPosition",
  cash_at_end_of_period: "endCashPosition",
  beginning_cash: "beginningCashPosition",
  ending_cash: "endCashPosition",
  [METRIC_CASH]: "cashAndCashEquivalents",
  [METRIC_SHORT_TERM_INVESTMENTS]: "otherShortTermInvestments",
  [METRIC_TOTAL_EQUITY]: "totalEquity",
  [METRIC_INVENTORY]: "inventory",
  [METRIC_TOTAL_ASSETS]: "totalAssets",
  [METRIC_TOTAL_LIABILITIES]: "totalLiabilities",
  current_assets: "currentAssets",
  current_liabilities: "currentLiabilities",
  retained_earnings: "retainedEarnings",
  working_capital: "workingCapital",
  [METRIC_LONG_TERM_INVESTMENTS]: "investmentsAndAdvances",
  [METRIC_RECEIVABLES]: "accountsReceivable",
  [METRIC_PAYABLES]: "accountsPayable",
  [METRIC_PPE]: "netPPE",
  [METRIC_GOODWILL_AND_INTANGIBLES]: "goodwillAndOtherIntangibleAssets",
  goodwill: "goodwill",
  other_intangible_assets: "otherIntangibleAssets",
  [METRIC_TOTAL_DEBT_INCLUDING_LEASES]: "totalDebt",
  [METRIC_TOTAL_LEASE_OBLIGATIONS]: "capitalLeaseObligations",
  [METRIC_INVESTED_CAPITAL]: "investedCapital",
  [METRIC_TANGIBLE_BOOK_VALUE]: "tangibleBookValue",
  [METRIC_DILUTED_SHARES]: "dilutedShares",
  basic_shares_outstanding: "basicShares",
  long_term_debt: "longTermDebt",
  long_term_debt_and_capital_lease_obligations: "longTermDebtAndCapitalLeaseObligation",
  debt_current: "currentDebt",
  long_term_debt_current: "currentDebt",
  short_term_debt: "currentDebt",
};

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function groupByTickerPeriod(rows: WisesheetsFinancialRow[]): Record<string, Record<string, WisesheetsPeriodValues>> {
  const out: Record<string, Record<string, WisesheetsPeriodValues>> = {};
  for (const row of rows) {
    const ticker = row.ticker;
    const periodEnd = row.periodEnd;
    const byPeriod = out[ticker] ?? {};
    out[ticker] = byPeriod;
    const periodValues = byPeriod[periodEnd] ?? { period_end: periodEnd, sources: {} };
    byPeriod[periodEnd] = periodValues;
    periodValues[row.metric] = toNumber(row.value);
    if (row.fiscalYear !== undefined) periodValues.fiscal_year = row.fiscalYear;
    if (row.source) periodValues.sources[row.metric] = row.source;
  }
  return out;
}

export function resolveLongTermDebt(period: WisesheetsPeriodValues): ResolvedMetric {
  for (const key of LONG_TERM_DEBT_CANDIDATES) {
    const value = toNumber(period[key]);
    if (value !== undefined) return { value, sourceMetric: key };
  }
  return {};
}

export function resolveCurrentDebt(period: WisesheetsPeriodValues): ResolvedMetric {
  const sole = toNumber(period[CURRENT_DEBT_SOLE_CANDIDATE]);
  if (sole !== undefined) return { value: sole, sourceMetric: CURRENT_DEBT_SOLE_CANDIDATE };
  const parts = CURRENT_DEBT_FALLBACK_PARTS
    .map((key) => toNumber(period[key]))
    .filter((value): value is number => value !== undefined);
  if (parts.length === 0) return {};
  return { value: parts.reduce((sum, part) => sum + part, 0) };
}

export function resolveEps(period: WisesheetsPeriodValues): ResolvedMetric {
  for (const key of [METRIC_EPS_DILUTED, METRIC_EPS_BASIC]) {
    const value = toNumber(period[key]);
    if (value !== undefined) return { value, sourceMetric: key };
  }
  return {};
}

function provenanceDate(source?: WisesheetsSourceBlock): string | undefined {
  if (!source || source.kind !== "reported") return undefined;
  const filingDate = source.filingDate?.trim();
  return filingDate || undefined;
}

function applyMetricToStatement(
  statement: FinancialStatement,
  metricKey: string,
  value: number,
  source?: WisesheetsSourceBlock,
): void {
  const field = METRIC_TO_STATEMENT_FIELD[metricKey];
  if (!field || statement[field] !== undefined) return;
  statement[field] = value as FinancialStatement[typeof field];
  const date = provenanceDate(source);
  if (date) {
    statement.fieldAvailability = { ...statement.fieldAvailability, [field]: date };
  }
}

function applyDerivedField(
  statement: FinancialStatement,
  field: keyof FinancialStatement,
  value: number | undefined,
  source?: WisesheetsSourceBlock,
): void {
  if (value === undefined || statement[field] !== undefined) return;
  statement[field] = value as FinancialStatement[typeof field];
  const date = provenanceDate(source);
  if (date) statement.fieldAvailability = { ...statement.fieldAvailability, [field]: date };
}

function finalizeStatement(statement: FinancialStatement): FinancialStatement {
  const dates = Object.values(statement.fieldAvailability ?? {})
    .filter((entry) => entry)
    .sort();
  if (dates.length > 0) statement.availableAt = dates[0];
  return statement;
}

function applyDerivedStatementFields(statement: FinancialStatement, period: WisesheetsPeriodValues): void {
  const sgaPct = toNumber(period[METRIC_SGA_PCT]);
  if (sgaPct !== undefined && statement.totalRevenue !== undefined) {
    applyDerivedField(
      statement,
      "sellingGeneralAndAdministration",
      statement.totalRevenue * sgaPct,
      period.sources[METRIC_SGA_PCT] ?? period.sources[METRIC_REVENUE],
    );
  }

  if (statement.grossProfit !== undefined && statement.operatingIncome !== undefined) {
    applyDerivedField(
      statement,
      "operatingExpense",
      statement.grossProfit - statement.operatingIncome,
      period.sources[METRIC_GROSS_PROFIT] ?? period.sources[METRIC_OPERATING_INCOME],
    );
  }

  if (statement.costOfRevenue !== undefined && statement.operatingExpense !== undefined) {
    applyDerivedField(
      statement,
      "totalExpenses",
      statement.costOfRevenue + statement.operatingExpense,
      period.sources[METRIC_COST_OF_REVENUE],
    );
  }

  if (statement.cashAndCashEquivalents !== undefined && statement.otherShortTermInvestments !== undefined) {
    applyDerivedField(
      statement,
      "cashCashEquivalentsAndShortTermInvestments",
      statement.cashAndCashEquivalents + statement.otherShortTermInvestments,
      period.sources[METRIC_CASH] ?? period.sources[METRIC_SHORT_TERM_INVESTMENTS],
    );
  }

  applyDerivedField(
    statement,
    "operatingRevenue",
    statement.totalRevenue,
    period.sources[METRIC_REVENUE],
  );
  applyDerivedField(statement, "receivables", statement.accountsReceivable, period.sources[METRIC_RECEIVABLES]);
  applyDerivedField(statement, "payables", statement.accountsPayable, period.sources[METRIC_PAYABLES]);
  applyDerivedField(
    statement,
    "depreciationAndAmortizationInIncomeStatement",
    statement.depreciationAndAmortization,
    period.sources[METRIC_DEPRECIATION_AMORTIZATION],
  );
}

export function mapPeriodToFinancialStatement(period: WisesheetsPeriodValues): FinancialStatement {
  const statement: FinancialStatement = { date: period.period_end };

  for (const metricKey of Object.keys(METRIC_TO_STATEMENT_FIELD)) {
    if (DEBT_RESOLVED_METRICS.has(metricKey)) continue;
    const value = toNumber(period[metricKey]);
    if (value === undefined) continue;
    applyMetricToStatement(statement, metricKey, value, period.sources[metricKey]);
  }

  const eps = resolveEps(period);
  if (eps.value !== undefined) {
    const epsField = eps.sourceMetric === METRIC_EPS_BASIC ? "basicEps" : "eps";
    statement[epsField] = eps.value;
    const date = provenanceDate(eps.sourceMetric ? period.sources[eps.sourceMetric] : undefined);
    if (date) statement.fieldAvailability = { ...statement.fieldAvailability, [epsField]: date };
  }

  const longTermDebt = resolveLongTermDebt(period);
  if (longTermDebt.value !== undefined) {
    applyMetricToStatement(
      statement,
      longTermDebt.sourceMetric ?? "long_term_debt",
      longTermDebt.value,
      longTermDebt.sourceMetric ? period.sources[longTermDebt.sourceMetric] : undefined,
    );
  }

  const currentDebt = resolveCurrentDebt(period);
  if (currentDebt.value !== undefined) {
    statement.currentDebt = currentDebt.value;
    if (currentDebt.sourceMetric) {
      const date = provenanceDate(period.sources[currentDebt.sourceMetric]);
      if (date) statement.fieldAvailability = { ...statement.fieldAvailability, currentDebt: date };
    }
  }

  applyDerivedStatementFields(statement, period);
  return finalizeStatement(statement);
}

export function mapPeriodsToStatements(periods: WisesheetsPeriodValues[]): FinancialStatement[] {
  return periods
    .map((period) => mapPeriodToFinancialStatement(period))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function clonePeriod(period: WisesheetsPeriodValues): WisesheetsPeriodValues {
  return { ...period, sources: { ...period.sources } };
}

function matchNearbyPeriod(
  periodEnd: string,
  periods: Iterable<WisesheetsPeriodValues>,
): WisesheetsPeriodValues | undefined {
  const rows = [...periods];
  const exact = rows.find((period) => period.period_end === periodEnd);
  if (exact) return exact;
  return rows
    .flatMap((period) => {
      if (!areNearbyFinancialPeriodEnds(periodEnd, period.period_end)) return [];
      const distance = Math.abs(Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${period.period_end}T00:00:00Z`));
      return [{ period, distance }];
    })
    .sort((left, right) => left.distance - right.distance || left.period.period_end.localeCompare(right.period.period_end))[0]?.period;
}

export function mergePeriodLists(
  primary: WisesheetsPeriodValues[],
  extra: WisesheetsPeriodValues[],
): WisesheetsPeriodValues[] {
  const byDate = new Map<string, WisesheetsPeriodValues>();
  for (const period of extra) {
    byDate.set(period.period_end, clonePeriod(period));
  }
  for (const period of primary) {
    const existing = matchNearbyPeriod(period.period_end, byDate.values());
    if (!existing) {
      byDate.set(period.period_end, clonePeriod(period));
      continue;
    }
    if (existing.period_end !== period.period_end) byDate.delete(existing.period_end);
    byDate.set(period.period_end, {
      ...existing,
      ...period,
      period_end: period.period_end,
      sources: { ...existing.sources, ...period.sources },
    });
  }
  return [...byDate.values()].sort((left, right) => left.period_end.localeCompare(right.period_end));
}

export function statementPeriodsFromPayload(payload: unknown): WisesheetsPeriodValues[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  const periods: WisesheetsPeriodValues[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const period = (entry as { period?: { end?: unknown } }).period;
    const end = typeof period?.end === "string" ? period.end : undefined;
    if (!end) continue;

    const filing = (entry as { filing?: { filingDate?: unknown } }).filing;
    const filingDate = typeof filing?.filingDate === "string" ? filing.filingDate : undefined;
    const filingSource: WisesheetsSourceBlock | undefined = filingDate
      ? { kind: "reported", filingDate }
      : undefined;

    const values: WisesheetsPeriodValues = { period_end: end, sources: {} };
    const statements = (entry as { statements?: Record<string, { lines?: unknown }> }).statements;
    if (!statements || typeof statements !== "object") continue;

    for (const section of Object.values(statements)) {
      const lines = section?.lines;
      if (!Array.isArray(lines)) continue;
      for (const line of lines) {
        if (!line || typeof line !== "object") continue;
        const metric = (line as { metric?: unknown }).metric;
        if (typeof metric !== "string" || !metric) continue;
        const value = toNumber((line as { value?: unknown }).value);
        if (value === undefined) continue;
        values[metric] = value;
        const lineSource = (line as { source?: WisesheetsSourceBlock }).source ?? filingSource;
        if (lineSource) values.sources[metric] = lineSource;
      }
    }
    periods.push(values);
  }
  return periods;
}

export function mapCompanyProfile(data: Record<string, unknown> | undefined): CompanyProfile | undefined {
  if (!data) return undefined;
  const industry = typeof data.sicDescription === "string" ? data.sicDescription.trim() : "";
  if (!industry) return undefined;
  return { industry };
}

export function buildFundamentalsFromLatest(latest?: FinancialStatement): Fundamentals | undefined {
  if (!latest) return undefined;
  const fundamentals: Fundamentals = {};
  if (latest.totalRevenue !== undefined) fundamentals.revenue = latest.totalRevenue;
  if (latest.netIncome !== undefined) fundamentals.netIncome = latest.netIncome;
  if (latest.eps !== undefined) fundamentals.eps = latest.eps;
  if (latest.operatingCashFlow !== undefined) fundamentals.operatingCashFlow = latest.operatingCashFlow;
  if (latest.freeCashFlow !== undefined) fundamentals.freeCashFlow = latest.freeCashFlow;
  if (latest.dilutedShares !== undefined) fundamentals.sharesOutstanding = latest.dilutedShares;
  return fundamentals;
}

export function buildTickerFinancials(
  annualPeriods: WisesheetsPeriodValues[],
  quarterlyPeriods: WisesheetsPeriodValues[],
  profile?: CompanyProfile,
): TickerFinancials {
  const annualStatements = mapPeriodsToStatements(annualPeriods);
  const quarterlyStatements = mapPeriodsToStatements(quarterlyPeriods);
  const latestAnnual = annualStatements.at(-1);
  return {
    annualStatements,
    quarterlyStatements,
    priceHistory: [],
    profile,
    fundamentals: buildFundamentalsFromLatest(latestAnnual),
  };
}
