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

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Session } from './session';
import { Target } from './target';

@Component({
  selector: 'app-session-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (mode() === 'storage' || mode() === 'both') {
      <span
        tabindex="0"
        class="storage-chip relative inline-block rounded-full border px-2 py-1 text-xs"
        [class.border-line-strong]="target.kind() === 'real'"
        [class.bg-warning-fill]="target.kind() !== 'real'"
        [class.text-warning-strong]="target.kind() !== 'real'"
        [attr.data-role]="target.kind() === 'harness' ? 'harness-banner' : 'target-summary'"
        [attr.aria-label]="target.kind() === 'real' ? 'registry: ' + target.storage() : null"
      >
        {{
          target.kind() === 'harness'
            ? 'harness · in memory'
            : target.kind() === 'real'
              ? 'registry'
              : 'target unknown'
        }}
        @if (target.kind() === 'real') {
          <span
            class="storage-path absolute left-0 top-full z-40 mt-1 max-w-[80vw] break-all rounded border border-line bg-surface-raised p-2 text-content-primary"
            >{{ target.storage() }}</span
          >
        }
      </span>
    }
    @if (mode() === 'session' || mode() === 'both') {
      @if (session.ready()) {
        <span data-role="session-summary">
          <button
            type="button"
            class="rounded-full border border-line-strong px-2 py-1 text-xs text-content-primary"
            data-role="change-session"
            (click)="session.requestSetup()"
          >
            {{ session.sourceForm() }} · {{ session.recordedBy() }}
          </button>
        </span>
      } @else {
        <span data-role="browsing">
          <button
            type="button"
            class="rounded-full border border-line px-2 py-1 text-xs text-content-subtle"
            data-role="start-session"
            (click)="session.requestSetup()"
          >
            browsing<span class="sr-only"> — nothing is being recorded</span>
          </button>
        </span>
      }
    }
  `,
})
export class SessionBar implements OnInit {
  readonly mode = input<'storage' | 'session' | 'both'>('both');
  protected readonly session = inject(Session);
  protected readonly target = inject(Target);
  private readonly router = inject(Router);

  private readonly destroyRef = inject(DestroyRef);

  ngOnInit() {
    if (this.mode() === 'session') return;
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
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => void this.target.reprobe());
  }

  protected change(): void {
    this.session.clear();
  }
}
