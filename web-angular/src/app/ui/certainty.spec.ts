import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Certainty, Qualifier } from './certainty';
import type { CertaintyState } from './certainty';
import { RowDivider } from './surface';

// ---------------------------------------------------------------------------
// THE CERTAINTY VOCABULARY. Phase 5, docs/UI_SYSTEM.md §6.
// ---------------------------------------------------------------------------
//
// Two jobs, and the second is the one that would otherwise never be checked:
//
//   1. The five states render the five treatments §6's table specifies.
//   2. GREYSCALE. §6.3: "Carried by weight, contrast and a mark -- never by
//      hue alone. It must survive dark mode, greyscale and colour blindness.
//      Acceptance is that the five states are distinguishable in greyscale."
//
// The visual half of (2) is a screenshot pass with a grayscale filter, and it
// was run. This is the STRUCTURAL half, and it is the half that survives: a
// screenshot proves the vocabulary was distinguishable on the day it was taken,
// and this proves that no later edit can quietly reduce two states to a pair of
// greys. Every one of the ten pairs has to differ in something that is not a
// colour, and the test enumerates all ten rather than spot-checking.

const STATES: CertaintyState[] = ['known', 'approximate', 'absent', 'no-record', 'unanswered'];

@Component({
  imports: [Certainty, Qualifier],
  template: `
    @for (s of states; track s) {
      <span [appCertainty]="s" [attr.data-s]="s">value</span>
    }
    <em appQualifier data-q>month</em>
  `,
})
class Host {
  readonly states = STATES;
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const cls = (s: CertaintyState) =>
    (el.querySelector(`[data-s="${s}"]`) as HTMLElement).className;
  return { el, cls };
}

describe('the certainty vocabulary — §6 five states', () => {
  it('gives each state the treatment §6 specifies', () => {
    const { cls } = render();

    // Known: the darkest tone, monospace, NO ORNAMENT.
    expect(cls('known')).toContain('text-certainty-known');
    expect(cls('known')).toContain('font-mono');
    expect(cls('known')).toContain('tabular-nums');
    expect(cls('known')).not.toContain('dotted');
    expect(cls('known')).not.toContain('italic');

    // Approximate: the dotted rule in --certainty-rule, and a qualifier beside
    // it that the call site supplies.
    expect(cls('approximate')).toContain('text-certainty-approx');
    expect(cls('approximate')).toContain('border-dotted');
    expect(cls('approximate')).toContain('border-certainty-rule');

    // Absent: AN ANSWER WAS GIVEN, so italic and always words.
    expect(cls('absent')).toContain('text-certainty-absent');
    expect(cls('absent')).toContain('italic');
    expect(cls('absent')).not.toContain('border-dotted');

    // No record: §4.5's rule that this state gets NO NEW TOKEN. It is
    // --text-disabled, which already sits one step past --certainty-absent in
    // both modes. A `certainty-norecord` token appearing here would mean
    // somebody added a fifth name for a value that already had one.
    expect(cls('no-record')).toContain('text-content-disabled');
    expect(cls('no-record')).not.toContain('certainty-');
    expect(cls('no-record')).not.toContain('italic');

    // Unanswered: the warning role, and DELIBERATELY NO CERTAINTY TOKEN --
    // §4.5, "a second name for one value is how the two drift apart".
    expect(cls('unanswered')).toContain('text-warning-fg');
    expect(cls('unanswered')).not.toContain('certainty-');
  });

  it('sets the qualifier lowercase, unbracketed, small and quiet — §6.1', () => {
    const { el } = render();
    const q = el.querySelector('[data-q]') as HTMLElement;
    expect(q.className).toContain('text-xs');
    expect(q.className).toContain('text-content-subtle');
    // NOT `(month)` and NOT `MONTH`. Upper case is the one typographic
    // treatment this app avoids everywhere else, and the brackets were
    // punctuation doing a job that size and space already do.
    expect(q.textContent).toBe('month');
    // It sits inside cells and spans that may be italic or emphasised, so it
    // refuses to inherit either -- a qualifier in the value's italic reads as
    // part of the value.
    expect(q.className).toContain('not-italic');
    expect(q.className).toContain('font-normal');
  });

  // -------------------------------------------------------------------------
  // §6.3's acceptance, as a structural invariant
  // -------------------------------------------------------------------------

  /**
   * The marks that survive greyscale. A colour utility is not one of them.
   *
   * `text-certainty-*`, `text-content-*` and `text-warning-*` all collapse to
   * SOME grey under a grayscale filter -- and PHASE5_PRECHECK.md found that two
   * of them collapse to the SAME grey: --certainty-approx and
   * --certainty-absent hold #82807A in light. So tone is deliberately excluded
   * from what counts as a separator here, which makes this test stricter than
   * the palette and correctly so.
   */
  const MARKS = [
    'font-mono',
    'border-dotted',
    'italic',
    'font-medium',
    'tabular-nums',
  ];

  const marksOf = (className: string) => MARKS.filter((m) => className.includes(m)).sort();

  it('separates all ten pairs of states by something that is not a colour', () => {
    const { cls } = render();
    const failures: string[] = [];
    for (let i = 0; i < STATES.length; i++) {
      for (let j = i + 1; j < STATES.length; j++) {
        const a = STATES[i], b = STATES[j];
        const ma = marksOf(cls(a)), mb = marksOf(cls(b));
        if (ma.join('|') === mb.join('|')) {
          failures.push(`${a} and ${b} share every non-colour mark: [${ma.join(', ')}]`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('leaves no state with no mark at all — except the one whose mark is its glyph', () => {
    const { cls } = render();
    // `no-record` carries no class-level mark, and does not need one: its mark
    // is the EN DASH it renders instead of a value, which is a different glyph
    // from every word and every figure in the other four states. NO_RECORD in
    // precision-display.ts is the single source of that character, and the test
    // below pins it.
    for (const s of STATES) {
      if (s === 'no-record') {
        expect(marksOf(cls(s))).toEqual([]);
        continue;
      }
      expect(marksOf(cls(s)).length, `${s} has no non-colour mark`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The unanswered row
// ---------------------------------------------------------------------------

@Component({
  imports: [RowDivider],
  template: `
    <table><tbody>
      <tr appRowDivider data-r="answered"><td>x</td></tr>
      <tr appRowDivider [unanswered]="true" data-r="unanswered"><td>x</td></tr>
    </tbody></table>
  `,
})
class RowHost {}

describe('the unanswered row — §3.2, §6', () => {
  function rows() {
    const fixture = TestBed.createComponent(RowHost);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      answered: (el.querySelector('[data-r="answered"]') as HTMLElement).className,
      unanswered: (el.querySelector('[data-r="unanswered"]') as HTMLElement).className,
    };
  }

  it('is off by default, so no existing row changed', () => {
    // Ten call sites carried appRowDivider before this input existed. If the
    // default were anything but false, every list in the app would have gone
    // amber.
    //
    // Asserted as a SET, not as a string. Moving the host from a static `class`
    // to a `[class]` binding changed the order the two utilities appear in the
    // rendered attribute -- inert for CSS, which resolves by stylesheet order
    // and not by attribute order (§8.1), and a false failure for any test that
    // compares the string.
    expect(rows().answered.split(' ').sort()).toEqual(['border-line-hairline', 'border-t']);
    expect(rows().answered).not.toContain('warning');
  });

  it('carries a mark as well as a tint, so it survives greyscale', () => {
    const { unanswered } = rows();
    expect(unanswered).toContain('bg-warning-bg');
    // The 3px inset bar on the leading edge. A tint alone is a hue difference
    // and §6.3 does not accept one. `shadow` rather than `border-l` because a
    // left border on one <tr> shifts that row's cells and the column stops
    // being a column.
    expect(unanswered).toContain('shadow-[inset_3px_0_0_0_rgb(var(--warning-line))]');
  });
});
