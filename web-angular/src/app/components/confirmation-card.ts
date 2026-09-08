import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Approval, PendingWrite } from '@dairy/shared';
import { Cell } from '../ui/cell';
import { Button } from '../ui/button';
import { StatusBadge } from '../ui/surface';

// Port of web-react/src/components/ConfirmationCard.tsx
@Component({
  selector: 'app-confirmation-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Cell, StatusBadge],
  template: `
    <div class="rounded-xl border-2 border-line bg-surface-sunken p-4 shadow-sm">
      <div class="mb-1 flex items-center gap-2">
        <span appBadge tone="brand">
          Confirm action
        </span>
        <span class="font-mono text-xs text-content-muted">{{ card().toolName }}</span>
      </div>

      <p class="mb-3 text-sm font-medium text-content-primary">{{ card().summary }}</p>

      <dl class="mb-3 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
        @for (d of card().details; track d.label) {
          <div class="contents">
            <dt class="text-content-subtle">{{ d.label }}</dt>
            <dd class="text-content-primary">{{ d.value }}</dd>
          </div>
        }
      </dl>

      @if (card().rows && card().rows!.length > 0) {
        <table class="mb-3 w-full text-sm">
          <thead>
            <tr class="border-b border-line-subtle text-left text-content-subtle">
              <th appCell emphasis>Animal</th>
              <th appCell numeric emphasis>Value</th>
            </tr>
          </thead>
          <tbody>
            @for (r of card().rows; track $index) {
              <tr class="border-b border-line-subtle/60 last:border-0">
                <td appCell>
                  {{ r.tag }}{{ r.name ? ' · ' + r.name : '' }}
                </td>
                <td appCell numeric class="tabular-nums">{{ r.value }}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      <div class="flex gap-2">
        <button appButton size="sm"
          (click)="approve()"
        >
          Approve
        </button>
        <button
          class="rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-page"
          (click)="reject()"
        >
          Reject
        </button>
      </div>
    </div>
  `,
})
export class ConfirmationCard {
  readonly card = input.required<PendingWrite>();
  readonly resolve = output<Approval[]>();

  protected approve(): void {
    this.resolve.emit([{ toolUseId: this.card().toolUseId, approved: true }]);
  }

  protected reject(): void {
    this.resolve.emit([{ toolUseId: this.card().toolUseId, approved: false }]);
  }
}
