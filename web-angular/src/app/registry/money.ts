// Money, for display. The client half of server/src/registry/money.ts.
//
// ---------------------------------------------------------------------------
// THIS IS A DELIBERATE DUPLICATE, AND A SPEC ASSERTS THE TWO AGREE
// ---------------------------------------------------------------------------
// The dispatch sheet needs a running total as numbers are typed, so the browser
// has to compute an amount before the server has seen one. That is a genuine
// duplication of a rounding rule, which is a drift risk worth naming rather
// than hiding.
//
// The repo already has the pattern for this: `compareEvents()` in project.ts
// reimplements the canonical SQL ordering for the pure core, and a test asserts
// the two agree on real rows. Same arrangement here -- the SERVER's figure is
// authoritative, the client's is provisional, and money.spec.ts pins them
// together on a fixture.
//
// If these ever disagree, the server is right.

/** Paisa per rupee. */
export const MINOR_PER_UNIT = 100;

/**
 * What a quantity of milk costs, in paisa.
 *
 * `unitLitres` has NO DEFAULT here either. A default of 1 would make a
 * forgotten argument a fortyfold overcharge that still looks like a price, and
 * on this screen it would be shown to the operator as a running total they
 * would have no reason to doubt.
 */
export function amountMinor(litres: number, priceMinor: number, unitLitres: number): number {
  if (!Number.isFinite(litres) || litres < 0) return 0;
  if (!Number.isFinite(priceMinor) || priceMinor < 0) return 0;
  if (!Number.isFinite(unitLitres) || unitLitres <= 0) return 0;
  return Math.round((litres * priceMinor) / unitLitres);
}

/**
 * Paisa as rupees. ALWAYS two decimals.
 *
 * A column where some rows show paisa and some do not cannot be scanned, and
 * "Rs 7,000" beside "Rs 7,000.50" invites reading the first as approximate.
 * Plain grouping rather than `Intl`, so the statement a buyer is shown does not
 * depend on which ICU data the browser ships.
 */
export function formatMinor(minor: number): string {
  if (!Number.isFinite(minor)) return '—';
  const rounded = Math.round(minor);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const rupees = Math.trunc(abs / MINOR_PER_UNIT);
  const paisa = abs % MINOR_PER_UNIT;
  const grouped = String(rupees).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}Rs ${grouped}.${String(paisa).padStart(2, '0')}`;
}

/**
 * A rate AS AGREED -- "Rs 7,000.00 / 40 L".
 *
 * Never converted to per-litre. The statement line has to be arithmetic the
 * buyer can check against his own khata, and converting his rate into ours is
 * the one edit that would stop him being able to.
 */
export function formatRate(priceMinor: number, unitLitres: number): string {
  return `${formatMinor(priceMinor)} / ${unitLitres} L`;
}

/**
 * The derived per-litre rate, for the entry form to SHOW BACK what it
 * understood.
 *
 * Shown, never typed -- the same parse-then-show-back contract as
 * PrecisionDateControl, and the place a factor-of-forty slip becomes visible
 * instead of silent.
 */
export function perLitreLabel(priceMinor: number, unitLitres: number): string {
  if (!Number.isFinite(unitLitres) || unitLitres <= 0) return '—';
  return `${formatMinor(priceMinor / unitLitres)} per litre`;
}

/** Rupees typed by a person into whole paisa. Returns null for anything else. */
export function rupeesToMinor(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (t.length === 0) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * MINOR_PER_UNIT);
}

/** Paisa back into a plain editable rupee string -- no grouping, no currency. */
export function minorToRupees(minor: number): string {
  const rupees = Math.trunc(Math.abs(minor) / MINOR_PER_UNIT);
  const paisa = Math.abs(minor) % MINOR_PER_UNIT;
  const sign = minor < 0 ? '-' : '';
  return paisa === 0 ? `${sign}${rupees}` : `${sign}${rupees}.${String(paisa).padStart(2, '0')}`;
}

/**
 * A package rate as it was agreed -- "Rs 25,000.00 / month".
 *
 * The sibling of formatRate, and never converted to a per-day figure. Nobody is
 * paid "Rs 833.33 a day", and the statement is a document shown to the person
 * it is about. See docs/REGISTRY_PAYROLL.md §5.
 */
export function formatPeriodRate(cashMinor: number, period: 'month' | 'day'): string {
  return `${formatMinor(cashMinor)} / ${period}`;
}
