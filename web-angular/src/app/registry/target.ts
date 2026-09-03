// Which database this app is pointed at.
//
// ---------------------------------------------------------------------------
// THE HAZARD THIS EXISTS FOR
// ---------------------------------------------------------------------------
// The app reaches a server through the dev proxy, which targets one port. The
// harness and the real server both serve `/api/registry` and are identical
// through the forms. So "which database am I writing to" was answerable only by
// noticing that the amber harness banner was NOT there -- and an absence is the
// wrong shape of signal for the dangerous direction. You notice a banner
// appearing; you do not notice one missing.
//
// Two things follow, and they are the whole of this file: the target is stated
// affirmatively in every case, including the case where we could not find out;
// and a session against a real database does not open until someone says so.
//
// ---------------------------------------------------------------------------
// WHY THE HARNESS IS NOT ASKED TO CONFIRM
// ---------------------------------------------------------------------------
// Deliberate asymmetry. Every click-through pass happens against the harness,
// so an acknowledgement asked there too would be clicked away dozens of times
// before the one that matters -- and by then it is furniture. Same reasoning as
// /check having no badge that turns green: a check you stop reading has stopped
// being a check.
//
// Nothing here is persisted. A reload asks again, on purpose -- the tripwire
// list for this cycle forbids local state that outlives a page load, and a
// remembered acknowledgement is one made about a database you may no longer be
// pointed at.

import { Injectable, computed, inject, signal } from '@angular/core';
import { RegistryApi } from './api';
import { Session } from './session';
import type { TargetKind } from './types';

@Injectable({ providedIn: 'root' })
export class Target {
  private readonly api = inject(RegistryApi);
  private readonly session = inject(Session);

  /** `harness` | `real` | `unknown`. `unknown` until the first probe answers. */
  readonly kind = signal<TargetKind>('unknown');
  /** The database's own name for itself: `:memory:`, or an absolute path. */
  readonly storage = signal<string | null>(null);
  /** False while the target has never been asked, so `unknown` reads correctly. */
  readonly probed = signal(false);
  /** Whether a server answered at all -- separates "none" from "would not say". */
  readonly reachable = signal(true);

  /**
   * The storage the current session was opened against.
   *
   * The STRING is recorded rather than a flag, so it can be compared later:
   * a session opened against `:memory:` is not a session opened against
   * `dairy.db`, whatever was clicked at the time.
   */
  private readonly startedOn = signal<string | null>(null);

  readonly basename = computed(() => {
    const s = this.storage();
    return s === null ? null : s.split('/').pop() || s;
  });

  /**
   * One in-flight probe at a time.
   *
   * The gate and the session bar both ask, and the initial navigation asks
   * again on top of them; three requests to answer one question would be noise,
   * and two racing answers could be applied out of order.
   */
  private inFlight: Promise<TargetKind> | null = null;

  /** Ask the server which database it writes to. */
  probe(): Promise<TargetKind> {
    this.inFlight ??= this.ask().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async ask(): Promise<TargetKind> {
    const { info, reachable } = await this.api.storage();
    this.reachable.set(reachable);
    this.probed.set(true);
    if (info === null) {
      // A server that would not say, or none at all. Reported as neither real
      // nor harness: the honest answer is that we do not know. `startedOn` is
      // deliberately left alone -- a server that is briefly down must not erase
      // what this session was opened against, or the next answer would have
      // nothing to be compared with.
      this.storage.set(null);
      this.kind.set('unknown');
      return 'unknown';
    }
    this.storage.set(info.storage);
    // An in-memory database cannot be the real registry: nothing in it outlives
    // the process. That is why `memory` is the discriminator and the path is
    // only reported alongside it.
    this.kind.set(info.memory ? 'harness' : 'real');
    return this.kind();
  }

  /** Called by the gate when a session opens, to anchor the drift check. */
  enter(): void {
    this.startedOn.set(this.storage());
  }

  /**
   * Re-ask, and if the database changed under a live session, send the operator
   * back to the gate.
   *
   * The gate runs once per page load, so without this the app could keep
   * showing "Harness" while the process on that port had been replaced by the
   * real server -- killing the harness and starting the real server is exactly
   * that sequence. A stale signal that is wrong in the dangerous direction is
   * worse than no signal.
   *
   * Clearing the session is the loud response, and it re-asks provenance along
   * with the target: those are the pair describing where a record came from and
   * where it is going, and neither survives the database changing.
   *
   * Becoming UNREACHABLE is not drift and does not clear anything. Nothing can
   * be written to a server that is not there, and a session lost to a restart
   * would just be retyped.
   */
  async reprobe(): Promise<void> {
    const anchor = this.startedOn();
    await this.probe();
    const now = this.storage();
    if (anchor !== null && now !== null && now !== anchor) {
      this.startedOn.set(null);
      this.session.clear();
    }
  }
}
