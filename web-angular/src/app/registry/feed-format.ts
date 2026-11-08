// How Feed shows its stored values to a person.
//
// The feed screens printed the wire straight to the page: `2026-11-06`,
// `2026-11-06T13:28:31.389Z`, `direct_entry`, `water_mixed`, `cutting`. The rest
// of the app now says "6 Nov" and "6 Nov, 18:28" (farm time), so Feed does too.
// Nothing here changes a stored value; it only names it.

import { farmMoment, farmToday } from './today';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * "6 Nov" for a calendar date in the current farm year, "6 Nov 2025" otherwise.
 * A calendar date has no time zone, so this reads the string, never a Date in
 * host time. Anything that is not `YYYY-MM-DD` is returned unchanged.
 */
export function feedDay(on: string | null | undefined, today: string = farmToday()): string {
  if (!on) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(on);
  if (!m) return on;
  const day = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
  return m[1] === today.slice(0, 4) ? day : `${day} ${m[1]}`;
}

/** "Sun" for a calendar date -- the strip of days reads by weekday. */
export function feedWeekday(on: string): string {
  const [y, mo, d] = on.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
}

/** "Today", "Yesterday", or the date. */
export function feedRelativeDay(on: string, today: string = farmToday()): string {
  if (on === today) return 'Today';
  const t = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const o = Date.UTC(+on.slice(0, 4), +on.slice(5, 7) - 1, +on.slice(8, 10));
  if (t - o === 86_400_000) return 'Yesterday';
  return feedDay(on, today);
}

/** "Water mixed" from `water_mixed`. Sentence case, for a stored enum shown alone. */
export function feedLabel(v: string | null | undefined): string {
  if (!v) return '';
  const s = v.replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const SOURCE_FORMS: Record<string, string> = {
  daily_herd_sheet: 'Daily herd sheet',
  cycle_card: 'Cycle card',
  direct_entry: 'Direct entry',
  import: 'Import',
  recall: 'Recall', // same words as the session gate's choices
};

/** "Recorded by adnan · Direct entry · 6 Nov, 18:28 · Revision 1 · Ref harness fixture". */
export function feedProvenance(r: {
  recorded_by?: string | null;
  source_form?: string | null;
  recorded_at?: string | null;
  revision?: number | null;
  source_ref?: string | null;
}): string {
  const parts: string[] = [];
  if (r.recorded_by) parts.push(`Recorded by ${r.recorded_by}`);
  if (r.source_form) parts.push(SOURCE_FORMS[r.source_form] ?? feedLabel(r.source_form));
  if (r.recorded_at) parts.push(farmMoment(r.recorded_at));
  if (r.revision) parts.push(`Revision ${r.revision}`);
  parts.push(r.source_ref ? `Ref ${r.source_ref}` : 'No source reference');
  return parts.join(' · ');
}

/** Badge wording and tone for one day's feeding account. Missing is never "not fed". */
export function dayStanding(summary: { completeness?: string } | null): {
  label: string;
  tone: 'success' | 'warning' | 'ended';
} {
  if (!summary) return { label: 'Not recorded', tone: 'ended' };
  return summary.completeness === 'partial'
    ? { label: 'Partial', tone: 'warning' }
    : { label: 'Recorded', tone: 'success' };
}
