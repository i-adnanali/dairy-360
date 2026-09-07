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
import { addEngagement, addPerson } from './people';
import { saveRun, setTerm } from './payroll';
import { recordWagePayment } from './wages';
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
export function addDispatches(
  db: Db,
  f: SalesFixture,
  opts: {
    lastOn: string;
    days: number;
    /**
     * Extra STANDING destinations that must appear in every session -- a staff
     * milk allowance, when the labour fixture has created one.
     *
     * This parameter exists because saveDispatchSession() REFUSES a session
     * with a standing destination unanswered, which is the rule working: a
     * fixture that created a standing staff destination and then wrote sessions
     * without it would either throw or (if the rule were weaker) leave every
     * screen showing an untouched row it had no data for. Found by building
     * the labour fixture on top of this one.
     */
    alsoStanding?: { destination_id: string; litres: number }[];
  },
): number {
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

      // A staff allowance is taken every session it is due. The MORNING row
      // carries the whole daily allowance and the evening row is a real 'none',
      // because that is how a jug of milk actually leaves -- and it gives the
      // package report a non-trivial comparison rather than a flat multiple.
      for (const extra of opts.alsoStanding ?? []) {
        entries.push(
          session === 'morning'
            ? { destination_id: extra.destination_id, status: 'taken', litres: extra.litres }
            : { destination_id: extra.destination_id, status: 'none', reason: 'taken in the morning' },
        );
      }

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

// ---------------------------------------------------------------------------
// Labour fixtures (docs/REGISTRY_PAYROLL.md §14, item 8)
// ---------------------------------------------------------------------------

/**
 * SYNTHETIC, AND MORE STRICTLY SO THAN ANYWHERE ELSE IN THIS FILE.
 *
 * The rule that nothing synthetic touches dairy.db cuts both ways everywhere,
 * but here the second direction is the important one: a REAL PERSON'S SALARY
 * MUST NEVER APPEAR IN A FIXTURE FILE A TEST CAN LOAD. The names and the
 * figures below are invented. Real people are entered through the screen, into
 * the live database, by the farm.
 *
 * The only thing taken from the real farm is the SHAPE -- salaried staff on a
 * package of cash plus milk, flour and quarters, with dihari hired a few times
 * a month for cover and surge.
 */
export const FIXTURE_SALARY_MINOR = 2_500_000; // Rs 25,000 / month
export const FIXTURE_SALARY_2_MINOR = 2_000_000; // Rs 20,000 / month
export const FIXTURE_DIHARI_MINOR = 120_000; // Rs 1,200 / day

export interface LabourFixture {
  /** Salaried, with the full package -- milk, flour, quarters. */
  imran: { person: string; engagement: string };
  /** Salaried, all cash, so the screens have a package with no in-kind lines. */
  abdul: { person: string; engagement: string };
  /** Dihari, hired for cover. */
  rashid: { person: string; engagement: string };
  /** Imran's milk destination, so the allowance has dispatch rows to compare. */
  imranMilk: string;
}

/**
 * Two salaried staff, one dihari, and a milk allowance with a destination.
 *
 * Takes a db so it can ride on `cleanHerd()` or stand alone -- the labour half
 * has no foreign key to an animal either, and that is worth a fixture proving
 * for the same reason the sales half was.
 *
 * `imran` deliberately carries all three benefit kinds and `abdul` carries
 * none: a package screen developed against only one of those shapes gets the
 * empty state wrong, which is how the sales cycle's §17 findings happened.
 */
export function addLabour(db: Db, opts: { startedOn?: string } = {}): LabourFixture {
  const startedOn = opts.startedOn ?? '2026-01-01';

  const person = (identifier: string, name: string) =>
    addPerson(db, {
      identifier,
      name,
      recorded_by: 'adnan',
      recorded_at: nextRecordedAt(),
    }).id;

  const engage = (personId: string, kind: 'permanent' | 'daily', role: string | null) =>
    addEngagement(db, {
      person_id: personId,
      kind,
      role,
      started_on: startedOn,
      recorded_by: 'adnan',
      recorded_at: nextRecordedAt(),
    }).id;

  const imran = person('imran', 'Imran');
  const abdul = person('abdul', 'Abdul');
  const rashid = person('rashid', 'Rashid');

  const imranJob = engage(imran, 'permanent', 'milker');
  const abdulJob = engage(abdul, 'permanent', 'general');
  const rashidJob = engage(rashid, 'daily', null);

  setTerm(db, {
    engagement_id: imranJob,
    effective_from: startedOn,
    cash_minor: FIXTURE_SALARY_MINOR,
    cash_period: 'month',
    benefits: [
      { kind: 'milk', quantity: 2, unit: 'L', period: 'day' },
      { kind: 'flour', quantity: 20, unit: 'kg', period: 'month' },
      { kind: 'accommodation' },
    ],
    recorded_by: 'adnan',
    recorded_at: nextRecordedAt(),
  });
  setTerm(db, {
    engagement_id: abdulJob,
    effective_from: startedOn,
    cash_minor: FIXTURE_SALARY_2_MINOR,
    cash_period: 'month',
    recorded_by: 'adnan',
    recorded_at: nextRecordedAt(),
  });
  setTerm(db, {
    engagement_id: rashidJob,
    effective_from: startedOn,
    cash_minor: FIXTURE_DIHARI_MINOR,
    cash_period: 'day',
    recorded_by: 'adnan',
    recorded_at: nextRecordedAt(),
  });

  // One destination per staff member on an allowance -- the dispatch key is one
  // row per destination per session, so a shared row could not say whose milk
  // it was. STANDING, because an allowance is taken daily and is exactly as
  // forgettable as the household's.
  const imranMilk = addDestination(db, {
    name: 'Imran (milk allowance)',
    kind: 'staff',
    standing: true,
    person_id: imran,
    started_on: startedOn,
    recorded_by: 'adnan',
    recorded_at: nextRecordedAt(),
  }).id;

  return {
    imran: { person: imran, engagement: imranJob },
    abdul: { person: abdul, engagement: abdulJob },
    rashid: { person: rashid, engagement: rashidJob },
    imranMilk,
  };
}

/**
 * One month paid, one dihari day, and a part payment.
 *
 * The month is the one BEFORE `lastOn`'s, so the current month is deliberately
 * unpaid: the run screen's whole job is showing an outstanding period, and a
 * fixture where everything is settled renders the completed state and hides the
 * one that matters. Learned from the sales fixtures, whose first version ended
 * at AS_OF and made every screen look broken in the harness.
 *
 * `imran` is paid LESS than his agreement, on purpose, so /check has a real
 * `amount_differs_from_term` line to render rather than an empty report.
 */
export function addPayroll(db: Db, f: LabourFixture, opts: { lastOn: string }): number {
  const month = opts.lastOn.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const from = `${prevY}-${String(prevM).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
  const to = `${prevY}-${String(prevM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const result = saveRun(db, {
    from_on: from,
    to_on: to,
    entries: [
      {
        engagement_id: f.imran.engagement,
        amount_minor: FIXTURE_SALARY_MINOR - 300_000,
        note: 'four days leave',
      },
      { engagement_id: f.abdul.engagement, amount_minor: FIXTURE_SALARY_2_MINOR },
      // Two dihari days, which is the measured cadence: a few times a month.
      {
        engagement_id: f.rashid.engagement,
        from_on: `${prevY}-${String(prevM).padStart(2, '0')}-14`,
        amount_minor: FIXTURE_DIHARI_MINOR,
      },
      {
        engagement_id: f.rashid.engagement,
        from_on: `${prevY}-${String(prevM).padStart(2, '0')}-21`,
        amount_minor: FIXTURE_DIHARI_MINOR,
      },
    ],
    provenance: { source_form: 'direct_entry', recorded_by: 'adnan' },
  });

  // Abdul settled in full; Imran part-paid, so the ledger fixture has both a
  // settled balance and an open one rather than a single running total. Rashid
  // was paid in cash the day he worked, which is what makes his balance zero
  // with no special case anywhere.
  recordWagePayment(db, {
    person_id: f.abdul.person,
    occurred_on: opts.lastOn,
    amount_minor: FIXTURE_SALARY_2_MINOR,
    method: 'cash',
    recorded_by: 'adnan',
    recorded_at: nextRecordedAt(),
  });
  recordWagePayment(db, {
    person_id: f.imran.person,
    occurred_on: opts.lastOn,
    amount_minor: 1_500_000,
    method: 'cash',
    recorded_by: 'adnan',
    recorded_at: nextRecordedAt(),
  });
  // An ADVANCE, dated before it was earned, so the negative-balance state is on
  // screen from the first render rather than being something nobody sees until
  // it happens for real.
  recordWagePayment(db, {
    person_id: f.rashid.person,
    occurred_on: `${prevY}-${String(prevM).padStart(2, '0')}-01`,
    amount_minor: FIXTURE_DIHARI_MINOR * 3,
    method: 'cash',
    reference: 'peshgi',
    recorded_by: 'adnan',
    recorded_at: nextRecordedAt(),
  });

  return result.written;
}

/**
 * The trading herd, plus the people who work it.
 *
 * The fixture the payroll screens are developed against. Same frozen-default
 * argument as tradingHerd(): the tests need exact dates and the harness needs
 * today, so the default stays frozen and the harness passes its own.
 *
 * ---------------------------------------------------------------------------
 * NOTE THE ORDER, WHICH IS NOT tradingHerd() + LABOUR
 * ---------------------------------------------------------------------------
 * The labour fixture creates a STANDING staff destination, and
 * saveDispatchSession() refuses a session that leaves a standing destination
 * unanswered. So labour has to exist BEFORE the dispatches are written, and the
 * staff row rides along in them via `alsoStanding`.
 *
 * Calling tradingHerd() and then adding labour would leave two weeks of
 * sessions with Imran's allowance missing -- which the rule would not catch,
 * because those rows were already written, and which would show up only as a
 * package report that read zero against a 2 L/day allowance. That is the
 * fixture-looks-broken failure the sales fixtures hit twice, so this function
 * deliberately does not reuse tradingHerd().
 */
export function staffedHerd(lastOn: string = AS_OF): {
  db: Db;
  sales: SalesFixture;
  labour: LabourFixture;
} {
  const db = cleanHerd();
  const sales = addSalesDestinations(db);
  const labour = addLabour(db);
  addMilkings(db, { lastOn, days: TRADING_DAYS });
  addDispatches(db, sales, {
    lastOn,
    days: TRADING_DAYS,
    alsoStanding: [{ destination_id: labour.imranMilk, litres: 2 }],
  });
  recordPayment(db, {
    destination_id: sales.dodhi,
    occurred_on: lastOn,
    amount_minor: 2_000_000,
    method: 'cash',
    recorded_by: 'adnan',
    recorded_at: nextRecordedAt(),
  });
  addPayroll(db, labour, { lastOn });
  return { db, sales, labour };
}
