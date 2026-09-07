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
import { cleanHerd, freshDb } from './fixtures';
import type { Db } from './schema';

const AS_OF = '2026-09-01';

interface Ctx {
  base: string;
  db: Db;
  close: () => Promise<void>;
}

const open: Server[] = [];

async function serve(db: Db): Promise<Ctx> {
  const server = harnessApp(db).listen(0);
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
  // (REGISTRY_PAYROLL.md §16.4).
  //
  // The table in REGISTRY.md is worth keeping -- it is the only place a reader
  // can see the whole surface at once, with a sentence on each route -- so it is
  // CHECKED instead of trusted. Adding a route now fails this test until the
  // table names it, which is the cheapest possible moment to write the sentence.
  //
  // Source text, not a live server, for invariant 13's reason: it must fail in
  // CI with no database and no port.
  const doc = readFileSync(
    path.join(__dirname, '..', '..', '..', 'docs', 'REGISTRY.md'),
    'utf8',
  );
  const src = readFileSync(path.join(__dirname, 'routes.ts'), 'utf8');

  const documented = new Set(
    [...doc.matchAll(/^\| (GET|POST) \| `([^`]+)`/gm)].map(
      (m) => `${m[1]} ${m[2].split('?')[0]}`,
    ),
  );
  const mounted = new Set(
    [...src.matchAll(/router\.(get|post)\(\s*'([^']+)'/g)].map(
      (m) => `${m[1].toUpperCase()} ${m[2]}`,
    ),
  );

  assert.ok(mounted.size > 0, 'the matcher found no routes at all -- update it');

  const undocumented = [...mounted].filter((r) => !documented.has(r)).sort();
  const phantom = [...documented].filter((r) => !mounted.has(r)).sort();

  assert.deepEqual(
    undocumented,
    [],
    'these routes are mounted and absent from REGISTRY.md § HTTP surface',
  );
  assert.deepEqual(
    phantom,
    [],
    'REGISTRY.md § HTTP surface documents these routes and the router does not mount them',
  );
});
