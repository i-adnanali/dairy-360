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
import { Theme } from "../../core/theme";

const NEXT: Record<string, string> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

@Component({
  selector: 'app-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './theme-toggle.html',
  styleUrl: './theme-toggle.css',
})
export class ThemeToggle {
  protected readonly theme = inject(Theme);
  protected next(): string {
    return NEXT[this.theme.mode()];
  }
}
