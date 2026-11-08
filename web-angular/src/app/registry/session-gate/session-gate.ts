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

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { RegistryApi } from "../api";
import { WriteLog } from "../after-write";
import { ChipGroup } from "../chip-group/chip-group";
import { Session } from "../session";
import { Target } from "../target";
import type { SourceForm } from "../types";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { PageHeading } from "../../ui/heading";
import { Button } from "../../ui/button";

@Component({
  selector: 'app-session-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, ChipGroup, HelpText, PageHeading, TextInput],
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

  /**
   * Direct entry FIRST: it is the daily case -- today's milking, dispatch and
   * feeding, seen and typed now. The paper sources and recall are for catching
   * up on the past, so they follow. The order is the only thing that changed;
   * there is still no default.
   */
  protected readonly forms: { value: SourceForm; label: string; hint: string }[] = [
    { value: 'direct_entry', label: 'Direct entry', hint: 'seen and typed now' },
    { value: 'daily_herd_sheet', label: 'Daily herd sheet', hint: 'from the signed paper round' },
    { value: 'cycle_card', label: 'Cycle card', hint: "from an animal's own card" },
    { value: 'recall', label: 'Recall', hint: 'from memory' },
    { value: 'import', label: 'Import', hint: 'from another system' },
  ];

  /** In the side panel: a close button, Cancel, and Escape. Inline on a form-only page: Cancel only. */
  readonly dismissible = input(true);
  readonly cancelled = output<void>();
  /** What the operator was about to save, when the panel opened from a form. */
  readonly purpose = input<string | null>(null);

  /** Names already on records, most-used first: one tap instead of retyping. */
  protected readonly recorders = signal<string[]>([]);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly writeLog = inject(WriteLog);
  private readonly api = inject(RegistryApi);

  /** Says what is still missing, instead of a silently greyed-out button. */
  protected readonly blocker = computed(() => {
    if (!this.target.probed() || this.target.pending()) return 'Checking where records will be saved…';
    const noWho = this.who().trim().length === 0, noForm = this.form() === null;
    if (noWho && noForm) return 'Say who is typing and where the records come from.';
    if (noWho) return 'Say who is typing.';
    if (noForm) return 'Choose where the records come from.';
    if (this.needsAck() && !this.acked()) return 'Confirm the database below.';
    return null;
  });

  protected pickName(name: string): void {
    this.who.set(name);
  }

  /** 1-5 choose a source from anywhere in the panel except a text field. */
  protected onKeydown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= this.forms.length && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.form.set(this.forms[n - 1].value);
      e.preventDefault();
    }
  }

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
    // Suggestions only: if the lookup is missing or fails, typing still works.
    void Promise.resolve()
      .then(() => this.api.identifierValues())
      .then(
        (v) => this.recorders.set((v?.recorded_by ?? []).slice(0, 6)),
        () => undefined,
      );
    // Focus INTO the panel: it used to stay on the button that opened it, so a
    // keyboard had to tab through the whole page behind to reach the form.
    afterNextRender(() => {
      this.host.querySelector<HTMLElement>('[data-role="gate-title"]')?.focus({ preventScroll: true });
    });
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
    const changed = this.session.ready();
    this.session.set(f, who);
    const label = this.forms.find((x) => x.value === f)?.label ?? f;
    this.writeLog.announce(`${changed ? 'Recording changed' : 'Recording started'}: ${who.trim()} · ${label}`);
  }
}
