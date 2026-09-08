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
import { Cell } from '../ui/cell';
import { lifeStageLabel } from './life-stage';
import type { HerdRow } from './types';
import { ErrorPanel } from '../ui/surface';
import { HelpText } from '../ui/text';
import { PageHeading } from '../ui/heading';
import { Button } from '../ui/button';
import { StatusBadge } from '../ui/surface';

@Component({
  selector: 'app-herd-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Cell, ErrorPanel, HelpText, PageHeading, RouterLink, StatusBadge],
  template: `
    <div class="mx-auto max-w-4xl">
      @if (loadError(); as e) {
        <p appErrorPanel size="lg" data-role="load-error">{{ e }}</p>
      } @else if (rows() === null) {
        <p appHelp data-role="loading">Loading…</p>
      } @else if (rows()!.length === 0) {
        <!-- THE EMPTY STATE. What the first hour looks like before any row
             exists: one thing to do, and no furniture pretending there is data. -->
        <div class="rounded-2xl border border-dashed border-line bg-surface-raised px-6 py-12 text-center"
          data-role="empty">
          <div class="mb-3 text-4xl">🐃</div>
          <h2 appPageHeading>No animals yet</h2>
          <p class="mx-auto mt-2 max-w-md text-sm text-content-muted">
            Start with the animals that arrived from elsewhere. Farm-born animals are created by
            their dam's calving, so they appear on their own once you record it.
          </p>
          <a routerLink="/animals/new" data-role="empty-cta" appButton class="mt-5 inline-block"
          >Add the first animal</a>
        </div>
      } @else {
        <div class="mb-3 flex items-baseline justify-between">
          <h2 appPageHeading>
            {{ rows()!.length }} {{ rows()!.length === 1 ? 'animal' : 'animals' }}
          </h2>
          <a routerLink="/animals/new" class="text-sm font-medium text-content-secondary underline">Add an animal</a>
        </div>

        @if (rows()!.length === 1) {
          <!-- THE ONE-ROW STATE. A real table with one row rather than a
               placeholder: the header, the columns and the drill-through all
               have to look right at n=1, because that is the state you stare
               at longest. -->
          <p class="mb-3 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-content-secondary" data-role="one-row-note">
            One animal so far. Open it to check the record reads the way you meant, then carry on.
          </p>
        }

        <div class="overflow-x-auto rounded-xl border border-line bg-surface-raised">
          <table class="w-full text-left text-sm" data-role="table">
            <thead class="border-b border-line-subtle bg-surface-page text-xs uppercase tracking-wide text-content-muted">
              <tr>
                <th appCell>Serial</th>
                <th appCell>Name</th>
                <th appCell>Sex</th>
                <th appCell>Status</th>
                <th appCell numeric>Parity</th>
                <th appCell>Born</th>
                <th appCell>Origin</th>
                <th appCell numeric>Events</th>
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr class="border-b border-line-hairline last:border-0 hover:bg-surface-page" [attr.data-row]="r.id">
                  <td appCell>
                    <a [routerLink]="['/animals', r.id]" class="font-mono font-medium text-content-heading underline">{{ r.id }}</a>
                  </td>
                  <td appCell tone="heading">{{ r.name ?? '—' }}</td>
                  <td appCell tone="secondary">{{ r.sex }}</td>
                  <!-- The local term, with what the enum actually holds on hover:
                       the screen shows the farm's word and never hides the
                       stored value from anyone debugging it. -->
                  <td appCell data-role="status"
                    [title]="r.status ? 'stored as ' + r.status : ''">
                    <span appBadge>
                      {{ r.status ? stage(r) : 'no projection' }}
                    </span>
                  </td>
                  <td appCell numeric tone="heading">{{ r.parity ?? '—' }}</td>
                  <!-- Precision is shown on every date. Never a bare date:
                       hiding the qualifier manufactures confidence. -->
                  <td appCell tone="secondary" data-role="born">
                    @if (r.birth_on) {
                      {{ r.birth_on }}
                      <span appHelp size="xs" tone="subtle">({{ r.birth_precision }})</span>
                    } @else {
                      <span class="italic text-content-subtle">unknown</span>
                    }
                  </td>
                  <td appCell small tone="muted">{{ r.origin }}</td>
                  <td appCell numeric tone="muted">{{ r.event_count }}</td>
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
