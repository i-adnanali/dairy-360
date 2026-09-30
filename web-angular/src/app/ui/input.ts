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
      'rounded-lg border border-line-control text-sm aria-[invalid=true]:border-danger-fg ' +
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
