// Three heading levels, which is one more than the app knew it had.
//
// The earlier draft of UI_SYSTEM.md had two. There are three, and the middle
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
@Directive({
  selector: '[appPageHeading]',
  host: { class: 'text-lg font-semibold text-content-primary' },
})
export class PageHeading {}

/** A titled block within a screen. The middle level. */
@Directive({
  selector: '[appSectionHeading]',
  host: { class: 'text-sm font-semibold text-content-primary' },
})
export class SectionHeading {}

/** A labelled run of rows inside a block. */
@Directive({
  selector: '[appSubHeading]',
  host: { class: 'text-sm font-medium text-content-heading' },
})
export class SubHeading {}
