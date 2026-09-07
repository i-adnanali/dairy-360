// Animal registry -- people and engagements (docs/REGISTRY_PAYROLL.md §4.1, §4.2).
//
// Who works here, and for which stretches. payroll.ts (packages, the run) and
// wages.ts (the ledger) both read from here.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT CALLED employees.ts
// ---------------------------------------------------------------------------
// Because `observed_by` -- the column registry_people finally gives a referent
// -- also holds the vet, the AI technician, and whoever sold the farm a
// buffalo. Most rows here are employees; not all of them are, and the ones that
// are not are exactly the rows a narrower name would discourage anyone from
// adding. Employment is what an ENGAGEMENT says. A person with no engagement is
// a legitimate row.
//
// ---------------------------------------------------------------------------
// A PERSON IS AMENDABLE IN PLACE -- EXCEPT FOR THE ONE COLUMN THAT IS NOT
// ---------------------------------------------------------------------------
// A corrected phone number or display name is an ordinary UPDATE. `identifier`
// is not, and refusing it is the whole reason this module has a write boundary
// at all: the link to history is BY VALUE, so changing the value silently
// orphans every `observed_by` that matched it. A person whose identifier was
// typed wrong is corrected by adding the right one and closing the wrong one.
//
// ---------------------------------------------------------------------------
// ENGAGEMENTS ARE DELIBERATELY LOOSE
// ---------------------------------------------------------------------------
// They may overlap, more than one may be open, and gaps between them are the
// point. The farm asked for this: people leave and come back, and somebody can
// be milker and night watchman at once. Overlap and multiple open engagements
// are /check REPORT LINES, never refusals -- and invariant 8's
// one-open-lactation rule is deliberately not copied, because an animal can
// only be lactating once and a person can hold two jobs.
//
// What stays strict is elsewhere: a wage period must NAME its engagement
// (payroll.ts), which is what stops a returning worker inheriting their
// pre-departure salary.

import { randomUUID } from 'node:crypto';

import { RegistryError } from './errors';
import type { Db } from './schema';
import type { EngagementKind, EngagementRow, PersonRow } from './types';
import { ENGAGEMENT_KINDS } from './types';

export const PERSON_ID_PREFIX = 'per_';
export const ENGAGEMENT_ID_PREFIX = 'eng_';

/** Full uuids, for the reason newEventId() gives: 8 hex is not enough. */
export function newPersonId(): string {
  return `${PERSON_ID_PREFIX}${randomUUID()}`;
}

export function newEngagementId(): string {
  return `${ENGAGEMENT_ID_PREFIX}${randomUUID()}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function refuse(
  code: ConstructorParameters<typeof RegistryError>[0],
  msg: string,
  field?: string,
): never {
  throw new RegistryError(code, msg, field);
}

function blank(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function assertDate(value: string, field: string): string {
  if (!DATE_RE.test(value)) {
    refuse('invalid_payload', `${field} must be YYYY-MM-DD, got '${value}'`, field);
  }
  return value;
}

// ---------------------------------------------------------------------------
// PURE -- membership
// ---------------------------------------------------------------------------

/**
 * Was this engagement running on `on`?
 *
 * A RANGE TEST, not a status flag, and that is what lets the payroll run open
 * last March and show who was employed THEN. The same argument activeOn() makes
 * for destinations and milkingRoster() makes for lactations.
 *
 * `ended_on` is INCLUSIVE: the day somebody left is a day they worked.
 */
export function engagedOn(e: EngagementRow, on: string): boolean {
  if (e.started_on > on) return false;
  return e.ended_on === null || on <= e.ended_on;
}

/**
 * Did this engagement overlap the range at all? Used by the run, which asks for
 * a month rather than a day.
 *
 * Inclusive at both ends, for the same reason engagedOn() is: somebody who left
 * on the 3rd worked three days of that month and is owed for them.
 */
export function engagedDuring(e: EngagementRow, from: string, to: string): boolean {
  if (e.started_on > to) return false;
  return e.ended_on === null || e.ended_on >= from;
}

// ---------------------------------------------------------------------------
// DB shell -- reads
// ---------------------------------------------------------------------------

export function allPeopleRows(db: Db): PersonRow[] {
  return db
    .prepare(`SELECT * FROM registry_people ORDER BY identifier, id`)
    .all() as PersonRow[];
}

export function getPerson(db: Db, id: string): PersonRow | null {
  return (db.prepare(`SELECT * FROM registry_people WHERE id = ?`).get(id) as PersonRow) ?? null;
}

/**
 * Find a person by the string that appears in `observed_by`.
 *
 * CASE-INSENSITIVE, matching the column's COLLATE NOCASE, so a lookup for
 * `Imran` finds the row stored as `imran`. This is the function that makes
 * "everything Imran milked" answerable, and getting the collation wrong here
 * would make it silently return nothing for half the spellings in history.
 */
export function findPersonByIdentifier(db: Db, identifier: string): PersonRow | null {
  const t = identifier.trim();
  if (t.length === 0) return null;
  return (
    (db
      .prepare(`SELECT * FROM registry_people WHERE identifier = ? COLLATE NOCASE`)
      .get(t) as PersonRow) ?? null
  );
}

export function getEngagement(db: Db, id: string): EngagementRow | null {
  return (
    (db.prepare(`SELECT * FROM registry_engagements WHERE id = ?`).get(id) as EngagementRow) ??
    null
  );
}

export function engagementsFor(db: Db, personId: string): EngagementRow[] {
  return db
    .prepare(`SELECT * FROM registry_engagements WHERE person_id = ? ORDER BY started_on, id`)
    .all(personId) as EngagementRow[];
}

/**
 * Every engagement running on a date, newest stint first.
 *
 * Returns a LIST rather than one row, because a person may hold more than one
 * and the loose model means that is legitimate. Callers that need to pick one
 * must make the operator pick -- see payroll.ts.
 */
export function engagementsOn(db: Db, on: string): EngagementRow[] {
  return (
    db.prepare(`SELECT * FROM registry_engagements ORDER BY started_on DESC, id`).all() as
      EngagementRow[]
  ).filter((e) => engagedOn(e, on));
}

// ---------------------------------------------------------------------------
// DB shell -- writes
// ---------------------------------------------------------------------------

export interface AddPersonInput {
  identifier: string;
  name?: string | null;
  contact?: string | null;
  note?: string | null;
  recorded_by: string;
  id?: string;
  recorded_at?: string;
}

/**
 * Add a person.
 *
 * `identifier` is the stable string that also goes in `observed_by`. It is
 * required, non-blank, and unique CASE-INSENSITIVELY -- the whole reason this
 * table exists is that free text produced `abdul`, `Abdul` and `abdul_r` as
 * three people, and history still holds all three.
 *
 * The duplicate check is done HERE as well as by the unique index, so the
 * operator gets a sentence naming the person who already holds it rather than a
 * raw SQLITE_CONSTRAINT. `name` is optional and is NOT defaulted to the
 * identifier: a display name that is silently a machine identifier is worse
 * than a blank one, because it looks deliberate.
 */
export function addPerson(db: Db, input: AddPersonInput): PersonRow {
  const identifier = blank(input.identifier);
  if (identifier === null) {
    refuse(
      'invalid_payload',
      'a person needs a stable identifier -- the same short name that goes in ' +
        '"observed by", not a display name',
      'identifier',
    );
  }

  const existing = findPersonByIdentifier(db, identifier);
  if (existing) {
    refuse(
      'duplicate_identifier',
      `'${existing.identifier}' is already ${existing.name ?? 'somebody'}. Identifiers are ` +
        `matched without regard to case, so '${identifier}' and '${existing.identifier}' ` +
        `would be the same person.`,
      'identifier',
    );
  }

  const row: PersonRow = {
    id: input.id ?? newPersonId(),
    identifier,
    name: blank(input.name),
    contact: blank(input.contact),
    note: blank(input.note),
    recorded_by: input.recorded_by,
    recorded_at: input.recorded_at ?? new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO registry_people (id, identifier, name, contact, note, recorded_by, recorded_at)
     VALUES (@id, @identifier, @name, @contact, @note, @recorded_by, @recorded_at)`,
  ).run(row);

  return row;
}

export interface UpdatePersonInput {
  name?: string | null;
  contact?: string | null;
  note?: string | null;
  /** Present only so it can be REFUSED with an explanation. See below. */
  identifier?: string;
}

/**
 * Amend a person in place.
 *
 * `identifier` IS REFUSED, and it is accepted as an input purely so the refusal
 * can be a sentence rather than a silently ignored field. The link to history
 * is by value: every `observed_by`, `recorded_by`, `acquired_from` and
 * `sire_ref` that matches this string is matched by STRING, and the event log
 * is append-only so none of them can be repointed. Changing it here would leave
 * the rows behind, pointing at a name nobody holds.
 *
 * Passing the SAME identifier is not an edit and is allowed, so a form that
 * round-trips every field does not have to special-case it.
 */
export function updatePerson(db: Db, id: string, input: UpdatePersonInput): PersonRow {
  const current = getPerson(db, id);
  if (!current) refuse('unknown_person', `unknown person '${id}'`, 'id');

  const wanted = blank(input.identifier);
  if (wanted !== null && wanted.toLowerCase() !== current.identifier.toLowerCase()) {
    refuse(
      'identifier_is_immutable',
      `'${current.identifier}' cannot be renamed to '${wanted}'. Every milking, event and ` +
        `dispatch that names them stores the identifier as text, and the event log cannot ` +
        `be rewritten -- renaming here would leave all of it pointing at a name nobody ` +
        `holds. Add '${wanted}' as a person and close this one instead.`,
      'identifier',
    );
  }

  const next: PersonRow = {
    ...current,
    name: input.name === undefined ? current.name : blank(input.name),
    contact: input.contact === undefined ? current.contact : blank(input.contact),
    note: input.note === undefined ? current.note : blank(input.note),
  };

  db.prepare(
    `UPDATE registry_people SET name = @name, contact = @contact, note = @note WHERE id = @id`,
  ).run(next);

  return next;
}

export interface AddEngagementInput {
  person_id: string;
  kind: EngagementKind;
  role?: string | null;
  started_on: string;
  ended_on?: string | null;
  end_reason?: string | null;
  note?: string | null;
  recorded_by: string;
  id?: string;
  recorded_at?: string;
}

/**
 * Open a stint.
 *
 * NOTHING IS REFUSED FOR OVERLAPPING an existing engagement, and that is the
 * farm's explicit instruction rather than an oversight. A returning worker gets
 * a second engagement; somebody holding two roles gets two open ones. Both are
 * /check report lines so they are visible, and neither is an error.
 *
 * `kind` is required and not defaulted. It decides whether the monthly run
 * demands an answer about this person -- a question about how the farm works,
 * and getting it wrong in the permissive direction silently stops the run
 * asking. The same argument `standing` makes for destinations.
 */
export function addEngagement(db: Db, input: AddEngagementInput): EngagementRow {
  const person = getPerson(db, input.person_id);
  if (!person) refuse('unknown_person', `unknown person '${input.person_id}'`, 'person_id');

  if (!(ENGAGEMENT_KINDS as readonly string[]).includes(input.kind)) {
    refuse(
      'invalid_payload',
      `kind must be one of ${ENGAGEMENT_KINDS.join(' | ')}, got ${JSON.stringify(input.kind)}`,
      'kind',
    );
  }

  assertDate(input.started_on, 'started_on');
  const endedOn = blank(input.ended_on);
  if (endedOn !== null) {
    assertDate(endedOn, 'ended_on');
    if (endedOn < input.started_on) {
      refuse(
        'invalid_payload',
        `ended_on ${endedOn} is before started_on ${input.started_on}`,
        'ended_on',
      );
    }
  }

  const endReason = blank(input.end_reason);
  if (endReason !== null && endedOn === null) {
    refuse(
      'invalid_payload',
      'an engagement that has not ended cannot say why it ended',
      'end_reason',
    );
  }

  const row: EngagementRow = {
    id: input.id ?? newEngagementId(),
    person_id: input.person_id,
    kind: input.kind,
    role: blank(input.role),
    started_on: input.started_on,
    ended_on: endedOn,
    end_reason: endReason,
    note: blank(input.note),
    recorded_by: input.recorded_by,
    recorded_at: input.recorded_at ?? new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO registry_engagements
       (id, person_id, kind, role, started_on, ended_on, end_reason, note,
        recorded_by, recorded_at)
     VALUES
       (@id, @person_id, @kind, @role, @started_on, @ended_on, @end_reason, @note,
        @recorded_by, @recorded_at)`,
  ).run(row);

  return row;
}

export interface UpdateEngagementInput {
  role?: string | null;
  ended_on?: string | null;
  end_reason?: string | null;
  note?: string | null;
}

/**
 * Amend a stint in place -- typically to close it.
 *
 * `kind`, `person_id` and `started_on` are NOT amendable. Changing any of them
 * would silently move every wage period the engagement holds onto a different
 * agreement or a different person, and the repair is a new engagement rather
 * than an edit to this one.
 *
 * Closing an engagement does NOT refuse wage periods that fall after the end
 * date -- a final settlement paid two weeks later is real. That is a /check
 * report line, the same call invariant 20 makes for dispatches outside a
 * destination's range.
 */
export function updateEngagement(
  db: Db,
  id: string,
  input: UpdateEngagementInput,
): EngagementRow {
  const current = getEngagement(db, id);
  if (!current) refuse('unknown_engagement', `unknown engagement '${id}'`, 'id');

  const endedOn = input.ended_on === undefined ? current.ended_on : blank(input.ended_on);
  if (endedOn !== null) {
    assertDate(endedOn, 'ended_on');
    if (endedOn < current.started_on) {
      refuse(
        'invalid_payload',
        `ended_on ${endedOn} is before the engagement started on ${current.started_on}`,
        'ended_on',
      );
    }
  }

  const endReason =
    input.end_reason === undefined ? current.end_reason : blank(input.end_reason);
  if (endReason !== null && endedOn === null) {
    refuse(
      'invalid_payload',
      'an engagement that has not ended cannot say why it ended',
      'end_reason',
    );
  }

  const next: EngagementRow = {
    ...current,
    role: input.role === undefined ? current.role : blank(input.role),
    ended_on: endedOn,
    end_reason: endReason,
    note: input.note === undefined ? current.note : blank(input.note),
  };

  db.prepare(
    `UPDATE registry_engagements
        SET role = @role, ended_on = @ended_on, end_reason = @end_reason, note = @note
      WHERE id = @id`,
  ).run(next);

  return next;
}
