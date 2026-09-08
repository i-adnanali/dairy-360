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

/** `xs` is the default measure; `sm` the louder one two sites still want. */
export type TextSize = 'sm' | 'xs';
/** `muted` is --text-muted, `subtle` --text-subtle. Both semantic tokens. */
export type TextTone = 'muted' | 'subtle';

/**
 * Explanatory prose beside a control.
 *
 * ---------------------------------------------------------------------------
 * DEMOTED. Phase 5, UI_SYSTEM.md §5 and §9.1.
 * ---------------------------------------------------------------------------
 * The original spec wanted `text-xs` in `--text-muted` with a bounded measure,
 * on the grounds that help text is "nearly as loud as the labels it explains".
 * It was held back through phases 1-4 because phase 2's acceptance was that
 * nothing moved except the button and cell padding, and because the original
 * phase list assigned it to no phase at all.
 *
 * It rides with the certainty vocabulary because THE VOCABULARY DOES NOT WORK
 * WITHOUT IT. §6's five states separate by weight and tone across a narrow
 * range -- `certainty-approx` and `content-disabled` are two steps apart -- and
 * 34 paragraphs of `text-sm` prose sitting at the same weight as the values
 * they explain flattens that range to nothing. §9.1: "the certainty vocabulary
 * needs the prose one step quieter to read at all."
 *
 * WHAT CHANGED IS THE DEFAULT, not the variants. `size` still takes `sm`; it is
 * simply no longer what a bare `appHelp` gets. That demotes the 34 sites that
 * were relying on the default and leaves the 38 already passing `size="xs"`
 * exactly as they were.
 *
 * ---------------------------------------------------------------------------
 * 68ch, AND IT IS A MAX RATHER THAN A WIDTH
 * ---------------------------------------------------------------------------
 * §5: "A prose measure is independent of its container. A note under a
 * full-width table wraps at 68ch, not at the table's width." `max-w-[68ch]`
 * only ever constrains, so a paragraph already inside a 320px column is
 * untouched and one under a 1400px table stops being a single unreadable line.
 *
 * `ch` and not `rem` deliberately: the measure is about characters per line,
 * and `ch` is the unit that stays correct if the type scale ever moves. The
 * figure is 68 and not the original draft's 65 because §5 and §12.5 both
 * settled on 68, and one number in two places is how they drift.
 *
 * A max-width does nothing on an inline element, and four sites put `appHelp`
 * on a `<span>` inside a flex row. Those are single clauses, not prose, and
 * they are the reason this is not `block`: forcing display here would break
 * four layouts to bound a measure that is already bounded by the row.
 */
@Directive({
  selector: '[appHelp]',
  host: { '[class]': 'cls()' },
})
export class HelpText {
  readonly size = input<TextSize>('xs');
  readonly tone = input<TextTone>('muted');
  protected readonly cls = computed(
    () =>
      `text-${this.size()} max-w-[68ch] ` +
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
  private static readonly FOCUS =
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page rounded-sm';

  protected readonly cls = computed(
    () =>
      (this.tone() === 'quiet'
        ? 'text-content-muted hover:text-content-heading'
        : 'font-medium text-content-heading underline') +
      ' ' +
      TextLink.FOCUS,
  );
}
