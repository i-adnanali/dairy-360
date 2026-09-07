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
import { FormState } from './form-state';
import { RegistryApi } from './api';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { WriteLog } from './after-write';
import { formatMinor, formatRate, rupeesToMinor } from './money';
import { farmToday } from './today';
import type { Dispatch, PaymentMethod, Statement, StatementMonth } from './types';

@Component({
  selector: 'app-destination-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChipGroup, RouterLink, SessionRequired],
  template: `
    <div class="mx-auto max-w-4xl space-y-6">
      <a routerLink="/milk/buyers" class="text-sm text-farm-600 underline">← all buyers</a>

      @if (loadError(); as e) {
        <p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" data-role="load-error">{{ e }}</p>
      } @else if (statement(); as s) {
        <header class="flex flex-wrap items-baseline justify-between gap-3">
          <h2 class="text-lg font-semibold text-farm-900" data-role="name">{{ s.name }}</h2>
          <div class="text-right">
            <div class="text-xs uppercase tracking-wide text-farm-600">
              {{ s.balance_minor < 0 ? 'In credit' : 'Owes' }}
            </div>
            <div class="text-xl font-semibold"
              [class]="s.balance_minor > 0 ? 'text-farm-900' : 'text-green-800'"
              data-role="balance">{{ balanceText(s) }}</div>
          </div>
        </header>

        <p class="text-sm text-farm-600" data-role="totals">
          {{ s.litres }} L over {{ s.months.length }} month(s) · billed {{ money(s.billed_minor) }}
          · paid {{ money(s.paid_minor) }}
        </p>

        @if (s.months.length === 0) {
          <p class="rounded-xl border border-farm-300 bg-white p-4 text-sm text-farm-600"
            data-role="empty">Nothing recorded for {{ s.name }} yet.</p>
        }

        @for (m of s.months; track m.month) {
          <section class="overflow-hidden rounded-xl border border-farm-300 bg-white"
            [attr.data-month]="m.month">
            <!-- THE ARTIFACT: one line per month. -->
            <div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-farm-200 bg-farm-50 px-4 py-2 text-sm">
              <span class="font-semibold text-farm-900">{{ monthLabel(m.month) }}</span>
              <span class="text-farm-700" [attr.data-role]="'summary-' + m.month">
                {{ m.litres }} L · billed {{ money(m.billed_minor) }} · paid {{ money(m.paid_minor) }}
                ·
                <span class="font-medium text-farm-900">
                  {{ m.closing_minor === 0 ? 'settled' : money(m.closing_minor) + ' carried forward' }}
                </span>
              </span>
            </div>

            <!-- THE EVIDENCE: the rows underneath it. -->
            <table class="w-full text-left text-sm">
              <tbody>
                @for (d of m.dispatches; track d.id) {
                  <tr class="border-t border-farm-100" [attr.data-dispatch]="d.id">
                    <td class="px-4 py-1.5 text-farm-700">{{ d.occurred_on }} {{ d.session }}</td>
                    <td class="px-4 py-1.5 text-farm-700">
                      {{ d.status === 'taken' ? d.litres + ' L' : 'nothing taken' }}
                      @if (d.reason) { <span class="text-farm-500">— {{ d.reason }}</span> }
                    </td>
                    <td class="px-4 py-1.5 text-xs text-farm-600" [attr.data-role]="'rate-' + d.id">
                      {{ rateText(d) }}
                    </td>
                    <td class="px-4 py-1.5 text-right text-farm-800">{{ amountText(d) }}</td>
                  </tr>
                }
                @for (p of m.payments; track p.id) {
                  <tr class="border-t border-farm-100 bg-green-50/40" [attr.data-payment]="p.id">
                    <td class="px-4 py-1.5 text-farm-700">{{ p.occurred_on }}</td>
                    <td class="px-4 py-1.5 text-farm-700">
                      {{ p.method }}
                      @if (p.reference) { <span class="text-farm-500">· {{ p.reference }}</span> }
                      @if (p.note) { <span class="text-farm-500">— {{ p.note }}</span> }
                    </td>
                    <td></td>
                    <td class="px-4 py-1.5 text-right font-medium text-green-800">
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
          <form class="space-y-3 rounded-xl border border-farm-300 bg-white p-4"
            data-role="payment-form" (submit)="submitPayment($event)">
            <h3 class="text-sm font-semibold text-farm-900">Record a payment</h3>

            <div class="flex flex-wrap items-end gap-3">
              <label class="block">
                <span class="mb-1 block text-xs font-medium text-farm-700">Amount (Rs)</span>
                <input data-role="pay-amount" inputmode="decimal" [value]="amount()"
                  (input)="amount.set($any($event.target).value)"
                  class="w-32 rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs font-medium text-farm-700">On</span>
                <input type="date" data-role="pay-on" [value]="occurredOn()"
                  (change)="occurredOn.set($any($event.target).value)"
                  class="rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
              </label>
              <div>
                <div class="mb-1 text-xs font-medium text-farm-700">How</div>
                <app-chip-group name="method" label="Method" [options]="methodChips"
                  [value]="method()" (changed)="method.set($any($event))" />
              </div>
            </div>

            <label class="block">
              <span class="mb-1 block text-xs font-medium text-farm-700">
                Reference {{ method() === 'adjustment' ? '' : '(optional)' }}
              </span>
              <input data-role="pay-reference" [value]="reference()"
                (input)="reference.set($any($event.target).value)"
                placeholder="cheque no., transfer ref, khata page"
                class="w-72 rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
            </label>

            @if (method() === 'adjustment') {
              <!-- An adjustment is a DECISION somebody made rather than money
                   that changed hands, so the note is required and the sign is
                   allowed. A signed number with no sentence attached cannot be
                   audited a month later. -->
              <label class="block">
                <span class="mb-1 block text-xs font-medium text-farm-700">Why (required)</span>
                <input data-role="pay-note" [value]="note()"
                  (input)="note.set($any($event.target).value)"
                  placeholder="written off, agreed at settlement…"
                  class="w-full rounded-lg border border-farm-300 px-2 py-1.5 text-sm" />
              </label>
              <div class="flex items-center gap-2 text-xs text-farm-700">
                <label class="flex items-center gap-1">
                  <input type="checkbox" data-role="pay-negative" [checked]="negative()"
                    (change)="negative.set($any($event.target).checked)" />
                  reduces what they owe
                </label>
                <span class="text-farm-500">
                  — only an adjustment may be signed; cash and bank are money that arrived.
                </span>
              </div>
            }

            @if (payState.formError(payFields); as e) {
              <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-role="pay-error">{{ e }}</p>
            }

            @if (session.ready()) {
              <button type="submit" data-role="pay-submit" [disabled]="!canPay()"
                class="rounded-xl bg-farm-600 px-4 py-2 text-sm font-medium text-white disabled:bg-farm-300"
              >{{ payState.submitting() ? 'Saving…' : 'Record payment' }}</button>
            } @else {
              <app-session-required what="a payment" />
            }
          </form>
        }

        <!-- price history ---------------------------------------------- -->
        @if (s.prices.length > 0) {
          <section class="rounded-xl border border-farm-300 bg-white p-4" data-role="price-history">
            <h3 class="mb-2 text-sm font-semibold text-farm-900">Agreed rates</h3>
            <ul class="space-y-1 text-sm text-farm-700">
              @for (p of s.prices; track p.id) {
                <li>
                  from {{ p.effective_from }} —
                  <span class="font-medium">{{ rate(p.price_minor, p.price_unit_litres) }}</span>
                  @if (p.note) { <span class="text-farm-500">· {{ p.note }}</span> }
                </li>
              }
            </ul>
          </section>
        }
      } @else {
        <p class="text-sm text-farm-600" data-role="loading">Loading…</p>
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
    if (d.price_minor === null || d.price_unit_litres === null) return '';
    return formatRate(d.price_minor, d.price_unit_litres);
  }

  protected amountText(d: Dispatch): string {
    if (d.status !== 'taken' || d.price_minor === null || d.price_unit_litres === null) return '—';
    return formatMinor(Math.round((d.litres! * d.price_minor) / d.price_unit_litres));
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
