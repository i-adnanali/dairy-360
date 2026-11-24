// Animal registry -- the breeding backfill: check and save the cases the owner picks.
//
// PURE over a `Db` handle: no `../db`. The command (breed-backfill.ts) is a thin
// shell; these two functions are what the tests exercise on :memory: databases.
//
// The check reuses the real write path rather than a copy of its rules: every
// row goes through recordBreedingEvent inside one transaction, so a later row of
// a case is judged with the earlier rows already in place, exactly as it will be
// when saved. checkBackfill always rolls that transaction back; saveBackfill
// commits it only when no row was refused or needs an allow, so a file is
// written whole or not at all.
//
// Each row gets a strictly increasing recorded_at, so rows of the same day keep
// file order even when the clock does not move between them (the canonical
// order breaks a same-time tie on recorded_at, then on the random id).
//
//   would_write        recordBreedingEvent accepted it (any warning it raised is
//                      named in the row's `allow`, and recorded from the condition)
//   already_on_record  an effective event ALREADY ON RECORD before this run has the
//                      same animal, type, date, time, precision and payload; not
//                      written again. Rows written earlier in the same run never
//                      count, so a real second same-day service is not dropped.
//   refused            a stage 1 refusal: code and message
//   needs_allow        a warning fired that the row's `allow` does not name

import { CliError } from './cli';
import { isRegistryError } from './errors';
import { recordBreedingEvent } from './breeding';
import { assertEventPayload } from './events';
import { effectiveEvents } from './project';
import { eventsForAnimal, stableStringify } from './store';
import { BREEDING_EVENT_TYPES, BREEDING_OVERRIDDEN_CHECKS, DATE_PRECISIONS } from './types';
import type { Db } from './schema';
import type { BreedingEventType, BreedingOverriddenCheck, DatePrecision, RegistryEvent, SourceForm } from './types';

/** Where backfilled rows come from. `direct_entry` is the page, not a backfill. */
export const BACKFILL_SOURCE_FORMS = ['recall', 'cycle_card', 'daily_herd_sheet', 'import'] as const satisfies readonly SourceForm[];

export interface BackfillEvent {
  type: BreedingEventType;
  occurred_on: string;
  date_precision: DatePrecision;
  occurred_time: string | null;
  payload: Record<string, unknown>;
  observed_by: string | null;
  allow: BreedingOverriddenCheck[];
  override_reason: string | null;
}

export interface BackfillCase {
  animal_id: string;
  source_form: SourceForm;
  events: BackfillEvent[];
}

export interface BackfillFile {
  cases: BackfillCase[];
}

export type BackfillOutcome =
  | { outcome: 'would_write' }
  | { outcome: 'already_on_record'; event_id: string }
  | { outcome: 'refused'; code: string; message: string }
  | { outcome: 'needs_allow'; warnings: { check: BreedingOverriddenCheck; message: string }[] };

export type BackfillRow = {
  case_index: number;
  event_index: number;
  animal_id: string;
  type: BreedingEventType;
  occurred_on: string;
} & BackfillOutcome;

export interface BackfillReport {
  rows: BackfillRow[];
  /** True when nothing is refused and nothing needs an allow. */
  clean: boolean;
}

export interface BackfillSaveResult {
  report: BackfillReport;
  written: boolean;
  /** The events written, in file order. Empty when nothing was written. */
  event_ids: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function keysOnly(at: string, o: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw new CliError(`${at}: unknown key '${k}'. Allowed: ${allowed.join(', ')}`);
  }
}

function oneOf<T extends string>(at: string, v: unknown, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new CliError(`${at} must be one of ${allowed.join(' | ')}, got ${JSON.stringify(v)}`);
  }
  return v as T;
}

function optText(at: string, v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new CliError(`${at} must be a string, got ${JSON.stringify(v)}`);
  return v.length === 0 ? null : v;
}

/**
 * The file's shape, checked before anything else. Unknown keys, wrong types and
 * empty lists are refused with the path to the offending value, so a malformed
 * file writes nothing. The rules about the herd are left to recordBreedingEvent.
 */
export function parseBackfillFile(raw: unknown): BackfillFile {
  if (!isObject(raw)) throw new CliError('the backfill file must be a JSON object: { "cases": [ ... ] }');
  keysOnly('file', raw, ['cases']);
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    throw new CliError('file: "cases" must be a non-empty list');
  }
  const cases = raw.cases.map((c: unknown, ci: number): BackfillCase => {
    const at = `cases[${ci}]`;
    if (!isObject(c)) throw new CliError(`${at} must be an object`);
    keysOnly(at, c, ['animal_id', 'source_form', 'events']);
    if (typeof c.animal_id !== 'string' || c.animal_id.trim() === '') {
      throw new CliError(`${at}.animal_id must be a registry serial, e.g. "BD-0012"`);
    }
    if (c.animal_id !== c.animal_id.trim()) {
      throw new CliError(`${at}.animal_id has spaces around it: ${JSON.stringify(c.animal_id)}`);
    }
    const source_form = oneOf(`${at}.source_form`, c.source_form, BACKFILL_SOURCE_FORMS);
    if (!Array.isArray(c.events) || c.events.length === 0) {
      throw new CliError(`${at}.events must be a non-empty list`);
    }
    const events = c.events.map((e: unknown, ei: number): BackfillEvent => {
      const eat = `${at}.events[${ei}]`;
      if (!isObject(e)) throw new CliError(`${eat} must be an object`);
      keysOnly(eat, e, [
        'type', 'occurred_on', 'date_precision', 'occurred_time', 'payload', 'observed_by', 'allow', 'override_reason',
      ]);
      const type = oneOf(`${eat}.type`, e.type, BREEDING_EVENT_TYPES);
      if (typeof e.occurred_on !== 'string' || !DATE_RE.test(e.occurred_on)) {
        throw new CliError(`${eat}.occurred_on must be YYYY-MM-DD, got ${JSON.stringify(e.occurred_on)}`);
      }
      // Any precision is accepted here; the ones a breeding event cannot have
      // come back from recordBreedingEvent as its own refusal.
      const date_precision = oneOf(`${eat}.date_precision`, e.date_precision, DATE_PRECISIONS);
      const occurred_time = optText(`${eat}.occurred_time`, e.occurred_time);
      if (occurred_time !== null && !TIME_RE.test(occurred_time)) {
        throw new CliError(`${eat}.occurred_time must be HH:MM from 00:00 to 23:59, got ${JSON.stringify(occurred_time)}`);
      }
      if (!isObject(e.payload)) throw new CliError(`${eat}.payload must be an object`);
      let allow: BreedingOverriddenCheck[] = [];
      if (e.allow !== undefined) {
        if (!Array.isArray(e.allow)) throw new CliError(`${eat}.allow must be a list`);
        allow = e.allow.map((a: unknown, ai: number) => oneOf(`${eat}.allow[${ai}]`, a, BREEDING_OVERRIDDEN_CHECKS));
      }
      return {
        type,
        occurred_on: e.occurred_on,
        date_precision,
        occurred_time,
        payload: e.payload,
        observed_by: optText(`${eat}.observed_by`, e.observed_by),
        allow,
        override_reason: optText(`${eat}.override_reason`, e.override_reason),
      };
    });
    return { animal_id: c.animal_id, source_form, events };
  });
  return { cases };
}

/** The event on record before the run that this row repeats, or null. Payloads compare by canonical JSON. */
function onRecord(before: RegistryEvent[], e: BackfillEvent): string | null {
  let payload: string;
  try {
    payload = stableStringify(assertEventPayload(e.type, e.payload) as unknown as Record<string, unknown>);
  } catch {
    // An invalid payload matches nothing; the write path refuses it.
    return null;
  }
  const same = before.find(
    (x) =>
      x.type === e.type &&
      x.occurred_on === e.occurred_on &&
      (x.occurred_time ?? null) === e.occurred_time &&
      x.date_precision === e.date_precision &&
      stableStringify(x.payload) === payload,
  );
  return same ? same.id : null;
}

/** Thrown to roll the transaction back; carries what ran inside it. */
class Rollback {
  constructor(readonly result: { report: BackfillReport; event_ids: string[] }) {}
}

/** Every row through the real write path, in file order. Called inside a transaction. */
function run(db: Db, file: BackfillFile, recordedBy: string): { report: BackfillReport; event_ids: string[] } {
  const rows: BackfillRow[] = [];
  const event_ids: string[] = [];
  // What was on record before this run, per animal: a row matches only these.
  const before = new Map<string, RegistryEvent[]>();
  for (const c of file.cases) {
    if (!before.has(c.animal_id)) before.set(c.animal_id, effectiveEvents(eventsForAnimal(db, c.animal_id)));
  }
  let last = 0;
  const nextRecordedAt = (): string => {
    last = Math.max(Date.now(), last + 1);
    return new Date(last).toISOString();
  };
  file.cases.forEach((c, case_index) => {
    c.events.forEach((e, event_index) => {
      const at = { case_index, event_index, animal_id: c.animal_id, type: e.type, occurred_on: e.occurred_on };
      const existing = onRecord(before.get(c.animal_id) ?? [], e);
      if (existing !== null) {
        rows.push({ ...at, outcome: 'already_on_record', event_id: existing });
        return;
      }
      const allows = new Set(e.allow);
      try {
        const { event_id } = recordBreedingEvent(db, {
          animal_id: c.animal_id,
          type: e.type,
          occurred_on: e.occurred_on,
          occurred_time: e.occurred_time,
          date_precision: e.date_precision,
          payload: e.payload,
          provenance: {
            source_form: c.source_form,
            source_ref: null,
            observed_by: e.observed_by,
            recorded_by: recordedBy,
          },
          allow_ambiguous_service: allows.has('ambiguous_service'),
          allow_early_check: allows.has('early_check'),
          allow_check_without_service: allows.has('check_without_service'),
          allow_no_heat_sign: allows.has('no_heat_sign'),
          allow_heat_after_positive: allows.has('heat_after_positive'),
          override_reason: e.override_reason,
          recorded_at: nextRecordedAt(),
        });
        event_ids.push(event_id);
        rows.push({ ...at, outcome: 'would_write' });
      } catch (err) {
        if (!isRegistryError(err)) throw err;
        // A warning refusal carries every warning that fired; the ones the row
        // already allows are not what holds it back.
        const fired = (err.warnings ?? []).filter((w) =>
          (BREEDING_OVERRIDDEN_CHECKS as readonly string[]).includes(w.check),
        ) as { check: BreedingOverriddenCheck; message: string }[];
        if (fired.length > 0) {
          rows.push({
            ...at,
            outcome: 'needs_allow',
            warnings: fired.filter((w) => !allows.has(w.check)).map((w) => ({ check: w.check, message: w.message })),
          });
        } else {
          rows.push({ ...at, outcome: 'refused', code: err.code, message: err.message });
        }
      }
    });
  });
  const clean = rows.every((r) => r.outcome === 'would_write' || r.outcome === 'already_on_record');
  return { report: { rows, clean }, event_ids };
}

function requireRecorder(recordedBy: string): string {
  if (typeof recordedBy !== 'string' || recordedBy.trim() === '') {
    throw new CliError('recorded_by is required: who is entering this backfill');
  }
  return recordedBy;
}

/** The report for a file. Writes nothing: the rows are written and rolled back. */
export function checkBackfill(db: Db, raw: unknown, recordedBy: string): BackfillReport {
  const file = parseBackfillFile(raw);
  const by = requireRecorder(recordedBy);
  try {
    db.transaction(() => {
      throw new Rollback(run(db, file, by));
    })();
  } catch (e) {
    if (e instanceof Rollback) return e.result.report;
    throw e;
  }
  throw new Error('unreachable: the check transaction always rolls back');
}

/**
 * Check and write in one transaction. Any row refused or needing an allow rolls
 * the whole file back, other cases' clean rows included.
 */
export function saveBackfill(db: Db, raw: unknown, recordedBy: string): BackfillSaveResult {
  const file = parseBackfillFile(raw);
  const by = requireRecorder(recordedBy);
  try {
    const result = db.transaction(() => {
      const r = run(db, file, by);
      if (!r.report.clean) throw new Rollback(r);
      return r;
    })();
    return { report: result.report, written: true, event_ids: result.event_ids };
  } catch (e) {
    if (e instanceof Rollback) return { report: e.result.report, written: false, event_ids: [] };
    throw e;
  }
}
