import assert from "node:assert/strict";
import { test } from "node:test";
import { freshDb, staffedHerd, AS_OF } from "./fixtures";
import {
  checkFeed,
  feedDaily,
  feedGet,
  feedList,
  feedSave,
  feedRemove,
  feedOverview,
  feedRecipients,
  feedStanding,
  type FeedData,
} from "./feed";
import { addFeedFixtures } from "./feed-fixtures";
import { dumpRecordTables } from "./backup";
import { harnessApp } from "./harness";
import { applyRegistrySchema, MIGRATIONS } from "./schema";
import Database from "better-sqlite3";
const by = { source_form: "direct_entry", recorded_by: "tester" };
function fixture() {
  const { db } = staffedHerd(AS_OF);
  return { db, ...addFeedFixtures(db, AS_OF) };
}
function count(db: ReturnType<typeof freshDb>, table: string) {
  return (db.prepare("SELECT COUNT(*) n FROM " + table).get() as { n: number })
    .n;
}
test("migration 8 preserves every existing populated table without seed", () => {
  const { db } = staffedHerd(AS_OF);
  const before = db.prepare("SELECT * FROM registry_animals").all();
  assert.deepEqual(applyRegistrySchema(db).applied, 0);
  assert.deepEqual(db.prepare("SELECT * FROM registry_animals").all(), before);
  assert.equal(count(db, "registry_feed_daily"), 0);
  db.close();
});
test("unknown crop dates, measured rate, known trolley total and unknown costs survive reads", () => {
  const f = fixture();
  assert.equal(f.crop.sowing_on, null);
  assert.equal(f.crop.status, "cutting");
  assert.equal(f.measured.goods_minor, 2000000);
  assert.equal(f.measured.total_minor, 2010000);
  assert.equal(f.purchase.quantity, null);
  assert.equal(f.purchase.unit, "trolley");
  const o = feedOverview(f.db, AS_OF, AS_OF);
  assert.equal(o.unknown_costs, 1);
  assert.equal(o.mixed_days, 1);
  assert.equal(o.recorded, 1);
  assert.equal(o.quantities.find((q) => q.unit === "trolley")?.unmeasured, 1);
  f.db.close();
});
test("rate incompatibility, nonpositive quantities, invalid dates, blank account and missing provenance refuse", () => {
  const f = fixture();
  for (const body of [
    { ...f.measured, unit: "bag" },
    { ...f.measured, quantity: 0 },
    { ...f.measured, quantity: Infinity },
    { ...f.measured, on: "2026-02-30" },
    { ...f.measured, recorded_by: "" },
  ])
    assert.throws(() => feedSave(f.db, "purchases", body, f.measured.id));
  assert.throws(() =>
    feedSave(f.db, "daily", {
      revision: 0,
      ...by,
      on: "2026-08-01",
      lines: [],
    }),
  );
  f.db.close();
});
test("unrecorded, partial and none-given are distinct", () => {
  const db = freshDb();
  assert.equal(feedStanding(db, AS_OF).state, "unrecorded");
  const p = feedSave(db, "daily", {
    revision: 0,
    ...by,
    on: AS_OF,
    fresh_status: "unknown",
    additional_status: "unknown",
    assessment: "unknown",
    lines: [],
  });
  assert.equal(p.completeness, "partial");
  const c = feedSave(
    db,
    "daily",
    {
      ...p,
      ...by,
      fresh_status: "none",
      additional_status: "none",
      assessment: "not_applicable",
    },
    p.id,
  );
  assert.equal(c.completeness, "complete");
  assert.equal(feedDaily(db, AS_OF)?.fresh_status, "none");
  db.close();
});
test("snapshots, sources, preparation and targeted purpose survive reload and correction", () => {
  const f = fixture();
  const d = feedDaily(f.db, AS_OF)!;
  const lines = d.lines as FeedData[];
  assert.deepEqual(
    lines[1].animal_ids as string[],
    feedRecipients(f.db, AS_OF).milking.map((a) => a.id),
  );
  assert.equal(lines[2].preparation, "water_mixed");
  assert.equal(lines[2].quantity, null);
  assert.equal(lines[3].purpose, "Operator-stated addition for this animal");
  const before = JSON.stringify(lines[1].animal_ids);
  f.db.prepare("DELETE FROM registry_lactations").run();
  const corrected = feedSave(
    f.db,
    "daily",
    { ...d, notes: "Corrected note", ...by },
    d.id,
  );
  assert.equal(
    JSON.stringify((corrected.lines as FeedData[])[1].animal_ids),
    before,
  );
  assert.equal(corrected.revision, 2);
  f.db.close();
});
test("stale revisions and occupied dates refuse without replacing either account", () => {
  const f = fixture();
  const d = f.daily;
  feedSave(f.db, "daily", { ...d, notes: "first tab", ...by }, d.id);
  assert.throws(
    () => feedSave(f.db, "daily", { ...d, notes: "stale tab", ...by }, d.id),
    /another tab/,
  );
  assert.equal(feedDaily(f.db, AS_OF)?.notes, "first tab");
  const latest = feedDaily(f.db, AS_OF)!;
  assert.throws(
    () => feedSave(f.db, "daily", { ...latest, on: "2026-08-31", ...by }, d.id),
    /already exists/,
  );
  f.db.close();
});
test("bad child insert rolls back header, lines and revision together", () => {
  const f = fixture();
  const d = f.daily;
  const before = count(f.db, "registry_feed_revisions");
  f.db.exec(
    "CREATE TRIGGER fail_feed_child BEFORE INSERT ON registry_feed_sources BEGIN SELECT RAISE(ABORT,'injected child failure'); END;",
  );
  assert.throws(
    () =>
      feedSave(f.db, "daily", { ...d, notes: "must roll back", ...by }, d.id),
    /injected child failure/,
  );
  assert.deepEqual(feedDaily(f.db, AS_OF), d);
  assert.equal(count(f.db, "registry_feed_revisions"), before);
  f.db.close();
});
test("linked purchase removal refuses, summary removal leaves a recoverable audit", () => {
  const f = fixture();
  assert.throws(
    () => feedRemove(f.db, "purchases", f.purchase.id, { revision: 1, ...by }),
    /linked/,
  );
  feedRemove(f.db, "daily", f.daily.id, { revision: 1, ...by });
  assert.equal(feedDaily(f.db, AS_OF), null);
  const r = f.db
    .prepare(
      "SELECT before_json FROM registry_feed_revisions WHERE entity_id=? AND operation='remove'",
    )
    .get(f.daily.id) as { before_json: string };
  assert.deepEqual(JSON.parse(r.before_json), f.daily);
  feedRemove(f.db, "purchases", f.purchase.id, { revision: 1, ...by });
  assert.throws(
    () => f.db.prepare("DELETE FROM registry_feed_revisions").run(),
    /append-only/,
  );
  f.db.close();
});
test("archived identities remain readable in historical accounts", () => {
  const f = fixture();
  feedSave(f.db, "items", { ...f.fodder, archived: true, ...by }, f.fodder.id);
  feedSave(
    f.db,
    "crops",
    { ...f.crop, status: "finished", archived: true, ...by },
    f.crop.id,
  );
  assert.equal(feedDaily(f.db, AS_OF)?.id, f.daily.id);
  assert.equal(feedGet(f.db, "crops", f.crop.id).cutting_end_on, null);
  f.db.close();
});
test("source mismatch, crop on concentrate and duplicate recipients refuse", () => {
  const f = fixture();
  const original = f.daily.lines as FeedData[];
  for (const line of [
    { ...original[1], sources: [{ kind: "crop", ref_id: f.crop.id }] },
    { ...original[1], sources: [{ kind: "purchase", ref_id: f.purchase.id }] },
    { ...original[1], animal_ids: ["BD-0001", "BD-0001"] },
  ])
    assert.throws(() =>
      feedSave(
        f.db,
        "daily",
        { ...f.daily, lines: [original[0], line], ...by },
        f.daily.id,
      ),
    );
  f.db.close();
});
test("backup SQL restores feed state, relational references and all revisions", () => {
  const f = fixture();
  const sql = dumpRecordTables(f.db, { source: ":memory:", stamp: "test" });
  const restored = freshDb();
  restored.exec(sql);
  assert.deepEqual(feedDaily(restored, AS_OF), f.daily);
  for (const table of ["lines", "sources", "recipients", "revisions"])
    assert.equal(
      count(restored, "registry_feed_" + table),
      count(f.db, "registry_feed_" + table),
    );
  assert.deepEqual(restored.pragma("foreign_key_check"), []);
  restored.close();
  f.db.close();
});
test("HTTP writes enforce provenance, durable replay, changed-key refusal and route scoping", async () => {
  const db = freshDb();
  let server = harnessApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  let port = (server.address() as { port: number }).port;
  const body = {
    revision: 0,
    ...by,
    label: "Khall",
    category: "concentrate",
    archived: false,
  };
  const post = (path: string, b: unknown, key?: string) =>
    fetch(`http://127.0.0.1:${port}/api/registry/feed/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify(b),
    });
  try {
    assert.equal((await post("items", body)).status, 400);
    assert.equal(
      (await post("items", { ...body, recorded_by: null }, "bad")).status,
      400,
    );
    const a = await (await post("items", body, "key")).json();
    assert.deepEqual(await (await post("items", body, "key")).json(), a);
    assert.equal(
      (await post("items", { ...body, label: "different" }, "key")).status,
      409,
    );
    await new Promise<void>((r) => server.close(() => r()));
    server = harnessApp(db).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    port = (server.address() as { port: number }).port;
    assert.deepEqual(await (await post("items", body, "key")).json(), a);
    assert.equal(count(db, "registry_feed_items"), 1);
    assert.equal(count(db, "registry_feed_revisions"), 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});

test("feed integrity detects relational drift without flagging unknown quantities or missing days", () => {
  const f = fixture();
  assert.deepEqual(checkFeed(f.db), []);
  f.db
    .prepare("DELETE FROM registry_feed_recipients WHERE line_id=?")
    .run((f.daily.lines as FeedData[])[1].id);
  assert.ok(
    checkFeed(f.db).some((v) =>
      v.detail.includes("recipient snapshot differs"),
    ),
  );
  f.db.close();
});
test("v7 upgrade adds feed while preserving populated milk, animal and payroll records", () => {
  const f = staffedHerd(AS_OF);
  const tables = [
    "registry_animals",
    "registry_milkings",
    "registry_wage_periods",
    "registry_wage_payments",
  ];
  const before = tables.map((t) => f.db.prepare("SELECT * FROM " + t).all());
  for (const t of [
    "recipients",
    "sources",
    "lines",
    "daily",
    "expenses",
    "purchases",
    "crops",
    "items",
    "revisions",
    "requests",
  ])
    f.db.exec("DROP TABLE registry_feed_" + t);
  f.db.pragma("user_version = 7");
  const result = applyRegistrySchema(f.db);
  assert.equal(result.applied, 1);
  assert.equal(result.to, 8);
  assert.deepEqual(
    tables.map((t) => f.db.prepare("SELECT * FROM " + t).all()),
    before,
  );
  assert.equal(count(f.db, "registry_feed_items"), 0);
  f.db.close();
});
test("unlinked purchased sources count honestly; linked purchases cannot change item or move past feeding", () => {
  const f = fixture();
  assert.throws(
    () =>
      feedSave(
        f.db,
        "purchases",
        { ...f.purchase, item_id: f.wanda.id },
        f.purchase.id,
      ),
    /linked/,
  );
  assert.throws(
    () =>
      feedSave(
        f.db,
        "purchases",
        { ...f.purchase, on: "2026-09-02" },
        f.purchase.id,
      ),
    /after a linked/,
  );
  const lines = structuredClone(f.daily.lines as FeedData[]);
  lines[0].sources = [{ kind: "purchased", ref_id: null }];
  feedSave(f.db, "daily", { ...f.daily, lines }, f.daily.id);
  assert.equal(feedOverview(f.db, AS_OF, AS_OF).purchased_days, 1);
  assert.deepEqual(checkFeed(f.db), []);
  f.db.close();
});
