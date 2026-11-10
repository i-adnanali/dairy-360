// SELECTION, ONE LANGUAGE. docs/records/UI_SYSTEM.md §4.8.
//
// The app showed "selected" seven ways: a gold underline, an inverted tile, a
// gold frame, bold alone, a green fill, a green underline and a grey tint. The
// rule now is that SHAPE says what kind of state it is and colour only accents:
//
//   where you are   an underline in the text colour      (nav, section bar, TabBar)
//   what is chosen  a filled segment                     (Segmented)
//   due now         amber, and nothing else is amber     (the session board)
//   keyboard focus  one ring, never amber, never the fill (--focus-ring)
//
// Both directives own the arrow keys: one Tab stop reaches the group and the
// arrows move within it, as the ARIA practices describe. Moving ACTIVATES (the
// choice is cheap and reversible, and it is what every segmented control the
// owner uses elsewhere does).

import { Directive, ElementRef, inject } from '@angular/core';

function move(e: KeyboardEvent, host: HTMLElement, selector: string): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  const items = Array.from(host.querySelectorAll<HTMLElement>(selector)).filter(
    (b) => !(b as HTMLButtonElement).disabled && b.closest('[hidden]') === null,
  );
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  const next =
    e.key === 'Home' ? 0
    : e.key === 'End' ? items.length - 1
    : (at + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
  e.preventDefault();
  items[next].focus();
  items[next].click();
}

/**
 * A row of tabs that switch what the page shows below it (Health's To do /
 * Records / Medicines, an animal's Timeline / Add an event / ...).
 *
 * Put it on the container; give each child `role="tab"`, `aria-selected` and
 * `[attr.tabindex]="selected ? 0 : -1"`. The look is `.tab-bar` in styles.css:
 * a 2px underline in the TEXT colour, the same shape as the section bar above
 * it, never a role colour.
 */
@Directive({
  selector: '[appTabBar]',
  host: { role: 'tablist', class: 'tab-bar', '(keydown)': 'onKey($event)' },
})
export class TabBar {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected onKey(e: KeyboardEvent) {
    move(e, this.host, '[role="tab"]');
  }
}

/**
 * One choice from a few values (Day / Week / Month, Morning / Evening, On the
 * farm / Departed / All). Children stay `aria-pressed` buttons inside a
 * labelled `role="group"`; the selected one is filled. The look is
 * `.segmented` in styles.css -- ONE copy, where there were eight.
 */
@Directive({
  selector: '[appSegmented]',
  host: { class: 'segmented', '(keydown)': 'onKey($event)' },
})
export class Segmented {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected onKey(e: KeyboardEvent) {
    move(e, this.host, ':scope > button');
  }
}
