import { registryRouter } from './routes';
// Animal registry -- the HTTP surface, exercised over REAL HTTP.
//
// ---------------------------------------------------------------------------
// WHY A REAL SERVER AND NOT DIRECT HANDLER CALLS
// ---------------------------------------------------------------------------
// These are the first non-SSE routes in this app. Calling the handlers directly
// would skip exactly the layers that are new and therefore most likely to be
// wrong: JSON body parsing, status codes, and -- above all -- SERIALIZATION.
// A domain error carries `code` and `field` as class properties, and
// `JSON.stringify` on an Error subclass returns `{}` unless something converts
// it. That bug is invisible to a function-level test and fatal to every form.
//
// So each test starts a real Express server on an ephemeral port and uses
// global fetch. No new dependency: better-sqlite3 is synchronous, express is
// already here, and node 22 has fetch.
//
// `:memory:` only, via the harness app. Writes nothing to disk.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { harnessApp } from './harness';
import { breedingHerd } from './breeding-fixtures';
import { RECALL, addAcquired, addDeparture, addDryOff, cleanHerd, freshDb } from './fixtures';
import { recordBreedingEvent } from './breeding';
import { herd } from './reads';
import { rebuild } from './projectStore';
import type { Db } from './schema';

const AS_OF = '2026-09-01';

interface Ctx {
  base: string;
  db: Db;
  close: () => Promise<void>;
}

const open: Server[] = [];

async function serve(db: Db): Promise<Ctx> {
  const server = harnessApp(db).listen(0, '127.0.0.1');
  open.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/api/registry`,
    db,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

after(() => {
  for (const s of open) s.close();
});

async function get(ctx: Ctx, path: string): Promise<{ status: number; body: never }> {
  const r = await fetch(`${ctx.base}${path}`);
  return { status: r.status, body: (await r.json()) as never };
}

/**
 * A FRESH KEY PER CALL, which is the right default for this file.
 *
 * The write routes refuse a keyless request (see registry.idempotency.test.ts,
 * which owns that behaviour). A per-call key keeps these tests about what they
 * were about: several of them post the same payload twice on purpose to
 * exercise a domain refusal -- the near-duplicate calving guard -- and a shared
 * key would silently replay the first response instead, turning a domain
 * assertion into a test of the replay cache.
 */
let keySeq = 0;

async function post(
  ctx: Ctx,
  path: string,
  payload: unknown,
): Promise<{ status: number; body: never }> {
  const r = await fetch(`${ctx.base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `routes-test-${++keySeq}`,
    },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: (await r.json()) as never };
}

/** Provenance every write needs. `observed_by` deliberately absent. */
const PROV = { source_form: 'recall', recorded_by: 'adnan' };

// ---------------------------------------------------------------------------
// Reads, against the fixture herd
// ---------------------------------------------------------------------------

test('GET /animals returns the herd with derived status', async () => {
  const ctx = await serve(cleanHerd());
  const { status, body } = await get(ctx, '/animals');
  assert.equal(status, 200);

  const animals = (body as { animals: Record<string, unknown>[] }).animals;
  assert.ok(animals.length >= 6, 'the fixture herd came through');

  const first = animals[0] as Record<string, unknown>;
  for (const key of ['id', 'name', 'sex', 'origin', 'status', 'parity', 'birth_on', 'event_count']) {
    assert.ok(key in first, `the row carries ${key}`);
  }
  // The awkward cases the fixture exists for must survive serialization.
  const statuses = new Set(animals.map((a) => a.status));
  for (const s of ['lactating', 'dry', 'departed', 'heifer', 'male', 'calf']) {
    assert.ok(statuses.has(s), `${s} is represented`);
  }
  await ctx.close();
});

test('GET /animals on an EMPTY registry returns an empty array, not an error', async () => {
  // The first hour of real entry. It must be a designed state, not a 404.
  const ctx = await serve(freshDb());
  const { status, body } = await get(ctx, '/animals');
  assert.equal(status, 200);
  assert.deepEqual(body, { animals: [] });
  await ctx.close();
});

test('GET /animals/:id returns the animal, its status and its full event list', async () => {
  const ctx = await serve(cleanHerd());
  const { status, body } = await get(ctx, '/animals/BD-0001');
  assert.equal(status, 200);
  const d = body as { animal: { id: string }; status: { status: string }; events: unknown[] };
  assert.equal(d.animal.id, 'BD-0001');
  assert.ok(d.status.status.length > 0);
  assert.ok(d.events.length >= 3);
  await ctx.close();
});

test('GET /animals/:id for an unknown animal is a 404 in the error shape', async () => {
  const ctx = await serve(cleanHerd());
  const { status, body } = await get(ctx, '/animals/BD-9999');
  assert.equal(status, 404);
  assert.deepEqual(body, {
    error: 'unknown_animal',
    field: 'animal_id',
    message: "unknown registry animal 'BD-9999'",
  });
  await ctx.close();
});

test('the event list INCLUDES superseded events, marked with what replaced them', async () => {
  // This view is the only window into whether a correction did what was meant.
  // A filtered-out event is indistinguishable from one never written.
  const db = cleanHerd();
  const ctx = await serve(db);

  // Correct a calving so there is a supersession to look at.
  const calvings = (await get(ctx, '/animals/BD-0002/calvings')).body as {
    calvings: { id: string }[];
  };
  const target = calvings.calvings[0];
  const corrected = await post(ctx, `/calvings/${target.id}/correction`, {
    occurred_on: '2023-06-01',
    date_precision: 'month',
    as_of: AS_OF,
    ...PROV,
  });
  assert.equal(corrected.status, 201);

  const { body } = await get(ctx, '/animals/BD-0002');
  const events = (body as { events: Record<string, unknown>[] }).events;

  const old = events.find((e) => e.id === target.id);
  assert.ok(old, 'the superseded event is STILL LISTED');
  assert.equal(old!.effective, false);
  assert.ok(old!.superseded_by_id, 'and it names its replacement');

  const replacement = events.find((e) => e.id === old!.superseded_by_id);
  assert.ok(replacement, 'the replacement is in the same list');
  assert.equal(replacement!.effective, true);
  assert.equal(replacement!.supersedes_id, target.id, 'the edge points both ways');
  await ctx.close();
});

test('GET /link-candidates includes INELIGIBLE animals with a reason', async () => {
  // Omitting them reads as data loss to the person entering the herd.
  const ctx = await serve(cleanHerd());
  const { status, body } = await get(ctx, '/link-candidates?dam=BD-0001&calf_sex=female');
  assert.equal(status, 200);
  const cands = (body as { candidates: Record<string, unknown>[] }).candidates;

  const herdSize = ((await get(ctx, '/animals')).body as { animals: unknown[] }).animals.length;
  assert.equal(cands.length, herdSize, 'EVERY animal appears, eligible or not');

  const dam = cands.find((c) => c.id === 'BD-0001')!;
  assert.equal(dam.eligible, false);
  assert.match(String(dam.ineligible_reason), /cannot be its own calf/);

  const farmBorn = cands.find((c) => c.origin === 'born_on_farm')!;
  assert.equal(farmBorn.eligible, false);
  assert.match(String(farmBorn.ineligible_reason), /already has a birth event/);

  const male = cands.find((c) => c.sex === 'male' && c.id !== 'BD-0001');
  if (male) {
    assert.equal(male.eligible, false, 'a sex mismatch is predictable, so it is marked');
    assert.match(String(male.ineligible_reason), /but this calving says female/);
  }
  assert.ok(cands.some((c) => c.eligible === true), 'and some are eligible');
  await ctx.close();
});

test('GET /dam-candidates marks a departed animal ineligible', async () => {
  const ctx = await serve(cleanHerd());
  const { body } = await get(ctx, '/dam-candidates');
  const cands = (body as { candidates: Record<string, unknown>[] }).candidates;
  assert.ok(cands.every((c) => c.sex === 'female'), 'only females');
  const departed = cands.find((c) => c.eligible === false);
  assert.ok(departed, 'the departed animal is present');
  assert.match(String(departed!.ineligible_reason), /departed/);
  await ctx.close();
});

test('GET /verification reports zero violations for the fixture herd', async () => {
  const ctx = await serve(cleanHerd());
  const { status, body } = await get(ctx, `/verification?as_of=${AS_OF}`);
  assert.equal(status, 200);
  const v = body as {
    violations: unknown[];
    histogram: unknown[];
    counts: { animals: number };
    intervals: { caveat: string };
  };
  assert.deepEqual(v.violations, [], JSON.stringify(v.violations));
  assert.ok(v.histogram.length > 0, 'the precision histogram survives serialization');
  assert.ok(v.counts.animals > 0);
  assert.match(v.intervals.caveat, /never averaged together/, 'the caveat travels with the numbers');
  await ctx.close();
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

test('POST /animals creates an acquired animal and returns its detail', async () => {
  const ctx = await serve(freshDb());
  const { status, body } = await post(ctx, '/animals', {
    sex: 'female',
    name: 'Noor',
    acquired_on: '2019-01-01',
    date_precision: 'year',
    birth_on: '2017-01-01',
    birth_precision: 'year',
    as_of: AS_OF,
    ...PROV,
  });
  assert.equal(status, 201);
  const r = body as { animal_id: string; animal: { status: { status: string } } };
  assert.equal(r.animal_id, 'BD-0001');
  assert.equal(r.animal.status.status, 'heifer');
  await ctx.close();
});

test('POST /events appends a life event and returns the updated animal', async () => {
  const ctx = await serve(cleanHerd());
  const { status, body } = await post(ctx, '/events', {
    animal_id: 'BD-0001',
    type: 'note',
    occurred_on: '2026-02-01',
    date_precision: 'day',
    text: 'limping on the near hind',
    as_of: AS_OF,
    ...PROV,
  });
  assert.equal(status, 201);
  const r = body as { event_id: string; animal: { events: { id: string }[] } };
  assert.ok(r.event_id.startsWith('aevt_'));
  assert.ok(r.animal.events.some((e) => e.id === r.event_id), 'the new event is in the detail');
  await ctx.close();
});

test('POST /calvings mints a calf and returns both animals', async () => {
  const ctx = await serve(cleanHerd());
  const { status, body } = await post(ctx, '/calvings', {
    dam_id: 'BD-0006',
    occurred_on: '2026-02-01',
    date_precision: 'month',
    calf_sex: 'female',
    outcome: 'live',
    as_of: AS_OF,
    ...PROV,
  });
  // BD-0006 is male in the fixture; this must be refused, which is itself the
  // check that dam validation runs over HTTP.
  assert.equal(status, 400);
  assert.equal((body as { error: string }).error, 'dam_not_female');
  await ctx.close();
});

test('POST /calvings mint mode: a new calf appears in the herd', async () => {
  const ctx = await serve(cleanHerd());
  const before = ((await get(ctx, '/animals')).body as { animals: unknown[] }).animals.length;
  const { status, body } = await post(ctx, '/calvings', {
    dam_id: 'BD-0003',
    occurred_on: '2026-03-01',
    date_precision: 'month',
    calf_sex: 'female',
    outcome: 'live',
    as_of: AS_OF,
    ...PROV,
  });
  assert.equal(status, 201);
  const r = body as { calf_id: string; linked: boolean; dam: unknown; calf: unknown };
  assert.equal(r.linked, false);
  assert.ok(r.dam && r.calf, 'both animals come back');
  const after = ((await get(ctx, '/animals')).body as { animals: unknown[] }).animals.length;
  assert.equal(after, before + 1);
  await ctx.close();
});

test('POST /calvings link mode attaches to an existing animal and mints nothing', async () => {
  const ctx = await serve(cleanHerd());
  const before = ((await get(ctx, '/animals')).body as { animals: unknown[] }).animals.length;

  // BD-0005 was acquired in the fixture and has a recent calving of her own,
  // so use the eligible-candidates list rather than guessing.
  // Ask WITH the proposed date. Without it the list cannot apply the timeline
  // rule and would offer animals the server then refuses -- which is exactly
  // what this test caught the first time it ran.
  const cands = ((await get(
    ctx,
    '/link-candidates?dam=BD-0003&calf_sex=female&occurred_on=2026-03-01&date_precision=month',
  )).body as {
    candidates: { id: string; eligible: boolean }[];
  }).candidates.filter((c) => c.eligible);
  assert.ok(cands.length > 0, 'the fixture has a linkable animal');

  const { status, body } = await post(ctx, '/calvings', {
    dam_id: 'BD-0003',
    calf_id: cands[0].id,
    occurred_on: '2026-03-01',
    date_precision: 'month',
    calf_sex: 'female',
    outcome: 'live',
    as_of: AS_OF,
    ...PROV,
  });
  assert.equal(status, 201);
  const r = body as { linked: boolean; calf_id: string; superseded_origin_event_id: string };
  assert.equal(r.linked, true);
  assert.equal(r.calf_id, cands[0].id);
  assert.ok(r.superseded_origin_event_id, 'the acquired origin was superseded');
  assert.equal(
    ((await get(ctx, '/animals')).body as { animals: unknown[] }).animals.length,
    before,
    'no animal was minted',
  );
  await ctx.close();
});

test('POST /calvings/:id/correction writes the paired correction', async () => {
  const ctx = await serve(cleanHerd());
  const calvings = ((await get(ctx, '/animals/BD-0002/calvings')).body as {
    calvings: { id: string }[];
  }).calvings;
  const { status, body } = await post(ctx, `/calvings/${calvings[0].id}/correction`, {
    occurred_on: '2023-06-01',
    date_precision: 'month',
    as_of: AS_OF,
    ...PROV,
  });
  assert.equal(status, 201);
  const r = body as {
    superseded: { calving_event_id: string; birth_event_id: string };
    calving_event_id: string;
  };
  assert.equal(r.superseded.calving_event_id, calvings[0].id);
  assert.ok(r.superseded.birth_event_id, 'the birth half was superseded too');
  await ctx.close();
});

test('the registry stays consistent after a full HTTP write sequence', async () => {
  const ctx = await serve(freshDb());
  const dam = (await post(ctx, '/animals', {
    sex: 'female', acquired_on: '2018-01-01', date_precision: 'year',
    birth_on: '2016-01-01', birth_precision: 'year', as_of: AS_OF, ...PROV,
  })).body as { animal_id: string };

  await post(ctx, '/calvings', {
    dam_id: dam.animal_id, occurred_on: '2023-04-01', date_precision: 'month',
    calf_sex: 'female', outcome: 'live', as_of: AS_OF, ...PROV,
  });
  await post(ctx, '/events', {
    animal_id: dam.animal_id, type: 'dry_off', occurred_on: '2024-01-01',
    date_precision: 'month', as_of: AS_OF, ...PROV,
  });

  const v = (await get(ctx, `/verification?as_of=${AS_OF}`)).body as { violations: unknown[] };
  assert.deepEqual(v.violations, [], JSON.stringify(v.violations));
  await ctx.close();
});

// ---------------------------------------------------------------------------
// THE CONTRACT THE FORMS ARE BUILT ON
// ---------------------------------------------------------------------------

test('END TO END: a bad precision over HTTP returns { error, field, message } intact', async () => {
  // The single most important assertion in this file. A month-precision date
  // stored mid-month is the exact mistake precision-before-date exists to make
  // impossible in the form -- and this is the server-side proof that if any
  // client submits it anyway, the refusal arrives in the shape the form binds
  // to, with the prose unrewritten and the field naming a DOMAIN COLUMN.
  const ctx = await serve(cleanHerd());
  const { status, body } = await post(ctx, '/events', {
    animal_id: 'BD-0001',
    type: 'note',
    occurred_on: '2024-03-14',
    date_precision: 'month',
    text: 'x',
    as_of: AS_OF,
    ...PROV,
  });

  assert.equal(status, 400, 'a domain refusal, not a 500');

  const e = body as { error: string; field: string; message: string };
  assert.equal(e.error, 'invalid_precision', 'a stable code to branch on');
  assert.equal(e.field, 'occurred_on', 'naming a domain column, not a form control id');
  assert.equal(
    e.message,
    "month precision must be stored as the 1st of the month, got '2024-03-14'. " +
      'A month row dated mid-month means a known date was silently downgraded.',
    'the prose arrives VERBATIM -- not rephrased, not truncated',
  );
  assert.deepEqual(Object.keys(body as object).sort(), ['error', 'field', 'message']);

  // And nothing was written.
  const detail = (await get(ctx, '/animals/BD-0001')).body as { events: unknown[] };
  assert.ok(!JSON.stringify(detail.events).includes('2024-03-14'));
  await ctx.close();
});

test('a missing precision is refused over HTTP, never defaulted', async () => {
  const ctx = await serve(cleanHerd());
  const { status, body } = await post(ctx, '/events', {
    animal_id: 'BD-0001', type: 'note', occurred_on: '2024-03-14', text: 'x', ...PROV,
  });
  assert.equal(status, 400);
  const e = body as { error: string; field: string; message: string };
  assert.equal(e.error, 'precision_not_defaulted');
  assert.equal(e.field, 'date_precision');
  assert.match(e.message, /never defaulted/);
  await ctx.close();
});

test('estimated with a fabricated day is refused over HTTP', async () => {
  const ctx = await serve(freshDb());
  const { status, body } = await post(ctx, '/animals', {
    sex: 'female', acquired_on: '2019-04-12', date_precision: 'estimated', ...PROV,
  });
  assert.equal(status, 400);
  const e = body as { field: string; message: string };
  assert.equal(e.field, 'occurred_on');
  assert.match(e.message, /fabricated day wearing a humility label/);
  await ctx.close();
});

test('every domain refusal serializes with a code, and most with a field', async () => {
  // The serialization trap this file exists for: JSON.stringify on an Error
  // subclass yields {} unless something converts it. One missing toWire() and
  // every form would receive an empty object.
  const ctx = await serve(cleanHerd());
  const cases: [string, unknown][] = [
    ['/events', { animal_id: 'BD-9999', type: 'note', occurred_on: '2026-01-01', date_precision: 'day', text: 'x', ...PROV }],
    ['/events', { animal_id: 'BD-0001', type: 'departure', occurred_on: '2026-01-01', date_precision: 'day', ...PROV }],
    ['/events', { animal_id: 'BD-0001', type: 'calving', occurred_on: '2026-01-01', date_precision: 'day', ...PROV }],
    ['/animals', { sex: 'female', acquired_on: '2019-01-01', date_precision: 'year', birth_on: '2021-04-12', ...PROV }],
    ['/animals', { sex: 'wombat', acquired_on: '2019-01-01', date_precision: 'year', ...PROV }],
    ['/calvings', { dam_id: 'BD-9999', occurred_on: '2026-01-01', date_precision: 'day', calf_sex: 'female', outcome: 'live', ...PROV }],
  ];
  for (const [path, payload] of cases) {
    const { status, body } = await post(ctx, path, payload);
    assert.equal(status, 400, `${path} ${JSON.stringify(payload).slice(0, 60)}`);
    const e = body as { error?: string; field?: string; message?: string };
    assert.ok(e.error && e.error.length > 0, `has a code: ${JSON.stringify(e)}`);
    assert.ok(e.message && e.message.length > 0, `has prose: ${JSON.stringify(e)}`);
    assert.ok(e.field && e.field.length > 0, `has a field: ${JSON.stringify(e)}`);
  }
  await ctx.close();
});

test('provenance is required over HTTP, and observed_by is never defaulted', async () => {
  const ctx = await serve(freshDb());

  const noForm = await post(ctx, '/animals', {
    sex: 'female', acquired_on: '2019-01-01', date_precision: 'year', recorded_by: 'adnan',
  });
  assert.equal(noForm.status, 400);
  assert.equal((noForm.body as { field: string }).field, 'source_form');

  const noWho = await post(ctx, '/animals', {
    sex: 'female', acquired_on: '2019-01-01', date_precision: 'year', source_form: 'recall',
  });
  assert.equal(noWho.status, 400);
  assert.equal((noWho.body as { field: string }).field, 'recorded_by');

  // Given both but no observed_by, the column stays NULL -- leaving it blank is
  // the cheap path; asserting a witness takes a deliberate act.
  const ok = await post(ctx, '/animals', {
    sex: 'female', acquired_on: '2019-01-01', date_precision: 'year', as_of: AS_OF, ...PROV,
  });
  assert.equal(ok.status, 201);
  const detail = (await get(ctx, `/animals/${(ok.body as { animal_id: string }).animal_id}`))
    .body as { events: { observed_by: string | null }[] };
  assert.equal(detail.events[0].observed_by, null, 'observed_by was not filled in for us');
  await ctx.close();
});

test('a malformed body is a 400, not a 500', async () => {
  // Raw fetch rather than post(), because the body is deliberately not an
  // object. The key still has to be here: the replay check runs BEFORE payload
  // validation, so without it this would assert on the wrong refusal.
  const ctx = await serve(cleanHerd());
  const r = await fetch(`${ctx.base}/animals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'routes-test-malformed' },
    body: JSON.stringify(['not', 'an', 'object']),
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json() as { error: string }).error, 'invalid_payload');
  await ctx.close();
});

// ---------------------------------------------------------------------------
// The harness banner
// ---------------------------------------------------------------------------

test('GET /api/harness says plainly that this is not dairy.db', async () => {
  const ctx = await serve(cleanHerd());
  const r = await fetch(`${ctx.base.replace('/api/registry', '')}/api/harness`);
  const b = (await r.json()) as { harness: boolean; storage: string; warning: string };
  assert.equal(b.harness, true);
  assert.equal(b.storage, ':memory:');
  assert.match(b.warning, /NOT dairy\.db/);
  await ctx.close();
});

// GET /storage is on the SHARED router, so the real server answers it too --
// that is what makes "which database am I writing to" a positive fact in both
// directions rather than an absence the client has to interpret. This suite is
// :memory: only and writes nothing to disk, so the file-backed answer is not
// asserted here; `db.name` returns the absolute path and `db.memory` is false
// for a file handle (measured against better-sqlite3 directly).
test('GET /storage names the database this router writes to', async () => {
  const ctx = await serve(cleanHerd());
  const r = await fetch(`${ctx.base}/storage`);
  assert.equal(r.status, 200);
  const b = (await r.json()) as { storage: string; memory: boolean };
  assert.equal(b.storage, ':memory:');
  assert.equal(b.memory, true);
  await ctx.close();
});

// ---------------------------------------------------------------------------
// The documented route table matches the router
// ---------------------------------------------------------------------------

test('REGISTRY.md § HTTP surface lists exactly the routes the router mounts', () => {
  // A route table in prose beside a route table in code is a second copy, and
  // this repo has already paid for one: routes.ts carried a prose enumeration of
  // its keyed writes that went stale three times before it was deleted
  // (docs/records/REGISTRY_PAYROLL.md §16.4).
  //
  // The table in docs/reference/registry/http-api.md is worth keeping -- it is the only place a reader
  // can see the whole surface at once, with a sentence on each route -- so it is
  // CHECKED instead of trusted. Adding a route now fails this test until the
  // table names it, which is the cheapest possible moment to write the sentence.
  //
  // Source text, not a live server, for invariant 13's reason: it must fail in
  // CI with no database and no port.
  const doc = readFileSync(
    path.join(__dirname, '..', '..', '..', 'docs', 'reference', 'registry', 'http-api.md'),
    'utf8',
  );
  const src = readFileSync(path.join(__dirname, 'routes.ts'), 'utf8');

  const documented = new Set(
    [...doc.matchAll(/^\| (GET|POST) \| `([^`]+)`/gm)].map(
      (m) => `${m[1]} ${m[2].split('?')[0]}`,
    ),
  );
  // Inspect the router without binding a port; this covers generated routes too.
  const db = freshDb();
  const stack = registryRouter(db).stack as {route?: {path:string;methods:Record<string,boolean>}}[];
  const mounted = new Set(stack.flatMap(layer => layer.route ? Object.keys(layer.route.methods).map(method=>`${method.toUpperCase()} ${layer.route!.path}`) : []));
  db.close();

  assert.ok(mounted.size > 0, 'the matcher found no routes at all -- update it');

  const undocumented = [...mounted].filter((r) => !documented.has(r)).sort();
  const phantom = [...documented].filter((r) => !mounted.has(r)).sort();

  assert.deepEqual(
    undocumented,
    [],
    'these routes are mounted and absent from docs/records/REGISTRY.md § HTTP surface',
  );
  assert.deepEqual(
    phantom,
    [],
    'REGISTRY.md § HTTP surface documents these routes and the router does not mount them',
  );
});

// ---------------------------------------------------------------------------
// Breeding stage 1: the reproduction field, always on since stage 5
// ---------------------------------------------------------------------------

test('the animal response always has the four breeding keys', async () => {
  const ctx = await serve(cleanHerd());
  const { body } = (await get(ctx, '/animals/BD-0001')) as { body: Record<string, unknown> };
  for (const k of ['reproduction', 'reproduction_notes', 'breeding_tasks', 'breeding_entry']) {
    assert.ok(Object.prototype.hasOwnProperty.call(body, k), k);
  }
});

test('no breeding events: reproduction is null', async () => {
  const ctx = await serve(cleanHerd());
  const { body } = (await get(ctx, '/animals/BD-0001')) as { body: { reproduction: unknown } };
  assert.equal(body.reproduction, null);
  assert.ok(Object.prototype.hasOwnProperty.call(body, 'reproduction'), 'the reproduction key is present');
});

test('a served, confirmed animal carries her state', async () => {
  const db = cleanHerd();
  const female = herd(db).find((a) => a.sex === 'female' && a.status !== 'departed')!.id;
  recordBreedingEvent(db, { animal_id: female, type: 'insemination', occurred_on: '2026-07-14', date_precision: 'day', payload: { service_type: 'ai' }, provenance: RECALL, allow_no_heat_sign: true });
  recordBreedingEvent(db, { animal_id: female, type: 'pregnancy_check', occurred_on: '2026-09-15', date_precision: 'day', payload: { method: 'palpation', result: 'positive' }, provenance: RECALL });
  const ctx = await serve(db);
  const { body } = (await get(ctx, `/animals/${female}?as_of=2026-11-13`)) as { body: { reproduction: { state: string; day_max: number } } };
  assert.equal(body.reproduction.day_max, 122);
  assert.ok(['confirmed', 'dryoff'].includes(body.reproduction.state), `state ${body.reproduction.state}`); // depends on whether the fixture animal is in milk
});

test('a departed animal has no reproduction view', async () => {
  const db = cleanHerd();
  const female = herd(db).find((a) => a.sex === 'female' && a.status !== 'departed')!.id;
  recordBreedingEvent(db, { animal_id: female, type: 'insemination', occurred_on: '2026-07-14', date_precision: 'day', payload: { service_type: 'ai' }, provenance: RECALL, allow_no_heat_sign: true });
  addDeparture(db, { animal_id: female, on: '2026-10-01', precision: 'day' });
  rebuild(db, { asOf: '2026-11-13' });
  const ctx = await serve(db);
  const { body } = (await get(ctx, `/animals/${female}`)) as { body: { reproduction: unknown } };
  assert.equal(body.reproduction, null);
  assert.ok(Object.prototype.hasOwnProperty.call(body, 'reproduction'), 'the reproduction key is present');
});

// Review Focus 1 at the API: BD-0001 calved 2024-06-02 and was never dried off, so
// she is in milk. Served 2026-01-20 and confirmed by palpation 2026-03-10 (day 49), she is at day 251 on
// 2026-09-28: inside the dry-off lead (248) and before close-up (264).
function servedAndConfirmed(): Db {
  const db = cleanHerd();
  recordBreedingEvent(db, { animal_id: 'BD-0001', type: 'insemination', occurred_on: '2026-01-20', date_precision: 'day', payload: { service_type: 'ai' }, provenance: RECALL, allow_no_heat_sign: true });
  recordBreedingEvent(db, { animal_id: 'BD-0001', type: 'pregnancy_check', occurred_on: '2026-03-10', date_precision: 'day', payload: { method: 'palpation', result: 'positive' }, provenance: RECALL });
  return db;
}

test('a dry-off dated after as_of does not change the state on as_of', async () => {
  const before = await serve(servedAndConfirmed());
  const was = (await get(before, '/animals/BD-0001?as_of=2026-09-28')) as { body: { reproduction: { state: string } | null } };
  assert.equal(was.body.reproduction?.state, 'dryoff');

  const db = servedAndConfirmed();
  addDryOff(db, { animal_id: 'BD-0001', on: '2026-09-29', precision: 'day' });
  rebuild(db, { asOf: '2026-11-13' });
  const after = await serve(db);
  const still = (await get(after, '/animals/BD-0001?as_of=2026-09-28')) as { body: { reproduction: { state: string } | null } };
  assert.equal(still.body.reproduction?.state, 'dryoff', 'a dry-off dated the day after as_of is invisible on as_of');
});

test('a departure dated after as_of does not null a past-dated view', async () => {
  const db = servedAndConfirmed();
  addDeparture(db, { animal_id: 'BD-0001', on: '2026-10-01', precision: 'day' });
  rebuild(db, { asOf: '2026-11-13' });
  const ctx = await serve(db);
  const past = (await get(ctx, '/animals/BD-0001?as_of=2026-09-28')) as { body: { reproduction: { state: string } | null } };
  assert.equal(past.body.reproduction?.state, 'dryoff', 'she had not left on 2026-09-28');
  const gone = (await get(ctx, '/animals/BD-0001?as_of=2026-10-01')) as { body: { reproduction: unknown } };
  assert.equal(gone.body.reproduction, null);
  assert.ok(Object.prototype.hasOwnProperty.call(gone.body, 'reproduction'), 'the reproduction key is present');
});

test('an unparseable as_of is refused', async () => {
  const on = await serve(cleanHerd());
  const bad = await get(on, '/animals/BD-0001?as_of=not-a-date');
  assert.equal(bad.status, 400);
  assert.deepEqual(
    [(bad.body as { error: string }).error, (bad.body as { field: string }).field],
    ['invalid_payload', 'as_of'],
  );
});

// ---------------------------------------------------------------------------
// Breeding stage 2: POST /breeding/events, open for every current female since stage 5
// ---------------------------------------------------------------------------

const SVC = { type: 'insemination', occurred_on: '2026-11-13', date_precision: 'day', payload: { service_type: 'ai', exposure_days: null }, allow_no_heat_sign: true, ...PROV };

async function breedingCtx(): Promise<Ctx> {
  return serve(breedingHerd());
}

test('a service for a female is written and the page gets her detail back', async () => {
  const ctx = await breedingCtx();
  const r = (await post(ctx, '/breeding/events', { animal_id: 'BD-0009', ...SVC })) as { status: number; body: { event_id: string; animal: { breeding_entry: boolean } } };
  assert.equal(r.status, 201);
  assert.ok(r.body.event_id);
  assert.equal(r.body.animal.breeding_entry, true);
  const g = (await get(ctx, '/animals/BD-0009?as_of=2026-11-13')) as { body: { reproduction: { state: string } } };
  assert.equal(g.body.reproduction.state, 'bred');
});

test('the same Idempotency-Key writes once', async () => {
  const ctx = await breedingCtx();
  const count = () => (ctx.db.prepare(`SELECT COUNT(*) n FROM registry_animal_events WHERE animal_id = 'BD-0009'`).get() as { n: number }).n;
  const before = count();
  const send = async () => {
    const r = await fetch(`${ctx.base}/breeding/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'breeding-once' },
      body: JSON.stringify({ animal_id: 'BD-0009', ...SVC }),
    });
    return (await r.json()) as { event_id: string };
  };
  const a = await send();
  const b = await send();
  assert.equal(a.event_id, b.event_id);
  assert.equal(count(), before + 1);
});

test('a current female outside the old pilot list is written', async () => {
  const ctx = await breedingCtx();
  // BD-0006 (Moti) was served on 2026-09-02 and not checked, so a second service is ambiguous: saved over.
  const r = (await post(ctx, '/breeding/events', { animal_id: 'BD-0006', ...SVC, allow_ambiguous_service: true })) as { status: number; body: { event_id: string; animal: { breeding_entry: boolean } } };
  assert.equal(r.status, 201);
  assert.ok(r.body.event_id);
  assert.equal(r.body.animal.breeding_entry, true);
});

/** A male calf in the breeding herd (the calves are all male). */
function maleIn(db: Db): string {
  return herd(db).find((a) => a.sex === 'male')!.id;
}

test('a male is refused as in stage 1', async () => {
  const ctx = await breedingCtx();
  const male = maleIn(ctx.db);
  const r = await post(ctx, '/breeding/events', { animal_id: male, ...SVC });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, {
    error: 'not_female',
    message: `animal '${male}' is male; a breeding event is recorded against the female`,
    field: 'animal_id',
  });
});

test('an unknown animal is refused unknown_animal', async () => {
  const ctx = await breedingCtx();
  const r = await post(ctx, '/breeding/events', { animal_id: 'BD-9999', ...SVC });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'unknown_animal', message: `unknown registry animal 'BD-9999'`, field: 'animal_id' });
});

test('a departed female is refused as in stage 1', async () => {
  const db = breedingHerd();
  addDeparture(db, { animal_id: 'BD-0006', on: '2026-11-01', precision: 'day' });
  rebuild(db, { asOf: '2026-11-13' });
  const ctx = await serve(db);
  const r = await post(ctx, '/breeding/events', { animal_id: 'BD-0006', ...SVC });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, {
    error: 'animal_departed',
    message: `animal 'BD-0006' departed on 2026-11-01; a 'insemination' dated 2026-11-13 did not happen on this farm`,
    field: 'occurred_on',
  });
});

test('a type the page does not enter is refused', async () => {
  const ctx = await breedingCtx();
  const r = await post(ctx, '/breeding/events', { animal_id: 'BD-0007', type: 'calving', occurred_on: '2026-11-13', date_precision: 'day', payload: {}, ...PROV });
  assert.equal(r.status, 400);
  assert.equal((r.body as { error: string }).error, 'breeding_entry_closed');
  assert.equal((r.body as { field: string }).field, 'type');
  assert.equal((r.body as { message: string }).message, 'calving is not entered on the page yet; a service, a heat, a pregnancy check, "nothing seen" or a loss is');
});

test('a loss for a female is written and she reads as lost, observed', async () => {
  const ctx = await breedingCtx();
  const r = await post(ctx, '/breeding/events', { animal_id: 'BD-0009', type: 'abortion', occurred_on: '2026-11-13', date_precision: 'day', payload: {}, ...PROV });
  assert.equal(r.status, 201);
  const g = (await get(ctx, '/animals/BD-0009?as_of=2026-11-13')) as { body: { reproduction: { state: string; basis: string } } };
  assert.deepEqual([g.body.reproduction.state, g.body.reproduction.basis], ['lost', 'observed']);
});

test('a loss for a current female outside the old pilot list is written', async () => {
  const ctx = await breedingCtx();
  const r = await post(ctx, '/breeding/events', { animal_id: 'BD-0006', type: 'abortion', occurred_on: '2026-11-13', date_precision: 'day', payload: {}, ...PROV });
  assert.equal(r.status, 201);
});

test('a heat for a female is written', async () => {
  const ctx = await breedingCtx();
  const r = await post(ctx, '/breeding/events', { animal_id: 'BD-0007', type: 'heat_observed', occurred_on: '2026-11-13', occurred_time: '06:30', date_precision: 'day', payload: { sign: 'standing' }, ...PROV });
  assert.equal(r.status, 201);
  const { body } = (await get(ctx, '/animals/BD-0007')) as { body: { events: { type: string; occurred_on: string; occurred_time: string | null }[] } };
  const h = body.events.find((e) => e.type === 'heat_observed')!;
  assert.equal(h.occurred_on, '2026-11-13');
  assert.equal(h.occurred_time, '06:30');
});

test('"nothing seen" for a female is written', async () => {
  const ctx = await breedingCtx();
  const r = await post(ctx, '/breeding/events', { animal_id: 'BD-0009', type: 'null_observation', occurred_on: '2026-11-13', date_precision: 'day', payload: { watched_for: 'heat' }, ...PROV });
  assert.equal(r.status, 201);
  const { body } = (await get(ctx, '/animals/BD-0009?as_of=2026-11-13')) as { body: { events: { type: string }[] } };
  assert.equal(body.events.filter((e) => e.type === 'null_observation').length, 1);
});

test('a service that is ambiguous and has no heat sign gives two warnings, and both flags save it', async () => {
  const ctx = await breedingCtx();
  // BD-0007 was served on 2026-10-09 and not checked: a second service 35 days on is ambiguous, with no heat before it.
  const svc = { animal_id: 'BD-0007', type: 'insemination', occurred_on: '2026-11-13', date_precision: 'day', payload: { service_type: 'ai', exposure_days: null }, ...PROV };
  const refused = (await post(ctx, '/breeding/events', svc)) as { status: number; body: { error: string; warnings: { check: string; message: string }[] } };
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'breeding_warnings');
  assert.equal(refused.body.warnings.length, 2);
  assert.deepEqual(refused.body.warnings.map((w) => w.check).sort(), ['ambiguous_service', 'no_heat_sign']);
  const saved = (await post(ctx, '/breeding/events', { ...svc, allow_ambiguous_service: true, allow_no_heat_sign: true })) as { status: number };
  assert.equal(saved.status, 201);
});

test('a warning comes back as a 400 with its code, and the flag saves over it', async () => {
  const ctx = await breedingCtx();
  const chk = { animal_id: 'BD-0007', type: 'pregnancy_check', occurred_on: '2026-11-13', date_precision: 'day', payload: { method: 'palpation', result: 'positive' }, ...PROV };
  const warned = await post(ctx, '/breeding/events', chk);
  assert.equal(warned.status, 400);
  const wb = warned.body as { error: string; field: string; message: string };
  assert.equal(wb.error, 'early_check');
  assert.equal(wb.field, 'occurred_on');
  assert.equal(wb.message, 'A check by hand is not relied on before day 46. This one is on day 35.');
  const saved = await post(ctx, '/breeding/events', { ...chk, allow_early_check: true });
  assert.equal(saved.status, 201);
});

test('breeding_entry is true for a current female, false for a male and a departed female', async () => {
  const db = breedingHerd();
  addDeparture(db, { animal_id: 'BD-0008', on: '2026-11-01', precision: 'day' });
  rebuild(db, { asOf: '2026-11-13' });
  const ctx = await serve(db);
  const entry = async (id: string) => ((await get(ctx, `/animals/${id}`)) as { body: { breeding_entry: boolean } }).body.breeding_entry;
  assert.equal(await entry('BD-0006'), true);
  assert.equal(await entry(maleIn(db)), false);
  assert.equal(await entry('BD-0008'), false);
});

test('a service with no heat sign is refused over HTTP until its flag is sent', async () => {
  const ctx = await breedingCtx();
  const svc = { animal_id: 'BD-0009', type: 'insemination', occurred_on: '2026-11-13', date_precision: 'day', payload: { service_type: 'ai', exposure_days: null }, ...PROV };
  const refused = (await post(ctx, '/breeding/events', svc)) as { status: number; body: { error: string; field: string; message: string; warnings: { check: string; message: string }[] } };
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'no_heat_sign');
  assert.deepEqual(refused.body.warnings, [{ check: 'no_heat_sign', message: refused.body.message }]);
  const saved = (await post(ctx, '/breeding/events', { ...svc, allow_no_heat_sign: true })) as { status: number; body: { event_id: string } };
  assert.equal(saved.status, 201);
  const { body } = (await get(ctx, '/animals/BD-0009')) as { body: { events: { id: string; override_checks: string[] }[] } };
  assert.deepEqual(body.events.find((e) => e.id === saved.body.event_id)!.override_checks, ['no_heat_sign']);
  await ctx.close();
});

test('the timeline carries a breeding save-over', async () => {
  const ctx = await breedingCtx();
  const r = await post(ctx, '/breeding/events', {
    animal_id: 'BD-0007', type: 'pregnancy_check', occurred_on: '2026-11-13', date_precision: 'day',
    payload: { method: 'palpation', result: 'positive' },
    allow_early_check: true, override_reason: 'vet was here anyway', ...PROV,
  });
  assert.equal(r.status, 201);
  const { body } = (await get(ctx, '/animals/BD-0007')) as {
    body: { events: { type: string; occurred_on: string; override_checks: string[]; override_reason: string | null }[] };
  };
  // The fixture's own service was saved over no_heat_sign (it is a past record); the new check is the other override.
  const fixtureService = body.events.find((e) => e.type === 'insemination')!;
  assert.deepEqual(fixtureService.override_checks, ['no_heat_sign']);
  const over = body.events.filter((e) => e.override_checks.length > 0 && e !== fixtureService);
  assert.equal(over.length, 1, 'exactly one other event carries an override');
  assert.equal(over[0].type, 'pregnancy_check');
  assert.equal(over[0].occurred_on, '2026-11-13');
  assert.deepEqual(over[0].override_checks, ['early_check']);
  assert.ok(!('override_check' in over[0]), 'the single-column field is gone from the wire');
  assert.equal(over[0].override_reason, 'vet was here anyway');
  for (const e of body.events.filter((x) => x !== over[0] && x !== fixtureService)) {
    assert.deepEqual(e.override_checks, []);
    assert.equal(e.override_reason, null);
  }
  await ctx.close();
});

test('the timeline carries a calving save-over', async () => {
  const ctx = await serve(cleanHerd());
  const calve = (extra: Record<string, unknown>) =>
    post(ctx, '/calvings', {
      dam_id: 'BD-0003', occurred_on: '2026-03-01', date_precision: 'day',
      calf_sex: 'female', outcome: 'live', as_of: AS_OF, ...PROV, ...extra,
    });
  assert.equal((await calve({})).status, 201);
  const warned = await calve({ occurred_on: '2026-03-20' });
  assert.equal(warned.status, 400);
  assert.equal((warned.body as { error: string }).error, 'near_duplicate_calving');
  const saved = await calve({ occurred_on: '2026-03-20', allow_near_duplicate: true, override_reason: 'twins, entered twice' });
  assert.equal(saved.status, 201);
  const { body } = (await get(ctx, '/animals/BD-0003')) as {
    body: { events: { type: string; occurred_on: string; override_checks: string[]; override_reason: string | null }[] };
  };
  const calvings = body.events.filter((e) => e.type === 'calving' && e.occurred_on.startsWith('2026-03'));
  const over = calvings.find((e) => e.occurred_on === '2026-03-20')!;
  assert.deepEqual(over.override_checks, ['near_duplicate_calving']);
  assert.ok(!('override_check' in over), 'the single-column field is gone from the wire');
  assert.equal(over.override_reason, 'twins, entered twice');
  await ctx.close();
});

// ---------------------------------------------------------------------------
// Breeding stage 3: the board, Today and the animal detail
// ---------------------------------------------------------------------------

test('GET /breeding/board returns the tasks and cases', async () => {
  const ctx = await breedingCtx();
  const r = (await get(ctx, '/breeding/board?on=2026-11-13')) as { status: number; body: { on: string; tasks: unknown[]; overdue: number; due: number; cases: unknown[] } };
  assert.equal(r.status, 200);
  assert.equal(r.body.on, '2026-11-13');
  assert.ok(r.body.tasks.length > 0);
  assert.equal(r.body.overdue + r.body.due, r.body.tasks.length);
  assert.equal((await get(ctx, '/breeding/board?on=nope')).status, 400);
});

test('GET /breeding/figures answers every figure; a bad period is a 400', async () => {
  const ctx = await breedingCtx();
  const r = (await get(ctx, '/breeding/figures?period=12m&on=2026-11-13')) as { status: number; body: Record<string, unknown> };
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), [
    'animals', 'by_animal', 'calving_interval', 'confirmed_by_day_60', 'days_open', 'from', 'heats_caught',
    'held_to_first_service', 'losses', 'on', 'overdue_now', 'period', 'rough', 'services_per_conception',
  ]);
  assert.equal(r.body.period, '12m');
  assert.equal(r.body.from, '2025-11-14');
  const all = (await get(ctx, '/breeding/figures?period=all&on=2026-11-13')) as { status: number; body: { period: string; from: null } };
  assert.equal(all.status, 200);
  assert.equal(all.body.from, null);
  assert.equal(((await get(ctx, '/breeding/figures')) as { body: { period: string } }).body.period, '12m');
  const bad = (await get(ctx, '/breeding/figures?period=6m')) as { status: number; body: { error: string; field: string } };
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_payload');
  assert.equal(bad.body.field, 'period');
  assert.equal((await get(ctx, '/breeding/figures?on=nope')).status, 400);
});

test('/today always carries the breeding board', async () => {
  const ctx = await breedingCtx();
  const r = (await get(ctx, '/today?on=2026-11-13')) as { body: { breeding: { tasks: unknown[]; on: string } } };
  assert.equal(r.body.breeding.on, '2026-11-13');
  assert.ok(Array.isArray(r.body.breeding.tasks));
});

test('the animal detail carries breeding_tasks and reproduction_notes', async () => {
  const ctx = await breedingCtx();
  const { body } = (await get(ctx, '/animals/BD-0006?as_of=2026-11-13')) as { body: { breeding_tasks: { kind: string; animal_id: string }[]; reproduction_notes: unknown[] } };
  assert.ok(Array.isArray(body.reproduction_notes));
  assert.ok(body.breeding_tasks.length > 0);
  assert.ok(body.breeding_tasks.every((t) => t.animal_id === 'BD-0006'));
});

test('a recorded dry_off event clears the dry_off task on the detail and the board', async () => {
  const db = breedingHerd();
  // BD-0003 is confirmed, in milk, and past day 248 on 2026-11-13.
  const ctx = await serve(db);
  const kinds = async () => {
    const d = (await get(ctx, '/animals/BD-0003?as_of=2026-11-13')) as { body: { breeding_tasks: { kind: string }[] } };
    const b = (await get(ctx, '/breeding/board?on=2026-11-13')) as { body: { tasks: { kind: string; animal_id: string }[] } };
    return { detail: d.body.breeding_tasks.map((t) => t.kind), board: b.body.tasks.filter((t) => t.animal_id === 'BD-0003').map((t) => t.kind) };
  };
  const before = await kinds();
  assert.ok(before.detail.includes('dry_off'));
  assert.ok(before.board.includes('dry_off'));
  addDryOff(db, { animal_id: 'BD-0003', on: '2026-11-10', precision: 'day' });
  rebuild(db, { asOf: '2026-11-13' });
  const after = await kinds();
  assert.ok(!after.detail.includes('dry_off'));
  assert.ok(!after.board.includes('dry_off'));
});


// Stage 4: a calving 280 days after a day-precision AI is before the calving window.
function servedForCalving(): Db {
  const db = freshDb();
  addAcquired(db, { id: 'BD-0001', sex: 'female', acquired_on: '2019-01-01', acquired_precision: 'year' });
  recordBreedingEvent(db, { animal_id: 'BD-0001', type: 'insemination', occurred_on: '2025-01-10', date_precision: 'day', payload: { service_type: 'ai' }, provenance: RECALL, allow_no_heat_sign: true });
  return db;
}
const EARLY_CALVING = { dam_id: 'BD-0001', occurred_on: '2025-10-17', date_precision: 'day', calf_sex: 'female', outcome: 'live', as_of: '2026-11-13', ...PROV };

test('POST /calvings before the window on the default harness herd: 400 with warnings, 201 with the flag', async () => {
  const ctx = await serve(servedForCalving());
  const refused = (await post(ctx, '/calvings', EARLY_CALVING)) as { status: number; body: { error: string; field: string; warnings: { check: string }[] } };
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'calving_before_window');
  assert.equal(refused.body.field, 'occurred_on');
  assert.deepEqual(refused.body.warnings.map((w) => w.check), ['calving_before_window']);
  const saved = (await post(ctx, '/calvings', { ...EARLY_CALVING, allow_calving_before_window: true })) as {
    status: number;
    body: { calving_event_id: string; dam: { events: { id: string; override_checks: string[] }[] } };
  };
  assert.equal(saved.status, 201);
  const row = saved.body.dam.events.find((e) => e.id === saved.body.calving_event_id)!;
  assert.deepEqual(row.override_checks, ['calving_before_window']);
  await ctx.close();
});

test('POST /calvings/:id/correction before the window: 400 with warnings, 201 with the flag', async () => {
  const ctx = await serve(servedForCalving());
  const first = (await post(ctx, '/calvings', { ...EARLY_CALVING, occurred_on: '2025-11-06' })) as { status: number; body: { calving_event_id: string } };
  assert.equal(first.status, 201);
  const fix = { occurred_on: '2025-10-17', date_precision: 'day', as_of: '2026-11-13', ...PROV };
  const refused = (await post(ctx, `/calvings/${first.body.calving_event_id}/correction`, fix)) as { status: number; body: { error: string; warnings: unknown[] } };
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'calving_before_window');
  assert.equal(refused.body.warnings.length, 1);
  const saved = await post(ctx, `/calvings/${first.body.calving_event_id}/correction`, { ...fix, allow_calving_before_window: true });
  assert.equal(saved.status, 201);
  await ctx.close();
});


// ---------------------------------------------------------------------------
// Breeding stage 5: POST /breeding/events with supersedes_id (a correction)
// ---------------------------------------------------------------------------

type EventRow = { id: string; type: string; occurred_on: string; supersedes_id: string | null; superseded_by_id: string | null; override_checks: string[] };
type Detail = { events: EventRow[]; reproduction: { service: { occurred_on: string; event_id: string } | null } & Record<string, unknown> };

async function heerService(ctx: Ctx): Promise<EventRow> {
  const { body } = (await get(ctx, '/animals/BD-0007')) as unknown as { body: Detail };
  return body.events.find((e) => e.type === 'insemination')!;
}
const SERVICE_PAYLOAD = { service_type: 'ai', exposure_days: null };
const correction = (id: string, on: string, extra: object = {}) =>
  ({ animal_id: 'BD-0007', type: 'insemination', occurred_on: on, date_precision: 'day', payload: SERVICE_PAYLOAD, supersedes_id: id, ...PROV, ...extra });

test('a service is corrected to the next day: the old row is untouched, the new row supersedes it, her view follows', async () => {
  const ctx = await breedingCtx();
  const old = await heerService(ctx);
  assert.equal(old.occurred_on, '2026-10-09');
  // A heat the day before the corrected date, so the correction trips no warning of its own.
  const heat = await post(ctx, '/breeding/events', { animal_id: 'BD-0007', type: 'heat_observed', occurred_on: '2026-10-09', date_precision: 'day', payload: { sign: 'standing' }, ...PROV });
  assert.equal(heat.status, 201);
  const r = (await post(ctx, '/breeding/events', correction(old.id, '2026-10-10'))) as { status: number; body: { event_id: string } };
  assert.equal(r.status, 201);
  const { body } = (await get(ctx, '/animals/BD-0007')) as unknown as { body: Detail };
  const was = body.events.find((e) => e.id === old.id)!;
  assert.equal(was.occurred_on, '2026-10-09');
  assert.equal(was.supersedes_id, null);
  assert.equal(was.superseded_by_id, r.body.event_id);
  const now = body.events.find((e) => e.id === r.body.event_id)!;
  assert.equal(now.supersedes_id, old.id);
  assert.equal(now.occurred_on, '2026-10-10');
  assert.equal(body.reproduction.service!.occurred_on, '2026-10-10');
  assert.equal(body.reproduction.service!.event_id, r.body.event_id);
  await ctx.close();
});

test('a correction to a date with no heat sign is refused, and saves over it with its flag', async () => {
  const ctx = await breedingCtx();
  const old = await heerService(ctx);
  const refused = (await post(ctx, '/breeding/events', correction(old.id, '2026-10-10'))) as { status: number; body: { error: string; warnings: { check: string }[] } };
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'no_heat_sign');
  // The superseded service is left out of her record, so it is not counted as an earlier service in the case.
  assert.deepEqual(refused.body.warnings.map((w) => w.check), ['no_heat_sign']);
  const saved = (await post(ctx, '/breeding/events', correction(old.id, '2026-10-10', { allow_no_heat_sign: true }))) as { status: number; body: { event_id: string } };
  assert.equal(saved.status, 201);
  const { body } = (await get(ctx, '/animals/BD-0007')) as unknown as { body: Detail };
  assert.deepEqual(body.events.find((e) => e.id === saved.body.event_id)!.override_checks, ['no_heat_sign']);
  await ctx.close();
});

test('a correction is refused on supersedes_id when the event is already superseded, is another type, or is another animal\'s', async () => {
  const ctx = await breedingCtx();
  const old = await heerService(ctx);
  const first = (await post(ctx, '/breeding/events', correction(old.id, '2026-10-10', { allow_no_heat_sign: true }))) as { status: number };
  assert.equal(first.status, 201);
  const again = (await post(ctx, '/breeding/events', correction(old.id, '2026-10-11', { allow_no_heat_sign: true }))) as { status: number; body: { error: string; field: string } };
  assert.equal(again.status, 400);
  assert.deepEqual([again.body.error, again.body.field], ['already_superseded', 'supersedes_id']);

  // A service cannot be replaced by a check.
  const wrongType = (await post(ctx, '/breeding/events', { animal_id: 'BD-0007', type: 'pregnancy_check', occurred_on: '2026-11-13', date_precision: 'day', payload: { method: 'palpation', result: 'positive' }, supersedes_id: old.id, allow_early_check: true, ...PROV })) as { status: number; body: { error: string; field: string } };
  assert.equal(wrongType.status, 400);
  assert.deepEqual([wrongType.body.error, wrongType.body.field], ['supersede_type_mismatch', 'supersedes_id']);

  // BD-0006's service cannot be corrected from BD-0007.
  const { body: moti } = (await get(ctx, '/animals/BD-0006')) as unknown as { body: Detail };
  const other = moti.events.find((e) => e.type === 'insemination')!;
  const elsewhere = (await post(ctx, '/breeding/events', correction(other.id, '2026-10-10', { allow_no_heat_sign: true }))) as { status: number; body: { error: string; field: string } };
  assert.equal(elsewhere.status, 400);
  assert.deepEqual([elsewhere.body.error, elsewhere.body.field], ['unknown_event', 'supersedes_id']);
  await ctx.close();
});

test('supersedes_id that is not a non-empty string is refused as invalid_payload on supersedes_id', async () => {
  const ctx = await breedingCtx();
  for (const bad of [7, '', ['x'], true]) {
    const r = (await post(ctx, '/breeding/events', correction('x', '2026-10-10', { supersedes_id: bad, allow_no_heat_sign: true }))) as { status: number; body: { error: string; field: string } };
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.deepEqual([r.body.error, r.body.field], ['invalid_payload', 'supersedes_id'], JSON.stringify(bad));
  }
  await ctx.close();
});
