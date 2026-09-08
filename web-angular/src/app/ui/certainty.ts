// The certainty vocabulary. Phase 5 of docs/UI_SYSTEM.md, spec in §6.
//
// ---------------------------------------------------------------------------
// FIVE STATES, AND THE THIRD AND FOURTH ARE THE POINT
// ---------------------------------------------------------------------------
// §1 calls certainty "the app's primary visual variable", and everything in
// phases 1-4 existed so this file could be written. Every screen already
// distinguishes measured from approximate and observed from recalled; none of
// them showed it.
//
//   known        measured, exact day, observed
//   approximate  estimated, month/year precision, recalled
//   absent       AN ANSWER WAS GIVEN: not_measured, nothing taken, nobody saw
//   no-record    nothing was ever entered
//   unanswered   still required
//
// The earlier draft had four and folded the middle two together. They look
// alike and they are different facts: `milked_not_measured` means the animal
// was milked and nobody weighed it, which is MISSING DATA about a milking that
// happened; a missing row means nothing was recorded at all. types.ts:130 keeps
// them apart in the type, milking.ts keeps them apart in the query, and /check
// reports "22 rows carry a number, 5 milked but unweighed, 1 not milked"
// precisely so they are never blended. Rendering them identically would undo
// that in the one place a person actually looks.
//
// The rule the earlier draft stated as "always words, never a dash" becomes:
// AN ANSWER IS ALWAYS WORDS; ONLY THE ABSENCE OF AN ANSWER IS A DASH.
//
// ---------------------------------------------------------------------------
// GREYSCALE IS THE ACCEPTANCE, WHICH IS WHY EVERY STATE CARRIES A NON-HUE MARK
// ---------------------------------------------------------------------------
// §6.3: "Carried by weight, contrast and a mark -- never by hue alone. It must
// survive dark mode, greyscale and colour blindness." So each state is
// separated from every other by at least one thing that is not colour:
//
//   known        monospace, roman, upright, a FIGURE
//   approximate  a DOTTED UNDERLINE, plus a qualifier word (§6.1)
//   absent       ITALIC, and always WORDS rather than a figure
//   no-record    an EN DASH, which is a different glyph from any word
//   unanswered   a FILLED GROUND, which no other state has
//
// PHASE5_PRECHECK.md found that `--certainty-approx` and `--certainty-absent`
// hold the SAME VALUE in light (#82807A) and so are the one pair with no tonal
// separation at all: in greyscale they are told apart by the dotted rule and
// the italic alone. That is a real distinction and it is thinner than the other
// nine pairs. It is recorded rather than papered over, and it is an argument
// for moving the light value of one of them -- which is a token change and not
// this phase's business.
//
// ---------------------------------------------------------------------------
// A DIRECTIVE, AND NOT ON THE CELL
// ---------------------------------------------------------------------------
// Same reasoning as every primitive in this directory (see text.ts). But note
// the composition: `Cell` owns the padding and the column's alignment, and this
// owns the value's certainty. They sit on different elements -- `<td appCell
// numeric>` wrapping `<span appCertainty="known">` -- because one cell can hold
// a figure and its qualifier at two different certainties, and a directive on
// the <td> could only paint the whole cell.
//
// `known` sets `font-mono tabular-nums` even though a numeric <td> already
// does: a known value is not always in a numeric column (an exact birth date
// on /animals/:id is not), and declaring the same value twice costs nothing.

import { Directive, computed, input } from '@angular/core';

/** §6's five states. `no-record` is the one with no token of its own (§4.5). */
export type CertaintyState =
  | 'known'
  | 'approximate'
  | 'absent'
  | 'no-record'
  | 'unanswered';

/**
 * The five treatments, as written in §6's table -- with ONE STATED DEVIATION.
 *
 * §6 lists `font-mono tabular-nums` under `known` only. `approximate` takes it
 * too, and the reason is §5 rather than §6: "font-mono plus tabular-nums on any
 * column of figures ... tabular alignment is what lets an eye scan 31 rows for
 * an anomaly." EVERY date column in this app holds both certainties at once --
 * `2019-03-06` beside `2017-03` -- so dropping the face on the approximate half
 * would leave every one of them ragged, which costs more than it buys. §6's
 * table reads as it does because its draft assumed an approximate value was
 * words; `2017-03` is a figure.
 *
 * What separates the two states is therefore the ornament, the tone and the
 * qualifier word, which is three marks and not one. §6's own contrast for
 * `known` is "NO ORNAMENT", and that still holds exactly.
 *
 * `no-record` is `content-disabled` and NOT a new token, per §4.5: it already
 * sits one step past `--certainty-absent` in both modes, which is the correct
 * relationship -- an absent answer is quieter than a given one, and no answer
 * at all is quieter still.
 *
 * `unanswered` is the `warning` role and deliberately has no certainty token
 * of its own (§4.5): "a second name for one value is how the two drift apart".
 * At value scale it is the foreground and a medium weight; the FILLED ground
 * belongs to the row (see RowDivider's `unanswered`), because §3.2 confines
 * amber to "rows and list items, never to a control the eye is already on".
 */
const TREATMENT: Record<CertaintyState, string> = {
  known: 'text-certainty-known font-mono tabular-nums',
  approximate:
    'text-certainty-approx font-mono tabular-nums ' +
    'border-b border-dotted border-certainty-rule',
  absent: 'text-certainty-absent italic',
  'no-record': 'text-content-disabled',
  unanswered: 'font-medium text-warning-fg',
};

/**
 * One value, at one certainty.
 *
 * Goes on the `<span>` (or `<td>`, or `<div>`) that holds the value itself,
 * never on a container that also holds prose.
 */
@Directive({
  selector: '[appCertainty]',
  host: { '[class]': 'cls()' },
})
export class Certainty {
  readonly state = input.required<CertaintyState>({ alias: 'appCertainty' });
  protected readonly cls = computed(() => TREATMENT[this.state()]);
}

/**
 * The qualifier naming the imprecision -- §6.1.
 *
 * Lowercase, NO PARENTHESES, `text-xs` in `content-subtle`, one space after
 * the figure. `month`, `year`, `est`.
 *
 * Not `YEAR` / `EST`: upper case is the one typographic treatment this app
 * avoids everywhere else, and the herd table already rendered its qualifier in
 * lower case. It rendered it in parentheses too, which this drops -- brackets
 * around a two-word qualifier are punctuation doing a job that space and size
 * already do.
 *
 * THE SPACE IS `ml-1` AND NOT A LITERAL SPACE, which is worth one line of
 * explanation: Angular's default `preserveWhitespaces: false` removes
 * whitespace-only text nodes between elements, so a template that reads
 * `</span> <span appQualifier>` cannot be relied on to keep the gap. `ml-1` is
 * 0.25rem -- one space at this size -- and it does not depend on the compiler.
 *
 * `not-italic` and `font-normal` are defensive: the qualifier sits inside cells
 * and spans that may themselves be italic or emphasised, and a qualifier that
 * inherited `absent`'s italic would read as part of the value.
 */
@Directive({
  selector: '[appQualifier]',
  host: {
    class: 'ml-1 align-baseline text-xs font-normal not-italic text-content-subtle',
  },
})
export class Qualifier {}
