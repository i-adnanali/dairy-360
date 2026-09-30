import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { Approval, PendingWrite } from '@dairy/shared';
import { Cell } from '../ui/cell';
import { Button } from '../ui/button';
import { ScrollRegion } from '../ui/scroll-region';
import { StatusBadge } from '../ui/surface';

// Port of web-react/src/components/ConfirmationCard.tsx
@Component({
  selector: 'app-confirmation-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Cell, StatusBadge, ScrollRegion],
  template: `
    <div class="rounded-xl border-2 border-line bg-surface-sunken p-4 shadow-sm">
      <div class="mb-1 flex items-center gap-2">
        <span appBadge tone="brand">{{ statusLabel() }}</span>
      </div>

      <p class="mb-3 text-sm font-medium text-content-primary">{{ card().summary }}</p>

      <details [open]="!decision() && !resolved()" class="mb-3">
      <summary class="text-sm cursor-pointer">{{ decision() || resolved() ? 'Action details' : 'Review proposed changes' }}</summary>
      <dl class="mb-3 grid grid-cols-[minmax(0,1fr),minmax(0,2fr)] gap-x-4 gap-y-1 text-sm">
        @for (d of card().details; track d.label) {
          <div class="contents">
            <dt class="text-content-subtle">{{ d.label }}</dt>
            <dd class="text-content-primary">{{ d.value }}</dd>
          </div>
        }
      </dl>

      @if (card().rows && card().rows!.length > 0) {
        <div appScrollRegion="Proposed operation rows">
          <table class="mb-3 w-full text-sm">
            <thead>
              <tr class="border-b border-line-subtle text-left text-content-subtle">
                <th scope="col" appCell emphasis>Animal</th>
                <th scope="col" appCell numeric emphasis>Value</th>
              </tr>
            </thead>
            <tbody>
              @for (r of card().rows; track $index) {
                <tr class="border-b border-line-subtle/60 last:border-0">
                  <td appCell>{{ r.tag }}{{ r.name ? ' · ' + r.name : '' }}</td>
                  <td appCell numeric>{{ r.value }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <p class="text-xs text-content-muted">Technical operation: <code>{{ card().toolName }}</code></p>
      </details>
      @if (decision() || resolved()) {
        <p
          role="status"
          tabindex="-1"
          data-role="decision-status"
          [attr.data-tool-use-id]="card().toolUseId"
          class="text-sm"
        >
          {{ statusLabel() }} ·
          {{ reason() || ((decision() || resolved()) === 'rejected' ? 'Not authorized; no execution requested.' : 'Approval is recorded; waiting for an execution result.') }}
        </p>
      } @else {
        <div class="flex gap-2">
          <button appButton size="sm" (click)="approve()">Approve</button>
          <button appButton variant="secondary" size="sm" (click)="reject()">Reject</button>
        </div>
      }
    </div>
  `,
})
export class ConfirmationCard {
  readonly card = input.required<PendingWrite>();
  readonly decision = input<'approved' | 'rejected' | null>(null);
  readonly reason = input('');
  readonly outcome = input<'awaiting' | 'recorded' | 'refused' | 'unknown'>('awaiting');
  protected readonly statusLabel = computed(() => {
    const decision = this.decision() || this.resolved();
    if (decision === 'rejected') return 'Rejected';
    if (!decision) return 'Approval requested';
    return { awaiting: 'Approved · awaiting result', recorded: 'Recorded', refused: 'Not recorded', unknown: 'Outcome unknown' }[this.outcome()];
  });
  protected readonly resolved = signal<'approved' | 'rejected' | null>(null);
  readonly resolve = output<Approval[]>();

  protected approve(): void {
    if (this.resolved() || this.decision()) return;
    this.resolved.set('approved');
    this.resolve.emit([{ toolUseId: this.card().toolUseId, approved: true }]);
  }

  protected reject(): void {
    if (this.resolved() || this.decision()) return;
    this.resolved.set('rejected');
    this.resolve.emit([{ toolUseId: this.card().toolUseId, approved: false }]);
  }
}
