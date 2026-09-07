// Animal registry -- the labour HTTP surface, over REAL HTTP.
//
// Same reasoning as the sales routes test: calling handlers directly would skip
// JSON body parsing, status codes and error serialization, which is where a new
// route is most likely to be wrong.
//
// What this file adds beyond that: a salary crosses the wire as an INTEGER
// number of paisa plus a period word, and the ways that can go wrong -- a
// rupee figure where paisa belong, a missing period, a benefit array of the
// wrong shape -- all produce a request that still looks reasonable. So the
// refusals are asserted by CODE and by MESSAGE, not merely by "it was a 400".

import assert from 'node:assert';
import { after, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { harnessApp } from './harness';
import { freshDb } from './fixtures';
import type { Db } from './schema';

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

let keySeq = 0;

async function get(ctx: Ctx, path: string) {
  const r = await fetch(`${ctx.base}${path}`);
  return { status: r.status, body: (await r.json()) as never };
}

async function post(ctx: Ctx, path: string, payload: unknown, key?: string) {
  const r = await fetch(`${ctx.base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key ?? `labour-test-${++keySeq}`,
    },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: (await r.json()) as never };
}

async function postNoKey(ctx: Ctx, path: string, payload: unknown) {
  const r = await fetch(`${ctx.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: (await r.json()) as never };
}

const PROV = { source_form: 'direct_entry', recorded_by: 'adnan' };
const RS_25K = 2_500_000;

/** Two salaried staff and one dihari, built THROUGH the routes. */
async function farm() {
  const ctx = await serve(freshDb());

  const person = async (identifier: string, name: string) =>
    (await post(ctx, '/people', { identifier, name, recorded_by: 'adnan' })).body as {
      id: string;
    };
  const imran = await person('imran', 'Imran');
  const abdul = await person('abdul', 'Abdul');
  const rashid = await person('rashid', 'Rashid');

  const engage = async (personId: string, kind: string, role: string | null) =>
    (
      await post(ctx, `/people/${personId}/engagements`, {
        kind,
        role,
        started_on: '2026-01-01',
        recorded_by: 'adnan',
      })
    ).body as { id: string };

  const imranJob = await engage(imran.id, 'permanent', 'milker');
  const abdulJob = await engage(abdul.id, 'permanent', 'general');
  const rashidJob = await engage(rashid.id, 'daily', null);

  await post(ctx, `/engagements/${imranJob.id}/terms`, {
    effective_from: '2026-01-01',
    cash_minor: RS_25K,
    cash_period: 'month',
    benefits: [
      { kind: 'milk', quantity: 2, unit: 'L', period: 'day' },
      { kind: 'flour', quantity: 20, unit: 'kg', period: 'month' },
      { kind: 'accommodation' },
    ],
    recorded_by: 'adnan',
  });
  await post(ctx, `/engagements/${abdulJob.id}/terms`, {
    effective_from: '2026-01-01',
    cash_minor: 2_000_000,
    cash_period: 'month',
    recorded_by: 'adnan',
  });
  await post(ctx, `/engagements/${rashidJob.id}/terms`, {
    effective_from: '2026-01-01',
    cash_minor: 120_000,
    cash_period: 'day',
    recorded_by: 'adnan',
  });

  return { ctx, imran, abdul, rashid, imranJob, abdulJob, rashidJob };
}

// ---------------------------------------------------------------------------
// The idempotency rule the deleted enumeration used to try to list
// ---------------------------------------------------------------------------

test('every labour write refuses a request with no Idempotency-Key', async () => {
  // The route comment no longer enumerates these -- it says every router.post
  // goes through write(). This is that claim, checked rather than listed.
  const ctx = await serve(freshDb());
  const paths: [string, unknown][] = [
    ['/people', { identifier: 'x', recorded_by: 'adnan' }],
    ['/people/per_1', { name: 'x' }],
    ['/people/per_1/engagements', { kind: 'daily', started_on: '2026-01-01', recorded_by: 'adnan' }],
    ['/engagements/eng_1', { role: 'x' }],
    ['/engagements/eng_1/terms', { effective_from: '2026-01-01', cash_minor: 1, cash_period: 'month', recorded_by: 'adnan' }],
    ['/terms/trm_1/correct', { effective_from: '2026-01-01', cash_minor: 1, cash_period: 'month', recorded_by: 'adnan' }],
    ['/payroll/run', { from_on: '2026-09-01', to_on: '2026-09-30', entries: [], ...PROV }],
    ['/payroll/run/delete', { ids: ['wag_1'] }],
    ['/wage-payments', { person_id: 'per_1', occurred_on: '2026-09-01', amount_minor: 1, method: 'cash', recorded_by: 'adnan' }],
    ['/wage-payments/wpy_1/delete', {}],
  ];
  for (const [path, payload] of paths) {
    const r = await postNoKey(ctx, path, payload);
    assert.equal(r.status, 400, `${path} accepted a write with no key`);
    assert.equal((r.body as { error: string }).error, 'missing_idempotency_key', path);
  }
});

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

test('POST /people refuses a duplicate identifier with the name that holds it', async () => {
  const { ctx } = await farm();
  const r = await post(ctx, '/people', { identifier: 'IMRAN', recorded_by: 'adnan' });
  assert.equal(r.status, 400);
  assert.equal((r.body as { error: string }).error, 'duplicate_identifier');
  assert.match((r.body as { message: string }).message, /already Imran/);
});

test('POST /people/:id refuses a rename over the wire', async () => {
  const { ctx, imran } = await farm();
  const r = await post(ctx, `/people/${imran.id}`, { identifier: 'imran_r' });
  assert.equal(r.status, 400);
  assert.equal((r.body as { error: string }).error, 'identifier_is_immutable');
  assert.equal((r.body as { field: string }).field, 'identifier');
});

test('GET /people lists everybody with a balance, and flags who is engaged', async () => {
  const { ctx, imran, imranJob } = await farm();
  await post(ctx, `/engagements/${imranJob.id}`, {
    ended_on: '2026-06-30',
    end_reason: 'went home',
  });
  const r = await get(ctx, '/people?as_of=2026-09-07');
  const rows = (r.body as { people: { person_id: string; engaged: boolean }[] }).people;
  assert.equal(rows.length, 3);
  assert.equal(rows.find((p) => p.person_id === imran.id)?.engaged, false);
});

test('GET /people/:id is a 404 with a wire error, not an empty statement', async () => {
  const { ctx } = await farm();
  const r = await get(ctx, '/people/per_ghost');
  assert.equal(r.status, 404);
  assert.equal((r.body as { error: string }).error, 'unknown_person');
});

test('GET /people/:id carries the package as well as the ledger', async () => {
  const { ctx, imran, imranJob } = await farm();
  const r = await get(ctx, `/people/${imran.id}?as_of=2026-09-07`);
  const body = r.body as {
    balance_minor: number;
    packages: { engagement_id: string; current: { term: { cash_minor: number } | null; benefits: unknown[] } }[];
  };
  assert.equal(body.balance_minor, 0);
  const pkg = body.packages.find((p) => p.engagement_id === imranJob.id);
  assert.equal(pkg?.current.term?.cash_minor, RS_25K);
  assert.equal(pkg?.current.benefits.length, 3);
});

// ---------------------------------------------------------------------------
// Packages -- where a rupee/paisa slip would look reasonable
// ---------------------------------------------------------------------------

test('a package refuses a non-integer amount and a missing period', async () => {
  const { ctx, abdulJob } = await farm();
  const bad = async (payload: Record<string, unknown>) =>
    post(ctx, `/engagements/${abdulJob.id}/terms`, {
      effective_from: '2027-01-01',
      recorded_by: 'adnan',
      ...payload,
    });

  const fractional = await bad({ cash_minor: 25_000.5, cash_period: 'month' });
  assert.equal(fractional.status, 400);
  assert.match((fractional.body as { message: string }).message, /whole number of paisa/);

  const noPeriod = await bad({ cash_minor: RS_25K });
  assert.equal(noPeriod.status, 400);
  assert.equal((noPeriod.body as { field: string }).field, 'cash_period');

  const wrongPeriod = await bad({ cash_minor: RS_25K, cash_period: 'week' });
  assert.equal(wrongPeriod.status, 400);
  assert.match((wrongPeriod.body as { message: string }).message, /month \| day/);
});

test('a second package on the same date is refused as a typo', async () => {
  const { ctx, abdulJob } = await farm();
  const r = await post(ctx, `/engagements/${abdulJob.id}/terms`, {
    effective_from: '2026-01-01',
    cash_minor: 2_100_000,
    cash_period: 'month',
    recorded_by: 'adnan',
  });
  assert.equal(r.status, 400);
  assert.match((r.body as { message: string }).message, /it is a typo/);
});

test('a benefit array of the wrong shape is refused, not silently dropped', async () => {
  const { ctx, abdulJob } = await farm();
  const r = await post(ctx, `/engagements/${abdulJob.id}/terms`, {
    effective_from: '2027-01-01',
    cash_minor: RS_25K,
    cash_period: 'month',
    benefits: [{ kind: 'flour', quantity: 20 }],
    recorded_by: 'adnan',
  });
  assert.equal(r.status, 400);
  assert.match((r.body as { message: string }).message, /both a quantity and its unit/);
});

test('correcting a package moves the default and rewrites no history', async () => {
  const { ctx, imranJob, abdulJob, imran } = await farm();
  await post(ctx, '/payroll/run', {
    from_on: '2026-09-01',
    to_on: '2026-09-30',
    entries: [
      { engagement_id: imranJob.id, amount_minor: RS_25K },
      { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
    ],
    ...PROV,
  });

  const terms = (await get(ctx, `/engagements/${imranJob.id}/terms`)).body as {
    terms: { id: string }[];
  };
  const corrected = await post(ctx, `/terms/${terms.terms[0].id}/correct`, {
    effective_from: '2026-01-01',
    cash_minor: 2_600_000,
    cash_period: 'month',
    benefits: [{ kind: 'milk', quantity: 2, unit: 'L', period: 'day' }],
    recorded_by: 'adnan',
  });
  assert.equal(corrected.status, 200);

  const st = (await get(ctx, `/people/${imran.id}`)).body as { earned_minor: number };
  assert.equal(st.earned_minor, RS_25K, 'what was paid in September did not move');
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

test('GET /payroll/run derives who must be answered', async () => {
  const { ctx } = await farm();
  const r = await get(ctx, '/payroll/run?from=2026-09-01&to=2026-09-30');
  const body = r.body as {
    permanent: { person: { identifier: string }; suggested_minor: number }[];
    daily_candidates: { person: { identifier: string } }[];
    outstanding: number;
  };
  assert.deepEqual(
    body.permanent.map((p) => p.person.identifier).sort(),
    ['abdul', 'imran'],
    'the dihari is NOT on the mandatory list',
  );
  assert.deepEqual(body.daily_candidates.map((p) => p.person.identifier), ['rashid']);
  assert.equal(body.outstanding, 2);
  assert.equal(body.permanent.find((p) => p.person.identifier === 'imran')?.suggested_minor, RS_25K);
});

test('POST /payroll/run refuses a run with a salaried employee missing', async () => {
  const { ctx, imranJob } = await farm();
  const r = await post(ctx, '/payroll/run', {
    from_on: '2026-09-01',
    to_on: '2026-09-30',
    entries: [{ engagement_id: imranJob.id, amount_minor: RS_25K }],
    ...PROV,
  });
  assert.equal(r.status, 400);
  assert.equal((r.body as { error: string }).error, 'untouched_permanent_engagement');
  assert.match((r.body as { message: string }).message, /abdul/);
});

test('a run saves salaried months and a dihari day together', async () => {
  const { ctx, imranJob, abdulJob, rashidJob } = await farm();
  const r = await post(ctx, '/payroll/run', {
    from_on: '2026-09-01',
    to_on: '2026-09-30',
    entries: [
      { engagement_id: imranJob.id, amount_minor: RS_25K },
      { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
      { engagement_id: rashidJob.id, from_on: '2026-09-14', amount_minor: 120_000 },
    ],
    ...PROV,
  });
  assert.equal(r.status, 201);
  assert.equal((r.body as { written: number }).written, 3);

  const run = (await get(ctx, '/payroll/run?from=2026-09-01&to=2026-09-30')).body as {
    daily: { from_on: string; to_on: string; person: { identifier: string } }[];
    outstanding: number;
    total_minor: number;
  };
  assert.equal(run.outstanding, 0);
  assert.equal(run.total_minor, RS_25K + 2_000_000 + 120_000);
  assert.deepEqual(run.daily.map((d) => [d.person.identifier, d.from_on, d.to_on]), [
    ['rashid', '2026-09-14', '2026-09-14'],
  ]);
});

test('a replayed run does not double-pay', async () => {
  const { ctx, imranJob, abdulJob } = await farm();
  const payload = {
    from_on: '2026-09-01',
    to_on: '2026-09-30',
    entries: [
      { engagement_id: imranJob.id, amount_minor: RS_25K },
      { engagement_id: abdulJob.id, amount_minor: 2_000_000 },
    ],
    ...PROV,
  };
  const key = 'labour-replay-1';
  const first = await post(ctx, '/payroll/run', payload, key);
  const second = await post(ctx, '/payroll/run', payload, key);
  assert.equal(first.status, 201);
  assert.deepEqual(second.body, first.body, 'the replay returns the stored response');
  const run = (await get(ctx, '/payroll/run?from=2026-09-01&to=2026-09-30')).body as {
    total_minor: number;
  };
  assert.equal(run.total_minor, RS_25K + 2_000_000);
});

test('POST /payroll/run/delete needs a non-empty array of ids', async () => {
  const { ctx } = await farm();
  for (const ids of [undefined, [], [1, 2], 'wag_1']) {
    const r = await post(ctx, '/payroll/run/delete', { ids });
    assert.equal(r.status, 400, JSON.stringify(ids));
    assert.equal((r.body as { field: string }).field, 'ids');
  }
});

// ---------------------------------------------------------------------------
// The wage ledger
// ---------------------------------------------------------------------------

test('an advance is a plain payment and the balance goes negative over the wire', async () => {
  const { ctx, imran } = await farm();
  const r = await post(ctx, '/wage-payments', {
    person_id: imran.id,
    occurred_on: '2026-08-20',
    amount_minor: 800_000,
    method: 'cash',
    reference: 'peshgi',
    recorded_by: 'adnan',
  });
  assert.equal(r.status, 201);
  const st = (await get(ctx, `/people/${imran.id}`)).body as { balance_minor: number };
  assert.equal(st.balance_minor, -800_000);
});

test('a negative cash payment is refused; a signed adjustment with a note is not', async () => {
  const { ctx, imran } = await farm();
  const negative = await post(ctx, '/wage-payments', {
    person_id: imran.id,
    occurred_on: '2026-09-30',
    amount_minor: -30_000,
    method: 'cash',
    recorded_by: 'adnan',
  });
  assert.equal(negative.status, 400);
  assert.match((negative.body as { message: string }).message, /record an adjustment and say why/);

  const bare = await post(ctx, '/wage-payments', {
    person_id: imran.id,
    occurred_on: '2026-09-30',
    amount_minor: 30_000,
    method: 'adjustment',
    recorded_by: 'adnan',
  });
  assert.equal(bare.status, 400);
  assert.equal((bare.body as { field: string }).field, 'note');

  const good = await post(ctx, '/wage-payments', {
    person_id: imran.id,
    occurred_on: '2026-09-30',
    amount_minor: 30_000,
    method: 'adjustment',
    note: 'took 4 L above the allowance',
    recorded_by: 'adnan',
  });
  assert.equal(good.status, 201);
});

test('a payment to an unknown person is a 400 with a field, not a 500', async () => {
  const { ctx } = await farm();
  const r = await post(ctx, '/wage-payments', {
    person_id: 'per_ghost',
    occurred_on: '2026-09-30',
    amount_minor: 100,
    method: 'cash',
    recorded_by: 'adnan',
  });
  assert.equal(r.status, 400);
  assert.equal((r.body as { error: string }).error, 'unknown_person');
  assert.equal((r.body as { field: string }).field, 'person_id');
});

// ---------------------------------------------------------------------------
// /verification carries the labour report
// ---------------------------------------------------------------------------

test('GET /verification reports overlapping stints WITHOUT calling them violations', async () => {
  const { ctx, imran } = await farm();
  await post(ctx, `/people/${imran.id}/engagements`, {
    kind: 'daily',
    role: 'night watchman',
    started_on: '2026-06-01',
    recorded_by: 'adnan',
  });
  const r = await get(ctx, '/verification?as_of=2026-09-07');
  const body = r.body as {
    violations: unknown[];
    labour: { kind: string; detail: string }[];
  };
  assert.deepEqual(body.violations, [], 'the farm asked for overlapping stints');
  assert.ok(body.labour.some((l) => l.kind === 'overlapping_engagements'));
  assert.ok(body.labour.some((l) => l.kind === 'multiple_open_engagements'));
});

test('POST /destinations carries person_id through, so staff milk is creatable over HTTP', async () => {
  // It did not. addDestination() supported `person_id` and the route dropped it,
  // so every staff destination attempt came back as the "needs the person it
  // belongs to" refusal. Nothing caught it because the fixtures call the domain
  // function directly; the harness seed, which goes through the routes on
  // purpose, found it on its first run.
  const { ctx, imran } = await farm();
  const created = await post(ctx, '/destinations', {
    name: 'Imran (milk allowance)',
    kind: 'staff',
    standing: true,
    person_id: imran.id,
    started_on: '2026-01-01',
    recorded_by: 'adnan',
  });
  assert.equal(created.status, 201);
  assert.equal((created.body as { person_id: string }).person_id, imran.id);
  assert.equal((created.body as { billable: boolean }).billable, false);

  // And the refusals still reach the wire.
  const noPerson = await post(ctx, '/destinations', {
    name: 'Staff milk', kind: 'staff', standing: true,
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  assert.equal(noPerson.status, 400);
  assert.equal((noPerson.body as { field: string }).field, 'person_id');

  const strayPerson = await post(ctx, '/destinations', {
    name: 'Ali', kind: 'household', standing: false, person_id: imran.id,
    started_on: '2026-01-01', recorded_by: 'adnan',
  });
  assert.equal(strayPerson.status, 400);
  assert.match((strayPerson.body as { message: string }).message, /only a 'staff' destination/);
});
