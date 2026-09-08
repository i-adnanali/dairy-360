// `/buyers/:id` -- the statement (docs/REGISTRY_SALES.md §12.3).
//
// The screen you hand to a dodhi.
//
// ---------------------------------------------------------------------------
// GROUPED BY MONTH, WITH THE RATE PRINTED AS AGREED
// ---------------------------------------------------------------------------
// A month between payments is around sixty rows, and nobody hands over sixty
// rows. The monthly line is the artifact; the daily detail underneath it is the
// evidence.
//
// Every row prints its rate as `Rs 7,000.00 / 40 L`, never `Rs 175.00/L`. The
// line has to be arithmetic the buyer can do against his own khata, and
// converting his rate into ours is the one edit that would stop him.
//
// The month is a DISPLAY GROUPING and nothing more -- no stored period, no
// closing flag. The farm settles monthly with the dodhi and at the end of a run
// with an occasional household, so a stored period would have to be
// per-destination and per-run rather than a calendar month.

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChipGroup } from './chip-group';
import { Cell } from '../ui/cell';
import { Certainty } from '../ui/certainty';
import type { CertaintyState } from '../ui/certainty';
import { NO_RECORD } from './precision-display';
import { FormState } from './form-state';
import { RegistryApi } from './api';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { WriteLog } from './after-write';
import { formatMinor, formatRate, rupeesToMinor } from './money';
import { farmToday } from './today';
import type { Dispatch, PaymentMethod, Statement, StatementMonth } from './types';
import { Card } from '../ui/surface';
import { ErrorPanel } from '../ui/surface';
import { FieldLabel } from '../ui/text';
import { HelpText } from '../ui/text';
import { TextInput } from '../ui/input';
import { PageHeading } from '../ui/heading';
import { RowDivider } from '../ui/surface';
import { SectionHeading } from '../ui/heading';
import { SectionLabel } from '../ui/text';
import { Button } from '../ui/button';

@Component({
  selector: 'app-destination-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    Card,
    Cell,
    Certainty,
    ChipGroup,
    ErrorPanel,
    FieldLabel,
    HelpText,
    PageHeading,
    RouterLink,
    RowDivider,
    SectionHeading,
    SectionLabel,
    SessionRequired,
    TextInput,
  ],
  template: `
    <div class="mx-auto max-w-4xl space-y-6">
      <a routerLink="/milk/buyers" class="text-sm text-content-muted underline">← all buyers</a>

      @if (loadError(); as e) {
        <p appErrorPanel size="lg" data-role="load-error">{{ e }}</p>
      } @else if (statement(); as s) {
        <header class="flex flex-wrap items-baseline justify-between gap-3">
          <h2 appPageHeading data-role="name">{{ s.name }}</h2>
          <div class="text-right">
            <div appSectionLabel>
              {{ s.balance_minor < 0 ? 'In credit' : 'Owes' }}
            </div>
            <div class="text-xl font-semibold"
              [class]="s.balance_minor > 0 ? 'text-content-primary' : 'text-success-fg'"
              data-role="balance">{{ balanceText(s) }}</div>
          </div>
        </header>

        <p appHelp data-role="totals">
          {{ s.litres }} L over {{ s.months.length }} month(s) · billed {{ money(s.billed_minor) }}
          · paid {{ money(s.paid_minor) }}
        </p>

        @if (s.months.length === 0) {
          <p appCard empty
            data-role="empty">Nothing recorded for {{ s.name }} yet.</p>
        }

        @for (m of s.months; track m.month) {
          <section class="overflow-hidden rounded-xl border border-line bg-surface-raised"
            [attr.data-month]="m.month">
            <!-- THE ARTIFACT: one line per month. -->
            <div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-line-subtle bg-surface-page px-4 py-2 text-sm">
              <span class="font-semibold text-content-primary">{{ monthLabel(m.month) }}</span>
              <span class="text-content-secondary" [attr.data-role]="'summary-' + m.month">
                {{ m.litres }} L · billed {{ money(m.billed_minor) }} · paid {{ money(m.paid_minor) }}
                ·
                <span class="font-medium text-content-primary">
                  {{ m.closing_minor === 0 ? 'settled' : money(m.closing_minor) + ' carried forward' }}
                </span>
              </span>
            </div>

            <!-- THE EVIDENCE: the rows underneath it. -->
            <table class="w-full text-left text-sm">
              <tbody>
                @for (d of m.dispatches; track d.id) {
                  <tr appRowDivider [attr.data-dispatch]="d.id">
                    <td appCell tone="secondary">{{ d.occurred_on }} {{ d.session }}</td>
                    <td appCell tone="secondary">
                      <!-- "nothing taken" is §6's third state: an answer was
                           given, so it is words and it is italic. -->
                      <span [appCertainty]="d.status === 'taken' ? 'known' : 'absent'"
                        [attr.data-certainty]="d.status === 'taken' ? 'known' : 'absent'"
                      >{{ d.status === 'taken' ? d.litres + ' L' : 'nothing taken' }}</span>
                      @if (d.reason) { <span class="text-content-subtle">— {{ d.reason }}</span> }
                    </td>
                    <!-- AN EMPTY CELL, WHICH §15 RULE 1 FORBIDS OUTRIGHT:
                         "rateText" returned '' for a dispatch with no price, so
                         the rate column simply went blank and a reader could not
                         tell a missing agreement from a rendering fault. It
                         takes the en dash now, which is what §6 reserves for
                         exactly this. -->
                    <td appCell small tone="muted" [attr.data-role]="'rate-' + d.id">
                      @if (rateState(d); as st) {
                        <span [appCertainty]="st" [attr.data-certainty]="st">{{ rateText(d) }}</span>
                      } @else {
                        {{ rateText(d) }}
                      }
                    </td>
                    <td appCell numeric tone="heading">
                      <span [appCertainty]="amountState(d)" [attr.data-certainty]="amountState(d)"
                      >{{ amountText(d) }}</span>
                    </td>
                  </tr>
                }
                @for (p of m.payments; track p.id) {
                  <tr class="border-t border-line-hairline bg-success-bg/40" [attr.data-payment]="p.id">
                    <td appCell tone="secondary">{{ p.occurred_on }}</td>
                    <td appCell tone="secondary">
                      {{ p.method }}
                      @if (p.reference) { <span class="text-content-subtle">· {{ p.reference }}</span> }
                      @if (p.note) { <span class="text-content-subtle">— {{ p.note }}</span> }
                    </td>
                    <td appCell></td>
                    <td appCell numeric emphasis tone="success">
                      −{{ money(p.amount_minor) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }

        <!-- record a payment ------------------------------------------- -->
        @if (s.billable) {
          <form appCard class="space-y-3"
            data-role="payment-form" (submit)="submitPayment($event)">
            <h3 appSectionHeading>Record a payment</h3>

            <div class="flex flex-wrap items-end gap-3">
              <label class="block">
                <span appFieldLabel>Amount (Rs)</span>
                <input data-role="pay-amount" inputmode="decimal" [value]="amount()"
                  (input)="amount.set($any($event.target).value)" appInput class="w-32" />
              </label>
              <label class="block">
                <span appFieldLabel>On</span>
                <input type="date" data-role="pay-on" [value]="occurredOn()"
                  (change)="occurredOn.set($any($event.target).value)" appInput />
              </label>
              <div>
                <div appFieldLabel inline>How</div>
                <app-chip-group name="method" label="Method" [options]="methodChips"
                  [value]="method()" (changed)="method.set($any($event))" />
              </div>
            </div>

            <label class="block">
              <span appFieldLabel>
                Reference {{ method() === 'adjustment' ? '' : '(optional)' }}
              </span>
              <input data-role="pay-reference" [value]="reference()"
                (input)="reference.set($any($event.target).value)"
                placeholder="cheque no., transfer ref, khata page" appInput class="w-72" />
            </label>

            @if (method() === 'adjustment') {
              <!-- An adjustment is a DECISION somebody made rather than money
                   that changed hands, so the note is required and the sign is
                   allowed. A signed number with no sentence attached cannot be
                   audited a month later. -->
              <label class="block">
                <span appFieldLabel>Why (required)</span>
                <input data-role="pay-note" [value]="note()"
                  (input)="note.set($any($event.target).value)"
                  placeholder="written off, agreed at settlement…" appInput class="w-full" />
              </label>
              <div class="flex items-center gap-2 text-xs text-content-secondary">
                <label class="flex items-center gap-1">
                  <input type="checkbox" data-role="pay-negative" [checked]="negative()"
                    (change)="negative.set($any($event.target).checked)" />
                  reduces what they owe
                </label>
                <span class="text-content-subtle">
                  — only an adjustment may be signed; cash and bank are money that arrived.
                </span>
              </div>
            }

            @if (payState.formError(payFields); as e) {
              <p appErrorPanel data-role="pay-error">{{ e }}</p>
            }

            @if (session.ready()) {
              <button type="submit" data-role="pay-submit" [appButtonDisabled]="!canPay()" appButton
              >{{ payState.submitting() ? 'Saving…' : 'Record payment' }}</button>
            } @else {
              <app-session-required what="a payment" />
            }
          </form>
        }

        <!-- price history ---------------------------------------------- -->
        @if (s.prices.length > 0) {
          <section appCard data-role="price-history">
            <h3 class="mb-2 text-sm font-semibold text-content-primary">Agreed rates</h3>
            <ul class="space-y-1 text-sm text-content-secondary">
              @for (p of s.prices; track p.id) {
                <li>
                  from {{ p.effective_from }} —
                  <span class="font-medium">{{ rate(p.price_minor, p.price_unit_litres) }}</span>
                  @if (p.note) { <span class="text-content-subtle">· {{ p.note }}</span> }
                </li>
              }
            </ul>
          </section>
        }
      } @else {
        <p appHelp data-role="loading">Loading…</p>
      }
    </div>
  `,
})
export class DestinationDetail {
  private readonly api = inject(RegistryApi);
  protected readonly session = inject(Session);
  private readonly writeLog = inject(WriteLog);

  /** Bound from the route by withComponentInputBinding(). */
  readonly id = input.required<string>();

  protected readonly statement = signal<Statement | null>(null);
  protected readonly loadError = signal<string | null>(null);

  protected readonly payFields = ['amount_minor', 'method', 'note', 'occurred_on'] as const;
  protected readonly payState = new FormState<{ id: string; amount_minor: number }>();

  protected readonly amount = signal('');
  protected readonly occurredOn = signal(farmToday());
  protected readonly method = signal<PaymentMethod>('cash');
  protected readonly reference = signal('');
  protected readonly note = signal('');
  protected readonly negative = signal(true);

  protected readonly methodChips = [
    { value: 'cash', label: 'Cash' },
    { value: 'bank', label: 'Bank' },
    { value: 'adjustment', label: 'Adjustment' },
  ];

  constructor() {
    // An effect rather than ngOnInit, so navigating between two buyers reloads.
    void Promise.resolve().then(() => this.load());
  }

  private async load(): Promise<void> {
    try {
      this.statement.set(await this.api.statement(this.id()));
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  protected money(minor: number): string {
    return formatMinor(minor);
  }

  protected rate(minor: number, unit: number): string {
    return formatRate(minor, unit);
  }

  /** As agreed, never per-litre -- see the module comment. */
  protected rateText(d: Dispatch): string {
    if (d.price_minor === null || d.price_unit_litres === null) return NO_RECORD;
    return formatRate(d.price_minor, d.price_unit_litres);
  }

  /**
   * `known` is not among the answers, for the same reason it is not on the
   * dispatch sheet's rate column: §6's known treatment carries the monospace
   * face, and this is a composite rate LABEL rather than a figure column. §11
   * records the 48px that cost the last time it was set in mono.
   */
  protected rateState(d: Dispatch): CertaintyState | null {
    return d.price_minor === null || d.price_unit_litres === null ? 'no-record' : null;
  }

  protected amountText(d: Dispatch): string {
    if (d.status !== 'taken' || d.price_minor === null || d.price_unit_litres === null) {
      return NO_RECORD;
    }
    return formatMinor(Math.round((d.litres! * d.price_minor) / d.price_unit_litres));
  }

  protected amountState(d: Dispatch): CertaintyState {
    if (d.status !== 'taken' || d.price_minor === null || d.price_unit_litres === null) {
      return 'no-record';
    }
    return 'known';
  }

  protected balanceText(s: Statement): string {
    return formatMinor(Math.abs(s.balance_minor));
  }

  protected monthLabel(month: string): string {
    const [y, m] = month.split('-').map(Number);
    const names = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return `${names[m - 1]} ${y}`;
  }

  protected readonly canPay = computed(() => {
    if (this.payState.submitting()) return false;
    const minor = rupeesToMinor(this.amount());
    if (minor === null || minor === 0) return false;
    if (this.method() === 'adjustment' && this.note().trim().length === 0) return false;
    return this.occurredOn().length > 0;
  });

  protected async submitPayment(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.canPay()) return;
    const minor = rupeesToMinor(this.amount());
    if (minor === null) return;

    const signed =
      this.method() === 'adjustment' && this.negative() ? -Math.abs(minor) : Math.abs(minor);

    const result = await this.payState.run((key) =>
      this.api.recordPayment(
        {
          destination_id: this.id(),
          occurred_on: this.occurredOn(),
          amount_minor: signed,
          method: this.method(),
          reference: this.reference().trim().length > 0 ? this.reference().trim() : null,
          note: this.note().trim().length > 0 ? this.note().trim() : null,
          recorded_by: this.session.provenance().recorded_by,
        },
        key,
      ),
    );

    if (result) {
      this.writeLog.announce(`${formatMinor(result.amount_minor)} recorded (${this.method()})`);
      this.amount.set('');
      this.reference.set('');
      this.note.set('');
      await this.load();
    }
  }
}
