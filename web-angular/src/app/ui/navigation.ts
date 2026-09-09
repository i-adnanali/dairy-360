import { Directive, inject, input } from '@angular/core';
import { Router } from '@angular/router';

@Directive({ selector: 'a[appIdentifier]', host: { class: 'identifier-link' } })
export class IdentifierLink {}

// Keep native table semantics and the real link. Row activation is an
// additional target; links, inputs, text selection and modifier-click retain
// their native behaviour. Enter/Space activate only when the row has focus.
@Directive({
  selector: 'tr[appRowLink]',
  host: {
    '[class.navigable-row]': '!!appRowLink()',
    '[attr.tabindex]': 'appRowLink() ? 0 : null',
    '(click)': 'click($event)',
    '(keydown)': 'key($event)',
  },
})
export class RowLink {
  readonly appRowLink = input<string | null>(null);
  private readonly router = inject(Router);
  click(e: MouseEvent): void {
    if (!this.appRowLink()) return;
    if (
      e.button ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey ||
      window.getSelection()?.toString()
    )
      return;
    if ((e.target as HTMLElement).closest('a, button, input, select, textarea')) return;
    void this.router.navigateByUrl(this.appRowLink()!);
  }
  key(e: KeyboardEvent): void {
    if (!this.appRowLink()) return;
    if (e.target !== e.currentTarget || !['Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    void this.router.navigateByUrl(this.appRowLink()!);
  }
}
