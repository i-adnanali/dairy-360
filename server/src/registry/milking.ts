// Animal registry -- per-animal milk yield (step 4; docs/REGISTRY_MILKING.md).
//
// One module for the whole feature: the pure rules, the transactional write, and
// the roster read model. Cohesive rather than split across events/entry/reads,
// the same way calving.ts owns both recordCalving and the predicate the picker
// borrows from it.
//
// ---------------------------------------------------------------------------
// WHAT MAKES THIS DIFFERENT FROM EVERY OTHER REGISTRY WRITE
// ---------------------------------------------------------------------------
// A yield is a MEASUREMENT, not a claim about history. Nothing is derived from
// it but aggregates that recompute from scratch, and a wrong number is a
// mis-reading rather than a false assertion about the past. Three consequences,
// all deliberate and all divergences from the event log:
//
//   1. Corrections are an UPDATE, not a superseding row. Superseding
//      measurements would double the table over a year for no recoverable
//      information, and would put thousands of rows a year through a chain-walk
//      that exists to protect pedigree.
//   2. DELETE is permitted, per row and per session. A whole session entered
//      against the wrong date has no superseding event available, and the
//      UNIQUE constraint means the wrong date keeps holding rows until they go.
//   3. There is NO lactation_id. See lactationCovering() below.
//
// ---------------------------------------------------------------------------
// THE NULL OBSERVATION IS THE POINT
// ---------------------------------------------------------------------------
// This is to the daily log what date precision is to the backfill. A session
// where 14 of 18 animals were recorded leaves four rows absent, and absence is
// ambiguous across at least four different facts. So `status` is required and
// three-valued, and `milked_not_measured` is a first-class answer rather than an
// error -- see MilkingStatus in types.ts for why collapsing it into `not_milked`
// would corrupt exactly the analysis this feature exists for.

import { randomUUID } from 'node:crypto';
import { RegistryError } from './errors';
import { getAnimal } from './store';
import type { Db } from './schema';
import type {
  LactationRow,
  MilkingSession,
  MilkingStatus,
  Provenance,
  RegistryMilkingRow,
} from './types';
import { MILKING_SESSIONS, MILKING_STATUSES } from './types';

export const MILKING_ID_PREFIX = 'mlk_';

/** The full uuid, for the reason newEventId() gives: 8 hex is not enough. */
export function newMilkingId(): string {
  return `${MILKING_ID_PREFIX}${randomUUID()}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Which lactation a date falls in -- PURE, and the reason there is no FK
// ---------------------------------------------------------------------------

/**
 * The lactation covering `on`, or null.
 *
 * THIS IS WHY YIELD CARRIES NO `lactation_id`. A lactation id is stable enough
 * to be an identifier and not stable enough to be a key: correcting a calving
 * supersedes it and the derived id changes, and -- with no correction at all --
 * recording a calving re-cuts the PREVIOUS lactation's `ended_on`, so yield
 * already written into the overlap silently belongs to a different lactation
 * while a stored key would still name the old one. Both are demonstrated by
 * execution in docs/REGISTRY_MILKING.md §2.
 *
 * Derived by date range, the attribution is always current and nothing dangles.
 *
 * ---------------------------------------------------------------------------
 * THE END BOUNDARY IS NOT THE SAME IN BOTH DIRECTIONS
 * ---------------------------------------------------------------------------
 * `ended_on` means two different things depending on how the lactation closed,
 * and treating them alike refuses a legitimate entry:
 *
 *   - `inferred_at_next_calving` -- the end date IS the next calving's date, and
 *     that day belongs to the NEW lactation. Exclusive.
 *   - `dry_off` -- the end date is the day she was dried off, and she was very
 *     plausibly milked that morning before the decision was made. Inclusive.
 */
export function lactationCovering(
  lactations: readonly LactationRow[],
  on: string,
): LactationRow | null {
  for (const l of lactations) {
    if (l.started_on > on) continue;
    if (l.ended_on === null) return l;
    const inclusive = l.end_reason === 'dry_off';
    if (inclusive ? on <= l.ended_on : on < l.ended_on) return l;
  }
  return null;
}

/** Whole days from the lactation's start to `on`. The x-axis of every curve. */
export function daysInMilk(lactation: LactationRow, on: string): number {
  const [fy, fm, fd] = lactation.started_on.split('-').map(Number);
  const [ty, tm, td] = on.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Validation -- PURE
// ---------------------------------------------------------------------------

export interface MilkingEntryInput {
  animal_id: string;
  status: MilkingStatus;
  /** Required exactly when status is `measured`; refused otherwise. */
  yield_litres?: number | null;
  /** Only with `not_milked`. */
  reason?: string | null;
  /** Overrides the session-level milker for this row. */
  observed_by?: string | null;
  note?: string | null;
}

/** The normalized entry, with the status/yield contract enforced. */
export interface NormalizedEntry {
  animal_id: string;
  status: MilkingStatus;
  yield_litres: number | null;
  reason: string | null;
  observed_by: string | null;
  note: string | null;
}

function refuse(code: ConstructorParameters<typeof RegistryError>[0], msg: string, field?: string): never {
  throw new RegistryError(code, msg, field);
}

/**
 * One entry, validated and normalized.
 *
 * The status/yield agreement is checked here AND by a CHECK constraint AND by
 * an invariant -- three layers, the same arrangement as the date conventions.
 * This one exists to produce a readable refusal; the CHECK exists to catch any
 * process that bypasses this; the invariant exists to catch rows written before
 * a rule existed.
 */
export function assertMilkingEntry(e: MilkingEntryInput): NormalizedEntry {
  if (typeof e.animal_id !== 'string' || e.animal_id.length === 0) {
    refuse('invalid_payload', 'each entry needs an animal_id', 'animal_id');
  }
  if (!(MILKING_STATUSES as readonly string[]).includes(e.status)) {
    refuse(
      'invalid_payload',
      `status must be one of ${MILKING_STATUSES.join(' | ')}, got ${JSON.stringify(e.status)}. ` +
        `'milked_not_measured' is a real answer, not a missing one -- it says milk was taken and ` +
        `nobody weighed it, which is different from 'not_milked'.`,
      'status',
    );
  }

  const yieldGiven = e.yield_litres !== undefined && e.yield_litres !== null;

  if (e.status === 'measured') {
    if (!yieldGiven) {
      refuse(
        'invalid_payload',
        `${e.animal_id}: status 'measured' needs yield_litres. If she was milked and nobody ` +
          `weighed it, that is 'milked_not_measured' -- recording a guess as a measurement is the ` +
          `one thing this table cannot detect later.`,
        'yield_litres',
      );
    }
    const v = e.yield_litres as number;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      refuse('invalid_payload', `${e.animal_id}: yield_litres must be a number, got ${JSON.stringify(v)}`, 'yield_litres');
    }
    if (v < 0) {
      refuse('invalid_payload', `${e.animal_id}: yield_litres cannot be negative, got ${v}`, 'yield_litres');
    }
  } else if (yieldGiven) {
    refuse(
      'invalid_payload',
      `${e.animal_id}: yield_litres was given with status '${e.status}', which means no number ` +
        `was taken. A number filed under a not-measured status is a contradiction rather than a typo.`,
      'yield_litres',
    );
  }

  const reason = blank(e.reason);
  if (reason !== null && e.status !== 'not_milked') {
    refuse(
      'invalid_payload',
      `${e.animal_id}: a reason only belongs with 'not_milked'`,
      'reason',
    );
  }

  return {
    animal_id: e.animal_id,
    status: e.status,
    yield_litres: e.status === 'measured' ? (e.yield_litres as number) : null,
    reason,
    observed_by: blank(e.observed_by),
    note: blank(e.note),
  };
}

function blank(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

// ---------------------------------------------------------------------------
// The write -- one session, one transaction
// ---------------------------------------------------------------------------

export interface SaveMilkingSessionInput {
  occurred_on: string;
  session: MilkingSession;
  /** Optional and NEVER defaulted -- see MilkingSession in types.ts. */
  occurred_time?: string | null;
  /** The session's milker. Each entry may override it. */
  observed_by?: string | null;
  entries: MilkingEntryInput[];
  provenance: Provenance;
}

export interface SaveMilkingSessionResult {
  occurred_on: string;
  session: MilkingSession;
  written: number;
  /** How many of the written rows carry a number. */
  measured: number;
  milked_not_measured: number;
  not_milked: number;
  /** Rows that already existed and were corrected rather than created. */
  updated: number;
  rows: RegistryMilkingRow[];
}

/**
 * Save a whole session. ALL ROWS OR NONE.
 *
 * One transaction because a half-saved session is the failure mode that matters
 * here: the operator would have no way to tell which animals landed, and the
 * completeness count -- the thing that makes the record trustworthy -- would be
 * silently wrong.
 *
 * An UPSERT rather than an insert, because that is what update-in-place
 * correction means: re-saving a session with a fixed number is the ordinary
 * repair path, and it conflicts on (animal_id, occurred_on, session).
 *
 * Entries NOT present are left alone. A partial payload corrects the rows it
 * names and does not delete the rest; removing a row is deleteMilking().
 */
export function saveMilkingSession(
  db: Db,
  input: SaveMilkingSessionInput,
): SaveMilkingSessionResult {
  if (!DATE_RE.test(input.occurred_on)) {
    refuse('invalid_payload', `occurred_on must be YYYY-MM-DD, got '${input.occurred_on}'`, 'occurred_on');
  }
  if (!(MILKING_SESSIONS as readonly string[]).includes(input.session)) {
    refuse(
      'invalid_payload',
      `session must be one of ${MILKING_SESSIONS.join(' | ')}, got ${JSON.stringify(input.session)}`,
      'session',
    );
  }
  const time = blank(input.occurred_time);
  if (time !== null && !/^[0-2]\d:[0-5]\d$/.test(time)) {
    refuse('invalid_payload', `occurred_time must be HH:MM, got '${time}'`, 'occurred_time');
  }
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    refuse(
      'empty_session',
      'a session with no entries writes nothing. If no animal was milked, that is a session of ' +
        "'not_milked' rows, which is a different and recordable fact.",
      'entries',
    );
  }

  const normalized = input.entries.map(assertMilkingEntry);

  const seen = new Set<string>();
  for (const e of normalized) {
    if (seen.has(e.animal_id)) {
      refuse(
        'invalid_payload',
        `${e.animal_id} appears twice in one session. One row per animal per session is what ` +
          `makes completeness countable.`,
        'entries',
      );
    }
    seen.add(e.animal_id);
  }

  const sessionMilker = blank(input.observed_by);
  const recordedAt = new Date().toISOString();

  const run = db.transaction((): SaveMilkingSessionResult => {
    const rows: RegistryMilkingRow[] = [];
    let updated = 0;

    for (const e of normalized) {
      const animal = getAnimal(db, e.animal_id);
      if (!animal) {
        refuse('unknown_animal', `unknown registry animal '${e.animal_id}'`, 'animal_id');
      }

      // The one domain rule beyond the payload shape. An animal with no open
      // lactation on this date was not producing milk, so the row is either the
      // wrong animal or the wrong date -- and both are fixed by correcting the
      // input rather than by insisting past a guard.
      const lactations = db
        .prepare(`SELECT * FROM registry_lactations WHERE animal_id = ? ORDER BY started_on`)
        .all(e.animal_id) as LactationRow[];
      if (lactationCovering(lactations, input.occurred_on) === null) {
        refuse(
          'no_open_lactation',
          `${e.animal_id} has no lactation covering ${input.occurred_on}, so she was not in milk ` +
            `then. Either the date is wrong, or her calving has not been entered yet -- record the ` +
            `calving and the roster will include her.`,
          'animal_id',
        );
      }

      const existing = db
        .prepare(
          `SELECT id FROM registry_milkings
            WHERE animal_id = ? AND occurred_on = ? AND session = ?`,
        )
        .get(e.animal_id, input.occurred_on, input.session) as { id: string } | undefined;

      const row: RegistryMilkingRow = {
        id: existing?.id ?? newMilkingId(),
        animal_id: e.animal_id,
        occurred_on: input.occurred_on,
        session: input.session,
        status: e.status,
        yield_litres: e.yield_litres,
        reason: e.reason,
        occurred_time: time,
        // The row's own milker wins; the session default fills the rest.
        observed_by: e.observed_by ?? sessionMilker,
        recorded_by: input.provenance.recorded_by,
        recorded_at: recordedAt,
        source_form: input.provenance.source_form,
        note: e.note,
      };

      db.prepare(
        `INSERT INTO registry_milkings
           (id, animal_id, occurred_on, session, status, yield_litres, reason,
            occurred_time, observed_by, recorded_by, recorded_at, source_form, note)
         VALUES
           (@id, @animal_id, @occurred_on, @session, @status, @yield_litres, @reason,
            @occurred_time, @observed_by, @recorded_by, @recorded_at, @source_form, @note)
         ON CONFLICT (animal_id, occurred_on, session) DO UPDATE SET
            status        = excluded.status,
            yield_litres  = excluded.yield_litres,
            reason        = excluded.reason,
            occurred_time = excluded.occurred_time,
            observed_by   = excluded.observed_by,
            recorded_by   = excluded.recorded_by,
            recorded_at   = excluded.recorded_at,
            source_form   = excluded.source_form,
            note          = excluded.note`,
      ).run(row);

      if (existing) updated++;
      rows.push(row);
    }

    const count = (s: MilkingStatus) => rows.filter((r) => r.status === s).length;
    return {
      occurred_on: input.occurred_on,
      session: input.session,
      written: rows.length,
      measured: count('measured'),
      milked_not_measured: count('milked_not_measured'),
      not_milked: count('not_milked'),
      updated,
      rows,
    };
  });

  return run();
}

// ---------------------------------------------------------------------------
// The roster -- the read model the entry screen is
// ---------------------------------------------------------------------------

export interface RosterRow {
  animal_id: string;
  name: string | null;
  /** Days into this lactation at this date. The x-axis of every curve. */
  days_in_milk: number;
  lactation_started_on: string;
  /** This animal's row for THIS session, when one has already been saved. */
  existing: RegistryMilkingRow | null;
  /**
   * The same session's figure yesterday -- the strongest error-catcher on the
   * screen, because a misplaced decimal is obvious against it and invisible on
   * its own. The SAME session, never the chronologically previous one: morning
   * and evening are not comparable.
   */
  previous: { session: MilkingSession; occurred_on: string; status: MilkingStatus; yield_litres: number | null } | null;
  /** Mean of this animal's recent MEASURED rows, for the soft out-of-band hint. */
  recent_mean: number | null;
  recent_n: number;
}

export interface MilkingRoster {
  occurred_on: string;
  session: MilkingSession;
  /**
   * The last COMPARABLE session -- the same one, the day before. Named so the
   * client can label the column without re-deriving the rule.
   */
  previous_session: { occurred_on: string; session: MilkingSession };
  rows: RosterRow[];
  /** How many rows already exist -- lets the screen say "already saved". */
  saved: number;
}

/** How many recent measured rows the mean is taken over. Same session only. */
export const RECENT_WINDOW = 7;

/**
 * The last comparable session: THE SAME ONE, the day before.
 *
 * Deliberately not the chronologically previous milking, which for an evening
 * would be that morning. Yield depends on the interval since the last milking,
 * and with variable milking times that interval is unknown -- so a morning
 * figure and an evening figure are not comparable, and putting one beside the
 * other as a reference would make an ordinary evening look like a collapse.
 *
 * This is the same rule the report states and the same one /check applies to
 * measured and approximate calving intervals: the two sets are reported side by
 * side and never blended.
 */
export function comparableSession(on: string, session: MilkingSession): {
  occurred_on: string;
  session: MilkingSession;
} {
  const [y, m, d] = on.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return { occurred_on: prev.toISOString().slice(0, 10), session };
}

/**
 * Every animal in milk on this date, with the context that catches errors.
 *
 * THE ROSTER IS DERIVED, NEVER PICKED. Membership is "has a lactation covering
 * this date" -- there is no dropdown, no search, and no way to leave an animal
 * out of the list, which is what makes an omission deliberate rather than
 * possible.
 *
 * Note it is computed from the LACTATION ROWS and not from
 * registry_animal_status.open_lactation_id: the status projection is as-of-now,
 * and this screen must be able to open a past date and show who was in milk
 * THEN. Entering yesterday's evening session is an ordinary thing to do.
 */
export function milkingRoster(
  db: Db,
  opts: { occurred_on: string; session: MilkingSession },
): MilkingRoster {
  if (!DATE_RE.test(opts.occurred_on)) {
    refuse('invalid_payload', `occurred_on must be YYYY-MM-DD, got '${opts.occurred_on}'`, 'occurred_on');
  }
  if (!(MILKING_SESSIONS as readonly string[]).includes(opts.session)) {
    refuse('invalid_payload', `unknown session '${opts.session}'`, 'session');
  }

  const prev = comparableSession(opts.occurred_on, opts.session);

  const lactations = db
    .prepare(`SELECT * FROM registry_lactations ORDER BY animal_id, started_on`)
    .all() as LactationRow[];
  const byAnimal = new Map<string, LactationRow[]>();
  for (const l of lactations) {
    const list = byAnimal.get(l.animal_id);
    if (list) list.push(l);
    else byAnimal.set(l.animal_id, [l]);
  }

  const rows: RosterRow[] = [];

  for (const [animalId, mine] of byAnimal) {
    const covering = lactationCovering(mine, opts.occurred_on);
    if (covering === null) continue;

    const animal = getAnimal(db, animalId);
    if (!animal) continue; // a lactation with no animal is invariant 3's problem

    const existing =
      (db
        .prepare(
          `SELECT * FROM registry_milkings
            WHERE animal_id = ? AND occurred_on = ? AND session = ?`,
        )
        .get(animalId, opts.occurred_on, opts.session) as RegistryMilkingRow | undefined) ?? null;

    const previous =
      (db
        .prepare(
          `SELECT session, occurred_on, status, yield_litres FROM registry_milkings
            WHERE animal_id = ? AND occurred_on = ? AND session = ?`,
        )
        .get(animalId, prev.occurred_on, prev.session) as RosterRow['previous']) ?? null;

    // Only MEASURED rows feed the mean, and only from THIS SESSION. Averaging
    // over milked_not_measured would be averaging over nothing; counting
    // not_milked as a zero would drag the band down with days she was never
    // expected to give; and pooling morning with evening would compare two
    // figures separated by an unknown interval, which is the one thing this
    // whole module refuses to do.
    const recent = db
      .prepare(
        `SELECT yield_litres FROM registry_milkings
          WHERE animal_id = ? AND status = 'measured' AND session = ?
            AND occurred_on <= ?
          ORDER BY occurred_on DESC
          LIMIT ?`,
      )
      .all(animalId, opts.session, opts.occurred_on, RECENT_WINDOW) as { yield_litres: number }[];

    rows.push({
      animal_id: animalId,
      name: animal.name,
      days_in_milk: daysInMilk(covering, opts.occurred_on),
      lactation_started_on: covering.started_on,
      existing,
      previous,
      recent_mean:
        recent.length > 0
          ? Math.round((recent.reduce((a, r) => a + r.yield_litres, 0) / recent.length) * 100) / 100
          : null,
      recent_n: recent.length,
    });
  }

  rows.sort((a, b) => (a.animal_id < b.animal_id ? -1 : a.animal_id > b.animal_id ? 1 : 0));

  return {
    occurred_on: opts.occurred_on,
    session: opts.session,
    previous_session: prev,
    rows,
    saved: rows.filter((r) => r.existing !== null).length,
  };
}

/**
 * One animal's yield history, oldest first, with its lactation derived per row.
 *
 * The lactation is attached HERE rather than stored, which is the whole point of
 * §2: a row's lactation is a function of the calving dates as they stand now, so
 * a corrected calving re-attributes its yield with no migration and no dangling
 * key.
 */
export interface MilkingHistoryRow extends RegistryMilkingRow {
  lactation_id: string | null;
  days_in_milk: number | null;
}

export function milkingsForAnimal(db: Db, animalId: string): MilkingHistoryRow[] {
  const lactations = db
    .prepare(`SELECT * FROM registry_lactations WHERE animal_id = ? ORDER BY started_on`)
    .all(animalId) as LactationRow[];

  const rows = db
    .prepare(
      `SELECT * FROM registry_milkings WHERE animal_id = ?
        ORDER BY occurred_on, CASE session WHEN 'morning' THEN 0 ELSE 1 END`,
    )
    .all(animalId) as RegistryMilkingRow[];

  return rows.map((r) => {
    const l = lactationCovering(lactations, r.occurred_on);
    return {
      ...r,
      lactation_id: l?.id ?? null,
      days_in_milk: l ? daysInMilk(l, r.occurred_on) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Completeness -- the number that says whether the data is worth analysing
// ---------------------------------------------------------------------------

export interface SessionCompleteness {
  occurred_on: string;
  session: MilkingSession;
  /** Animals with a lactation covering that date -- who SHOULD have a row. */
  expected: number;
  recorded: number;
  measured: number;
  milked_not_measured: number;
  not_milked: number;
}

export interface MilkingReport {
  rows: number;
  measured: number;
  milked_not_measured: number;
  not_milked: number;
  sessions: number;
  /** Sessions where every animal in milk has a row. */
  complete_sessions: number;
  first_on: string | null;
  last_on: string | null;
  /** Most recent first, capped -- this is a diagnostic, not a data export. */
  recent: SessionCompleteness[];
  caveat: string;
}

export const RECENT_SESSIONS = 14;

/**
 * How complete the record is, per session. PURE.
 *
 * This is to milk what the precision histogram is to dates: the number that says
 * whether what has been collected can carry the weight of a conclusion. It
 * asserts nothing and nothing branches on it.
 *
 * `expected` is recomputed from the lactations rather than stored, so it is
 * always the answer for the herd as it stands now -- a calving entered late
 * retroactively raises the expected count for the sessions it covers, which is
 * correct: those animals WERE in milk, and the rows really are missing.
 *
 * MEASURED AND NOT-MEASURED ARE REPORTED SEPARATELY AND NEVER SUMMED INTO A
 * COVERAGE FIGURE. A session where every animal has a row is complete as a
 * record; if most of those rows are `milked_not_measured` it is still nearly
 * empty as data, and one blended percentage would hide exactly that.
 */
export function milkingReport(
  milkings: readonly RegistryMilkingRow[],
  lactations: readonly LactationRow[],
): MilkingReport {
  const byAnimal = new Map<string, LactationRow[]>();
  for (const l of lactations) {
    const list = byAnimal.get(l.animal_id);
    if (list) list.push(l);
    else byAnimal.set(l.animal_id, [l]);
  }

  const expectedOn = (on: string): number => {
    let n = 0;
    for (const list of byAnimal.values()) {
      if (lactationCovering(list, on) !== null) n++;
    }
    return n;
  };

  const bySession = new Map<string, SessionCompleteness>();
  for (const m of milkings) {
    const key = `${m.occurred_on}|${m.session}`;
    let row = bySession.get(key);
    if (!row) {
      row = {
        occurred_on: m.occurred_on,
        session: m.session,
        expected: expectedOn(m.occurred_on),
        recorded: 0,
        measured: 0,
        milked_not_measured: 0,
        not_milked: 0,
      };
      bySession.set(key, row);
    }
    row.recorded++;
    row[m.status]++;
  }

  const sessions = [...bySession.values()].sort((a, b) => {
    if (a.occurred_on !== b.occurred_on) return a.occurred_on < b.occurred_on ? 1 : -1;
    return a.session === b.session ? 0 : a.session === 'evening' ? -1 : 1;
  });

  const count = (s: MilkingStatus) => milkings.filter((m) => m.status === s).length;
  const dates = milkings.map((m) => m.occurred_on).sort();

  return {
    rows: milkings.length,
    measured: count('measured'),
    milked_not_measured: count('milked_not_measured'),
    not_milked: count('not_milked'),
    sessions: sessions.length,
    complete_sessions: sessions.filter((s) => s.recorded >= s.expected).length,
    first_on: dates[0] ?? null,
    last_on: dates[dates.length - 1] ?? null,
    recent: sessions.slice(0, RECENT_SESSIONS),
    caveat:
      'A complete session means every animal in milk has a row, not that every row carries a ' +
      'number. The two are reported separately and never blended: a session of all ' +
      'milked_not_measured is a complete record and empty data. Morning and evening are also ' +
      'never pooled -- the interval between milkings is unknown, so the two are not comparable.',
  };
}

/**
 * Remove one row, or a whole session.
 *
 * The repair path for a session entered against the wrong date, which
 * update-in-place leaves no other way to fix. Deliberately narrow: it takes a
 * date and a session, never a range, so there is no shape of call that clears
 * history.
 */
export function deleteMilkings(
  db: Db,
  where: { occurred_on: string; session: MilkingSession; animal_id?: string },
): number {
  if (!DATE_RE.test(where.occurred_on)) {
    refuse('invalid_payload', `occurred_on must be YYYY-MM-DD, got '${where.occurred_on}'`, 'occurred_on');
  }
  if (!(MILKING_SESSIONS as readonly string[]).includes(where.session)) {
    refuse('invalid_payload', `unknown session '${where.session}'`, 'session');
  }
  const info =
    where.animal_id !== undefined
      ? db
          .prepare(
            `DELETE FROM registry_milkings
              WHERE occurred_on = ? AND session = ? AND animal_id = ?`,
          )
          .run(where.occurred_on, where.session, where.animal_id)
      : db
          .prepare(`DELETE FROM registry_milkings WHERE occurred_on = ? AND session = ?`)
          .run(where.occurred_on, where.session);
  return info.changes;
}
