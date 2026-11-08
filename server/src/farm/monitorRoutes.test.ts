// GET /api/farm/events: windowing, ordering, validation, and no raw payload.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

import { farmMonitorRouter, type FarmEventView } from './monitorRoutes';
import { syntheticFarmEvents } from './monitorFixtures';

const open: Server[] = [];
after(() => {
  for (const s of open) s.close();
});

async function serve(read: (from: string, to: string) => FarmEventView[], synthetic = false) {
  const app = express();
  app.use('/api/farm', farmMonitorRouter(read, { synthetic }));
  const server = app.listen(0);
  open.push(server);
  await new Promise<void>((r) => server.once('listening', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/farm/events`;
}

const now = new Date('2026-11-06T11:00:00Z'); // 16:00 farm time
const events = syntheticFarmEvents(now);

test('returns the window newest first, filtered by the reader', async () => {
  let asked: [string, string] | null = null;
  const url = await serve((from, to) => {
    asked = [from, to];
    return events.filter((e) => e.occurred_at >= from && e.occurred_at < to);
  }, true);
  const from = '2026-11-05T13:00:00.000Z';
  const to = '2026-11-06T01:00:00.000Z';
  const body = await (await fetch(`${url}?from=${from}&to=${to}`)).json();
  assert.deepEqual(asked, [from, to]);
  assert.equal(body.synthetic, true);
  assert.ok(body.events.length >= 3);
  const times = body.events.map((e: FarmEventView) => e.occurred_at);
  assert.deepEqual(times, [...times].sort().reverse());
  assert.ok(body.events.every((e: Record<string, unknown>) => !('raw_payload' in e)));
});

test('defaults to the last 24 hours', async () => {
  let span = 0;
  const url = await serve((from, to) => {
    span = Date.parse(to) - Date.parse(from);
    return [];
  });
  const body = await (await fetch(url)).json();
  assert.equal(span, 24 * 3600_000);
  assert.deepEqual(body.events, []);
  assert.equal(body.synthetic, false);
});

test('refuses an inverted or oversized window', async () => {
  const url = await serve(() => []);
  assert.equal((await fetch(`${url}?from=2026-11-06T00:00:00Z&to=2026-11-05T00:00:00Z`)).status, 400);
  assert.equal((await fetch(`${url}?from=2026-09-01T00:00:00Z&to=2026-11-05T00:00:00Z`)).status, 400);
  assert.equal((await fetch(`${url}?from=nonsense`)).status, 400);
});

test('synthetic fixtures place flagged events in the most recent night', () => {
  const flagged = events.filter((e) => e.flagged);
  assert.equal(flagged.length, 2);
  assert.ok(flagged.every((e) => e.is_synthetic && e.flag_reason));
  assert.ok(flagged.every((e) => Date.parse(e.occurred_at) < now.getTime()));
});
