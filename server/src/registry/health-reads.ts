import type { Db } from "./schema";
import {
  healthList,
  healthGet,
  healthDate,
  HealthError,
  type HealthRecord,
} from "./health";
import { animalDetail } from "./reads";
import { farmToday } from "./time";
import { feedList } from "./feed";

export function healthWithdrawals(
  db: Db,
  animal?: string,
  asOf = new Date().toISOString(),
) {
  const asOfDate = farmToday(new Date(asOf));
  return healthList(db, "administrations", animal)
    .filter(
      (a) =>
        a.occurred_on <= asOfDate &&
        (!a.occurred_time ||
          Date.parse(`${a.occurred_on}T${a.occurred_time}:00+05:00`) <=
            Date.parse(asOf)),
    )
    .flatMap((a) =>
      ["milk", "meat"].flatMap((target) => {
        const w = a[`${target}_withdrawal`] ?? { state: "unknown" };
        if (
          w.state === "none" ||
          (w.until && Date.parse(w.until) <= Date.parse(asOf))
        )
          return [];
        return [
          {
            animal_id: a.animal_id,
            administration_id: a.id,
            product_name: a.product_name,
            target,
            ...w,
            status:
              w.state === "unknown" || !w.until
                ? "needs_clarification"
                : "active",
          },
        ];
      }),
    );
}
export function healthBoard(db: Db, on = farmToday(), time?: string) {
  healthDate(on, "on");
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new HealthError("health_invalid", "Use HH:MM for time.");
  const tasks = healthList(db, "tasks")
    .map((t): HealthRecord => {
      const animal = db
        .prepare("SELECT name,tag_no FROM registry_animals WHERE id=?")
        .get(t.animal_id) as any;
      const departed = !!db
        .prepare(
          "SELECT 1 FROM registry_animal_events WHERE animal_id=? AND type='departure' AND occurred_on<=? AND id NOT IN (SELECT supersedes_id FROM registry_animal_events WHERE supersedes_id IS NOT NULL)",
        )
        .get(t.animal_id, on);
      return {
        ...t,
        animal_name: animal?.name,
        needs_review: departed && t.status === "pending",
        standing:
          t.status !== "pending"
            ? t.status
            : t.due_on < on ||
                (t.due_on === on && time && t.due_time && t.due_time < time)
              ? "overdue"
              : t.due_on === on && time && t.due_time && t.due_time > time
                ? "upcoming"
                : t.due_on === on
                  ? "due"
                  : "upcoming",
      };
    })
    .sort((a, b) =>
      `${a.due_on}${a.due_time ?? ""}${a.id}`.localeCompare(
        `${b.due_on}${b.due_time ?? ""}${b.id}`,
      ),
    );
  return {
    on,
    tasks,
    overdue: tasks.filter((t) => t.standing === "overdue").length,
    due: tasks.filter((t) => t.standing === "due").length,
    upcoming: tasks.filter((t) => t.standing === "upcoming").length,
    open_cases: healthList(db, "cases").filter((c) => c.status === "open"),
    withdrawals: healthWithdrawals(
      db,
      undefined,
      `${on}T${time ?? "00:00"}:00+05:00`,
    ),
  };
}
export function animalHealth(db: Db, id: string) {
  if (!animalDetail(db, id))
    throw new HealthError("unknown_animal", "Registry animal not found.", 404);
  const records = healthList(db, undefined, id);
  const visits = new Set(records.map((r) => r.visit_id).filter(Boolean));
  return {
    animal_id: id,
    records,
    visits: [...visits].map((v) => healthGet(db, v)),
    vaccinations: records.filter(
      (r) => r.entity === "administrations" && r.kind === "vaccine",
    ),
    withdrawals: healthWithdrawals(db, id),
    coverage: records.length ? "recorded" : "no_records",
  };
}
function section(records: unknown[], note?: string) {
  return {
    state: records.length ? "recorded" : "no_records",
    records,
    note: note ?? null,
  };
}
export function lifeReport(
  db: Db,
  id: string,
  opts: { from?: string; to?: string; corrections?: boolean } = {},
) {
  if (opts.from) healthDate(opts.from, "from");
  if (opts.to) healthDate(opts.to, "to");
  if (opts.from && opts.to && opts.from > opts.to)
    throw new HealthError(
      "health_invalid",
      "From must not follow through date.",
    );
  return db.transaction(() => {
    const detail = animalDetail(db, id);
    if (!detail)
      throw new HealthError(
        "unknown_animal",
        "Registry animal not found.",
        404,
      );
    const within = (d: string, precision = "day") => {
      if (!d) return false;
      // Estimated dates have no reliable bounds: retain them with their uncertainty.
      if (precision === "estimated") return true;
      const end =
        precision === "year"
          ? d.slice(0, 4) + "-12-31"
          : precision === "month"
            ? new Date(
                Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0),
              )
                .toISOString()
                .slice(0, 10)
            : d;
      return (!opts.from || end >= opts.from) && (!opts.to || d <= opts.to);
    };
    const health = animalHealth(db, id);
    const events = detail.events.filter(
      (e) => e.effective && within(e.occurred_on, e.date_precision),
    );
    const milk = db
      .prepare(
        "SELECT * FROM registry_milkings WHERE animal_id=? ORDER BY occurred_on,session",
      )
      .all(id) as any[];
    const milkings = milk.filter((m) => within(m.occurred_on));
    const items = new Map(
      feedList(db, "items").map((item) => [item.id, item.label]),
    );
    const feed = feedList(db, "daily")
      .filter((r) => within(String(r.on)))
      .flatMap((day: any) =>
        (day.lines ?? [])
          .filter((l: any) => (l.animal_ids ?? []).includes(id))
          .map((l: any) => ({
            ...l,
            on: day.on,
            summary_id: day.id,
            item_name: items.get(l.item_id) ?? "Unknown feed item",
            recorded_by: day.recorded_by,
            source_form: day.source_form,
            shared: true,
          })),
      );
    const records = health.records.filter(
      (r) =>
        !(r.occurred_on ?? r.due_on) ||
        within(r.occurred_on ?? r.due_on, r.date_precision),
    );
    const healthCosts = healthList(db, "costs", id).filter((r) =>
      within(r.occurred_on),
    );
    const sharedCosts = healthList(db, "costs").filter(
      (c) =>
        !c.animal_id &&
        within(c.occurred_on) &&
        health.visits.some((v) => v.id === c.visit_id),
    );
    const timeline = [
      ...events.map((e) => ({
        id: e.id,
        domain: "animal",
        on: e.occurred_on,
        date_precision: e.date_precision,
        title: e.type,
        record: e,
      })),
      ...records.map((r) => ({
        id: r.id,
        domain: "health",
        on: r.occurred_on ?? r.due_on ?? r.recorded_at.slice(0, 10),
        date_precision: r.date_precision ?? "day",
        date_basis: r.occurred_on
          ? "occurred"
          : r.due_on
            ? "scheduled"
            : "recorded",
        title: r.entity,
        record: r,
      })),
    ].sort((a, b) => a.on.localeCompare(b.on) || a.id.localeCompare(b.id));
    const generated = new Date().toISOString();
    return {
      schema_version: 1,
      animal_id: id,
      generated_at: generated,
      data_snapshot_at: generated,
      filters: opts,
      current_snapshot: detail,
      health,
      sections: {
        life_events: section(
          events,
          "Effective life events in chronological order; corrected originals are available in the appendix.",
        ),
        identity: section(
          events.filter((e) =>
            ["birth", "acquired", "departure"].includes(e.type),
          ),
        ),
        reproduction: section(
          events.filter((e) => ["calving", "dry_off"].includes(e.type)),
          "Breeding and pregnancy-check capture is not yet supported.",
        ),
        parentage: section(
          db
            .prepare(
              "SELECT * FROM registry_parentage WHERE child_id=? OR parent_ref=?",
            )
            .all(id, id),
        ),
        lactations: section(
          db
            .prepare(
              "SELECT * FROM registry_lactations WHERE animal_id=? ORDER BY started_on",
            )
            .all(id),
        ),
        production: section(
          milkings,
          "Only recorded measured milkings contribute litres. Missing and unmeasured sessions are not zero.",
        ),
        health: section(records),
        veterinary_visits: section(
          health.visits.filter((v) => within(v.occurred_on, v.date_precision)),
        ),
        feed: section(
          feed,
          "Confirmed participation in shared feeding; individual intake and cost are not measured.",
        ),
        financial: section(
          healthCosts,
          "Direct health costs only; not lifetime profit. Shared visit charges are listed separately.",
        ),
        shared_visit_costs: section(
          sharedCosts,
          "Unallocated; excluded from animal cost totals.",
        ),
        growth: {
          state: "not_supported",
          records: [],
          note: "Structured weights are not recorded yet.",
        },
        movements: {
          state: "not_supported",
          records: [],
          note: "Structured pen/farm movements are not recorded yet.",
        },
      },
      timeline,
      totals: {
        measured_litres: milkings
          .filter((m) => m.status === "measured")
          .reduce((n, m) => n + m.yield_litres, 0),
        measured_sessions: milkings.filter((m) => m.status === "measured")
          .length,
        unmeasured_sessions: milkings.filter(
          (m) => m.status === "milked_not_measured",
        ).length,
        not_milked_sessions: milkings.filter((m) => m.status === "not_milked")
          .length,
        recorded_sessions: milkings.length,
        health_records: records.length,
        health_costs: healthCosts.reduce((tot: Record<string, number>, r) => {
          if (r.amount_minor !== null)
            tot[r.currency] = (tot[r.currency] ?? 0) + r.amount_minor;
          return tot;
        }, {}),
      },
      coverage_warnings: [
        "No records means no evidence entered, not that an event never happened.",
        "This is recorded history as known at generation, not a reconstruction of an earlier database.",
        "Structured breed, weight, movement, breeding and discarded-milk capture are deferred.",
        "Bulk sales and shared feed/payroll costs are not attributable animal profit.",
      ],
      corrections: opts.corrections
        ? {
            animal_events: detail.events.filter((e) => !e.effective),
            health: db
              .prepare(
                "SELECT r.* FROM registry_health_revisions r JOIN registry_health_records h ON h.id=r.record_id WHERE h.animal_id=? ORDER BY r.recorded_at,r.id",
              )
              .all(id),
          }
        : undefined,
    };
  })();
}
