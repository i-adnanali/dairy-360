import { ChangeDetectionStrategy, Component, computed, effect, input, output } from '@angular/core';
import { Button } from "../button";
import { TextInput } from "../input";
@Component({
  selector: 'app-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TextInput],
  templateUrl: './pagination.html',
  styleUrl: './pagination.css',
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
