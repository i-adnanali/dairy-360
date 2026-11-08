import { subjectTitle } from '../page-title';
import { DestroyRef } from '@angular/core';
import { DraftRegistry } from "../draft-registry";
import { RouterLink } from '@angular/router';
import { Button } from "../../ui/button";
// One animal's record: identity, derived status, event list, and the two forms
// that act on it.

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import type { HealthBoard } from "../health-workflows";
import type { HerdRow } from "../types";
import { farmMoment, farmToday } from "../today";
import { readableParts } from "../precision-display";
import { RegistryApi } from "../api";
import { lifeStageLabel } from "../life-stage";
import { EventList } from "../event-list/event-list";
import { EventForm } from "../event-form/event-form";
import { CorrectionForm } from "../correction-form/correction-form";
import type { AnimalDetail as Detail } from "../types";
import { Certainty, Qualifier } from "../../ui/certainty";
import { NO_RECORD } from "../precision-display";
import type { PrecisionParts } from "../precision-display";
import { ErrorPanel } from "../../ui/surface";
import { HelpText, TextLink } from "../../ui/text";
import { StatusBadge } from "../../ui/surface";

type Tab = 'events' | 'add-event' | 'correct';

@Component({
  selector: 'app-animal-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Button,
    Certainty,
    CorrectionForm,
    ErrorPanel,
    EventForm,
    EventList,
    HelpText,
    Qualifier,
    StatusBadge,
    TextLink,
  ],
  templateUrl: './animal-detail.html',
  styleUrl: './animal-detail.css',
})
export class AnimalDetailView {
  private readonly drafts = inject(DraftRegistry);
  protected async selectTab(tab: Tab) {
    if (tab === this.tab()) return;
    if (!this.drafts.hasChanges() || (await this.drafts.request())) this.tab.set(tab);
  }

  /** §6's no-record glyph, for the template. An en dash. */
  protected readonly noRecord = NO_RECORD;

  /** The birth date at the precision it was known to. See precision-display.ts. */
  protected born(d: Detail): PrecisionParts {
    return readableParts(d.status?.birth_on ?? null, d.status?.birth_precision ?? null);
  }

  protected origin(d: Detail): string {
    const o = d.animal.origin as string;
    return o === 'born_on_farm' ? 'Born here' : o === 'acquired' ? 'Bought in' : o;
  }

  /** Newest first, effective only: the summary's "last calving". */
  protected lastCalving(d: Detail): PrecisionParts | null {
    const c = [...d.events]
      .filter((e) => e.type === 'calving' && e.effective)
      .sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1))[0];
    return c ? readableParts(c.occurred_on, c.date_precision) : null;
  }

  /**
   * What is open for THIS animal from the health board: due/overdue tasks and
   * milk withdrawals. Optional -- a failed health read leaves the summary
   * without it rather than saying "nothing due".
   */
  protected readonly health = signal<HealthBoard | null>(null);
  protected readonly openTasks = computed(() =>
    (this.health()?.tasks ?? []).filter(
      (t) => t.animal_id === this.id() && (t.standing === 'overdue' || t.standing === 'due'),
    ),
  );
  protected readonly milkWithdrawals = computed(() =>
    (this.health()?.withdrawals ?? []).filter((w) => w.animal_id === this.id() && w.target === 'milk'),
  );
  protected withdrawalWhen(until?: string): string {
    return until ? 'until ' + farmMoment(until) : 'end unknown';
  }

  /** Previous / next animal on the farm, in ID order. */
  private readonly herdIds = signal<string[]>([]);
  protected readonly neighbours = computed(() => {
    const ids = this.herdIds(), i = ids.indexOf(this.id());
    return i < 0 ? { prev: null, next: null } : { prev: ids[i - 1] ?? null, next: ids[i + 1] ?? null };
  });

  /** The farm's word for this animal's stage. Stored enum unchanged. */
  protected stage(d: Detail): string {
    return d.status === null ? 'no projection' : lifeStageLabel(d.status.status, d.animal.sex);
  }

  /** The route parameter, bound by withComponentInputBinding(). */
  readonly id = input.required<string>();

  private readonly api = inject(RegistryApi);

  protected readonly detail = signal<Detail | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly tab = signal<Tab>('events');
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'events', label: 'Timeline' },
    { id: 'add-event', label: 'Add an event' },
    { id: 'correct', label: 'Correct a calving' },
  ];

  /** Bound as an input rather than an output, so a child can hand back a fresh
   * detail without this component re-fetching on a signal it cannot see. */
  protected readonly onSaved = (d: Detail): void => {
    this.detail.set(d);
    this.tab.set('events');
  };

  protected readonly onCorrected = (): void => {
    void this.reload();
  };

  constructor() {
    subjectTitle(() => { const a = this.detail()?.animal; return a ? (a.name ? a.id + ' ' + a.name : a.id) : null; });
    inject(DestroyRef).onDestroy(() => ++this.loadSequence);
    // Reload whenever the route id changes, so navigating between animals does
    // not leave a stale record on screen -- which, in a view whose whole job is
    // letting you check what you just wrote, would be the worst kind of bug.
    effect(() => {
      const id = this.id();
      this.detail.set(null);
      void this.load(id);
    });
    // Both optional extras: the page works without them.
    void Promise.resolve()
      .then(() => this.api.list<HerdRow>('animals', { group: 'current', pageSize: '100', sort: 'identifier', direction: 'asc' }))
      .then((r) => this.herdIds.set(r.items.map((a) => a.id)), () => undefined);
    void Promise.resolve()
      .then(() => this.api.healthGet<HealthBoard>('health/board?on=' + farmToday()))
      .then((b) => this.health.set(b), () => undefined);
  }

  private loadSequence = 0;
  private async load(id: string): Promise<void> {
    const sequence = ++this.loadSequence;
    this.loadError.set(null);
    try {
      const detail = await this.api.animal(id);
      if (sequence !== this.loadSequence || id !== this.id()) return;
      this.detail.set(detail);
      this.loadError.set(null);
    } catch (e) {
      if (sequence !== this.loadSequence || id !== this.id()) return;
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  private async reload(): Promise<void> {
    await this.load(this.id());
  }
}
