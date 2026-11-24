// Breeding stage 3: the board. One row per current female with a view; the tasks
// are the cases' tasks, overdue first, then by the date they turn red.

import assert from 'node:assert';
import { test } from 'node:test';

import { recordBreedingEvent } from './breeding';
import { breedingBoard, breedingForAnimal } from './breeding-board';
import { addAcquired, freshDb } from './fixtures';
import { eventsForAnimal, getAnimal } from './store';
import { BREEDING_AS_OF, breedingHerd } from './breeding-fixtures';

test('cases are one row per breeding female and the counts add up', () => {
  const db = breedingHerd();
  const board = breedingBoard(db, BREEDING_AS_OF);
  const females = (db.prepare(`SELECT id FROM registry_animals WHERE sex = 'female'`).all() as { id: string }[]).map((r) => r.id);
  assert.ok(board.cases.length > 0);
  for (const c of board.cases) assert.ok(females.includes(c.animal_id));
  assert.equal(new Set(board.cases.map((c) => c.animal_id)).size, board.cases.length);
  assert.equal(board.overdue + board.due, board.tasks.length);
  assert.equal(board.tasks.length, board.cases.reduce((n, c) => n + c.tasks.length, 0));
  // Every case is a current female, so entry is open for each.
  assert.ok(board.cases.every((c) => c.entry_open));
});

test('tasks are overdue first, then due, each by red_on (none last) then animal id', () => {
  const board = breedingBoard(breedingHerd(), BREEDING_AS_OF);
  const rank = (s: string) => (s === 'overdue' ? 0 : 1);
  for (let i = 1; i < board.tasks.length; i += 1) {
    const a = board.tasks[i - 1];
    const b = board.tasks[i];
    if (rank(a.standing) !== rank(b.standing)) {
      assert.ok(rank(a.standing) < rank(b.standing));
      continue;
    }
    if (a.red_on !== b.red_on) {
      assert.ok(a.red_on !== null && (b.red_on === null || a.red_on < b.red_on), `${a.animal_id} before ${b.animal_id}`);
      continue;
    }
    assert.ok(a.animal_id <= b.animal_id);
  }
});

test('a heat recorded on the page after a same-day service is its sign: bred, tasks kept', () => {
  // Following the no_heat_sign advice: save the service over the warning, then record the heat.
  const db = freshDb();
  addAcquired(db, { id: 'BD-0001', sex: 'female', acquired_on: '2023-01-01', acquired_precision: 'day' });
  const prov = { source_form: 'direct_entry', recorded_by: 'owner' } as const;
  recordBreedingEvent(db, {
    animal_id: 'BD-0001', type: 'insemination', occurred_on: '2026-10-01', date_precision: 'day',
    payload: { service_type: 'ai', exposure_days: null }, provenance: prov, allow_no_heat_sign: true,
    recorded_at: '2026-10-01T05:00:00.000Z',
  });
  recordBreedingEvent(db, {
    animal_id: 'BD-0001', type: 'heat_observed', occurred_on: '2026-10-01', date_precision: 'day',
    payload: { sign: 'standing' }, provenance: prov, recorded_at: '2026-10-01T05:02:00.000Z',
  });
  const read = (on: string) => {
    const r = breedingForAnimal(getAnimal(db, 'BD-0001')!, eventsForAnimal(db, 'BD-0001'), on);
    return [r.view?.state, r.view?.heat_sign_before_service, r.tasks.map((t) => t.kind)];
  };
  assert.deepEqual(read('2026-10-01'), ['bred', 'seen', []]);
  assert.deepEqual(read('2026-10-25'), ['bred', 'seen', ['heat_watch']]);
  assert.deepEqual(read('2026-11-24'), ['unconfirmed', 'seen', ['heat_watch', 'pregnancy_check']]);
});
