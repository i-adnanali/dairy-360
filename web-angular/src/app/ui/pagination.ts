import { ChangeDetectionStrategy, Component, computed, effect, input, output } from '@angular/core';
import { Button } from './button';
import { TextInput } from './input';
@Component({
  selector: 'app-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TextInput],
  template: `@if (total() > 0) {
    <nav
      [attr.aria-label]="label() + ' pagination'"
      class="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-content-secondary"
    >
      @if (total() > 25) {
        <label
          >Rows per page
          <select
            appInput
            class="bg-surface-raised"
            [attr.aria-label]="label() + ' rows per page'"
            [value]="pageSize()"
            [disabled]="disabled()"
            (change)="sizeChange.emit(+$any($event.target).value)"
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
      }
      <span aria-live="polite">{{ start() }}–{{ end() }} of {{ total() }}</span>
      @if (pages() > 1) {
        <div class="flex items-center gap-3">
          <button
            type="button"
            appButton
            variant="secondary"
            [disabled]="disabled() || current() <= 1"
            (click)="move(-1)"
          >
            Previous
          </button>
          <span>Page {{ current() }} of {{ pages() }}</span>
          <button
            type="button"
            appButton
            variant="secondary"
            [disabled]="disabled() || current() >= pages()"
            (click)="move(1)"
          >
            Next
          </button>
        </div>
      }
    </nav>
  }`,
})
export class Pagination {
  readonly label = input.required<string>();
  readonly page = input(1);
  readonly pageSize = input(25);
  readonly total = input(0);
  readonly disabled = input(false);
  readonly pageChange = output<number>();
  readonly sizeChange = output<number>();
  readonly pages = computed(() => Math.ceil(this.total() / this.pageSize()));
  readonly current = computed(() => Math.max(1, Math.min(this.page(), this.pages() || 1)));
  readonly start = computed(() => (this.current() - 1) * this.pageSize() + 1);
  readonly end = computed(() => Math.min(this.current() * this.pageSize(), this.total()));
  constructor() {
    effect(() => {
      if (!this.disabled() && this.page() !== this.current()) this.pageChange.emit(this.current());
    });
  }
  protected move(delta: number) {
    const next = this.current() + delta;
    if (!this.disabled() && next >= 1 && next <= this.pages()) this.pageChange.emit(next);
  }
}
