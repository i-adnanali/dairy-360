// Animal registry -- the reproductive state, derived from an animal's events
// (docs/records/REGISTRY_BREEDING.md).
//
// PURE: no database, no clock. One ReproductionView per animal from her events
// at a date. Nothing here is stored; the view is recalculated on every read.
//
// THE RULES deriveReproduction implements (registry.reproduction.test.ts pins
// each line):
//
// Which events count. Take breedingOrder(effectiveEvents(events)), then drop
// every event whose occurred_on is after asOf. If no insemination remains,
// return null.
//
// The order. breedingOrder is canonicalOrder with one breeding rule: a
// heat_observed on the same calendar day as an insemination, where either of
// the two has no occurred_time, goes before that insemination, whatever order
// they were recorded in. It is the service's heat sign (heatBefore counts it),
// never a return to heat. When both have times, the times decide.
//
// The case. The anchor is the last insemination. Walking backwards from it, an
// earlier insemination joins the case when there is no calving, no abortion, no
// heat_observed and no pregnancy_check with result negative between it and the
// service after it; stop at the first one that does not join. services_in_case
// is the number joined, ambiguous_attribution is services_in_case > 1, and
// service describes the anchor.
//
// The conception range. For one service: earliest is its occurred_on; latest is
// the last day of that month when its precision is month, otherwise
// occurred_on, plus exposure_days when it is a bull_exposure.
// conception_earliest is the smallest earliest and conception_latest the
// largest latest across the case. Let W = daysBetween(conception_earliest,
// conception_latest) and T = daysBetween(conception_earliest, asOf). Every
// "day" below counts from conception_earliest.
//
// The evidence. Events after the earliest service of the case, in order:
// calving, abortion, heat_observed, pregnancy_check. Walk the checks in order
// keeping pos, lostBy, openBy: a positive sets pos and clears the other two; a
// negative on or after its method's negative day sets lostBy and clears pos
// when a pos is held, else sets openBy; a negative before that day is ignored.
// heat is the latest heat_observed. latest_check is the last check walked;
// reliable is whether its day is on or after its method's day for its result
// (false for a progesterone positive). first_reliable_positive is the first
// positive walked whose day is on or after its method's positive day; it is
// kept even when a later check clears pos. case_services lists the case's
// services, earliest first.
//
// The state, first match wins:
//   1  a calving is in the evidence                         calved       observed
//   2  an abortion is in the evidence                       lost         observed
//   3  lostBy is set                                        lost         inferred
//   4  pos is set, and it is progesterone, or its day is
//      before its method's positive day, or heat is dated
//      after it                                             recheck      inferred
//   5  pos is set and T > W + 325                           overdue      inferred
//   6  pos is set and T >= 285                              window       inferred
//   7  pos is set and T >= 264                              close        inferred
//   8  pos is set, inMilk, and T >= 248                     dryoff       inferred
//   9  pos is set                                           confirmed    observed
//  10  openBy is set                                        open         observed, or inferred
//      when the anchor is a bull_exposure and the check's day is <= W
//  11  heat is set, unless the anchor is a bull_exposure
//      and the heat's day is <= W                           open         inferred
//  12  T <= W + 24                                          bred         observed
//  13  otherwise                                            unconfirmed  inferred
//
// The window. null for calved, lost, open; otherwise opens_on =
// conception_earliest + 285 and closes_on = conception_latest + 325.
//
// These gestation figures are NOT calving.ts's GESTATION_DAYS, which is a
// calving-too-soon-after-birth floor and is deliberately not used here.

import { canonicalOrder, daysBetween, effectiveEvents } from './project';
import type {
  CheckMethod,
  CheckResult,
  InseminationPayload,
  PregnancyCheckPayload,
  RegistryEvent,
  ReproductionBasis,
  ReproductionView,
  ReproductiveState,
  WatchedFor,
} from './types';

/** In days from the earliest possible conception. */
export const GESTATION = {
  windowOpens: 285,
  windowCloses: 325,
  expected: 308,
  closeUpLead: 21,
  dryOffLead: 60,
  bredThrough: 24,
} as const;

/** Spec rows; kinds in REGISTRY_BREEDING.md. */
export const HEAT_SIGN = { hoursBefore: 36, calendarDaysBack: 1 } as const;
export const BREEDING_TASK_DAYS = {
  heatWatchFrom: 18,
  checkRedAfter: 60,
  calvingWatchRedAfter: 318,
  overdueFrom: 333,
  overdueRedAfter: 346,
} as const;

/**
 * The herd figures (REGISTRY_BREEDING.md, stage 4). minCases: a rate is shown
 * only over at least this many cases (farm-tunable default). cycleDays: the
 * heat cycle (biological constant, high confidence). voluntaryWaitDays: days
 * after a calving before she is eligible to be served (farm-tunable default,
 * low confidence). periodDays: the trailing period (farm-tunable default).
 */
export const FIGURES = { minCases: 10, cycleDays: 21, voluntaryWaitDays: 45, periodDays: 365 } as const;

/**
 * The day close-up starts (264: back from the window opening) and the day
 * dry-off starts (248: back from the expected day).
 */
const CLOSE_UP_FROM = GESTATION.windowOpens - GESTATION.closeUpLead;
const DRY_OFF_FROM = GESTATION.expected - GESTATION.dryOffLead;

/**
 * The earliest day a check's result counts, per method and result. `null`
 * means a positive by that method never counts on its own.
 */
export const CHECK_RELIABLE_FROM: Record<CheckMethod, { positive: number | null; negative: number }> = {
  palpation: { positive: 46, negative: 46 },
  ultrasound: { positive: 30, negative: 30 },
  pag: { positive: 28, negative: 28 },
  progesterone: { positive: null, negative: 20 },
};

/** `on` plus `days`, both as `YYYY-MM-DD` calendar dates, composed in UTC. */
export function addDays(on: string, days: number): string {
  const [y, m, d] = on.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The last calendar day of the month `on` falls in. */
function lastDayOfMonth(on: string): string {
  const [y, m] = on.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function servicePayload(e: RegistryEvent): InseminationPayload {
  return e.payload as unknown as InseminationPayload;
}

function checkPayload(e: RegistryEvent): PregnancyCheckPayload {
  return e.payload as unknown as PregnancyCheckPayload;
}

/** The latest a conception from this one service could have happened, from the view's `service`. */
export function serviceLatest(service: Pick<ReproductionView['service'], 'occurred_on' | 'date_precision' | 'service_type' | 'exposure_days'>): string {
  const base = service.date_precision === 'month' ? lastDayOfMonth(service.occurred_on) : service.occurred_on;
  return service.service_type === 'bull_exposure' ? addDays(base, service.exposure_days ?? 0) : base;
}

/** The latest a conception from this one service could have happened. */
function latestConception(service: RegistryEvent): string {
  const p = servicePayload(service);
  return serviceLatest({ ...service, service_type: p.service_type, exposure_days: p.exposure_days });
}

/** Is this same-day heat the sign for that service, so before it in breedingOrder? */
function heatGoesBefore(heat: RegistryEvent, service: RegistryEvent): boolean {
  return (
    heat.type === 'heat_observed' &&
    service.type === 'insemination' &&
    heat.occurred_on === service.occurred_on &&
    (!heat.occurred_time || !service.occurred_time)
  );
}

/**
 * canonicalOrder, then each same-day heat that heatGoesBefore a service sorted
 * after it moves to just before the first such service. Every reader that
 * relates heats to services in the breeding derivation uses this order.
 */
export function breedingOrder(events: RegistryEvent[]): RegistryEvent[] {
  const out: RegistryEvent[] = [];
  for (const e of canonicalOrder(events)) {
    const at = e.type === 'heat_observed' ? out.findIndex((s) => heatGoesBefore(e, s)) : -1;
    if (at >= 0) out.splice(at, 0, e);
    else out.push(e);
  }
  return out;
}

/** Does this event rule out that the service before it caused the case? */
function breaksCase(e: RegistryEvent): boolean {
  if (e.type === 'calving' || e.type === 'abortion' || e.type === 'heat_observed') return true;
  return e.type === 'pregnancy_check' && checkPayload(e).result === 'negative';
}

function reliableFrom(method: CheckMethod, result: CheckResult): number | null {
  return CHECK_RELIABLE_FROM[method][result];
}

/** Minutes from `a` to `b`, farm-local date and `HH:MM` as written (no Date, no timezone). */
function minutesBetween(a: { on: string; time: string }, b: { on: string; time: string }): number {
  const clock = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return daysBetween(a.on, b.on) * 1440 + clock(b.time) - clock(a.time);
}

/** Was a heat seen shortly before this service? Never counts a heat dated after it. */
function heatBefore(service: RegistryEvent, heats: RegistryEvent[]): boolean {
  return heats.some((h) => {
    if (h.occurred_time && service.occurred_time) {
      const gap = minutesBetween(
        { on: h.occurred_on, time: h.occurred_time },
        { on: service.occurred_on, time: service.occurred_time },
      );
      return gap >= 0 && gap <= HEAT_SIGN.hoursBefore * 60;
    }
    const days = daysBetween(h.occurred_on, service.occurred_on);
    return days >= 0 && days <= HEAT_SIGN.calendarDaysBack;
  });
}

export function deriveReproduction(opts: {
  events: RegistryEvent[];
  asOf: string;
  inMilk: boolean;
}): ReproductionView | null {
  const { asOf, inMilk } = opts;

  // Which events count.
  const ordered = breedingOrder(effectiveEvents(opts.events)).filter((e) => e.occurred_on <= asOf);
  const serviceAt: number[] = [];
  ordered.forEach((e, i) => {
    if (e.type === 'insemination') serviceAt.push(i);
  });
  if (serviceAt.length === 0) return null;

  // The case: the anchor, then earlier services while nothing between rules them out.
  const caseAt = [serviceAt[serviceAt.length - 1]];
  for (let k = serviceAt.length - 2; k >= 0; k -= 1) {
    const from = serviceAt[k];
    const to = caseAt[caseAt.length - 1];
    if (ordered.slice(from + 1, to).some(breaksCase)) break;
    caseAt.push(from);
  }
  const anchor = ordered[caseAt[0]];
  const anchorPayload = servicePayload(anchor);
  const firstAt = caseAt[caseAt.length - 1];

  // The conception range.
  let conceptionEarliest = anchor.occurred_on;
  let conceptionLatest = latestConception(anchor);
  for (const i of caseAt) {
    const s = ordered[i];
    if (s.occurred_on < conceptionEarliest) conceptionEarliest = s.occurred_on;
    const latest = latestConception(s);
    if (latest > conceptionLatest) conceptionLatest = latest;
  }
  const W = daysBetween(conceptionEarliest, conceptionLatest);
  const T = daysBetween(conceptionEarliest, asOf);
  const dayOf = (e: RegistryEvent) => daysBetween(conceptionEarliest, e.occurred_on);
  /** The one reliability rule: a check counts on or after its method's day for its result. */
  const isReliable = (check: RegistryEvent) => {
    const { method, result } = checkPayload(check);
    const from = reliableFrom(method, result);
    return from !== null && dayOf(check) >= from;
  };

  // The evidence.
  const evidence = ordered.slice(firstAt + 1);
  const calved = evidence.some((e) => e.type === 'calving');
  const aborted = evidence.some((e) => e.type === 'abortion');
  let heat: RegistryEvent | null = null;
  let pos: RegistryEvent | null = null;
  let lostBy: RegistryEvent | null = null;
  let openBy: RegistryEvent | null = null;
  let lastCheck: RegistryEvent | null = null;
  let firstReliablePositive: RegistryEvent | null = null;
  for (const e of evidence) {
    if (e.type === 'heat_observed') heat = e;
    if (e.type !== 'pregnancy_check') continue;
    lastCheck = e;
    if (checkPayload(e).result === 'positive') {
      if (!firstReliablePositive && isReliable(e)) firstReliablePositive = e;
      pos = e;
      lostBy = null;
      openBy = null;
    } else if (isReliable(e)) {
      if (pos) {
        lostBy = e;
        pos = null;
      } else {
        openBy = e;
      }
    }
  }

  // The state, first match wins.
  const bullIn = anchorPayload.service_type === 'bull_exposure';
  let state: ReproductiveState;
  let basis: ReproductionBasis;
  let heatAfterPositive = false;
  let negativeInsideExposure = false;
  if (calved) {
    [state, basis] = ['calved', 'observed'];
  } else if (aborted) {
    [state, basis] = ['lost', 'observed'];
  } else if (lostBy) {
    [state, basis] = ['lost', 'inferred'];
  } else if (pos) {
    heatAfterPositive = heat !== null && heat.occurred_on > pos.occurred_on;
    if (!isReliable(pos) || heatAfterPositive) {
      [state, basis] = ['recheck', 'inferred'];
    } else if (T > W + GESTATION.windowCloses) {
      [state, basis] = ['overdue', 'inferred'];
    } else if (T >= GESTATION.windowOpens) {
      [state, basis] = ['window', 'inferred'];
    } else if (T >= CLOSE_UP_FROM) {
      [state, basis] = ['close', 'inferred'];
    } else if (inMilk && T >= DRY_OFF_FROM) {
      [state, basis] = ['dryoff', 'inferred'];
    } else {
      [state, basis] = ['confirmed', 'observed'];
    }
  } else if (openBy) {
    negativeInsideExposure = bullIn && dayOf(openBy) <= W;
    [state, basis] = ['open', negativeInsideExposure ? 'inferred' : 'observed'];
  } else if (heat && !(bullIn && dayOf(heat) <= W)) {
    [state, basis] = ['open', 'inferred'];
  } else if (T <= W + GESTATION.bredThrough) {
    [state, basis] = ['bred', 'observed'];
  } else {
    [state, basis] = ['unconfirmed', 'inferred'];
  }

  // The window.
  const window =
    state === 'calved' || state === 'lost' || state === 'open'
      ? null
      : {
          opens_on: addDays(conceptionEarliest, GESTATION.windowOpens),
          closes_on: addDays(conceptionLatest, GESTATION.windowCloses),
        };

  let latestCheck: ReproductionView['latest_check'] = null;
  if (lastCheck) {
    const { method, result } = checkPayload(lastCheck);
    latestCheck = {
      event_id: lastCheck.id,
      method,
      result,
      occurred_on: lastCheck.occurred_on,
      day: dayOf(lastCheck),
      reliable: isReliable(lastCheck),
    };
  }

  const monthPrecision = caseAt.some((i) => ordered[i].date_precision === 'month');
  const heatSign: ReproductionView['heat_sign_before_service'] =
    bullIn || anchor.date_precision === 'month'
      ? 'unknowable'
      : heatBefore(anchor, ordered.filter((e) => e.type === 'heat_observed')) ? 'seen' : 'not_seen';

  return {
    state,
    basis,
    as_of: asOf,
    service: {
      event_id: anchor.id,
      service_type: anchorPayload.service_type,
      occurred_on: anchor.occurred_on,
      date_precision: anchor.date_precision,
      exposure_days: anchorPayload.exposure_days,
    },
    services_in_case: caseAt.length,
    ambiguous_attribution: caseAt.length > 1,
    conception_earliest: conceptionEarliest,
    conception_latest: conceptionLatest,
    day_min: Math.max(0, daysBetween(conceptionLatest, asOf)),
    day_max: T,
    window,
    latest_check: latestCheck,
    heat_sign_before_service: heatSign,
    heat_after_positive: heatAfterPositive,
    null_observations: evidence
      .filter((e) => e.type === 'null_observation')
      .map((e) => ({
        watched_for: (e.payload as unknown as { watched_for: WatchedFor }).watched_for,
        occurred_on: e.occurred_on,
      })),
    negative_inside_exposure: negativeInsideExposure,
    month_precision_service: monthPrecision,
    case_services: [...caseAt].reverse().map((i) => ({
      event_id: ordered[i].id,
      occurred_on: ordered[i].occurred_on,
      date_precision: ordered[i].date_precision,
    })),
    first_reliable_positive: firstReliablePositive
      ? { event_id: firstReliablePositive.id, occurred_on: firstReliablePositive.occurred_on, day: dayOf(firstReliablePositive) }
      : null,
  };
}

/**
 * Would the most recently recorded event, taken away, have changed which
 * service this pregnancy is counted from? That is the case, not only its
 * anchor: true when both views exist and any of service.event_id,
 * services_in_case or conception_earliest differ between them. The earlier
 * view is the raw events minus the latest recorded, with supersession applied
 * as usual, so a record that the removed one corrected comes back.
 */
export function attributionChanged(opts: { events: RegistryEvent[]; asOf: string; inMilk: boolean }): boolean {
  const raw = opts.events.filter((e) => e.occurred_on <= opts.asOf);
  if (raw.length === 0) return false;
  const latest = raw.reduce((a, b) => (b.recorded_at > a.recorded_at ? b : a));
  const withIt = deriveReproduction({ ...opts, events: raw });
  const without = deriveReproduction({ ...opts, events: raw.filter((e) => e !== latest) });
  return (
    withIt !== null &&
    without !== null &&
    (withIt.service.event_id !== without.service.event_id ||
      withIt.services_in_case !== without.services_in_case ||
      withIt.conception_earliest !== without.conception_earliest)
  );
}
