// Session provenance: set once, shown always, applied to every write.
//
// And the target: which database the writes are landing in, stated in BOTH
// directions. It used to be shown only for the harness, so "this is the real
// registry" was communicated by an amber banner NOT being there -- see
// target.ts for why an absence is the wrong shape of signal.
//
// The real case gets a plain statement rather than an alarm colour. The
// friction belongs at the gate, where a deliberate act already lives; a
// permanent red band would be furniture within an hour, which is the same
// reason /check has no badge that turns green.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Session } from './session';
import { Target } from './target';

@Component({
  selector: 'app-session-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (target.kind() === 'harness') {
      <!-- Which database am I pointed at should never be a guess: the forms
           write real records. -->
      <div class="bg-amber-200 px-4 py-1.5 text-center text-xs font-medium text-amber-900"
        data-role="harness-banner">
        Harness — {{ target.storage() }} fixture data, discarded when the process exits. This is not the real registry.
      </div>
    }

    @if (session.ready()) {
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-farm-200 bg-farm-50 px-4 py-2 text-xs"
        data-role="session-summary">
        <span class="text-farm-600">Recording as</span>
        <span class="font-medium text-farm-900">{{ session.recordedBy() }}</span>
        <span class="text-farm-600">from</span>
        <span class="font-medium text-farm-900">{{ session.sourceForm() }}</span>
        @if (target.kind() === 'real') {
          <span class="text-farm-600">into</span>
          <span class="font-medium text-farm-900" data-role="target-summary"
            [title]="target.storage()">{{ target.basename() }}</span>
        }
        <button type="button" data-role="change-session" (click)="change()"
          class="ml-auto text-farm-700 underline">Change</button>
      </div>
    }
  `,
})
export class SessionBar {
  protected readonly session = inject(Session);
  protected readonly target = inject(Target);
  private readonly router = inject(Router);

  constructor() {
    void this.target.probe();

    // Re-ask on every navigation.
    //
    // The gate probes once per page load, so a server replaced on that port
    // while the app stayed loaded -- killing the harness and starting the real
    // server is exactly that -- would leave the amber banner showing over
    // writes going to dairy.db. A stale signal that is wrong in the dangerous
    // direction is worse than no signal, and navigation is the cheapest hook
    // that precedes reaching a form. If the answer changed, Target sends the
    // operator back to the gate rather than quietly updating the banner.
    //
    // Not a poll: a timer would be liveness machinery this surface has no use
    // for, and the residual case (submitting twice on one form while the
    // server is swapped underneath) is recorded as a known gap instead.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => void this.target.reprobe());
  }

  protected change(): void {
    this.session.clear();
  }
}
