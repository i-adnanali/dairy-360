// One button. Three radii, two fills and four disabled treatments became one.
//
// ---------------------------------------------------------------------------
// THE DEFECT
// ---------------------------------------------------------------------------
// 19 sites over EIGHT distinct class strings (section 6's summary says seven;
// its own table in 6.3 lists eight rows and they sum to 19). Three radii
// (`rounded-xl` x11, `rounded-lg` x5, `rounded-md` x2), two enabled fills --
// payroll, the people list and the person record are `bg-farm-800` while every
// other button in the app is `bg-farm-600` -- `hover:` on 3 of 19, and four
// different answers to "what does disabled look like":
//
//   disabled:cursor-not-allowed disabled:bg-farm-300   8 sites
//   disabled:bg-farm-300                               3
//   disabled:opacity-40                                4
//   nothing at all                                     5
//
// One radius (`rounded-lg`, the middle of the three), one fill, one hover, one
// disabled state.
//
// ---------------------------------------------------------------------------
// DISABLED IS NOW aria-disabled, AND THAT IS A REAL TRADE
// ---------------------------------------------------------------------------
// Section 7 asks for `aria-describedby` from a blocked submit to the text
// explaining why. That only works if the button can be FOCUSED, and a natively
// disabled button cannot be -- so the reason it points at would never be
// announced, and `aria-disabled` beside `disabled` would be redundant. The
// native attribute therefore goes.
//
// Two consequences, both real and both handled rather than discovered:
//
// 1. THE BROWSER NO LONGER SUPPRESSES THE CLICK, so activation is refused in
//    two places instead, and which one does the work depends on the button:
//
//    - `type="submit"` (15 of the 19): `onClick`'s preventDefault below.
//      Cancelling the click cancels the form submission it would have caused,
//      including implicit submission when Enter is pressed in a text field.
//      This is the PRIMARY defence for these, measured rather than assumed --
//      with the handler guard removed the specs still pass, and only when
//      preventDefault goes too does target.spec's "cannot be clicked past"
//      fail.
//    - `type="button"` with a template `(click)` (payroll's save is the
//      example): preventDefault cannot help, because a host listener and a
//      template listener on one element have no guaranteed order. The
//      HANDLER GUARD is the only defence there.
//
//    So both are load-bearing and neither is decoration. All 19 handlers were
//    checked one by one; destinations-list's price submit was the single one
//    that re-checked only half of its button's condition, and it is fixed in
//    the same commit as this file.
//
// 2. IT ADDS A TAB STOP TO BOTH FROZEN FORMS. A fresh /animals/new goes from 8
//    to 9 and /animals/calvings/new from 6 to 7, because the submit is disabled
//    in the empty state and now sits in the tab order while inert.
//    REGISTRY_ENTRY_UX.md section 11 prediction 3 is pre-registered on "ten tab
//    stops, about half of them empty" and section 2's B1 freezes FIELDS, which
//    a submit button is not -- so nothing in the trial gate catches this. It
//    was raised, and the decision was to build the design system now and read
//    the trial against the built system rather than hold the work. Recorded
//    here so the trial report is read knowing the baseline moved, in the same
//    spirit as the two contaminations that section 11 already documents.
//
// The `disabled:` Tailwind variants stop matching the moment the native
// attribute goes -- a button with `aria-disabled` does not match `:disabled`.
// That is why the state is computed in TypeScript here instead of leaning on
// variant classes: there is no `aria-disabled` variant in Tailwind 3.4 and
// adding one to express what a `computed()` already says would be indirection
// for its own sake.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT SWEPT IN
// ---------------------------------------------------------------------------
// Two elements wear `bg-farm-600` and are not buttons:
// confirmation-card.ts:11 is a badge (it is a StatusBadge -- see surface.ts)
// and message.ts:16 is the user's own chat bubble, which section 9 separately
// wants QUIETED rather than unified. Neither takes this directive.

import { Directive, booleanAttribute, computed, input } from '@angular/core';

/** `primary` is the filled action, `secondary` the bordered one, `link` bare. */
export type ButtonVariant = 'primary' | 'secondary' | 'link';
/** `md` is a form submit; `sm` the tighter inline action. */
export type ButtonSize = 'sm' | 'md';

const PAD: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5',
  md: 'px-4 py-2',
};

@Directive({
  selector: 'button[appButton], a[appButton]',
  host: {
    '[class]': 'cls()',
    // `null` removes the attribute rather than writing aria-disabled="false",
    // which assistive technology treats as present-and-false rather than absent.
    '[attr.aria-disabled]': 'disabled() ? "true" : null',
    '[attr.aria-describedby]': 'disabled() && reason() ? reason() : null',
    '(click)': 'onClick($event)',
  },
})
export class Button {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');

  /**
   * Blocked, but present and focusable.
   *
   * NOT bound to the native attribute. A call site passes `[appButtonDisabled]`
   * where it used to pass `[disabled]`, and keeps its own handler guard.
   */
  readonly disabled = input(false, { alias: 'appButtonDisabled', transform: booleanAttribute });

  /**
   * The `id` of the element saying why this is blocked.
   *
   * Every site that has such text already renders it beside the button -- the
   * `blocked` note on the two forms, the roster's and the dispatch sheet's.
   * They gained an `id` so this can point at them; the text itself is unchanged.
   */
  readonly reason = input<string | null>(null);

  protected readonly cls = computed(() => {
    const base =
      'rounded-lg text-sm font-medium transition-colors ' +
      // `focus-visible`, not `focus`: a ring that appears on every mouse click
      // is noise, and the whole point is the keyboard. `ring-offset` needs a
      // ground colour to blend into or it paints white on a dark page, which is
      // the usual way a ring looks broken in dark mode.
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ' +
      'focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page ' +
      PAD[this.size()];
    if (this.disabled()) {
      // Visibly inert: a flat sunken ground with disabled-weight text. The old
      // `bg-farm-300` was a light tan under WHITE text, which reads as an
      // enabled button in an unusual colour and still invites the click.
      return `${base} cursor-not-allowed bg-surface-sunken text-content-disabled`;
    }
    switch (this.variant()) {
      case 'secondary':
        return `${base} border border-line bg-surface-raised text-content-heading hover:bg-surface-sunken`;
      case 'link':
        return `${base} text-content-heading underline hover:text-content-primary`;
      default:
        return `${base} bg-brand text-content-onFill hover:bg-brand-hover`;
    }
  });

  /**
   * Swallow activation while blocked.
   *
   * Cancelling the click is what stops a blocked `type="submit"` from
   * submitting its form -- the primary defence for 15 of the 19 sites. It
   * cannot intercept a template `(click)` on the same element, because host
   * and template listeners have no guaranteed order, so `type="button"` sites
   * rely on their handler's own re-check. See the header.
   */
  protected onClick(e: Event): void {
    if (this.disabled()) e.preventDefault();
  }
}
