// One animal's record: identity, derived status, event list, and the two forms
// that act on it.

import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { RegistryApi } from './api';
import { lifeStageLabel } from './life-stage';
import { EventList } from './event-list';
import { EventForm } from './event-form';
import { CorrectionForm } from './correction-form';
import type { AnimalDetail as Detail } from './types';

type Tab = 'events' | 'add-event' | 'correct';

@Component({
  selector: 'app-animal-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EventList, EventForm, CorrectionForm],
  template: `
    @if (loadError(); as e) {
      <p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" data-role="load-error">{{ e }}</p>
    } @else if (detail(); as d) {
      <div class="mx-auto max-w-3xl space-y-5">
        <header class="rounded-xl border border-farm-300 bg-white p-4">
          <div class="flex flex-wrap items-baseline gap-x-3">
            <h2 class="font-mono text-xl font-semibold text-farm-900" data-role="serial">{{ d.animal.id }}</h2>
            @if (d.animal.name) { <span class="text-lg text-farm-800">{{ d.animal.name }}</span> }
            <!-- The farm's word, with the stored enum on hover. 'majj' says in
                 one word what "cow" is vague about: she has calved. -->
            <span class="rounded-full bg-farm-200 px-2 py-0.5 text-xs font-medium text-farm-800"
              data-role="status"
              [title]="d.status ? 'stored as ' + d.status.status : ''"
            >{{ stage(d) }}</span>
          </div>
          <dl class="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div class="flex gap-2"><dt class="text-farm-600">Sex</dt><dd class="text-farm-900">{{ d.animal.sex }}</dd></div>
            <div class="flex gap-2"><dt class="text-farm-600">Origin</dt><dd class="text-farm-900">{{ d.animal.origin }}</dd></div>
            <div class="flex gap-2">
              <dt class="text-farm-600">Born</dt>
              <dd class="text-farm-900" data-role="birth">
                {{ d.status?.birth_on ? d.status?.birth_on + ' (' + d.status?.birth_precision + ')' : 'unknown' }}
              </dd>
            </div>
            <div class="flex gap-2"><dt class="text-farm-600">Parity</dt><dd class="text-farm-900">{{ d.status?.parity ?? '—' }}</dd></div>
            @if (d.animal.post_no) {
              <div class="flex gap-2"><dt class="text-farm-600">Post</dt><dd class="text-farm-900">{{ d.animal.post_no }}</dd></div>
            }
            @if (d.animal.tag_no) {
              <div class="flex gap-2"><dt class="text-farm-600">Tag</dt><dd class="text-farm-900">{{ d.animal.tag_no }}</dd></div>
            }
          </dl>
        </header>

        <nav class="flex gap-2 border-b border-farm-200">
          @for (t of tabs; track t.id) {
            <button type="button" [attr.data-tab]="t.id" (click)="tab.set(t.id)"
              class="-mb-px border-b-2 px-3 py-2 text-sm"
              [class]="tab() === t.id ? 'border-farm-600 font-medium text-farm-900' : 'border-transparent text-farm-600'"
            >{{ t.label }}</button>
          }
        </nav>

        @switch (tab()) {
          @case ('events') { <app-event-list [events]="d.events" /> }
          @case ('add-event') {
            <app-event-form [animalId]="d.animal.id" [saved]="onSaved" />
          }
          @case ('correct') {
            <app-correction-form [events]="d.events" [done]="onCorrected" />
            <div class="mt-5">
              <h3 class="mb-2 text-sm font-medium text-farm-800">
                The record as it stands — check the correction reads the way you meant
              </h3>
              <app-event-list [events]="d.events" />
            </div>
          }
        }
      </div>
    } @else {
      <p class="text-sm text-farm-600" data-role="loading">Loading…</p>
    }
  `,
})
export class AnimalDetailView {
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
    // Reload whenever the route id changes, so navigating between animals does
    // not leave a stale record on screen -- which, in a view whose whole job is
    // letting you check what you just wrote, would be the worst kind of bug.
    effect(() => {
      const id = this.id();
      this.detail.set(null);
      void this.load(id);
    });
  }

  private async load(id: string): Promise<void> {
    try {
      this.detail.set(await this.api.animal(id));
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  private async reload(): Promise<void> {
    await this.load(this.id());
  }
}
