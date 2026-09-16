import type {
  AnalyticsReport,
  AnalyticsBucket,
  Coverage,
  MilkMetrics,
  ProductionRow,
} from "@dairy/shared";
import type { Db } from "./schema";
import type {
  RegistryAnimalRow,
  RegistryMilkingRow,
  LactationRow,
  DispatchRow,
  DestinationRow,
} from "./types";
import { lactationCovering } from "./milking";
import { activeOn } from "./destinations";
import { farmToday, FARM_TZ } from "./time";
import { invalid, pageRows, scalar } from "./pagination";

const sessions = ["morning", "evening"] as const;
export function date(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value ||
    value < "1900-01-01" ||
    value > "9998-12-31"
  )
    invalid("Choose a valid date between 1900 and 9998.");
  return value;
}
export function shift(on: string, days: number): string {
  return new Date(Date.parse(on) + days * 86400000).toISOString().slice(0, 10);
}
export function bounds(view: string, on: string): { from: string; to: string } {
  date(on);
  if (view === "day") return { from: on, to: on };
  if (view === "week") {
    const from = shift(on, -((new Date(on).getUTCDay() + 6) % 7));
    return { from, to: shift(from, 6) };
  }
  if (view === "month") {
    const from = on.slice(0, 7) + "-01";
    const d = new Date(from);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return { from, to: shift(d.toISOString().slice(0, 10), -1) };
  }
  return invalid("view must be day, week or month.");
}
function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shift(d, 1)) out.push(d);
  return out;
}
function emptyCoverage(): Coverage {
  return {
    expected: 0,
    measured: 0,
    unmeasured: 0,
    notMilked: 0,
    missing: 0,
    pending: 0,
    unexpected: 0,
    uncertain: 0,
    recordingPct: null,
    measurementPct: null,
  };
}
function finishCoverage(c: Coverage): Coverage {
  c.recordingPct = c.expected
    ? (100 * (c.measured + c.unmeasured + c.notMilked)) / c.expected
    : null;
  c.measurementPct = c.expected ? (100 * c.measured) / c.expected : null;
  return c;
}
function combine(cs: Coverage[]): Coverage {
  const out = emptyCoverage();
  for (const c of cs)
    for (const k of [
      "expected",
      "measured",
      "unmeasured",
      "notMilked",
      "missing",
      "pending",
      "unexpected",
      "uncertain",
    ] as const)
      out[k] += c[k];
  return finishCoverage(out);
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export interface AnalyticsData {
  animals: RegistryAnimalRow[];
  milk: RegistryMilkingRow[];
  lactations: LactationRow[];
  dispatch: DispatchRow[];
  destinations: DestinationRow[];
}

/** Pure domain calculation; a full selected population, never a visible table page. */
export function calculate(
  data: AnalyticsData,
  from: string,
  to: string,
  session: string,
  today: string,
): {
  metrics: MilkMetrics;
  buckets: AnalyticsBucket[];
  animals: ProductionRow[];
} {
  const selected = sessions.filter((s) => session === "all" || session === s);
  const lactBy = new Map<string, LactationRow[]>();
  for (const l of data.lactations)
    lactBy.set(l.animal_id, [...(lactBy.get(l.animal_id) ?? []), l]);
  const animalBy = new Map(data.animals.map((a) => [a.id, a]));
  const milkBy = new Map<string, RegistryMilkingRow[]>(),
    dispatchBy = new Map<string, DispatchRow[]>();
  for (const m of data.milk) {
    const k = m.occurred_on + "/" + m.session;
    milkBy.set(k, [...(milkBy.get(k) ?? []), m]);
  }
  for (const d of data.dispatch) {
    const k = d.occurred_on + "/" + d.session;
    dispatchBy.set(k, [...(dispatchBy.get(k) ?? []), d]);
  }
  const destBy = new Map(data.destinations.map((d) => [d.id, d]));
  const animalRows = new Map<string, ProductionRow>();
  const milked = new Set<string>();
  const eligible = new Map<string, number>();
  const animalDays = new Set<string>();
  function animalRow(id: string): ProductionRow {
    let r = animalRows.get(id);
    if (!r) {
      const a = animalBy.get(id);
      r = {
        id,
        identifier: id,
        name: a?.name ?? null,
        tag: a?.tag_no ?? null,
        litres: null,
        coverage: emptyCoverage(),
        eligibleAnimalDays: 0,
      };
      animalRows.set(id, r);
    }
    return r;
  }
  const buckets: AnalyticsBucket[] = [];
  for (const on of days(from, to)) {
    if (on > today) continue;
    const expected = new Map<string, LactationRow>();
    for (const [id, ls] of lactBy) {
      const l = lactationCovering(ls, on);
      if (l) expected.set(id, l);
    }
    for (const s of selected) {
      const key = on + "/" + s,
        milk = milkBy.get(key) ?? [],
        out = dispatchBy.get(key) ?? [];
      const byAnimal = new Map(milk.map((m) => [m.animal_id, m]));
      const c = emptyCoverage();
      for (const [id, l] of expected) {
        const a = animalRow(id),
          m = byAnimal.get(id);
        animalDays.add(id + "/" + on);
        c.expected++;
        a.coverage.expected++;
        if (
          l.start_precision !== "day" ||
          (l.end_precision !== null && l.end_precision !== "day")
        ) {
          c.uncertain++;
          a.coverage.uncertain++;
        }
        const k = !m
          ? on === today
            ? "pending"
            : "missing"
          : m.status === "measured"
            ? "measured"
            : m.status === "not_milked"
              ? "notMilked"
              : "unmeasured";
        c[k]++;
        a.coverage[k]++;
      }
      for (const m of milk) {
        const a = animalRow(m.animal_id);
        if (!expected.has(m.animal_id)) {
          c.unexpected++;
          a.coverage.unexpected++;
        }
        if (m.status !== "not_milked") milked.add(m.animal_id);
        if (m.status === "measured")
          a.litres = (a.litres ?? 0) + (m.yield_litres ?? 0);
      }
      const measured = milk.filter((m) => m.status === "measured");
      const produced = measured.length
        ? measured.reduce((n, m) => n + (m.yield_litres ?? 0), 0)
        : c.expected > 0 && c.notMilked === c.expected
          ? 0
          : null;
      const standing = data.destinations.filter(
        (d) => d.standing && activeOn(d, on),
      );
      const answered = new Set(out.map((d) => d.destination_id));
      const dispatchRecorded = standing.filter((d) =>
        answered.has(d.id),
      ).length;
      let sold = 0,
        nonSale = 0;
      const nonSaleByKind: Record<string, number> = {};
      for (const d of out)
        if (d.status === "taken") {
          const dest = destBy.get(d.destination_id);
          if (dest?.billable) sold += d.litres ?? 0;
          else {
            nonSale += d.litres ?? 0;
            const kind = dest?.kind ?? "unknown";
            nonSaleByKind[kind] = (nonSaleByKind[kind] ?? 0) + (d.litres ?? 0);
          }
        }
      const dispatched = out.length ? sold + nonSale : null;
      const missing = standing.length - dispatchRecorded;
      const reasons: string[] = [];
      if (c.unmeasured || c.missing) reasons.push("incomplete_production");
      if (c.pending) reasons.push("pending_production");
      if (c.unexpected) reasons.push("unexpected_production");
      if (c.uncertain) reasons.push("approximate_roster_dates");
      if (missing)
        reasons.push(on === today ? "pending_dispatch" : "incomplete_dispatch");
      if (dispatched === null) reasons.push("no_dispatch_records");
      if (produced === null) reasons.push("no_measurements");
      else if (produced === 0) reasons.push("zero_production");
      const difference =
        produced !== null && dispatched !== null ? produced - dispatched : null;
      buckets.push({
        key,
        on,
        session: s,
        coverage: finishCoverage(c),
        produced,
        sold,
        nonSale,
        dispatched,
        difference,
        differencePct:
          reasons.length || difference === null
            ? null
            : (100 * difference) / produced!,
        unavailableReasons: reasons,
        dispatchExpected: standing.length,
        dispatchRecorded,
        dispatchMissing: on < today ? missing : 0,
        dispatchPending: on === today ? missing : 0,
        dispatchRows: out.length,
        nonSaleByKind,
        milkedAnimals: new Set(
          milk.filter((m) => m.status !== "not_milked").map((m) => m.animal_id),
        ).size,
        meanDailyYield: null,
        eligibleAnimalDays: 0,
        excludedAnimalDays: 0,
      });
    }
    if (session === "all")
      for (const id of expected.keys()) {
        const ms = sessions.map((s) =>
          (milkBy.get(on + "/" + s) ?? []).find((m) => m.animal_id === id),
        );
        if (ms.every((m) => m?.status === "measured")) {
          const value = ms.reduce((n, m) => n + (m!.yield_litres ?? 0), 0);
          eligible.set(id + "/" + on, value);
          animalRow(id).eligibleAnimalDays++;
        }
      }
  }
  const metrics = aggregate(buckets);
  metrics.milkedAnimals = milked.size;
  metrics.eligibleAnimalDays = eligible.size;
  metrics.excludedAnimalDays = animalDays.size - eligible.size;
  metrics.meanDailyYield = eligible.size
    ? [...eligible.values()].reduce((a, b) => a + b, 0) / eligible.size
    : null;
  const animals = [...animalRows.values()].map((a) => ({
    ...a,
    litres: a.litres === null ? null : round(a.litres),
    coverage: finishCoverage(a.coverage),
  }));
  return { metrics, buckets, animals };
}
export function aggregate(buckets: AnalyticsBucket[]): MilkMetrics {
  const sum = (
    k:
      | "sold"
      | "nonSale"
      | "dispatchExpected"
      | "dispatchRecorded"
      | "dispatchMissing"
      | "dispatchPending"
      | "dispatchRows",
  ) => buckets.reduce((n, b) => n + b[k], 0);
  const values = (k: "produced" | "dispatched") => {
    const bs = buckets.filter((b) => b[k] !== null);
    return bs.length ? bs.reduce((n, b) => n + b[k]!, 0) : null;
  };
  const produced = values("produced"),
    dispatched = values("dispatched");
  const reasons = [
    ...new Set(
      buckets.flatMap((b) =>
        b.unavailableReasons.filter((r) => r !== "zero_production"),
      ),
    ),
  ];
  if (!buckets.length) reasons.push("no_records");
  if (produced === 0) reasons.push("zero_production");
  const difference =
    produced !== null && dispatched !== null ? produced - dispatched : null;
  const nonSaleByKind: Record<string, number> = {};
  for (const b of buckets)
    for (const [k, v] of Object.entries(b.nonSaleByKind))
      nonSaleByKind[k] = (nonSaleByKind[k] ?? 0) + v;
  return {
    coverage: combine(buckets.map((b) => b.coverage)),
    produced,
    sold: sum("sold"),
    nonSale: sum("nonSale"),
    dispatched,
    difference,
    differencePct:
      reasons.length || difference === null
        ? null
        : (100 * difference) / produced!,
    unavailableReasons: reasons,
    dispatchExpected: sum("dispatchExpected"),
    dispatchRecorded: sum("dispatchRecorded"),
    dispatchMissing: sum("dispatchMissing"),
    dispatchPending: sum("dispatchPending"),
    dispatchRows: sum("dispatchRows"),
    nonSaleByKind,
    milkedAnimals: 0,
    meanDailyYield: null,
    eligibleAnimalDays: 0,
    excludedAnimalDays: 0,
  };
}

export function analytics(
  db: Db,
  query: Record<string, unknown>,
  now = new Date(),
): AnalyticsReport {
  const today = farmToday(now),
    on = date(scalar(query.on, today)),
    view = scalar(query.view, "day"),
    session = scalar(query.session, "all");
  if (!["all", ...sessions].includes(session))
    invalid("session must be all, morning or evening.");
  const range = bounds(view, on),
    previous = bounds(view, shift(range.from, -1));
  const currentEnd =
    range.to >= today && view !== "day" ? shift(today, -1) : range.to;
  const comparisonTo = currentEnd < range.from ? null : currentEnd;
  const length = comparisonTo ? days(range.from, comparisonTo).length : 0;
  const previousTo = length
    ? [previous.to, shift(previous.from, length - 1)].sort()[0]
    : null;
  return db.transaction(() => {
    const from = previous.from,
      to = range.to;
    const data: AnalyticsData = {
      animals: db
        .prepare("SELECT * FROM registry_animals")
        .all() as RegistryAnimalRow[],
      lactations: db
        .prepare(
          "SELECT * FROM registry_lactations ORDER BY animal_id, started_on",
        )
        .all() as LactationRow[],
      milk: db
        .prepare(
          "SELECT * FROM registry_milkings WHERE occurred_on BETWEEN ? AND ?",
        )
        .all(from, to) as RegistryMilkingRow[],
      dispatch: db
        .prepare(
          "SELECT * FROM registry_dispatches WHERE occurred_on BETWEEN ? AND ?",
        )
        .all(from, to) as DispatchRow[],
      destinations: (
        db.prepare("SELECT * FROM registry_destinations").all() as any[]
      ).map((d) => ({ ...d, billable: !!d.billable, standing: !!d.standing })),
    };
    const result = calculate(data, range.from, range.to, session, today);
    const c = comparisonTo
      ? calculate(data, range.from, comparisonTo, session, today).metrics
      : null;
    const p = previousTo
      ? calculate(data, previous.from, previousTo, session, today).metrics
      : null;
    const incomplete = (m: MilkMetrics) =>
      !m.coverage.expected ||
      m.coverage.missing +
        m.coverage.pending +
        m.coverage.unmeasured +
        m.coverage.unexpected +
        m.coverage.uncertain >
        0;
    const reason =
      !c || !p
        ? "No completed days to compare."
        : incomplete(c) || incomplete(p)
          ? "Comparison requires complete, exact production records."
          : p.produced === null || p.produced === 0
            ? "No nonzero baseline."
            : null;
    const search = scalar(query.search, "").trim().toLowerCase();
    if (search.length > 100) invalid("Search is limited to 100 characters.");
    const detailOn = scalar(query.detailOn, "");
    if (detailOn) date(detailOn);
    const detailSession = scalar(query.detailSession, session) || session;
    if (!["all", ...sessions].includes(detailSession))
      invalid("Invalid detail session.");
    const detail = detailOn
      ? calculate(data, detailOn, detailOn, detailSession, today)
      : result;
    if (detailOn && (detailOn < range.from || detailOn > range.to))
      invalid("Detail date must be within the selected period.");
    const kind = scalar(query.table, "production");
    if (!["production", "reconciliation"].includes(kind))
      invalid("Unknown analytics table.");
    const prodQuery = kind === "production" ? query : {},
      recQuery = kind === "reconciliation" ? query : {};
    const production = pageRows(
      detail.animals.filter((a) =>
        `${a.identifier} ${a.name ?? ""} ${a.tag ?? ""}`
          .toLowerCase()
          .includes(search),
      ),
      prodQuery,
      {
        identifier: (a, b) => a.identifier.localeCompare(b.identifier),
        litres: (a, b) => (a.litres ?? -1) - (b.litres ?? -1),
      },
      "identifier",
      (a, b) => a.id.localeCompare(b.id),
    );
    const reconciliation = pageRows(
      detail.buckets,
      recQuery,
      {
        date: (a, b) => a.key.localeCompare(b.key),
        difference: (a, b) =>
          (a.difference ?? -Infinity) - (b.difference ?? -Infinity),
      },
      "date",
      (a, b) => a.key.localeCompare(b.key),
    );
    // Explicit session order, not alphabetical morning/evening order.
    if (reconciliation.sort === "date") {
      const ordered = [...detail.buckets].sort(
        (a, b) =>
          (reconciliation.direction === "asc" ? 1 : -1) *
          (a.on.localeCompare(b.on) || (a.session === "morning" ? -1 : 1)),
      );
      reconciliation.items = ordered.slice(
        (reconciliation.page - 1) * reconciliation.pageSize,
        reconciliation.page * reconciliation.pageSize,
      );
    }
    const buckets =
      view === "day"
        ? result.buckets
        : days(range.from, range.to)
            .filter((d) => d <= today)
            .map((d) => ({
              key: d,
              on: d,
              session: "all",
              ...aggregate(result.buckets.filter((b) => b.on === d)),
            }));
    return {
      metricVersion: 1,
      generatedAt: now.toISOString(),
      timezone: FARM_TZ,
      scope: { view, on, ...range, session, inProgress: range.to >= today },
      metrics: result.metrics,
      buckets,
      production,
      reconciliation,
      comparison: {
        from: c ? range.from : null,
        to: comparisonTo,
        previousFrom: p ? previous.from : null,
        previousTo,
        current: c?.produced ?? null,
        previous: p?.produced ?? null,
        currentDays: length,
        previousDays: previousTo ? days(previous.from, previousTo).length : 0,
        currentDailyAverage:
          c?.produced === null || !c || !length ? null : c.produced / length,
        previousDailyAverage:
          p?.produced === null || !p || !previousTo
            ? null
            : p.produced / days(previous.from, previousTo).length,
        percent: reason
          ? null
          : (100 * (c!.produced! - p!.produced!)) / p!.produced!,
        reason,
      },
    };
  })();
}
