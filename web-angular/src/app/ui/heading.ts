// Three heading levels, which is one more than the app knew it had.
//
// The earlier draft of docs/records/UI_SYSTEM.md had two. There are three, and the middle
// one is the most-repeated single heading string in the app:
//
//   Page     text-lg font-semibold  --text-primary   14 sites
//   Section  text-sm font-semibold  --text-primary   12 sites   <- was missing
//   Sub      text-sm font-medium    --text-heading   17 sites
//
// Section and Sub are both `text-sm` and differ only in weight and colour,
// which is exactly the pair a reader cannot tell apart when they are written
// out by hand at 29 sites. Naming them is most of the value here.
//
// Directives rather than components, for the reason given at the top of text.ts.
// The element stays with the call site, which matters here because these sit on
// <h1>, <h2>, <h3>, <p> and <span> depending on the document outline -- a
// primitive that forced one tag would be wrong about the outline somewhere.

import { Directive } from '@angular/core';

/** The screen's title. One per screen. */
//
// SESSION BOARD REDESIGN (audit F05): the three levels now differ in SIZE, not
// only weight -- 26 / 19 / 15px against the old 18 / 14 / 14px. Every page uses
// PageHeading, so page titles render at one size again.
@Directive({
  selector: '[appPageHeading]',
  host: { class: 'text-2xl font-semibold tracking-tight text-content-primary' },
})
export class PageHeading {}

/** A titled block within a screen. The middle level. */
@Directive({
  selector: '[appSectionHeading]',
  host: { class: 'text-lg font-semibold text-content-primary' },
})
export class SectionHeading {}

/**
 * A labelled run of rows inside a block -- and, in the People forms, the
 * visible label above a control. BLOCK, because on a <span> inside a
 * `<label class="block space-y-1">` an inline label sat on the same line as a
 * short control (a date input) with no gap, and `space-y` cannot space inline
 * boxes. Every use is meant to sit on its own line.
 */
@Directive({
  selector: '[appSubHeading]',
  host: { class: 'block text-sm font-semibold text-content-heading' },
})
export class SubHeading {}
