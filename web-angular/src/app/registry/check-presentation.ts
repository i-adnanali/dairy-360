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
      heading: 'Identifier not linked to a person',
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
          ? 'Overlapping engagements'
          : 'Multiple active engagements',
      context: `${c.engagementIds.length} engagements${c.kind === 'multiple_open_engagements' ? ' · As of ' + c.asOf : ''}`,
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
    const period = `${c.fromOn} through ${c.toOn}`;
    if (c.kind === 'wage_period_outside_engagement')
      return { heading: 'Wage period outside engagement', context: period, link };
    if (!Number.isSafeInteger(c.amountMinor) || !Number.isSafeInteger(c.agreementMinor))
      return fallback;
    return {
      heading: 'Recorded wage differs from agreement',
      context: `${period} · Recorded wage ${formatMinor(c.amountMinor)} · Agreement ${formatMinor(c.agreementMinor)}`,
      link,
    };
  }
  return fallback;
}
