// Animal registry -- destinations and their price agreements
// (docs/REGISTRY_SALES.md §4.1, §4.1a, §4.2).
//
// Who milk goes to, and what it costs when it goes there. The daily sheet
// (dispatch.ts) and the ledger (ledger.ts) both read from here.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT CALLED buyers.ts
// ---------------------------------------------------------------------------
// Because home is one of these rows. The thing being modelled is where milk
// GOES; selling is the dominant disposition, not the only one. The demo tables
// made the opposite choice -- `vendors` holds rows that buy from the farm -- and
// a name that is nearly right survives a long time before anyone pays to fix
// it. The UI still says "buyers" for the billable ones, which is honest,
// because that is what they are.
//
// ---------------------------------------------------------------------------
// A DESTINATION IS AMENDABLE IN PLACE; A PRICE IS NOT
// ---------------------------------------------------------------------------
// A corrected phone number or a closing date is an ordinary UPDATE: a
// destination row is identity plus a range, and nothing is derived from it but
// the sheet's membership.
//
// A price change is a NEW ROW, never an UPDATE, because money depends on which
// rate was in force when. The one thing that IS correctable in place is a price
// typed wrong and caught immediately -- and that is safe only because every
// dispatch captures its own figure, so correcting the agreement changes the
// default offered to future entry and rewrites no history.

import { randomUUID } from 'node:crypto';

import { RegistryError } from './errors';
import type { Db } from './schema';
import type {
  DestinationKind,
  DestinationPriceRow,
  DestinationRow,
  Provenance,
} from './types';
import { DESTINATION_KINDS } from './types';

export const DESTINATION_ID_PREFIX = 'dst_';
export const PRICE_ID_PREFIX = 'prc_';

/** Full uuids, for the reason newEventId() gives: 8 hex is not enough. */
export function newDestinationId(): string {
  return `${DESTINATION_ID_PREFIX}${randomUUID()}`;
}

export function newPriceId(): string {
  return `${PRICE_ID_PREFIX}${randomUUID()}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function refuse(code: ConstructorParameters<typeof RegistryError>[0], msg: string, field?: string): never {
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
// PURE -- membership and the price in force
// ---------------------------------------------------------------------------

/**
 * Was this destination taking milk on `on`?
 *
 * A RANGE TEST, not a status flag, and that is what lets the sheet open last
 * Tuesday and show who was buying THEN. The same argument milkingRoster() makes
 * for deriving the roster from lactation rows rather than from the as-of-now
 * status projection.
 *
 * `ended_on` is INCLUSIVE: the day a buyer stopped is a day he may well have
 * taken a last delivery, and excluding it would refuse a legitimate entry.
 */
export function activeOn(d: DestinationRow, on: string): boolean {
  if (d.started_on > on) return false;
  return d.ended_on === null || on <= d.ended_on;
}

/**
 * The price agreement in force on `on` -- the latest row at or before it.
 *
 * Returns null when there is none, which is a real and expected state: a
 * destination created today has no price until one is set, and a dispatch dated
 * before the first agreement has no rate to inherit. Both are refusals at the
 * write boundary rather than a silently assumed zero, because a free sale is a
 * fact somebody would have to have decided.
 *
 * PURE, and takes the whole list rather than querying, so the same function
 * serves the write boundary, the read models and invariant 21.
 */
export function priceInForce(
  prices: readonly DestinationPriceRow[],
  on: string,
): DestinationPriceRow | null {
  let best: DestinationPriceRow | null = null;
  for (const p of prices) {
    if (p.effective_from > on) continue;
    if (best === null || p.effective_from > best.effective_from) best = p;
  }
  return best;
}

// ---------------------------------------------------------------------------
// DB shell -- reads
// ---------------------------------------------------------------------------

interface DestinationRowRaw extends Omit<DestinationRow, 'billable' | 'standing'> {
  billable: number;
  standing: number;
}

/** 0/1 out of SQLite becomes a boolean at the boundary, and only here. */
function toDestination(r: DestinationRowRaw): DestinationRow {
  return { ...r, billable: r.billable === 1, standing: r.standing === 1 };
}

export function allDestinations(db: Db): DestinationRow[] {
  return (
    db
      .prepare(`SELECT * FROM registry_destinations ORDER BY name, id`)
      .all() as DestinationRowRaw[]
  ).map(toDestination);
}

export function getDestination(db: Db, id: string): DestinationRow | null {
  const r = db.prepare(`SELECT * FROM registry_destinations WHERE id = ?`).get(id) as
    | DestinationRowRaw
    | undefined;
  return r ? toDestination(r) : null;
}

export function allPrices(db: Db): DestinationPriceRow[] {
  return db
    .prepare(`SELECT * FROM registry_destination_prices ORDER BY destination_id, effective_from`)
    .all() as DestinationPriceRow[];
}

export function pricesFor(db: Db, destinationId: string): DestinationPriceRow[] {
  return db
    .prepare(
      `SELECT * FROM registry_destination_prices
        WHERE destination_id = ? ORDER BY effective_from`,
    )
    .all(destinationId) as DestinationPriceRow[];
}

// ---------------------------------------------------------------------------
// DB shell -- writes
// ---------------------------------------------------------------------------

export interface AddDestinationInput {
  name: string;
  kind: DestinationKind;
  /** Defaulted from `kind` only for `home`, where the schema forbids anything else. */
  billable?: boolean;
  standing: boolean;
  contact?: string | null;
  started_on: string;
  ended_on?: string | null;
  note?: string | null;
  recorded_by: string;
  /**
   * REQUIRED for `staff` and forbidden for every other kind -- the schema holds
   * the two in a biconditional. See REGISTRY_PAYROLL.md §4.6a.
   */
  person_id?: string | null;
  id?: string;
  recorded_at?: string;
}

/**
 * Add a destination.
 *
 * `billable` is REQUIRED for every kind except `home`, where it can only be
 * false. It is not derived from `kind` for the reason the schema comment gives:
 * a shop that takes milk as part of a barter is a real possibility, and a
 * derived flag would have to be un-derived the first time one appears.
 *
 * `standing` is required and NOT defaulted. It decides whether the daily sheet
 * demands an answer about this destination in every session, which is a
 * question about how the farm works rather than a fact about the buyer -- and
 * getting it wrong in the permissive direction silently stops the sheet asking.
 */
export function addDestination(db: Db, input: AddDestinationInput): DestinationRow {
  const name = blank(input.name);
  if (name === null) refuse('invalid_payload', 'a destination needs a name', 'name');

  if (!(DESTINATION_KINDS as readonly string[]).includes(input.kind)) {
    refuse(
      'invalid_payload',
      `kind must be one of ${DESTINATION_KINDS.join(' | ')}, got ${JSON.stringify(input.kind)}`,
      'kind',
    );
  }

  const billable =
    input.kind === 'home' || input.kind === 'staff' ? false : (input.billable ?? true);
  if (input.kind === 'home' && input.billable === true) {
    refuse(
      'invalid_payload',
      'home milk is never billed -- it is milk the farm kept, not milk it sold',
      'billable',
    );
  }

  // A staff destination names a person, and a destination naming a person is
  // staff milk. The schema holds this as a biconditional CHECK; refusing it here
  // too is the same three-layer habit as the date conventions, and it is what
  // turns a raw constraint error into a sentence the operator can act on.
  const personId = blank(input.person_id);
  if (input.kind === 'staff' && personId === null) {
    refuse(
      'invalid_payload',
      'staff milk is recorded one destination per person, so this needs the person it ' +
        'belongs to. A single shared staff row cannot say whose milk it was.',
      'person_id',
    );
  }
  if (input.kind !== 'staff' && personId !== null) {
    refuse(
      'invalid_payload',
      `only a 'staff' destination names a person, and this one is '${input.kind}'`,
      'person_id',
    );
  }
  // Milk that is part of somebody's pay must never reach a balance. Making it
  // billable would give one person two balances -- a buyer balance and a wage
  // balance -- settled separately, when the farm nets it against pay.
  if (input.kind === 'staff' && input.billable === true) {
    refuse(
      'invalid_payload',
      'milk allocated as part of pay is never billed. If more was taken than the ' +
        'allowance, record it as an adjustment on the wage ledger, not as a sale.',
      'billable',
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

  const row: DestinationRow = {
    id: input.id ?? newDestinationId(),
    name,
    kind: input.kind,
    billable,
    standing: input.standing,
    contact: blank(input.contact),
    started_on: input.started_on,
    ended_on: endedOn,
    note: blank(input.note),
    recorded_by: input.recorded_by,
    recorded_at: input.recorded_at ?? new Date().toISOString(),
    person_id: personId,
  };

  db.prepare(
    `INSERT INTO registry_destinations
       (id, name, kind, billable, standing, contact, started_on, ended_on, note,
        recorded_by, recorded_at, person_id)
     VALUES
       (@id, @name, @kind, @billable, @standing, @contact, @started_on, @ended_on, @note,
        @recorded_by, @recorded_at, @person_id)`,
  ).run({ ...row, billable: row.billable ? 1 : 0, standing: row.standing ? 1 : 0 });

  return row;
}

export interface UpdateDestinationInput {
  name?: string;
  standing?: boolean;
  contact?: string | null;
  ended_on?: string | null;
  note?: string | null;
  recorded_by: string;
}

/**
 * Amend a destination in place.
 *
 * `kind`, `billable` and `started_on` are NOT amendable, and the omission is
 * deliberate. Every dispatch already written was priced and rostered under the
 * flags as they stood, so flipping `billable` would retroactively change what a
 * past row meant, and moving `started_on` forward would put existing rows
 * outside the range invariant 20 checks. A destination that was set up wrongly
 * is closed and a new one opened -- which is also what actually happened, if
 * the milk was going somewhere else.
 *
 * `standing` IS amendable, because it is the one flag that legitimately moves:
 * a household that starts coming daily in the flush becomes standing and goes
 * back afterwards.
 */
export function updateDestination(
  db: Db,
  id: string,
  patch: UpdateDestinationInput,
): DestinationRow {
  const existing = getDestination(db, id);
  if (!existing) refuse('unknown_destination', `unknown destination '${id}'`, 'destination_id');

  const name = patch.name === undefined ? existing.name : blank(patch.name);
  if (name === null) refuse('invalid_payload', 'a destination needs a name', 'name');

  const endedOn = patch.ended_on === undefined ? existing.ended_on : blank(patch.ended_on);
  if (endedOn !== null) {
    assertDate(endedOn, 'ended_on');
    if (endedOn < existing.started_on) {
      refuse(
        'invalid_payload',
        `ended_on ${endedOn} is before started_on ${existing.started_on}`,
        'ended_on',
      );
    }
  }

  const row: DestinationRow = {
    ...existing,
    name,
    standing: patch.standing ?? existing.standing,
    contact: patch.contact === undefined ? existing.contact : blank(patch.contact),
    ended_on: endedOn,
    note: patch.note === undefined ? existing.note : blank(patch.note),
    recorded_by: patch.recorded_by,
    recorded_at: new Date().toISOString(),
  };

  db.prepare(
    `UPDATE registry_destinations
        SET name = @name, standing = @standing, contact = @contact, ended_on = @ended_on,
            note = @note, recorded_by = @recorded_by, recorded_at = @recorded_at
      WHERE id = @id`,
  ).run({ ...row, billable: row.billable ? 1 : 0, standing: row.standing ? 1 : 0 });

  return row;
}

export interface SetPriceInput {
  destination_id: string;
  effective_from: string;
  /** Paisa. The amount as quoted -- see money.ts. */
  price_minor: number;
  /** The lot the amount covers. 40 for "Rs 7,000 per 40 litres". NEVER defaulted. */
  price_unit_litres: number;
  note?: string | null;
  recorded_by: string;
  id?: string;
  recorded_at?: string;
}

/**
 * Agree a price from a date.
 *
 * A NEW ROW, always. The previous agreement is not touched, because every
 * dispatch priced under it must stay explicable.
 *
 * Re-setting a price for a date that already has one REPLACES it, and that is
 * the correction path §4.2 describes: a rate typed wrong and caught before the
 * next sale. It is safe precisely because dispatches captured their own figure,
 * so this rewrites no history -- only the default offered to future entry. A
 * dispatch already written under the wrong rate has to be corrected on its own
 * row, and /check is what finds it.
 */
export function setPrice(db: Db, input: SetPriceInput): DestinationPriceRow {
  const destination = getDestination(db, input.destination_id);
  if (!destination) {
    refuse(
      'unknown_destination',
      `unknown destination '${input.destination_id}'`,
      'destination_id',
    );
  }
  if (!destination.billable) {
    refuse(
      'not_billable',
      `${destination.name} is not billed, so it has no price. Milk kept for the house is a ` +
        `disposition, not a sale -- pricing it would put it in somebody's balance.`,
      'destination_id',
    );
  }

  assertDate(input.effective_from, 'effective_from');

  if (!Number.isInteger(input.price_minor) || input.price_minor < 0) {
    refuse(
      'invalid_payload',
      `price_minor must be a whole number of paisa, got ${JSON.stringify(input.price_minor)}`,
      'price_minor',
    );
  }
  if (!Number.isFinite(input.price_unit_litres) || input.price_unit_litres <= 0) {
    refuse(
      'invalid_payload',
      `price_unit_litres must be a positive number of litres -- 40 for a rate quoted per 40 ` +
        `litres, 1 for a rate quoted per litre. Got ${JSON.stringify(input.price_unit_litres)}.`,
      'price_unit_litres',
    );
  }

  const row: DestinationPriceRow = {
    id: input.id ?? newPriceId(),
    destination_id: input.destination_id,
    effective_from: input.effective_from,
    price_minor: input.price_minor,
    price_unit_litres: input.price_unit_litres,
    recorded_by: input.recorded_by,
    recorded_at: input.recorded_at ?? new Date().toISOString(),
    note: blank(input.note),
  };

  db.prepare(
    `INSERT INTO registry_destination_prices
       (id, destination_id, effective_from, price_minor, price_unit_litres,
        recorded_by, recorded_at, note)
     VALUES
       (@id, @destination_id, @effective_from, @price_minor, @price_unit_litres,
        @recorded_by, @recorded_at, @note)
     ON CONFLICT (destination_id, effective_from) DO UPDATE SET
        price_minor       = excluded.price_minor,
        price_unit_litres = excluded.price_unit_litres,
        recorded_by       = excluded.recorded_by,
        recorded_at       = excluded.recorded_at,
        note              = excluded.note`,
  ).run(row);

  // The upsert keeps the ORIGINAL row's id when it corrects one, so read it
  // back rather than returning the id we minted and would not have used.
  return db
    .prepare(
      `SELECT * FROM registry_destination_prices
        WHERE destination_id = ? AND effective_from = ?`,
    )
    .get(input.destination_id, input.effective_from) as DestinationPriceRow;
}

// ---------------------------------------------------------------------------
// The read model behind /buyers
// ---------------------------------------------------------------------------

export interface DestinationListRow extends DestinationRow {
  /** The agreement in force on the as-of date, or null. */
  price: DestinationPriceRow | null;
  active: boolean;
}

/**
 * Every destination, with the price in force on `asOf`.
 *
 * Includes closed ones -- a buyer who stopped in June is still the counterparty
 * on every row he took, and hiding him would make his balance unreachable.
 * `active` says which is which so the screen can separate them.
 */
export function destinationList(db: Db, asOf: string): DestinationListRow[] {
  assertDate(asOf, 'as_of');
  const prices = allPrices(db);
  const byDestination = new Map<string, DestinationPriceRow[]>();
  for (const p of prices) {
    const list = byDestination.get(p.destination_id);
    if (list) list.push(p);
    else byDestination.set(p.destination_id, [p]);
  }

  return allDestinations(db).map((d) => ({
    ...d,
    price: d.billable ? priceInForce(byDestination.get(d.id) ?? [], asOf) : null,
    active: activeOn(d, asOf),
  }));
}
