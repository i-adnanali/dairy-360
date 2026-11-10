import { dayText, periodText } from './labour-format';
import type { LabourReportLine } from '@dairy/shared';
import { formatMinor } from './money';

/** Never derive a navigation target or money from detail prose. */
export function labourPresentation(line: LabourReportLine): {
  heading: string;
  context: string;
  link: string[] | null;
} {
  const fallback = { heading: 'Advisory record', context: '', link: null };
  const c = line.context;
  if (!c || c.kind !== line.kind) return fallback;
  if (c.kind === 'unknown_identifier') {
    if (typeof c.identifier !== 'string' || !Number.isInteger(c.recordCount)) return fallback;
    return {
      heading: 'A name that is not on the People list',
      context: `${c.identifier} · ${c.recordCount} records`,
      link: ['/labour/people'],
    };
  }
  if (!('personId' in c) || typeof c.personId !== 'string' || !c.personId) return fallback;
  const link = ['/labour/people', c.personId];
  if (c.kind === 'overlapping_engagements' || c.kind === 'multiple_open_engagements') {
    if (!Array.isArray(c.engagementIds) || !c.engagementIds.every((id) => typeof id === 'string'))
      return fallback;
    if (c.kind === 'multiple_open_engagements' && (typeof c.asOf !== 'string' || !c.asOf))
      return fallback;
    return {
      heading:
        c.kind === 'overlapping_engagements'
          ? 'Overlapping stints'
          : 'More than one stint open',
      context: `${c.engagementIds.length} stints${c.kind === 'multiple_open_engagements' ? ' · as of ' + dayText(c.asOf) : ''}`,
      link,
    };
  }
  if (c.kind === 'wage_period_outside_engagement' || c.kind === 'amount_differs_from_term') {
    if (
      ![c.wageId, c.engagementId, c.fromOn, c.toOn].every(
        (v) => typeof v === 'string' && v.length > 0,
      )
    )
      return fallback;
    const period = periodText(c.fromOn, c.toOn);
    if (c.kind === 'wage_period_outside_engagement')
      return { heading: 'Wage outside the stint', context: period, link };
    if (!Number.isSafeInteger(c.amountMinor) || !Number.isSafeInteger(c.agreementMinor))
      return fallback;
    return {
      heading: 'Wage differs from the agreement',
      context: `${period} · Recorded wage ${formatMinor(c.amountMinor)} · Agreement ${formatMinor(c.agreementMinor)}`,
      link,
    };
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// CONTRADICTIONS (invariant violations), in the owner's words.
// ---------------------------------------------------------------------------
// The heading says what is wrong in farm terms; the server's sentence follows
// as the detail, and the machine name stays in Technical details. A name with
// no entry here falls back to its own words ("Duplicate price").

const VIOLATION_HEADINGS: Record<string, string> = {
  'one-origin-event': 'Birth or purchase missing, or recorded twice',
  'nothing-before-origin': 'A record dated before the animal arrived',
  'nothing-after-departure': 'A record dated after the animal left',
  'no-milking-after-departure': 'Milk recorded after the animal left',
  'calving-names-calf': "A calving and its calf's record disagree",
  'born-on-farm-has-dam': 'Born on the farm, but no mother recorded',
  'one-open-lactation': 'More than one lactation open at once',
  'superseded-excluded': 'A correction points at the wrong record',
  'serials-unique-monotonic': 'An animal number is out of sequence',
  'precision-date-conventions': 'A date stored more exactly than it was known',
  'time-only-at-day-precision': 'A time on a date that is not exact',
  'rebuild-fidelity': "An animal's saved summary does not match its history",
  'milking-status-matches-yield': 'A milking answer and its litres disagree',
  'one-milking-per-session': 'An animal milked twice in one session',
  'milking-inside-lactation': 'Milk recorded outside a lactation',
  duplicate_dispatch: 'A buyer recorded twice in one session',
  dispatch_status_disagrees: 'A dispatch answer and its litres disagree',
  dispatch_half_a_price: 'A dispatch with half a price',
  billable_dispatch_unpriced: 'Milk sold with no price',
  unbillable_dispatch_priced: 'Milk kept at home with a price',
  dispatch_unknown_destination: 'A dispatch to an unknown buyer',
  dispatch_outside_range: 'A dispatch outside the buyer’s dates',
  no_price_agreement: 'Milk sold with no agreed rate',
  duplicate_price: 'Two rates from the same day',
  silent_adjustment: 'A payment adjustment with no note',
  adjustment_unexplained: 'A wage adjustment with no note',
  wage_period_unpriced: 'A wage period with no agreed pay',
  overlapping_wage_period: 'Wage periods that overlap',
};

export function violationHeading(name: string): string {
  return (
    VIOLATION_HEADINGS[name] ??
    name.replaceAll('_', ' ').replaceAll('-', ' ').replace(/^./, (c) => c.toUpperCase())
  );
}

/** The detail sentence starts with a capital, like the rest of the page. */
export function sentence(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** "exact day", "month only": the precision words a reader uses. */
export function precisionWords(p: string): string {
  return (
    { day: 'Exact day', month: 'Month only', year: 'Year only', estimated: 'Estimated' }[p] ?? p
  );
}

/** "ApiError: The server failed…" -> "The server failed…". */
export function errorText(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason);
  return text.replace(/^[A-Za-z]*Error:\s*/, '');
}
