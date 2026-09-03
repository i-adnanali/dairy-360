// The gate every form is behind.
//
// Provenance is set ONCE per session and applied to every write, because a
// backfill session is one person entering one kind of source and retyping both
// on every form is where transcription errors come from.
//
// It is a GATE rather than a default: an unset provenance means no form is
// reachable at all. Defaulting it silently would be worse than asking -- a
// mislabelled source_form is indistinguishable from a correct one, and the
// whole point of the column is that `recall` and `daily_herd_sheet` can be told
// apart when the first calving-interval number is questioned.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Session } from './session';
import type { SourceForm } from './types';

@Component({
  selector: 'app-session-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-lg rounded-2xl border border-farm-300 bg-white p-6" data-role="gate">
      <h2 class="text-lg font-semibold text-farm-900">Before entering anything</h2>
      <p class="mt-1 text-sm text-farm-600">
        Both of these go on every record you write in this session. They are asked once rather
        than on each form, and they are not defaulted — a mislabelled source reads exactly like a
        correct one.
      </p>

      <div class="mt-5">
        <div class="mb-1 text-xs font-medium uppercase tracking-wide text-farm-600">
          Where is this coming from?
        </div>
        <div class="space-y-1">
          @for (f of forms; track f.value) {
            <button type="button" [attr.data-source-form]="f.value" (click)="form.set(f.value)"
              class="block w-full rounded-lg border px-3 py-2 text-left text-sm"
              [class]="form() === f.value ? 'border-farm-600 bg-farm-100' : 'border-farm-300 bg-white hover:border-farm-400'"
            >
              <span class="font-medium text-farm-900">{{ f.label }}</span>
              <span class="ml-2 text-xs text-farm-600">{{ f.hint }}</span>
            </button>
          }
        </div>
      </div>

      <label class="mt-5 block">
        <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-farm-600">
          Who is typing?
        </span>
        <input data-role="recorded-by" [value]="who()" (input)="who.set($any($event.target).value)"
          placeholder="a stable identifier, not a display name"
          class="w-full rounded-lg border border-farm-300 px-3 py-2 text-sm" />
        <span class="mt-1 block text-xs text-farm-600">
          Recorded on every event as <span class="font-mono">recorded_by</span>. Whoever remembered
          it, if this is recall.
        </span>
      </label>

      <p class="mt-4 rounded-lg bg-farm-100 px-3 py-2 text-xs text-farm-700">
        Whether someone actually <em>saw</em> a thing is asked per record, and left blank by
        default. Nobody observed a purchase record.
      </p>

      <button type="button" data-role="start" (click)="start()" [disabled]="!canStart()"
        class="mt-5 w-full rounded-xl bg-farm-600 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-farm-300"
      >Start entering</button>
    </div>
  `,
})
export class SessionGate {
  protected readonly session = inject(Session);

  protected readonly forms: { value: SourceForm; label: string; hint: string }[] = [
    { value: 'recall', label: 'Recall', hint: 'reconstructed from memory' },
    { value: 'daily_herd_sheet', label: 'Daily herd sheet', hint: 'the signed paper round' },
    { value: 'cycle_card', label: 'Cycle card', hint: "an animal's own card" },
    { value: 'direct_entry', label: 'Direct entry', hint: 'seen and typed now' },
    { value: 'import', label: 'Import', hint: 'from another system' },
  ];

  protected readonly form = signal<SourceForm | null>(null);
  protected readonly who = signal('');
  protected readonly canStart = computed(
    () => this.form() !== null && this.who().trim().length > 0,
  );

  protected start(): void {
    const f = this.form();
    if (f === null) return;
    this.session.set(f, this.who());
  }
}
