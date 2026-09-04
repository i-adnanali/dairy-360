// Registry read tools (Cycle 9; see docs/REGISTRY_TOOLS.md).
//
// Every test drives the FACTORY with a `cleanHerd()` handle on `:memory:`, so
// nothing here reads dairy.db to find out what a digest looks like. That is the
// whole reason registryReadExecutors takes a handle -- REGISTRY_TOOLS.md §4.
//
// These assert the DIGEST SHAPE: that precision, quality and supersession
// actually reach the model. They cannot assert that the model then uses them
// correctly -- that is the live eval in REGISTRY_TOOLS.md § "The eval that
// matters", and the distinction is deliberate. A green suite here means the
// information is present, not that the answer is honest.

import assert from 'node:assert';
import { describe, test } from 'node:test';

import { cleanHerd, freshDb } from '../registry/fixtures';
import { guardSerial, registryReadExecutors } from './registryReads';

type Digest = Record<string, unknown>;

/** Executors over the awkward-case fixture herd. */
function onCleanHerd() {
  return registryReadExecutors(cleanHerd());
}

function digest(result: { modelDigest: unknown }): Digest {
  return result.modelDigest as Digest;
}

describe('list_registry_animals', () => {
  test('returns the herd with precision beside every birth date', () => {
    const d = digest(onCleanHerd().list_registry_animals({}));
    const animals = d.animals as Digest[];

    assert.equal(d.count, animals.length);
    assert.ok(animals.length > 0, 'the fixture herd is not empty');

    // The load-bearing claim: a date never travels without its precision. A
    // model handed `2018-01-01` alone cannot tell an exact date from a
    // year-precision placeholder, and would report the placeholder as a fact.
    for (const a of animals) {
      assert.ok('birth_precision' in a, `${String(a.serial)} carries birth_precision`);
      if (a.birth_on !== null) {
        assert.ok(
          a.birth_precision !== null,
          `${String(a.serial)} has a birth date, so it must have a precision`,
        );
      }
    }

    const noor = animals.find((a) => a.serial === 'BD-0001');
    assert.ok(noor, 'BD-0001 is in the herd');
    assert.equal(noor?.name, 'Noor');
    assert.equal(noor?.sex, 'female');
    // Acquired with a year-precision birth date -- the fixture's own shape.
    assert.equal(noor?.birth_precision, 'year');
  });

  test('the status filter narrows, and names itself in the digest', () => {
    const x = onCleanHerd();
    const all = digest(x.list_registry_animals({})).count as number;
    const d = digest(x.list_registry_animals({ status: 'departed' }));

    assert.equal(d.filtered_by_status, 'departed');
    assert.ok((d.count as number) < all, 'a status filter returns fewer than everything');
    for (const a of d.animals as Digest[]) assert.equal(a.status, 'departed');
    // BD-0004 departed in the fixture.
    assert.ok(
      (d.animals as Digest[]).some((a) => a.serial === 'BD-0004'),
      'the departed animal is the one that comes back',
    );
  });

  test('an empty registry reports zero rather than failing', () => {
    // The NORMAL state before the herd is transcribed, and REGISTRY.md treats
    // it as first-class. A tool that threw here would make "we have no records
    // yet" unanswerable.
    const d = digest(registryReadExecutors(freshDb()).list_registry_animals({}));
    assert.equal(d.count, 0);
    assert.deepEqual(d.animals, []);
  });
});

describe('get_registry_animal', () => {
  test('carries the whole event list with precision per event', () => {
    const d = digest(onCleanHerd().get_registry_animal({ serial: 'BD-0001' }));
    const events = d.events as Digest[];

    assert.equal(d.serial, 'BD-0001');
    assert.ok(events.length > 0);
    for (const e of events) {
      assert.ok('date_precision' in e, 'every event states how well its date is known');
      assert.ok('source_form' in e, 'and where it came from');
    }
  });

  test('an unknown serial is a structured error, not a throw', () => {
    const d = digest(onCleanHerd().get_registry_animal({ serial: 'BD-9999' }));
    assert.equal(d.error, 'unknown_animal');
    assert.equal(d.serial, 'BD-9999');
  });

  test('superseded events are present and marked', () => {
    // herdWithCorrection() supersedes BD-0001's calving on BOTH sides of the
    // pair. The model must see the replaced row: a correction whose "before"
    // is invisible cannot be explained, only asserted.
    const { herdWithCorrection } = require('../registry/fixtures') as
      typeof import('../registry/fixtures');
    const { db } = herdWithCorrection();
    const d = digest(registryReadExecutors(db).get_registry_animal({ serial: 'BD-0001' }));
    const events = d.events as Digest[];

    const superseded = events.filter((e) => e.superseded === true);
    assert.ok(superseded.length > 0, 'the replaced calving is in the digest');
    for (const e of superseded) {
      assert.equal(e.effective, false, 'and is marked as not effective');
    }
    assert.ok(
      events.some((e) => e.effective === true),
      'alongside the events that ARE effective, so the two are distinguishable',
    );
  });
});

describe('guardSerial', () => {
  test('accepts a serial that exists', () => {
    // The direction that cannot be tested through guardIds itself, and the one
    // that matters: a guard that rejected everything would pass every
    // rejection test. See the note on guardSerial.
    assert.equal(guardSerial(cleanHerd(), { serial: 'BD-0001' }), null);
  });

  test('rejects a serial that does not, with a structured error', () => {
    const err = guardSerial(cleanHerd(), { serial: 'BD-9999' });
    assert.deepEqual(err, { error: 'unknown_animal', serial: 'BD-9999' });
  });

  test('ignores args with no serial, and an empty one', () => {
    const db = cleanHerd();
    assert.equal(guardSerial(db, {}), null);
    assert.equal(guardSerial(db, { serial: '' }), null);
    // An `animal_id` is the DEMO id space and not this guard's business --
    // guardIds resolves that one against the demo `animals` table.
    assert.equal(guardSerial(db, { animal_id: 'animal_001' }), null);
  });

  test('a demo animal_id is not accepted as a serial', () => {
    // The collision this whole split exists to prevent, from the other side:
    // the two id spaces must not be interchangeable at the guard.
    const err = guardSerial(cleanHerd(), { serial: 'animal_001' });
    assert.deepEqual(err, { error: 'unknown_animal', serial: 'animal_001' });
  });
});

describe('get_calving_intervals', () => {
  test('splits measured from approximate and never pools them', () => {
    const d = digest(onCleanHerd().get_calving_intervals({}));

    assert.equal(d.scope, 'herd');

    const measured = d.measured as Digest;
    const approximate = d.approximate as Digest;

    // The fixture is built for exactly this: BD-0001 calved twice at day
    // precision, BD-0002 twice at month precision.
    assert.equal(measured.count, 1, 'one measured interval (BD-0001)');
    assert.equal(approximate.count, 1, 'one approximate interval (BD-0002)');
    assert.equal(measured.mean_days, 446);
    assert.equal(approximate.mean_days, 457);

    // There is NO combined figure, and its absence is the design. The pooled
    // mean would be 451.5 -- a number that looks precise and means nothing,
    // because the approximate endpoint carries roughly +/-60 days.
    assert.ok(!('mean_days' in d), 'the digest has no top-level blended mean');
    assert.ok(!('total' in d), 'and no combined summary of any kind');

    // The caveat travels as a field so a consumer has to actively drop it.
    assert.match(String(d.caveat), /never averaged together/);
    assert.match(String(d.caveat), /case series/);
  });

  test('every interval states its own quality', () => {
    const d = digest(onCleanHerd().get_calving_intervals({}));
    const intervals = d.intervals as Digest[];

    assert.ok(intervals.length > 0);
    for (const i of intervals) {
      assert.ok(
        i.quality === 'measured' || i.quality === 'approximate',
        'quality is on the row, not only in the summary',
      );
    }
    assert.equal(intervals.find((i) => i.days === 457)?.quality, 'approximate');
  });

  test('a single animal keeps the same shape, and the caveat', () => {
    // A digest whose shape changed with the scope would let the caveat vanish
    // on the narrower question -- which is the question more likely to be asked
    // about a specific animal's trend.
    const d = digest(onCleanHerd().get_calving_intervals({ serial: 'BD-0002' }));

    assert.equal(d.scope, 'BD-0002');
    assert.equal((d.measured as Digest).count, 0);
    assert.equal((d.approximate as Digest).count, 1);
    assert.equal((d.measured as Digest).mean_days, null, 'no measured data is null, not 0');
    assert.ok(String(d.caveat).length > 0, 'the caveat survives the narrower scope');
  });

  test('an unknown serial is a structured error', () => {
    const d = digest(onCleanHerd().get_calving_intervals({ serial: 'BD-9999' }));
    assert.equal(d.error, 'unknown_animal');
  });

  test('an animal with one calving has no intervals, and says so with null', () => {
    // BD-0003 calved once (a stillbirth). One calving is not an interval, and
    // the absence must not read as a zero-day interval.
    const d = digest(onCleanHerd().get_calving_intervals({ serial: 'BD-0003' }));
    assert.deepEqual(d.intervals, []);
    assert.equal((d.measured as Digest).mean_days, null);
    assert.equal((d.approximate as Digest).mean_days, null);
  });
});
