// The registry area: session gate, nav, and the routed view.

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
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
import { CommandPalette } from './command-palette';
import { SECTIONS, sectionFor, ShellActions } from './navigation';
import { Button } from '../ui/button';
import { Shortcuts } from '../core/shortcuts';
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
    AssistantPanel,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    SessionBar,
    SessionGate,
    TextLink,
    ThemeToggle,
    Button,
    CommandPalette,
  ],
  template: `
    <div class="flex h-full flex-col bg-surface-page text-content-primary">
      <header class="border-b border-line-subtle bg-surface-raised px-4">
        <div class="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 py-3">
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="text-base font-semibold tracking-tight">Dairy 360</h1>
            <app-session-bar mode="storage" />
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <app-session-bar mode="session" />
            <button type="button" appTextLink (click)="palette.show()" data-role="search-toggle">
              Search <kbd>{{ palette.chordLabel }}</kbd>
            </button>
            <app-theme-toggle />
            <button
              type="button"
              appTextLink
              (click)="assistant.toggle()"
              [attr.aria-expanded]="assistant.open()"
              aria-controls="assistant-panel"
              data-role="assistant-toggle"
            >
              Assistant
            </button>
          </div>
        </div>
        <nav
          class="phase7-nav mx-auto flex max-w-[1400px] gap-5 overflow-x-auto text-sm"
          data-role="nav"
          aria-label="Sections"
        >
          @for (section of sections; track section.label) {
            <a
              [routerLink]="section.path"
              [class.ml-auto]="section.label === 'Check'"
              [class.active]="activeSection().label === section.label"
              [attr.aria-current]="activeSection().label === section.label ? 'page' : null"
              [attr.data-role]="section.label === 'Today' ? 'nav-today' : null"
              >{{ section.label }}</a
            >
          }
        </nav>
      </header>
      <div class="border-b border-line-subtle bg-surface-sunken px-4" data-role="section-bar">
        <div
          class="mx-auto flex min-h-12 max-w-[1400px] flex-wrap items-center justify-between gap-3 py-2"
        >
          <nav class="flex flex-wrap gap-4 text-sm" aria-label="Section views">
            @for (view of activeSection().views; track view.path) {
              <a
                [routerLink]="view.path"
                routerLinkActive="font-medium !text-content-primary"
                [routerLinkActiveOptions]="{ exact: true }"
                appTextLink
                >{{ view.label }}</a
              >
            }
          </nav>
          <div class="flex flex-wrap gap-3">
            @if (activeSection().label === 'Check') {
              <button
                type="button"
                appButton
                variant="secondary"
                (click)="actions.refresh()"
                data-role="section-recheck"
              >
                Recheck
              </button>
            } @else if (!session.ready() || activeSection().label === 'Today') {
              <button
                type="button"
                appButton
                variant="secondary"
                (click)="session.requestSetup()"
                data-role="section-start-session"
              >
                {{ session.ready() ? 'Change recording session' : 'Start a recording session' }}
              </button>
            } @else {
              @for (action of activeSection().actions; track action.path) {
                <a
                  [routerLink]="action.path"
                  [fragment]="action.fragment"
                  (click)="focusAction(action.fragment)"
                  appButton
                  [variant]="action.primary ? 'primary' : 'secondary'"
                  >{{ action.label }}</a
                >
              }
            }
          </div>
        </div>
      </div>
      <app-command-palette #palette />

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
        <div
          class="border-b border-writelog-line bg-writelog-bg px-4 py-1.5 text-center text-xs font-medium text-writelog-fg"
          data-role="write-log"
        >
          {{ msg }}
        </div>
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
      @if (session.setupOpen() && (session.ready() || !writeOnlyRoute())) {
        <div
          class="max-h-[70vh] overflow-y-auto border-b border-line-subtle bg-surface-raised"
          data-role="session-setup"
        >
          <button type="button" class="m-3 text-sm underline" (click)="session.dismissSetup()">
            Cancel session setup
          </button>
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
        <main
          class="phase7-content flex-1 overflow-y-auto px-4 py-6"
          [class.phase7-form]="writeOnlyRoute() || feedFormRoute()"
        >
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
  private readonly injector = inject(Injector);
  private readonly route = inject(ActivatedRoute);

  protected readonly sections = SECTIONS;
  protected readonly actions = inject(ShellActions);
  private readonly url = signal(this.router.url);
  protected readonly activeSection = computed(() => sectionFor(this.url()));

  /**
   * True when the active route is nothing but a form.
   *
   * Read from the ROUTE rather than from a list of paths in here: a path list
   * beside the route table is a second copy, and the enumeration deleted from
   * routes.ts went stale three times before anyone removed it.
   */
  protected readonly feedFormRoute = computed(() => /^\/feed\/(daily\/[^/]+|crops\/new|purchases\/new)$/.test(this.url().split(/[?#]/)[0]));
  protected readonly writeOnlyRoute = signal(this.declaresWrites());

  constructor() {
    this.actions.inShell.set(true);
    effect(() => {
      if (this.session.ready() && this.writeOnlyRoute()) {
        afterNextRender(
          () => {
            document.querySelector('main')?.scrollTo({ top: 0 });
          },
          { injector: this.injector },
        );
      }
    });
    inject(DestroyRef).onDestroy(() => this.actions.inShell.set(false));
    const undo = inject(Shortcuts).register('mod+enter', 'RegistryShell', (e) => {
      if (document.querySelector('[data-role="command-dialog"]')) return;
      const focused = e.target as HTMLElement | null;
      const form = focused?.closest('form');
      if (form && form.closest('main, [data-role="session-setup"]')) form.requestSubmit();
    });
    inject(DestroyRef).onDestroy(undo);
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.url.set(this.router.url);
        afterNextRender(
          () => {
            if (this.router.url.endsWith('#add-person')) {
              this.focusAction('add-person');
            } else {
              document.querySelector('main')?.scrollTo({ top: 0 });
            }
          },
          { injector: this.injector },
        );
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
  protected focusAction(fragment?: string): void {
    if (!fragment) return;
    const form = document.getElementById(fragment);
    form?.scrollIntoView({ block: 'start' });
    (form?.querySelector('input') as HTMLElement | null)?.focus();
  }

  private contextFor(): string | null {
    const url = this.router.url.split('?')[0];
    const q = this.router.url.includes('?')
      ? new URLSearchParams(this.router.url.split('?')[1])
      : new URLSearchParams();

    const animal = /^\/animals\/([^/]+)$/.exec(url);
    if (animal && !['new', 'calvings'].includes(animal[1])) return animal[1];

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
