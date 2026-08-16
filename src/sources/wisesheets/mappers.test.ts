import { describe, expect, test } from "bun:test";
import {
  groupByTickerPeriod,
  mapPeriodToFinancialStatement,
  mergePeriodLists,
  statementPeriodsFromPayload,
  type WisesheetsFinancialRow,
} from "./mappers";

function annualRows(): WisesheetsFinancialRow[] {
  return [
    {
      ticker: "AAPL",
      periodEnd: "2025-09-27",
      metric: "revenue",
      value: 400,
      fiscalYear: 2025,
      source: { kind: "reported", filingDate: "2025-10-31" },
    },
    {
      ticker: "AAPL",
      periodEnd: "2025-09-27",
      metric: "long_term_debt",
      value: 90,
      fiscalYear: 2025,
      source: { kind: "reported", filingDate: "2025-10-31", tag: "LongTermDebt" },
    },
    {
      ticker: "AAPL",
      periodEnd: "2025-09-27",
      metric: "long_term_debt_current",
      value: 12,
      fiscalYear: 2025,
    },
    {
      ticker: "AAPL",
      periodEnd: "2025-09-27",
      metric: "short_term_debt",
      value: 22,
      fiscalYear: 2025,
    },
    {
      ticker: "AAPL",
      periodEnd: "2025-09-27",
      metric: "eps_diluted",
      value: 4.4,
      fiscalYear: 2025,
      source: { kind: "reported", filingDate: "2025-10-31" },
    },
    {
      ticker: "AAPL",
      periodEnd: "2024-09-28",
      metric: "revenue",
      value: 380,
      fiscalYear: 2024,
      source: { kind: "reported", filingDate: "2024-11-01" },
    },
    {
      ticker: "AAPL",
      periodEnd: "2024-09-28",
      metric: "eps_basic",
      value: 4.0,
      fiscalYear: 2024,
      source: { kind: "reported", filingDate: "2024-11-01" },
    },
  ];
}

describe("wisesheets mappers", () => {
  test("uses the latest staggered field filing date for availableAt", () => {
    const statement = mapPeriodToFinancialStatement({
      period_end: "2025-09-27",
      sources: {
        revenue: { kind: "reported", filingDate: "2025-10-31" },
        eps_diluted: { kind: "reported", filingDate: "2025-11-15" },
      },
      revenue: 400,
      eps_diluted: 4.4,
    });

    expect(statement.fieldAvailability?.totalRevenue).toBe("2025-10-31");
    expect(statement.fieldAvailability?.eps).toBe("2025-11-15");
    expect(statement.availableAt).toBe("2025-11-15");
  });

  test("maps long-layout rows into statement years with debt fallbacks and provenance", () => {
    const grouped = groupByTickerPeriod(annualRows());
    const latest = grouped.AAPL["2025-09-27"];
    const statement = mapPeriodToFinancialStatement(latest);

    expect(statement.date).toBe("2025-09-27");
    expect(statement.totalRevenue).toBe(400);
    expect(statement.eps).toBe(4.4);
    expect(statement.longTermDebt).toBe(90);
    expect(statement.currentDebt).toBe(34);
    expect(statement.fieldAvailability?.totalRevenue).toBe("2025-10-31");
    expect(statement.fieldAvailability?.eps).toBe("2025-10-31");
    expect(statement.availableAt).toBe("2025-10-31");
    expect(statement.grossProfit).toBeUndefined();
  });

  test("falls back to basic EPS when diluted is absent", () => {
    const grouped = groupByTickerPeriod(annualRows());
    const prior = grouped.AAPL["2024-09-28"];
    const statement = mapPeriodToFinancialStatement(prior);
    expect(statement.basicEps).toBe(4.0);
    expect(statement.eps).toBeUndefined();
    expect(statement.fieldAvailability?.basicEps).toBe("2024-11-01");
  });

  test("maps filed income lines and derives SG&A and operating expense", () => {
    const statement = mapPeriodToFinancialStatement({
      period_end: "2025-09-27",
      sources: {
        cost_of_revenue: { kind: "reported", filingDate: "2025-10-31" },
        research_and_development: { kind: "reported", filingDate: "2025-10-31" },
        sga_as_pct_of_revenue: { kind: "reported", filingDate: "2025-10-31" },
      },
      revenue: 400,
      cost_of_revenue: 220,
      gross_profit: 180,
      operating_income: 120,
      ebitda: 140,
      research_and_development: 35,
      sga_as_pct_of_revenue: 0.0625,
      invested_capital: 56,
      tangible_book_value: 60,
      net_total_debt_issuance: -6,
    });

    expect(statement.costOfRevenue).toBe(220);
    expect(statement.ebitda).toBe(140);
    expect(statement.researchAndDevelopment).toBe(35);
    expect(statement.sellingGeneralAndAdministration).toBe(25);
    expect(statement.operatingExpense).toBe(60);
    expect(statement.totalExpenses).toBe(280);
    expect(statement.investedCapital).toBe(56);
    expect(statement.tangibleBookValue).toBe(60);
    expect(statement.operatingRevenue).toBe(400);
    expect(statement.netIssuancePaymentsOfDebt).toBe(-6);
    expect(statement.fieldAvailability?.costOfRevenue).toBe("2025-10-31");
    expect(statement.fieldAvailability?.sellingGeneralAndAdministration).toBe("2025-10-31");
  });

  test("prefers a filed SG&A dollar amount over the ratio derivation", () => {
    const statement = mapPeriodToFinancialStatement({
      period_end: "2025-09-27",
      sources: {},
      revenue: 400,
      sga_as_pct_of_revenue: 0.5,
      selling_general_and_administrative: 18,
    });
    expect(statement.sellingGeneralAndAdministration).toBe(18);
  });

  test("merges statement-endpoint lines into /financials/ periods without clobbering filed metrics", () => {
    const fromFinancials = [{
      period_end: "2025-09-27",
      sources: { revenue: { kind: "reported", filingDate: "2025-10-31" } },
      revenue: 400,
    }];
    const fromStatements = statementPeriodsFromPayload({
      data: [{
        period: { end: "2025-09-27" },
        filing: { filingDate: "2025-10-31" },
        statements: {
          income_statement: {
            lines: [
              { metric: "revenue", value: "1" },
              { metric: "interest_expense", value: "9" },
              { metric: "current_assets", value: "50" },
            ],
          },
        },
      }],
    });

    const merged = mergePeriodLists(fromFinancials, fromStatements);
    expect(merged).toHaveLength(1);
    expect(merged[0].revenue).toBe(400);
    expect(merged[0].interest_expense).toBe(9);
    expect(merged[0].current_assets).toBe(50);

    const statement = mapPeriodToFinancialStatement(merged[0]);
    expect(statement.totalRevenue).toBe(400);
    expect(statement.interestExpense).toBe(9);
    expect(statement.currentAssets).toBe(50);
  });

  test("merges statement lines onto a January fiscal close from a December calendar close", () => {
    const merged = mergePeriodLists(
      [{ period_end: "2023-01-31", sources: {}, revenue: 400 }],
      [{ period_end: "2022-12-31", sources: {}, interest_expense: 9, current_assets: 50 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.period_end).toBe("2023-01-31");
    expect(merged[0]?.revenue).toBe(400);
    expect(merged[0]?.interest_expense).toBe(9);
    expect(merged[0]?.current_assets).toBe(50);
  });
});
