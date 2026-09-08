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
import { Assistant } from '../core/assistant';
import { AssistantPanel } from '../components/assistant-panel';
import { Session } from './session';
import { SessionBar } from './session-bar';
import { SessionGate } from './session-gate';
import { ThemeToggle } from '../ui/theme-toggle';
import { TextLink } from '../ui/text';

@Component({
  selector: 'app-registry-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AssistantPanel, RouterLink, RouterLinkActive, RouterOutlet, SessionBar, SessionGate,
    TextLink, ThemeToggle,
  ],
  template: `
    <div class="flex h-full flex-col bg-surface-page text-content-primary">
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
      <header class="border-b border-line-subtle bg-surface-raised px-4 py-3">
        <div class="mx-auto max-w-4xl">
          <!--
            TWO ROWS, EXPLICITLY, AND THAT IS ABOUT HEIGHT.

            The toggle was first added to the same wrapping flex row as the title
            and the nav, pushed right with ml-auto. The nav is ten links and
            already wraps to a second line, so the toggle wrapped to a THIRD --
            +34px of header on twelve of the fourteen screens, permanently, for
            one control. Measured, not guessed.

            The title is short, so pairing it with the toggle costs nothing. The
            cost is that the toggle is now the header's FIRST tab stop rather
            than its last: an operator tabbing for the nav passes it. That is the
            better half of the trade -- one extra Tab against 34px on every
            screen -- but it is a trade and not a free win.
          -->
          <div class="flex items-baseline justify-between gap-4">
            <h1 class="text-base font-semibold tracking-tight">Animal registry</h1>
            <!-- ---------------------------------------------------------
                 THE ASSISTANT TOGGLE, PARKED. §13.1 says it belongs in the
                 header, and the header §13.1 means is §12.1's -- three zones
                 over two explicit rows, with the storage chip, the session
                 chip, the theme toggle and this one placed deliberately.
                 THAT IS PHASE 7 and it is gated on the five-animal trial,
                 because it changes the chrome around the frozen forms and the
                 tab order into them.

                 So it goes where the current header can carry it: row 1 holds
                 a short title and the theme toggle and nothing else, so one
                 more small control fits without touching row 2. §11 records
                 the theme toggle costing 34px when it was first put in the
                 SAME wrapping row as the ten-link nav; this is the row that
                 cannot wrap.

                 WHEN §12.1 IS BUILT, this moves to the right zone beside the
                 session chip and this comment goes with it. Note the tab-order
                 consequence §11 already flagged for the theme toggle: there
                 are now TWO controls ahead of the nav rather than one.
                 --------------------------------------------------------- -->
            <div class="flex items-baseline gap-3">
              <button
                type="button"
                (click)="assistant.toggle()"
                [attr.aria-expanded]="assistant.open()"
                aria-controls="assistant-panel"
                class="rounded-sm text-xs text-content-muted hover:text-content-primary
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-focus
                  focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                data-role="assistant-toggle"
              >
                Assistant
              </button>
              <app-theme-toggle />
            </div>
          </div>
          <!-- ALWAYS RENDERED. The nav used to be hidden until provenance was
               declared, which meant an operator who only wanted to look at a
               balance could not even see where to look. -->
          @if (true) {
            <nav class="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm" data-role="nav">
              <!-- Today is first and ungrouped: it is not a subject, it is the
                   answer to "what now", and putting it under Record or Review
                   would make it look like one screen among several. -->
              <a routerLink="/" [routerLinkActiveOptions]="{ exact: true }"
                routerLinkActive="font-medium !text-content-primary" appTextLink data-role="nav-today">Today</a>

              <span class="ml-2 text-[10px] font-medium uppercase tracking-wide text-content-disabled"
                data-role="nav-group-record">Record</span>
              <a routerLink="/animals/new" routerLinkActive="font-medium !text-content-primary" appTextLink>Add animal</a>
              <a routerLink="/animals/calvings/new" routerLinkActive="font-medium !text-content-primary" appTextLink>Record calving</a>
              <a routerLink="/milk/milking" routerLinkActive="font-medium !text-content-primary" appTextLink>Milking</a>
              <a routerLink="/milk/dispatch" routerLinkActive="font-medium !text-content-primary" appTextLink>Dispatch</a>
              <a routerLink="/labour/payroll" routerLinkActive="font-medium !text-content-primary" appTextLink>Payroll</a>

              <span class="ml-2 text-[10px] font-medium uppercase tracking-wide text-content-disabled"
                data-role="nav-group-review">Review</span>
              <a routerLink="/animals" routerLinkActive="font-medium !text-content-primary" appTextLink>Herd</a>
              <a routerLink="/milk/buyers" routerLinkActive="font-medium !text-content-primary" appTextLink>Buyers</a>
              <a routerLink="/labour/people" routerLinkActive="font-medium !text-content-primary" appTextLink>People</a>
              <a routerLink="/check" routerLinkActive="font-medium !text-content-primary" appTextLink>Check</a>
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
        <div class="border-b border-writelog-line bg-writelog-bg px-4 py-1.5 text-center text-xs font-medium text-writelog-fg"
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
        <div class="border-b border-line-subtle bg-surface-raised" data-role="session-setup">
          <app-session-gate />
        </div>
      }

      <!-- ---------------------------------------------------------------
           THE CONTENT REGION IS NOW A POSITIONING CONTEXT. Phase 6b, §13.1.
           ---------------------------------------------------------------
           The assistant panel OVERLAYS the content rather than pushing it, so
           it needs an ancestor to be absolute against -- and that ancestor has
           to be the content region and not the viewport, or the panel would
           cover the header, the nav and the storage banner. Those are the three
           things §12.2 and §12.3 argue must be permanently visible.

           "relative flex-1" takes over the flex-item role <main> used to have,
           and "min-h-0" is here rather than on <main> for the same reason §9.2
           works out: <main> does not need it because its own "overflow-y-auto"
           zeroes its automatic minimum size, but THIS div does not scroll, so
           without it the region holds itself open at content height and the
           panel's "inset-y-0" resolves against a box taller than the viewport.
           --------------------------------------------------------------- -->
      <div class="relative flex min-h-0 flex-1 flex-col">
        <main class="flex-1 overflow-y-auto px-4 py-6">
          @if (writeOnlyRoute() && !session.ready()) {
            <app-session-gate />
          } @else {
            <router-outlet />
          }
        </main>

        <app-assistant-panel />
      </div>
    </div>
  `,
})
export class RegistryShell {
  protected readonly session = inject(Session);
  protected readonly writeLog = inject(WriteLog);
  protected readonly assistant = inject(Assistant);
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
      .subscribe(() => {
        this.writeOnlyRoute.set(this.declaresWrites());
        this.assistant.context.set(this.contextFor());
      });
    this.assistant.context.set(this.contextFor());
  }

  /**
   * §13.2's context line, in words -- and the WORDING lives here on purpose.
   *
   * The panel is a component that knows nothing about routes; the shell is the
   * only thing that has the activated route in hand. Putting the phrasing here
   * also puts it next to the nav that names the same screens, which is what
   * stops "the evening roster" and "Milking" drifting into two names for one
   * place.
   *
   * ABSENT RATHER THAN GENERIC when a route has nothing useful to say. §13.2's
   * whole claim is that the line resolves a pronoun -- "how does HER interval
   * compare" on an animal route -- and a line reading "Reading the app" resolves
   * nothing while training the eye to skip the one place that does. /chat is the
   * clearest case: the route IS the assistant.
   *
   * The URL is read rather than the route's `data`, because a serial in the path
   * is the thing worth naming and `data` would have to repeat it. `BD-0003`
   * comes straight out of the URL; the roster's session comes out of the query
   * string, which url-state.ts puts there precisely so a specific roster can be
   * named and sent to somebody.
   */
  private contextFor(): string | null {
    const url = this.router.url.split('?')[0];
    const q = this.router.url.includes('?')
      ? new URLSearchParams(this.router.url.split('?')[1])
      : new URLSearchParams();

    const animal = /^\/animals\/([^/]+)$/.exec(url);
    if (animal && animal[1] !== 'new') return animal[1];

    if (url === '/milk/milking') {
      const session = q.get('session');
      return session === 'morning' || session === 'evening'
        ? `the ${session} roster`
        : 'the milking roster';
    }
    if (url === '/milk/dispatch') return 'the dispatch sheet';
    if (url === '/animals') return 'the herd';
    if (url === '/milk/buyers') return 'the buyers';
    if (url === '/labour/people') return 'the people list';
    if (url === '/labour/payroll') return 'the payroll run';
    if (url === '/check') return 'the checks';
    // Everything else -- /, /chat, both frozen forms, the two detail routes
    // whose ids are per-run UUIDs nobody would recognise -- says nothing.
    return null;
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
