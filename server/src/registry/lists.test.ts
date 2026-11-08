import assert from 'node:assert';
import { test } from 'node:test';
import { cleanHerd } from './fixtures';
import { registryList } from './lists';

type Row = { id: string; status: string | null; birth_on: string | null; parity: number | null };
const ids = (r: { items: unknown[] }) => (r.items as Row[]).map((a) => a.id);

test('animals: all by default; current and departed split the herd', () => {
  const db = cleanHerd();
  const all = registryList(db, 'animals', { pageSize: '100' }) as { items: Row[] };
  const current = registryList(db, 'animals', { pageSize: '100', group: 'current' }) as { items: Row[] };
  const departed = registryList(db, 'animals', { pageSize: '100', group: 'departed' }) as { items: Row[] };
  assert.equal(current.items.length + departed.items.length, all.items.length);
  assert.ok(current.items.every((a) => a.status !== 'departed'));
  assert.ok(departed.items.every((a) => a.status === 'departed'));
});

test('animals: a stage filter keeps only that stored status', () => {
  const db = cleanHerd();
  const r = registryList(db, 'animals', { pageSize: '100', status: 'lactating' }) as { items: Row[] };
  assert.ok(r.items.length > 0);
  assert.ok(r.items.every((a) => a.status === 'lactating'));
  assert.throws(() => registryList(db, 'animals', { status: 'cow' }));
  assert.throws(() => registryList(db, 'animals', { group: 'sold' }));
});

test('animals: sort by parity descending puts the most calvings first', () => {
  const db = cleanHerd();
  const r = registryList(db, 'animals', { pageSize: '100', sort: 'parity', direction: 'desc' }) as { items: Row[] };
  const p = r.items.map((a) => a.parity ?? -1);
  assert.deepEqual(p, [...p].sort((a, b) => b - a));
  assert.ok(ids(r).length > 0);
});

test('destinations: each billable buyer carries what it owes; home carries null, not zero', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { applyRegistrySchema } = await import('./schema');
  const { addDestination, setPrice } = await import('./destinations');
  const { saveDispatchSession } = await import('./dispatch');
  const db = new Database(':memory:');
  applyRegistrySchema(db);
  const dodhi = addDestination(db, { name: 'Dodhi', kind: 'dodhi', standing: true, started_on: '2026-01-01', recorded_by: 'a' });
  const home = addDestination(db, { name: 'Home', kind: 'home', standing: true, started_on: '2026-01-01', recorded_by: 'a' });
  setPrice(db, { destination_id: dodhi.id, effective_from: '2026-01-01', price_minor: 700_000, price_unit_litres: 40, recorded_by: 'a' });
  saveDispatchSession(db, {
    occurred_on: '2026-02-01', session: 'morning',
    entries: [
      { destination_id: dodhi.id, status: 'taken', litres: 40 },
      { destination_id: home.id, status: 'taken', litres: 2 },
    ],
    provenance: { source_form: 'direct_entry', recorded_by: 'a' },
  });
  const r = registryList(db, 'destinations', { on: '2026-02-02' }) as {
    items: { id: string; balance_minor: number | null }[];
  };
  const by = new Map(r.items.map((d) => [d.id, d.balance_minor]));
  assert.equal(by.get(dodhi.id), 700_000);
  assert.equal(by.get(home.id), null);
});
