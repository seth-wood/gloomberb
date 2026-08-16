export const METRIC_REVENUE = "revenue";
export const METRIC_GROSS_PROFIT = "gross_profit";
export const METRIC_COST_OF_REVENUE = "cost_of_revenue";
export const METRIC_OPERATING_INCOME = "operating_income";
export const METRIC_INCOME_TAX = "income_tax_expense";
export const METRIC_PRETAX_INCOME = "pretax_income";
export const METRIC_EPS_DILUTED = "eps_diluted";
export const METRIC_EPS_BASIC = "eps_basic";
export const METRIC_NET_INCOME = "net_income";
export const METRIC_EBITDA = "ebitda";
export const METRIC_RESEARCH_AND_DEVELOPMENT = "research_and_development";
export const METRIC_SGA_PCT = "sga_as_pct_of_revenue";
export const METRIC_DIVIDENDS_PER_SHARE = "dividends_per_share";
export const METRIC_DILUTED_SHARES = "diluted_shares_outstanding";
export const METRIC_DEPRECIATION_AMORTIZATION = "depreciation_and_amortization";
export const METRIC_CAPEX = "capital_expenditures";
export const METRIC_OPERATING_CF = "net_cash_from_operating_activities";
export const METRIC_FREE_CASH_FLOW = "free_cash_flow";
export const METRIC_STOCK_COMP = "stock_based_compensation";
export const METRIC_BUYBACKS = "common_stock_repurchased";
export const METRIC_DIVIDENDS_PAID = "total_dividends_paid";
export const METRIC_NET_STOCK_ISSUANCE = "net_common_stock_issuance";
export const METRIC_NET_DEBT_ISSUANCE = "net_total_debt_issuance";
export const METRIC_CASH = "cash_and_cash_equivalents";
export const METRIC_SHORT_TERM_INVESTMENTS = "short_term_investments";
export const METRIC_TOTAL_EQUITY = "total_equity";
export const METRIC_INVENTORY = "inventory";
export const METRIC_TOTAL_ASSETS = "total_assets";
export const METRIC_TOTAL_LIABILITIES = "total_liabilities";
export const METRIC_LONG_TERM_INVESTMENTS = "long_term_investments";
export const METRIC_RECEIVABLES = "accounts_receivable";
export const METRIC_PAYABLES = "accounts_payable";
export const METRIC_PPE = "property_plant_equipment_net";
export const METRIC_GOODWILL_AND_INTANGIBLES = "goodwill_and_intangible_assets";
export const METRIC_TOTAL_DEBT_INCLUDING_LEASES = "total_debt_including_leases";
export const METRIC_TOTAL_LEASE_OBLIGATIONS = "total_lease_obligations";
export const METRIC_INVESTED_CAPITAL = "invested_capital";
export const METRIC_TANGIBLE_BOOK_VALUE = "tangible_book_value";
export const METRIC_CURRENT_RATIO = "current_ratio";
export const METRIC_QUICK_RATIO = "quick_ratio";
export const METRIC_INTEREST_COVERAGE = "interest_coverage_ratio";

export const BALANCE_METRICS = [
  METRIC_TOTAL_ASSETS,
  METRIC_TOTAL_LIABILITIES,
  METRIC_TOTAL_EQUITY,
  METRIC_CASH,
  METRIC_SHORT_TERM_INVESTMENTS,
  METRIC_LONG_TERM_INVESTMENTS,
  METRIC_RECEIVABLES,
  METRIC_INVENTORY,
  METRIC_PAYABLES,
  METRIC_PPE,
  METRIC_GOODWILL_AND_INTANGIBLES,
  METRIC_TOTAL_DEBT_INCLUDING_LEASES,
  METRIC_TOTAL_LEASE_OBLIGATIONS,
  METRIC_INVESTED_CAPITAL,
  METRIC_TANGIBLE_BOOK_VALUE,
  METRIC_CURRENT_RATIO,
  METRIC_QUICK_RATIO,
  METRIC_INTEREST_COVERAGE,
] as const;

export const LONG_TERM_DEBT_CANDIDATES = [
  "long_term_debt_and_capital_lease_obligations",
  "long_term_debt",
] as const;

export const CURRENT_DEBT_SOLE_CANDIDATE = "debt_current";
export const CURRENT_DEBT_FALLBACK_PARTS = [
  "long_term_debt_current",
  "short_term_debt",
] as const;

export const DEBT_METRICS = [
  ...LONG_TERM_DEBT_CANDIDATES,
  CURRENT_DEBT_SOLE_CANDIDATE,
  ...CURRENT_DEBT_FALLBACK_PARTS,
] as const;

export const TTM_FLOW_METRICS: Record<string, string> = {
  [METRIC_REVENUE]: "revenue",
  [METRIC_OPERATING_INCOME]: "operating_income",
  [METRIC_INCOME_TAX]: "income_taxes",
  [METRIC_PRETAX_INCOME]: "pretax_income",
  [METRIC_NET_INCOME]: "net_income",
  [METRIC_DIVIDENDS_PER_SHARE]: "dividends_per_share",
  [METRIC_DEPRECIATION_AMORTIZATION]: "depreciation",
  [METRIC_CAPEX]: "capex",
  [METRIC_OPERATING_CF]: "operating_cf",
};

export const ANNUAL_METRICS = Array.from(new Set([
  METRIC_REVENUE,
  METRIC_GROSS_PROFIT,
  METRIC_COST_OF_REVENUE,
  METRIC_OPERATING_INCOME,
  METRIC_EBITDA,
  METRIC_RESEARCH_AND_DEVELOPMENT,
  METRIC_SGA_PCT,
  METRIC_EPS_DILUTED,
  METRIC_EPS_BASIC,
  METRIC_NET_INCOME,
  METRIC_OPERATING_CF,
  METRIC_CAPEX,
  METRIC_DEPRECIATION_AMORTIZATION,
  METRIC_FREE_CASH_FLOW,
  METRIC_STOCK_COMP,
  METRIC_PRETAX_INCOME,
  METRIC_INCOME_TAX,
  METRIC_BUYBACKS,
  METRIC_DIVIDENDS_PAID,
  METRIC_NET_STOCK_ISSUANCE,
  METRIC_NET_DEBT_ISSUANCE,
  METRIC_TOTAL_EQUITY,
  METRIC_DILUTED_SHARES,
  ...BALANCE_METRICS,
  ...DEBT_METRICS,
]));

export const QUARTERLY_METRICS = ANNUAL_METRICS;

export const MAX_HISTORY_YEARS = 15;
