// Animal registry -- replay protection on the write routes.
//
// ---------------------------------------------------------------------------
// THIS FILE IS THE VALIDATION PASS'S DOUBLE-SUBMIT SCRIPT, PROMOTED
// ---------------------------------------------------------------------------
// Double-submit was not inferred during validation, it was executed. A throwaway
// script against an `:memory:` database ran the same payload twice, an identical
// note twice and an identical dry-off twice, and printed:
//
//   same payload twice      -> BD-0001 BD-0002
//   identical note twice    -> TWO EVENTS
//   identical dry_off twice -> TWO EVENTS
//   animals: 2   events: 6
//
// That sequence is the regression test now, run over real HTTP because that is
// where the protection lives -- the domain functions are unchanged and still
// append twice when asked twice, which is correct: two calls ARE two writes
// unless something says they are one submission. The key is what says so.
//
// So each case is run BOTH WAYS, and the pair is the point:
//
//   reused key -> one write, the original response replayed
//   fresh keys -> two writes, exactly as before
//
// A test that only proved the first would pass equally if the routes had
// started refusing every second write, which would be a bug wearing a fix's
// clothes.

import assert from 'node:assert';
import { after, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { harnessApp } from './harness';
import { freshDb } from './fixtures';
import { IDEMPOTENCY_HEADER, MAX_REMEMBERED, IdempotencyStore, bodyHash, canonicalJson } from './idempotency';
import type { Db } from './schema';

const AS_OF = '2026-09-01';
const PROV = { source_form: 'recall', recorded_by: 'adnan' };

interface Ctx {
  base: string;
  db: Db;
}

const open: Server[] = [];

async function serve(db: Db): Promise<Ctx> {
  const server = harnessApp(db).listen(0);
  open.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}/api/registry`, db };
}

after(() => {
  for (const s of open) s.close();
});

/** POST with an explicit key, so every test states which submission it is. */
async function post(
  ctx: Ctx,
  path: string,
  payload: unknown,
  key: string | null,
): Promise<{ status: number; body: never }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== null) headers[IDEMPOTENCY_HEADER] = key;
  const r = await fetch(`${ctx.base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: (await r.json()) as never };
}

const counts = (db: Db) => ({
  animals: (db.prepare('SELECT COUNT(*) c FROM registry_animals').get() as { c: number }).c,
  events: (db.prepare('SELECT COUNT(*) c FROM registry_animal_events').get() as { c: number }).c,
});

const ANIMAL = {
  sex: 'female',
  name: 'Kali',
  acquired_on: '2020-01-01',
  date_precision: 'year',
  as_of: AS_OF,
  ...PROV,
};

// ---------------------------------------------------------------------------
// The three cases from the validation script
// ---------------------------------------------------------------------------

test('the same animal payload twice on one key mints ONE animal', async () => {
  const ctx = await serve(freshDb());

  const first = await post(ctx, '/animals', ANIMAL, 'k-add');
  const second = await post(ctx, '/animals', ANIMAL, 'k-add');

  assert.equal(first.status, 201);
  // The ORIGINAL status and the original body, not a 200 and not a 409.
  assert.equal(second.status, 201);
  assert.equal(
    (second.body as { animal_id: string }).animal_id,
    (first.body as { animal_id: string }).animal_id,
    'the replay must return the animal the first call minted, not a new serial',
  );
  assert.equal((first.body as { animal_id: string }).animal_id, 'BD-0001');
  assert.deepEqual(counts(ctx.db), { animals: 1, events: 1 });
});

test('the same animal payload on TWO keys still mints two -- the domain is unchanged', async () => {
  // The old behaviour, preserved. Two submissions are two animals; only a
  // reused key claims they are one. Without this, "fixed" would be
  // indistinguishable from "refuses every second write".
  const ctx = await serve(freshDb());

  const a = await post(ctx, '/animals', ANIMAL, 'k-1');
  const b = await post(ctx, '/animals', ANIMAL, 'k-2');

  assert.equal((a.body as { animal_id: string }).animal_id, 'BD-0001');
  assert.equal((b.body as { animal_id: string }).animal_id, 'BD-0002');
  assert.deepEqual(counts(ctx.db), { animals: 2, events: 2 });
});

test('an identical note twice on one key appends ONE event', async () => {
  const ctx = await serve(freshDb());
  const { body } = await post(ctx, '/animals', ANIMAL, 'k-add');
  const id = (body as { animal_id: string }).animal_id;
  const note = {
    animal_id: id,
    type: 'note',
    text: 'hello',
    occurred_on: '2021-03-01',
    date_precision: 'month',
    as_of: AS_OF,
    ...PROV,
  };

  const first = await post(ctx, '/events', note, 'k-note');
  const second = await post(ctx, '/events', note, 'k-note');

  assert.equal(
    (second.body as { event_id: string }).event_id,
    (first.body as { event_id: string }).event_id,
  );
  assert.deepEqual(counts(ctx.db), { animals: 1, events: 2 }); // acquired + one note
});

test('an identical dry_off twice on one key appends ONE event', async () => {
  const ctx = await serve(freshDb());
  const { body } = await post(ctx, '/animals', ANIMAL, 'k-add');
  const id = (body as { animal_id: string }).animal_id;
  const dry = {
    animal_id: id,
    type: 'dry_off',
    occurred_on: '2021-06-01',
    date_precision: 'month',
    as_of: AS_OF,
    ...PROV,
  };

  await post(ctx, '/events', dry, 'k-dry');
  await post(ctx, '/events', dry, 'k-dry');

  assert.deepEqual(counts(ctx.db), { animals: 1, events: 2 }); // acquired + one dry_off
});

// ---------------------------------------------------------------------------
// The missing-key refusal
// ---------------------------------------------------------------------------

test('a write with no key is refused, and writes nothing', async () => {
  const ctx = await serve(freshDb());
  const { status, body } = await post(ctx, '/animals', ANIMAL, null);

  assert.equal(status, 400);
  assert.equal((body as { error: string }).error, 'missing_idempotency_key');
  // Named as a field so a client can bind the message, like every other refusal.
  assert.equal((body as { field: string }).field, IDEMPOTENCY_HEADER);
  assert.match((body as { message: string }).message, /stable across retries/);
  assert.deepEqual(counts(ctx.db), { animals: 0, events: 0 });
});

test('a blank or whitespace key does not count as a key', async () => {
  const ctx = await serve(freshDb());
  for (const key of ['', '   ']) {
    const { status, body } = await post(ctx, '/animals', ANIMAL, key);
    assert.equal(status, 400, `key ${JSON.stringify(key)} should be refused`);
    assert.equal((body as { error: string }).error, 'missing_idempotency_key');
  }
  assert.deepEqual(counts(ctx.db), { animals: 0, events: 0 });
});

test('every event-appending route requires a key', async () => {
  // Named individually so adding a write route without protection fails here
  // rather than being noticed by nobody.
  const ctx = await serve(freshDb());
  const routes = ['/animals', '/events', '/calvings', '/calvings/aevt_whatever/correction'];
  for (const path of routes) {
    const { status, body } = await post(ctx, path, {}, null);
    assert.equal(status, 400, `${path} accepted a keyless write`);
    assert.equal(
      (body as { error: string }).error,
      'missing_idempotency_key',
      `${path} refused for some other reason -- the key check must come first`,
    );
  }
});

test('/rebuild needs no key: it appends nothing and is idempotent by construction', async () => {
  const ctx = await serve(freshDb());
  const { status } = await post(ctx, '/rebuild', { as_of: AS_OF }, null);
  assert.equal(status, 200);
});

// ---------------------------------------------------------------------------
// Only successes are remembered
// ---------------------------------------------------------------------------

test('a refusal is NOT remembered, so a corrected retry on the same key proceeds', async () => {
  // The path this protects: submit, get refused, fix the payload, submit again.
  // The key is deliberately reused by the client (the attempt sequence has not
  // ended), and the write must still happen.
  const ctx = await serve(freshDb());

  // A month-precision date on the 14th -- refused three ways over. Note that
  // `date_precision: 'day'` would NOT do here: 2020-01-01 is a perfectly
  // legitimate exact day, which is its own small reminder that the storage
  // convention makes year and day dates indistinguishable on January 1.
  const bad = await post(
    ctx,
    '/animals',
    { ...ANIMAL, acquired_on: '2020-03-14', date_precision: 'month' },
    'k-fix',
  );
  assert.equal(bad.status, 400, 'a month-precision date dated the 14th must be refused');

  const good = await post(ctx, '/animals', ANIMAL, 'k-fix');
  assert.equal(good.status, 201);
  assert.equal((good.body as { animal_id: string }).animal_id, 'BD-0001');
  assert.deepEqual(counts(ctx.db), { animals: 1, events: 1 });
});

test('the same key with a different body is a different write, not a conflict', async () => {
  // Two animals entered back-to-back where the client had not yet cleared its
  // key. Keying on (key, body) means this needs no special case and no error.
  const ctx = await serve(freshDb());

  const a = await post(ctx, '/animals', { ...ANIMAL, name: 'Kali' }, 'k-same');
  const b = await post(ctx, '/animals', { ...ANIMAL, name: 'Noori' }, 'k-same');

  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(
    (a.body as { animal_id: string }).animal_id,
    (b.body as { animal_id: string }).animal_id,
  );
  assert.deepEqual(counts(ctx.db), { animals: 2, events: 2 });
});

test('key order in the body does not defeat the replay check', async () => {
  // A client that serialises its fields in a different order on a retry is
  // still retrying. canonicalJson sorts, so the hash does not care.
  const ctx = await serve(freshDb());
  const forward = { sex: 'female', acquired_on: '2020-01-01', date_precision: 'year', as_of: AS_OF, ...PROV };
  const reversed = Object.fromEntries(Object.entries(forward).reverse());

  await post(ctx, '/animals', forward, 'k-order');
  await post(ctx, '/animals', reversed, 'k-order');

  assert.deepEqual(counts(ctx.db), { animals: 1, events: 1 });
});

test('a replay is scoped to its own router, so the harness cannot answer for dairy.db', async () => {
  // registryRouter is a factory precisely so the harness can serve `:memory:`.
  // A module-level store would let one router replay a response describing rows
  // that only exist in the other's database.
  const one = await serve(freshDb());
  const two = await serve(freshDb());

  const a = await post(one, '/animals', ANIMAL, 'k-shared');
  const b = await post(two, '/animals', ANIMAL, 'k-shared');

  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.deepEqual(counts(one.db), { animals: 1, events: 1 });
  assert.deepEqual(counts(two.db), { animals: 1, events: 1 });
});

// ---------------------------------------------------------------------------
// The store itself
// ---------------------------------------------------------------------------

test('canonicalJson is stable across key order and nesting', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ x: { q: 1, p: 2 } }), '{"x":{"p":2,"q":1}}');
  // Arrays are ORDERED and must not be sorted -- [1,2] is not [2,1].
  assert.notEqual(canonicalJson({ x: [1, 2] }), canonicalJson({ x: [2, 1] }));
  // An absent key and an explicit undefined are the same request.
  assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
  // Null is a VALUE, not an absence: `observed_by: null` is a real payload.
  assert.notEqual(canonicalJson({ a: 1, b: null }), canonicalJson({ a: 1 }));
});

test('the store distinguishes bodies and evicts least-recently-used past the cap', () => {
  const store = new IdempotencyStore();
  const one = bodyHash({ a: 1 });
  const two = bodyHash({ a: 2 });

  store.remember('k', one, { status: 201, body: { id: 'first' } });
  assert.deepEqual(store.get('k', one), { status: 201, body: { id: 'first' } });
  assert.equal(store.get('k', two), undefined, 'a different body is a different write');

  for (let i = 0; i < MAX_REMEMBERED; i++) {
    store.remember(`filler-${i}`, one, { status: 201, body: i });
    // Keep touching the original so it stays the most recently USED entry.
    store.get('k', one);
  }
  assert.equal(store.size, MAX_REMEMBERED);
  assert.notEqual(store.get('k', one), undefined, 'a replayed key must survive eviction');
});
