// Animal registry -- the write boundary (decision doc §5, §7).
//
// PURE: no `../db` import, so registry.events.test.ts exercises validation with
// no database, the same property classify.ts holds.
//
// Validation is hand-rolled and exhaustive rather than schema-library-driven.
// The repo has no Zod and no validation library; boundary validation today is
// guardIds() plus String(args.x) coercion, with JSON-Schema enums enforced by
// the model rather than by code. Six payload shapes is less code than the
// dependency would be, and adding a validation library is a repo-wide decision
// rather than a registry one (decision doc §7).

import { randomUUID } from 'node:crypto';
import { RegistryError } from './errors';
import type { RegistryErrorCode } from './errors';
import type {
  AcquiredPayload,
  BirthPayload,
  CalvingPayload,
  DatePrecision,
  DeparturePayload,
  DryOffPayload,
  NotePayload,
  OverriddenCheck,
  OverrideRecord,
  PayloadFor,
  RegistryEventType,
} from './types';
import {
  DATE_PRECISIONS,
  LIVE_EVENT_TYPES,
  OVERRIDDEN_CHECKS,
  RESERVED_EVENT_TYPES,
} from './types';

// ---------------------------------------------------------------------------
// Identifiers (decision doc §5)
// ---------------------------------------------------------------------------

export const EVENT_ID_PREFIX = 'aevt_';
export const LACTATION_ID_PREFIX = 'lact_';
export const SERIAL_PREFIX = 'BD-';
export const SERIAL_PAD = 4;

/**
 * Event id: the prefix convention, the FULL uuid.
 *
 * THE 8-CHAR CONVENTION IS DELIBERATELY NOT FOLLOWED HERE, and this is the
 * comment explaining why. Nine sites in this repo use
 * `<prefix>_${randomUUID().slice(0, 8)}` -- animal_, milking_, health_, vendor_,
 * delivery_, farm_event_, ds_. Eight hex characters is 32 bits, which gives a
 * birthday collision around 77k rows and non-trivial risk far below that.
 *
 * That matters more here than anywhere else in the repo, because a lactation id
 * is derived from a calving event id (below), and a collision would give two
 * lactations one id -- the exact failure the id-stability decision exists to
 * prevent, reintroduced through the id format instead of the numbering scheme.
 *
 * This comment used to say step 4's yield rows would carry that id as a FOREIGN
 * KEY. They will not; see lactationIdFor() below and docs/REGISTRY_MILKING.md §2.
 *
 * No ULID/UUIDv7 dependency is added, and no sortability is claimed: creation
 * order is recoverable from `recorded_at`, which is NOT NULL and exact.
 */
export function newEventId(): string {
  return `${EVENT_ID_PREFIX}${randomUUID()}`;
}

/**
 * Lactation id, derived from the calving event that opened it.
 *
 * Stability comes from deriving it from an immutable event, not from the id
 * format. A sequence-encoded id (`BD-0042-L3`) renumbers every later lactation
 * for an animal the moment an earlier calving is discovered during backfill --
 * which will happen. The display sequence number ("3rd lactation") is computed
 * at read time, where being wrong is visible and harmless.
 *
 * ---------------------------------------------------------------------------
 * THIS ID IS STABLE ENOUGH TO BE AN IDENTIFIER AND NOT ENOUGH TO BE A KEY
 * ---------------------------------------------------------------------------
 * The plan recorded here until now was that step 4's yield rows would carry it
 * as a foreign key. They do not, and the reason is worth keeping because the
 * distinction is easy to lose:
 *
 *   - Correcting a calving's DATE supersedes it, so the effective calving has a
 *     new id, so this returns a new lactation id and the rebuild deletes the old
 *     row. A yield row keyed on it would DANGLE.
 *   - Worse, and with no correction involved at all: a lactation's `ended_on` is
 *     the NEXT calving's date, so simply recording a calving re-cuts the
 *     previous lactation's boundary. Yield already written into the overlap now
 *     belongs to a different lactation, while its key still names the old one.
 *     It does not dangle -- it is silently WRONG, and no invariant can see it
 *     because both rows exist.
 *
 * The second case is why a rewrite-on-correction would not have saved it. So
 * yield is keyed on (animal_id, occurred_on, session) and its lactation is
 * DERIVED at read time by date range. Both failures are demonstrated by
 * execution in docs/REGISTRY_MILKING.md §2.
 *
 * The general rule, which outlives this instance: registry_lactations is a
 * PROJECTION table that the rebuild drops and recreates, so a permanent record
 * must never carry a foreign key into it.
 */
export function lactationIdFor(calvingEventId: string): string {
  if (!calvingEventId.startsWith(EVENT_ID_PREFIX)) {
    throw new Error(
      `lactationIdFor: expected an event id starting with '${EVENT_ID_PREFIX}', got '${calvingEventId}'`,
    );
  }
  return `${LACTATION_ID_PREFIX}${calvingEventId.slice(EVENT_ID_PREFIX.length)}`;
}

/** `BD-0001`. Left-padded so lexical sort matches numeric sort. */
export function formatSerial(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`formatSerial: serial must be a positive integer, got ${n}`);
  }
  return `${SERIAL_PREFIX}${String(n).padStart(SERIAL_PAD, '0')}`;
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

/**
 * A payload or date/precision refusal.
 *
 * A RegistryError subclass, not a bare Error: these are the refusals the entry
 * form will hit most often -- every date input goes through
 * assertDatePrecision -- so they need the same { code, field, message } contract
 * as every other domain rule. Before this they escaped runCli() entirely and
 * printed a stack trace at an operator mid-backfill.
 */
export class EventPayloadError extends RegistryError {
  constructor(code: RegistryErrorCode, message: string, field?: string) {
    super(code, message, field);
    this.name = 'EventPayloadError';
  }
}

const fail = (code: RegistryErrorCode, msg: string, field?: string): never => {
  throw new EventPayloadError(code, msg, field);
};

type Rec = Record<string, unknown>;

function requireObject(type: string, payload: unknown): Rec {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('invalid_payload', `${type}: payload must be an object, got ${describe(payload)}`);
  }
  return payload as Rec;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return typeof v;
}

/**
 * Reject keys the payload shape does not declare.
 *
 * Not pedantry: a typo'd key (`calf_sexe`) would otherwise be accepted, stored
 * as JSON, and read back as `undefined` by the projection -- producing a wrong
 * derived value with no error anywhere. This is the same class of silent
 * failure the precision-has-no-default rule exists to prevent.
 */
function rejectUnknownKeys(type: string, p: Rec, allowed: readonly string[]): void {
  const unknown = Object.keys(p).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    fail(
      'invalid_payload',
      `${type}: unknown payload key(s) ${unknown.map((k) => `'${k}'`).join(', ')}; ` +
        `allowed: ${allowed.join(', ')}`,
      unknown[0],
    );
  }
}

function str(type: string, p: Rec, key: string): string {
  const v = p[key];
  if (typeof v !== 'string' || v.length === 0) {
    fail('invalid_payload', `${type}.${key}: required non-empty string, got ${describe(v)}`, key);
  }
  return v as string;
}

function optStr(type: string, p: Rec, key: string): string | null {
  const v = p[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') {
    fail('invalid_payload', `${type}.${key}: must be a string when present, got ${describe(v)}`, key);
  }
  return v as string;
}

function enumOf<T extends string>(
  type: string,
  p: Rec,
  key: string,
  allowed: readonly T[],
): T {
  const v = p[key];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    fail(
      'invalid_payload',
      `${type}.${key}: must be one of ${allowed.join(' | ')}, got ${JSON.stringify(v)}`,
      key,
    );
  }
  return v as T;
}

function optEnumOf<T extends string>(
  type: string,
  p: Rec,
  key: string,
  allowed: readonly T[],
): T | null {
  const v = p[key];
  if (v === undefined || v === null) return null;
  return enumOf(type, p, key, allowed);
}

const SEXES = ['female', 'male'] as const;
const OUTCOMES = ['live', 'stillborn', 'died_within_24h'] as const;
const ASSISTANCE = ['none', 'assisted', 'vet'] as const;
const DRY_OFF_REASONS = ['scheduled', 'low_yield', 'health', 'other'] as const;
const DEPARTURE_REASONS = ['sold', 'died', 'culled', 'lost'] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The `override` sub-object, validated as strictly as the payload around it.
 *
 * A loosely-accepted override would be the worst of both worlds: the log would
 * claim a check was stepped past without saying which, which is less useful
 * than the nothing it replaced.
 */
function optOverride(type: string, p: Rec): OverrideRecord | null {
  const v = p.override;
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) {
    fail('invalid_payload', `${type}.override: must be an object, got ${describe(v)}`, 'override');
  }
  const o = v as Rec;
  rejectUnknownKeys(`${type}.override`, o, ['check', 'reason']);
  const check = enumOf(`${type}.override`, o, 'check', OVERRIDDEN_CHECKS as readonly OverriddenCheck[]);
  return { check, reason: optStr(`${type}.override`, o, 'reason') };
}

function optDate(type: string, p: Rec, key: string): string | null {
  const v = optStr(type, p, key);
  if (v === null) return null;
  if (!DATE_RE.test(v)) {
    fail('invalid_payload', `${type}.${key}: must be YYYY-MM-DD, got '${v}'`, key);
  }
  return v;
}

/**
 * The one write boundary. Exhaustive over the discriminated union.
 *
 * Returns the normalized payload -- optional keys present as explicit `null`
 * rather than absent -- so a round trip through JSON.stringify is stable and
 * two logically identical payloads serialize identically. That matters for the
 * rebuild-diff: differing key order or absent-vs-null would read as a change.
 */
export function assertEventPayload<T extends RegistryEventType>(
  type: T,
  payload: unknown,
): PayloadFor<T> {
  if ((RESERVED_EVENT_TYPES as readonly string[]).includes(type)) {
    fail(
      'invalid_payload',
      `'${type}' is a RESERVED event type: named in the taxonomy but not implemented ` +
        `in this cycle. Reserved types are rejected here rather than accepted with a ` +
        `loose payload, so the derivation rules for them are written once, deliberately.`,
    );
  }
  if (!(LIVE_EVENT_TYPES as readonly string[]).includes(type)) {
    fail(
      'invalid_payload',
      `'${type}' is not a registry event type; expected one of ${LIVE_EVENT_TYPES.join(' | ')}`,
      'type',
    );
  }

  const p = requireObject(type, payload);

  switch (type) {
    case 'birth': {
      rejectUnknownKeys(type, p, [
        'dam_id',
        'sire_ref',
        'calving_event_id',
        'sex',
        'outcome',
      ]);
      const out: BirthPayload = {
        dam_id: str(type, p, 'dam_id'),
        sire_ref: optStr(type, p, 'sire_ref'),
        calving_event_id: str(type, p, 'calving_event_id'),
        sex: enumOf(type, p, 'sex', SEXES),
        outcome: enumOf(type, p, 'outcome', OUTCOMES),
      };
      return out as PayloadFor<T>;
    }
    case 'acquired': {
      rejectUnknownKeys(type, p, [
        'from',
        'estimated_birth_on',
        'estimated_birth_precision',
        'notes',
      ]);
      const on = optDate(type, p, 'estimated_birth_on');
      const prec = optEnumOf(type, p, 'estimated_birth_precision', DATE_PRECISIONS);
      // Precision is never defaulted, including here. An acquired animal's
      // birth date is exactly the case where 'day' would be invented.
      if (on !== null && prec === null) {
        fail(
          'precision_not_defaulted',
          `${type}: estimated_birth_on was given without estimated_birth_precision. ` +
            `Precision is never defaulted -- state 'year' or 'estimated' rather than ` +
            `letting a guess read as a known date.`,
        );
      }
      if (on === null && prec !== null) {
        fail(
          'invalid_payload',
          `${type}: estimated_birth_precision was given without estimated_birth_on`,
          'estimated_birth_on',
        );
      }
      const out: AcquiredPayload = {
        from: optStr(type, p, 'from'),
        estimated_birth_on: on,
        estimated_birth_precision: prec,
        notes: optStr(type, p, 'notes'),
      };
      return out as PayloadFor<T>;
    }
    case 'calving': {
      rejectUnknownKeys(type, p, [
        'calf_id',
        'calf_sex',
        'outcome',
        'assistance',
        'notes',
        'override',
      ]);
      const out: CalvingPayload = {
        calf_id: str(type, p, 'calf_id'),
        calf_sex: enumOf(type, p, 'calf_sex', SEXES),
        outcome: enumOf(type, p, 'outcome', OUTCOMES),
        assistance: optEnumOf(type, p, 'assistance', ASSISTANCE),
        notes: optStr(type, p, 'notes'),
        override: optOverride(type, p),
      };
      return out as PayloadFor<T>;
    }
    case 'dry_off': {
      rejectUnknownKeys(type, p, ['reason', 'notes', 'override']);
      const out: DryOffPayload = {
        reason: optEnumOf(type, p, 'reason', DRY_OFF_REASONS),
        notes: optStr(type, p, 'notes'),
        override: optOverride(type, p),
      };
      return out as PayloadFor<T>;
    }
    case 'departure': {
      rejectUnknownKeys(type, p, ['reason', 'to', 'cause', 'notes', 'override']);
      const out: DeparturePayload = {
        reason: enumOf(type, p, 'reason', DEPARTURE_REASONS),
        to: optStr(type, p, 'to'),
        cause: optStr(type, p, 'cause'),
        notes: optStr(type, p, 'notes'),
        override: optOverride(type, p),
      };
      return out as PayloadFor<T>;
    }
    case 'note': {
      rejectUnknownKeys(type, p, ['text']);
      const out: NotePayload = { text: str(type, p, 'text') };
      return out as PayloadFor<T>;
    }
    default: {
      // Exhaustiveness: adding a live type without a case here fails to compile.
      const never: never = type;
      return fail('invalid_payload', `unhandled event type '${String(never)}'`, 'type');
    }
  }
}

/**
 * Date/precision consistency, checked at the write boundary as well as by
 * invariants 11 and 12 and by the schema CHECKs. Three layers is deliberate:
 * the CHECK catches it in any process, this catches it with a readable message,
 * and the invariant catches historical rows written before a rule existed.
 */
export function assertDatePrecision(opts: {
  occurred_on: string;
  occurred_time?: string | null;
  date_precision: DatePrecision;
}): void {
  const { occurred_on, date_precision } = opts;
  const occurred_time = opts.occurred_time ?? null;

  if (!DATE_RE.test(occurred_on)) {
    fail('invalid_payload', `occurred_on must be YYYY-MM-DD, got '${occurred_on}'`, 'occurred_on');
  }
  if (!(DATE_PRECISIONS as readonly string[]).includes(date_precision)) {
    fail(
      'invalid_precision',
      `date_precision must be one of ${DATE_PRECISIONS.join(' | ')}, got '${date_precision}'`,
      'date_precision',
    );
  }
  if (occurred_time !== null && date_precision !== 'day') {
    fail(
      'invalid_precision',
      `occurred_time '${occurred_time}' given at ${date_precision} precision. There is no ` +
        `such thing as knowing the hour but not the day.`,
      'occurred_time',
    );
  }
  if (occurred_time !== null && !/^[0-2]\d:[0-5]\d$/.test(occurred_time)) {
    fail('invalid_payload', `occurred_time must be HH:MM, got '${occurred_time}'`, 'occurred_time');
  }
  if (date_precision === 'month' && !occurred_on.endsWith('-01')) {
    fail(
      'invalid_precision',
      `month precision must be stored as the 1st of the month, got '${occurred_on}'. ` +
        `A month row dated mid-month means a known date was silently downgraded.`,
      'occurred_on',
    );
  }
  if (date_precision === 'year' && !occurred_on.endsWith('-01-01')) {
    fail('invalid_precision', `year precision must be stored as January 1, got '${occurred_on}'`, 'occurred_on');
  }
  if (date_precision === 'estimated' && !occurred_on.endsWith('-01-01')) {
    fail(
      'invalid_precision',
      `estimated precision must be stored as January 1, got '${occurred_on}'. ` +
        `A specific day at estimated precision is a fabricated day wearing a humility ` +
        `label -- if the day is actually known, the precision is not 'estimated'.`,
      'occurred_on',
    );
  }
}
