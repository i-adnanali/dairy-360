// Breeding stage 4: the eight herd figures, computed on read.
//
// Every figure is counted from breedingCases (the cases) or deriveReproduction
// (a view on a day), read through reproductionAsOf, so no state rule, in-milk
// rule or departure rule is copied here and a figure cannot disagree with the
// badge. Nothing is stored. The definitions are in REGISTRY_BREEDING.md
// ("The eight figures"); registry.breeding-figures.test.ts pins them.
//
// The current females are every female that had not left by `on`, with or
// without a service; only those with a view on `on` have cases. P is `on` and the 364 days before it for '12m' (periodDays),
// every day up to `on` for 'all'. A case `replaced` by a new service with no
// loss recorded is counted apart: it is in none of the figures, and has its
// own rough line.

import { reproductionAsOf } from './breeding-board';
import { breedingCases } from './breeding-cases';
import type { BreedingCase, CaseOutcome } from './breeding-cases';
import { canonicalOrder, daysBetween, effectiveEvents } from './project';
import { addDays, BREEDING_TASK_DAYS, FIGURES } from './reproduction';
import type { Db } from './schema';
import { allAnimals, eventsForAnimal } from './store';
import type { DatePrecision, RegistryAnimalRow, RegistryEvent } from './types';

export type FiguresPeriod = '12m' | 'all';
/** `rate` is a whole percent of `of`, only when `of >= FIGURES.minCases`. */
export interface Count {
  n: number;
  of: number;
  rate: number | null;
}
export interface Spread {
  value: number | null;
  n: number;
  min: number | null;
  max: number | null;
  /** How many of the n use a month-precision date. */
  approximate: number;
}
export interface BreedingFigures {
  on: string;
  period: FiguresPeriod;
  /** The first day of P; null for 'all'. */
  from: string | null;
  /** Current females with a service in P. */
  animals: number;
  overdue_now: { n: number; animals: { animal_id: string; animal_name: string | null; day_max: number }[] };
  services_per_conception: { services: number; conceptions: number; value: number | null };
  held_to_first_service: Count & { pending: number };
  confirmed_by_day_60: Count & { later_days: number[] };
  /** Median, lower middle when even. */
  days_open: Spread;
  /** Mean, to a whole day. */
  calving_interval: Spread;
  losses: Count;
  heats_caught: { recorded: number; expected: number; estimated: true };
  by_animal: {
    animal_id: string;
    animal_name: string | null;
    services: number;
    first_service: CaseOutcome | null;
    confirmed_day: number | null;
    days_open: number | null;
    calving_interval: number | null;
  }[];
  /** The "Why some figures are rough" lines. */
  rough: string[];
}

interface Female {
  animal: RegistryAnimalRow;
  rows: RegistryEvent[];
  cases: BreedingCase[];
}

/** One measured span (days open or a calving interval) of one animal. */
interface Span {
  animal_id: string;
  days: number;
  approximate: boolean;
}

function count(n: number, of: number): Count {
  return { n, of, rate: of >= FIGURES.minCases ? Math.round((100 * n) / of) : null };
}

function spread(spans: Span[], value: (days: number[]) => number): Spread {
  const days = spans.map((s) => s.days).sort((a, b) => a - b);
  return {
    value: days.length > 0 ? value(days) : null,
    n: days.length,
    min: days.length > 0 ? days[0] : null,
    max: days.length > 0 ? days[days.length - 1] : null,
    approximate: spans.filter((s) => s.approximate).length,
  };
}

/** "1 service has ..." / "2 services have ...". */
function line(k: number, one: string, many: string, rest: string): string {
  return `${k} ${k === 1 ? one : many} ${rest}`;
}

export function breedingFigures(db: Db, on: string, period: FiguresPeriod): BreedingFigures {
  const from = period === '12m' ? addDays(on, -(FIGURES.periodDays - 1)) : null;
  const inP = (d: string | null | undefined): d is string => !!d && d <= on && (from === null || d >= from);

  // The current females (not left by `on`), with their cases as of `on`.
  const females: Female[] = [];
  const overdue: BreedingFigures['overdue_now']['animals'] = [];
  for (const animal of allAnimals(db)) {
    if (animal.sex !== 'female') continue;
    const rows = eventsForAnimal(db, animal.id);
    const { current, view, inMilk } = reproductionAsOf(animal, rows, on);
    if (!current) continue;
    females.push({ animal, rows, cases: view ? breedingCases(rows, on, inMilk) : [] });
    if (view?.state === 'overdue') overdue.push({ animal_id: animal.id, animal_name: animal.name, day_max: view.day_max });
  }

  const all = females.flatMap((f) => f.cases);
  const counted = all.filter((c) => c.outcome !== 'replaced');
  const lastService = (c: BreedingCase) => c.services[c.services.length - 1];

  // Services per conception.
  const heldInP = counted.filter((c) => c.outcome === 'held' && inP(c.held_on));
  const services = heldInP.reduce((n, c) => n + c.services_since_calving, 0);
  const conceptions = heldInP.length;

  // Held to first service.
  const firsts = counted.filter((c) => c.starts_after_calving && inP(c.services[0].occurred_on));
  const firstsDecided = firsts.filter((c) => c.outcome === 'held' || c.outcome === 'failed' || c.outcome === 'lost');

  // Confirmed by day 60.
  const confirmed = counted.filter((c) => c.outcome === 'held' && inP(c.first_reliable_positive?.occurred_on));
  const confirmedDays = confirmed.map((c) => c.first_reliable_positive!.day);
  const laterDays = confirmedDays.filter((d) => d > BREEDING_TASK_DAYS.checkRedAfter).sort((a, b) => a - b);

  // Days open. A span with an end known only to the year, or estimated, is left
  // out (measured dates are never pooled with estimated ones) and has a rough line.
  const measurable = (p: DatePrecision) => p === 'day' || p === 'month';
  const withCalving = heldInP.filter((c) => c.previous_calving !== null);
  const roughOpen = withCalving.filter(
    (c) => !measurable(c.previous_calving!.date_precision) || !measurable(lastService(c).date_precision),
  ).length;
  const open: Span[] = withCalving
    .filter((c) => measurable(c.previous_calving!.date_precision) && measurable(lastService(c).date_precision))
    .map((c) => ({
      animal_id: c.animal_id,
      days: daysBetween(c.previous_calving!.occurred_on, lastService(c).occurred_on),
      approximate: c.previous_calving!.date_precision === 'month' || lastService(c).date_precision === 'month',
    }));

  // Calving interval: consecutive effective calvings, the later in P, both day or month precision.
  const intervals: Span[] = [];
  for (const f of females) {
    const calvings = canonicalOrder(effectiveEvents(f.rows)).filter((e) => e.type === 'calving' && e.occurred_on <= on);
    for (let i = 1; i < calvings.length; i += 1) {
      const [a, b] = [calvings[i - 1], calvings[i]];
      if (!inP(b.occurred_on) || !measurable(a.date_precision) || !measurable(b.date_precision)) continue;
      intervals.push({
        animal_id: f.animal.id,
        days: daysBetween(a.occurred_on, b.occurred_on),
        approximate: a.date_precision === 'month' || b.date_precision === 'month',
      });
    }
  }

  // Losses: cases that had a reliable positive or a calving (held_on) in P.
  const lossBase = counted.filter((c) => inP(c.held_on));

  // Heats caught.
  let recorded = 0;
  let eligibleDays = 0;
  for (const f of females) {
    const ordered = canonicalOrder(effectiveEvents(f.rows)).filter((e) => e.occurred_on <= on);
    recorded += ordered.filter((e) => e.type === 'heat_observed' && inP(e.occurred_on)).length;
    const breeding = ordered.filter((e) => e.type === 'calving' || e.type === 'insemination');
    if (breeding.length === 0) continue;
    const start = from !== null && from > breeding[0].occurred_on ? from : breeding[0].occurred_on;
    for (let d = start; d <= on; d = addDays(d, 1)) {
      const { current, view } = reproductionAsOf(f.animal, f.rows, d);
      if (!current) continue;
      if (view?.state === 'open') {
        eligibleDays += 1;
        continue;
      }
      // Calved at least voluntaryWaitDays before d, and no service since.
      const last = breeding.filter((e) => e.occurred_on <= d).pop();
      if (last?.type === 'calving' && daysBetween(last.occurred_on, d) >= FIGURES.voluntaryWaitDays) eligibleDays += 1;
    }
  }

  // By animal: the females with a service in P; each value is her latest in P.
  const latest = <T>(xs: T[]): T | null => (xs.length > 0 ? xs[xs.length - 1] : null);
  const byAnimal: BreedingFigures['by_animal'] = [];
  for (const f of females) {
    const servicesInP = f.cases.flatMap((c) => c.services).filter((s) => inP(s.occurred_on)).length;
    if (servicesInP === 0) continue;
    const mine = <T extends { animal_id: string }>(xs: T[]) => xs.filter((x) => x.animal_id === f.animal.id);
    byAnimal.push({
      animal_id: f.animal.id,
      animal_name: f.animal.name,
      services: servicesInP,
      first_service: latest(f.cases.filter((c) => c.starts_after_calving && inP(c.services[0].occurred_on)))?.outcome ?? null,
      confirmed_day: latest(mine(confirmed))?.first_reliable_positive?.day ?? null,
      days_open: latest(mine(open))?.days ?? null,
      calving_interval: latest(mine(intervals))?.days ?? null,
    });
  }
  byAnimal.sort((a, b) => (a.animal_id < b.animal_id ? -1 : a.animal_id > b.animal_id ? 1 : 0));
  overdue.sort((a, b) => (a.animal_id < b.animal_id ? -1 : a.animal_id > b.animal_id ? 1 : 0));

  // Why some figures are rough.
  const rough: string[] = [];
  const pending = counted
    .filter((c) => c.outcome === 'pending' && inP(lastService(c).occurred_on))
    .reduce((n, c) => n + c.services.length, 0);
  if (pending > 0) rough.push(line(pending, 'service has', 'services have', 'no outcome yet'));
  const noCalving = new Set(heldInP.filter((c) => c.previous_calving === null).map((c) => c.animal_id)).size;
  if (noCalving > 0) rough.push(line(noCalving, 'animal has', 'animals have', 'no earlier calving'));
  if (roughOpen > 0) {
    rough.push(line(roughOpen, 'days-open span', 'days-open spans', 'left out because a date is known only to the year or estimated'));
  }
  const replaced = all.filter((c) => c.outcome === 'replaced' && inP(c.closed_by?.occurred_on));
  const replacedHeld = replaced.filter((c) => c.first_reliable_positive !== null).length;
  const replacedOpen = replaced.length - replacedHeld;
  if (replacedHeld > 0) {
    rough.push(line(replacedHeld, 'confirmed pregnancy', 'confirmed pregnancies', 'followed by a new service with no loss recorded'));
  }
  if (replacedOpen > 0) {
    rough.push(line(replacedOpen, 'service', 'services', 'followed by a new service with no outcome recorded'));
  }
  rough.push('expected heats are estimated');

  return {
    on,
    period,
    from,
    animals: byAnimal.length,
    overdue_now: { n: overdue.length, animals: overdue },
    services_per_conception: {
      services,
      conceptions,
      value: conceptions >= FIGURES.minCases ? Math.round((10 * services) / conceptions) / 10 : null,
    },
    held_to_first_service: {
      ...count(firstsDecided.filter((c) => c.outcome === 'held').length, firstsDecided.length),
      pending: firsts.length - firstsDecided.length,
    },
    confirmed_by_day_60: { ...count(confirmedDays.length - laterDays.length, confirmedDays.length), later_days: laterDays },
    days_open: spread(open, (d) => d[Math.floor((d.length - 1) / 2)]),
    calving_interval: spread(intervals, (d) => Math.round(d.reduce((a, b) => a + b, 0) / d.length)),
    losses: count(lossBase.filter((c) => c.outcome === 'lost').length, lossBase.length),
    heats_caught: { recorded, expected: Math.floor(eligibleDays / FIGURES.cycleDays), estimated: true },
    by_animal: byAnimal,
    rough,
  };
}
