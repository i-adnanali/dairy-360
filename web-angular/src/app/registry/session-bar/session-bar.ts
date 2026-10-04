import { DraftRegistry } from "../draft-registry";
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
import { Session } from "../session";
import { Target } from "../target";

@Component({
  selector: 'app-session-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-bar.html',
  styleUrl: './session-bar.css',
})
export class SessionBar implements OnInit {
  protected sourceLabel() {
    return ({ direct_entry: 'Direct entry', recall: 'Recall', daily_herd_sheet: 'Daily herd sheet', cycle_card: 'Cycle card', import: 'Import' } as Record<string, string>)[this.session.sourceForm() ?? ''] ?? this.session.sourceForm();
  }
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

  private readonly drafts = inject(DraftRegistry);
  protected async change(): Promise<void> {
    if (this.drafts.hasChanges() && !(await this.drafts.request())) return;
    this.session.clear();
  }
}
