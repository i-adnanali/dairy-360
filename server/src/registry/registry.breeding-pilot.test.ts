// Breeding stage 2: the pilot list -- which animals POST /breeding/events accepts.

import assert from 'node:assert';
import { test } from 'node:test';

import { BREEDING_PILOT, breedingHerd } from './breeding-fixtures';
import { breedingEntryOpen, parseBreedingPilot, pilotIdsNotFound } from './breeding-pilot';
import { addAcquired } from './fixtures';

test('parseBreedingPilot splits on commas, trims and drops empties', () => {
  assert.deepEqual(parseBreedingPilot(' BD-0007, BD-0009 ,,'), ['BD-0007', 'BD-0009']);
  assert.deepEqual(parseBreedingPilot(undefined), []);
  assert.deepEqual(parseBreedingPilot(''), []);
});

test('pilotIdsNotFound names ids that are not female animals; breedingEntryOpen needs the list and a female', () => {
  const db = breedingHerd();
  addAcquired(db, { id: 'BD-0099', sex: 'male', acquired_on: '2023-06-01', acquired_precision: 'day' });
  assert.deepEqual(pilotIdsNotFound(db, ['BD-0007', 'BD-007', 'BD-0099']), ['BD-007', 'BD-0099']);
  assert.equal(breedingEntryOpen(db, 'BD-0007', BREEDING_PILOT), true);
  assert.equal(breedingEntryOpen(db, 'BD-0006', BREEDING_PILOT), false);
  assert.equal(breedingEntryOpen(db, 'BD-0099', ['BD-0099']), false, 'a male is never open');
});
