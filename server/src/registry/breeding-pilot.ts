// Breeding stage 2: which animals POST /breeding/events is open for.
//
// A rollout control, not a rule about the farm's data: the list comes from
// REGISTRY_BREEDING_PILOT, read once in index.ts. The domain function
// recordBreedingEvent knows nothing of it, so the CLI is never gated.

import { getAnimal } from './store';
import type { Db } from './schema';

/** REGISTRY_BREEDING_PILOT as a list: split on commas, trimmed, empties dropped, order kept. */
export function parseBreedingPilot(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The ids in the list that are not female animals in the registry, for a startup warning. */
export function pilotIdsNotFound(db: Db, ids: readonly string[]): string[] {
  return ids.filter((id) => getAnimal(db, id)?.sex !== 'female');
}

/** Can this animal be entered for over HTTP? In the list, and female. */
export function breedingEntryOpen(db: Db, animalId: string, pilot: readonly string[]): boolean {
  return pilot.includes(animalId) && getAnimal(db, animalId)?.sex === 'female';
}
