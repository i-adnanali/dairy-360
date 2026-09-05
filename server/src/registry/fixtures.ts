// Animal registry -- test fixtures.
//
// A module of exported builders plus scenario constructors, mirroring the
// Cycle 4 scenario library's shape rather than a root-level fixtures/ directory
// (which would fall outside server/tsconfig.json's rootDir: "src" and silently
// escape `npm run typecheck`).
//
// Every fixture builds an `:memory:` database through the real
// applyRegistrySchema() and the real write path, so a fixture cannot express
// something the production code would reject. The deliberately-corrupt fixtures
// at the bottom are the exception, and they say so.

import Database from 'better-sqlite3';
import type { Db } from './schema';
import { applyRegistrySchema } from './schema';
import { appendEvent, insertAnimal } from './store';
import { recordCalving } from './calving';
import { rebuild } from './projectStore';
import { addDestination, setPrice } from './destinations';
import { saveDispatchSession } from './dispatch';
import { recordPayment } from './ledger';
import { saveMilkingSession } from './milking';
import type { DatePrecision, DestinationKind, Provenance, RegistrySex } from './types';

/** A fresh, migrated, in-memory registry. Writes nothing to disk. */
export function freshDb(): Db {
  const db = new Database(':memory:');
  applyRegistrySchema(db);
  return db;
}

/**
 * Fixed provenance for fixtures. `recall` + a named person, because that is
 * what the real backfill will overwhelmingly be and fixtures should exercise
 * the shape the data actually takes.
 */
export const RECALL: Provenance = {
  source_form: 'recall',
  source_ref: 'fixture',
  observed_by: null,
  recorded_by: 'fixture_operator',
};

export const SHEET: Provenance = {
  source_form: 'daily_herd_sheet',
  source_ref: '2026-01-04',
  observed_by: 'keeper_1',
  recorded_by: 'fixture_operator',
};

/**
 * A fixed recorded_at so fixtures are deterministic.
 *
 * Sequenced by an incrementing counter rather than a constant: recorded_at is
 * the third key in the canonical order, and identical values would leave tie
 * breaking to the id -- a random UUID -- making fixture ordering
 * non-reproducible.
 */
let recordedSeq = 0;
export function nextRecordedAt(): string {
  recordedSeq += 1;
  return `2026-01-01T00:${String(recordedSeq).padStart(2, '0')}:00.000Z`;
}
export function resetRecordedSeq(): void {
  recordedSeq = 0;
}

export const AS_OF = '2026-09-01';

/** Insert an acquired animal with its origin event. The pass-one backfill shape. */
export function addAcquired(
  db: Db,
  opts: {
    id: string;
    sex: RegistrySex;
    name?: string | null;
    acquired_on: string;
    acquired_precision: DatePrecision;
    birth_on?: string | null;
    birth_precision?: DatePrecision | null;
    provenance?: Provenance;
  },
): void {
  insertAnimal(db, {
    id: opts.id,
    name: opts.name ?? null,
    sex: opts.sex,
    species: 'buffalo',
    origin: 'acquired',
  });
  appendEvent(db, {
    animal_id: opts.id,
    type: 'acquired',
    occurred_on: opts.acquired_on,
    date_precision: opts.acquired_precision,
    payload: {
      from: null,
      estimated_birth_on: opts.birth_on ?? null,
      estimated_birth_precision: opts.birth_precision ?? null,
      notes: null,
    },
    provenance: opts.provenance ?? RECALL,
    recorded_at: nextRecordedAt(),
  });
  // Keep the counter ahead of any hand-placed serial, so invariant 10 holds for
  // fixtures that mix manual inserts with recordCalving allocations.
  bumpCounterPast(db, opts.id);
}

/** Keep registry_serial_counter above a manually-chosen serial. */
export function bumpCounterPast(db: Db, serial: string): void {
  const n = Number(serial.replace('BD-', ''));
  if (!Number.isInteger(n)) return;
  db.prepare(
    `UPDATE registry_serial_counter SET next_serial = ? WHERE id = 1 AND next_serial <= ?`,
  ).run(n + 1, n);
}

export function addDryOff(
  db: Db,
  opts: {
    animal_id: string;
    on: string;
    precision: DatePrecision;
    provenance?: Provenance;
  },
): string {
  return appendEvent(db, {
    animal_id: opts.animal_id,
    type: 'dry_off',
    occurred_on: opts.on,
    date_precision: opts.precision,
    payload: { reason: 'scheduled', notes: null },
    provenance: opts.provenance ?? RECALL,
    recorded_at: nextRecordedAt(),
  }).id;
}

export function addDeparture(
  db: Db,
  opts: {
    animal_id: string;
    on: string;
    precision: DatePrecision;
    reason?: 'sold' | 'died' | 'culled' | 'lost';
  },
): string {
  return appendEvent(db, {
    animal_id: opts.animal_id,
    type: 'departure',
    occurred_on: opts.on,
    date_precision: opts.precision,
    payload: { reason: opts.reason ?? 'sold', to: null, cause: null, notes: null },
    provenance: RECALL,
    recorded_at: nextRecordedAt(),
  }).id;
}

export function calve(
  db: Db,
  opts: {
    dam_id: string;
    on: string;
    precision: DatePrecision;
    time?: string | null;
    sex?: RegistrySex;
    outcome?: 'live' | 'stillborn' | 'died_within_24h';
    provenance?: Provenance;
    allow_near_duplicate?: boolean;
  },
) {
  return recordCalving(db, {
    dam_id: opts.dam_id,
    occurred_on: opts.on,
    occurred_time: opts.time ?? null,
    date_precision: opts.precision,
    calf: { sex: opts.sex ?? 'female', outcome: opts.outcome ?? 'live' },
    provenance: opts.provenance ?? RECALL,
    asOf: AS_OF,
    allow_near_duplicate: opts.allow_near_duplicate,
  });
}

// ---------------------------------------------------------------------------
// The clean herd -- every nasty case decision doc §10 names, all valid
// ---------------------------------------------------------------------------

/**
 * A herd exercising, deliberately:
 *
 *   BD-0001  two calvings with a dry_off between -> one closed lactation
 *            ('dry_off') and one open. Day precision, so a MEASURED interval.
 *   BD-0002  two calvings with NO dry_off -> the first closes with
 *            'inferred_at_next_calving'. Month precision, so an APPROXIMATE
 *            interval, and month rows dated to the 1st.
 *   BD-0003  a stillbirth: the calf still exists, still has a birth event, the
 *            lactation still opens, parity still counts.
 *   BD-0004  a departed animal.
 *   BD-0005  an acquired heifer with a year-precision birth date, parity 0.
 *   BD-0006  an acquired animal with NO birth date at all -> falls through to
 *            heifer, the documented consequence of rule 2 not firing.
 *   plus a superseded correction on BD-0002's first calving date.
 */
export function cleanHerd(): Db {
  resetRecordedSeq();
  const db = freshDb();

  addAcquired(db, {
    id: 'BD-0001',
    sex: 'female',
    name: 'Noor',
    acquired_on: '2019-01-01',
    acquired_precision: 'year',
    birth_on: '2018-01-01',
    birth_precision: 'year',
    provenance: SHEET,
  });
  addAcquired(db, {
    id: 'BD-0002',
    sex: 'female',
    acquired_on: '2019-01-01',
    acquired_precision: 'year',
    birth_on: '2017-01-01',
    birth_precision: 'year',
  });
  addAcquired(db, {
    id: 'BD-0003',
    sex: 'female',
    acquired_on: '2020-01-01',
    acquired_precision: 'year',
    birth_on: '2019-01-01',
    birth_precision: 'year',
  });
  addAcquired(db, {
    id: 'BD-0004',
    sex: 'female',
    acquired_on: '2018-01-01',
    acquired_precision: 'year',
    birth_on: '2016-01-01',
    birth_precision: 'year',
  });
  addAcquired(db, {
    id: 'BD-0005',
    sex: 'female',
    acquired_on: '2024-01-01',
    acquired_precision: 'year',
    birth_on: '2023-01-01',
    birth_precision: 'year',
  });
  addAcquired(db, {
    id: 'BD-0006',
    sex: 'male',
    acquired_on: '2024-01-01',
    acquired_precision: 'year',
  });

  // BD-0001: day-precision pair with a dry_off between -> measured interval.
  calve(db, { dam_id: 'BD-0001', on: '2023-03-14', precision: 'day', time: '05:30' });
  addDryOff(db, { animal_id: 'BD-0001', on: '2024-01-10', precision: 'day' });
  calve(db, { dam_id: 'BD-0001', on: '2024-06-02', precision: 'day' });

  // BD-0002: month-precision pair, NO dry_off -> inferred close, approximate.
  calve(db, { dam_id: 'BD-0002', on: '2023-04-01', precision: 'month' });
  calve(db, { dam_id: 'BD-0002', on: '2024-07-01', precision: 'month' });

  // BD-0003: a stillbirth still opens the lactation and counts toward parity.
  calve(db, {
    dam_id: 'BD-0003',
    on: '2025-02-01',
    precision: 'month',
    outcome: 'stillborn',
  });

  // BD-0003 dries off after her stillbirth and does not calve again, so the
  // herd contains an animal whose status is `dry`. Without her, `dry` is the
  // one status of six that no fixture produces -- and the herd table is the
  // view where a missing status is least likely to be noticed.
  addDryOff(db, { animal_id: 'BD-0003', on: '2025-11-01', precision: 'month' });

  // BD-0004 departed.
  addDeparture(db, { animal_id: 'BD-0004', on: '2024-05-01', precision: 'month' });

  // A note, and an estimated-precision origin, so that every event type and
  // every date precision a view branches on appears in the fixture. See
  // "every view-branching enum is represented" in registry.invariants.test.ts:
  // one of six statuses missing meant a sixth of the herd table got built
  // blind, and the same argument applies to every other enum a template
  // switches on.
  appendEvent(db, {
    animal_id: 'BD-0001',
    type: 'note',
    occurred_on: '2026-02-01',
    date_precision: 'day',
    payload: { text: 'limping on the near hind, watch her' },
    provenance: SHEET,
    recorded_at: nextRecordedAt(),
  });
  addAcquired(db, {
    id: 'BD-0013',
    sex: 'female',
    acquired_on: '2022-01-01',
    acquired_precision: 'estimated',
    birth_on: '2020-01-01',
    birth_precision: 'estimated',
  });

  // BD-0005 calves RECENTLY, so the herd contains an animal that is actually a
  // `calf` at AS_OF. Without this the fixture has no age-dependent status at
  // all, and every test about asOf-sensitivity would pass vacuously.
  calve(db, { dam_id: 'BD-0005', on: '2026-06-02', precision: 'day' });

  rebuild(db, { asOf: AS_OF });
  return db;
}

/**
 * The clean herd plus a superseding correction: BD-0001's calving is re-dated
 * by a new event that supersedes it.
 *
 * A CALVING DATE CORRECTION IS A PAIRED CORRECTION. The calving on the dam and
 * the birth on the calf are the same physical fact seen from two animals, so
 * superseding only one of them leaves the two dates divergent -- which
 * invariant 6 catches, and which is the whole reason it checks the pair. This
 * fixture therefore supersedes BOTH, and the corrected birth event re-points at
 * the corrected calving.
 *
 * `correctionOnlyOnDam()` below is the deliberately-broken half, used to prove
 * invariant 6 actually fires on the one-sided case.
 */
export function herdWithCorrection(): {
  db: Db;
  originalId: string;
  correctionId: string;
  calfId: string;
} {
  resetRecordedSeq();
  const db = freshDb();

  addAcquired(db, {
    id: 'BD-0001',
    sex: 'female',
    acquired_on: '2019-01-01',
    acquired_precision: 'year',
    birth_on: '2017-01-01',
    birth_precision: 'year',
  });

  const first = calve(db, { dam_id: 'BD-0001', on: '2023-04-01', precision: 'month' });

  // The correction: same calving, better-remembered date. A NEW event pointing
  // at the one it replaces -- never an UPDATE, which the triggers forbid.
  const correction = appendEvent(db, {
    animal_id: 'BD-0001',
    type: 'calving',
    occurred_on: '2023-05-01',
    date_precision: 'month',
    payload: {
      calf_id: first.calf_id,
      calf_sex: 'female',
      outcome: 'live',
      assistance: null,
      notes: 'date corrected from April on a second recollection',
    },
    provenance: RECALL,
    recorded_at: nextRecordedAt(),
    supersedes_id: first.calving_event_id,
  });

  // The paired half, on the calf.
  appendEvent(db, {
    animal_id: first.calf_id,
    type: 'birth',
    occurred_on: '2023-05-01',
    date_precision: 'month',
    payload: {
      dam_id: 'BD-0001',
      sire_ref: null,
      calving_event_id: correction.id,
      sex: 'female',
      outcome: 'live',
    },
    provenance: RECALL,
    recorded_at: nextRecordedAt(),
    supersedes_id: first.birth_event_id,
  });

  rebuild(db, { asOf: AS_OF });
  return {
    db,
    originalId: first.calving_event_id,
    correctionId: correction.id,
    calfId: first.calf_id,
  };
}

/**
 * A calving date corrected on the DAM ONLY, leaving the calf's birth event on
 * the old date. Deliberately invalid -- the fixture that proves invariant 6
 * catches a half-applied correction.
 */
export function correctionOnlyOnDam(): Db {
  resetRecordedSeq();
  const db = freshDb();

  addAcquired(db, {
    id: 'BD-0001',
    sex: 'female',
    acquired_on: '2019-01-01',
    acquired_precision: 'year',
    birth_on: '2017-01-01',
    birth_precision: 'year',
  });
  const first = calve(db, { dam_id: 'BD-0001', on: '2023-04-01', precision: 'month' });

  appendEvent(db, {
    animal_id: 'BD-0001',
    type: 'calving',
    occurred_on: '2023-05-01',
    date_precision: 'month',
    payload: {
      calf_id: first.calf_id,
      calf_sex: 'female',
      outcome: 'live',
      assistance: null,
      notes: null,
    },
    provenance: RECALL,
    recorded_at: nextRecordedAt(),
    supersedes_id: first.calving_event_id,
  });

  rebuild(db, { asOf: AS_OF });
  return db;
}

// ---------------------------------------------------------------------------
// Milk yield and sales fixtures
// ---------------------------------------------------------------------------

/**
 * FIXTURE DATA IS SYNTHETIC AND MUST STAY THAT WAY.
 *
 * The standing rule for this cycle is that nothing synthetic touches dairy.db,
 * and it cuts both ways: the real buyers belong in the live database, entered
 * by the farm through the screen, and never in a file a test can load. The
 * names below are invented and the shape -- one dodhi, two households, home --
 * is the only thing taken from the real farm.
 */
export const FIXTURE_PRICE_MINOR = 700_000; // Rs 7,000
export const FIXTURE_PRICE_UNIT_LITRES = 40; // ...per 40 litres
export const FIXTURE_HOUSEHOLD_PRICE_MINOR = 900_000; // households pay retail

export interface SalesFixture {
  dodhi: string;
  home: string;
  ali: string;
  bibi: string;
}

/**
 * Three buyers and home, priced from 2026-01-01.
 *
 * Takes a db so it can ride on top of `cleanHerd()` or stand on its own -- the
 * sales half has no foreign key to an animal, which is exactly the property
 * worth having a fixture prove.
 */
export function addSalesDestinations(db: Db): SalesFixture {
  const mk = (name: string, kind: DestinationKind, standing: boolean) =>
    addDestination(db, {
      name,
      kind,
      standing,
      started_on: '2026-01-01',
      recorded_by: 'adnan',
      recorded_at: nextRecordedAt(),
    }).id;

  const f: SalesFixture = {
    dodhi: mk('Bashir (dodhi)', 'dodhi', true),
    home: mk('Home', 'home', true),
    ali: mk('Ali (next door)', 'household', false),
    bibi: mk('Bibi (corner house)', 'household', false),
  };

  setPrice(db, {
    destination_id: f.dodhi,
    effective_from: '2026-01-01',
    price_minor: FIXTURE_PRICE_MINOR,
    price_unit_litres: FIXTURE_PRICE_UNIT_LITRES,
    recorded_by: 'adnan',
    recorded_at: nextRecordedAt(),
  });
  for (const h of [f.ali, f.bibi]) {
    setPrice(db, {
      destination_id: h,
      effective_from: '2026-01-01',
      price_minor: FIXTURE_HOUSEHOLD_PRICE_MINOR,
      price_unit_litres: FIXTURE_PRICE_UNIT_LITRES,
      recorded_by: 'adnan',
      recorded_at: nextRecordedAt(),
    });
  }
  return f;
}

/**
 * Milk rows for the animals in milk, over `days` ending at `lastOn`.
 *
 * ALL THREE STATUSES APPEAR, and that is the point rather than decoration:
 * fixtures.ts had ZERO milking rows before this, which is why
 * REGISTRY_TOOLS.md had to defer `get_milking_record` -- the three-status split
 * had no fixture behind it, so the one thing worth testing about milk yield was
 * untestable. A fixture of all-measured rows would have reintroduced exactly
 * that gap while looking like coverage.
 */
export function addMilkings(db: Db, opts: { lastOn: string; days: number }): number {
  const open = db
    .prepare(`SELECT animal_id FROM registry_lactations WHERE ended_on IS NULL ORDER BY animal_id`)
    .all() as { animal_id: string }[];
  if (open.length === 0) return 0;

  const [y, m, d] = opts.lastOn.split('-').map(Number);
  let written = 0;
  let n = 0;

  for (let back = opts.days - 1; back >= 0; back--) {
    const day = new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10);
    for (const session of ['morning', 'evening'] as const) {
      const entries = open.map(({ animal_id }) => {
        n += 1;
        // A deterministic rotation rather than a random one: the same fixture
        // every run is what lets an assertion name an exact number.
        if (n % 7 === 0) return { animal_id, status: 'milked_not_measured' as const };
        if (n % 11 === 0) {
          return { animal_id, status: 'not_milked' as const, reason: 'under treatment' };
        }
        return {
          animal_id,
          status: 'measured' as const,
          yield_litres: Math.round((6 + ((n * 37) % 40) / 10) * 10) / 10,
        };
      });
      written += saveMilkingSession(db, {
        occurred_on: day,
        session,
        observed_by: n % 2 === 0 ? 'imran' : 'abdul',
        entries,
        provenance: { source_form: 'direct_entry', recorded_by: 'adnan' },
      }).written;
    }
  }
  return written;
}

/**
 * Dispatch rows to match, over the same range.
 *
 * The dodhi and home answer EVERY session (they are standing); the households
 * appear only on some, which is the shape §4.1a describes and the reason an
 * absent occasional row must never read as missing data.
 */
export function addDispatches(db: Db, f: SalesFixture, opts: { lastOn: string; days: number }): number {
  const [y, m, d] = opts.lastOn.split('-').map(Number);
  let written = 0;
  let n = 0;

  for (let back = opts.days - 1; back >= 0; back--) {
    const day = new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10);
    for (const session of ['morning', 'evening'] as const) {
      n += 1;
      const entries: {
        destination_id: string;
        status: 'taken' | 'none';
        litres?: number;
        reason?: string;
      }[] = [
        // The dodhi takes the bulk of it, and occasionally does not come.
        // SCALED TO THE HERD. The first version of this fixture had the dodhi
        // taking 30-39 L a session from a herd of three animals giving about
        // 22 -- which reconciled to a gap of -454 L over two weeks and made
        // every screen built against it look broken. Fixture numbers that
        // cannot happen are worse than no fixture, because the screen looks
        // wrong and the code is not.
        n % 9 === 0
          ? { destination_id: f.dodhi, status: 'none', reason: 'did not come' }
          : { destination_id: f.dodhi, status: 'taken', litres: 12 + ((n * 13) % 55) / 10 },
        { destination_id: f.home, status: 'taken', litres: 2 + (n % 3) },
      ];
      // The households take surplus -- neither on a fixed session, which is
      // why there is no `sessions` column to encode.
      if (n % 3 === 0) entries.push({ destination_id: f.ali, status: 'taken', litres: 4 });
      if (n % 5 === 0) entries.push({ destination_id: f.bibi, status: 'taken', litres: 2.5 });

      written += saveDispatchSession(db, {
        occurred_on: day,
        session,
        observed_by: n % 2 === 0 ? 'imran' : 'abdul',
        entries,
        provenance: { source_form: 'direct_entry', recorded_by: 'adnan' },
      }).written;
    }
  }
  return written;
}

/** How many days of milk and sales `tradingHerd()` writes. */
export const TRADING_DAYS = 14;

/**
 * The clean herd, plus two weeks of milk yield and sales.
 *
 * The fixture the sales and reconciliation screens are developed against, and
 * the first one in this repo where the two halves meet: the reconciliation has
 * production on one side and dispatch on the other, and a fixture with only one
 * of them would leave the number it computes untested.
 *
 * ---------------------------------------------------------------------------
 * `lastOn` IS A PARAMETER, AND IT DEFAULTS TO AS_OF RATHER THAN TO TODAY
 * ---------------------------------------------------------------------------
 * Found by rendering the thing rather than by reading it. The first version
 * ended at AS_OF unconditionally, so the harness -- whose clock is the real one
 * -- opened `/dispatch` onto TODAY, four days past the last fixture row, and
 * every screen showed a correct and completely empty state. The code was right
 * and the screen looked broken, which is the worst kind of fixture.
 *
 * A default of `farmToday()` would have fixed the harness and broken the tests:
 * a fixture whose dates move with the calendar cannot carry an assertion about
 * an exact number. So the default stays frozen and the HARNESS passes today.
 */
export function tradingHerd(lastOn: string = AS_OF): { db: Db; sales: SalesFixture } {
  const db = cleanHerd();
  const sales = addSalesDestinations(db);
  addMilkings(db, { lastOn, days: TRADING_DAYS });
  addDispatches(db, sales, { lastOn, days: TRADING_DAYS });

  // A part payment, so the ledger fixture has a settled month behind an open
  // one rather than a single running balance.
  recordPayment(db, {
    destination_id: sales.dodhi,
    occurred_on: lastOn,
    amount_minor: 2_000_000,
    method: 'cash',
    recorded_by: 'adnan',
    recorded_at: nextRecordedAt(),
  });

  return { db, sales };
}
