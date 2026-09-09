// A herd-wide read over the existing per-animal timeline contract. Precision
// and correction status travel with the dates; failed reads never look empty.
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RegistryApi } from './api';
import { HerdRow, TimelineEvent } from './types';
import { precisionParts } from './precision-display';
import { Certainty, Qualifier } from '../ui/certainty';
import { Cell } from '../ui/cell';
import { ErrorPanel, StatusBadge } from '../ui/surface';
import { PageHeading } from '../ui/heading';
import { IdentifierLink, RowLink } from '../ui/navigation';

@Component({
  selector: 'app-calvings-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    Certainty,
    Qualifier,
    Cell,
    ErrorPanel,
    StatusBadge,
    PageHeading,
    IdentifierLink,
    RowLink,
  ],
  template: `
    <div class="space-y-4">
      <h2 appPageHeading>Calvings</h2>
      <p class="max-w-[68ch] text-sm text-content-muted">
        Recorded calvings across the herd. Open the animal to inspect or correct its history.
        Approximate dates keep their recorded precision.
      </p>
      @if (error()) {
        <p appErrorPanel>{{ error() }}</p>
        <button type="button" (click)="load()">Retry</button>
      } @else if (rows(); as records) {
        <div class="overflow-x-auto rounded-xl border border-line bg-surface-raised">
          <table class="w-full text-left text-sm" data-role="calvings-table">
            <thead>
              <tr>
                <th appCell>Dam</th>
                <th appCell>Date</th>
                <th appCell>Outcome</th>
                <th appCell>Record</th>
              </tr>
            </thead>
            <tbody>
              @for (row of records; track row.event.id) {
                <tr [appRowLink]="'/animals/' + row.animal.id" class="border-t border-line-subtle">
                  <td appCell>
                    <a appIdentifier [routerLink]="['/animals', row.animal.id]">{{
                      row.animal.id
                    }}</a>
                    {{ row.animal.name }}
                  </td>
                  <td appCell>
                    @let date = precision(row.event.occurred_on, row.event.date_precision);
                    <span [appCertainty]="date.state">{{ date.figure }}</span>
                    @if (date.qualifier) {
                      <span appQualifier>{{ date.qualifier }}</span>
                    }
                  </td>
                  <td appCell>{{ row.event.payload['outcome'] ?? 'not recorded' }}</td>
                  <td appCell>
                    <span appBadge [tone]="row.event.effective ? 'neutral' : 'ended'">{{
                      row.event.effective ? 'effective' : 'superseded'
                    }}</span>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td appCell colspan="4">No calvings recorded.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p role="status">Loading calvings…</p>
      }
    </div>
  `,
})
export class CalvingsList {
  private readonly api = inject(RegistryApi);
  readonly rows = signal<{ animal: HerdRow; event: TimelineEvent }[] | null>(null);
  readonly error = signal<string | null>(null);
  readonly precision = precisionParts;
  constructor() {
    void this.load();
  }
  async load(): Promise<void> {
    this.error.set(null);
    this.rows.set(null);
    try {
      const herd = await this.api.herd();
      const rows: { animal: HerdRow; event: TimelineEvent }[] = [];
      // Bound concurrency; the current herd is small but an import need not be.
      for (let i = 0; i < herd.length; i += 6) {
        const batch = await Promise.all(
          herd
            .slice(i, i + 6)
            .map(async (animal) =>
              (await this.api.calvings(animal.id)).map((event) => ({ animal, event })),
            ),
        );
        rows.push(...batch.flat());
      }
      this.rows.set(
        rows.sort(
          (a, b) =>
            b.event.occurred_on.localeCompare(a.event.occurred_on) ||
            a.event.id.localeCompare(b.event.id),
        ),
      );
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
