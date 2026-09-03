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
import type {
  AcquiredPayload,
  BirthPayload,
  CalvingPayload,
  DatePrecision,
  DeparturePayload,
  DryOffPayload,
  NotePayload,
  PayloadFor,
  RegistryEventType,
} from './types';
import {
  DATE_PRECISIONS,
  LIVE_EVENT_TYPES,
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
 * is derived from a calving event id (below) and step 4's yield rows will carry
 * it as a foreign key. A collision would silently point yield at the wrong
 * lactation -- the exact failure the id-stability decision exists to prevent,
 * reintroduced through the id format instead of the numbering scheme.
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
 * which will happen -- and any yield row pointing at the old id would then
 * point at the wrong lactation, silently. The display sequence number ("3rd
 * lactation") is computed at read time, where being wrong is visible and
 * harmless.
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

export class EventPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventPayloadError';
  }
}

const fail = (msg: string): never => {
  throw new EventPayloadError(msg);
};

type Rec = Record<string, unknown>;

function requireObject(type: string, payload: unknown): Rec {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    fail(`${type}: payload must be an object, got ${describe(payload)}`);
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
      `${type}: unknown payload key(s) ${unknown.map((k) => `'${k}'`).join(', ')}; ` +
        `allowed: ${allowed.join(', ')}`,
    );
  }
}

function str(type: string, p: Rec, key: string): string {
  const v = p[key];
  if (typeof v !== 'string' || v.length === 0) {
    fail(`${type}.${key}: required non-empty string, got ${describe(v)}`);
  }
  return v as string;
}

function optStr(type: string, p: Rec, key: string): string | null {
  const v = p[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') {
    fail(`${type}.${key}: must be a string when present, got ${describe(v)}`);
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
      `${type}.${key}: must be one of ${allowed.join(' | ')}, got ${JSON.stringify(v)}`,
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

function optDate(type: string, p: Rec, key: string): string | null {
  const v = optStr(type, p, key);
  if (v === null) return null;
  if (!DATE_RE.test(v)) {
    fail(`${type}.${key}: must be YYYY-MM-DD, got '${v}'`);
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
      `'${type}' is a RESERVED event type: named in the taxonomy but not implemented ` +
        `in this cycle. Reserved types are rejected here rather than accepted with a ` +
        `loose payload, so the derivation rules for them are written once, deliberately.`,
    );
  }
  if (!(LIVE_EVENT_TYPES as readonly string[]).includes(type)) {
    fail(
      `'${type}' is not a registry event type; expected one of ${LIVE_EVENT_TYPES.join(' | ')}`,
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
          `${type}: estimated_birth_on was given without estimated_birth_precision. ` +
            `Precision is never defaulted -- state 'year' or 'estimated' rather than ` +
            `letting a guess read as a known date.`,
        );
      }
      if (on === null && prec !== null) {
        fail(`${type}: estimated_birth_precision was given without estimated_birth_on`);
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
      ]);
      const out: CalvingPayload = {
        calf_id: str(type, p, 'calf_id'),
        calf_sex: enumOf(type, p, 'calf_sex', SEXES),
        outcome: enumOf(type, p, 'outcome', OUTCOMES),
        assistance: optEnumOf(type, p, 'assistance', ASSISTANCE),
        notes: optStr(type, p, 'notes'),
      };
      return out as PayloadFor<T>;
    }
    case 'dry_off': {
      rejectUnknownKeys(type, p, ['reason', 'notes']);
      const out: DryOffPayload = {
        reason: optEnumOf(type, p, 'reason', DRY_OFF_REASONS),
        notes: optStr(type, p, 'notes'),
      };
      return out as PayloadFor<T>;
    }
    case 'departure': {
      rejectUnknownKeys(type, p, ['reason', 'to', 'cause', 'notes']);
      const out: DeparturePayload = {
        reason: enumOf(type, p, 'reason', DEPARTURE_REASONS),
        to: optStr(type, p, 'to'),
        cause: optStr(type, p, 'cause'),
        notes: optStr(type, p, 'notes'),
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
      return fail(`unhandled event type '${String(never)}'`);
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
    fail(`occurred_on must be YYYY-MM-DD, got '${occurred_on}'`);
  }
  if (!(DATE_PRECISIONS as readonly string[]).includes(date_precision)) {
    fail(
      `date_precision must be one of ${DATE_PRECISIONS.join(' | ')}, got '${date_precision}'`,
    );
  }
  if (occurred_time !== null && date_precision !== 'day') {
    fail(
      `occurred_time '${occurred_time}' given at ${date_precision} precision. There is no ` +
        `such thing as knowing the hour but not the day.`,
    );
  }
  if (occurred_time !== null && !/^[0-2]\d:[0-5]\d$/.test(occurred_time)) {
    fail(`occurred_time must be HH:MM, got '${occurred_time}'`);
  }
  if (date_precision === 'month' && !occurred_on.endsWith('-01')) {
    fail(
      `month precision must be stored as the 1st of the month, got '${occurred_on}'. ` +
        `A month row dated mid-month means a known date was silently downgraded.`,
    );
  }
  if (date_precision === 'year' && !occurred_on.endsWith('-01-01')) {
    fail(`year precision must be stored as January 1, got '${occurred_on}'`);
  }
}
