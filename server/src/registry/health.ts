import { createHash, randomUUID } from "node:crypto";
import type { Db } from "./schema";
import { bodyHash } from "./idempotency";
import { farmToday } from "./time";

export const HEALTH_ENTITIES = [
  "visits",
  "examinations",
  "cases",
  "products",
  "plans",
  "tasks",
  "administrations",
  "results",
  "costs",
] as const;
export type HealthEntity = (typeof HEALTH_ENTITIES)[number];
export type HealthRecord = Record<string, any> & {
  id: string;
  entity: HealthEntity;
  revision: number;
};
export class HealthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public field?: string,
  ) {
    super(message);
  }
  toWire() {
    return { error: this.code, message: this.message, field: this.field };
  }
}
function fail(message: string, field?: string): never {
  throw new HealthError("health_invalid", message, 400, field);
}
export function healthEntity(value: string): HealthEntity {
  if (!(HEALTH_ENTITIES as readonly string[]).includes(value))
    throw new HealthError(
      "health_not_found",
      "Unknown health record type.",
      404,
    );
  return value as HealthEntity;
}
export function healthObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Expected an object.");
  return value as Record<string, any>;
}
function required(b: Record<string, any>, key: string): string {
  if (typeof b[key] !== "string" || !b[key].trim())
    fail(`${key.replaceAll("_", " ")} is required.`, key);
  return b[key].trim();
}
function choice(b: Record<string, any>, key: string, options: string[]) {
  if (!options.includes(b[key]))
    fail(`Choose ${key.replaceAll("_", " ")}: ${options.join(", ")}.`, key);
}
export function healthDate(value: unknown, field = "occurred_on"): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail("Enter a valid calendar date.", field);
  return value;
}
function knownDate(b: Record<string, any>) {
  const d = healthDate(b.occurred_on);
  choice(b, "date_precision", ["day", "month", "year", "estimated"]);
  if (b.date_precision === "month" && !d.endsWith("-01"))
    fail("Month precision uses the first day.", "occurred_on");
  if (["year", "estimated"].includes(b.date_precision) && !d.endsWith("-01-01"))
    fail("Year/estimated precision uses January 1.", "occurred_on");
  if (
    b.occurred_time &&
    (b.date_precision !== "day" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.occurred_time))
  )
    fail("A time requires an exact day and HH:MM.", "occurred_time");
}
export function healthGet(db: Db, id: string): HealthRecord {
  const row = db
    .prepare("SELECT data FROM registry_health_records WHERE id=?")
    .get(id) as { data: string } | undefined;
  if (!row)
    throw new HealthError("health_not_found", "Health record not found.", 404);
  return JSON.parse(row.data);
}
export function healthList(
  db: Db,
  entity?: HealthEntity,
  animal?: string,
  includeVoided = false,
): HealthRecord[] {
  const rows = db
    .prepare(
      "SELECT data FROM registry_health_records WHERE (? IS NULL OR entity=?) AND (? IS NULL OR animal_id=?) ORDER BY COALESCE(json_extract(data,'$.occurred_on'),json_extract(data,'$.due_on'),json_extract(data,'$.recorded_at')),id",
    )
    .all(entity ?? null, entity ?? null, animal ?? null, animal ?? null) as {
    data: string;
  }[];
  return rows
    .map((r) => JSON.parse(r.data))
    .filter((r) => includeVoided || !r.voided);
}
function animalExists(db: Db, id: string) {
  if (!db.prepare("SELECT 1 FROM registry_animals WHERE id=?").get(id))
    throw new HealthError(
      "unknown_animal",
      "Registry animal not found.",
      404,
      "animal_id",
    );
}
function provenance(b: Record<string, any>) {
  required(b, "recorded_by");
  choice(b, "source_form", [
    "daily_herd_sheet",
    "cycle_card",
    "direct_entry",
    "import",
    "recall",
  ]);
  return {
    recorded_by: b.recorded_by,
    source_form: b.source_form,
    source_ref: b.source_ref ?? null,
    observed_by: b.observed_by ?? null,
  };
}
const LINKS: Record<string, HealthEntity> = {
  visit_id: "visits",
  examination_id: "examinations",
  case_id: "cases",
  plan_id: "plans",
  task_id: "tasks",
  product_id: "products",
};
function validate(db: Db, r: HealthRecord, old?: HealthRecord) {
  if (r.animal_id) animalExists(db, required(r, "animal_id"));
  if (!["visits", "products", "costs"].includes(r.entity))
    required(r, "animal_id");
  if (old && r.animal_id !== old.animal_id)
    fail(
      "Animal identity cannot be changed. Void and re-enter the record.",
      "animal_id",
    );
  for (const [key, entity] of Object.entries(LINKS))
    if (r[key]) {
      const ref = healthGet(db, required(r, key));
      if (ref.voided || ref.entity !== entity) fail(`Invalid ${key}.`, key);
      if (ref.animal_id && ref.animal_id !== r.animal_id)
        fail("Linked health records must belong to the same animal.", key);
      if (key === "examination_id" && r.visit_id && ref.visit_id !== r.visit_id)
        fail("Examination belongs to a different visit.", key);
      if (key === "task_id" && r.plan_id && ref.plan_id !== r.plan_id)
        fail("Task belongs to a different plan.", key);
    }
  if (r.case_ids !== undefined) {
    if (!Array.isArray(r.case_ids)) fail("Cases must be a list.", "case_ids");
    for (const id of r.case_ids) {
      const c = healthGet(db, id);
      if (c.entity !== "cases" || c.voided || c.animal_id !== r.animal_id)
        fail("Invalid case link.", "case_ids");
    }
  }
  if (
    r.person_id &&
    !db.prepare("SELECT 1 FROM registry_people WHERE id=?").get(r.person_id)
  )
    fail("Unknown person.", "person_id");
  if (
    [
      "visits",
      "examinations",
      "cases",
      "administrations",
      "results",
      "costs",
    ].includes(r.entity)
  ) {
    knownDate(r);
    if (
      r.occurred_time &&
      Date.parse(`${r.occurred_on}T${r.occurred_time}:00+05:00`) > Date.now()
    )
      fail(
        "Actual administration time cannot be in the future.",
        "occurred_time",
      );
    if (r.occurred_on > farmToday())
      fail(
        "Actual records cannot be future-dated. Use a planned task.",
        "occurred_on",
      );
  }
  if (r.entity === "visits") {
    required(r, "reason");
    required(r, "vet");
    choice(r, "status", ["open", "closed"]);
  }
  if (r.entity === "examinations") {
    required(r, "visit_id");
    required(r, "findings");
    if (r.diagnosis) choice(r, "certainty", ["suspected", "confirmed"]);
  }
  if (r.entity === "cases") {
    required(r, "title");
    choice(r, "status", ["open", "resolved", "closed"]);
    if (r.status !== "open") {
      required(r, "outcome");
      const plans = healthList(db, "plans", r.animal_id).filter(
        (p) => p.case_id === r.id && p.status === "active",
      );
      if (plans.length && r.open_plans_reviewed !== true)
        fail(
          "Review active plans before closing this case.",
          "open_plans_reviewed",
        );
    }
  }
  if (r.entity === "products") {
    required(r, "name");
    choice(r, "kind", ["vaccine", "medicine", "other"]);
  }
  if (r.entity === "plans") {
    required(r, "instructions");
    required(r, "prescriber");
    choice(r, "kind", ["treatment", "vaccination"]);
    choice(r, "status", ["active", "completed", "stopped"]);
    if (
      r.status !== "active" &&
      healthList(db, "tasks", r.animal_id).some(
        (t) => t.plan_id === r.id && t.status === "pending",
      )
    )
      fail(
        "Account for outstanding tasks before finishing the plan.",
        "status",
      );
    if (r.status === "stopped" && !r.reason && !r.correction_reason)
      fail("Explain why the plan stopped.", "correction_reason");
    r.completed_with_exceptions =
      r.status === "completed" &&
      healthList(db, "tasks", r.animal_id).some(
        (t) => t.plan_id === r.id && ["cancelled", "missed"].includes(t.status),
      );
  }
  if (r.entity === "tasks") {
    required(r, "instructions");
    choice(r, "kind", ["administration", "recheck", "test"]);
    healthDate(r.due_on, "due_on");
    if (r.due_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.due_time))
      fail("Use HH:MM.", "due_time");
    choice(r, "status", ["pending", "completed", "missed", "cancelled"]);
    if (
      r.plan_id &&
      healthGet(db, r.plan_id).status !== "active" &&
      (!old || old.plan_id !== r.plan_id)
    )
      fail("New tasks require an active plan.", "plan_id");
  }
  if (r.entity === "administrations") {
    required(r, "product_name");
    choice(r, "kind", ["vaccine", "medicine", "other"]);
    if (
      r.amount != null &&
      (typeof r.amount !== "number" ||
        !Number.isFinite(r.amount) ||
        r.amount <= 0)
    )
      fail("A known amount must be positive.", "amount");
    if (r.details_unknown === true) required(r, "unknown_reason");
    else {
      if (
        typeof r.amount !== "number" ||
        !Number.isFinite(r.amount) ||
        r.amount <= 0
      )
        fail(
          "Enter a positive amount, or explicitly mark details unknown.",
          "amount",
        );
      required(r, "unit");
      required(r, "route");
      required(r, "administrator");
    }
    if (r.expiry) healthDate(r.expiry, "expiry");
    const origin = db
      .prepare(
        "SELECT occurred_on FROM registry_animal_events WHERE animal_id=? AND type IN ('birth','acquired') AND id NOT IN (SELECT supersedes_id FROM registry_animal_events WHERE supersedes_id IS NOT NULL) ORDER BY occurred_on LIMIT 1",
      )
      .get(r.animal_id) as { occurred_on: string } | undefined;
    const departure = db
      .prepare(
        "SELECT occurred_on FROM registry_animal_events WHERE animal_id=? AND type='departure' AND id NOT IN (SELECT supersedes_id FROM registry_animal_events WHERE supersedes_id IS NOT NULL) ORDER BY occurred_on DESC LIMIT 1",
      )
      .get(r.animal_id) as { occurred_on: string } | undefined;
    if (
      (origin && r.occurred_on < origin.occurred_on) ||
      (departure && r.occurred_on >= departure.occurred_on)
    )
      required(r, "external_history_reason");
    if (r.task_id) {
      const t = healthGet(db, r.task_id);
      if (
        t.kind !== "administration" ||
        ["cancelled", "missed"].includes(t.status)
      )
        fail("This task cannot be completed by an administration.", "task_id");
      if (t.product_id && t.product_id !== r.product_id)
        fail(
          "The product differs from the task; revise the instruction first.",
          "product_id",
        );
      if (
        healthList(db, "administrations").some(
          (a) => a.task_id === r.task_id && a.id !== r.id,
        )
      )
        fail("This task already has an administered dose.", "task_id");
    }
    for (const target of ["milk", "meat"]) {
      const w = healthObject(r[`${target}_withdrawal`] ?? { state: "unknown" });
      choice(w, "state", ["unknown", "none", "specified"]);
      if (w.state !== "unknown") {
        required(w, "instruction");
        required(w, "issuer");
      }
      if (w.until) {
        if (
          w.state !== "specified" ||
          typeof w.until !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(
            w.until,
          ) ||
          Number.isNaN(Date.parse(w.until))
        )
          fail("Withdrawal end needs an exact timestamp with timezone.");
        if (w.until.slice(0, 10) < r.occurred_on)
          fail("Withdrawal end precedes administration.");
      }
      r[`${target}_withdrawal`] = w;
    }
    const duplicate = healthList(db, "administrations", r.animal_id).some(
      (a) =>
        a.id !== r.id &&
        a.occurred_on === r.occurred_on &&
        a.product_name === r.product_name &&
        a.occurred_time === r.occurred_time,
    );
    if (!old && duplicate && !r.duplicate_reason)
      throw new HealthError(
        "health_duplicate",
        "A similar dose exists. Confirm it is distinct with a reason.",
        409,
        "duplicate_reason",
      );
  }
  if (r.entity === "results") {
    required(r, "result");
    choice(r, "kind", ["test", "follow_up"]);
  }
  if (r.entity === "costs") {
    if (!r.visit_id && !r.administration_id)
      fail("Link the cost to a visit or administration.");
    if (r.administration_id) {
      const a = healthGet(db, r.administration_id);
      if (
        a.entity !== "administrations" ||
        a.voided ||
        a.animal_id !== r.animal_id
      )
        fail("Invalid administration cost link.");
    }
    required(r, "currency");
    if (!/^[A-Z]{3}$/.test(r.currency))
      fail("Use a three-letter currency code.", "currency");
    if (
      r.amount_minor !== null &&
      (!Number.isSafeInteger(r.amount_minor) || r.amount_minor < 0)
    )
      fail(
        "Cost must be nonnegative minor currency units or unknown.",
        "amount_minor",
      );
  }
}
function persist(
  db: Db,
  r: HealthRecord,
  old: HealthRecord | undefined,
  b: Record<string, any>,
  operation: string,
) {
  const p = provenance(b),
    stamp = new Date().toISOString();
  r.recorded_by = p.recorded_by;
  r.recorded_at = stamp;
  r.source_form = p.source_form;
  r.source_ref = p.source_ref;
  r.observed_by = p.observed_by;
  r.revision = (old?.revision ?? 0) + 1;
  const data = JSON.stringify(r);
  if (old)
    db.prepare(
      "UPDATE registry_health_records SET revision=?, data=? WHERE id=? AND revision=?",
    ).run(r.revision, data, r.id, old.revision);
  else
    db.prepare("INSERT INTO registry_health_records VALUES (?,?,?,?,?)").run(
      r.id,
      r.entity,
      r.animal_id ?? null,
      r.revision,
      data,
    );
  db.prepare(
    "INSERT INTO registry_health_revisions VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    randomUUID(),
    r.id,
    r.revision,
    operation,
    b.correction_reason ?? b.reason ?? null,
    old ? JSON.stringify(old) : null,
    data,
    JSON.stringify(p),
    stamp,
  );
  for (const id of r.attachment_ids ?? []) {
    if (
      !db
        .prepare("SELECT 1 FROM registry_health_attachments WHERE id=?")
        .get(id)
    )
      fail("Attachment not found.", "attachment_ids");
    db.prepare(
      "INSERT INTO registry_health_attachment_links VALUES (?,?,?)",
    ).run(id, r.id, r.revision);
  }
  return r;
}
export function healthSave(
  db: Db,
  entity: HealthEntity,
  body: Record<string, any>,
  id?: string,
): HealthRecord {
  return db
    .transaction(() => {
      const old = id ? healthGet(db, id) : undefined;
      if (old && (old.entity !== entity || old.voided))
        fail("Cannot revise this record.");
      if (old && body.expected_revision !== old.revision)
        throw new HealthError(
          "health_conflict",
          "This record changed. Reload and review your changes.",
          409,
        );
      if (old && !body.correction_reason && !body.reason)
        fail("Enter a reason for the correction.", "correction_reason");
      const r = {
        ...old,
        ...body,
        id: id ?? randomUUID(),
        entity,
        revision: 0,
      } as HealthRecord;
      delete r.expected_revision;
      if (entity !== "administrations") {
        delete r.milk_withdrawal;
        delete r.meat_withdrawal;
      }
      for (const key of ["archived", "details_unknown", "open_plans_reviewed"])
        if (r[key] !== undefined && typeof r[key] !== "boolean")
          fail(`${key} must be true or false.`, key);
      if (r.animal_id === "") r.animal_id = null;
      for (const key of Object.keys(LINKS)) if (r[key] === "") r[key] = null;
      r.voided = old?.voided ?? false;
      if (entity === "tasks") {
        r.status = old?.status ?? "pending";
        r.evidence_id = old?.evidence_id ?? null;
      }
      if (
        entity === "tasks" &&
        body.status !== undefined &&
        body.status !== (old?.status ?? "pending")
      )
        fail("Use task actions to change its status.");
      if (
        entity === "tasks" &&
        old &&
        old.status !== "pending" &&
        (r.kind !== old.kind ||
          r.product_id !== old.product_id ||
          r.plan_id !== old.plan_id)
      )
        fail("A completed task cannot change its clinical instruction links.");
      if (
        entity === "tasks" &&
        old &&
        (r.due_on !== old.due_on || r.due_time !== old.due_time)
      )
        fail(
          "Defer a task through task actions to preserve its original schedule.",
        );
      if (
        r.attachment_ids &&
        (!Array.isArray(r.attachment_ids) ||
          r.attachment_ids.length > 10 ||
          new Set(r.attachment_ids).size !== r.attachment_ids.length)
      )
        fail("Choose at most ten distinct attachments.");
      validate(db, r, old);
      const saved = persist(db, r, old, body, old ? "revise" : "create");
      if (entity === "administrations") {
        if (old?.task_id && old.task_id !== r.task_id)
          reopenTask(db, old.task_id, body);
        if (r.task_id) {
          const t = healthGet(db, r.task_id);
          persist(
            db,
            { ...t, status: "completed", evidence_id: r.id },
            t,
            body,
            "complete",
          );
        }
      }
      if (entity === "results" && old?.task_id && old.task_id !== r.task_id)
        reopenTask(db, old.task_id, body);
      if (entity === "results" && r.task_id) {
        const t = healthGet(db, r.task_id);
        if (
          t.kind === "administration" ||
          (t.kind === "test" && r.kind !== "test") ||
          (t.kind === "recheck" && r.kind !== "follow_up") ||
          (t.status !== "pending" && t.evidence_id !== r.id)
        )
          fail("This result cannot complete that task.");
        persist(
          db,
          { ...t, status: "completed", evidence_id: r.id },
          t,
          body,
          "complete",
        );
      }
      return saved;
    })
    .immediate();
}
function reopenTask(db: Db, id: string, b: Record<string, any>) {
  const t = healthGet(db, id);
  persist(db, { ...t, status: "pending", evidence_id: null }, t, b, "reopen");
  if (t.plan_id) {
    const p = healthGet(db, t.plan_id);
    if (p.status !== "active")
      persist(db, { ...p, status: "active" }, p, b, "reopen");
  }
}
export function healthVoid(db: Db, id: string, b: Record<string, any>) {
  return db
    .transaction(() => {
      const old = healthGet(db, id);
      required(b, "reason");
      if (old.revision !== b.expected_revision)
        throw new HealthError(
          "health_conflict",
          "Record changed; reload before voiding.",
          409,
        );
      if (old.voided) fail("Record is already void.");
      if (
        ["visits", "cases", "plans", "products", "examinations"].includes(
          old.entity,
        ) &&
        healthList(db).some(
          (r) =>
            Object.keys(LINKS).some((k) => r[k] === id) ||
            (r.case_ids ?? []).includes(id),
        )
      )
        fail(
          "This record has linked history. Close/archive it or correct dependent records first.",
        );
      if (old.entity === "tasks") fail("Cancel tasks through task actions.");
      const result = persist(db, { ...old, voided: true }, old, b, "void");
      if (old.entity === "administrations" && old.task_id)
        reopenTask(db, old.task_id, b);
      if (old.entity === "results")
        for (const t of healthList(db, "tasks").filter(
          (t) => t.evidence_id === id,
        ))
          reopenTask(db, t.id, b);
      return result;
    })
    .immediate();
}
export function healthTaskAction(db: Db, id: string, b: Record<string, any>) {
  return db
    .transaction(() => {
      const t = healthGet(db, id);
      if (t.entity !== "tasks" || t.voided) fail("Task not found.");
      if (t.revision !== b.expected_revision)
        throw new HealthError(
          "health_conflict",
          "Task changed; reload and review.",
          409,
        );
      if (t.status !== "pending") fail("Task has already been accounted for.");
      choice(b, "action", ["complete", "defer", "miss", "cancel"]);
      const r = { ...t };
      if (b.action === "complete") {
        const evidence = healthGet(db, required(b, "evidence_id"));
        if (
          evidence.voided ||
          evidence.animal_id !== t.animal_id ||
          (t.kind === "administration"
            ? evidence.entity !== "administrations"
            : evidence.entity !== "results")
        )
          fail("Completion needs an actual matching animal record.");
        if (t.kind === "administration")
          fail(
            "Link the task when recording or revising the administered dose.",
          );
        if (evidence.task_id !== t.id) fail("Result must link to this task.");
        r.status = "completed";
        r.evidence_id = evidence.id;
      } else {
        required(b, "reason");
        if (b.action === "defer") {
          r.due_on = healthDate(b.due_on, "due_on");
          r.due_time = b.due_time ?? null;
        } else r.status = b.action === "miss" ? "missed" : "cancelled";
      }
      validate(db, r, t);
      return persist(db, r, t, b, b.action);
    })
    .immediate();
}
export function healthRequest(
  db: Db,
  key: string,
  path: string,
  body: Record<string, any>,
  fn: () => unknown,
) {
  if (!key?.trim())
    throw new HealthError(
      "missing_idempotency_key",
      "This write requires an Idempotency-Key.",
    );
  return db
    .transaction(() => {
      const hash = bodyHash({ method: "POST", path, body });
      const old = db
        .prepare(
          "SELECT hash,response FROM registry_health_requests WHERE id=?",
        )
        .get(key) as { hash: string; response: string } | undefined;
      if (old) {
        if (old.hash !== hash)
          throw new HealthError(
            "health_conflict",
            "This successful request key belongs to different content.",
            409,
          );
        return JSON.parse(old.response);
      }
      const result = fn();
      db.prepare("INSERT INTO registry_health_requests VALUES (?,?,?)").run(
        key,
        hash,
        JSON.stringify(result),
      );
      return result;
    })
    .immediate();
}
export function healthRound(db: Db, b: Record<string, any>) {
  return db
    .transaction(() => {
      if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 200)
        fail("Select 1–200 animal rows.", "rows");
      if (b.confirmed !== true)
        fail("Confirm the selected animals.", "confirmed");
      const seen = new Set<string>();
      return {
        records: b.rows.map((raw: any, index: number) => {
          try {
            const row = healthObject(raw);
            const id = required(row, "animal_id");
            animalExists(db, id);
            if (seen.has(id)) fail("Animal appears twice.");
            seen.add(id);
            choice(row, "disposition", ["given", "deferred", "not_given"]);
            if (row.disposition === "given")
              return healthSave(db, "administrations", {
                ...b.shared,
                ...row,
                ...provenance(b),
              });
            required(row, "reason");
            const task = healthSave(db, "tasks", {
              ...provenance(b),
              animal_id: id,
              kind: "administration",
              instructions:
                row.instructions ??
                b.shared?.product_name ??
                "Vaccination round",
              due_on: b.shared?.occurred_on,
              visit_id: b.shared?.visit_id,
            });
            return row.disposition === "deferred"
              ? healthTaskAction(db, task.id, {
                  ...provenance(b),
                  expected_revision: task.revision,
                  action: "defer",
                  due_on: required(row, "due_on"),
                  reason: row.reason,
                })
              : healthTaskAction(db, task.id, {
                  ...provenance(b),
                  expected_revision: task.revision,
                  action: "cancel",
                  reason: row.reason,
                });
          } catch (e) {
            if (e instanceof HealthError) {
              e.field = `rows.${index}.${e.field ?? "row"}`;
              e.message = `Animal row ${index + 1}: ${e.message}`;
            }
            throw e;
          }
        }),
      };
    })
    .immediate();
}
export function healthUpload(db: Db, b: Record<string, any>) {
  required(b, "recorded_by");
  const filename = required(b, "filename");
  const base64 = required(b, "base64");
  if (base64.length > 14 * 1024 * 1024)
    throw new HealthError(
      "health_too_large",
      "Maximum attachment size is 10 MiB.",
      413,
    );
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
    fail("Invalid attachment encoding.");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > 10 * 1024 * 1024)
    throw new HealthError(
      "health_too_large",
      "Maximum attachment size is 10 MiB.",
      413,
    );
  const mime =
    bytes.subarray(0, 5).toString() === "%PDF-"
      ? "application/pdf"
      : bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? "image/jpeg"
          : null;
  if (!mime) fail("Only JPEG, PNG and PDF files are supported.");
  const id = randomUUID(),
    checksum = createHash("sha256").update(bytes).digest("hex");
  db.prepare(
    "INSERT INTO registry_health_attachments VALUES (?,?,?,?,?,?,?)",
  ).run(
    id,
    filename.replace(/[\r\n/\\]/g, "_").slice(0, 180),
    mime,
    checksum,
    bytes,
    new Date().toISOString(),
    b.recorded_by,
  );
  return { id, filename, mime, checksum, size: bytes.length };
}
export function checkHealth(db: Db) {
  if (
    !db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='registry_health_records'",
      )
      .get()
  )
    return [];
  const issues: { invariant: number; name: string; detail: string }[] = [];
  const issue = (detail: string) =>
    issues.push({ invariant: 30, name: "health-record-integrity", detail });
  for (const r of healthList(db, undefined, undefined, true)) {
    const revisions = db
      .prepare(
        "SELECT * FROM registry_health_revisions WHERE record_id=? ORDER BY revision",
      )
      .all(r.id) as any[];
    let prior: string | null = null;
    for (const [i, v] of revisions.entries()) {
      if (v.revision !== i + 1 || v.before_json !== prior)
        issue(`${r.id}: broken revision chain`);
      prior = v.after_json;
    }
    if (revisions.length !== r.revision || prior !== JSON.stringify(r))
      issue(`${r.id}: current state differs from audit history`);
    if (r.entity === "tasks" && r.status === "completed") {
      try {
        const e = healthGet(db, r.evidence_id);
        if (e.voided || e.animal_id !== r.animal_id || e.task_id !== r.id)
          issue(`${r.id}: invalid completion evidence`);
      } catch {
        issue(`${r.id}: missing completion evidence`);
      }
    }
  }
  for (const a of db
    .prepare("SELECT id,bytes,checksum FROM registry_health_attachments")
    .all() as any[])
    if (createHash("sha256").update(a.bytes).digest("hex") !== a.checksum)
      issue(`${a.id}: attachment checksum mismatch`);
  return issues;
}

/** Only unlinked staging uploads expire. Linked bytes are retained by foreign keys. */
export function cleanupHealthUploads(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - 7 * 86400000).toISOString();
  return db
    .prepare(
      "DELETE FROM registry_health_attachments WHERE recorded_at < ? AND id NOT IN (SELECT attachment_id FROM registry_health_attachment_links)",
    )
    .run(cutoff).changes;
}
