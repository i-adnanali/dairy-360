// Session provenance: source_form and recorded_by, set once and applied to
// every write.
//
// A backfill session is one person entering one kind of source. Retyping both
// on every one of ~35 forms is where transcription errors come from -- and
// defaulting them silently is worse, because a mislabelled provenance column is
// indistinguishable from a correct one.
//
// So: the app REFUSES to show any form until both are set, and shows them
// permanently in the header while they are.
//
// `observed_by` is deliberately NOT here. It is per-row and nullable -- nobody
// observed a purchase record -- and defaulting it to the session person would
// silently claim they witnessed things they were told about. Leaving it blank
// is the cheap path; asserting a witness takes a deliberate act, which is the
// same shape as precision-before-date.
//
// Nothing is persisted. A page reload asks again, on purpose: the tripwire list
// for this cycle forbids local state that outlives a page load, and a
// remembered `recorded_by` is exactly how a second person's entries get
// attributed to the first.

import { Injectable, computed, signal } from '@angular/core';
import type { SourceForm } from './types';

@Injectable({ providedIn: 'root' })
export class Session {
  readonly sourceForm = signal<SourceForm | null>(null);
  readonly recordedBy = signal<string>('');

  /**
   * Whether the gate is on screen.
   *
   * The gate used to be unavoidable: the shell refused to render ANY route
   * until provenance was set, so browsing the herd, a statement or /check meant
   * declaring a transcription session you were not about to have. The comment
   * above says the app "REFUSES to show any FORM" -- form, not screen -- and
   * the implementation was stricter than the rule it cited.
   *
   * Now reads are free and the gate is requested: by clicking "Start
   * recording", or by reaching for a write control that cannot work without it.
   */
  readonly setupOpen = signal(false);

  /** Ask for the gate. Called by SessionRequired and by the session bar. */
  requestSetup(): void {
    this.setupOpen.set(true);
  }

  dismissSetup(): void {
    this.setupOpen.set(false);
  }

  readonly ready = computed(
    () => this.sourceForm() !== null && this.recordedBy().trim().length > 0,
  );

  set(form: SourceForm, who: string): void {
    this.sourceForm.set(form);
    this.recordedBy.set(who.trim());
    this.setupOpen.set(false);
  }

  clear(): void {
    this.sourceForm.set(null);
    this.recordedBy.set('');
    // Re-opened, not merely cleared: "Change" is a deliberate act with an
    // intent behind it, and clearing without offering the form back would drop
    // the operator onto a screen whose write controls had all just vanished.
    this.setupOpen.set(true);
  }

  /** The provenance fields every write body needs. Throws if not ready. */
  provenance(): { source_form: SourceForm; recorded_by: string } {
    const form = this.sourceForm();
    const who = this.recordedBy().trim();
    if (form === null || who.length === 0) {
      throw new Error('session provenance is not set -- no form should have been reachable');
    }
    return { source_form: form, recorded_by: who };
  }
}
