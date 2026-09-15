import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRegistrySchema } from "./schema";
import { cleanupHealthUploads } from "./health";
import { registryReadExecutors } from "../tools/registryReads";
import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { freshDb, addAcquired } from "./fixtures";
import {
  healthSave,
  healthGet,
  healthList,
  healthTaskAction,
  healthRound,
  healthVoid,
  healthRequest,
  healthUpload,
  checkHealth,
} from "./health";
import { lifeReport, healthBoard, healthWithdrawals } from "./health-reads";
import { dumpRecordTables } from "./backup";
import { healthRouter } from "./health-routes";
import express from "express";
const p = { recorded_by: "operator", source_form: "direct_entry" };
const d = { occurred_on: "2026-01-02", date_precision: "day" };
function setup() {
  const db = freshDb();
  for (const id of ["BD-0001", "BD-0002"])
    addAcquired(db, {
      id,
      acquired_on: "2020-01-01",
      acquired_precision: "day",
      sex: "female",
    });
  return db;
}
const dose = (animal_id = "BD-0001") => ({
  ...p,
  ...d,
  animal_id,
  product_name: "Fixture vaccine",
  kind: "vaccine",
  amount: 1,
  unit: "test unit",
  route: "recorded route",
  administrator: "fixture vet",
});
test("visit covers two animals, while cases and examinations remain individual", () => {
  const db = setup();
  try {
    const v = healthSave(db, "visits", {
      ...p,
      ...d,
      vet: "Doctor",
      reason: "Round",
      status: "open",
    });
    for (const animal_id of ["BD-0001", "BD-0002"])
      healthSave(db, "examinations", {
        ...p,
        ...d,
        animal_id,
        visit_id: v.id,
        findings: "Observed",
      });
    assert.equal(healthList(db, "examinations").length, 2);
    assert.equal(lifeReport(db, "BD-0001").health.visits.length, 1);
    assert.deepEqual(checkHealth(db), []);
  } finally {
    db.close();
  }
});
test("plan is not doses; actual administration completes one task; void reopens it", () => {
  const db = setup();
  try {
    const plan = healthSave(db, "plans", {
      ...p,
      animal_id: "BD-0001",
      kind: "vaccination",
      instructions: "Vet instructions",
      prescriber: "Doctor",
      status: "active",
    });
    const tasks = [1, 2, 3].map((n) =>
      healthSave(db, "tasks", {
        ...p,
        animal_id: "BD-0001",
        plan_id: plan.id,
        kind: "administration",
        instructions: "Dose " + n,
        due_on: `2026-01-0${n + 1}`,
      }),
    );
    assert.equal(healthList(db, "administrations").length, 0);
    const a = healthSave(db, "administrations", {
      ...dose(),
      task_id: tasks[0].id,
    });
    assert.equal(healthGet(db, tasks[0].id).status, "completed");
    assert.equal(
      healthBoard(db, "2026-01-04").tasks.filter((t) => t.status === "pending")
        .length,
      2,
    );
    healthVoid(db, a.id, {
      ...p,
      expected_revision: 1,
      reason: "Entered in error",
    });
    assert.equal(healthGet(db, tasks[0].id).status, "pending");
    assert.deepEqual(checkHealth(db), []);
  } finally {
    db.close();
  }
});
test("cross-animal linking is refused atomically", () => {
  const db = setup();
  try {
    const c = healthSave(db, "cases", {
      ...p,
      ...d,
      animal_id: "BD-0002",
      title: "Problem",
      status: "open",
    });
    assert.throws(
      () => healthSave(db, "administrations", { ...dose(), case_id: c.id }),
      /same animal/,
    );
    assert.equal(healthList(db, "administrations").length, 0);
  } finally {
    db.close();
  }
});
test("stale revision conflicts, old state and correction history survive", () => {
  const db = setup();
  try {
    const c = healthSave(db, "cases", {
      ...p,
      ...d,
      animal_id: "BD-0001",
      title: "Problem",
      status: "open",
    });
    healthSave(
      db,
      "cases",
      {
        ...p,
        expected_revision: 1,
        reason: "Follow-up",
        status: "resolved",
        outcome: "Resolved",
      },
      c.id,
    );
    assert.throws(
      () =>
        healthSave(
          db,
          "cases",
          { ...p, expected_revision: 1, reason: "Stale" },
          c.id,
        ),
      /changed/,
    );
    assert.equal(healthGet(db, c.id).status, "resolved");
    assert.deepEqual(checkHealth(db), []);
    assert.throws(
      () => db.prepare("DELETE FROM registry_health_revisions").run(),
      /append-only/,
    );
  } finally {
    db.close();
  }
});
test("round saves only given doses, audits deferral, and rolls back invalid batches", () => {
  const db = setup();
  try {
    const r = healthRound(db, {
      ...p,
      confirmed: true,
      shared: dose(),
      rows: [
        { animal_id: "BD-0001", disposition: "given" },
        {
          animal_id: "BD-0002",
          disposition: "deferred",
          reason: "Vet deferred",
          due_on: "2026-01-05",
        },
      ],
    });
    assert.equal(r.records.length, 2);
    assert.equal(healthList(db, "administrations").length, 1);
    const t = healthList(db, "tasks")[0];
    assert.equal(t.due_on, "2026-01-05");
    assert.equal(t.revision, 2);
    assert.throws(
      () =>
        healthRound(db, {
          ...p,
          confirmed: true,
          shared: { ...dose(), occurred_on: "2026-01-03" },
          rows: [
            { animal_id: "BD-0001", disposition: "given" },
            { animal_id: "bad", disposition: "given" },
          ],
        }),
      /Registry animal/,
    );
    assert.equal(healthList(db, "administrations").length, 1);
    assert.deepEqual(checkHealth(db), []);
  } finally {
    db.close();
  }
});
test("durable request binding survives fresh router/store and rejects changed request", () => {
  const db = setup();
  try {
    const call = () =>
      healthRequest(db, "key", "/health/administrations", dose(), () =>
        healthSave(db, "administrations", dose()),
      );
    const first = call();
    assert.deepEqual(call(), first);
    assert.equal(healthList(db, "administrations").length, 1);
    assert.throws(
      () =>
        healthRequest(
          db,
          "key",
          "/health/administrations",
          { ...dose(), amount: 2 },
          () => null,
        ),
      /different content/,
    );
  } finally {
    db.close();
  }
});
test("imprecise history preserves missing details and rejects invented precision", () => {
  const db = setup();
  try {
    const a = healthSave(db, "administrations", {
      ...dose(),
      occurred_on: "2025-01-01",
      date_precision: "year",
      amount: null,
      details_unknown: true,
      unknown_reason: "Old card illegible",
    });
    assert.equal(
      lifeReport(db, "BD-0001").health.vaccinations[0].date_precision,
      "year",
    );
    assert.equal(a.amount, null);
    assert.throws(
      () =>
        healthSave(db, "administrations", {
          ...dose(),
          date_precision: "month",
          occurred_on: "2026-01-02",
        }),
      /first day/,
    );
  } finally {
    db.close();
  }
});
test("due/overdue states include old tasks and use optional precise farm time", () => {
  const db = setup();
  try {
    for (const day of ["01", "02", "03"])
      healthSave(db, "tasks", {
        ...p,
        animal_id: "BD-0001",
        kind: "recheck",
        instructions: "Recheck",
        due_on: "2026-01-" + day,
      });
    const b = healthBoard(db, "2026-01-02");
    assert.equal(b.overdue, 1);
    assert.equal(b.due, 1);
    assert.equal(b.upcoming, 1);
    const t = healthSave(db, "tasks", {
      ...p,
      animal_id: "BD-0001",
      kind: "recheck",
      instructions: "Timed",
      due_on: "2026-01-02",
      due_time: "10:00",
    });
    assert.equal(
      healthBoard(db, "2026-01-02", "11:00").tasks.find((x) => x.id === t.id)
        ?.standing,
      "overdue",
    );
  } finally {
    db.close();
  }
});
test("withdrawal instructions remain unresolved or active without fabricated release", () => {
  const db = setup();
  try {
    healthSave(db, "administrations", {
      ...dose(),
      milk_withdrawal: {
        state: "specified",
        instruction: "As prescribed",
        issuer: "Doctor",
      },
      meat_withdrawal: {
        state: "none",
        instruction: "None specified",
        issuer: "Doctor",
      },
    });
    const w = healthWithdrawals(db, "BD-0001", "2026-01-03T00:00:00Z");
    assert.equal(w.length, 1);
    assert.equal(w[0].status, "needs_clarification");
    assert.throws(
      () =>
        healthSave(db, "administrations", {
          ...dose(),
          duplicate_reason: "different",
          milk_withdrawal: {
            state: "specified",
            instruction: "As prescribed",
            issuer: "Doctor",
            until: "tomorrow",
          },
        }),
      /timestamp/,
    );
  } finally {
    db.close();
  }
});
test("backup restores bytes, records, audit and durable keys", () => {
  const db = setup();
  const target = freshDb();
  try {
    const attachment = healthUpload(db, {
      ...p,
      filename: "card.pdf",
      base64: Buffer.from("%PDF-1.4\nfixture").toString("base64"),
    });
    const a = healthSave(db, "administrations", {
      ...dose(),
      attachment_ids: [attachment.id],
    });
    const dump = dumpRecordTables(db, { source: "fixture", stamp: "fixture" });
    target.exec(dump);
    assert.equal(healthGet(target, a.id).attachment_ids[0], attachment.id);
    assert.deepEqual(checkHealth(target), []);
    assert.equal((target.pragma("foreign_key_check") as any[]).length, 0);
    assert.throws(
      () =>
        target
          .prepare("UPDATE registry_health_attachments SET filename=?")
          .run("x"),
      /immutable/,
    );
  } finally {
    db.close();
    target.close();
  }
});
test("report exposes gaps, direct/shared costs separately, no invented animal profit", () => {
  const db = setup();
  try {
    const v = healthSave(db, "visits", {
      ...p,
      ...d,
      vet: "Doctor",
      reason: "Routine",
      status: "open",
    });
    healthSave(db, "administrations", { ...dose(), visit_id: v.id });
    healthSave(db, "costs", {
      ...p,
      ...d,
      visit_id: v.id,
      currency: "PKR",
      amount_minor: 1000,
    });
    const r = lifeReport(db, "BD-0001");
    assert.equal(r.sections.growth.state, "not_supported");
    assert.equal(r.sections.financial.records.length, 0);
    assert.equal(r.sections.shared_visit_costs.records.length, 1);
    assert.equal(r.sections.production.state, "no_records");
  } finally {
    db.close();
  }
});
test("follow-up result completes task and void restores pending work", () => {
  const db = setup();
  try {
    const t = healthSave(db, "tasks", {
      ...p,
      animal_id: "BD-0001",
      kind: "recheck",
      due_on: "2026-01-02",
      instructions: "Recheck",
    });
    const r = healthSave(db, "results", {
      ...p,
      ...d,
      animal_id: "BD-0001",
      kind: "follow_up",
      result: "Improved",
      task_id: t.id,
    });
    assert.equal(healthGet(db, t.id).status, "completed");
    healthVoid(db, r.id, {
      ...p,
      expected_revision: 1,
      reason: "Wrong finding",
    });
    assert.equal(healthGet(db, t.id).status, "pending");
    assert.deepEqual(checkHealth(db), []);
  } finally {
    db.close();
  }
});
test("task terminal state cannot be forged via create/revise", () => {
  const db = setup();
  try {
    assert.throws(
      () =>
        healthSave(db, "tasks", {
          ...p,
          animal_id: "BD-0001",
          kind: "recheck",
          due_on: "2026-01-02",
          instructions: "Recheck",
          status: "completed",
        }),
      /task actions/,
    );
  } finally {
    db.close();
  }
});
test("HTTP health write requires key and reads/downloads return bounded contracts", async () => {
  const db = setup();
  const app = express();
  app.use(express.json());
  app.use(healthRouter(db));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  try {
    const base = `http://127.0.0.1:${port}`;
    let response = await fetch(base + "/health/administrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dose()),
    });
    assert.equal(response.status, 400);
    response = await fetch(base + "/health/administrations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "http",
      },
      body: JSON.stringify(dose()),
    });
    assert.equal(response.status, 200);
    response = await fetch(base + "/animals/BD-0001/life-report");
    assert.equal(
      ((await response.json()) as any).health.vaccinations.length,
      1,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});

test("empty optional animal selection from a visit form stores null", () => {
  const db = setup();
  try {
    const v = healthSave(db, "visits", {
      ...p,
      ...d,
      animal_id: "",
      vet: "Doctor",
      reason: "Routine",
      status: "open",
    });
    assert.equal(v.animal_id, null);
    healthSave(
      db,
      "visits",
      {
        ...p,
        expected_revision: 1,
        correction_reason: "Close encounter",
        status: "closed",
      },
      v.id,
    );
    assert.equal(healthGet(db, v.id).reason, "Routine");
  } finally {
    db.close();
  }
});

test("completed plans retain exceptions and reopen when their dose is voided", () => {
  const db = setup();
  try {
    const plan = healthSave(db, "plans", {
      ...p,
      animal_id: "BD-0001",
      kind: "treatment",
      instructions: "Recorded course",
      prescriber: "Doctor",
      status: "active",
    });
    const task = healthSave(db, "tasks", {
      ...p,
      animal_id: "BD-0001",
      plan_id: plan.id,
      kind: "administration",
      instructions: "Dose",
      due_on: "2026-01-02",
    });
    const a = healthSave(db, "administrations", {
      ...dose(),
      task_id: task.id,
    });
    healthSave(
      db,
      "plans",
      {
        ...p,
        expected_revision: 1,
        correction_reason: "Course accounted for",
        status: "completed",
      },
      plan.id,
    );
    healthVoid(db, a.id, {
      ...p,
      expected_revision: 1,
      reason: "Mistaken dose",
    });
    assert.equal(healthGet(db, plan.id).status, "active");
  } finally {
    db.close();
  }
});
test("linked attachment bytes cannot be replaced and only unlinked staging uploads expire", () => {
  const db = setup();
  try {
    const body = {
      ...p,
      filename: "card.pdf",
      base64: Buffer.from("%PDF-1.4\nfixture").toString("base64"),
    };
    const a = healthUpload(db, body);
    healthSave(db, "administrations", { ...dose(), attachment_ids: [a.id] });
    assert.throws(
      () =>
        db
          .prepare(
            "INSERT OR REPLACE INTO registry_health_attachments SELECT * FROM registry_health_attachments WHERE id=?",
          )
          .run(a.id),
      /immutable/,
    );
  } finally {
    db.close();
  }
});
test("backdated board does not show an administration that had not happened yet", () => {
  const db = setup();
  try {
    healthSave(db, "administrations", dose());
    assert.equal(
      healthWithdrawals(db, "BD-0001", "2026-01-01T00:00:00Z").length,
      0,
    );
  } finally {
    db.close();
  }
});

test("request replay remains durable after the database connection restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "dairy-health-restart-"));
  let db = new Database(join(dir, "test.db"));
  try {
    applyRegistrySchema(db);
    addAcquired(db, {
      id: "BD-0001",
      sex: "female",
      acquired_on: "2020-01-01",
      acquired_precision: "day",
    });
    const first = healthRequest(db, "durable", "/dose", dose(), () =>
      healthSave(db, "administrations", dose()),
    );
    db.close();
    db = new Database(join(dir, "test.db"));
    applyRegistrySchema(db);
    const replay = healthRequest(db, "durable", "/dose", dose(), () => {
      throw new Error("Must not execute again");
    });
    assert.deepEqual(replay, first);
    assert.equal(healthList(db, "administrations").length, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("registry assistant returns real health evidence and coverage, never demo IDs", () => {
  const db = setup();
  try {
    healthSave(db, "administrations", dose());
    const reads = registryReadExecutors(db);
    const report = reads.get_registry_life_report({ serial: "BD-0001" })
      .modelDigest as any;
    assert.equal(report.health.vaccinations.length, 1);
    assert.equal(report.sections.growth.state, "not_supported");
    const error = reads.get_registry_health({ serial: "animal_001" })
      .modelDigest as any;
    assert.equal(error.error, "unknown_animal");
  } finally {
    db.close();
  }
});
test("unlinked staging cleanup retains all linked documents", () => {
  const db = setup();
  try {
    const body = {
      ...p,
      filename: "card.pdf",
      base64: Buffer.from("%PDF-1.4 fixture").toString("base64"),
    };
    const a = healthUpload(db, body);
    healthUpload(db, body);
    healthSave(db, "administrations", { ...dose(), attachment_ids: [a.id] });
    const later = new Date(Date.now() + 8 * 86400000);
    assert.equal(cleanupHealthUploads(db, later), 1);
    assert.deepEqual(checkHealth(db), []);
  } finally {
    db.close();
  }
});

test("precise future task time is upcoming while imprecise report dates overlap filters", () => {
  const db = setup();
  try {
    const t = healthSave(db, "tasks", {
      ...p,
      animal_id: "BD-0001",
      kind: "recheck",
      instructions: "Later today",
      due_on: "2026-01-02",
      due_time: "15:00",
    });
    assert.equal(
      healthBoard(db, "2026-01-02", "10:00").tasks.find((r) => r.id === t.id)
        ?.standing,
      "upcoming",
    );
    healthSave(db, "administrations", {
      ...dose(),
      occurred_on: "2025-01-01",
      date_precision: "year",
    });
    const r = lifeReport(db, "BD-0001", {
      from: "2025-06-01",
      to: "2025-06-30",
    });
    assert.ok(
      r.sections.health.records.some(
        (a: any) => a.entity === "administrations",
      ),
    );
  } finally {
    db.close();
  }
});

test("marking historical details unknown cannot legitimize a negative known amount", () => {
  const db = setup();
  try {
    assert.throws(
      () =>
        healthSave(db, "administrations", {
          ...dose(),
          details_unknown: true,
          unknown_reason: "Batch missing",
          amount: -2,
        }),
      /positive/,
    );
  } finally {
    db.close();
  }
});
