/** Versioned read contracts shared by dashboards and future report adapters. */
export interface Coverage {
  expected: number;
  measured: number;
  unmeasured: number;
  notMilked: number;
  missing: number;
  pending: number;
  unexpected: number;
  uncertain: number;
  recordingPct: number | null;
  measurementPct: number | null;
}
export interface MilkMetrics {
  coverage: Coverage;
  produced: number | null;
  sold: number;
  nonSale: number;
  dispatched: number | null;
  difference: number | null;
  differencePct: number | null;
  unavailableReasons: string[];
  dispatchExpected: number;
  dispatchRecorded: number;
  dispatchMissing: number;
  dispatchPending: number;
  dispatchRows: number;
  nonSaleByKind: Record<string, number>;
  milkedAnimals: number;
  meanDailyYield: number | null;
  eligibleAnimalDays: number;
  excludedAnimalDays: number;
}
export interface AnalyticsBucket extends MilkMetrics {
  key: string;
  on: string;
  session: string;
}
export interface ProductionRow {
  id: string;
  identifier: string;
  name: string | null;
  tag: string | null;
  litres: number | null;
  coverage: Coverage;
  eligibleAnimalDays: number;
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  sort: string;
  direction: string;
}
export interface AnalyticsReport {
  metricVersion: number;
  generatedAt: string;
  timezone: string;
  scope: {
    view: string;
    on: string;
    from: string;
    to: string;
    session: string;
    inProgress: boolean;
  };
  metrics: MilkMetrics;
  buckets: AnalyticsBucket[];
  production: Page<ProductionRow>;
  reconciliation: Page<AnalyticsBucket>;
  comparison: {
    from: string | null;
    to: string | null;
    previousFrom: string | null;
    previousTo: string | null;
    current: number | null;
    previous: number | null;
    currentDays: number;
    previousDays: number;
    currentDailyAverage: number | null;
    previousDailyAverage: number | null;
    percent: number | null;
    reason: string | null;
  };
}
