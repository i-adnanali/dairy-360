// The text primitives: help prose, field labels, section labels, links.
//
// ---------------------------------------------------------------------------
// DIRECTIVES, NOT COMPONENTS, AND THE REASON IS THE SPEC SUITE
// ---------------------------------------------------------------------------
// UI_SYSTEM.md section 6 describes these as components. They are directives
// instead, and the same choice is made for every primitive in this directory.
//
// 115 `data-role` hooks are reached by 340 querySelector calls, and 86 of those
// hooks sit on the exact element a primitive would absorb -- 38 on an error
// panel's own <p>, 36 on an <input>, 12 on a <button>, 12 on a <td>. A wrapping
// <app-help-text> still MATCHES `[data-role="hint"]`, because the host element
// carries the attribute, but it hands the spec back an <app-help-text>; and the
// suite does not stop at matching. It casts querySelector results to concrete
// element types 68 times, reads `.disabled` 37 times, assigns `.value` 31
// times, and identifier-input.spec.ts asserts `input.tagName === 'INPUT'`
// outright. Eleven of the hooks are interpolated as well
// (`[attr.data-role]="'litres-' + row.destination_id"`), so a component would
// need a role input threaded through every one.
//
// A directive keeps the element, its attributes, its bindings and its handlers
// exactly where they were, and contributes only classes. Angular merges a host
// `[class]` binding with the template's static `class`, so a call site keeps
// its own positional classes (margins, widths) and gives up only the ones the
// primitive owns. Measured before relying on it.
//
// ---------------------------------------------------------------------------
// MARGINS STAY AT THE CALL SITE
// ---------------------------------------------------------------------------
// `mt-1`, `mt-2`, `mt-3` and `mb-1` vary per use and are about the gap to a
// NEIGHBOUR, not about what the element is. Baking one into a primitive is how
// a primitive stops being reusable. The exception is FieldLabel, where all 23
// sites agree on `mb-1 block` -- there, it is part of the thing.

import { Directive, booleanAttribute, computed, input } from '@angular/core';

// ---------------------------------------------------------------------------
// HelpText -- 45 sites, the most-used primitive in the app
// ---------------------------------------------------------------------------

/** `sm` is the prose under a control; `xs` the quieter aside under that. */
export type TextSize = 'sm' | 'xs';
/** `muted` is farm-600, `subtle` farm-500. Both already semantic tokens. */
export type TextTone = 'muted' | 'subtle';

/**
 * Explanatory prose beside a control.
 *
 * NOT demoted here. Section 4 wants help prose at `text-xs` in `--text-muted`
 * with a 65ch measure, on the grounds that it is currently "nearly as loud as
 * the labels it explains". That is a real visual change, it is not assigned to
 * any phase in section 10, and phase 2's acceptance is that nothing moves
 * except the button's disabled state and cell padding. So both current sizes
 * are preserved as variants and the demotion is left to whoever schedules it.
 */
@Directive({
  selector: '[appHelp]',
  host: { '[class]': 'cls()' },
})
export class HelpText {
  readonly size = input<TextSize>('sm');
  readonly tone = input<TextTone>('muted');
  protected readonly cls = computed(
    () =>
      `text-${this.size()} ` +
      (this.tone() === 'muted' ? 'text-content-muted' : 'text-content-subtle'),
  );
}

// ---------------------------------------------------------------------------
// FieldLabel -- 23 sites, all agreeing
// ---------------------------------------------------------------------------

/**
 * The label above an input.
 *
 * All 23 sites are `mb-1 block text-xs font-medium text-farm-700`, so the
 * margin and the `block` are part of the primitive rather than positional. Five
 * further sites drop the `block` (they sit inside a flex row already); `inline`
 * covers those.
 */
@Directive({
  selector: '[appFieldLabel]',
  host: { '[class]': 'cls()' },
})
export class FieldLabel {
  readonly inline = input(false, { transform: booleanAttribute });
  protected readonly cls = computed(
    () =>
      (this.inline() ? 'mb-1' : 'mb-1 block') +
      ' text-xs font-medium text-content-secondary',
  );
}

// ---------------------------------------------------------------------------
// SectionLabel -- 13 + 9
// ---------------------------------------------------------------------------

/**
 * The small upper-case label over a group.
 *
 * `legend` is the fieldset-legend variant, which adds a bottom margin and
 * medium weight. Nine of those exist and both frozen forms carry them.
 */
@Directive({
  selector: '[appSectionLabel]',
  host: { '[class]': 'cls()' },
})
export class SectionLabel {
  readonly legend = input(false, { transform: booleanAttribute });
  protected readonly cls = computed(
    () =>
      (this.legend() ? 'mb-1 font-medium ' : '') +
      'text-xs uppercase tracking-wide text-content-muted',
  );
}

// ---------------------------------------------------------------------------
// TextLink -- 10 + 4
// ---------------------------------------------------------------------------

/** `quiet` is the in-prose link; `strong` the underlined call to action. */
export type LinkTone = 'quiet' | 'strong';

/**
 * A link in prose, or the nav.
 *
 * THE ACTIVE NAV STATE NEEDS `!`, AND IT ALWAYS DID.
 *
 * The ten nav links carry `routerLinkActive="font-medium text-farm-900"` over a
 * base of `text-farm-600`, so TWO colour utilities land on the active link and
 * the winner is decided by their order in the compiled stylesheet, not by the
 * template. That happened to work, because Tailwind emits a colour ramp in
 * ascending stop order and `text-farm-900` came after `text-farm-600`.
 *
 * Renaming the base to `text-content-muted` reversed it -- `content` and `farm`
 * are separate groups and the muted rule now lands last -- so the active link
 * silently lost its highlight. Caught by a pixel diff, not by a test: 263
 * pixels on one row of one screen, `77 55 34` where `138 100 49` belonged.
 *
 * The active class is therefore `!text-content-primary`, which states the
 * precedence instead of inheriting it from an emission order nobody controls.
 * Same rendered colour as before; one less thing that breaks when a name
 * changes.
 */
@Directive({
  selector: '[appTextLink]',
  host: { '[class]': 'cls()' },
})
export class TextLink {
  readonly tone = input<LinkTone>('quiet');
  protected readonly cls = computed(() =>
    this.tone() === 'quiet'
      ? 'text-content-muted hover:text-content-heading'
      : 'font-medium text-content-heading underline',
  );
}
