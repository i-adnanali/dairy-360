// A one-of-many choice, reachable without a mouse.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// Five of these were hand-rolled across four screens as rows of
// `<button role="radio">` with no key handling at all. That is worse than it
// sounds: `role="radiogroup"` PROMISES arrow-key navigation to anything reading
// the ARIA, and every one of them was a row of independent tab stops instead.
// So the markup advertised a keyboard affordance that did not exist, which is
// an accessibility defect as much as a speed one.
//
// One component, five uses, so the behaviour cannot drift again -- the same
// argument as identifier-input.ts for wording and reads.ts for eligibility.
//
// ---------------------------------------------------------------------------
// ROVING TABINDEX, WHICH IS THE POINT
// ---------------------------------------------------------------------------
// A radiogroup is ONE tab stop, not one per option. Tab moves past the whole
// group; arrows move within it. That is what makes a form with three chip rows
// three tab stops instead of eight, and it is the difference between a form you
// can type through and one you have to steer through.
//
// Digits are the real accelerator: `1`/`2` for a sex, `1`/`2`/`3` for an
// outcome. On a transcription job the operator learns those in the first five
// animals and stops looking at the row entirely.
//
// NOTHING IS SELECTED BY DEFAULT unless the parent says so. The defaults rule
// decides that, not this component: sex arrives with `female` already chosen
// because a strong prior exists, while the gate's source form arrives with
// nothing, because it is a question about the operator's state of knowledge.
// When nothing is selected the FIRST chip is the tab stop, so the group is
// still reachable -- being reachable is not the same as being answered.

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

export interface ChipOption {
  value: string;
  label: string;
  /** Shown beside the label. Used by the gate, where each source needs a gloss. */
  hint?: string;
}

@Component({
  selector: 'app-chip-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="radiogroup"
      [attr.aria-label]="label()"
      [attr.data-role]="name() + '-group'"
      [class]="vertical() ? 'space-y-1' : 'flex flex-wrap gap-2'"
      (keydown)="onKeydown($event)"
    >
      @for (o of options(); track o.value; let i = $index) {
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="value() === o.value"
          [attr.data-chip]="o.value"
          [attr.data-index]="i"
          [tabindex]="tabIndexFor(i)"
          (click)="changed.emit(o.value)"
          [class]="chipClass(o.value)"
        >
          <!-- The accelerator is PRINTED, not just implemented. A shortcut
               nobody can see is a shortcut nobody uses. -->
          @if (i < 9) {
            <span class="mr-1.5 font-mono text-xs opacity-60" data-role="chip-key">{{ i + 1 }}</span>
          }
          <span>{{ o.label }}</span>
          @if (o.hint) {
            <span class="ml-2 text-xs opacity-75">{{ o.hint }}</span>
          }
        </button>
      }
    </div>
  `,
})
export class ChipGroup {
  readonly options = input.required<ChipOption[]>();
  /** Null means unanswered, which is a legitimate state -- see the header. */
  readonly value = input<string | null>(null);
  readonly label = input('Choose one');
  /** Used for the group's `data-role`, so specs can find a particular group. */
  readonly name = input('chips');
  readonly vertical = input(false);

  readonly changed = output<string>();

  private readonly index = computed(() => {
    const v = this.value();
    return v === null ? -1 : this.options().findIndex((o) => o.value === v);
  });

  /**
   * Exactly one chip is tabbable. When nothing is selected that is the first,
   * so Tab can reach an unanswered group at all.
   */
  protected tabIndexFor(i: number): number {
    const sel = this.index();
    return (sel === -1 ? 0 : sel) === i ? 0 : -1;
  }

  protected chipClass(v: string): string {
    const base =
      'inline-flex items-baseline rounded-lg border px-3 py-1.5 text-sm capitalize ' +
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-farm-500 focus-visible:ring-offset-1';
    const wide = this.vertical() ? ' w-full text-left normal-case' : '';
    return (
      base +
      wide +
      (this.value() === v
        ? ' border-farm-600 bg-farm-600 text-white'
        : ' border-farm-300 bg-white text-farm-800 hover:border-farm-400')
    );
  }

  /**
   * Arrows move and select together, which is the standard radiogroup contract:
   * in a group where every option is valid, arrowing to one IS choosing it, and
   * a separate confirm step would be a keystroke that means nothing.
   */
  protected onKeydown(e: KeyboardEvent): void {
    const opts = this.options();
    if (opts.length === 0) return;
    const cur = this.index();
    let next: number | null = null;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = cur === -1 ? 0 : (cur + 1) % opts.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = cur === -1 ? opts.length - 1 : (cur - 1 + opts.length) % opts.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = opts.length - 1;
        break;
      default: {
        if (/^[1-9]$/.test(e.key)) {
          const i = Number(e.key) - 1;
          if (i < opts.length) next = i;
          break;
        }
        // First letter of a label, so `l`/`s`/`d` pick an outcome. Only when it
        // is unambiguous: guessing between two labels sharing a letter would
        // move the selection somewhere the operator did not ask for.
        if (/^[a-z]$/i.test(e.key)) {
          const k = e.key.toLowerCase();
          const hits = opts
            .map((o, i) => (o.label.toLowerCase().startsWith(k) ? i : -1))
            .filter((i) => i >= 0);
          if (hits.length === 1) next = hits[0];
        }
        break;
      }
    }

    if (next === null) return;
    // Only now: an unhandled key must keep bubbling, or Enter would stop
    // reaching the form and Tab would stop leaving the group.
    e.preventDefault();
    this.changed.emit(opts[next].value);
    // Move focus with the selection, or the roving tabindex leaves focus on a
    // chip that is no longer the tab stop.
    const host = e.currentTarget as HTMLElement;
    (host.querySelector(`[data-index="${next}"]`) as HTMLElement | null)?.focus();
  }
}
