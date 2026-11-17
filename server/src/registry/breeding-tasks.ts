// Breeding stage 3: the tasks, computed on read from the ReproductionView.
//
// PURE and never stored: a task opens from a rule over the view and closes
// only when the matching event is recorded (the event changes the view). No
// task table, no projection, no second copy of a state rule.

import { BREEDING_TASK_DAYS, CHECK_RELIABLE_FROM, GESTATION, addDays } from './reproduction';
import type { ReproductionView, ReproductiveState } from './types';

export type BreedingTaskKind = 'heat_watch' | 'pregnancy_check' | 'recheck' | 'dry_off' | 'calving_watch' | 'overdue_review';

export interface BreedingTask {
  kind: BreedingTaskKind;
  animal_id: string;
  /** 'overdue' = past its red line; 'due' = open, not yet red. */
  standing: 'due' | 'overdue';
  day_min: number;
  day_max: number;
  /** The first day it is red; null for recheck. */
  red_from: number | null;
  /** Calendar date of red_from, counted from conception_earliest. */
  red_on: string | null;
}

export const BREEDING_TASK_LABEL: Record<BreedingTaskKind, string> = {
  heat_watch: 'Heat watch',
  pregnancy_check: 'Pregnancy check due',
  recheck: 'Recheck due',
  dry_off: 'Dry-off reminder',
  calving_watch: 'Calving watch',
  overdue_review: 'Overdue review',
};

const DRY_OFF_OPENS = GESTATION.expected - GESTATION.dryOffLead;
const DRY_OFF_RED = GESTATION.windowOpens - GESTATION.closeUpLead;
const PREGNANCY_CHECK_OPENS = CHECK_RELIABLE_FROM.pag.positive as number;

const UNCONFIRMED_STATES: ReproductiveState[] = ['bred', 'unconfirmed'];
const DRY_OFF_STATES: ReproductiveState[] = ['confirmed', 'dryoff', 'close', 'window', 'overdue'];
const CALVING_STATES: ReproductiveState[] = ['window', 'close', 'overdue'];
const ENDED_STATES: ReproductiveState[] = ['calved', 'lost', 'open'];

export function breedingTasks(view: ReproductionView | null, ctx: { animal_id: string; inMilk: boolean }): BreedingTask[] {
  if (!view) return [];
  const T = view.day_max;
  const noCheck = view.latest_check === null;
  const tasks: BreedingTask[] = [];

  /** `redFrom` is the first red day: the limit for a `>=` row, limit + 1 for a `>` row. */
  const add = (kind: BreedingTaskKind, redFrom: number | null) => {
    tasks.push({
      kind,
      animal_id: ctx.animal_id,
      standing: redFrom !== null && T >= redFrom ? 'overdue' : 'due',
      day_min: view.day_min,
      day_max: view.day_max,
      red_from: redFrom,
      red_on: redFrom === null ? null : addDays(view.conception_earliest, redFrom),
    });
  };

  if (T >= BREEDING_TASK_DAYS.heatWatchFrom && UNCONFIRMED_STATES.includes(view.state) && noCheck) {
    add('heat_watch', GESTATION.bredThrough);
  }
  if (T >= PREGNANCY_CHECK_OPENS && UNCONFIRMED_STATES.includes(view.state) && noCheck) {
    add('pregnancy_check', BREEDING_TASK_DAYS.checkRedAfter + 1);
  }
  if (view.state === 'recheck') add('recheck', null);
  if (T >= DRY_OFF_OPENS && ctx.inMilk && DRY_OFF_STATES.includes(view.state)) {
    add('dry_off', DRY_OFF_RED);
  }
  if (T >= GESTATION.windowOpens && CALVING_STATES.includes(view.state)) {
    add('calving_watch', BREEDING_TASK_DAYS.calvingWatchRedAfter + 1);
  }
  // The view exposes only the latest check, so "no check on or after day
  // 333" is that check's day counted from conception_earliest.
  if (
    T >= BREEDING_TASK_DAYS.overdueFrom &&
    !ENDED_STATES.includes(view.state) &&
    (view.latest_check === null || view.latest_check.day < BREEDING_TASK_DAYS.overdueFrom)
  ) {
    add('overdue_review', BREEDING_TASK_DAYS.overdueRedAfter + 1);
  }
  return tasks;
}
