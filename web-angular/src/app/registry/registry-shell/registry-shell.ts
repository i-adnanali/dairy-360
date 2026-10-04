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
import { CommandPalette } from "../command-palette/command-palette";
import { SECTIONS, sectionFor, ShellActions } from "../navigation";
import { Button } from "../../ui/button";
import { Shortcuts } from "../../core/shortcuts";
import { WriteLog } from "../after-write";
import { Assistant } from "../../core/assistant";
import { AssistantPanel } from "../../components/assistant-panel/assistant-panel";
import { Session } from "../session";
import { SessionBar } from "../session-bar/session-bar";
import { SessionGate } from "../session-gate/session-gate";
import { ThemeToggle } from "../../ui/theme-toggle/theme-toggle";
import { TextLink } from "../../ui/text";

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
  templateUrl: './registry-shell.html',
  styleUrl: './registry-shell.css',
})
export class RegistryShell {
  protected readonly menuOpen = signal(false);
  protected closeMenu(event: Event) {
    event.preventDefault();
    this.menuOpen.set(false);
    document.querySelector<HTMLElement>('.mobile-menu-toggle')?.focus();
  }
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
    inject(DestroyRef).onDestroy(() => {
      this.actions.inShell.set(false);
      this.headingObserver?.disconnect();
    });
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
              this.focusPageHeading();
            }
          },
          { injector: this.injector },
        );
        this.writeOnlyRoute.set(this.declaresWrites());
        this.menuOpen.set(false);
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
   * This is a UI location label, not model context. Animal identity comes
   * from the matched parameterized route so literal feature routes cannot be
   * mistaken for animal IDs. Questions must include their own record identity.
   */
  private headingObserver?: MutationObserver;
  private focusPageHeading(): void {
    this.headingObserver?.disconnect();
    if (this.assistant.modal()) return;
    const main = document.querySelector('main');
    if (!main) return;
    const focus = () => {
      const heading = main.querySelector<HTMLElement>('h1, h2');
      if (!heading) return false;
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      this.headingObserver?.disconnect();
      return true;
    };
    if (!focus()) {
      this.headingObserver = new MutationObserver(() => focus());
      this.headingObserver.observe(main, { childList: true, subtree: true });
    }
  }

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

    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    if (route.routeConfig?.path === 'animals/:id') return route.paramMap.get('id');
    if (url === '/animals/health') return 'animal health';

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
