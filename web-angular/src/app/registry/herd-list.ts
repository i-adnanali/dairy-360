// The herd table. Exists to CHECK YOUR OWN WORK, not to be a dashboard.
//
// Deliberately a plain list before it is anything else -- the forms are what
// tests the schema, and this is what tells you whether what you entered is what
// you meant. Every date carries its precision.
//
// Empty and one-row states are BUILT, not discovered: the first hour of real
// entry is spent looking at exactly those two.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RegistryApi } from './api';
import { lifeStageLabel } from './life-stage';
import type { HerdRow } from './types';

@Component({
  selector: 'app-herd-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="mx-auto max-w-4xl">
      @if (loadError(); as e) {
        <p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" data-role="load-error">{{ e }}</p>
      } @else if (rows() === null) {
        <p class="text-sm text-farm-600" data-role="loading">Loading…</p>
      } @else if (rows()!.length === 0) {
        <!-- THE EMPTY STATE. What the first hour looks like before any row
             exists: one thing to do, and no furniture pretending there is data. -->
        <div class="rounded-2xl border border-dashed border-farm-300 bg-white px-6 py-12 text-center"
          data-role="empty">
          <div class="mb-3 text-4xl">🐃</div>
          <h2 class="text-lg font-semibold text-farm-900">No animals yet</h2>
          <p class="mx-auto mt-2 max-w-md text-sm text-farm-600">
            Start with the animals that arrived from elsewhere. Farm-born animals are created by
            their dam's calving, so they appear on their own once you record it.
          </p>
          <a routerLink="/add" data-role="empty-cta"
            class="mt-5 inline-block rounded-xl bg-farm-600 px-4 py-2 text-sm font-medium text-white"
          >Add the first animal</a>
        </div>
      } @else {
        <div class="mb-3 flex items-baseline justify-between">
          <h2 class="text-lg font-semibold text-farm-900">
            {{ rows()!.length }} {{ rows()!.length === 1 ? 'animal' : 'animals' }}
          </h2>
          <a routerLink="/add" class="text-sm font-medium text-farm-700 underline">Add an animal</a>
        </div>

        @if (rows()!.length === 1) {
          <!-- THE ONE-ROW STATE. A real table with one row rather than a
               placeholder: the header, the columns and the drill-through all
               have to look right at n=1, because that is the state you stare
               at longest. -->
          <p class="mb-3 rounded-lg bg-farm-100 px-3 py-2 text-sm text-farm-700" data-role="one-row-note">
            One animal so far. Open it to check the record reads the way you meant, then carry on.
          </p>
        }

        <div class="overflow-x-auto rounded-xl border border-farm-300 bg-white">
          <table class="w-full text-left text-sm" data-role="table">
            <thead class="border-b border-farm-200 bg-farm-50 text-xs uppercase tracking-wide text-farm-600">
              <tr>
                <th class="px-3 py-2">Serial</th>
                <th class="px-3 py-2">Name</th>
                <th class="px-3 py-2">Sex</th>
                <th class="px-3 py-2">Status</th>
                <th class="px-3 py-2 text-right">Parity</th>
                <th class="px-3 py-2">Born</th>
                <th class="px-3 py-2">Origin</th>
                <th class="px-3 py-2 text-right">Events</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr class="border-b border-farm-100 last:border-0 hover:bg-farm-50" [attr.data-row]="r.id">
                  <td class="px-3 py-2">
                    <a [routerLink]="['/animals', r.id]" class="font-mono font-medium text-farm-800 underline">{{ r.id }}</a>
                  </td>
                  <td class="px-3 py-2 text-farm-800">{{ r.name ?? '—' }}</td>
                  <td class="px-3 py-2 text-farm-700">{{ r.sex }}</td>
                  <!-- The local term, with what the enum actually holds on hover:
                       the screen shows the farm's word and never hides the
                       stored value from anyone debugging it. -->
                  <td class="px-3 py-2" data-role="status"
                    [title]="r.status ? 'stored as ' + r.status : ''">
                    <span class="rounded-full bg-farm-200 px-2 py-0.5 text-xs font-medium text-farm-800">
                      {{ r.status ? stage(r) : 'no projection' }}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-right text-farm-800">{{ r.parity ?? '—' }}</td>
                  <!-- Precision is shown on every date. Never a bare date:
                       hiding the qualifier manufactures confidence. -->
                  <td class="px-3 py-2 text-farm-700" data-role="born">
                    @if (r.birth_on) {
                      {{ r.birth_on }}
                      <span class="text-xs text-farm-500">({{ r.birth_precision }})</span>
                    } @else {
                      <span class="italic text-farm-500">unknown</span>
                    }
                  </td>
                  <td class="px-3 py-2 text-xs text-farm-600">{{ r.origin }}</td>
                  <td class="px-3 py-2 text-right text-farm-600">{{ r.event_count }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class HerdList {
  /** The farm's word for this animal's stage. Stored enum unchanged. */
  protected stage(r: HerdRow): string {
    return lifeStageLabel(r.status, r.sex);
  }

  private readonly api = inject(RegistryApi);

  protected readonly rows = signal<HerdRow[] | null>(null);
  protected readonly loadError = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.rows.set(await this.api.herd());
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }
}
