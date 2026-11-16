// How a reproductive state reads on the page. The server decides the state;
// this only names and tones it.

import type { BadgeTone } from '../ui/surface';
import type { ReproductionBasis, ReproductionView, ReproductiveState, ServiceType } from './types';

/** Same states, same order as the server's REPRODUCTIVE_STATES. */
export const REPRODUCTIVE_STATES: readonly ReproductiveState[] = [
  'calved', 'lost', 'overdue', 'window', 'close', 'dryoff',
  'confirmed', 'recheck', 'unconfirmed', 'bred', 'open',
];

const PRESENTATION: Record<ReproductiveState, { label: string; tone: BadgeTone }> = {
  calved: { label: 'Calved', tone: 'success' },
  lost: { label: 'Lost', tone: 'danger' },
  overdue: { label: 'Overdue', tone: 'danger' },
  window: { label: 'Calving window', tone: 'warning' },
  close: { label: 'Close to calving', tone: 'warning' },
  dryoff: { label: 'Due to dry off', tone: 'warning' },
  confirmed: { label: 'Confirmed pregnant', tone: 'success' },
  recheck: { label: 'Pregnant, re-check due', tone: 'warning' },
  unconfirmed: { label: 'Pregnancy unconfirmed', tone: 'neutral' },
  bred: { label: 'Bred', tone: 'brand' },
  open: { label: 'Open', tone: 'ended' },
};

export function reproductionLabel(state: ReproductiveState): string {
  return PRESENTATION[state].label;
}

export function reproductionTone(state: ReproductiveState): BadgeTone {
  return PRESENTATION[state].tone;
}

export function basisWord(basis: ReproductionBasis): 'recorded' | 'worked out' {
  return basis === 'observed' ? 'recorded' : 'worked out';
}

const SERVICE_WORDS: Record<ServiceType, string> = {
  ai: 'AI',
  natural_observed: 'Bull, seen',
  bull_exposure: 'Bull running with her',
};

/** "AI" | "Bull, seen" | "Bull running with her" */
export function serviceWord(t: ServiceType): string {
  return SERVICE_WORDS[t];
}

/** "Day 35", or "Day 91 to 165" when day_min and day_max differ. */
export function dayRange(v: ReproductionView): string {
  return v.day_min === v.day_max ? `Day ${v.day_min}` : `Day ${v.day_min} to ${v.day_max}`;
}
