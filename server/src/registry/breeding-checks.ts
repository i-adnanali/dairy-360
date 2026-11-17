// Animal registry -- the five breeding warnings.
//
//   ambiguous_service      an insemination that joins an earlier service's case
//   early_check            a pregnancy check before its method can be relied on
//   check_without_service  a pregnancy check with no service on or before it
//   no_heat_sign           an insemination with no heat sign before it
//   heat_after_positive    a heat dated after the latest positive check
//
// The derivation answers; this module only words the answer.

import { CHECK_RELIABLE_FROM, deriveReproduction } from './reproduction';
import type { BreedingOverriddenCheck, CheckMethod, PregnancyCheckPayload, RegistryEvent } from './types';

export interface BreedingWarning {
  check: BreedingOverriddenCheck;
  /** The sentence the page shows, verbatim. */
  message: string;
  /** Always 'occurred_on': the page binds the message to the date control. */
  field: 'occurred_on';
}

const METHOD_WORD: Record<CheckMethod, string> = {
  palpation: 'check by hand',
  ultrasound: 'ultrasound',
  pag: 'PAG blood test',
  progesterone: 'progesterone test',
};

/**
 * Every warning this event would raise, in a fixed order: ambiguous_service,
 * no_heat_sign, early_check, check_without_service, heat_after_positive.
 * Pure: no database, no clock.
 */
export function breedingWarnings(events: RegistryEvent[], candidate: RegistryEvent): BreedingWarning[] {
  if (candidate.type !== 'insemination' && candidate.type !== 'pregnancy_check' && candidate.type !== 'heat_observed') return [];
  // Events dated after the candidate do not count: a back-dated entry is judged
  // by what had happened by its own date.
  const view = deriveReproduction({ events: [...events, candidate], asOf: candidate.occurred_on, inMilk: false });
  const warn = (check: BreedingOverriddenCheck, message: string): BreedingWarning =>
    ({ check, message, field: 'occurred_on' });
  const out: BreedingWarning[] = [];

  if (candidate.type === 'insemination') {
    // The candidate must be the anchor of its case, or the answer is about another service.
    if (!view || view.service.event_id !== candidate.id) return out;
    if (view.services_in_case > 1) {
      const k = view.services_in_case - 1;
      out.push(warn(
        'ambiguous_service',
        `${candidate.animal_id} has ${k} earlier service${k === 1 ? '' : 's'} in this case, the first on ${view.conception_earliest}, and nothing recorded since rules ${k === 1 ? 'it' : 'them'} out: no heat, no negative check, no calving or loss. Saved, this service joins that case and her calving window widens to cover it.`,
      ));
    }
    if (view.heat_sign_before_service === 'not_seen') {
      out.push(warn(
        'no_heat_sign',
        `No heat sign is recorded for ${candidate.animal_id} in the 36 hours before this service, or on its day or the day before when a time is missing. Saved, the service counts as it is; record the heat too if one was seen.`,
      ));
    }
    return out;
  }

  if (candidate.type === 'heat_observed') {
    const latest = view?.latest_check;
    if (view && latest && view.heat_after_positive && candidate.occurred_on > latest.occurred_on) {
      out.push(warn(
        'heat_after_positive',
        `${candidate.animal_id} has a positive check on ${latest.occurred_on}. A heat after it does not end the pregnancy on its own; she reads as Pregnant, re-check due until a check says otherwise.`,
      ));
    }
    return out;
  }

  if (!view) {
    return [warn(
      'check_without_service',
      `No service is recorded for ${candidate.animal_id} on or before ${candidate.occurred_on}. The check will be kept, but it does not change her state until a service before it is recorded.`,
    )];
  }
  const latest = view.latest_check;
  if (!latest || latest.event_id !== candidate.id || latest.reliable !== false) return out;
  const { method, result } = candidate.payload as unknown as PregnancyCheckPayload;
  const from = CHECK_RELIABLE_FROM[method][result];
  if (from === null) {
    return [warn('early_check', 'A progesterone test never confirms a pregnancy on its own. If saved, she reads as Pregnant, re-check due.')];
  }
  return [warn('early_check', `A ${METHOD_WORD[method]} is not relied on before day ${from}. This one is on day ${latest.day}.`)];
}
