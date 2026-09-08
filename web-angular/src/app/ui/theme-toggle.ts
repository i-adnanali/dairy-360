// One control, three states. See core/theme.ts for why three.
//
// A COMPONENT rather than a directive, unlike everything else in this
// directory: the others are class bundles applied to an element the caller
// already owns, and this one has content and behaviour of its own.
//
// NO ICONS, and that is to match the app rather than to save a dependency.
// Every other control here is a word -- "Today", "Add animal", "nothing
// taken", "Recheck" -- and a sun/moon glyph would be the only place an
// operator had to learn a symbol. It also sidesteps the usual bug in icon
// toggles: a moon can mean either "you are in dark" or "switch to dark", and
// half of all implementations pick the one the reader does not expect. The word
// says which state you are IN, and `aria-label` says what pressing it does.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Theme } from '../core/theme';

const NEXT: Record<string, string> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

@Component({
  selector: 'app-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      data-role="theme-toggle"
      [attr.aria-label]="'Theme: ' + theme.mode() + '. Switch to ' + next() + '.'"
      (click)="theme.cycle()"
      class="rounded-lg px-2 py-1 text-xs font-medium text-content-muted
             hover:bg-surface-sunken hover:text-content-heading
             focus:outline-none focus-visible:ring-2 focus-visible:ring-focus
             focus-visible:ring-offset-1 focus-visible:ring-offset-surface-page"
    >
      <!-- The state you are in, not the one you are going to. -->
      <span class="capitalize" data-role="theme-mode">{{ theme.mode() }}</span>
      @if (theme.mode() === 'system') {
        <!-- Which way "system" currently resolves, because the word alone does
             not tell you whether the OS is light or dark, and that is the whole
             question somebody clicking this is asking. -->
        <span class="text-content-subtle" data-role="theme-resolved">
          · {{ theme.resolved() }}
        </span>
      }
    </button>
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(Theme);
  protected next(): string {
    return NEXT[this.theme.mode()];
  }
}
