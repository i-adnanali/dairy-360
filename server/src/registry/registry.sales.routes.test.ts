// Animal registry -- the sales HTTP surface, over REAL HTTP.
//
// Same reasoning as registry.routes.test.ts: calling handlers directly would
// skip JSON body parsing, status codes and error serialization, which is where
// a new route is most likely to be wrong.
//
// What this file adds beyond that: money crosses the wire here as an INTEGER
// number of paisa and a lot size, and every one of the ways that can go wrong
// -- a missing lot size, a string where a number belongs, a boolean read as
// falsy -- produces a request that still looks reasonable. So the refusals are
// asserted by code and by message, not merely by "it was a 400".

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
      'idempotency-key': key ?? `sales-test-${++keySeq}`,
    },
    body: JSON.stringify(payload),
  });
  return { status: r.status, body: (await r.json()) as never };
}

const PROV = { source_form: 'direct_entry', recorded_by: 'adnan' };
const RS_7000_PER_40L = 700_000;

/** The three-buyer farm, over HTTP, so the routes build it rather than a helper. */
async function farm() {
  const ctx = await serve(freshDb());
  const mk = async (name: string, kind: string, standing: boolean) =>
    (
      await post(ctx, '/destinations', {
        name,
        kind,
        standing,
        started_on: '2026-01-01',
        recorded_by: 'adnan',
      })
    ).body as { id: string };

  const dodhi = await mk('Bashir (dodhi)', 'dodhi', true);
  const home = await mk('Home', 'home', true);
  const ali = await mk('Ali (next door)', 'household', false);

  await post(ctx, `/destinations/${dodhi.id}/prices`, {
    effective_from: '2026-01-01',
    price_minor: RS_7000_PER_40L,
    price_unit_litres: 40,
    recorded_by: 'adnan',
  });
  await post(ctx, `/destinations/${ali.id}/prices`, {
    effective_from: '2026-01-01',
    price_minor: 900_000,
    price_unit_litres: 40,
    recorded_by: 'adnan',
  });
  return { ctx, dodhi, home, ali };
}

// ---------------------------------------------------------------------------

test('POST /destinations creates one, and GET lists it with its price', async () => {
  const { ctx, dodhi } = await farm();
  const { status, body } = await get(ctx, '/destinations?as_of=2026-02-01');
  assert.equal(status, 200);
  const rows = (body as { destinations: Record<string, unknown>[] }).destinations;
  assert.equal(rows.length, 3);

  const b = rows.find((r) => r.id === dodhi.id)!;
  assert.equal(b.billable, true, 'a dodhi is billable by default');
  assert.equal(b.standing, true);
  assert.equal(b.active, true);
  assert.deepEqual(
    { minor: (b.price as { price_minor: number }).price_minor, unit: (b.price as { price_unit_litres: number }).price_unit_litres },
    { minor: RS_7000_PER_40L, unit: 40 },
    'the rate crosses the wire WITH its lot size',
  );

  const home = rows.find((r) => r.kind === 'home')!;
  assert.equal(home.billable, false);
  assert.equal(home.price, null, 'home has no price and never will');
});

test('`standing` is REQUIRED, not defaulted -- it decides whether the sheet asks', async () => {
  const ctx = await serve(freshDb());
  const { status, body } = await post(ctx, '/destinations', {
    name: 'Someone', kind: 'household', started_on: '2026-01-01', recorded_by: 'adnan',
  });
  assert.equal(status, 400);
  assert.equal((body as { error: string }).error, 'invalid_payload');
  assert.match((body as { message: string }).message, /standing must be true or false/);
});

test('a price needs its lot size, and the refusal SAYS what the number means', async () => {
  const { ctx, dodhi } = await farm();
  const { status, body } = await post(ctx, `/destinations/${dodhi.id}/prices`, {
    effective_from: '2026-03-01', price_minor: RS_7000_PER_40L, recorded_by: 'adnan',
  });
  assert.equal(status, 400);
  assert.match(
    (body as { message: string }).message,
    /price_unit_litres is required/,
    'a missing lot size must not fall back to 1 -- that is a 40x overcharge',
  );
});

test('POST /dispatch/session writes a session and bills it', async () => {
  const { ctx, dodhi, home } = await farm();
  const { status, body } = await post(ctx, '/dispatch/session', {
    occurred_on: '2026-02-01',
    session: 'morning',
    entries: [
      { destination_id: dodhi.id, status: 'taken', litres: 12.5 },
      { destination_id: home.id, status: 'taken', litres: 3 },
    ],
    ...PROV,
  });
  assert.equal(status, 201);
  const r = body as { written: number; amount_minor: number; litres: number };
  assert.equal(r.written, 2);
  assert.equal(r.litres, 15.5);
  assert.equal(r.amount_minor, 218_750, '12.5 L at Rs 7,000/40 L; home is not billed');
});

test('an unanswered STANDING destination is a 400 that names it', async () => {
  const { ctx, dodhi } = await farm();
  const { status, body } = await post(ctx, '/dispatch/session', {
    occurred_on: '2026-02-01',
    session: 'morning',
    entries: [{ destination_id: dodhi.id, status: 'taken', litres: 12.5 }],
    ...PROV,
  });
  assert.equal(status, 400);
  assert.equal((body as { error: string }).error, 'untouched_standing_destination');
  assert.match((body as { message: string }).message, /Home/);
});

test('an absent OCCASIONAL destination is fine -- the other half of the rule', async () => {
  const { ctx, dodhi, home } = await farm();
  const { status } = await post(ctx, '/dispatch/session', {
    occurred_on: '2026-02-01',
    session: 'morning',
    entries: [
      { destination_id: dodhi.id, status: 'taken', litres: 12.5 },
      { destination_id: home.id, status: 'taken', litres: 3 },
    ],
    ...PROV,
  });
  assert.equal(status, 201, 'Ali took nothing and that needs no row');
});

test('GET /dispatch/sheet splits standing from occasional', async () => {
  const { ctx } = await farm();
  const { status, body } = await get(ctx, '/dispatch/sheet?on=2026-02-01&session=evening');
  assert.equal(status, 200);
  const sheet = body as {
    standing: { name: string }[];
    occasional: { name: string }[];
    previous_session: { occurred_on: string; session: string };
    produced: { measured_litres: number; not_measured: number };
  };
  assert.deepEqual(sheet.standing.map((r) => r.name).sort(), ['Bashir (dodhi)', 'Home']);
  assert.deepEqual(sheet.occasional.map((r) => r.name), ['Ali (next door)']);
  assert.deepEqual(sheet.previous_session, { occurred_on: '2026-01-31', session: 'evening' });
  assert.equal(sheet.produced.measured_litres, 0, 'no herd data -- the sales half stands alone');
});

test('every sales write route REFUSES a request with no Idempotency-Key', async () => {
  const { ctx, dodhi } = await farm();
  const routes: [string, unknown][] = [
    ['/destinations', { name: 'X', kind: 'shop', standing: false, started_on: '2026-01-01', recorded_by: 'a' }],
    [`/destinations/${dodhi.id}`, { recorded_by: 'a' }],
    [`/destinations/${dodhi.id}/prices`, { effective_from: '2026-01-01', price_minor: 1, price_unit_litres: 40, recorded_by: 'a' }],
    ['/dispatch/session', { occurred_on: '2026-02-01', session: 'morning', entries: [], ...PROV }],
    ['/dispatch/session/delete', { occurred_on: '2026-02-01', session: 'morning' }],
    ['/payments', { destination_id: dodhi.id, occurred_on: '2026-02-01', amount_minor: 1, method: 'cash', recorded_by: 'a' }],
    ['/payments/pay_x/delete', {}],
  ];
  for (const [path, payload] of routes) {
    const r = await fetch(`${ctx.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(r.status, 400, `${path} accepted a keyless write`);
    assert.equal(((await r.json()) as { error: string }).error, 'missing_idempotency_key', path);
  }
});

test('a replayed session save returns the first response and writes nothing new', async () => {
  const { ctx, dodhi, home } = await farm();
  const payload = {
    occurred_on: '2026-02-01',
    session: 'morning',
    entries: [
      { destination_id: dodhi.id, status: 'taken', litres: 12.5 },
      { destination_id: home.id, status: 'taken', litres: 3 },
    ],
    ...PROV,
  };
  const first = await post(ctx, '/dispatch/session', payload, 'replay-me');
  const second = await post(ctx, '/dispatch/session', payload, 'replay-me');
  assert.equal(second.status, first.status);
  assert.deepEqual(second.body, first.body);
  assert.equal(
    (ctx.db.prepare(`SELECT COUNT(*) n FROM registry_dispatches`).get() as { n: number }).n,
    2,
    'a replay must not write a second, indistinguishable version of the session',
  );
});

test('the statement comes back grouped by month with a running balance', async () => {
  const { ctx, dodhi, home } = await farm();
  const sell = (on: string) =>
    post(ctx, '/dispatch/session', {
      occurred_on: on,
      session: 'morning',
      entries: [
        { destination_id: dodhi.id, status: 'taken', litres: 40 },
        { destination_id: home.id, status: 'taken', litres: 3 },
      ],
      ...PROV,
    });
  await sell('2026-02-01');
  await sell('2026-03-01');
  await post(ctx, '/payments', {
    destination_id: dodhi.id, occurred_on: '2026-02-28',
    amount_minor: RS_7000_PER_40L, method: 'cash', recorded_by: 'adnan',
  });

  const { status, body } = await get(ctx, `/destinations/${dodhi.id}`);
  assert.equal(status, 200);
  const s = body as {
    months: { month: string; closing_minor: number }[];
    balance_minor: number;
    prices: unknown[];
  };
  assert.deepEqual(s.months.map((m) => m.month), ['2026-02', '2026-03']);
  assert.equal(s.months[0].closing_minor, 0, 'February was settled in full');
  assert.equal(s.months[1].closing_minor, RS_7000_PER_40L);
  assert.equal(s.balance_minor, RS_7000_PER_40L);
  assert.equal(s.prices.length, 1, 'the price history rides along');
});

test('GET /destinations/:id is a 404 for an unknown one, with the wire shape intact', async () => {
  const { ctx } = await farm();
  const { status, body } = await get(ctx, '/destinations/dst_nope');
  assert.equal(status, 404);
  assert.equal((body as { error: string }).error, 'unknown_destination');
  assert.ok((body as { message: string }).message.length > 0, 'an Error subclass serialized');
});

test('GET /balances excludes home', async () => {
  const { ctx } = await farm();
  const { body } = await get(ctx, '/balances');
  const rows = (body as { balances: { name: string }[] }).balances;
  assert.deepEqual(rows.map((r) => r.name).sort(), ['Ali (next door)', 'Bashir (dodhi)']);
});

test('a payment against home is refused with a reason, not a 500', async () => {
  const { ctx, home } = await farm();
  const { status, body } = await post(ctx, '/payments', {
    destination_id: home.id, occurred_on: '2026-02-01',
    amount_minor: 100, method: 'cash', recorded_by: 'adnan',
  });
  assert.equal(status, 400);
  assert.equal((body as { error: string }).error, 'not_billable');
});

test('an adjustment with no note is refused over the wire too', async () => {
  const { ctx, dodhi } = await farm();
  const { status, body } = await post(ctx, '/payments', {
    destination_id: dodhi.id, occurred_on: '2026-02-01',
    amount_minor: -500, method: 'adjustment', recorded_by: 'adnan',
  });
  assert.equal(status, 400);
  assert.match((body as { message: string }).message, /must say why/);
});

test('a session can be deleted and re-entered on the right date', async () => {
  const { ctx, dodhi, home } = await farm();
  const entries = [
    { destination_id: dodhi.id, status: 'taken', litres: 40 },
    { destination_id: home.id, status: 'taken', litres: 3 },
  ];
  await post(ctx, '/dispatch/session', { occurred_on: '2026-02-01', session: 'morning', entries, ...PROV });
  const del = await post(ctx, '/dispatch/session/delete', {
    occurred_on: '2026-02-01', session: 'morning',
  });
  assert.equal(del.status, 200);
  assert.equal((del.body as { removed: number }).removed, 2);
  const again = await post(ctx, '/dispatch/session', {
    occurred_on: '2026-02-02', session: 'morning', entries, ...PROV,
  });
  assert.equal(again.status, 201);
});
