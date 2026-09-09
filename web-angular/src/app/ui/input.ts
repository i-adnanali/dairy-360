// One text input, at one of two densities.
//
// ---------------------------------------------------------------------------
// THE COUNT IN SECTION 6 IS THE ONE THAT WAS MOST WRONG
// ---------------------------------------------------------------------------
// It says "~23 sites over two sizes: px-2 py-1.5 x10, px-3 py-2 x13". Those two
// figures are the counts of two EXACT strings. The population that actually
// shares those paddings is 27 sites over 10 strings and 18 over 7 -- 45 in all
// -- because the width prefix varies and each variant was counted as its own
// thing: `w-full`, `w-full max-w-md`, `w-full max-w-xs`, `w-full max-w-sm`,
// `w-56`, `w-36`, `w-32`, `w-28`, `w-24`, `w-72`.
//
// Width is the caller's business -- it is about the column the field sits in,
// not about the field -- so it stays at the call site and the directive owns
// the frame. That is what turns 17 distinct strings into two.
//
// ---------------------------------------------------------------------------
// A DIRECTIVE, EMPHATICALLY
// ---------------------------------------------------------------------------
// 36 `data-role` hooks sit on an <input>, 15 of them spec-reached, and the
// suite drives them as real inputs: 31 `.value =` assignments, 44
// `dispatchEvent` calls, 25 casts to HTMLInputElement, two `.checked =`, and
// identifier-input.spec.ts:26 asserting `input.tagName === 'INPUT'` -- a test
// whose entire point is that this control is an <input> with a datalist and not
// a <select>. A wrapping component fails that test by construction.
//
// Eleven of those hooks are interpolated, e.g.
// `[attr.data-role]="'litres-' + row.destination_id"` on the roster and the
// dispatch sheet. They stay in the caller's template untouched.
//
// ---------------------------------------------------------------------------
// <select> TAKES THIS TOO, AND THAT IS WHY THE FORMS PLUGIN IS NOT NEEDED
// ---------------------------------------------------------------------------
// Five <select> elements carry the identical frame by hand. They are the same
// primitive -- the same border, radius, padding and size -- so they take the
// same directive. This is also the concrete answer to section 8.3: the reason
// @tailwindcss/forms was wanted at all is themeable native controls, and the
// five selects and eleven date inputs that would benefit can be styled
// explicitly, which this does, without a global base-layer restyle reaching
// calving-form's first field on the eve of a measurement.
//
// ---------------------------------------------------------------------------
// NO FOCUS RING HERE, AND composer.ts IS WHY
// ---------------------------------------------------------------------------
// Section 7 wants `--focus-ring` on every interactive primitive, and that is
// phase 3. When it arrives it must not be applied blindly: composer.ts carries
// `outline-none focus:border-farm-500`, which is a DELIBERATE replacement of
// the native ring with a border shift, not an unstyled control. Reinstating an
// outline there would undo a decision. Left alone in both phases.

import { Directive, computed, input } from '@angular/core';

/** Compact for entry screens, comfortable for review. See UI_SYSTEM.md §4. */
export type InputDensity = 'compact' | 'comfortable';

@Directive({
  selector: 'input[appInput], textarea[appInput], select[appInput]',
  host: { '[class]': 'cls()' },
})
export class TextInput {
  readonly density = input<InputDensity>('compact');
  protected readonly cls = computed(
    () =>
      'rounded-lg border border-line text-sm ' +
      // A BORDER SHIFT, NOT A RING, and that follows composer.ts rather than
      // section 7's "ring on every interactive primitive". composer deliberately
      // traded the native outline for `focus:border-farm-500`, and section 7
      // itself says to keep that and not reinstate an outline there. Giving
      // every other input a ring would leave the app with two focus languages
      // for one element type, and the composer -- the control used most -- would
      // be the odd one out. Buttons and links take the ring because they have no
      // border to shift.
      'focus:outline-none focus:border-focus focus:shadow-[0_0_0_1px_rgb(var(--focus-ring))] ' +
      (this.density() === 'compact' ? 'px-2 py-1.5' : 'px-3 py-2'),
  );
}
