import { DraftRegistry } from "../draft-registry";
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

import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { ChipGroup } from "../chip-group/chip-group";
import { Session } from "../session";
import { Target } from "../target";
import type { SourceForm } from "../types";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { PageHeading } from "../../ui/heading";
import { SectionLabel } from "../../ui/text";
import { Button } from "../../ui/button";

@Component({
  selector: 'app-session-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ChipGroup, HelpText, PageHeading, SectionLabel, TextInput],
  templateUrl: './session-gate.html',
  styleUrl: './session-gate.css',
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
  private readonly drafts = inject(DraftRegistry);
  protected readonly target = inject(Target);

  protected readonly forms: { value: SourceForm; label: string; hint: string }[] = [
    { value: 'recall', label: 'Recall', hint: 'reconstructed from memory' },
    { value: 'daily_herd_sheet', label: 'Daily herd sheet', hint: 'the signed paper round' },
    { value: 'cycle_card', label: 'Cycle card', hint: "an animal's own card" },
    { value: 'direct_entry', label: 'Direct entry', hint: 'seen and typed now' },
    { value: 'import', label: 'Import', hint: 'from another system' },
  ];

  protected readonly form = signal<SourceForm | null>(
    this.session.setupOpen() ? this.session.sourceForm() : null,
  );
  protected readonly who = signal(this.session.setupOpen() ? this.session.recordedBy() : '');
  protected readonly acked = linkedSignal({
    source: () => [this.target.storage(), this.target.kind(), this.target.reachable()].join('|'),
    computation: () => false,
  });

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
      !this.target.pending() && this.target.probed() && this.form() !== null && this.who().trim().length > 0 && (!this.needsAck() || this.acked()),
  );

  constructor() {
    // Asked fresh every time the gate is shown. The acknowledgement lives on
    // this component rather than on the service, so it cannot outlive the
    // screen that asked for it: the gate is reached again precisely when
    // something changed, and a remembered "yes" would be about the old answer.
    void this.target.probe();
  }

  protected async start(): Promise<void> {
    const f = this.form();
    const who = this.who();
    if (f === null || !this.canStart()) return;
    if (
      (f !== this.session.sourceForm() || this.who().trim() !== this.session.recordedBy()) &&
      this.drafts.hasChanges() &&
      !(await this.drafts.request())
    )
      return;
    if (!this.canStart() || this.form() !== f || this.who() !== who) return;
    this.target.enter();
    this.session.set(f, who);
  }
}
