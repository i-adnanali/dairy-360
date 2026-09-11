// Feed is an independent record domain. Every handle is injected; revisions and
// effective state commit together. JSON holds scalar fields, relationships have FKs.
import { randomUUID } from "node:crypto";
import { RegistryError } from "./errors";
import { assertDatePrecision } from "./events";
import { amountMinor } from "./money";
import { milkingRoster } from "./milking";
import { effectiveEvents } from "./project";
import { snapshot } from "./store";
import { SOURCE_FORMS, type DatePrecision } from "./types";
import type { Db } from "./schema";

export type FeedEntity = "items" | "crops" | "expenses" | "purchases" | "daily";
export type FeedData = Record<string, unknown>;
export interface FeedRecord extends FeedData {
  id: string;
  revision: number;
}
export const FEED_CATEGORIES = [
  "fresh_fodder",
  "silage",
  "concentrate",
  "addition",
  "other",
];
const uid = () => `feed_${randomUUID()}`;
function fail(field: string, message: string): never {
  throw new RegistryError("invalid_payload", message, field);
}
function conflict(message: string): never {
  throw new RegistryError("feed_conflict", message, "revision");
}
export function object(value: unknown): FeedData {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("body", "Expected an object.");
  return value as FeedData;
}
function text(b: FeedData, k: string, required = false): string | null {
  const v = b[k];
  if (v == null || v === "") {
    if (required) fail(k, `${k} is required.`);
    return null;
  }
  if (typeof v !== "string" || v.length > 4000 || !v.trim())
    fail(k, `${k} must be nonblank text (up to 4000 characters).`);
  return v.trim();
}
function number(
  b: FeedData,
  k: string,
  required = false,
  money = false,
): number | null {
  const v = b[k];
  if (v == null || v === "") {
    if (required) fail(k, `${k} is required.`);
    return null;
  }
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    (money ? !Number.isSafeInteger(v) || v < 0 : v <= 0)
  )
    fail(
      k,
      `${k} must be ${money ? "a non-negative integer of paisa" : "a finite positive number"}.`,
    );
  return v;
}
function choice(b: FeedData, k: string, choices: string[]): string {
  const v = text(b, k, true)!;
  if (!choices.includes(v)) fail(k, `Choose ${k}: ${choices.join(", ")}.`);
  return v;
}
function bool(b: FeedData, k: string): boolean {
  if (typeof b[k] !== "boolean") fail(k, `${k} must be true or false.`);
  return b[k] as boolean;
}
export function feedDate(v: unknown, field = "on"): string {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    fail(
      field,
      `${field} must be an exact valid calendar date (YYYY-MM-DD). Defer uncertain backfill.`,
    );
  return v;
}
function list(v: unknown, field: string): unknown[] {
  if (!Array.isArray(v) || v.length > 500)
    fail(field, `${field} must be a list with at most 500 entries.`);
  return v;
}
function provenance(b: FeedData): FeedData {
  return {
    source_form: choice(b, "source_form", [...SOURCE_FORMS]),
    recorded_by: text(b, "recorded_by", true),
    source_ref: text(b, "source_ref"),
    observed_by: text(b, "observed_by"),
  };
}
export function feedList(db: Db, entity: FeedEntity): FeedRecord[] {
  return (
    db
      .prepare(`SELECT data FROM registry_feed_${entity} ORDER BY rowid DESC`)
      .all() as { data: string }[]
  ).map((r) => JSON.parse(r.data) as FeedRecord);
}
export function feedGet(db: Db, entity: FeedEntity, id: string): FeedRecord {
  const r = db
    .prepare(`SELECT data FROM registry_feed_${entity} WHERE id=?`)
    .get(id) as { data: string } | undefined;
  if (!r)
    fail("id", `This ${entity} record no longer exists. Reload its list.`);
  return JSON.parse(r.data) as FeedRecord;
}
export function feedDaily(db: Db, on: string): FeedRecord | null {
  feedDate(on);
  const r = db
    .prepare("SELECT data FROM registry_feed_daily WHERE on_date=?")
    .get(on) as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as FeedRecord) : null;
}
export function feedRecipients(db: Db, on: string) {
  feedDate(on);
  const s = snapshot(db),
    events = effectiveEvents(s.events);
  const herd = s.animals
    .filter(
      (a) =>
        events.some(
          (e) =>
            e.animal_id === a.id &&
            ["birth", "acquired"].includes(e.type) &&
            e.occurred_on <= on,
        ) &&
        !events.some(
          (e) =>
            e.animal_id === a.id &&
            e.type === "departure" &&
            e.occurred_on <= on,
        ),
    )
    .map((a) => ({ id: a.id, name: a.name }));
  const milk = new Set(
    milkingRoster(db, { occurred_on: on, session: "morning" }).rows.map(
      (r) => r.animal_id,
    ),
  );
  return { on, herd, milking: herd.filter((a) => milk.has(a.id)) };
}
function normalize(
  db: Db,
  entity: FeedEntity,
  b: FeedData,
  old: FeedRecord | null,
): FeedData {
  const base = { ...provenance(b), notes: text(b, "notes") };
  if (entity === "items") {
    const category = choice(b, "category", FEED_CATEGORIES);
    if (
      old &&
      category !== old.category &&
      db
        .prepare("SELECT 1 FROM registry_feed_lines WHERE item_id=? LIMIT 1")
        .get(old.id)
    )
      fail(
        "category",
        "This item has feeding history. Keep its category and create a separate item for a different kind.",
      );
    return {
      ...base,
      label: text(b, "label", true),
      category,
      archived: bool(b, "archived"),
    };
  }
  if (entity === "crops") {
    const dates: FeedData = {};
    for (const k of ["sowing", "cutting_start", "cutting_end"]) {
      const on = text(b, k + "_on"),
        precision = text(b, k + "_precision");
      if (on) {
        feedDate(on, k + "_on");
        assertDatePrecision({
          occurred_on: on,
          date_precision: precision as DatePrecision,
        });
      } else if (precision) fail(k + "_on", "A date precision needs a date.");
      dates[k + "_on"] = on;
      dates[k + "_precision"] = precision;
    }
    return {
      ...base,
      ...dates,
      label: text(b, "label", true),
      plot: text(b, "plot"),
      acreage: number(b, "acreage"),
      status: choice(b, "status", ["growing", "cutting", "finished"]),
      archived: bool(b, "archived"),
    };
  }
  if (entity === "expenses") {
    const crop_id = text(b, "crop_id", true)!;
    feedGet(db, "crops", crop_id);
    return {
      ...base,
      crop_id,
      on: feedDate(b.on),
      category: choice(b, "category", [
        "seed",
        "fertilizer",
        "irrigation",
        "machinery_cutting",
        "separate_labour",
        "other",
      ]),
      amount_minor: number(b, "amount_minor", true, true),
    };
  }
  if (entity === "purchases") {
    const item_id = text(b, "item_id", true)!;
    feedGet(db, "items", item_id);
    const quantity = number(b, "quantity"),
      unit = text(b, "unit");
    if (quantity !== null && !unit)
      fail(
        "unit",
        "State the original quantity unit. No bag size is inferred.",
      );
    const pricing = choice(b, "pricing", ["rate", "total", "unknown"]);
    let goods_minor: number | null = null,
      basis_quantity: number | null = null,
      basis_price_minor: number | null = null,
      basis_unit: string | null = null;
    if (pricing === "rate") {
      if (quantity === null)
        fail(
          "quantity",
          "Rate pricing needs a known quantity; use known total or unknown cost for unweighed purchases.",
        );
      basis_quantity = number(b, "basis_quantity", true);
      basis_price_minor = number(b, "basis_price_minor", true, true);
      basis_unit = text(b, "basis_unit", true);
      const weights: Record<string,number> = {g:0.001,kg:1,tonne:1000};
      const quantityWeight=weights[unit!.toLowerCase()], basisWeight=weights[basis_unit!.toLowerCase()];
      if(unit!==basis_unit && !(quantityWeight && basisWeight)) fail('basis_unit','Quantity and rate units must match or both be g, kg or tonne. Custom units have no implied weight.');
      goods_minor=amountMinor(quantity * (unit===basis_unit?1:quantityWeight/basisWeight),basis_price_minor!,basis_quantity!);
    } else if (pricing === "total")
      goods_minor = number(b, "goods_minor", true, true);
    const transport_minor = number(b, "transport_minor", false, true) ?? 0,
      other_minor = number(b, "other_minor", false, true) ?? 0;
    const total_minor =
      goods_minor === null ? null : goods_minor + transport_minor + other_minor;
    if (total_minor !== null && !Number.isSafeInteger(total_minor))
      fail("goods_minor", "The calculated amount is too large.");
    return {
      ...base,
      item_id,
      on: feedDate(b.on),
      supplier: text(b, "supplier"),
      quantity,
      unit,
      pricing,
      basis_quantity,
      basis_price_minor,
      basis_unit,
      goods_minor,
      transport_minor,
      other_minor,
      total_minor,
    };
  }
  const on = feedDate(b.on);
  const fresh_status = choice(b, "fresh_status", ["given", "none", "unknown"]),
    additional_status = choice(b, "additional_status", [
      "given",
      "none",
      "unknown",
    ]);
  const assessment = choice(b, "assessment", [
    "enough",
    "short",
    "surplus",
    "unknown",
    "not_applicable",
  ]);
  if ((fresh_status === "none") !== (assessment === "not_applicable"))
    fail(
      "assessment",
      "Choose not applicable only when no fresh fodder was given.",
    );
  if (fresh_status === "unknown" && assessment !== "unknown")
    fail(
      "assessment",
      "Unknown fresh fodder needs an unknown supply assessment.",
    );
  const oldLines = (old?.lines ?? []) as FeedData[];
  const lines = list(b.lines, "lines").map((value, i) => {
    const l = object(value),
      item_id = text(l, "item_id", true)!,
      item = feedGet(db, "items", item_id);
    const quantity = number(l, "quantity"),
      unit = text(l, "unit");
    if (quantity !== null && !unit)
      fail(
        "unit",
        `Line ${i + 1}: state the quantity unit or leave the quantity unmeasured.`,
      );
    const recipients = choice(l, "recipients", [
      "unspecified",
      "milking",
      "herd",
      "selected",
    ]);
    const animal_ids = list(l.animal_ids, "animal_ids").map((v) => {
      if (typeof v !== "string") fail("animal_ids", "Animal IDs must be text.");
      return v;
    });
    if (new Set(animal_ids).size !== animal_ids.length)
      fail("animal_ids", "Remove duplicate recipients.");
    if (recipients === "unspecified" && animal_ids.length)
      fail("animal_ids", "Unspecified recipients cannot assert animal IDs.");
    if (recipients === "selected" && !animal_ids.length)
      fail("animal_ids", "Select at least one animal, or choose unspecified.");
    const previous = oldLines.find((x) => x.id === l.id);
    const preserved =
      previous &&
      old?.on === on &&
      previous.recipients === recipients &&
      JSON.stringify(previous.animal_ids) === JSON.stringify(animal_ids);
    if (!preserved && recipients !== "unspecified") {
      const candidates = feedRecipients(db, on);
      const eligible =
        recipients === "milking" ? candidates.milking : candidates.herd;
      if (animal_ids.some((id) => !eligible.some((a) => a.id === id)))
        fail(
          "animal_ids",
          "A recipient is not in the date-specific group. Refresh and confirm recipients.",
        );
      if (recipients !== "selected" && eligible.length !== animal_ids.length)
        fail(
          "animal_ids",
          "Confirm the full date-specific group or use selected animals.",
        );
      if (l.recipients_confirmed !== true)
        fail("animal_ids", "Confirm the displayed recipients before saving.");
    }
    const sources = list(l.sources, "sources").map((v) => {
      const src = object(v),
        kind = choice(src, "kind", [
          "crop",
          "purchase",
          "purchased",
          "other",
          "unknown",
        ]);
      const ref_id = text(src, "ref_id");
      if (kind === "crop") {
        if (item.category !== "fresh_fodder")
          fail("sources", "Crop sources are only for fresh fodder.");
        feedGet(db, "crops", ref_id ?? "");
      }
      if (kind === "purchase") {
        const p = feedGet(db, "purchases", ref_id ?? "");
        if (p.item_id !== item_id)
          fail(
            "sources",
            "The linked purchase must be for the same feed item.",
          );
        if (String(p.on) > on)
          fail("sources", "The purchase delivery is after the feeding date.");
      }
      if (["purchased", "other", "unknown"].includes(kind) && ref_id)
        fail(
          "sources",
          "Other/unknown sources cannot carry a record reference.",
        );
      return { kind, ref_id };
    });
    if (!sources.length)
      fail(
        "sources",
        "Explicitly choose a source, including unknown where appropriate.",
      );
    if (new Set(sources.map((s) => JSON.stringify(s))).size !== sources.length)
      fail("sources", "Remove duplicate sources.");
    return {
      id: previous?.id ?? uid(),
      item_id,
      quantity,
      unit,
      recipients,
      animal_ids,
      recipients_confirmed: true,
      sources,
      preparation: choice(l, "preparation", [
        "dry",
        "water_mixed",
        "other",
        "unknown",
      ]),
      notes: text(l, "notes"),
      purpose: text(l, "purpose"),
    };
  });
  if (new Set(lines.map((l) => l.id)).size !== lines.length)
    fail("lines", "Remove duplicate feeding line identities.");
  const fresh = lines.filter(
    (l) => feedGet(db, "items", l.item_id).category === "fresh_fodder",
  ).length;
  if ((fresh_status === "given") !== fresh > 0)
    fail(
      "fresh_status",
      "Fresh fodder given needs a fresh-fodder line; none/unknown cannot have one.",
    );
  if ((additional_status === "given") !== lines.length > fresh)
    fail(
      "additional_status",
      "Additional feed given needs an additional line; none/unknown cannot have one.",
    );
  return {
    ...base,
    on,
    fresh_status,
    additional_status,
    assessment,
    completeness: [fresh_status, additional_status, assessment].includes(
      "unknown",
    )
      ? "partial"
      : "complete",
    lines,
  };
}
export function feedSave(
  db: Db,
  entity: FeedEntity,
  body: FeedData,
  id?: string,
): FeedRecord {
  return db
    .transaction(() => {
      const old = id ? feedGet(db, entity, id) : null;
      if (old ? body.revision !== old.revision : body.revision !== 0)
        conflict(
          "This record changed in another tab. Reload and review before saving; your draft has not been saved.",
        );
      if (entity === "daily") {
        const occupied = feedDaily(db, feedDate(body.on));
        if (occupied && occupied.id !== id)
          conflict(
            "A feeding summary already exists on that date. Open it to review; it will not be overwritten.",
          );
      }
      const data = normalize(db, entity, body, old);
      if (entity === "purchases" && old) {
        const links = db
          .prepare(
            "SELECT d.on_date FROM registry_feed_sources s JOIN registry_feed_lines l ON l.id=s.line_id JOIN registry_feed_daily d ON d.id=l.summary_id WHERE s.purchase_id=?",
          )
          .all(old.id) as { on_date: string }[];
        if (links.length && data.item_id !== old.item_id)
          fail(
            "item_id",
            "This purchase is linked to feeding history. Correct those sources before changing its item.",
          );
        if (links.some((l) => l.on_date < String(data.on)))
          fail(
            "on",
            "Delivery cannot move after a linked feeding day. Correct that source first.",
          );
      }
      const record: FeedRecord = {
        ...data,
        id: old?.id ?? uid(),
        revision: (old?.revision ?? 0) + 1,
        recorded_at: new Date().toISOString(),
      };
      if (entity === "daily") {
        const occupied = feedDaily(db, String(record.on));
        if (occupied && occupied.id !== id)
          conflict(
            "A feeding summary already exists on that date. Open it to review; it will not be overwritten.",
          );
      }
      const cols =
        entity === "expenses"
          ? { crop_id: record.crop_id }
          : entity === "purchases"
            ? { item_id: record.item_id }
            : entity === "daily"
              ? { on_date: record.on }
              : {};
      const keys = ["id", "revision", "data", ...Object.keys(cols)],
        values = [
          record.id,
          record.revision,
          JSON.stringify(record),
          ...Object.values(cols),
        ];
      db.prepare(
        `INSERT INTO registry_feed_${entity} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${keys
          .slice(1)
          .map((k) => `${k}=excluded.${k}`)
          .join(",")}`,
      ).run(...values);
      if (entity === "daily") {
        db.prepare("DELETE FROM registry_feed_lines WHERE summary_id=?").run(
          record.id,
        );
        for (const [position, line] of (record.lines as FeedData[]).entries()) {
          db.prepare("INSERT INTO registry_feed_lines VALUES (?,?,?,?,?)").run(
            line.id,
            record.id,
            line.item_id,
            position,
            JSON.stringify(line),
          );
          for (const src of line.sources as FeedData[])
            db.prepare(
              "INSERT INTO registry_feed_sources VALUES (?,?,?,?,?)",
            ).run(
              uid(),
              line.id,
              src.kind,
              src.kind === "crop" ? src.ref_id : null,
              src.kind === "purchase" ? src.ref_id : null,
            );
          for (const animal of line.animal_ids as string[])
            db.prepare("INSERT INTO registry_feed_recipients VALUES (?,?)").run(
              line.id,
              animal,
            );
        }
      }
      audit(
        db,
        entity,
        record.id,
        record.revision,
        old ? "correct" : "create",
        old,
        record,
        body,
      );
      return record;
    })
    .immediate();
}
function audit(
  db: Db,
  entity: FeedEntity,
  id: string,
  revision: number,
  operation: string,
  before: FeedRecord | null,
  after: FeedRecord | null,
  by: FeedData,
) {
  db.prepare(
    "INSERT INTO registry_feed_revisions VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    uid(),
    entity,
    id,
    revision,
    operation,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    JSON.stringify(provenance(by)),
    new Date().toISOString(),
  );
}
export function feedRemove(
  db: Db,
  entity: FeedEntity,
  id: string,
  b: FeedData,
) {
  return db
    .transaction(() => {
      const old = feedGet(db, entity, id);
      provenance(b);
      if (b.revision !== old.revision)
        conflict("This record changed. Reload and review before removal.");
      if (entity === "items" || entity === "crops")
        fail("id", "Archive this identity instead of deleting it.");
      if (
        entity === "purchases" &&
        db
          .prepare("SELECT 1 FROM registry_feed_sources WHERE purchase_id=?")
          .get(id)
      )
        fail(
          "id",
          "This purchase is linked to feeding history. Correct the feeding sources first, or retain and correct this purchase.",
        );
      audit(db, entity, id, old.revision + 1, "remove", old, null, b);
      db.prepare(`DELETE FROM registry_feed_${entity} WHERE id=?`).run(id);
      return { removed: id };
    })
    .immediate();
}
export function feedHistory(db: Db, from: string, to: string) {
  feedDate(from, "from");
  feedDate(to, "to");
  const n = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (n < 1 || n > 3660) fail("to", "Choose a range of 1 to 3660 days.");
  const byDate = new Map(feedList(db, "daily").map((r) => [r.on, r]));
  return Array.from({ length: n }, (_, i) => {
    const on = new Date(Date.parse(from) + i * 86400000)
      .toISOString()
      .slice(0, 10);
    return { on, summary: byDate.get(on) ?? null };
  });
}
export function feedOverview(db: Db, from: string, to: string) {
  const days = feedHistory(db, from, to),
    accounts = days.flatMap((d) => (d.summary ? [d.summary] : []));
  const purchases = feedList(db, "purchases").filter(
      (p) => String(p.on) >= from && String(p.on) <= to,
    ),
    expenses = feedList(db, "expenses").filter(
      (p) => String(p.on) >= from && String(p.on) <= to,
    );
  const quantities: {
    item_id: string;
    unit: string;
    quantity: number;
    unmeasured: number;
  }[] = [];
  for (const p of purchases) {
    let group = quantities.find(
      (g) => g.item_id === p.item_id && g.unit === (p.unit ?? "unspecified"),
    );
    if (!group) {
      group = {
        item_id: String(p.item_id),
        unit: String(p.unit ?? "unspecified"),
        quantity: 0,
        unmeasured: 0,
      };
      quantities.push(group);
    }
    if (p.quantity === null) group.unmeasured++;
    else group.quantity += Number(p.quantity);
  }
  const sourceDays = (kind: string) =>
    accounts.filter((a) =>
      (a.lines as FeedData[]).some((l) =>
        (l.sources as FeedData[]).some(
          (s) =>
            s.kind === kind || (kind === "purchase" && s.kind === "purchased"),
        ),
      ),
    );
  const own = sourceDays("crop"),
    bought = sourceDays("purchase");
  return {
    from,
    to,
    days,
    recorded: accounts.filter((a) => a.completeness === "complete").length,
    partial: accounts.filter((a) => a.completeness === "partial").length,
    unrecorded: days.length - accounts.length,
    assessments: Object.fromEntries(
      ["enough", "short", "surplus", "unknown", "not_applicable"].map((k) => [
        k,
        accounts.filter((a) => a.assessment === k).map((a) => a.on),
      ]),
    ),
    own_days: own.length,
    purchased_days: bought.length,
    mixed_days: own.filter((a) => bought.some((b) => b.id === a.id)).length,
    quantities,
    purchase_cost_minor: purchases.reduce(
      (n, p) => n + Number(p.total_minor ?? 0),
      0,
    ),
    unknown_costs: purchases.filter((p) => p.total_minor === null).length,
    expense_cost_minor: expenses.reduce(
      (n, p) => n + Number(p.amount_minor),
      0,
    ),
    crops: feedList(db, "crops").map((c) => ({
      ...c,
      expense_minor: feedList(db, "expenses")
        .filter((e) => e.crop_id === c.id)
        .reduce((n, e) => n + Number(e.amount_minor), 0),
      supply_days: cropDays(db, c.id),
    })),
  };
}
export function cropDays(db: Db, id: string): string[] {
  return (
    db
      .prepare(
        "SELECT DISTINCT d.on_date FROM registry_feed_daily d JOIN registry_feed_lines l ON l.summary_id=d.id JOIN registry_feed_sources s ON s.line_id=l.id WHERE s.crop_id=? ORDER BY d.on_date",
      )
      .all(id) as { on_date: string }[]
  ).map((r) => r.on_date);
}
export function feedStanding(db: Db, on: string) {
  const r = feedDaily(db, on);
  if (!r) return { state: "unrecorded", summary: "Not recorded" };
  const extras = (r.lines as FeedData[])
    .filter(
      (l) =>
        feedGet(db, "items", String(l.item_id)).category !== "fresh_fodder",
    )
    .map(
      (l) =>
        `${feedGet(db, "items", String(l.item_id)).label} to ${l.recipients === "milking" ? "confirmed milking animals" : l.recipients === "herd" ? "confirmed herd" : l.recipients === "selected" ? "selected animals" : "unspecified recipients"}`,
    );
  return {
    state: String(r.completeness),
    summary: `${r.completeness === "partial" ? "Feed partially recorded" : "Feed recorded"} — fresh fodder ${r.fresh_status}, supply ${String(r.assessment).replace("_", " ")}${extras.length ? "; " + extras.join("; ") : ""}.`,
  };
}

/** Integrity checks do not compare saved recipients with today's projections. */
export function checkFeed(
  db: Db,
): { invariant: number; name: string; detail: string }[] {
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='registry_feed_daily'")
      .get()
  )
    return [];
  const issues: { invariant: number; name: string; detail: string }[] = [];
  const issue = (detail: string) =>
    issues.push({ invariant: 29, name: "feed-record-integrity", detail });
  for (const entity of [
    "items",
    "crops",
    "expenses",
    "purchases",
    "daily",
  ] as FeedEntity[]) {
    for (const row of db
      .prepare(`SELECT * FROM registry_feed_${entity}`)
      .all() as FeedData[]) {
      try {
        const r = JSON.parse(String(row.data)) as FeedRecord;
        if (r.id !== row.id || r.revision !== row.revision)
          issue(
            `${entity} ${row.id}: effective identity/revision disagrees with stored data.`,
          );
        const normalized = normalize(db, entity, r, r);
        for (const [key, value] of Object.entries(normalized))
          if (JSON.stringify(value) !== JSON.stringify(r[key]))
            issue(`${entity} ${r.id}: inconsistent ${key}.`);
        if (
          (entity === "purchases" && r.item_id !== row.item_id) ||
          (entity === "expenses" && r.crop_id !== row.crop_id) ||
          (entity === "daily" && r.on !== row.on_date)
        )
          issue(`${entity} ${r.id}: relationship disagrees with record.`);
        const auditRow = db
          .prepare(
            "SELECT after_json FROM registry_feed_revisions WHERE entity=? AND entity_id=? AND revision=?",
          )
          .get(entity, r.id, r.revision) as { after_json: string } | undefined;
        if (!auditRow || auditRow.after_json !== row.data)
          issue(
            `${entity} ${r.id}: effective state differs from its revision history.`,
          );
        if (entity === "daily") {
          const rows = db
            .prepare(
              "SELECT * FROM registry_feed_lines WHERE summary_id=? ORDER BY position",
            )
            .all(r.id) as FeedData[];
          if (rows.length !== (r.lines as FeedData[]).length)
            issue(`daily ${r.id}: line count differs.`);
          for (const line of r.lines as FeedData[]) {
            const stored = rows.find((x) => x.id === line.id);
            if (
              !stored ||
              stored.data !== JSON.stringify(line) ||
              stored.item_id !== line.item_id
            )
              issue(`daily ${r.id}: line ${line.id} differs.`);
            const recipients = (
              db
                .prepare(
                  "SELECT animal_id FROM registry_feed_recipients WHERE line_id=? ORDER BY animal_id",
                )
                .all(line.id) as { animal_id: string }[]
            ).map((x) => x.animal_id);
            if (
              JSON.stringify(recipients) !==
              JSON.stringify([...(line.animal_ids as string[])].sort())
            )
              issue(`daily ${r.id}: recipient snapshot differs.`);
            const sources = (
              db
                .prepare(
                  "SELECT kind,crop_id,purchase_id FROM registry_feed_sources WHERE line_id=?",
                )
                .all(line.id) as FeedData[]
            )
              .map((x) =>
                JSON.stringify({
                  kind: x.kind,
                  ref_id: x.crop_id ?? x.purchase_id,
                }),
              )
              .sort();
            if (
              JSON.stringify(sources) !==
              JSON.stringify(
                (line.sources as FeedData[])
                  .map((x) => JSON.stringify(x))
                  .sort(),
              )
            )
              issue(`daily ${r.id}: source references differ.`);
          }
        }
      } catch (e) {
        issue(
          `${entity} ${row.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  for (const row of db.pragma("foreign_key_check") as {
    table: string;
    rowid: number;
  }[])
    if (row.table.startsWith("registry_feed_"))
      issue(`${row.table}: dangling reference at row ${row.rowid}.`);
  return issues;
}
