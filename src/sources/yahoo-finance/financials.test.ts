import { describe, expect, test } from "bun:test";
import {
  mergeYahooTimeseriesMetrics,
  parseYahooTimeseries,
  yahooTimeseriesPriorWindowEnd,
} from "./financials";

describe("yahoo timeseries windows", () => {
  test("slides the prior window back one UTC year", () => {
    expect(yahooTimeseriesPriorWindowEnd(new Date("2026-08-16T21:00:00Z")).toISOString())
      .toBe("2025-08-16T21:00:00.000Z");
  });

  test("keeps the annual year that falls off Yahoo's 4-period window", () => {
    const current = parseYahooTimeseries([{
      meta: { type: ["annualAccountsReceivable"] },
      annualAccountsReceivable: [
        { asOfDate: "2022-12-31", reportedValue: { raw: 22 } },
        { asOfDate: "2025-12-31", reportedValue: { raw: 25 } },
      ],
    }]);
    const prior = parseYahooTimeseries([{
      meta: { type: ["annualAccountsReceivable"] },
      annualAccountsReceivable: [
        { asOfDate: "2021-12-31", reportedValue: { raw: 21 } },
        { asOfDate: "2022-12-31", reportedValue: { raw: 99 } },
      ],
    }]);

    expect(mergeYahooTimeseriesMetrics(prior, current).annualAccountsReceivable).toEqual([
      { asOfDate: "2021-12-31", value: 21 },
      { asOfDate: "2022-12-31", value: 22 },
      { asOfDate: "2025-12-31", value: 25 },
    ]);
  });
});
