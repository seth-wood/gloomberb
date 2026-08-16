import type { FinancialStatement } from "../types/financials";

const STATEMENT_METADATA_KEYS = new Set(["date", "availableAt", "fieldAvailability"]);
const NEARBY_PERIOD_END_MS = 7 * 24 * 60 * 60 * 1_000;
const ADJACENT_MONTH_END_MS = 31 * 24 * 60 * 60 * 1_000;

function utcDateTime(value: string | Date): number | null {
  const time = value instanceof Date ? value.getTime() : Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

function isUtcMonthEnd(time: number): boolean {
  const date = new Date(time);
  const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return time === nextMonth - 24 * 60 * 60 * 1_000;
}

function utcMonthIndex(time: number): number {
  const date = new Date(time);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function metricKeys(...rows: Array<FinancialStatement | undefined>): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))]
    .filter((key) => !STATEMENT_METADATA_KEYS.has(key));
}

function metricValue(row: FinancialStatement | undefined, key: string): unknown {
  return (row as unknown as Record<string, unknown> | undefined)?.[key];
}

function hasMetricValue(row: FinancialStatement | undefined, key: string): boolean {
  return typeof metricValue(row, key) === "number";
}

function hasAvailabilityEvidence(row: FinancialStatement | undefined): boolean {
  return !!row?.availableAt || Object.keys(row?.fieldAvailability ?? {}).length > 0;
}

function canonicalStatementDate(
  primary: FinancialStatement,
  fallback: FinancialStatement | undefined,
): string {
  if (!fallback) return primary.date;
  return hasAvailabilityEvidence(fallback) && !hasAvailabilityEvidence(primary)
    ? fallback.date
    : primary.date;
}

function statementDateTime(row: FinancialStatement): number | null {
  return utcDateTime(row.date);
}

export function areNearbyFinancialPeriodEnds(
  left: string | Date,
  right: string | Date,
): boolean {
  const leftTime = utcDateTime(left);
  const rightTime = utcDateTime(right);
  if (leftTime === null || rightTime === null) return false;
  const distance = Math.abs(leftTime - rightTime);
  if (distance <= NEARBY_PERIOD_END_MS) return true;
  // Yahoo calendar-normalizes January/April/July/October fiscal closes to the
  // prior calendar month-end (VEEV 2023-01-31 vs 2022-12-31). Keep mid-month
  // dates on the 7-day window so distinct periods stay distinct.
  return distance <= ADJACENT_MONTH_END_MS
    && isUtcMonthEnd(leftTime)
    && isUtcMonthEnd(rightTime)
    && Math.abs(utcMonthIndex(leftTime) - utcMonthIndex(rightTime)) === 1;
}

function matchFallbackRow(
  primary: FinancialStatement,
  fallbackRows: FinancialStatement[],
  usedFallbackRows: Set<FinancialStatement>,
): FinancialStatement | undefined {
  const exact = fallbackRows.find((row) => row.date === primary.date && !usedFallbackRows.has(row));
  if (exact) return exact;
  const primaryTime = statementDateTime(primary);
  if (primaryTime === null) return undefined;
  return fallbackRows
    .flatMap((row) => {
      if (usedFallbackRows.has(row)) return [];
      const fallbackTime = statementDateTime(row);
      if (fallbackTime === null) return [];
      const distance = Math.abs(fallbackTime - primaryTime);
      return areNearbyFinancialPeriodEnds(primary.date, row.date) ? [{ row, distance }] : [];
    })
    .sort((left, right) => left.distance - right.distance || left.row.date.localeCompare(right.row.date))[0]?.row;
}

export function mergeFinancialStatementRows(
  primaryRows: FinancialStatement[],
  fallbackRows: FinancialStatement[],
): FinancialStatement[] {
  if (primaryRows.length === 0) return fallbackRows;
  if (fallbackRows.length === 0) return primaryRows;

  const usedFallbackRows = new Set<FinancialStatement>();
  const mergedRows = primaryRows.map((row) => {
    const fallback = matchFallbackRow(row, fallbackRows, usedFallbackRows);
    if (fallback) usedFallbackRows.add(fallback);
    const merged = {
      ...fallback,
      ...row,
      // Prefer the date backed by filing provenance. Generic provider merges
      // otherwise retain their primary provider's period identity.
      date: canonicalStatementDate(row, fallback),
    } as FinancialStatement;
    const fieldAvailability: Record<string, string> = {};
    const keys = metricKeys(row, fallback);

    for (const key of keys) {
      const primaryHasValue = hasMetricValue(row, key);
      const fallbackHasValue = hasMetricValue(fallback, key);
      if (!primaryHasValue && fallbackHasValue) {
        (merged as unknown as Record<string, unknown>)[key] = metricValue(fallback, key);
      }

      if (primaryHasValue) {
        const primaryAvailability = row.fieldAvailability?.[key] ?? row.availableAt;
        const valuesMatch = fallbackHasValue && Object.is(metricValue(row, key), metricValue(fallback, key));
        const availability = primaryAvailability
          ?? (valuesMatch ? fallback?.fieldAvailability?.[key] ?? fallback?.availableAt : undefined);
        if (availability) fieldAvailability[key] = availability;
      } else if (fallbackHasValue) {
        const availability = fallback?.fieldAvailability?.[key] ?? fallback?.availableAt;
        if (availability) fieldAvailability[key] = availability;
      }
    }

    // A fallback row-level date cannot safely date a different primary value.
    // Retained fallback fields still carry their own per-field provenance.
    const primaryHasMetrics = keys.some((key) => hasMetricValue(row, key));
    const retainedMetricKeys = keys.filter((key) => hasMetricValue(merged, key));
    const completeFieldAvailability = retainedMetricKeys.length > 0
      && retainedMetricKeys.every((key) => !!fieldAvailability[key]);
    const availableAt = completeFieldAvailability
      ? Object.values(fieldAvailability).sort().at(-1)
      : row.availableAt ?? (!primaryHasMetrics ? fallback?.availableAt : undefined);
    if (availableAt) merged.availableAt = availableAt;
    else delete merged.availableAt;
    if (Object.keys(fieldAvailability).length > 0) merged.fieldAvailability = fieldAvailability;
    else delete merged.fieldAvailability;
    return merged;
  });

  for (const row of fallbackRows) {
    if (!usedFallbackRows.has(row)) mergedRows.push(row);
  }

  return mergedRows.sort((left, right) => left.date.localeCompare(right.date));
}
