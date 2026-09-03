// The verification read: invariants, precision histogram, calving intervals.
//
// ---------------------------------------------------------------------------
// READ-ONLY, AND NOTHING BRANCHES ON IT
// ---------------------------------------------------------------------------
// Two conditions this view is built under, both deliberate:
//
//   1. NO VIEW BRANCHES ON IT. No other component reads this data, nothing is
//      hidden or enabled by it, no form consults it before submitting. It is a
//      window, not a gate -- the moment something depends on it, it stops being
//      a diagnostic and becomes load-bearing, and then a wrong number here
//      breaks entry instead of informing it.
//
//   2. VISIBLY DIAGNOSTIC, NOT DECORATIVE. Numbers to read, not a badge that
//      turns green. A green tick invites you to glance at the colour and stop
//      looking, which is how a check you do not read becomes a check that is
//      not a check. So: counts, a histogram you have to interpret, and
//      violations printed in full with their invariant numbers.
//
// It exists because the alternative was switching to a terminal mid-entry to
// read the histogram, which nobody keeps doing past animal five.

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RegistryApi } from './api';
import type { Verification } from './types';

@Component({
  selector: 'app-verification-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl space-y-5">
      <header>
        <h2 class="text-lg font-semibold text-farm-900">Check the records</h2>
        <p class="mt-1 text-sm text-farm-600">
          Read these; they are not assertions. Nothing in the rest of the app changes based on
          what is here.
        </p>
      </header>

      @if (loadError(); as e) {
        <p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" data-role="load-error">{{ e }}</p>
      } @else if (v(); as data) {
        <section class="rounded-xl border border-farm-300 bg-white p-4">
          <h3 class="text-sm font-medium text-farm-800">Invariants</h3>
          @if (data.violations.length === 0) {
            <p class="mt-2 text-sm text-farm-700" data-role="violations-none">
              No violations across {{ data.counts.animals }} animal(s),
              {{ data.counts.events }} event(s), {{ data.counts.lactations }} lactation(s),
              as of {{ data.as_of }}.
              @if (data.counts.animals === 0) {
                <span class="italic"> An empty registry passes every check vacuously — this says
                nothing yet.</span>
              }
            </p>
          } @else {
            <ul class="mt-2 space-y-1" data-role="violations">
              @for (x of data.violations; track x.detail) {
                <li class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
                  <span class="font-mono text-xs">[{{ x.invariant }}] {{ x.name }}</span>
                  <span class="ml-2">{{ x.detail }}</span>
                </li>
              }
            </ul>
          }
        </section>

        <section class="rounded-xl border border-farm-300 bg-white p-4">
          <h3 class="text-sm font-medium text-farm-800">How the dates were known</h3>
          <p class="mt-1 text-xs text-farm-600">
            Source against precision. Nothing can detect a date that is more precise than the
            memory behind it — this is the number that shows it. A backfill coming out mostly
            exact-day recall is the signal worth acting on.
          </p>
          @if (data.histogram.length === 0) {
            <p class="mt-2 text-sm italic text-farm-500" data-role="histogram-empty">No events yet.</p>
          } @else {
            <table class="mt-2 w-full text-left text-sm" data-role="histogram">
              <thead class="text-xs uppercase tracking-wide text-farm-600">
                <tr><th class="py-1">Source</th><th class="py-1">Precision</th><th class="py-1 text-right">Events</th></tr>
              </thead>
              <tbody>
                @for (c of data.histogram; track c.source_form + c.date_precision) {
                  <tr class="border-t border-farm-100">
                    <td class="py-1 text-farm-800">{{ c.source_form }}</td>
                    <td class="py-1 text-farm-800">{{ c.date_precision }}</td>
                    <td class="py-1 text-right font-medium text-farm-900">{{ c.count }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>

        <section class="rounded-xl border border-farm-300 bg-white p-4">
          <h3 class="text-sm font-medium text-farm-800">Calving intervals</h3>
          @if (data.intervals.intervals.length === 0) {
            <p class="mt-2 text-sm italic text-farm-500" data-role="intervals-empty">
              No animal has two or more calvings yet.
            </p>
          } @else {
            <table class="mt-2 w-full text-left text-sm" data-role="intervals">
              <thead class="text-xs uppercase tracking-wide text-farm-600">
                <tr><th class="py-1">Animal</th><th class="py-1">From</th><th class="py-1">To</th><th class="py-1 text-right">Days</th><th class="py-1">Quality</th></tr>
              </thead>
              <tbody>
                @for (i of data.intervals.intervals; track i.animal_id + i.ordinal) {
                  <tr class="border-t border-farm-100">
                    <td class="py-1 font-mono text-farm-800">{{ i.animal_id }}</td>
                    <td class="py-1 text-farm-700">{{ i.from_on }}</td>
                    <td class="py-1 text-farm-700">{{ i.to_on }}</td>
                    <td class="py-1 text-right font-medium text-farm-900">{{ i.days }}</td>
                    <td class="py-1 text-farm-700">{{ i.quality }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <!-- The two sets are reported separately and never blended. -->
            <div class="mt-3 grid gap-2 sm:grid-cols-2" data-role="summaries">
              @for (s of [data.intervals.measured, data.intervals.approximate]; track s.quality) {
                <div class="rounded-lg bg-farm-50 px-3 py-2 text-sm">
                  <div class="text-xs uppercase tracking-wide text-farm-600">{{ s.quality }}</div>
                  @if (s.count === 0) {
                    <div class="text-farm-500 italic">none</div>
                  } @else {
                    <div class="text-farm-900">n = {{ s.count }} · mean {{ s.mean_days }}d</div>
                    <div class="text-xs text-farm-600">min {{ s.min_days }}d · max {{ s.max_days }}d</div>
                  }
                </div>
              }
            </div>
          }
          <p class="mt-3 text-xs text-farm-600" data-role="caveat">{{ data.intervals.caveat }}</p>
        </section>

        <button type="button" data-role="refresh" (click)="load()"
          class="rounded-xl border border-farm-300 bg-white px-4 py-2 text-sm font-medium text-farm-800"
        >Recheck</button>
      } @else {
        <p class="text-sm text-farm-600" data-role="loading">Loading…</p>
      }
    </div>
  `,
})
export class VerificationPanel {
  private readonly api = inject(RegistryApi);

  protected readonly v = signal<Verification | null>(null);
  protected readonly loadError = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    try {
      this.v.set(await this.api.verification());
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }
}
