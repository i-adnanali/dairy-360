/** Isolated performance fixture. Never imports the live database singleton. */
import { addDestination } from "../server/src/registry/destinations";
import { freshDb } from "../server/src/registry/fixtures";
import { addAcquiredAnimal } from "../server/src/registry/entry";
import { recordCalving } from "../server/src/registry/calving";
import { analytics, shift } from "../server/src/registry/analytics";
const db = freshDb();
try {
  const provenance = {
    source_form: "direct_entry" as const,
    recorded_by: "benchmark",
  };
  const ids: string[] = [];
  db.transaction(() => {
    for (let i = 0; i < 100; i++) {
      const a = addAcquiredAnimal(db, {
        sex: "female",
        acquired_on: "2020-01-01",
        date_precision: "day",
        provenance,
        asOf: "2026-09-15",
      });
      recordCalving(db, {
        dam_id: a.animal_id,
        occurred_on: "2023-09-15",
        date_precision: "day",
        calf: { sex: "female", outcome: "live" },
        provenance,
        asOf: "2026-09-15",
      });
      ids.push(a.animal_id);
    }
    const destination = addDestination(db, {
      name: "Fixture household",
      kind: "home",
      standing: true,
      started_on: "2023-09-15",
      recorded_by: "benchmark",
    });
    const dispatch = db.prepare(
      "INSERT INTO registry_dispatches (id,destination_id,occurred_on,session,status,litres,recorded_by,recorded_at,source_form) VALUES (?, ?, ?, ?, 'taken', 1000, 'benchmark', '2026-09-15T00:00:00Z', 'direct_entry')",
    );
    for (let day = "2023-09-15"; day < "2026-09-15"; day = shift(day, 1))
      for (const session of ["morning", "evening"])
        dispatch.run(day + session, destination.id, day, session);
    const insert = db.prepare(
      "INSERT INTO registry_milkings (id,animal_id,occurred_on,session,status,yield_litres,recorded_by,recorded_at,source_form) VALUES (?, ?, ?, ?, 'measured', 10, 'benchmark', '2026-09-15T00:00:00Z', 'direct_entry')",
    );
    for (let day = "2023-09-15"; day < "2026-09-15"; day = shift(day, 1))
      for (const id of ids)
        for (const session of ["morning", "evening"])
          insert.run(id + day + session, id, day, session);
  })();
  const query = { view: "month", on: "2026-08-15" },
    now = new Date("2026-09-15T00:00:00Z");
  analytics(db, query, now);
  const timings: number[] = [];
  let bytes = 0;
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const report = analytics(db, query, now);
    timings.push(performance.now() - start);
    bytes = Buffer.byteLength(JSON.stringify(report));
  }
  timings.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        animals: 100,
        rows: (
          db.prepare("SELECT count(*) n FROM registry_milkings").get() as any
        ).n,
        runs: 30,
        p95Ms: Math.round(timings[28]),
        maxMs: Math.round(timings[29]),
        payloadBytes: bytes,
        queryPlan: db
          .prepare(
            "EXPLAIN QUERY PLAN SELECT * FROM registry_milkings WHERE occurred_on BETWEEN ? AND ?",
          )
          .all("2026-08-01", "2026-08-31"),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
