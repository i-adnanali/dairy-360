// Animal registry -- invariant checks, PURE (decision doc §10).
//
// Snapshot in, violations out. No `../db`, no clock, no filesystem, so the same
// functions serve two callers with different data:
//
//   - registry.invariants.test.ts, against `:memory:` fixtures, in CI, on every
//     push. Proves the LOGIC, including that each check fires on a deliberately
//     corrupted fixture.
//   - `npm run verify:registry`, against the live dairy.db. Proves the DATA,
//     which CI will never have.
//
// Picking one caller would have been wrong: the invariants must run against
// real data, and the projection logic must run in CI.
//
// Invariants 0 and 1 (idempotence, rebuild fidelity) are NOT here: they require
// running a rebuild, so they live in the two callers, which have a database.
// Invariant 13 is a source-level check and takes source text as a parameter to
// stay pure.

import { REGISTRY_TABLES } from './schema';
import {
  canonicalOrder,
  effectiveEvents,
  findOrigin,
  projectAnimal,
  supersededIds,
} from './project';
import { lactationIdFor } from './events';
import { lactationCovering } from './milking';
import { formatSerial, SERIAL_PREFIX } from './events';
import type {
  DatePrecision,
  LactationRow,
  RegistryEvent,
  RegistrySnapshot,
} from './types';

export interface Violation {
  /** Invariant number from decision doc §10, for cross-referencing. */
  invariant: number;
  name: string;
  detail: string;
}

const v = (invariant: number, name: string, detail: string): Violation => ({
  invariant,
  name,
  detail,
});

/** Group events by animal, preserving canonical order. */
function byAnimal(events: RegistryEvent[]): Map<string, RegistryEvent[]> {
  const out = new Map<string, RegistryEvent[]>();
  for (const e of canonicalOrder(events)) {
    const list = out.get(e.animal_id);
    if (list) list.push(e);
    else out.set(e.animal_id, [e]);
  }
  return out;
}

/**
 * Compare two dates allowing for precision: at `month` precision only the month
 * is meaningful, at `year` only the year, and `estimated` is not comparable at
 * all. Returns true when `a` is definitely before `b`.
 *
 * This is what "allowing for precision" in invariants 4 and 5 means: a
 * month-precision event stored on the 1st must not be flagged as "before" an
 * origin dated the 14th of the same month, because the day was never known.
 */
export function definitelyBefore(
  a: { on: string; precision: DatePrecision },
  b: { on: string; precision: DatePrecision },
): boolean {
  if (a.precision === 'estimated' || b.precision === 'estimated') return false;
  const coarsest = (p: DatePrecision, q: DatePrecision): 'day' | 'month' | 'year' => {
    if (p === 'year' || q === 'year') return 'year';
    if (p === 'month' || q === 'month') return 'month';
    return 'day';
  };
  const grain = coarsest(a.precision, b.precision);
  const cut = grain === 'year' ? 4 : grain === 'month' ? 7 : 10;
  return a.on.slice(0, cut) < b.on.slice(0, cut);
}

/**
 * The ONE supersession that may change an event's type: a `birth` replacing an
 * `acquired` origin.
 *
 * This is the backfill reconciliation case. Pass one enters an animal as
 * `acquired`; pass two records its dam's calving and discovers it was born on
 * the farm. The origin event is exactly the thing being corrected, so the
 * correction has to change its type -- and every other projection consequence
 * follows correctly, because effectiveEvents() removes the superseded
 * `acquired` before findOrigin() ever sees it.
 *
 * The REVERSE (`acquired` superseding a `birth`) is deliberately NOT allowed. A
 * birth event is referenced by a calving on the dam; superseding it away would
 * leave that calving naming a calf with no birth event, which invariant 6
 * rejects and which no further event could repair. If an animal really was
 * bought rather than born, the calving that claims it is the thing that is
 * wrong, and that is a different (unbuilt) correction.
 */
function isOriginPromotion(newType: string, oldType: string): boolean {
  return newType === 'birth' && oldType === 'acquired';
}

// ---------------------------------------------------------------------------
// 3. Exactly one origin event per animal
// ---------------------------------------------------------------------------

function checkOrigin(s: RegistrySnapshot): Violation[] {
  const out: Violation[] = [];
  const events = byAnimal(effectiveEvents(s.events));
  for (const a of s.animals) {
    const mine = events.get(a.id) ?? [];
    const origins = mine.filter((e) => e.type === 'birth' || e.type === 'acquired');
    if (origins.length === 0) {
      out.push(
        v(3, 'one-origin-event', `animal ${a.id} has no birth or acquired event`),
      );
    } else if (origins.length > 1) {
      out.push(
        v(
          3,
          'one-origin-event',
          `animal ${a.id} has ${origins.length} origin events: ` +
            origins.map((e) => `${e.type}@${e.occurred_on}(${e.id})`).join(', '),
        ),
      );
    }
  }
  // An event whose animal does not exist at all.
  const known = new Set(s.animals.map((a) => a.id));
  for (const e of s.events) {
    if (!known.has(e.animal_id)) {
      out.push(
        v(3, 'one-origin-event', `event ${e.id} references unknown animal ${e.animal_id}`),
      );
    }
  }

  // registry_animals.origin must agree with the effective origin EVENT type.
  //
  // This is the one column in the schema that is derivable from the log but is
  // NOT written by the rebuild -- it lives on the identity table, so it can
  // drift. It became drift-prone the moment link mode made origin correctable:
  // promoting an animal from `acquired` to `born_on_farm` writes a superseding
  // birth event AND updates this column, and those two writes could come apart.
  // Checking the agreement is cheaper than migrating the column into a
  // projection, and it fails loudly if they ever do.
  for (const a of s.animals) {
    const mine = events.get(a.id) ?? [];
    const origin = mine.find((e) => e.type === 'birth' || e.type === 'acquired');
    if (!origin) continue; // already reported above
    const expected = origin.type === 'birth' ? 'born_on_farm' : 'acquired';
    if (a.origin !== expected) {
      out.push(
        v(
          3,
          'one-origin-event',
          `animal ${a.id}: registry_animals.origin='${a.origin}' but its effective origin ` +
            `event is a '${origin.type}', which implies '${expected}'`,
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4 & 5. Nothing dated before origin or after departure (except `note`)
// ---------------------------------------------------------------------------

function checkTimeline(s: RegistrySnapshot): Violation[] {
  const out: Violation[] = [];
  const events = byAnimal(effectiveEvents(s.events));

  for (const a of s.animals) {
    const mine = events.get(a.id) ?? [];
    const origin = findOrigin(mine);
    if (origin) {
      const ob = { on: origin.event.occurred_on, precision: origin.event.date_precision };
      for (const e of mine) {
        if (e.type === 'note' || e.id === origin.event.id) continue;
        if (definitelyBefore({ on: e.occurred_on, precision: e.date_precision }, ob)) {
          out.push(
            v(
              4,
              'nothing-before-origin',
              `animal ${a.id}: ${e.type}@${e.occurred_on} (${e.date_precision}) precedes ` +
                `its ${origin.event.type} origin@${origin.event.occurred_on} ` +
                `(${origin.event.date_precision})`,
            ),
          );
        }
      }
    }

    const departure = mine.find((e) => e.type === 'departure');
    if (departure) {
      const db_ = { on: departure.occurred_on, precision: departure.date_precision };
      for (const e of mine) {
        if (e.type === 'note' || e.id === departure.id) continue;
        if (definitelyBefore(db_, { on: e.occurred_on, precision: e.date_precision })) {
          out.push(
            v(
              5,
              'nothing-after-departure',
              `animal ${a.id}: ${e.type}@${e.occurred_on} follows its ` +
                `departure@${departure.occurred_on}`,
            ),
          );
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6. Every calving names a real calf with a matching birth event
// ---------------------------------------------------------------------------

function checkCalvings(s: RegistrySnapshot): Violation[] {
  const out: Violation[] = [];
  const live = effectiveEvents(s.events);
  const animals = new Map(s.animals.map((a) => [a.id, a]));
  const birthsByAnimal = new Map<string, RegistryEvent>();
  for (const e of live) if (e.type === 'birth') birthsByAnimal.set(e.animal_id, e);

  for (const c of live) {
    if (c.type !== 'calving') continue;
    const calfId = c.payload.calf_id as string | undefined;
    if (!calfId) {
      out.push(v(6, 'calving-names-calf', `calving ${c.id} has no calf_id in its payload`));
      continue;
    }
    const calf = animals.get(calfId);
    if (!calf) {
      out.push(
        v(6, 'calving-names-calf', `calving ${c.id} names calf ${calfId}, which does not exist`),
      );
      continue;
    }
    if (calf.origin !== 'born_on_farm') {
      out.push(
        v(
          6,
          'calving-names-calf',
          `calving ${c.id} names calf ${calfId}, whose origin is '${calf.origin}' ` +
            `rather than 'born_on_farm'`,
        ),
      );
    }
    const birth = birthsByAnimal.get(calfId);
    if (!birth) {
      out.push(
        v(6, 'calving-names-calf', `calf ${calfId} has no birth event`),
      );
      continue;
    }
    if (birth.occurred_on !== c.occurred_on || birth.date_precision !== c.date_precision) {
      out.push(
        v(
          6,
          'calving-names-calf',
          `calf ${calfId}: birth@${birth.occurred_on}(${birth.date_precision}) does not ` +
            `match calving@${c.occurred_on}(${c.date_precision}). These are the same ` +
            `physical fact; divergent dates mean the timeline lies.`,
        ),
      );
    }
    // The calving payload and the animal row must agree on sex; they are two
    // records of one fact and a divergence means one of them is wrong.
    const calvingSex = c.payload.calf_sex as string | undefined;
    if (calvingSex && calvingSex !== calf.sex) {
      out.push(
        v(
          6,
          'calving-names-calf',
          `calf ${calfId}: registry_animals.sex='${calf.sex}' but calving ${c.id} ` +
            `records calf_sex='${calvingSex}'`,
        ),
      );
    }
    if (birth.payload.calving_event_id !== c.id) {
      out.push(
        v(
          6,
          'calving-names-calf',
          `calf ${calfId}: its birth event points at calving ` +
            `'${String(birth.payload.calving_event_id)}' but calving ${c.id} claims it`,
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7. Every born_on_farm animal has a dam edge
// ---------------------------------------------------------------------------

function checkParentage(s: RegistrySnapshot): Violation[] {
  const out: Violation[] = [];
  const dams = new Set(
    s.parentage.filter((p) => p.relation === 'dam').map((p) => p.child_id),
  );
  for (const a of s.animals) {
    if (a.origin === 'born_on_farm' && !dams.has(a.id)) {
      out.push(
        v(7, 'born-on-farm-has-dam', `animal ${a.id} is born_on_farm but has no dam edge`),
      );
    }
  }
  const known = new Set(s.animals.map((a) => a.id));
  for (const p of s.parentage) {
    if (!known.has(p.child_id)) {
      out.push(
        v(7, 'born-on-farm-has-dam', `parentage row references unknown child ${p.child_id}`),
      );
    }
    if (p.relation === 'dam' && p.certainty === 'known' && p.parent_ref && !known.has(p.parent_ref)) {
      out.push(
        v(
          7,
          'born-on-farm-has-dam',
          `animal ${p.child_id} names dam ${p.parent_ref}, which is not a registry animal`,
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 8. No animal has two open lactations
// ---------------------------------------------------------------------------

function checkLactations(s: RegistrySnapshot): Violation[] {
  const out: Violation[] = [];
  const open = new Map<string, LactationRow[]>();
  for (const l of s.lactations) {
    if (l.ended_on !== null) continue;
    const list = open.get(l.animal_id);
    if (list) list.push(l);
    else open.set(l.animal_id, [l]);
  }
  for (const [animalId, list] of open) {
    if (list.length > 1) {
      out.push(
        v(
          8,
          'one-open-lactation',
          `animal ${animalId} has ${list.length} open lactations: ` +
            list.map((l) => l.id).join(', '),
        ),
      );
    }
  }
  // Ids must be derived from the opening calving, or invariant 2's stability
  // guarantee is vacuous.
  for (const l of s.lactations) {
    const expected = (() => {
      try {
        return lactationIdFor(l.opened_by_event_id);
      } catch {
        return null;
      }
    })();
    if (expected === null) {
      out.push(
        v(8, 'one-open-lactation', `lactation ${l.id} has a malformed opened_by_event_id`),
      );
    } else if (expected !== l.id) {
      out.push(
        v(
          8,
          'one-open-lactation',
          `lactation ${l.id} should be ${expected}, derived from its opening calving ` +
            `${l.opened_by_event_id}`,
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 9. No superseded event contributes to any projection
// ---------------------------------------------------------------------------

function checkSuperseded(s: RegistrySnapshot): Violation[] {
  const out: Violation[] = [];
  const dead = supersededIds(s.events);
  if (dead.size === 0) return out;

  for (const l of s.lactations) {
    if (dead.has(l.opened_by_event_id)) {
      out.push(
        v(
          9,
          'superseded-excluded',
          `lactation ${l.id} was opened by superseded event ${l.opened_by_event_id}`,
        ),
      );
    }
    if (l.closed_by_event_id && dead.has(l.closed_by_event_id)) {
      out.push(
        v(
          9,
          'superseded-excluded',
          `lactation ${l.id} was closed by superseded event ${l.closed_by_event_id}`,
        ),
      );
    }
  }
  for (const p of s.parentage) {
    if (dead.has(p.source_event_id)) {
      out.push(
        v(
          9,
          'superseded-excluded',
          `parentage ${p.child_id}/${p.relation} derives from superseded event ` +
            `${p.source_event_id}`,
        ),
      );
    }
  }
  // A superseding event must point at an event that exists.
  const ids = new Set(s.events.map((e) => e.id));
  for (const e of s.events) {
    if (e.supersedes_id && !ids.has(e.supersedes_id)) {
      out.push(
        v(
          9,
          'superseded-excluded',
          `event ${e.id} supersedes ${e.supersedes_id}, which does not exist`,
        ),
      );
    }
    if (e.supersedes_id) {
      const target = s.events.find((x) => x.id === e.supersedes_id);
      if (target && target.animal_id !== e.animal_id) {
        out.push(
          v(
            9,
            'superseded-excluded',
            `event ${e.id} (animal ${e.animal_id}) supersedes an event on a DIFFERENT ` +
              `animal ${target.animal_id}`,
          ),
        );
      }
      if (target && target.type !== e.type && !isOriginPromotion(e.type, target.type)) {
        out.push(
          v(
            9,
            'superseded-excluded',
            `event ${e.id} (${e.type}) supersedes an event of a different type ` +
              `(${target.type})`,
          ),
        );
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 10. No duplicate serials; counter >= max issued
// ---------------------------------------------------------------------------

function checkSerials(s: RegistrySnapshot): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();
  let maxIssued = 0;

  for (const a of s.animals) {
    if (seen.has(a.id)) {
      out.push(v(10, 'serials-unique-monotonic', `duplicate serial ${a.id}`));
    }
    seen.add(a.id);

    if (!a.id.startsWith(SERIAL_PREFIX)) {
      out.push(
        v(
          10,
          'serials-unique-monotonic',
          `animal id '${a.id}' does not use the '${SERIAL_PREFIX}' prefix`,
        ),
      );
      continue;
    }
    const n = Number(a.id.slice(SERIAL_PREFIX.length));
    if (!Number.isInteger(n) || n < 1) {
      out.push(
        v(10, 'serials-unique-monotonic', `animal id '${a.id}' has a non-numeric serial`),
      );
      continue;
    }
    if (formatSerial(n) !== a.id) {
      out.push(
        v(
          10,
          'serials-unique-monotonic',
          `animal id '${a.id}' is not canonically padded (expected ${formatSerial(n)})`,
        ),
      );
    }
    maxIssued = Math.max(maxIssued, n);
  }

  if (s.nextSerial <= maxIssued) {
    out.push(
      v(
        10,
        'serials-unique-monotonic',
        `counter next_serial=${s.nextSerial} would reissue an existing serial ` +
          `(highest issued is ${maxIssued}). Serials are never reused.`,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// 11 & 12. Stored-date conventions
// ---------------------------------------------------------------------------

function checkPrecision(s: RegistrySnapshot): Violation[] {
  const out: Violation[] = [];
  for (const e of s.events) {
    if (e.date_precision === 'month' && !e.occurred_on.endsWith('-01')) {
      out.push(
        v(
          11,
          'precision-date-conventions',
          `event ${e.id} is month-precision but dated ${e.occurred_on}; a month row ` +
            `dated mid-month means a known date was silently downgraded`,
        ),
      );
    }
    if (e.date_precision === 'year' && !e.occurred_on.endsWith('-01-01')) {
      out.push(
        v(
          11,
          'precision-date-conventions',
          `event ${e.id} is year-precision but dated ${e.occurred_on}, not January 1`,
        ),
      );
    }
    if (e.date_precision === 'estimated' && !e.occurred_on.endsWith('-01-01')) {
      out.push(
        v(
          11,
          'precision-date-conventions',
          `event ${e.id} is estimated-precision but dated ${e.occurred_on}, not January 1; ` +
            `a specific day at estimated precision is a fabricated day wearing a humility label`,
        ),
      );
    }
    if (e.occurred_time !== null && e.date_precision !== 'day') {
      out.push(
        v(
          12,
          'time-only-at-day-precision',
          `event ${e.id} has occurred_time=${e.occurred_time} at ` +
            `${e.date_precision} precision`,
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 14-17. Milk yield (step 4; docs/REGISTRY_MILKING.md §10)
// ---------------------------------------------------------------------------

/**
 * The rules a milk row has to satisfy that no CHECK constraint can see.
 *
 * The status/yield agreement (17) IS enforced by a CHECK, and is checked again
 * here for the same reason invariant 11 re-checks the date conventions: a CHECK
 * only defends rows written after it existed, and this catches the ones that
 * were not.
 *
 * 14 and 15 are the ones that matter, and neither is expressible as a
 * constraint, because both depend on the PROJECTION -- and the projection moves.
 * A backdated dry-off or a late-entered calving re-cuts a lactation boundary
 * under rows that were legitimate when they were written. That is not corruption
 * and it is not the operator's mistake; it is the one place where a milk row and
 * the event log can drift apart, and the only way to see it is to recompute.
 */
function checkMilkings(s: RegistrySnapshot): Violation[] {
  const out: Violation[] = [];
  if (s.milkings.length === 0) return out;

  const known = new Set(s.animals.map((a) => a.id));

  const lactsByAnimal = new Map<string, LactationRow[]>();
  for (const l of s.lactations) {
    const list = lactsByAnimal.get(l.animal_id);
    if (list) list.push(l);
    else lactsByAnimal.set(l.animal_id, [l]);
  }
  for (const list of lactsByAnimal.values()) {
    list.sort((a, b) => (a.started_on < b.started_on ? -1 : a.started_on > b.started_on ? 1 : 0));
  }

  const departureOf = new Map<string, RegistryEvent>();
  for (const e of effectiveEvents(s.events)) {
    if (e.type === 'departure') departureOf.set(e.animal_id, e);
  }

  const seen = new Set<string>();

  for (const m of s.milkings) {
    // 14 -- the animal exists at all.
    if (!known.has(m.animal_id)) {
      out.push(
        v(14, 'milking-inside-lactation', `milking ${m.id} references unknown animal ${m.animal_id}`),
      );
      continue;
    }

    // 14 -- the row falls inside a lactation. Covers "before the first calving",
    // "after a dry-off" and "she has never calved" in one statement.
    const covering = lactationCovering(lactsByAnimal.get(m.animal_id) ?? [], m.occurred_on);
    if (covering === null) {
      out.push(
        v(
          14,
          'milking-inside-lactation',
          `animal ${m.animal_id} has a ${m.session} milking on ${m.occurred_on} but no lactation ` +
            `covering that date -- she was not in milk then. Either the row's date is wrong, or a ` +
            `calving or dry-off has moved underneath it.`,
        ),
      );
    }

    // 15 -- nothing after a departure. The yield equivalent of invariant 5, and
    // unlike a note there is no reading of it that makes sense: a sold animal
    // is not being milked here.
    const dep = departureOf.get(m.animal_id);
    if (dep && definitelyBefore(
      { on: dep.occurred_on, precision: dep.date_precision },
      { on: m.occurred_on, precision: 'day' },
    )) {
      out.push(
        v(
          15,
          'no-milking-after-departure',
          `animal ${m.animal_id} has a ${m.session} milking on ${m.occurred_on}, after its ` +
            `departure on ${dep.occurred_on}`,
        ),
      );
    }

    // 16 -- one row per animal per session. Enforced by UNIQUE; checked here so
    // a database that predates the constraint still reports it.
    const key = `${m.animal_id} ${m.occurred_on} ${m.session}`;
    if (seen.has(key)) {
      out.push(
        v(
          16,
          'one-milking-per-session',
          `animal ${m.animal_id} has more than one ${m.session} row on ${m.occurred_on}, which ` +
            `makes the session's completeness uncountable`,
        ),
      );
    }
    seen.add(key);

    // 17 -- status and yield agree.
    const hasNumber = m.yield_litres !== null;
    if ((m.status === 'measured') !== hasNumber) {
      out.push(
        v(
          17,
          'milking-status-matches-yield',
          `milking ${m.id} is '${m.status}' with yield_litres ${JSON.stringify(m.yield_litres)}. ` +
            `'measured' means a number was taken and every other status means one was not.`,
        ),
      );
    }
    if (m.yield_litres !== null && m.yield_litres < 0) {
      out.push(
        v(17, 'milking-status-matches-yield', `milking ${m.id} has a negative yield ${m.yield_litres}`),
      );
    }
    if (m.reason !== null && m.status !== 'not_milked') {
      out.push(
        v(
          17,
          'milking-status-matches-yield',
          `milking ${m.id} carries a reason with status '${m.status}'; a reason only belongs with ` +
            `'not_milked'`,
        ),
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 13. resetSchema()'s DROP list contains no registry table (source-level)
// ---------------------------------------------------------------------------

/**
 * The belt-and-braces guard for B1: `seed()` drops and recreates the demo
 * tables, and the regression suite calls it in `beforeEach`. A registry table
 * that ever appeared in that DROP list -- or in the `SCHEMA` const, which the
 * same function recreates -- would lose real, unrecoverable records on the next
 * `npm run seed`.
 *
 * Checked against SOURCE TEXT rather than against a live database, because the
 * failure is someone adding a line to db.ts, and that must fail in CI without a
 * database present.
 */
export function checkDbSourceIsolation(dbSource: string): Violation[] {
  const out: Violation[] = [];

  const resetBody = /export function resetSchema\(\)[\s\S]*?\n}/.exec(dbSource);
  if (!resetBody) {
    // Deliberately NOT an early return: both matchers must report independently,
    // so a source change that defeats one is not masked by the other.
    out.push(
      v(
        13,
        'reset-schema-drops-no-registry-table',
        'could not locate resetSchema() in db.ts -- the guard cannot verify itself, ' +
          'which is worse than a failure. Update the matcher.',
      ),
    );
  } else {
    for (const table of REGISTRY_TABLES) {
      if (resetBody[0].includes(table)) {
        out.push(
          v(
            13,
            'reset-schema-drops-no-registry-table',
            `resetSchema() mentions '${table}'. seed() calls it, and the regression ` +
              `suite calls seed() in beforeEach -- this would destroy real records.`,
          ),
        );
      }
    }
  }

  const schemaConst = /export const SCHEMA = `[\s\S]*?`;/.exec(dbSource);
  if (!schemaConst) {
    out.push(
      v(
        13,
        'reset-schema-drops-no-registry-table',
        'could not locate the SCHEMA const in db.ts. Update the matcher.',
      ),
    );
  } else {
    for (const table of REGISTRY_TABLES) {
      if (schemaConst[0].includes(table)) {
        out.push(
          v(
            13,
            'reset-schema-drops-no-registry-table',
            `the SCHEMA const defines '${table}'. resetSchema() drops everything in ` +
              `SCHEMA and recreates it, so a registry table here is dropped on every seed.`,
          ),
        );
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

/**
 * Invariants 3 through 12, plus a projection-agreement check.
 *
 * The agreement check is what makes invariant 1 meaningful WITHOUT a second
 * database: it recomputes each animal's projection from the event log and
 * compares it to what is stored. The callers still run the full rebuild-diff,
 * but this catches a divergence with a per-animal message rather than a
 * whole-table diff.
 */
export function checkSnapshot(s: RegistrySnapshot, asOf: string): Violation[] {
  return [
    ...checkOrigin(s),
    ...checkTimeline(s),
    ...checkCalvings(s),
    ...checkParentage(s),
    ...checkLactations(s),
    ...checkSuperseded(s),
    ...checkSerials(s),
    ...checkPrecision(s),
    ...checkMilkings(s),
    ...checkProjectionAgreement(s, asOf),
  ];
}

/** Recompute every projection and compare to what is stored (invariant 1's core). */
export function checkProjectionAgreement(
  s: RegistrySnapshot,
  asOf: string,
): Violation[] {
  const out: Violation[] = [];
  const events = byAnimal(s.events);

  const storedStatus = new Map(s.statuses.map((r) => [r.animal_id, r]));
  const storedLact = new Map<string, LactationRow[]>();
  for (const l of s.lactations) {
    const list = storedLact.get(l.animal_id);
    if (list) list.push(l);
    else storedLact.set(l.animal_id, [l]);
  }

  for (const animal of s.animals) {
    const p = projectAnimal({ animal, events: events.get(animal.id) ?? [], asOf });

    const stored = storedStatus.get(animal.id);
    if (!stored) {
      out.push(
        v(1, 'rebuild-fidelity', `animal ${animal.id} has no stored status row`),
      );
    } else if (JSON.stringify(sortKeys(stored)) !== JSON.stringify(sortKeys(p.status))) {
      out.push(
        v(
          1,
          'rebuild-fidelity',
          `animal ${animal.id} status: stored ${JSON.stringify(sortKeys(stored))} ` +
            `!= derived ${JSON.stringify(sortKeys(p.status))}`,
        ),
      );
    }

    const mine = (storedLact.get(animal.id) ?? []).map((l) => JSON.stringify(sortKeys(l)));
    const derived = p.lactations.map((l) => JSON.stringify(sortKeys(l)));
    if (mine.slice().sort().join('|') !== derived.slice().sort().join('|')) {
      out.push(
        v(
          1,
          'rebuild-fidelity',
          `animal ${animal.id} lactations: ${mine.length} stored vs ` +
            `${derived.length} derived, or contents differ`,
        ),
      );
    }
  }
  return out;
}

// Row types are interfaces, which TypeScript does not consider assignable to
// Record<string, unknown> (no implicit index signature). These helpers take
// `object` and narrow internally so every row type works without each one
// growing an index signature it does not otherwise want.
function sortKeys(o: object): Record<string, unknown> {
  const src = o as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src).sort()) out[k] = src[k];
  return out;
}

/**
 * Canonical multiset key for a projection row (invariant 1).
 *
 * SQLite files are NOT byte-comparable for identical content -- page layout,
 * freelists and WAL state all differ -- so "byte-identical" would fail for
 * reasons that mean nothing. This is the same multiset approach verify.ts
 * already uses for farm events.
 */
export function rowKey(row: object): string {
  const src = row as Record<string, unknown>;
  return Object.keys(src)
    .sort()
    .map((k) => `${k}=${JSON.stringify(src[k] ?? null)}`)
    .join(' | ');
}

/**
 * Multiset diff between two row-sets. Empty means identical.
 *
 * Messages name WHICH SIDE a row is missing from rather than saying
 * "expected"/"unexpected": both sides here are real row-sets (what is stored vs
 * what a rebuild produces), and neither is more authoritative than the other
 * until you know which way the difference runs. "unexpected row" would read
 * backwards for the common case of a deleted stored row.
 */
export function diffRowSets(
  label: string,
  stored: readonly object[],
  rebuilt: readonly object[],
  sides: { stored: string; rebuilt: string } = { stored: 'stored', rebuilt: 'rebuilt' },
): string[] {
  const failures: string[] = [];
  const remaining = new Map<string, number>();
  for (const r of rebuilt) {
    const k = rowKey(r);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  for (const e of stored) {
    const k = rowKey(e);
    const n = remaining.get(k) ?? 0;
    if (n === 0) {
      failures.push(`${label}: in ${sides.stored} but NOT in ${sides.rebuilt}: ${k}`);
    } else {
      remaining.set(k, n - 1);
    }
  }
  for (const [k, n] of remaining) {
    if (n > 0) {
      failures.push(`${label}: in ${sides.rebuilt} but NOT in ${sides.stored} (x${n}): ${k}`);
    }
  }
  return failures;
}
