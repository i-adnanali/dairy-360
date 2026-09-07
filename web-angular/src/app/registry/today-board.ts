// `/` -- what still needs recording.
//
// ---------------------------------------------------------------------------
// WHY THIS REPLACED A REDIRECT TO THE HERD LIST
// ---------------------------------------------------------------------------
// The root used to redirect to /herd, and the reason was written down: the
// build existed to enter a herd, and the entry surface being one click deep
// would cost a click ~35 times in the backfill session. That backfill has still
// not run, and there are now three subsystems -- so landing on any one of them
// privileges it arbitrarily.
//
// ---------------------------------------------------------------------------
// EVERY LINE IS ACTIONABLE OR IT IS NOT ON THE PAGE
// ---------------------------------------------------------------------------
// No herd count, no litres this month, no revenue. Those are interesting and
// they are not what somebody opens this app holding. A landing page of figures
// nobody acts on is one people stop reading, and it takes the lines that DO
// need acting on down with it.
//
// So: four rows at most, each either "done" or a link to the screen that clears
// it. A farm with nothing outstanding sees a page that says so, which is a
// useful thing for a page to say.
//
// ---------------------------------------------------------------------------
// THE PAYROLL LINE PROMPTS ABOUT LAST MONTH, NOT THIS ONE
// ---------------------------------------------------------------------------
// The current month is outstanding for the whole of it. A line that is amber
// every day from the 1st to the 30th is a line nobody reads by the 3rd. Last
// month still unanswered on the 7th is a real prompt; this month unanswered on
// the 7th is just the calendar, so it is shown in passing and never flagged.

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { RegistryApi } from './api';
import { farmToday } from './today';
import { urlParams } from './url-state';
import type { DayBoard, SessionStanding } from './types';

@Component({
  selector: 'app-today-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="mx-auto max-w-2xl space-y-6">
      <header>
        <h2 class="text-lg font-semibold text-farm-900">Today</h2>
        <p class="mt-1 text-sm text-farm-600" data-role="date">{{ prettyDate() }}</p>
      </header>

      @if (loadError(); as e) {
        <p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" data-role="load-error">{{ e }}</p>
      }

      @if (board(); as b) {
        @if (allClear()) {
          <p class="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900"
            data-role="all-clear">
            Nothing outstanding. Both milkings and both dispatches are recorded, and the payroll is
            settled.
          </p>
        }

        <section class="space-y-2" data-role="milking">
          <h3 class="text-xs font-medium uppercase tracking-wide text-farm-500">Milking</h3>
          @for (s of b.milking; track s.session) {
            <a [routerLink]="['/milk/milking']" [queryParams]="{ on: b.on, session: s.session }"
              class="flex items-baseline justify-between rounded-xl border bg-white px-4 py-3 text-sm"
              [class]="s.complete ? 'border-farm-200' : 'border-amber-300'"
              [attr.data-session]="s.session" [attr.data-complete]="s.complete">
              <span class="capitalize text-farm-900">{{ s.session }}</span>
              <span [class]="s.complete ? 'text-farm-600' : 'font-medium text-amber-800'">
                {{ standing(s) }}
              </span>
            </a>
          }
        </section>

        <section class="space-y-2" data-role="dispatch">
          <h3 class="text-xs font-medium uppercase tracking-wide text-farm-500">Dispatch</h3>
          @for (s of b.dispatch; track s.session) {
            <a [routerLink]="['/milk/dispatch']" [queryParams]="{ on: b.on, session: s.session }"
              class="flex items-baseline justify-between rounded-xl border bg-white px-4 py-3 text-sm"
              [class]="s.complete ? 'border-farm-200' : 'border-amber-300'"
              [attr.data-session]="s.session" [attr.data-complete]="s.complete">
              <span class="capitalize text-farm-900">{{ s.session }}</span>
              <span [class]="s.complete ? 'text-farm-600' : 'font-medium text-amber-800'">
                {{ standing(s) }}
              </span>
            </a>
          }
        </section>

        <section class="space-y-2" data-role="payroll">
          <h3 class="text-xs font-medium uppercase tracking-wide text-farm-500">Payroll</h3>
          @if (b.payroll_previous; as prev) {
            <a [routerLink]="['/labour/payroll']"
              [queryParams]="{ from: prev.from_on, to: prev.to_on }"
              class="flex items-baseline justify-between rounded-xl border border-amber-300 bg-white
                px-4 py-3 text-sm" data-role="payroll-previous">
              <span class="text-farm-900">{{ monthName(prev.from_on) }}</span>
              <span class="font-medium text-amber-800">
                {{ prev.outstanding }} of {{ prev.permanent }} unanswered
              </span>
            </a>
          }
          <!-- The current month, stated and never flagged. -->
          <a [routerLink]="['/labour/payroll']"
            [queryParams]="{ from: b.payroll.from_on, to: b.payroll.to_on }"
            class="flex items-baseline justify-between rounded-xl border border-farm-200 bg-white
              px-4 py-3 text-sm" data-role="payroll-current">
            <span class="text-farm-900">{{ monthName(b.payroll.from_on) }}</span>
            <span class="text-farm-600">
              @if (b.payroll.permanent === 0) {
                nobody salaried
              } @else if (b.payroll.outstanding === 0) {
                recorded
              } @else {
                {{ b.payroll.outstanding }} of {{ b.payroll.permanent }} still to enter
              }
            </span>
          </a>
        </section>
      } @else {
        @if (!loadError()) { <p class="text-sm text-farm-500">Loading…</p> }
      }
    </div>
  `,
})
export class TodayBoard {
  private readonly api = inject(RegistryApi);

  protected readonly board = signal<DayBoard | null>(null);
  protected readonly loadError = signal<string | null>(null);

  /**
   * `?on=` opens the board on another day. There is deliberately NO date
   * control for it -- the same call /check makes for `as_of`.
   *
   * This screen answers "what needs recording NOW". A date picker would turn it
   * into a history browser, which is not what a landing page is for and would
   * make "nothing outstanding" ambiguous about which day it meant. The
   * parameter exists so a day can be reproduced from a link, and so the state
   * this board is most useful in -- a session missing -- is reachable without
   * waiting for one to happen.
   */
  private readonly url = urlParams({ on: farmToday() });
  protected readonly on = computed(() => this.url.value().on);

  constructor() {
    effect(() => {
      const on = this.on();
      void this.load(on);
    });
  }

  private async load(on: string): Promise<void> {
    try {
      this.board.set(await this.api.today(on));
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected standing(s: SessionStanding): string {
    if (s.expected === 0) return 'nothing expected';
    if (s.complete) return 'recorded';
    return `${s.recorded} of ${s.expected} recorded`;
  }

  /**
   * True only when there is genuinely nothing to do.
   *
   * Deliberately includes the payroll: a page that says "nothing outstanding"
   * while last month is unpaid would be the one wrong thing this screen could
   * say, because it is the one line somebody would trust without checking.
   */
  protected readonly allClear = computed(() => {
    const b = this.board();
    if (!b) return false;
    return (
      b.milking.every((s) => s.complete) &&
      b.dispatch.every((s) => s.complete) &&
      b.payroll_previous === null
    );
  });

  /** Farm-local, formatted without Intl -- see money.ts on host ICU data. */
  protected prettyDate(): string {
    const on = this.board()?.on ?? farmToday();
    const [y, m, d] = on.split('-').map(Number);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const day = days[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return `${day} ${d} ${MONTHS[m - 1]} ${y}`;
  }

  protected monthName(from: string): string {
    const [y, m] = from.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
