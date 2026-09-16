import assert from "node:assert/strict";
import test from "node:test";
import { analytics, bounds, calculate, type AnalyticsData } from "./analytics";
import { pageRows } from "./pagination";
import { freshDb } from "./fixtures";
import { harnessApp } from "./harness";
import { addAcquiredAnimal } from "./entry";
import { recordCalving } from "./calving";
import { saveMilkingSession } from "./milking";
import type { RegistryMilkingRow, DestinationRow, DispatchRow } from "./types";

const on = "2026-09-14",
  today = "2026-09-15";
function data(): AnalyticsData {
  const animals = ["A", "B"].map((id) => ({
    id,
    name: id,
    sex: "female" as const,
    species: "buffalo",
    origin: "acquired" as const,
    post_no: null,
    tag_no: null,
  }));
  return {
    animals,
    lactations: animals.map((a) => ({
      id: "l" + a.id,
      animal_id: a.id,
      opened_by_event_id: "e" + a.id,
      started_on: "2026-09-01",
      start_precision: "day",
      ended_on: null,
      end_precision: null,
      end_reason: null,
      closed_by_event_id: null,
    })),
    milk: animals.flatMap((a) =>
      ["morning", "evening"].map(
        (session) =>
          ({
            id: a.id + session,
            animal_id: a.id,
            occurred_on: on,
            session,
            status: "measured",
            yield_litres: 10,
          }) as RegistryMilkingRow,
      ),
    ),
    dispatch: [],
    destinations: [],
  };
}
const calc = (d: AnalyticsData) => calculate(d, on, on, "all", today);
test("full animal-days, explicit exceptions and unmeasured sessions stay distinct", () => {
  const d = data();
  let r = calc(d);
  assert.equal(r.metrics.produced, 40);
  assert.equal(r.metrics.meanDailyYield, 20);
  assert.equal(r.metrics.coverage.measurementPct, 100);
  d.milk[0] = {
    ...d.milk[0],
    status: "milked_not_measured",
    yield_litres: null,
  };
  r = calc(d);
  assert.equal(r.metrics.produced, 30);
  assert.equal(r.metrics.coverage.recordingPct, 100);
  assert.equal(r.metrics.coverage.measurementPct, 75);
  assert.equal(r.metrics.eligibleAnimalDays, 1);
  assert.equal(r.metrics.excludedAnimalDays, 1);
  d.milk[0] = { ...d.milk[0], status: "not_milked" };
  r = calc(d);
  assert.equal(r.metrics.coverage.notMilked, 1);
  assert.equal(r.metrics.coverage.unmeasured, 0);
  assert.equal(r.metrics.eligibleAnimalDays, 1);
});
test("an entirely absent session or day remains expected; future and today are separate", () => {
  const d = data();
  d.milk = d.milk.filter((m) => m.session === "morning");
  let r = calc(d);
  assert.equal(r.metrics.coverage.expected, 4);
  assert.equal(r.metrics.coverage.missing, 2);
  assert.equal(r.metrics.coverage.recordingPct, 50);
  assert.equal(r.buckets[1].produced, null);
  d.milk = [];
  r = calc(d);
  assert.equal(r.metrics.coverage.missing, 4);
  assert.equal(r.metrics.produced, null);
  r = calculate(d, today, today, "all", today);
  assert.equal(r.metrics.coverage.pending, 4);
  assert.equal(r.metrics.coverage.missing, 0);
  r = calculate(d, "2026-09-16", "2026-09-16", "all", today);
  assert.equal(r.metrics.coverage.expected, 0);
  assert.equal(r.buckets.length, 0);
});
test("unexpected animal measurements cannot fill missing expected slots", () => {
  const d = data();
  d.milk[0] = { ...d.milk[0], animal_id: "C" };
  const r = calc(d);
  assert.equal(r.metrics.coverage.missing, 1);
  assert.equal(r.metrics.coverage.unexpected, 1);
  assert.equal(r.metrics.coverage.measured, 3);
});
test("approximate roster dates qualify coverage and block a confident percentage", () => {
  const d = data();
  d.lactations[0].start_precision = "month";
  const r = calc(d);
  assert.equal(r.metrics.coverage.uncertain, 2);
  assert.ok(r.metrics.unavailableReasons.includes("approximate_roster_dates"));
});
function dispatches(d: AnalyticsData) {
  d.destinations = [
    {
      id: "sale",
      name: "Buyer",
      kind: "dodhi",
      billable: true,
      standing: true,
      started_on: "2026-01-01",
      ended_on: null,
    },
    {
      id: "home",
      name: "House",
      kind: "home",
      billable: false,
      standing: false,
      started_on: "2026-01-01",
      ended_on: null,
    },
    {
      id: "staff",
      name: "Staff",
      kind: "staff",
      billable: false,
      standing: false,
      started_on: "2026-01-01",
      ended_on: null,
    },
  ] as DestinationRow[];
  d.dispatch = [
    {
      id: "1",
      destination_id: "sale",
      occurred_on: on,
      session: "morning",
      status: "taken",
      litres: 30,
    },
    {
      id: "2",
      destination_id: "sale",
      occurred_on: on,
      session: "evening",
      status: "none",
      litres: null,
    },
    {
      id: "3",
      destination_id: "home",
      occurred_on: on,
      session: "morning",
      status: "taken",
      litres: 2,
    },
    {
      id: "4",
      destination_id: "staff",
      occurred_on: on,
      session: "morning",
      status: "taken",
      litres: 3,
    },
  ] as DispatchRow[];
}
test("signed difference includes staff/home and suppresses missing dispatch percentage", () => {
  const d = data();
  dispatches(d);
  let r = calc(d);
  assert.equal(r.metrics.dispatched, 35);
  assert.equal(r.metrics.difference, 5);
  assert.equal(r.metrics.differencePct, 12.5);
  assert.equal(r.metrics.nonSaleByKind["staff"], 3);
  d.dispatch = d.dispatch.filter((x) => x.id !== "2");
  r = calc(d);
  assert.equal(r.metrics.dispatchMissing, 1);
  assert.equal(r.metrics.differencePct, null);
  d.dispatch[0].litres = 50;
  r = calc(d);
  assert.equal(r.metrics.difference, -15);
});
test("explicit not-milked slots account for zero; no records never become zero", () => {
  const d = data();
  dispatches(d);
  d.milk = d.milk.map((m) => ({
    ...m,
    status: "not_milked",
    yield_litres: null,
  }));
  let r = calc(d);
  assert.equal(r.metrics.produced, 0);
  assert.equal(r.metrics.differencePct, null);
  assert.ok(r.metrics.unavailableReasons.includes("zero_production"));
  d.milk = [];
  r = calc(d);
  assert.equal(r.metrics.produced, null);
});
test("calendar validation covers leap years and Monday week boundaries", () => {
  assert.deepEqual(bounds("month", "2024-02-15"), {
    from: "2024-02-01",
    to: "2024-02-29",
  });
  assert.deepEqual(bounds("week", "2026-09-20"), {
    from: "2026-09-14",
    to: "2026-09-20",
  });
  assert.throws(() => bounds("day", "2026-02-30"));
  assert.throws(() => bounds("year", on));
});
test("stable paging sorts before slicing, clamps removed pages, rejects invalid inputs", () => {
  const rows = Array.from({ length: 63 }, (_, id) => ({ id, n: id % 2 }));
  const page = (query: Record<string, unknown>) =>
    pageRows(
      rows,
      query,
      { n: (a, b) => a.n - b.n },
      "n",
      (a, b) => a.id - b.id,
    );
  assert.equal(page({}).items.length, 25);
  assert.equal(page({ page: "3" }).items.length, 13);
  assert.equal(page({ page: "4" }).page, 3);
  const all = [1, 2, 3].flatMap((n) =>
    page({ page: "" + n }).items.map((x) => x.id),
  );
  assert.equal(new Set(all).size, 63);
  assert.equal(page({ page: "2" }).totalItems, 63);
  for (const q of [
    { page: "0" },
    { page: "1.5" },
    { pageSize: "500" },
    { sort: "__proto__" },
    { direction: "oops" },
    { page: ["1", "2"] },
  ])
    assert.throws(() => page(q));
});
test("database report refreshes corrections; pagination never changes totals", () => {
  const db = freshDb();
  try {
    const p = { source_form: "direct_entry" as const, recorded_by: "test" };
    const a = addAcquiredAnimal(db, {
      sex: "female",
      acquired_on: "2020-01-01",
      date_precision: "day",
      provenance: p,
      asOf: today,
    });
    recordCalving(db, {
      dam_id: a.animal_id,
      occurred_on: "2026-09-01",
      date_precision: "day",
      calf: { sex: "female", outcome: "live" },
      provenance: p,
      asOf: today,
    });
    for (const session of ["morning", "evening"] as const)
      saveMilkingSession(db, {
        occurred_on: on,
        session,
        entries: [
          { animal_id: a.animal_id, status: "measured", yield_litres: 10 },
        ],
        provenance: p,
      });
    const query = { on, view: "month" };
    const now = new Date("2026-10-02T00:00:00Z");
    const before = analytics(db, query, now);
    assert.equal(before.metrics.produced, 20);
    assert.equal(before.metrics.coverage.expected, 60);
    assert.equal(before.reconciliation.totalItems, 60);
    const page = analytics(
      db,
      { ...query, table: "reconciliation", page: "3" },
      now,
    );
    assert.equal(page.reconciliation.items.length, 10);
    assert.deepEqual(page.metrics, before.metrics);
    saveMilkingSession(db, {
      occurred_on: on,
      session: "morning",
      entries: [
        { animal_id: a.animal_id, status: "measured", yield_litres: 12 },
      ],
      provenance: p,
    });
    assert.equal(analytics(db, query, now).metrics.produced, 22);
  } finally {
    db.close();
  }
});
test("HTTP exposes reports and validates query errors without opening live database", async () => {
  const db = freshDb(),
    server = harnessApp(db).listen(0);
  try {
    await new Promise<void>((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/api/registry`;
    const ok = await fetch(url + "/analytics/overview?on=" + on);
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as any).metrics.produced, null);
    for (const q of [
      "on=2026-02-30",
      "page=0",
      "pageSize=10000",
      "session=no",
      "view=no",
    ])
      assert.equal((await fetch(url + "/analytics/overview?" + q)).status, 400);
    assert.equal((await fetch(url + "/lists/animals?pageSize=25")).status, 200);
    assert.equal((await fetch(url + "/lists/no")).status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
