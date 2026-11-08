// Labour's dates in words (UI_SYSTEM §6.1): "31 Oct 2026", "Oct 2026",
// "1–15 Nov 2026". Labour printed every one as ISO ("2026-10-01 → 2026-10-31").

import { readableParts } from './precision-display';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "31 Oct 2026". */
export function dayText(on: string | null | undefined): string {
  if (!on) return '';
  return readableParts(on.slice(0, 10), 'day').figure;
}

/** "Oct 2026" from "2026-10". */
export function monthText(month: string | null | undefined): string {
  if (!month) return '';
  const [y, m] = month.split('-').map(Number);
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${y}` : month;
}

function lastDay(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * A pay period in words: "Oct 2026" for a whole month, "1–15 Nov 2026"
 * inside one month, "28 Sep – 3 Oct 2026" across two, a single day alone.
 */
export function periodText(from: string | null | undefined, to: string | null | undefined): string {
  if (!from) return '';
  if (!to || to === from) return dayText(from);
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (fy === ty && fm === tm) {
    if (fd === 1 && td === lastDay(ty, tm)) return `${MONTHS[fm - 1]} ${fy}`;
    return `${fd}–${td} ${MONTHS[fm - 1]} ${fy}`;
  }
  if (fy === ty) return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${dayText(from)} – ${dayText(to)}`;
}

/** "Since 11 Jul 2026", or "11 Jul 2026 to 3 Oct 2026" once closed. */
export function stintText(started: string, ended: string | null | undefined): string {
  return ended ? `${dayText(started)} to ${dayText(ended)}` : `Since ${dayText(started)}`;
}

/** A person's name, with the identifier only when it says something more. */
export function personLabel(p: { identifier: string; name?: string | null }): { name: string; id: string | null } {
  const name = p.name?.trim();
  if (!name) return { name: p.identifier, id: null };
  return { name, id: name.toLocaleLowerCase() === p.identifier.toLocaleLowerCase() ? null : p.identifier };
}
