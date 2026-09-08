// "Is this a new one?" — animals that might already be the one being entered.
//
// ---------------------------------------------------------------------------
// THE HOLE THIS CLOSES
// ---------------------------------------------------------------------------
// An idempotency key cannot see a page refresh or a second browser tab: both
// get a fresh FormState and therefore a fresh key, so the server has no way to
// know the two submits are one write. `/add` is where that mints a permanent
// duplicate with no calving flow involved, and nothing in this registry can
// merge two animals back together.
//
// A query can see it, because by the time the second submit happens the first
// animal is sitting in the database. So this is the answer to a gap that
// idempotency structurally cannot cover, not a second line of the same defence.
//
// ---------------------------------------------------------------------------
// SOFT, AND THAT IS LOAD-BEARING
// ---------------------------------------------------------------------------
// It warns and offers a look. It never blocks, never disables submit, and no
// write consults it. Two animals with no name, the same sex and the same
// arrival year are genuinely two animals -- that is the roster pass, not a
// contrived case -- and a hard block would force the operator to invent a
// distinguishing detail, which is the same dishonesty the precision rules exist
// to prevent.
//
// ---------------------------------------------------------------------------
// A STANDALONE COMPONENT, FOR THE ROSTER PASS
// ---------------------------------------------------------------------------
// The roster pass needs exactly this query for its inline per-row detection,
// with `excludeId` set to the row being edited. Everything arrives as inputs;
// nothing about `/add` is baked in. Built here so the roster pass inherits it,
// the way calf-picker.ts was built for the workbench.

import {
  ChangeDetectionStrategy, Component, computed, effect, inject, input, signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { RegistryApi } from './api';
import type { DuplicateCandidate, RegistrySex } from './types';

/** Long enough that typing a name does not fire on every letter. */
export const DEBOUNCE_MS = 250;

@Component({
  selector: 'app-duplicate-warning',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (matches().length > 0) {
      <div class="rounded-xl border border-warning-line bg-warning-bg p-3" data-role="duplicate-warning">
        <p class="text-sm font-medium text-warning-strong">
          Is this a new one? {{ matches().length === 1 ? 'An animal' : 'Animals' }} already in the
          registry {{ matches().length === 1 ? 'looks' : 'look' }} like this.
        </p>
        <ul class="mt-2 space-y-1">
          @for (m of matches(); track m.id) {
            <li class="flex flex-wrap items-baseline gap-x-2 text-sm text-warning-strong">
              <span class="font-mono">{{ m.id }}</span>
              <span>{{ m.name ?? '—' }}</span>
              <span class="text-xs">{{ m.match_reason }}</span>
              <span class="text-xs italic" data-role="added">{{ age(m) }}</span>
              <button type="button" [attr.data-open]="m.id" (click)="open(m.id)"
                class="ml-auto text-xs font-medium underline">Open its record</button>
            </li>
          }
        </ul>
        <!-- No dismiss, and no acknowledgement to click. There is nothing to
             clear: the warning goes when what was typed stops matching, and
             submit was never blocked, so an "I know" button would only train
             the reflex of clicking one. -->
        <p class="mt-2 text-xs text-warning-fg">
          If it is genuinely a different animal, carry on — nothing is blocked.
        </p>
      </div>
    }
  `,
})
export class DuplicateWarning {
  readonly name = input('');
  readonly postNo = input('');
  readonly tagNo = input('');
  readonly sex = input<RegistrySex | null>(null);
  /** The animal being edited, so it cannot match itself. Unused by `/add`. */
  readonly excludeId = input<string | null>(null);
  /**
   * Bumped by a parent after a write, to re-run the query.
   *
   * The reason it is needed: the fields typically do not change between a
   * successful submit and the next record, so nothing else would re-trigger --
   * and the animal that was just created is exactly the one worth matching
   * against if the operator submits again.
   */
  readonly refreshToken = input(0);

  private readonly api = inject(RegistryApi);
  private readonly router = inject(Router);

  protected readonly matches = signal<DuplicateCandidate[]>([]);

  /** Everything the query depends on, in one place. */
  private readonly query = computed(() => ({
    name: this.name().trim(),
    post_no: this.postNo().trim(),
    tag_no: this.tagNo().trim(),
    sex: this.sex(),
    exclude_id: this.excludeId(),
    token: this.refreshToken(),
  }));

  private timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Monotonic request id, so a slow response cannot overwrite a newer one.
   *
   * Keystrokes produce overlapping requests and they do not come back in order.
   * Without this, pausing after "Kal" and then typing "i" can leave the "Kal"
   * matches on screen -- a warning about a name the operator is no longer
   * typing, which is worse than none.
   */
  private seq = 0;

  constructor() {
    effect((onCleanup) => {
      const q = this.query();
      if (q.name === '' && q.post_no === '' && q.tag_no === '') {
        this.matches.set([]);
        return;
      }

      if (this.timer !== null) clearTimeout(this.timer);
      const mine = ++this.seq;
      this.timer = setTimeout(() => {
        void this.api
          .duplicateCandidates({
            name: q.name,
            post_no: q.post_no,
            tag_no: q.tag_no,
            sex: q.sex,
            exclude_id: q.exclude_id,
          })
          .then((rows) => {
            if (mine === this.seq) this.matches.set(rows);
          })
          // Swallowed: these are suggestions, and an unreachable server must
          // not put an error next to a field nobody asked about. The write
          // itself reports the server being down, where it matters.
          .catch(() => undefined);
      }, DEBOUNCE_MS);

      onCleanup(() => {
        if (this.timer !== null) clearTimeout(this.timer);
      });
    });
  }

  /** How long ago the match was TYPED. Minutes means a probable double-submit. */
  protected age(m: DuplicateCandidate): string {
    if (m.recorded_at === null) return 'added at an unknown time';
    const ms = Date.now() - new Date(m.recorded_at).getTime();
    if (!Number.isFinite(ms) || ms < 0) return 'added just now';
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return 'added seconds ago';
    if (mins < 60) return `added ${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `added ${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? 'added yesterday' : `added ${days} days ago`;
  }

  protected open(id: string): void {
    void this.router.navigate(['/animals', id]);
  }
}
