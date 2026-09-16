import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { Pagination } from './pagination';
/** Paging for already-loaded composite histories; never used to calculate totals. */
@Component({
  selector: 'app-local-pagination',
  exportAs: 'localPagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Pagination],
  template: `<app-pagination
    [page]="current()"
    [pageSize]="size()"
    [total]="total()"
    (pageChange)="page.set($event)"
    (sizeChange)="size.set($event); page.set(1)"
  />`,
})
export class LocalPagination {
  readonly total = input(0);
  readonly page = signal(1);
  readonly size = signal(25);
  records(rows: any[]): readonly any[] {
    return this.rows(rows);
  }
  current() {
    return Math.min(this.page(), Math.max(1, Math.ceil(this.total() / this.size())));
  }
  rows<T>(rows: readonly T[]): readonly T[] {
    const page = Math.min(this.page(), Math.max(1, Math.ceil(rows.length / this.size())));
    return rows.slice((page - 1) * this.size(), page * this.size());
  }
}
