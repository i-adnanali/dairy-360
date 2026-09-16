import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Button } from './button';
@Component({
  selector: 'app-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button],
  template: `<nav
    aria-label="Table pagination"
    class="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-content-secondary"
  >
    <label
      >Rows per page
      <select
        class="rounded border border-line bg-surface px-2 py-1"
        [value]="pageSize()"
        (change)="sizeChange.emit(+$any($event.target).value)"
      >
        <option value="25">25</option>
        <option value="50">50</option>
        <option value="100">100</option>
      </select></label
    >
    <span aria-live="polite">{{
      total() ? start() + '–' + end() + ' of ' + total() : '0 results'
    }}</span>
    <div class="flex items-center gap-3">
      <button
        type="button"
        appButton
        variant="secondary"
        [disabled]="disabled() || page() <= 1"
        (click)="pageChange.emit(page() - 1)"
      >
        Previous</button
      ><span>Page {{ pages() ? page() : 0 }} of {{ pages() }}</span
      ><button
        type="button"
        appButton
        variant="secondary"
        [disabled]="disabled() || page() >= pages()"
        (click)="pageChange.emit(page() + 1)"
      >
        Next
      </button>
    </div>
  </nav>`,
})
export class Pagination {
  readonly page = input(1);
  readonly pageSize = input(25);
  readonly total = input(0);
  readonly disabled = input(false);
  readonly pageChange = output<number>();
  readonly sizeChange = output<number>();
  readonly pages = computed(() => Math.ceil(this.total() / this.pageSize()));
  readonly start = computed(() => (this.page() - 1) * this.pageSize() + 1);
  readonly end = computed(() => Math.min(this.page() * this.pageSize(), this.total()));
}
