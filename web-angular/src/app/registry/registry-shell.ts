// The registry area: session gate, nav, and the routed view.

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { WriteLog } from './after-write';
import { Session } from './session';
import { SessionBar } from './session-bar';
import { SessionGate } from './session-gate';

@Component({
  selector: 'app-registry-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SessionBar, SessionGate],
  template: `
    <div class="flex h-full flex-col bg-farm-50 text-farm-900">
      <app-session-bar />

      <!-- TEN links in TWO GROUPS, plus Today ungrouped -- and this is the
           decision REGISTRY_SALES.md §12.4 deferred twice.

           It said the grouping "should be made when the seventh item exists and
           is being used, not predicted from six". The seventh exists, and
           payroll brings three more, so the flat row is past the point where it
           reads as a row at all.

           The split is RECORD versus REVIEW -- what you come here to write down
           against what you come here to look up. It is not alphabetical, not by
           subject (animals/milk/money/people), and not by frequency, because
           only one of those tells you where to look when you arrive holding a
           number you need to enter.

           THE URLs GROUP BY SUBJECT INSTEAD, and that divergence is deliberate:
           a nav entry answers "what am I doing", a URL names a thing. Encoding
           the activity in the path -- /record/milking -- would put one subject
           in two places and mean nothing to whoever received the link. See
           app.routes.ts.

           Herd sits in review rather than record even though /add and
           /calving write animals: the list itself is a lookup, and the two
           writing screens are already named for what they write.

           One row on a wide screen, two on a narrow one. If a third group ever
           appears this becomes a real navigation problem rather than a layout
           one -- and that is the point at which it should stop being a row. -->
      <header class="border-b border-farm-200 bg-white px-4 py-3">
        <div class="mx-auto flex max-w-4xl flex-wrap items-baseline gap-x-6 gap-y-2">
          <h1 class="text-base font-semibold tracking-tight">Animal registry</h1>
          <!-- ALWAYS RENDERED. The nav used to be hidden until provenance was
               declared, which meant an operator who only wanted to look at a
               balance could not even see where to look. -->
          @if (true) {
            <nav class="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm" data-role="nav">
              <!-- Today is first and ungrouped: it is not a subject, it is the
                   answer to "what now", and putting it under Record or Review
                   would make it look like one screen among several. -->
              <a routerLink="/" [routerLinkActiveOptions]="{ exact: true }"
                routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800" data-role="nav-today">Today</a>

              <span class="ml-2 text-[10px] font-medium uppercase tracking-wide text-farm-400"
                data-role="nav-group-record">Record</span>
              <a routerLink="/animals/new" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Add animal</a>
              <a routerLink="/animals/calvings/new" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Record calving</a>
              <a routerLink="/milk/milking" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Milking</a>
              <a routerLink="/milk/dispatch" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Dispatch</a>
              <a routerLink="/labour/payroll" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Payroll</a>

              <span class="ml-2 text-[10px] font-medium uppercase tracking-wide text-farm-400"
                data-role="nav-group-review">Review</span>
              <a routerLink="/animals" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Herd</a>
              <a routerLink="/milk/buyers" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Buyers</a>
              <a routerLink="/labour/people" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">People</a>
              <a routerLink="/check" routerLinkActive="font-medium text-farm-900"
                class="text-farm-600 hover:text-farm-800">Check</a>
            </nav>
          }
        </div>
      </header>

      <!-- WHAT JUST HAPPENED, without looking for it.
           A cleared form is ambiguous: it looks exactly like a form that was
           never filled in. So the write says which serial it wrote, in a live
           region a screen reader announces and in a line that persists until
           the next write replaces it. Not a toast -- an operator who looks up
           five seconds later should not have to reconstruct it from the herd
           list.
           'aria-live="polite"' rather than assertive: it must not interrupt
           typing, which is the entire activity here. -->
      <div aria-live="polite" aria-atomic="true" class="sr-only" data-role="write-announce">
        {{ writeLog.last() }}
      </div>
      @if (writeLog.last(); as msg) {
        <div class="border-b border-green-200 bg-green-50 px-4 py-1.5 text-center text-xs font-medium text-green-900"
          data-role="write-log">{{ msg }}</div>
      }

      <!-- READS ARE FREE; ONLY A SCREEN THAT IS NOTHING BUT A FORM IS GATED.

           This used to be an @if on session.ready() around the whole outlet, so
           no route rendered until provenance was declared. That was stricter
           than the rule session.ts states -- "refuses to show any FORM" -- and
           it charged a toll on the commonest thing anybody does here, which is
           look something up.

           Two routes are pure write surfaces (/animals/new and
           /animals/calvings/new): there is nothing on them to browse, so
           arriving without a session should ask immediately rather than show a
           form whose submit is a prompt. They declare data.writes === true in
           app.routes.ts and are gated here.

           Every other screen renders, and its write controls carry
           <app-session-required> instead of a submit. -->
      <!-- Requested from a write control: the gate opens ABOVE the screen and
           the screen STAYS MOUNTED. Swapping the outlet for it would destroy
           the routed component and take any half-typed figure with it, which is
           precisely the moment somebody reaches for this. -->
      @if (session.setupOpen() && !session.ready() && !writeOnlyRoute()) {
        <div class="border-b border-farm-200 bg-white" data-role="session-setup">
          <app-session-gate />
        </div>
      }

      <main class="flex-1 overflow-y-auto px-4 py-6">
        @if (writeOnlyRoute() && !session.ready()) {
          <app-session-gate />
        } @else {
          <router-outlet />
        }
      </main>
    </div>
  `,
})
export class RegistryShell {
  protected readonly session = inject(Session);
  protected readonly writeLog = inject(WriteLog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * True when the active route is nothing but a form.
   *
   * Read from the ROUTE rather than from a list of paths in here: a path list
   * beside the route table is a second copy, and the enumeration deleted from
   * routes.ts went stale three times before anyone removed it.
   */
  protected readonly writeOnlyRoute = signal(this.declaresWrites());

  constructor() {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.writeOnlyRoute.set(this.declaresWrites()));
  }

  /**
   * Walk to the deepest activated route and read its `writes` flag.
   *
   * DEFENSIVE ABOUT `snapshot`, and not for tidiness: the shell is constructed
   * DURING the navigation that activates it, so a child route can already be
   * linked while its snapshot is still undefined. Reading it eagerly threw, and
   * every router test caught it. The NavigationEnd subscription sets the real
   * answer a tick later, so a false here is only ever momentary -- and false is
   * the safe direction: it renders the screen rather than the gate.
   */
  private declaresWrites(): boolean {
    let r: ActivatedRoute | null = this.route;
    while (r?.firstChild) r = r.firstChild;
    return r?.snapshot?.data?.['writes'] === true;
  }
}
