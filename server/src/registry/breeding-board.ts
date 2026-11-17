// Breeding stage 3: the board of tasks, and the one per-animal derivation.
//
// `breedingForAnimal` is the single place a female's view, notes and tasks are
// worked out from her events; the animal detail and the board both call it, so
// the in-milk flag and the as-of cut are never a second copy. Nothing is stored.

import { reproductionNotes } from './breeding-notes';
import type { ReproductionNote } from './breeding-notes';
import { breedingEntryOpen } from './breeding-pilot';
import { breedingTasks } from './breeding-tasks';
import type { BreedingTask } from './breeding-tasks';
import { canonicalOrder, effectiveEvents, projectLactations, projectStatus } from './project';
import { attributionChanged, deriveReproduction } from './reproduction';
import type { Db } from './schema';
import { allAnimals, eventsForAnimal } from './store';
import type { RegistryAnimalRow, RegistryEvent, ReproductionView } from './types';

export interface BreedingForAnimal {
  view: ReproductionView | null;
  notes: ReproductionNote[];
  tasks: BreedingTask[];
}

/**
 * Only what had happened by `asOf`: a dry-off or a departure dated later must
 * not change the state on an earlier day, so both the in-milk flag and the
 * departure are projected from the effective events dated <= asOf.
 */
export function breedingForAnimal(animal: RegistryAnimalRow, rows: RegistryEvent[], asOf: string): BreedingForAnimal {
  const upTo = canonicalOrder(effectiveEvents(rows)).filter((e) => e.occurred_on <= asOf);
  const lactations = projectLactations(animal.id, upTo);
  const departed = projectStatus({ animal, ordered: upTo, lactations, asOf }).status === 'departed';
  // In milk = one of her lactations had no end on asOf.
  const inMilk = lactations.some((l) => l.ended_on === null);
  const view = animal.sex !== 'female' || departed ? null : deriveReproduction({ events: rows, asOf, inMilk });
  if (!view) return { view: null, notes: [], tasks: [] };
  return {
    view,
    notes: reproductionNotes(view, { inMilk, attributionChanged: attributionChanged({ events: rows, asOf, inMilk }) }),
    tasks: breedingTasks(view, { animal_id: animal.id, inMilk }),
  };
}

export interface BreedingCaseRow {
  animal_id: string;
  animal_name: string | null;
  view: ReproductionView;
  notes: ReproductionNote[];
  tasks: BreedingTask[];
  /** breedingEntryOpen(db, animal_id, pilot): the page may enter for her. */
  entry_open: boolean;
}

export interface BreedingBoard {
  on: string;
  /** Overdue first, then due; within each by red_on (none last), then animal_id. */
  tasks: (BreedingTask & { animal_name: string | null })[];
  overdue: number;
  due: number;
  /** Every current female with a non-null view. */
  cases: BreedingCaseRow[];
}

export function breedingBoard(db: Db, on: string, pilot: readonly string[]): BreedingBoard {
  const cases: BreedingCaseRow[] = [];
  for (const animal of allAnimals(db)) {
    if (animal.sex !== 'female') continue;
    const r = breedingForAnimal(animal, eventsForAnimal(db, animal.id), on);
    if (!r.view) continue;
    cases.push({
      animal_id: animal.id,
      animal_name: animal.name,
      view: r.view,
      notes: r.notes,
      tasks: r.tasks,
      entry_open: breedingEntryOpen(db, animal.id, pilot),
    });
  }
  const tasks = cases.flatMap((c) => c.tasks.map((t) => ({ ...t, animal_name: c.animal_name })));
  const rank = (t: BreedingTask) => (t.standing === 'overdue' ? 0 : 1);
  tasks.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.red_on !== b.red_on) {
      if (a.red_on === null) return 1;
      if (b.red_on === null) return -1;
      return a.red_on < b.red_on ? -1 : 1;
    }
    return a.animal_id < b.animal_id ? -1 : a.animal_id > b.animal_id ? 1 : 0;
  });
  const overdue = tasks.filter((t) => t.standing === 'overdue').length;
  return { on, tasks, overdue, due: tasks.length - overdue, cases };
}
