import { ChangeDetectionStrategy, Component, output } from '@angular/core';

const STARTERS = [
  "How did the Kundi group's milk yield trend over the last 30 days?",
  'Which animals have a health event due in the next two weeks?',
  "Log this morning's milking for the Kundi group.",
];

// Port of web-react/src/components/EmptyState.tsx
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full flex-col items-center justify-center text-center">
      <div class="mb-2 text-4xl">🐃</div>
      <h2 class="text-xl font-semibold text-content-heading">Welcome to your farm assistant</h2>
      <p class="mb-6 mt-1 max-w-md text-sm text-content-muted">
        I can read your records to answer questions, and propose record changes that you approve before
        anything is written.
      </p>
      <div class="grid w-full max-w-md gap-2">
        @for (s of starters; track s) {
          <button
            (click)="pick.emit(s)"
            class="rounded-xl border border-line-subtle bg-surface-raised px-4 py-3 text-left text-sm text-content-heading shadow-sm transition hover:border-line-strong hover:bg-surface-sunken"
          >
            {{ s }}
          </button>
        }
      </div>
    </div>
  `,
})
export class EmptyState {
  readonly pick = output<string>();
  protected readonly starters = STARTERS;
}
