import { DestroyRef } from '@angular/core';
import { DraftRegistry } from "../draft-registry";
import { RouterLink } from '@angular/router';
import { Button } from "../../ui/button";
// One animal's record: identity, derived status, event list, and the two forms
// that act on it.

import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { RegistryApi } from "../api";
import { lifeStageLabel } from "../life-stage";
import { EventList } from "../event-list/event-list";
import { EventForm } from "../event-form/event-form";
import { CorrectionForm } from "../correction-form/correction-form";
import type { AnimalDetail as Detail } from "../types";
import { Certainty, Qualifier } from "../../ui/certainty";
import { NO_RECORD, precisionParts } from "../precision-display";
import type { PrecisionParts } from "../precision-display";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { HelpText } from "../../ui/text";
import { StatusBadge } from "../../ui/surface";

type Tab = 'events' | 'add-event' | 'correct';

@Component({
  selector: 'app-animal-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Button,
    Card,
    Certainty,
    CorrectionForm,
    ErrorPanel,
    EventForm,
    EventList,
    HelpText,
    Qualifier,
    StatusBadge,
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
    return precisionParts(d.status?.birth_on ?? null, d.status?.birth_precision ?? null);
  }

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
    { id: 'events', label: 'Record' },
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
    inject(DestroyRef).onDestroy(() => ++this.loadSequence);
    // Reload whenever the route id changes, so navigating between animals does
    // not leave a stale record on screen -- which, in a view whose whole job is
    // letting you check what you just wrote, would be the worst kind of bug.
    effect(() => {
      const id = this.id();
      this.detail.set(null);
      void this.load(id);
    });
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
