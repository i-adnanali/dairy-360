// Animal registry -- near-duplicate detection on entry.
//
// This closes the one hole an idempotency key cannot: a page refresh or a
// second browser tab gets a fresh key, so the server cannot tell the two
// submits are one. `/add` is where that mints a permanent duplicate with no
// calving flow involved, and nothing in this registry can merge two animals
// back together.
//
// A query CAN see it, because by the time the second submit happens the first
// animal is in the database. The two properties the tests below exist to hold:
// the match is generous enough to catch a real duplicate, and it never blocks
// two animals that are genuinely two.

import assert from 'node:assert';
import { test } from 'node:test';

import { freshDb } from './fixtures';
import { addAcquiredAnimal } from './entry';
import {
  MIN_PREFIX,
  duplicateCandidates,
  normalizeIdentifier,
  sharesPrefix,
  withinOneEdit,
} from './reads';

const AS_OF = '2026-09-01';
const PROV = { source_form: 'recall' as const, recorded_by: 'adnan' };

function add(
  db: ReturnType<typeof freshDb>,
  o: { name?: string | null; post_no?: string | null; tag_no?: string | null; sex?: 'female' | 'male' },
): string {
  return addAcquiredAnimal(db, {
    sex: o.sex ?? 'female',
    name: o.name ?? null,
    post_no: o.post_no ?? null,
    tag_no: o.tag_no ?? null,
    acquired_on: '2024-01-01',
    date_precision: 'year',
    provenance: PROV,
    asOf: AS_OF,
  }).animal_id;
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

// ---------------------------------------------------------------------------
// The comparison helpers, pure
// ---------------------------------------------------------------------------

test('normalisation folds case and collapses whitespace', () => {
  assert.equal(normalizeIdentifier('  Kali  '), 'kali');
  assert.equal(normalizeIdentifier('Noor   Jehan'), 'noor jehan');
});

test('withinOneEdit accepts one substitution, insertion or deletion', () => {
  assert.equal(withinOneEdit('kali', 'kali'), true);
  assert.equal(withinOneEdit('kali', 'kali2'), true, 'insertion');
  assert.equal(withinOneEdit('kali2', 'kali'), true, 'deletion');
  assert.equal(withinOneEdit('kali', 'kalo'), true, 'substitution');
  assert.equal(withinOneEdit('kali', 'kaloo'), false, 'two edits');
  assert.equal(withinOneEdit('kali', 'noor'), false);
});

test('the prefix rule is what catches abdul / abdul_r', () => {
  // Edit distance does not: two characters were added, so the distance is 2.
  assert.equal(withinOneEdit('abdul', 'abdul_r'), false);
  assert.equal(sharesPrefix('abdul', 'abdul_r'), true);
});

test('a prefix shorter than the minimum matches nothing', () => {
  // Otherwise 'a' would match every animal whose name starts with an a.
  assert.equal(sharesPrefix('a', 'abdul'), false);
  assert.equal(MIN_PREFIX, 3);
});

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

test('an empty query returns nothing, not the whole herd', () => {
  // A form firing on every keystroke must get nothing until something is typed.
  const db = freshDb();
  add(db, { name: 'Kali' });
  assert.deepEqual(duplicateCandidates(db, {}), []);
  assert.deepEqual(duplicateCandidates(db, { name: '   ' }), []);
});

test('an identical name and sex is a match', () => {
  const db = freshDb();
  const kali = add(db, { name: 'Kali' });
  add(db, { name: 'Noor' });
  const hits = duplicateCandidates(db, { name: 'Kali', sex: 'female' });
  assert.deepEqual(ids(hits), [kali]);
  assert.equal(hits[0].matched_on, 'name_exact');
  assert.match(hits[0].match_reason, /same name 'Kali', same sex/);
});

test('case and spacing differences still match -- that is the whole point', () => {
  const db = freshDb();
  const kali = add(db, { name: 'Kali' });
  assert.deepEqual(ids(duplicateCandidates(db, { name: '  kali ', sex: 'female' })), [kali]);
});

test('a NAME match requires the same sex; an IDENTIFIER match does not', () => {
  // Names repeat on a farm, so a shared name across sexes is far more likely to
  // be two animals than one duplicate. A shared post no. across sexes is not --
  // it is either a duplicate or a real collision on a working identifier, and
  // both are worth surfacing.
  const db = freshDb();
  const male = add(db, { name: 'Kali', post_no: '12', sex: 'male' });

  assert.deepEqual(
    duplicateCandidates(db, { name: 'Kali', sex: 'female' }),
    [],
    'same name, different sex -> not flagged',
  );
  assert.deepEqual(
    ids(duplicateCandidates(db, { post_no: '12', sex: 'female' })),
    [male],
    'same post no., different sex -> flagged anyway',
  );
});

test('post no. outranks a name match, and the reason names which signal fired', () => {
  const db = freshDb();
  add(db, { name: 'Kali' });
  const byPost = add(db, { name: 'Noor', post_no: '12' });
  const hits = duplicateCandidates(db, { name: 'Kali', post_no: '12', sex: 'female' });
  assert.equal(hits[0].id, byPost);
  assert.equal(hits[0].matched_on, 'post_no');
  assert.match(hits[0].match_reason, /same post no\. '12'/);
});

test('a near-miss name is flagged and labelled as near, not exact', () => {
  const db = freshDb();
  const kali = add(db, { name: 'Kali' });
  const hits = duplicateCandidates(db, { name: 'Kalo', sex: 'female' });
  assert.deepEqual(ids(hits), [kali]);
  assert.equal(hits[0].matched_on, 'name_near');
});

test('TWO GENUINELY DIFFERENT ANIMALS ARE NOT FLAGGED, and this is the point of soft', () => {
  // The roster case named in the design: no name, same sex, same arrival year,
  // really two animals. Nothing to match on, so nothing is said -- and even if
  // something were, it would be a warning rather than a refusal.
  const db = freshDb();
  add(db, {});
  add(db, {});
  assert.deepEqual(duplicateCandidates(db, { sex: 'female' }), []);
});

test('an unrelated name is not flagged', () => {
  const db = freshDb();
  add(db, { name: 'Kali' });
  assert.deepEqual(duplicateCandidates(db, { name: 'Zubaida', sex: 'female' }), []);
});

test('the excluded animal never matches itself', () => {
  // The roster pass edits rows that already exist; without this every keystroke
  // would flag the row being typed as a duplicate of itself.
  const db = freshDb();
  const kali = add(db, { name: 'Kali' });
  assert.deepEqual(duplicateCandidates(db, { name: 'Kali', sex: 'female' }), [
    duplicateCandidates(db, { name: 'Kali', sex: 'female' })[0],
  ]);
  assert.deepEqual(
    duplicateCandidates(db, { name: 'Kali', sex: 'female', exclude_id: kali }),
    [],
  );
});

test('the most recently typed match comes first within a tier', () => {
  // A match from minutes ago is the likeliest refresh-and-resubmit.
  const db = freshDb();
  const first = add(db, { name: 'Kali' });
  const second = add(db, { name: 'Kali' });
  const hits = duplicateCandidates(db, { name: 'Kali', sex: 'female' });
  assert.deepEqual(ids(hits), [second, first]);
});

test('every match carries when it was TYPED, for the age the UI shows', () => {
  // Sourced from the origin event's recorded_at: registry_animals has no
  // timestamp, and recorded_at is the honest source anyway -- when the row was
  // typed, not when the arrival happened.
  const db = freshDb();
  add(db, { name: 'Kali' });
  const hit = duplicateCandidates(db, { name: 'Kali', sex: 'female' })[0];
  assert.ok(hit.recorded_at !== null);
  assert.match(hit.recorded_at!, /^\d{4}-\d{2}-\d{2}T/);
});

test('no recency cutoff: an old animal is still offered', () => {
  // The memory that fails is "did I already enter this one", and that fails
  // across sittings. Any window short enough to name would miss it.
  const db = freshDb();
  const old = add(db, { name: 'Kali' });
  db.prepare(
    `INSERT INTO registry_animal_events
       (id, animal_id, type, occurred_on, date_precision, payload, source_form,
        recorded_by, recorded_at)
     SELECT 'aevt_ancient', animal_id, 'note', '2019-01-01', 'year', '{"text":"x"}',
            source_form, recorded_by, '2019-01-01T00:00:00.000Z'
       FROM registry_animal_events WHERE animal_id = ? LIMIT 1`,
  ).run(old);
  assert.deepEqual(ids(duplicateCandidates(db, { name: 'Kali', sex: 'female' })), [old]);
});

test('the order is total, so two calls agree', () => {
  const db = freshDb();
  add(db, { name: 'Kali' });
  add(db, { name: 'Kali' });
  add(db, { name: 'Kali', post_no: '7' });
  const q = { name: 'Kali', post_no: '7', sex: 'female' as const };
  assert.deepEqual(ids(duplicateCandidates(db, q)), ids(duplicateCandidates(db, q)));
});
