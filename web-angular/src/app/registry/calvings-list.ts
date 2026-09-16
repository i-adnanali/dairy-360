import { computed } from '@angular/core';
import { pagedList } from './paged-list';
import { Pagination } from '../ui/pagination';
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
  imports: [Pagination,
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
    <label class="mb-3 block text-sm text-content-secondary">Search records <input type="search" maxlength="100" class="rounded border border-line bg-surface-page p-2" [value]="paging.url.value().search" (change)="paging.url.set({search:$any($event.target).value,page:'1'})"></label>
    @if(paging.loading()){<p role="status" class="text-sm text-content-muted">Loading records…</p>}

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
          <app-pagination [page]="paging.result()!.page" [pageSize]="paging.result()!.pageSize" [total]="paging.result()!.totalItems" [disabled]="paging.loading()" (pageChange)="paging.url.set({page: ''+$event})" (sizeChange)="paging.url.set({pageSize: ''+$event, page: '1'})"/>
        </div>
      } @else {
        <p role="status">Loading calvings…</p>
      }
    </div>
  `,
})
export class CalvingsList {
  readonly paging = pagedList<{animal:HerdRow;event:TimelineEvent}>('calvings','date');
  readonly rows = computed(() => this.paging.result()?.items ?? null);
  readonly error = this.paging.error;
  readonly precision = precisionParts;
  load() { this.paging.refresh(); }
}
