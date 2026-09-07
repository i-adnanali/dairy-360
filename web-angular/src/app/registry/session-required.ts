// The stand-in for a write control when no recording session is set.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// The shell used to gate the whole router outlet on `session.ready()`, so
// nothing rendered at all until provenance was declared -- not the herd list,
// not a statement, not /check. Every one of those is a pure READ that needs no
// provenance, and being asked to name a transcription source before looking at
// a balance is a toll on the commonest thing anybody does here.
//
// session.ts stated the rule correctly and the code was stricter than the
// prose: "the app REFUSES to show any FORM until both are set". A form. So the
// gate moves to the forms, and this is what stands where the submit control
// would be.
//
// ---------------------------------------------------------------------------
// ONE COMPONENT, TWELVE CALL SITES
// ---------------------------------------------------------------------------
// The same argument identifier-input.ts makes for wording: twelve hand-rolled
// "you need a session" notices would drift, and the one that drifted would be
// the one that let a write through. Here the wording is in one place and the
// only thing a call site chooses is the noun.
//
// It replaces the button rather than disabling it. A disabled submit with no
// explanation is the shape that makes people reload the page looking for the
// bug; and a hidden-but-present submit inside a <form> is still reachable with
// Enter, which is why this is an @if at the call site and not a wrapper that
// projects its content.

import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { Session } from './session';

@Component({
  selector: 'app-session-required',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-300
      bg-amber-50 px-3 py-2 text-sm text-amber-900" data-role="session-required">
      <span>
        Recording is off, so {{ what() }} cannot be saved yet.
      </span>
      <button type="button" (click)="session.requestSetup()"
        class="font-medium underline" data-role="start-recording">Start recording</button>
    </div>
  `,
})
export class SessionRequired {
  /**
   * What cannot be saved, as a noun phrase -- "this run", "a payment".
   *
   * Required rather than defaulted to something generic: the prompt appears
   * beside a specific control, and "changes cannot be saved" beside a payment
   * form reads as a fault in the page rather than as a thing to do.
   */
  readonly what = input.required<string>();

  protected readonly session = inject(Session);
}
