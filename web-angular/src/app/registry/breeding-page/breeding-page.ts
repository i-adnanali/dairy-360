// The Breeding page: what is due (To do), every animal with a case (Cases) and
// the eight herd figures (Herd figures), with the entry form in a panel beside the list. The Health page's shape --
// header, [appTabBar] tabs with a count, filters, .task-status pill, a panel
// that is the whole screen with Back on a phone -- not a second one.
//
// Nothing here works out a state, a day or a task: the server computes the
// board on read (GET /breeding/board), and the figures (GET /breeding/figures).
// The page filters, sorts and words them; it never counts a figure itself.

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { RegistryApi } from '../api';
import { DraftRegistry } from '../draft-registry';
import { farmToday } from '../today';
import { urlParams } from '../url-state';
import { NO_RECORD, readableParts, precisionParts } from '../precision-display';
import {
  REPRODUCTIVE_STATES,
  basisWord,
  breedingTaskLabel,
  dayRange,
  reproductionLabel,
  reproductionTone,
  serviceWord,
} from '../reproduction';
import type {
  AnimalDetail,
  BreedingBoard,
  BreedingCaseRow,
  BreedingFigures,
  BreedingTask,
  BreedingTaskKind,
  CaseOutcome,
  CheckMethod,
  FiguresPeriod,
  FiguresSpread,
  ReproductiveState,
} from '../types';
import { BreedingForm } from '../breeding-form/breeding-form';
import { Segmented, TabBar } from '../../ui/selection';
import { Button } from '../../ui/button';
import { TextInput } from '../../ui/input';
import { ErrorPanel, StatusBadge } from '../../ui/surface';
import { IdentifierLink } from '../../ui/navigation';
import { PageHeading } from '../../ui/heading';
import { FieldLabel, HelpText } from '../../ui/text';
import { Certainty, Qualifier } from '../../ui/certainty';
import { Cell } from '../../ui/cell';
import { ScrollRegion } from '../../ui/scroll-region';

type EntryKind = 'insemination' | 'heat_observed' | 'pregnancy_check' | 'null_observation';
type BoardTask = BreedingBoard['tasks'][number];

/** The task kinds, in the order the To do filter lists them. */
const KINDS: BreedingTaskKind[] = ['heat_watch', 'pregnancy_check', 'recheck', 'dry_off', 'calving_watch', 'overdue_review'];
/** A case whose story has ended: she calved, lost it, or is open again. */
const CLOSED: ReproductiveState[] = ['calved', 'lost', 'open'];
const METHOD_WORDS: Record<CheckMethod, string> = {
  palpation: 'Palpation', ultrasound: 'Ultrasound', pag: 'PAG test', progesterone: 'Progesterone test',
};
/** A case's outcome in the By animal table; `pending` is drawn italic, an open answer. */
const OUTCOME_WORDS: Record<CaseOutcome, string> = {
  held: 'Held', failed: 'Did not hold', lost: 'Lost', replaced: 'Followed by a new service', pending: 'No outcome yet',
};
/** `1 service` / `8 services`. */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** `63`, `63 and 68`, `63, 68 and 74`. */
const listed = (xs: number[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const PANEL_TITLE: Record<EntryKind, string> = {
  insemination: 'Record service',
  heat_observed: 'Record heat',
  pregnancy_check: 'Record check',
  null_observation: 'Nothing seen',
};

@Component({
  selector: 'app-breeding-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet, RouterLink, BreedingForm, Segmented, TabBar, Button, TextInput, ErrorPanel, StatusBadge,
    IdentifierLink, PageHeading, FieldLabel, HelpText, Certainty, Qualifier, Cell, ScrollRegion,
  ],
  templateUrl: './breeding-page.html',
  styleUrl: './breeding-page.css',
})
export class BreedingPage {
  private readonly api = inject(RegistryApi);
  private readonly drafts = inject(DraftRegistry);

  protected readonly board = signal<BreedingBoard | null>(null);
  protected readonly error = signal('');

  /** The view and its filters live in the address, so a link from an animal lands filtered. */
  protected readonly url = urlParams({
    tab: 'todo', animal: '', type: '', due: '', find: '', show: 'running', status: '', period: '12m',
  });
  protected readonly tab = computed(() => {
    const t = this.url.value().tab;
    return t === 'cases' || t === 'figures' ? t : 'todo';
  });
  protected readonly tabs = [
    { id: 'todo', label: 'To do' },
    { id: 'cases', label: 'Cases' },
    { id: 'figures', label: 'Herd figures' },
  ] as const;
  protected readonly kinds = KINDS;
  protected readonly showChoices = [
    { id: 'running', label: 'Still running' },
    { id: 'closed', label: 'Closed' },
    { id: 'all', label: 'All' },
  ] as const;
  /** Phone: the filters fold behind one button, as on Health. */
  protected filtersOpen = false;

  protected readonly taskLabel = breedingTaskLabel;
  protected readonly stateLabel = reproductionLabel;
  protected readonly stateTone = reproductionTone;
  protected readonly basisWord = basisWord;
  protected readonly serviceWord = serviceWord;
  protected readonly dayRange = dayRange;
  protected readonly readable = readableParts;
  protected methodWord(m: CheckMethod): string {
    return METHOD_WORDS[m];
  }

  // ---- To do ---------------------------------------------------------------
  private readonly forAnimal = computed(() => {
    const a = this.url.value().animal;
    return (this.board()?.tasks ?? []).filter((t) => !a || t.animal_id === a);
  });
  protected readonly visibleTasks = computed(() => {
    const { type, due } = this.url.value();
    return this.forAnimal().filter((t) => (!type || t.kind === type) && (!due || t.standing === due));
  });
  protected readonly overdueTasks = computed(() => this.visibleTasks().filter((t) => t.standing === 'overdue'));
  protected readonly dueTasks = computed(() => this.visibleTasks().filter((t) => t.standing === 'due'));
  protected readonly summary = computed(() => {
    const tasks = this.forAnimal();
    return {
      overdue: tasks.filter((t) => t.standing === 'overdue').length,
      due: tasks.filter((t) => t.standing === 'due').length,
    };
  });
  protected activeFilters(): number {
    const { animal, type, due } = this.url.value();
    return [animal, type, due].filter(Boolean).length;
  }

  /** The case a task belongs to: where its service's precision is read from. */
  private caseFor(animalId: string): BreedingCaseRow | undefined {
    return this.board()?.cases.find((c) => c.animal_id === animalId);
  }
  /**
   * The word naming why a day range is wide: the service's own precision
   * (`month`), or none when the width comes from a bull exposure.
   */
  protected rangeQualifier(animalId: string): string | null {
    const c = this.caseFor(animalId);
    return c ? precisionParts(c.view.service.occurred_on, c.view.service.date_precision).qualifier : null;
  }
  /** `Turns red on day 24 (17 Nov 2026)` / `Red since day 61 (2 Nov 2026)`; a recheck has none. */
  protected redClause(t: BreedingTask): string | null {
    if (t.red_from === null || t.red_on === null) return null;
    const on = readableParts(t.red_on, 'day').figure;
    return t.standing === 'overdue' ? `Red since day ${t.red_from} (${on})` : `Turns red on day ${t.red_from} (${on})`;
  }
  protected canEnter(animalId: string): boolean {
    return this.caseFor(animalId)?.entry_open === true;
  }
  protected subject(t: BoardTask): string {
    return t.animal_name ? `${t.animal_id} ${t.animal_name}` : t.animal_id;
  }

  // ---- Cases ---------------------------------------------------------------
  /** The states the Status filter offers: those on the board, in the server's order. */
  protected readonly statesOnBoard = computed(() => {
    const seen = new Set((this.board()?.cases ?? []).map((c) => c.view.state));
    return REPRODUCTIVE_STATES.filter((s) => seen.has(s));
  });
  protected readonly visibleCases = computed(() => {
    const { find, show, status } = this.url.value();
    const words = find.trim().toLocaleLowerCase();
    const rank = (c: BreedingCaseRow) =>
      c.tasks.some((t) => t.standing === 'overdue') ? 0 : c.tasks.some((t) => t.standing === 'due') ? 1 : 2;
    return (this.board()?.cases ?? [])
      .filter((c) => show === 'all' || (show === 'closed') === CLOSED.includes(c.view.state))
      .filter((c) => !status || c.view.state === status)
      .filter((c) => !words || (c.animal_id + ' ' + (c.animal_name ?? '')).toLocaleLowerCase().includes(words))
      .sort((a, b) => rank(a) - rank(b) || b.view.day_max - a.view.day_max);
  });

  // ---- Herd figures --------------------------------------------------------
  protected readonly figures = signal<BreedingFigures | null>(null);
  protected readonly period = computed<FiguresPeriod>(() => (this.url.value().period === 'all' ? 'all' : '12m'));
  protected readonly periods = [
    { id: '12m', label: 'Last 12 months' },
    { id: 'all', label: 'All on record' },
  ] as const;
  protected readonly noRecord = NO_RECORD;
  protected outcomeWord(o: CaseOutcome): string {
    return OUTCOME_WORDS[o];
  }
  /** `14 Nov 2025 to 13 Nov 2026 · 11 animals with a service in this period`. */
  protected rangeLine(f: BreedingFigures): string {
    const animals = plural(f.animals, 'animal', 'animals');
    if (f.from === null) return `All on record · ${animals} with a service`;
    return `${readableParts(f.from, 'day').figure} to ${readableParts(f.on, 'day').figure} · ${animals} with a service in this period`;
  }
  protected overdueNote(f: BreedingFigures): string {
    const who = f.overdue_now.animals.map((a) => `${a.animal_name ? `${a.animal_id} ${a.animal_name}` : a.animal_id}, day ${a.day_max}`);
    return [who.length ? who.join('; ') + '.' : '', 'Follows straight from the calving window.'].filter(Boolean).join(' ');
  }
  protected servicesNote(f: BreedingFigures): string {
    const { services, conceptions } = f.services_per_conception;
    const counts = services > 0 || conceptions > 0
      ? `${plural(services, 'service', 'services')} for ${plural(conceptions, 'confirmed pregnancy', 'confirmed pregnancies')}. `
      : '';
    return counts + 'Counts only services that were written down.';
  }
  protected heldNote(f: BreedingFigures): string {
    const h = f.held_to_first_service;
    const lead = h.rate !== null ? `${h.rate}% of first services with a known outcome.` : 'First services with a known outcome.';
    if (h.pending === 0) return lead;
    // "more" only when some first services do have an outcome.
    return `${lead} ${h.pending}${h.of > 0 ? ' more' : ''} ${h.pending === 1 ? 'has' : 'have'} no outcome yet.`;
  }
  protected confirmedNote(f: BreedingFigures): string {
    const later = f.confirmed_by_day_60.later_days;
    if (f.confirmed_by_day_60.of === 0 || later.length === 0) return 'Day 60 is your own yardstick.';
    const which = later.length === 1 ? `The other 1 was confirmed later, on day ${later[0]}.` : `The other ${later.length} were confirmed later, on days ${listed(later)}.`;
    return `${which} Day 60 is your own yardstick.`;
  }
  /** `Shortest 67, longest 148.` after the figure's own words; none when nothing was counted. */
  protected spreadNote(s: FiguresSpread, words: string): string {
    return s.n > 0 && s.min !== null && s.max !== null ? `${words} Shortest ${s.min}, longest ${s.max}.` : words;
  }
  protected setPeriod(id: FiguresPeriod): void {
    void this.url.set({ period: id === '12m' ? '' : id });
  }

  // ---- The panel -----------------------------------------------------------
  protected readonly panelKind = signal<EntryKind | null>(null);
  protected readonly entryAnimal = signal('');
  /** One form per animal and kind: a different button or animal mounts a fresh one. */
  protected readonly formKey = computed(() => {
    const k = this.panelKind(), a = this.entryAnimal();
    return k && a ? [{ key: a + '|' + k, animal: a, kind: k }] : [];
  });
  protected readonly entryCases = computed(() => (this.board()?.cases ?? []).filter((c) => c.entry_open));
  protected panelTitle(): string {
    const k = this.panelKind();
    return k ? PANEL_TITLE[k] : '';
  }
  private origin: HTMLElement | null = null;

  protected async open(kind: EntryKind, animalId = ''): Promise<void> {
    if (!(await this.canDiscard())) return;
    this.origin = document.activeElement as HTMLElement | null;
    this.panelKind.set(kind);
    this.entryAnimal.set(animalId || this.defaultAnimal());
    setTimeout(() => document.getElementById('breeding-panel-title')?.focus());
  }
  protected async chooseAnimal(id: string, select: HTMLSelectElement): Promise<void> {
    if (id === this.entryAnimal()) return;
    if (!(await this.canDiscard())) {
      select.value = this.entryAnimal();
      return;
    }
    this.entryAnimal.set(id);
  }
  protected async closePanel(): Promise<void> {
    if (!(await this.canDiscard())) return;
    this.panelKind.set(null);
    this.entryAnimal.set('');
    const origin = this.origin;
    setTimeout(() => {
      if (origin?.isConnected) origin.focus();
    });
  }
  /** The animal the page is filtered to, when the page may enter for her. */
  private defaultAnimal(): string {
    const a = this.url.value().animal;
    return a && this.canEnter(a) ? a : '';
  }
  private async canDiscard(): Promise<boolean> {
    return !this.drafts.hasChanges() || (await this.drafts.request());
  }
  /** After a save the board is read again: the event may have closed or opened a task. */
  protected readonly onSaved = (_: AnimalDetail): void => {
    void this.load();
  };

  // ---- Tabs and filters ----------------------------------------------------
  protected setTab(id: 'todo' | 'cases' | 'figures'): void {
    void this.url.set({ tab: id === 'todo' ? '' : id });
  }
  protected set(key: 'animal' | 'type' | 'due' | 'find' | 'status', value: string): void {
    void this.url.set({ [key]: value });
  }
  protected setShow(id: string): void {
    void this.url.set({ show: id === 'running' ? '' : id });
  }

  private sequence = 0;
  private figuresSequence = 0;
  constructor() {
    inject(DestroyRef).onDestroy(() => {
      ++this.sequence;
      ++this.figuresSequence;
    });
    void this.loadBoard();
    // The figures are read only when their tab is open, and again for the other period.
    effect(() => {
      const period = this.period();
      // Another period's numbers never sit under the newly chosen segment.
      if (untracked(this.figures)?.period !== period) this.figures.set(null);
      if (this.tab() === 'figures') void this.loadFigures(period);
    });
  }
  /** Reload (and after a save): the board, and the figures when their tab is open. */
  protected async load(): Promise<void> {
    await this.loadBoard();
    if (this.tab() === 'figures') await this.loadFigures(this.period());
  }
  private async loadBoard(): Promise<void> {
    const n = ++this.sequence;
    this.error.set('');
    try {
      const b = await this.api.breedingBoard(farmToday());
      if (n === this.sequence) this.board.set(b);
    } catch (e) {
      if (n === this.sequence) this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
  private async loadFigures(period: FiguresPeriod): Promise<void> {
    const n = ++this.figuresSequence;
    this.error.set('');
    try {
      const f = await this.api.breedingFigures(period);
      if (n === this.figuresSequence) this.figures.set(f);
    } catch (e) {
      if (n === this.figuresSequence) this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
