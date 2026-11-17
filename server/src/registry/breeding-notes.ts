// Breeding stage 3: the derived notes on an animal's reproductive state.
//
// PURE: worded from the ReproductionView and two facts about the read, never
// from a second copy of a rule. Computed on every read, never stored.

import { GESTATION } from './reproduction';
import type { ReproductionView } from './types';

export type ReproductionNoteCode =
  | 'null_observation'
  | 'negative_inside_exposure'
  | 'dry_off_while_unconfirmed'
  | 'wide_window'
  | 'attribution_changed';

export interface ReproductionNote {
  code: ReproductionNoteCode;
  text: string;
}

export function reproductionNotes(
  view: ReproductionView,
  ctx: { inMilk: boolean; attributionChanged: boolean },
): ReproductionNote[] {
  const notes: ReproductionNote[] = [];
  for (const o of view.null_observations) {
    notes.push({
      code: 'null_observation',
      text: `Watched for ${o.watched_for === 'heat' ? 'heat' : 'a pregnancy check'} on ${o.occurred_on} and nothing was seen. That records an absence; it is not evidence that she is not cycling.`,
    });
  }
  if (view.negative_inside_exposure) {
    notes.push({
      code: 'negative_inside_exposure',
      text: 'The negative check fell while the bull was still with her. He may have served her since, so she stays Open (worked out).',
    });
  }
  if (
    ctx.inMilk &&
    (view.state === 'bred' || view.state === 'unconfirmed') &&
    view.day_max >= GESTATION.expected - GESTATION.dryOffLead
  ) {
    notes.push({
      code: 'dry_off_while_unconfirmed',
      text: 'Dry-off would be due now if she is pregnant, but no check has confirmed it.',
    });
  }
  if (view.month_precision_service && view.window) {
    notes.push({
      code: 'wide_window',
      text: 'The calving window is wider because the service date is known to the month only.',
    });
  }
  if (ctx.attributionChanged) {
    notes.push({
      code: 'attribution_changed',
      text: 'The latest record changed which service this pregnancy is counted from.',
    });
  }
  return notes;
}
