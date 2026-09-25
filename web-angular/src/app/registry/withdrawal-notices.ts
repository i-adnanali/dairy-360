import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface WithdrawalNotice {
  animal_id?: string;
  administration_id?: string;
  revision?: number;
  target: string;
  status: string;
  instruction?: string;
  until?: string;
  issuer?: string;
  product_name?: string;
}
/** Missing reference/revision is not evidence that two instructions are duplicates. */
export function groupWithdrawals(notices: WithdrawalNotice[]) {
  const seen = new Set<string>();
  const groups = new Map<string, { animal: string; medium: string; records: WithdrawalNotice[] }>();
  for (const notice of notices) {
    if (notice.administration_id && notice.revision !== undefined) {
      const reference = JSON.stringify([
        notice.animal_id,
        notice.target,
        notice.administration_id,
        notice.revision,
      ]);
      if (seen.has(reference)) continue;
      seen.add(reference);
    }
    const key = JSON.stringify([notice.animal_id, notice.target]);
    const group = groups.get(key) ?? {
      animal: notice.animal_id ?? '',
      medium: notice.target,
      records: [],
    };
    group.records.push(notice);
    groups.set(key, group);
  }
  return [...groups.values()];
}
@Component({
  selector: 'app-withdrawal-notices',
  imports: [RouterLink],
  template: `
    @for (group of groups(); track $index) {
      <section
        class="my-2 rounded-lg border border-line bg-surface-sunken p-3 text-sm"
        data-role="withdrawal-group"
      >
        <p class="font-medium">
          {{ group.animal }} ·
          {{ group.medium === 'milk' ? 'Milk' : group.medium === 'meat' ? 'Meat' : group.medium }}
          withdrawal · {{ group.records.length }} instruction(s) needing attention
        </p>
        @if (unknownEnds(group.records); as count) {
          <p>Needs clarification — {{ count }} instruction(s) have no known end.</p>
        }
        @for (end of knownEnds(group.records); track end) {
          <p>
            Recorded end:
            <time class="whitespace-nowrap" [attr.datetime]="end">{{ end.replace('T', ' ') }}</time>
          </p>
        }
        <details [open]="expanded()">
          <summary class="cursor-pointer underline">Original instructions and sources</summary>
          @for (w of group.records; track $index) {
            <div class="mt-2 border-t border-line-subtle pt-2 break-words">
              <p>
                {{ w.product_name }}{{ w.product_name ? ' · ' : ''
                }}{{ w.instruction || 'Instruction needs clarification' }}
              </p>
              @if (w.issuer) {
                <p>Issued by {{ w.issuer }}</p>
              }
              <p>
                {{ w.until ? 'Recorded end: ' + w.until : 'Needs clarification — no known end' }}
              </p>
              @if (w.administration_id) {
                @if (localSource()) {
                  <button
                    type="button"
                    class="underline"
                    [attr.aria-label]="
                      'Source recorded dose for ' +
                      group.animal +
                      ' · ' +
                      group.medium +
                      ' · ' +
                      (w.product_name || w.administration_id)
                    "
                    (click)="source.emit(w.administration_id)"
                  >
                    Source recorded dose{{
                      w.revision !== undefined ? ' · revision ' + w.revision : ''
                    }}
                  </button>
                } @else {
                  <a
                    class="underline"
                    routerLink="/animals/health"
                    [attr.aria-label]="
                      'Source recorded dose for ' +
                      group.animal +
                      ' · ' +
                      group.medium +
                      ' · ' +
                      (w.product_name || w.administration_id)
                    "
                    [queryParams]="{ record: w.administration_id }"
                    >Source recorded dose{{
                      w.revision !== undefined ? ' · revision ' + w.revision : ''
                    }}</a
                  >
                }
              } @else {
                <p>Source reference not supplied</p>
              }
            </div>
          }
        </details>
      </section>
    }
  `,
})
export class WithdrawalNotices {
  protected unknownEnds(records: WithdrawalNotice[]) {
    return records.filter((w) => !w.until).length;
  }
  protected knownEnds(records: WithdrawalNotice[]) {
    return [...new Set(records.map((w) => w.until).filter((end): end is string => !!end))];
  }
  readonly localSource = input(false);
  readonly source = output<string>();
  readonly notices = input<WithdrawalNotice[]>([]);
  readonly expanded = input(false);
  protected readonly groups = computed(() => groupWithdrawals(this.notices()));
}
