// One table cell, at one of two densities.
//
// ---------------------------------------------------------------------------
// WHY THIS IS THE FIRST PRIMITIVE, AND WHY IT IS A DIRECTIVE
// ---------------------------------------------------------------------------
// 98 cells across 12 tables carried 31 distinct class strings and FOUR padding
// scales at once: `px-3 py-2` (44), `py-1` with no horizontal padding at all
// (34), `px-3 py-1.5` (12) and `px-4 py-1.5` (7). No cell carried `rounded`,
// which is why every `rounded`-based metric was blind to the largest
// inconsistency in the app.
//
// Two survive -- `px-3 py-2` comfortable and `px-3 py-1.5` compact -- and the
// other two are deleted. Deliberately NOT a component: the cell is the element
// the specs reach through. Twelve `data-role` hooks sit directly on a `<td>`,
// half of them interpolated (`[attr.data-role]="'amount-' + row.destination_id"`),
// and the suite casts querySelector results to concrete element types 68 times.
// A wrapping `<app-cell>` would hand those back an `<app-cell>` element instead
// of a `<td>`, and a `<td>` is also the only child `<tr>` will accept. A
// directive leaves the element alone and contributes classes.
//
// ---------------------------------------------------------------------------
// A `<th>` IS ALWAYS COMFORTABLE, WHICH IS NOT AN OVERSIGHT
// ---------------------------------------------------------------------------
// Both entry screens -- the milking roster and the dispatch sheet -- pair a
// `px-3 py-2` header with `px-3 py-1.5` rows, consistently, on both. That reads
// as deliberate rather than drifted: a roomier header over tight rows is what
// makes a column of figures scannable while you are typing into it. So density
// applies to the body and the header keeps its own, which also means those two
// tables come through this migration with no visual change at all.
//
// The cells that DO move are the two deleted scales, in three files:
// verification-panel (30, `/check`), destination-detail (7) and
// confirmation-card (4, only visible while an agent write is pending).

import {
  Directive, ElementRef, booleanAttribute, computed, inject, input,
} from '@angular/core';

/** Comfortable for review surfaces, compact for entry. See UI_SYSTEM.md §4. */
export type CellDensity = 'comfortable' | 'compact';

/** The text colours cells actually use, as semantic names rather than stops. */
export type CellTone = 'default' | 'muted' | 'secondary' | 'heading' | 'primary' | 'success';

const TONE: Record<CellTone, string> = {
  default: '',
  muted: 'text-content-muted',
  secondary: 'text-content-secondary',
  heading: 'text-content-heading',
  primary: 'text-content-primary',
  success: 'text-success-fg',
};

@Directive({
  selector: 'td[appCell], th[appCell]',
  host: { '[class]': 'cls()' },
})
export class Cell {
  private readonly isHeader =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.tagName === 'TH';

  readonly density = input<CellDensity>('comfortable');
  readonly tone = input<CellTone>('default');

  /**
   * A column of figures: right-aligned, monospaced, tabular.
   *
   * `font-mono tabular-nums` arrived in phase 4, held back from phase 2 only
   * because that phase's acceptance was that nothing moved except the button
   * and cell padding.
   *
   * `tabular-nums` is the half that does the work and the half nobody notices:
   * it forces every digit to one advance width, so the units column of row 31
   * sits under the units column of row 1. Proportional digits in a right-aligned
   * column still line up at the right EDGE while the digits inside wander, which
   * is exactly the case where an eye scanning for an anomaly finds nothing.
   * Section 4: "tabular alignment is what lets you scan 31 rows for an anomaly."
   *
   * `whitespace-nowrap` comes with it, and it is not tidiness. Monospace is
   * WIDER than the proportional face it replaced, so the dispatch sheet's
   * amount column broke "Rs 3,325.00" across two lines the moment the figures
   * went mono -- 48px of extra page height and a number you cannot read at a
   * glance. A figure that wraps is worse than one that overflows, because the
   * eye reads the fragment as a smaller number.
   */
  readonly numeric = input(false, { transform: booleanAttribute });
  readonly emphasis = input(false, { transform: booleanAttribute });
  readonly nowrap = input(false, { transform: booleanAttribute });
  /** `text-xs`, for the secondary line some tables put under a figure. */
  readonly small = input(false, { transform: booleanAttribute });

  protected readonly cls = computed(() => {
    const pad = this.isHeader || this.density() === 'comfortable' ? 'px-3 py-2' : 'px-3 py-1.5';
    return [
      pad,
      // A numeric <th> gets the ALIGNMENT but not the face: a header is a word
      // ("Days", "Recorded", "Rate today"), and setting a word in a figure font
      // is how a table starts looking like a terminal. Only the cells that hold
      // digits are monospaced.
      this.numeric()
        ? this.isHeader
          ? 'text-right'
          : 'text-right font-mono tabular-nums whitespace-nowrap'
        : '',
      this.emphasis() ? 'font-medium' : '',
      this.nowrap() ? 'whitespace-nowrap' : '',
      this.small() ? 'text-xs' : '',
      TONE[this.tone()],
    ]
      .filter((s) => s.length > 0)
      .join(' ');
  });
}
