// Phase 7: one searchable index of existing navigation and records. Loaded on
// demand, never an eager request on every route. Partial failures are visible.
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { Router } from '@angular/router';
import { RegistryApi } from './api';
import { Session } from './session';
import { SECTIONS, ShellActions } from './navigation';
import { Shortcuts } from '../core/shortcuts';
import { TextInput } from '../ui/input';

export interface Command {
  id: string;
  label: string;
  detail: string;
  url: string;
  writes?: boolean;
  action?: 'setup' | 'recheck';
}
@Component({
  selector: 'app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, TextInput],
  template: `
    @if (open()) {
      <div
        class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[10vh]"
        (click)="backdrop($event)"
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Search and navigate"
          data-role="command-dialog"
          cdkTrapFocus
          [cdkTrapFocusAutoCapture]="true"
          (keydown.escape)="close(); $event.stopPropagation()"
          class="w-full max-w-xl rounded-xl border border-line-strong bg-surface-raised p-4 text-content-primary shadow-xl"
        >
          <div class="mb-3 flex items-center justify-between">
            <h2 class="font-semibold">Search and navigate</h2>
            <button type="button" (click)="close()" class="rounded px-2 py-1 text-sm">
              Close <kbd>Esc</kbd>
            </button>
          </div>
          <input
            appInput
            cdkFocusInitial
            class="w-full"
            placeholder="Animal, person, destination or page"
            aria-label="Search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-results"
            [attr.aria-activedescendant]="results()[index()] ? 'command-' + index() : null"
            [value]="query()"
            (input)="search($any($event.target).value)"
            (keydown)="onKey($event)"
          />
          @if (loading()) {
            <p role="status" class="mt-2 text-xs text-content-muted">Loading records…</p>
          }
          @if (error()) {
            <p role="status" class="mt-2 text-xs text-content-muted">
              {{ error() }} Close and reopen to retry.
            </p>
          }
          <ul
            id="command-results"
            role="listbox"
            aria-label="Results"
            class="mt-3 max-h-[55vh] overflow-y-auto"
          >
            @for (item of results(); track item.id; let i = $index) {
              <li
                role="option"
                [id]="'command-' + i"
                [attr.aria-selected]="index() === i"
                [attr.aria-disabled]="blocked(item)"
                (click)="choose(item)"
                (mousemove)="index.set(i)"
                [class.bg-surface-sunken]="index() === i"
                class="cursor-pointer rounded px-3 py-2 text-sm"
              >
                <span class="block font-medium">{{ item.label }}</span>
                <span class="text-xs text-content-muted">{{
                  blocked(item) ? 'Start a recording session first' : item.detail
                }}</span>
              </li>
            } @empty {
              <li class="px-3 py-4 text-sm text-content-muted">No matches.</li>
            }
          </ul>
          <p class="mt-3 text-xs text-content-muted">
            ↑ ↓ to choose · Enter to open · {{ chordLabel }} to search
          </p>
        </section>
      </div>
    }
  `,
})
export class CommandPalette {
  readonly open = signal(false);
  readonly query = signal('');
  readonly index = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly records = signal<Command[]>([]);
  readonly chordLabel = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? '⌘K'
    : 'Ctrl+K';
  private readonly api = inject(RegistryApi);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  private readonly actions = inject(ShellActions);
  private generation = 0;
  readonly pages: Command[] = [
    {
      id: 'session-setup',
      label: 'Start a recording session',
      detail: 'Declare source and recorder',
      url: '/',
      action: 'setup',
    },
    {
      id: 'recheck',
      label: 'Recheck',
      detail: 'Check the records again',
      url: '/check',
      action: 'recheck',
    },
    ...new Map(
      SECTIONS.flatMap((s) => [
        { id: s.path, label: s.label, detail: 'Section', url: s.path },
        ...s.views.map((v) => ({ id: v.path, label: v.label, detail: s.label, url: v.path })),
        ...s.actions.map((a) => ({
          id: a.path + (a.fragment ?? ''),
          label: a.label,
          detail: s.label,
          url: a.path + (a.fragment ? '#' + a.fragment : ''),
          writes: true,
        })),
      ]).map((c) => [c.id, c]),
    ).values(),
  ];
  readonly results = computed(() => {
    const words = this.query().trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return [...this.pages, ...this.records()]
      .filter((c) => words.every((w) => (c.label + ' ' + c.detail).toLocaleLowerCase().includes(w)))
      .slice(0, 50);
  });
  constructor() {
    const undo = inject(Shortcuts).register('mod+k', 'CommandPalette', () =>
      this.open() ? this.close() : this.show(),
    );
    inject(DestroyRef).onDestroy(() => {
      undo();
      this.generation++;
    });
  }
  async show(): Promise<void> {
    this.query.set('');
    this.index.set(0);
    this.records.set([]);
    this.error.set(null);
    this.open.set(true);
    this.loading.set(true);
    const generation = ++this.generation;
    const results = await Promise.allSettled([
      this.api
        .herd()
        .then((rows) =>
          rows.map((r) => ({
            id: 'animal-' + r.id,
            label: r.id + (r.name ? ' · ' + r.name : ''),
            detail: 'Animal',
            url: '/animals/' + encodeURIComponent(r.id),
          })),
        ),
      this.api
        .people()
        .then((rows) =>
          rows.map((r) => ({
            id: 'person-' + r.person_id,
            label: r.name ? r.name + ' · ' + r.identifier : r.identifier,
            detail: 'Person',
            url: '/labour/people/' + encodeURIComponent(r.person_id),
          })),
        ),
      this.api
        .destinations()
        .then((rows) =>
          rows.map((r) => ({
            id: 'destination-' + r.id,
            label: r.name,
            detail: 'Destination',
            url: '/milk/buyers/' + encodeURIComponent(r.id),
          })),
        ),
    ]);
    if (generation !== this.generation) return;
    this.records.set(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])));
    const failed = results.flatMap((r, i) =>
      r.status === 'rejected' ? [['Animals', 'People', 'Destinations'][i]] : [],
    );
    if (failed.length) this.error.set('Could not load: ' + failed.join(', ') + '.');
    this.loading.set(false);
  }
  close(): void {
    this.open.set(false);
    this.generation++;
  }
  blocked(item: Command): boolean {
    return !!item.writes && !this.session.ready();
  }
  search(value: string): void {
    this.query.set(value);
    this.index.set(0);
  }
  choose(item: Command): void {
    if (this.blocked(item)) return;
    this.close();
    if (item.action === 'setup') {
      this.session.requestSetup();
      return;
    }
    if (item.action === 'recheck' && this.router.url.split('?')[0] === '/check') {
      this.actions.refresh();
      return;
    }
    void this.router.navigateByUrl(item.url);
  }
  backdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.close();
  }
  onKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.results().length;
      this.index.set(n ? (this.index() + (e.key === 'ArrowDown' ? 1 : -1) + n) % n : 0);
      document.getElementById('command-' + this.index())?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = this.results()[this.index()];
      if (item) this.choose(item);
    }
  }
}
