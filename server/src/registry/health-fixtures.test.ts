import assert from "node:assert/strict";
import { test } from "node:test";
import { staffedHerd } from "./fixtures";
import { addHealthFixtures } from "./health-fixtures";
import { checkHealth, healthList } from "./health";
import { healthBoard, lifeReport } from "./health-reads";

test("health walkthrough covers records, evidence, due work and audit without duplicating on replay", () => {
  const on = "2026-09-15";
  const { db } = staffedHerd(on);
  try {
    const refs = addHealthFixtures(db, on);
    assert.deepEqual(checkHealth(db), []);
    for (const entity of [
      "visits",
      "examinations",
      "cases",
      "products",
      "plans",
      "tasks",
      "administrations",
      "results",
      "costs",
    ] as const)
      assert.ok(healthList(db, entity).length, entity);
    const tasks = healthList(db, "tasks");
    for (const status of ["pending", "completed", "missed", "cancelled"])
      assert.ok(
        tasks.some((t) => t.status === status),
        status,
      );
    const board = healthBoard(db, on);
    for (const standing of ["due", "overdue", "upcoming"])
      assert.ok(
        board.tasks.some((t) => t.standing === standing),
        standing,
      );
    assert.ok(board.withdrawals.some((w) => w.status === "active"));
    assert.ok(
      board.withdrawals.some((w) => w.status === "needs_clarification"),
    );
    assert.ok(healthList(db, "cases").some((c) => c.status === "closed"));
    assert.ok(
      tasks.some((t) => t.kind === "recheck" && t.status === "completed"),
    );
    const dose = healthList(db, "administrations").find(
      (r) => r.id === refs.dose,
    )!;
    assert.equal(dose.revision, 2);
    const report = lifeReport(db, dose.animal_id!);
    assert.ok(report.health.visits.length);
    assert.equal(
      (
        db
          .prepare("SELECT count(*) n FROM registry_health_attachment_links")
          .get() as any
      ).n,
      1,
    );
    const count = (
      db
        .prepare("SELECT count(*) n FROM registry_health_revisions")
        .get() as any
    ).n;
    assert.deepEqual(addHealthFixtures(db, on), refs);
    assert.equal(
      (
        db
          .prepare("SELECT count(*) n FROM registry_health_revisions")
          .get() as any
      ).n,
      count,
    );
    assert.deepEqual(checkHealth(db), []);
  } finally {
    db.close();
  }
});
