// A free-text identifier field, backed by a datalist of what has been used.
//
// ---------------------------------------------------------------------------
// THE PROBLEM THIS SOLVES, AND WHY IT IS NOT A DROPDOWN
// ---------------------------------------------------------------------------
// Free text typed across a hundred records produces `abdul`, `Abdul` and
// `abdul_r` -- three identifiers for one person. That makes "everything Abdul
// observed" unanswerable, and it cannot be repaired later without someone
// deciding which spelling was meant, which is a guess about the past.
//
// A `<datalist>` is the right shape because it is a SUGGESTION and not a
// constraint: the second occurrence of a name becomes a pick instead of a
// retype, while a genuinely new name stays typeable with no friction at all.
// A `<select>` would force every new person through an "add new" flow, which is
// how an operator ends up typing a name into the wrong field to get past it.
//
// ---------------------------------------------------------------------------
// ONE COMPONENT FOR ALL THREE FIELDS, AND FOR THE `observed_by` WORDING
// ---------------------------------------------------------------------------
// `observed_by` appeared on three forms with three different hints -- "leave
// blank unless someone actually saw it" on /add, a bare "(optional)" on the
// other two -- while `recorded_by` was the only field told to be a stable
// identifier and not a display name. One field, three treatments, and the one
// piece of guidance that prevents the `abdul`/`Abdul` split was on none of
// them. Putting the wording here makes it impossible for the three to drift
// again, which is the same argument as computing `ineligible_reason` on the
// server.

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** The wording each field carries, in one place so three forms cannot diverge. */
export const IDENTIFIER_GUIDANCE = {
  observed_by:
    'Who actually saw it. Leave blank unless someone did — nobody observed a purchase record. ' +
    'A stable identifier, not a display name.',
  acquired_from: 'Who it came from. A stable identifier, not a display name.',
  sire_ref: 'Free text. A stable identifier, not a display name.',
} as const;

export type IdentifierField = keyof typeof IDENTIFIER_GUIDANCE;

@Component({
  selector: 'app-identifier-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="block">
      <span class="mb-1 block text-xs font-medium text-farm-700">
        {{ label() }} <span class="font-normal text-farm-500">(optional)</span>
      </span>
      <input
        [attr.data-role]="field()"
        [attr.list]="listId()"
        [value]="value()"
        (input)="changed.emit($any($event.target).value)"
        class="w-full max-w-md rounded-lg border border-farm-300 px-2 py-1.5 text-sm"
      />
      <!-- Suggestions only. An empty datalist is harmless: the input behaves
           exactly as a plain text field, which is the state of a fresh
           registry and must not look broken. -->
      <datalist [attr.id]="listId()">
        @for (v of suggestions(); track v) {
          <option [value]="v"></option>
        }
      </datalist>
      <span class="mt-1 block text-xs text-farm-600" [attr.data-role]="field() + '-hint'">
        {{ guidance() }}
      </span>
    </label>
  `,
})
export class IdentifierInput {
  readonly field = input.required<IdentifierField>();
  readonly label = input.required<string>();
  readonly value = input('');
  readonly suggestions = input<string[]>([]);
  readonly changed = output<string>();

  /**
   * Unique per field, because two datalists sharing an id would silently make
   * one of them win for both inputs -- and on the workbench there will be
   * several of these on one page.
   */
  protected readonly listId = computed(() => `identifier-list-${this.field()}`);
  protected readonly guidance = computed(() => IDENTIFIER_GUIDANCE[this.field()]);
}
