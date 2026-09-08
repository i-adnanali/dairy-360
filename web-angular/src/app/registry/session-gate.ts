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
//
// It also states WHICH DATABASE the session will write to, and when that is a
// real one it will not open until the operator says so. The gate is the right
// place for it because it is the one screen guaranteed to be crossed before any
// write, so no per-form or per-write plumbing is needed -- and because "who is
// typing, from what source, into which database" is one statement of intent.
// See target.ts for why the harness deliberately is not asked to confirm.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ChipGroup } from './chip-group';
import { Session } from './session';
import { Target } from './target';
import type { SourceForm } from './types';
import { HelpText } from '../ui/text';
import { TextInput } from '../ui/input';
import { PageHeading } from '../ui/heading';
import { SectionLabel } from '../ui/text';
import { Button } from '../ui/button';

@Component({
  selector: 'app-session-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ChipGroup, HelpText, PageHeading, SectionLabel, TextInput],
  template: `
    <form class="mx-auto max-w-lg rounded-2xl border border-line bg-surface-raised p-6"
      data-role="gate" (submit)="onSubmit($event)">
      <h2 appPageHeading>Before entering anything</h2>
      <p appHelp class="mt-1">
        Both of these go on every record you write in this session. They are asked once rather
        than on each form, and they are not defaulted — a mislabelled source reads exactly like a
        correct one.
      </p>

      <div class="mt-5">
        <div appSectionLabel legend>
          Where is this coming from?
        </div>
        <app-chip-group
          name="source-form" label="Where is this coming from?" [vertical]="true"
          [options]="forms" [value]="form()" (changed)="form.set($any($event))"
        />
      </div>

      <label class="mt-5 block">
        <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-content-muted">
          Who is typing?
        </span>
        <input data-role="recorded-by" [value]="who()" (input)="who.set($any($event.target).value)"
          placeholder="a stable identifier, not a display name" appInput density="comfortable" class="w-full" />
        <span class="mt-1 block text-xs text-content-muted">
          Recorded on every event as <span class="font-mono">recorded_by</span>. Whoever remembered
          it, if this is recall.
        </span>
      </label>

      <p class="mt-4 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-content-secondary">
        Whether someone actually <em>saw</em> a thing is asked per record, and left blank by
        default. Nobody observed a purchase record.
      </p>

      <!-- Which database, stated positively in every case -- including the one
           where we could not find out. -->
      @if (target.probed()) {
        <div class="mt-5 border-t border-line-subtle pt-4" data-role="target">
          <div appSectionLabel legend>
            Where is this going?
          </div>

          @switch (target.kind()) {
            @case ('harness') {
              <p class="text-sm text-content-secondary" data-role="target-harness">
                <span class="font-medium text-content-primary">Harness</span> —
                <span class="font-mono text-xs">{{ target.storage() }}</span>. Fixture data,
                discarded when that process exits. Nothing you enter here is kept.
              </p>
            }
            @case ('real') {
              <p class="text-sm text-content-secondary" data-role="target-real">
                <span class="font-medium text-content-primary">The real registry</span> —
                <span class="font-mono text-xs">{{ target.storage() }}</span>. Every record you
                enter is permanent: corrections are new events, and nothing is deleted.
              </p>
            }
            @case ('unknown') {
              <p class="text-sm text-content-secondary" data-role="target-unknown">
                {{ target.reachable()
                  ? 'A server answered but would not say which database it holds — an older build, or something else serving /api. Treated as real, because it cannot be ruled out.'
                  : 'No server answered. Nothing can be written until one does.' }}
              </p>
            }
          }

          <!-- Asked for the real case AND for the case we could not determine,
               because "we could not tell" must not resolve in the permissive
               direction. Not asked on the harness: see target.ts. -->
          @if (needsAck()) {
            <label class="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm">
              <input type="checkbox" data-role="acknowledge-target" class="mt-0.5"
                [checked]="acked()" (change)="acked.set($any($event.target).checked)" />
              <span class="text-content-heading">
                I mean to write to this database. This is not the harness.
              </span>
            </label>
          }
        </div>
      }

      <button type="submit" data-role="start" [appButtonDisabled]="!canStart()" appButton class="mt-5 w-full"
      >Start entering</button>
    </form>
  `,
})
export class SessionGate {
  /**
   * The NATIVE submit event, not FormsModule's `ngSubmit`.
   *
   * `(ngSubmit)` is an output on the `NgForm` directive, so without importing
   * FormsModule it binds to nothing at all -- the form falls through to a real
   * browser submission and the page reloads. Caught by the specs, which saw
   * zero requests. The native event needs `preventDefault()` for the same
   * reason, and avoids pulling in a forms library this app does not otherwise
   * use.
   */
  protected onSubmit(e: Event): void {
    e.preventDefault();
    this.start();
  }

  protected readonly session = inject(Session);
  protected readonly target = inject(Target);

  protected readonly forms: { value: SourceForm; label: string; hint: string }[] = [
    { value: 'recall', label: 'Recall', hint: 'reconstructed from memory' },
    { value: 'daily_herd_sheet', label: 'Daily herd sheet', hint: 'the signed paper round' },
    { value: 'cycle_card', label: 'Cycle card', hint: "an animal's own card" },
    { value: 'direct_entry', label: 'Direct entry', hint: 'seen and typed now' },
    { value: 'import', label: 'Import', hint: 'from another system' },
  ];

  protected readonly form = signal<SourceForm | null>(null);
  protected readonly who = signal('');
  protected readonly acked = signal(false);

  /**
   * A target that has to be confirmed out loud before this session opens.
   *
   * True for a real database, and also when the target could not be determined
   * from a server that IS answering -- "we could not tell" must not resolve in
   * the permissive direction. False when nothing answered at all: a session
   * cannot be blocked on a server that is merely not started yet, and no write
   * can reach a database that is not there.
   */
  protected readonly needsAck = computed(
    () =>
      this.target.kind() === 'real' ||
      (this.target.kind() === 'unknown' && this.target.probed() && this.target.reachable()),
  );

  protected readonly canStart = computed(
    () =>
      this.form() !== null &&
      this.who().trim().length > 0 &&
      (!this.needsAck() || this.acked()),
  );

  constructor() {
    // Asked fresh every time the gate is shown. The acknowledgement lives on
    // this component rather than on the service, so it cannot outlive the
    // screen that asked for it: the gate is reached again precisely when
    // something changed, and a remembered "yes" would be about the old answer.
    void this.target.probe();
  }

  protected start(): void {
    const f = this.form();
    if (f === null || !this.canStart()) return;
    this.target.enter();
    this.session.set(f, this.who());
  }
}
