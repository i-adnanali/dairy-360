// Breeding stage 4: every breeding case in a female's history, closed and current.
//
// PURE: no database, no clock. Every state here is deriveReproduction's answer,
// read at each case boundary; no state rule is copied, so the herd figures
// cannot disagree with the badge.
//
// THE RULES (registry.breeding-cases.test.ts pins them):
//
// Take canonicalOrder(effectiveEvents(events)) dated <= asOf. Every one of
// these events is a boundary, then asOf, so no case can fall between two
// boundaries and this file keeps no list of which events end a case. At a
// boundary event the view is derived over the events up to and including that
// event in canonical order, as of its date: a service recorded after a heat on
// the same day is not yet in the heat's view. The view at asOf is
// deriveReproduction over all the events, which is the badge's view.
//
// Each distinct service.event_id gives one case; its view at the last event
// where it is still the anchor (or at asOf) wins. A service that a later
// anchor's view lists in its case_services joined that case and gives none of
// its own. Outcome: lost when the state is lost; failed when it is open;
// held when it is calved or the view has a reliable positive (a non-lost,
// non-open view with one is confirmed, dryoff, close, window, overdue or
// recheck); otherwise pending. A held or pending case that a later case
// follows is replaced instead: a new service came with no loss recorded.
// closed_by is the boundary event at which the anchor's view entered its final
// state and basis, for calved, lost and open; for a replaced case it is the
// next case's first service (read from that case's view).
//
// inMilk: the caller passes today's value for every boundary. A past case's
// outcome does not depend on it: in-milk only decides dryoff against
// confirmed, and both are held.

import { canonicalOrder, effectiveEvents } from './project';
import { deriveReproduction } from './reproduction';
import type { DatePrecision, RegistryEvent, RegistryEventType, ReproductionView } from './types';

export type CaseOutcome = 'held' | 'failed' | 'lost' | 'pending' | 'replaced';

export interface BreedingCase {
  animal_id: string;
  /** The case's services in date order (ids and dates). */
  services: { event_id: string; occurred_on: string; date_precision: DatePrecision }[];
  /** True when the case's first service is the first insemination after the previous calving (or ever). */
  starts_after_calving: boolean;
  previous_calving: { occurred_on: string; date_precision: DatePrecision } | null;
  /** Services since the previous calving up to and including this case's last service. */
  services_since_calving: number;
  conception_earliest: string;
  conception_latest: string;
  /** First positive check past its method's reliable day: its date and day (from conception_earliest). */
  first_reliable_positive: { occurred_on: string; day: number } | null;
  outcome: CaseOutcome;
  /**
   * The calving, loss, heat or negative check that closed it, or for a replaced
   * case the next case's first service; null when pending or still held without a calving.
   */
  closed_by: { type: RegistryEventType; occurred_on: string; date_precision: DatePrecision } | null;
  loss_basis: 'observed' | 'inferred' | null;
  /** The date the case first counted as held: first reliable positive, else the calving. */
  held_on: string | null;
}

function outcomeOf(view: ReproductionView): CaseOutcome {
  if (view.state === 'lost') return 'lost';
  if (view.state === 'open') return 'failed';
  if (view.state === 'calved' || view.first_reliable_positive) return 'held';
  return 'pending';
}

export function breedingCases(events: RegistryEvent[], asOf: string, inMilk: boolean): BreedingCase[] {
  const ordered = canonicalOrder(effectiveEvents(events)).filter((e) => e.occurred_on <= asOf);

  // The latest view per anchor, and the boundary event at which that anchor's
  // view entered its current state (null when it entered at asOf).
  const latest = new Map<string, { view: ReproductionView; enteredAt: RegistryEvent | null }>();
  const take = (view: ReproductionView | null, at: RegistryEvent | null) => {
    if (!view) return;
    const prev = latest.get(view.service.event_id);
    const same = prev && prev.view.state === view.state && prev.view.basis === view.basis;
    const enteredAt = same ? prev.enteredAt : at;
    latest.set(view.service.event_id, { view, enteredAt });
  };

  ordered.forEach((e, i) => {
    take(deriveReproduction({ events: ordered.slice(0, i + 1), asOf: e.occurred_on, inMilk }), e);
  });
  take(deriveReproduction({ events: ordered, asOf, inMilk }), null);

  const joined = new Set<string>();
  for (const { view } of latest.values()) {
    for (const s of view.case_services) if (s.event_id !== view.service.event_id) joined.add(s.event_id);
  }

  const order = (id: string) => ordered.findIndex((e) => e.id === id);
  const kept = [...latest.values()]
    .filter(({ view }) => !joined.has(view.service.event_id))
    .sort((a, b) => order(a.view.case_services[0].event_id) - order(b.view.case_services[0].event_id));

  const cases: BreedingCase[] = [];
  kept.forEach(({ view, enteredAt }, k) => {
    const next = kept[k + 1]?.view.case_services[0];
    const services = view.case_services;
    const firstAt = order(services[0].event_id);
    const lastAt = order(view.service.event_id);
    let calvingAt = -1;
    for (let i = firstAt - 1; i >= 0; i -= 1) {
      if (ordered[i].type === 'calving') {
        calvingAt = i;
        break;
      }
    }
    const servicesBetween = (from: number, to: number) =>
      ordered.slice(from, to).filter((e) => e.type === 'insemination').length;
    const derived = outcomeOf(view);
    const replaced = next !== undefined && (derived === 'held' || derived === 'pending') && view.state !== 'calved';
    const outcome: CaseOutcome = replaced ? 'replaced' : derived;
    const closedState = view.state === 'calved' || view.state === 'lost' || view.state === 'open';
    const closer = replaced
      ? { type: 'insemination' as const, occurred_on: next.occurred_on, date_precision: next.date_precision }
      : closedState && enteredAt
        ? { type: enteredAt.type, occurred_on: enteredAt.occurred_on, date_precision: enteredAt.date_precision }
        : null;
    const frp = view.first_reliable_positive;
    const calvedOn = view.state === 'calved' && closer ? closer.occurred_on : null;
    cases.push({
      animal_id: ordered[lastAt].animal_id,
      services,
      starts_after_calving: servicesBetween(calvingAt + 1, firstAt) === 0,
      previous_calving:
        calvingAt >= 0
          ? { occurred_on: ordered[calvingAt].occurred_on, date_precision: ordered[calvingAt].date_precision }
          : null,
      services_since_calving: servicesBetween(calvingAt + 1, lastAt + 1),
      conception_earliest: view.conception_earliest,
      conception_latest: view.conception_latest,
      first_reliable_positive: frp ? { occurred_on: frp.occurred_on, day: frp.day } : null,
      outcome,
      closed_by: closer,
      loss_basis: view.state === 'lost' ? view.basis : null,
      held_on: frp ? frp.occurred_on : calvedOn,
    });
  });
  return cases;
}
