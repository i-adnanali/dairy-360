// Cards, error panels, dividers, badges, summary bars.
//
// Directives rather than components, for the reason given at the top of text.ts
// -- and it is sharpest here: ErrorPanel is the primitive with the MOST hooks
// on an element it would own. 38 `data-role` attributes sit on the panel's own
// <p> (`error-form`, `error-sex`, `load-error`, `pay-error`, …), nine of them
// spec-reached, and several specs read `.textContent` off the result. A
// wrapping component would return an <app-error-panel> and the projected text
// would still be reachable, but the element identity every one of those
// assertions was written against would change. A directive changes nothing.

import { Directive, booleanAttribute, computed, input } from '@angular/core';

// ---------------------------------------------------------------------------
// Card -- 16, plus a 6-site empty-state variant
// ---------------------------------------------------------------------------

/**
 * The standard raised block: `rounded-xl border border-farm-300 bg-white p-4`.
 *
 * `empty` is the variant used for "nothing here yet" copy, which adds the
 * smaller, quieter text the six empty states all set by hand. Callers keep
 * their own `space-y-*`, because how a card's children are spaced is about the
 * children.
 */
@Directive({
  selector: '[appCard]',
  host: { '[class]': 'cls()' },
})
export class Card {
  readonly empty = input(false, { transform: booleanAttribute });
  protected readonly cls = computed(
    () =>
      'rounded-xl border border-line bg-surface-raised p-4' +
      (this.empty() ? ' text-sm text-content-muted' : ''),
  );
}

// ---------------------------------------------------------------------------
// ErrorPanel -- 35 sites over seven strings; this covers the 26 that agree
// ---------------------------------------------------------------------------

/** `sm` is the in-form refusal; `lg` the screen-level load failure. */
export type PanelSize = 'sm' | 'lg';

/**
 * A server refusal, shown verbatim.
 *
 * Covers the two variants that account for 26 of the 35 sites. Three do NOT
 * come through here and are left exactly as they were, on purpose:
 *
 *   - verification-panel's `text-red-900`, which is a stop darker than the
 *     danger role's red-800 and has no token in section 3 to map onto.
 *   - chat-panel's `rounded-md border border-red-300 … text-red-700`, which is
 *     a third radius AND a bordered treatment.
 *
 * Both are real inconsistencies and both would be visible changes to fix, which
 * puts them outside a phase whose acceptance is that only the button and cell
 * padding move. They need a decision in section 3, not a quiet normalisation
 * here.
 */
@Directive({
  selector: '[appErrorPanel]',
  host: { '[class]': 'cls()' },
})
export class ErrorPanel {
  readonly size = input<PanelSize>('sm');
  protected readonly cls = computed(() =>
    this.size() === 'sm'
      ? 'rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg'
      : 'rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-fg',
  );
}

/**
 * Error text with no panel around it -- the note under a single field.
 *
 * `soft` is red-700, which exists as its own token because
 * tool-call-chip.spec.ts pins that literal and the danger role is fixed at
 * red-800.
 */
@Directive({
  selector: '[appErrorText]',
  host: { '[class]': 'cls()' },
})
export class ErrorText {
  readonly size = input<'sm' | 'xs'>('sm');
  readonly tone = input<'default' | 'soft'>('default');
  protected readonly cls = computed(
    () => `text-${this.size()} ` + (this.tone() === 'soft' ? 'text-danger-soft' : 'text-danger-fg'),
  );
}

// ---------------------------------------------------------------------------
// RowDivider -- 10
// ---------------------------------------------------------------------------

/**
 * The hairline between rows of a list.
 *
 * ---------------------------------------------------------------------------
 * `unanswered` IS THE ONLY AMBER THE CERTAINTY VOCABULARY ADDS, AND IT IS HERE
 * ---------------------------------------------------------------------------
 * §6's fifth state is "still required" in the `warning` role, and §3.2 confines
 * it to "rows and list items, never to a control the eye is already on":
 *
 *   > Amber's job in the unanswered state is to make something FINDABLE -- a
 *   > row skipped in a 31-animal roster, a destination unanswered on the
 *   > dispatch sheet. A two-option chip group sitting directly in the tab path
 *   > is not lost; you are looking at it.
 *
 * So the filled ground lives on the <tr> and not on any span inside it. A row
 * is the scale at which amber does the job it is for -- an eye sweeping a
 * 31-row table finds a tinted band, and would not find a 12px tag.
 *
 * A LEFT EDGE, NOT ONLY A TINT. The tint alone is a hue difference, and §6.3
 * requires every state to survive greyscale: `box-shadow: inset` draws a 3px
 * bar on the leading edge that reads as a mark at any saturation. `box-shadow`
 * rather than `border-l`, because a border on one <tr> shifts every cell in
 * that row 3px right and the column stops being a column.
 *
 * PHASE5_PRECHECK.md's census is why this is the ONLY amber added: amber
 * already carries five meanings at 26 sites, so §6's claim that this would be
 * "the only amber in the content area" was false before it was written. One
 * more inline tag would have been the sixth meaning; a row band is a different
 * visual event from all 26.
 */
@Directive({
  selector: '[appRowDivider]',
  host: { '[class]': 'cls()' },
})
export class RowDivider {
  readonly unanswered = input(false, { transform: booleanAttribute });
  protected readonly cls = computed(
    () =>
      'border-t border-line-hairline' +
      (this.unanswered() ? ' bg-warning-bg shadow-[inset_3px_0_0_0_rgb(var(--warning-line))]' : ''),
  );
}

// ---------------------------------------------------------------------------
// StatusBadge: state labels share geometry, while ended records retain a
// dashed outline and warning/brand have explicit roles. UI_SYSTEM.md §14.1.
export type BadgeTone = 'neutral' | 'default' | 'ended' | 'warning' | 'brand';

@Directive({
  selector: '[appBadge]',
  host: { '[class]': 'cls()' },
})
export class StatusBadge {
  readonly tone = input<BadgeTone>('neutral');
  protected readonly cls = computed(
    () =>
      'rounded-full px-2 py-0.5 text-xs font-medium ' +
      (this.tone() === 'ended'
        ? 'border border-dashed border-line bg-transparent text-content-subtle'
        : this.tone() === 'warning'
          ? 'bg-warning-bg text-warning-strong'
          : this.tone() === 'neutral' || this.tone() === 'default'
            ? 'bg-brand-badge text-content-heading'
            : 'bg-brand text-content-onFill'),
  );
}

// ---------------------------------------------------------------------------
// SummaryBar -- 3 sites, three layouts, and that is the finding
// ---------------------------------------------------------------------------

/**
 * The totals strip above or below a sheet.
 *
 * Only the shell is shared: the radius, the rule, the padding and the size.
 * The three sites genuinely disagree about everything else -- the roster is
 * `flex flex-wrap items-center gap-x-6 gap-y-2` on `bg-farm-50`, the dispatch
 * sheet is `justify-between gap-4` on white, and payroll's is a <footer> with
 * `space-y-3` and no flex at all. Section 6 calls them "three strings, three
 * different layouts", which is accurate; forcing one layout on them would be a
 * visual change to two screens for no stated benefit, so layout and ground
 * stay with the caller.
 */
@Directive({
  selector: '[appSummaryBar]',
  host: { class: 'rounded-xl border border-line px-4 py-3 text-sm' },
})
export class SummaryBar {}
