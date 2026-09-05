// Animal registry -- money. PURE (docs/REGISTRY_SALES.md §5).
//
// No `../db`, no clock, no filesystem. Three functions and a constant, and the
// whole point of the module is that there is exactly ONE place where litres
// become rupees.
//
// ---------------------------------------------------------------------------
// MONEY IS AN INTEGER NUMBER OF PAISA. NEVER `REAL`.
// ---------------------------------------------------------------------------
// The counterexample is already in this repo: `deliveries.price_per_litre REAL`
// (db.ts). Floating point is right for a MEASUREMENT, where the imprecision is
// honest and small -- `litres` stays REAL for exactly that reason. It is wrong
// for a quantity that has to add up exactly across a month and be agreed with
// another person at the end of it.
//
// ---------------------------------------------------------------------------
// A PRICE IS TWO NUMBERS, NOT ONE
// ---------------------------------------------------------------------------
// This farm prices in 40-litre lots -- "7,000 rupees per 40 litres", not "175
// rupees a litre". So a rate is `priceMinor` (the amount) AND `unitLitres` (the
// quantity it covers), stored verbatim as the agreement was struck, and the
// per-litre figure is derived when it is wanted rather than stored.
//
// This is date_precision applied to money: Rs 7,000/40 L and Rs 175.00/L are
// the same rate the way "March 2024" and "2024-03-01" are the same date, except
// one of them is what the person actually said. Normalising on entry would also
// not round-trip -- X rupees per 40 L is `X * 2.5` paisa per litre, so an odd
// rupee amount is not a whole number of paisa.
//
// See docs/REGISTRY_SALES.md §4.2 for the two consequences that are not about
// storage at all: the entry form would demand mental arithmetic, and the
// statement would be arithmetic the buyer cannot check against his own khata.

/** Paisa per rupee. The minor unit money is stored in. */
export const MINOR_PER_UNIT = 100;

/**
 * What a quantity of milk costs, in paisa.
 *
 * THE ONLY ROUNDING IN THE SYSTEM, and it happens exactly once -- at the
 * boundary between a measurement and money. Half-up, because that is what
 * `Math.round` does for positive values and an undocumented convention is worse
 * than a plain one.
 *
 * Worked, because a factor-of-forty error is the one this module exists to
 * prevent: 12.5 L at Rs 7,000 per 40 L is `12.5 * 700000 / 40` = 218750 paisa
 * = Rs 2,187.50.
 *
 * `unitLitres` HAS NO DEFAULT, deliberately. A default of 1 would make every
 * forgotten argument a fortyfold overcharge that still looks like a price --
 * the same reasoning as date_precision being NOT NULL with no default, and for
 * the same reason: the wrong value here is not detectable by looking at it.
 */
export function amountMinor(litres: number, priceMinor: number, unitLitres: number): number {
  if (!Number.isFinite(litres) || litres < 0) {
    throw new RangeError(`litres must be a non-negative number, got ${litres}`);
  }
  if (!Number.isInteger(priceMinor) || priceMinor < 0) {
    throw new RangeError(`priceMinor must be a non-negative integer of paisa, got ${priceMinor}`);
  }
  if (!Number.isFinite(unitLitres) || unitLitres <= 0) {
    throw new RangeError(`unitLitres must be a positive number, got ${unitLitres}`);
  }
  return Math.round((litres * priceMinor) / unitLitres);
}

/**
 * Paisa as rupees, for display only.
 *
 * ALWAYS TWO DECIMALS, even when they are zero. A column of amounts where some
 * rows show paisa and some do not is a column nobody can scan, and "Rs 7,000"
 * beside "Rs 7,000.50" invites reading the first as approximate.
 *
 * Plain thousands grouping rather than `Intl.NumberFormat`: the output of this
 * function ends up in a statement handed to another person, and it must not
 * depend on which ICU data the host happens to ship.
 */
export function formatMinor(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new RangeError(`minor must be an integer of paisa, got ${minor}`);
  }
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const rupees = Math.trunc(abs / MINOR_PER_UNIT);
  const paisa = abs % MINOR_PER_UNIT;
  const grouped = String(rupees).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}Rs ${grouped}.${String(paisa).padStart(2, '0')}`;
}

/**
 * A rate as it was agreed -- "Rs 7,000.00 / 40 L".
 *
 * NOT converted to per-litre. This string is what the statement shows, and the
 * whole argument of §4.2 is that the buyer has to be able to check the line
 * against his own notebook. Converting his rate into ours is the single edit
 * that would stop him being able to.
 */
export function formatRate(priceMinor: number, unitLitres: number): string {
  return `${formatMinor(priceMinor)} / ${unitLitres} L`;
}

/**
 * The derived per-litre rate, in paisa, for display beside the agreement.
 *
 * NOT an integer and not stored anywhere: it exists so the entry form can show
 * back what it understood (§12.2), which is where a factor-of-forty slip
 * becomes visible. Anything that needs money must call `amountMinor` instead.
 */
export function perLitreMinor(priceMinor: number, unitLitres: number): number {
  if (!Number.isFinite(unitLitres) || unitLitres <= 0) {
    throw new RangeError(`unitLitres must be a positive number, got ${unitLitres}`);
  }
  return priceMinor / unitLitres;
}
