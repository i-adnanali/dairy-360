// Animal registry -- a farm-born animal whose mother is not known.
//
// The backfill case: adults born on the farm to dams nobody can name any more.
// Before addFarmBornAnimal the only ways in were both false (enter it as
// `acquired`, or invent a dam). These tests pin the truthful path: a `birth`
// origin with `dam_id: null`, a dam edge of certainty 'unknown', and an animal
// that otherwise behaves like any other -- including calving herself later.
//
// `:memory:` only; writes nothing to disk.

import assert from 'node:assert';
import { after, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { addFarmBornAnimal } from './entry';
import { RegistryError, isRegistryError } from './errors';
import { recordCalving } from './calving';
import { assertEventPayload } from './events';
import { checkSnapshot } from './invariants';
import { rebuild } from './projectStore';
import { linkCandidates } from './reads';
import { allParentage, allStatuses, eventsForAnimal, getAnimal, snapshot } from './store';
import { harnessApp } from './harness';
import { AS_OF, RECALL, freshDb } from './fixtures';
import type { Db } from './schema';

function refusal(fn: () => unknown): RegistryError {
  try {
    fn();
  } catch (e) {
    if (isRegistryError(e)) return e;
    throw e;
  }
  throw new assert.AssertionError({ message: 'expected a RegistryError, nothing was thrown' });
}

function addOne(db: Db, over: Partial<Parameters<typeof addFarmBornAnimal>[1]> = {}) {
  return addFarmBornAnimal(db, {
    sex: 'female',
    birth_on: '2016-01-01',
    birth_precision: 'estimated',
    provenance: RECALL,
    asOf: AS_OF,
    ...over,
  });
}

const status = (db: Db, id: string) => allStatuses(db).find((s) => s.animal_id === id)!;

// ---------------------------------------------------------------------------
// the happy path
// ---------------------------------------------------------------------------

test('creates a born_on_farm animal with a birth origin naming no dam', () => {
  const db = freshDb();
  const r = addOne(db, { name: 'Kali', tag_no: 'PK-4425' });

  const a = getAnimal(db, r.animal_id)!;
  assert.equal(a.origin, 'born_on_farm');
  assert.equal(a.name, 'Kali');
  assert.equal(a.tag_no, 'PK-4425');

  const events = eventsForAnimal(db, r.animal_id);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'birth');
  assert.equal(events[0].occurred_on, '2016-01-01');
  assert.equal(events[0].date_precision, 'estimated');
  assert.equal(events[0].payload.dam_id, null);
  assert.equal(events[0].payload.calving_event_id, null);
  assert.equal(events[0].payload.outcome, 'live');
});

test('projects a dam edge of certainty unknown, which satisfies invariant 7', () => {
  const db = freshDb();
  const r = addOne(db);
  const edges = allParentage(db).filter((p) => p.child_id === r.animal_id);
  assert.deepEqual(
    edges.map(({ relation, parent_ref, certainty }) => ({ relation, parent_ref, certainty })),
    [{ relation: 'dam', parent_ref: null, certainty: 'unknown' }],
  );
  assert.deepEqual(checkSnapshot(snapshot(db), AS_OF), []);
});

test('a sire, when remembered, is kept as a known sire edge beside the unknown dam', () => {
  const db = freshDb();
  const r = addOne(db, { sire_ref: 'Chak 42 bull' });
  const sire = allParentage(db).find((p) => p.child_id === r.animal_id && p.relation === 'sire');
  assert.equal(sire?.parent_ref, 'Chak 42 bull');
  assert.equal(sire?.certainty, 'known');
});

test('status follows age like any animal: an adult female is a heifer, a young one a calf', () => {
  const db = freshDb();
  const adult = addOne(db);
  const young = addOne(db, { birth_on: '2026-03-01', birth_precision: 'month' });
  assert.equal(status(db, adult.animal_id).status, 'heifer');
  assert.equal(status(db, young.animal_id).status, 'calf');
  assert.equal(status(db, adult.animal_id).birth_on, '2016-01-01');
  assert.equal(status(db, adult.animal_id).birth_precision, 'estimated');
});

test('she can then calve like any dam, and the herd still verifies', () => {
  const db = freshDb();
  const dam = addOne(db).animal_id;
  const c = recordCalving(db, {
    dam_id: dam,
    occurred_on: '2025-10-04',
    date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' },
    provenance: RECALL,
    asOf: AS_OF,
  });
  assert.equal(status(db, dam).status, 'lactating');
  assert.equal(status(db, dam).parity, 1);
  assert.equal(getAnimal(db, c.calf_id)!.origin, 'born_on_farm');
  assert.deepEqual(checkSnapshot(snapshot(db), AS_OF), []);
});

test('a rebuild from the event log reproduces the unknown edge exactly', () => {
  const db = freshDb();
  const r = addOne(db);
  const before = allParentage(db);
  db.prepare(`DELETE FROM registry_parentage`).run();
  rebuild(db, { asOf: AS_OF });
  assert.deepEqual(allParentage(db), before);
  assert.ok(allParentage(db).some((p) => p.child_id === r.animal_id && p.certainty === 'unknown'));
});

// ---------------------------------------------------------------------------
// refusals
// ---------------------------------------------------------------------------

test('the birth date is required, and so is its precision -- never defaulted', () => {
  const db = freshDb();
  assert.equal(refusal(() => addOne(db, { birth_on: '' })).field, 'birth_on');
  assert.equal(
    refusal(() => addOne(db, { birth_precision: undefined as never })).code,
    'precision_not_defaulted',
  );
  // An estimated date that names a day is a fabrication wearing humility.
  assert.equal(refusal(() => addOne(db, { birth_on: '2016-04-12' })).field, 'occurred_on');
  assert.equal(allStatuses(db).length, 0, 'a refused add writes nothing');
});

test('a birth payload that merely OMITS dam_id is still refused', () => {
  assert.throws(() => assertEventPayload('birth', { sex: 'female', outcome: 'live' }), /dam_id/);
});

test('dam_id null cannot carry a calving, or any outcome but live', () => {
  assert.throws(
    () =>
      assertEventPayload('birth', {
        dam_id: null,
        calving_event_id: 'aevt_x',
        sex: 'female',
        outcome: 'live',
      }),
    /calving_event_id/,
  );
  assert.throws(
    () => assertEventPayload('birth', { dam_id: null, sex: 'female', outcome: 'stillborn' }),
    /outcome/,
  );
});

test('a named dam still needs its calving -- the old shape is unchanged', () => {
  assert.throws(
    () => assertEventPayload('birth', { dam_id: 'BD-0001', sex: 'female', outcome: 'live' }),
    /calving_event_id/,
  );
});

test('link mode refuses her, saying why, and the link picker greys her out', () => {
  const db = freshDb();
  const dam = addOne(db, { birth_on: '2010-01-01', birth_precision: 'year' }).animal_id;
  const calf = addOne(db, { birth_on: '2018-01-01', birth_precision: 'year' }).animal_id;
  const e = refusal(() =>
    recordCalving(db, {
      dam_id: dam,
      occurred_on: '2018-01-01',
      date_precision: 'year',
      calf: { existing_id: calf, sex: 'female', outcome: 'live' },
      provenance: RECALL,
      asOf: AS_OF,
    }),
  );
  assert.equal(e.code, 'already_has_birth');
  assert.match(e.message, /mother not known/);

  const row = linkCandidates(db, { damId: dam }).find((c) => c.id === calf);
  assert.match(String(row?.ineligible_reason), /mother not known/);
});

// ---------------------------------------------------------------------------
// the route
// ---------------------------------------------------------------------------

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

async function postBornHere(db: Db, body: unknown) {
  const server = harnessApp(db).listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const r = await fetch(`http://127.0.0.1:${port}/api/registry/animals/born-here`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `farmborn-${Math.random()}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, never> };
}

test('POST /animals/born-here creates the animal and returns its detail', async () => {
  const db = freshDb();
  const { status: code, body } = await postBornHere(db, {
    sex: 'female',
    name: 'Bholi',
    birth_on: '2014-01-01',
    birth_precision: 'estimated',
    source_form: 'recall',
    recorded_by: 'adnan',
    as_of: AS_OF,
  });
  assert.equal(code, 201);
  assert.equal(getAnimal(db, body.animal_id as string)?.origin, 'born_on_farm');
});

test('POST /animals/born-here without a birth precision is a 400 naming the field', async () => {
  const db = freshDb();
  const { status: code, body } = await postBornHere(db, {
    sex: 'female',
    birth_on: '2014-01-01',
    source_form: 'recall',
    recorded_by: 'adnan',
  });
  assert.equal(code, 400);
  assert.equal((body as { field?: string }).field, 'birth_precision');
});
