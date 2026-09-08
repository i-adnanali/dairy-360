// `/people/:id` -- the statement (docs/REGISTRY_PAYROLL.md §12.2).
//
// Stints as a timeline, the package as it stands, wage periods, payments and a
// running balance. This is the screen you show somebody when they ask what they
// are owed, which is why it prints the agreement rather than a conversion of it.
//
// ---------------------------------------------------------------------------
// THE PACKAGE IS SHOWN AS ITS LINES, NEVER AS ONE NUMBER
// ---------------------------------------------------------------------------
// "Rs 25,000 / month, 2 L milk daily, 20 kg flour monthly, quarters" is the
// agreement. A single total would require valuing the in-kind lines, which
// needs a reference price with no transaction behind it -- and the moment such
// a figure exists on screen somebody will treat it as money owed. The rupee
// worth of a package is a report figure, computed and labelled imputed, and it
// is deliberately not here.
//
// ---------------------------------------------------------------------------
// THE PAYMENT FORM LIVES HERE
// ---------------------------------------------------------------------------
// A payment is always TO somebody, and a standalone form would open with a
// dropdown this screen has already answered. Same argument as the buyer
// statement.
//
// An ADJUSTMENT is the one signed kind and must carry a note. It is also the
// only way to record a deduction -- damage, or milk taken above the allowance
// -- because those reduce what the farm owes, which is what the credit side is
// for. The form says so rather than leaving an operator to discover it from a
// refusal.

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChipGroup } from './chip-group';
import { FormState } from './form-state';
import { IdentifierInput } from './identifier-input';
import { RegistryApi } from './api';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { WriteLog } from './after-write';
import { formatMinor, formatPeriodRate, rupeesToMinor } from './money';
import { farmToday } from './today';
import type { Engagement, PaymentMethod, PayBenefit, WageStatement } from './types';
import { Card } from '../ui/surface';
import { ErrorPanel } from '../ui/surface';
import { ErrorText } from '../ui/surface';
import { HelpText } from '../ui/text';
import { TextInput } from '../ui/input';
import { PageHeading } from '../ui/heading';
import { SectionHeading } from '../ui/heading';
import { SubHeading } from '../ui/heading';
import { Button } from '../ui/button';

@Component({
  selector: 'app-person-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    Card,
    ChipGroup,
    ErrorPanel,
    ErrorText,
    HelpText,
    IdentifierInput,
    PageHeading,
    RouterLink,
    SectionHeading,
    SessionRequired,
    SubHeading,
    TextInput,
  ],
  template: `
    <div class="mx-auto max-w-4xl space-y-6">
      <a routerLink="/labour/people" class="text-sm text-content-muted underline">← People</a>

      @if (loadError(); as e) {
        <p appErrorPanel size="lg" data-role="load-error">{{ e }}</p>
      }

      @if (statement(); as s) {
        <header class="space-y-1">
          <h2 appPageHeading>
            {{ s.name ?? s.identifier }}
            <span class="ml-2 font-mono text-sm font-normal text-content-subtle">{{ s.identifier }}</span>
          </h2>
          <p class="text-sm" [class.text-warning-fg]="s.balance_minor < 0" data-role="balance">
            {{ balanceLabel(s) }}
          </p>
        </header>

        <!-- Stints. Overlapping and multiple-open are LEGITIMATE and are
             rendered plainly -- the screen must not mark them as a problem. -->
        <section class="space-y-2" data-role="engagements">
          <h3 appSectionHeading>Stints</h3>
          @if (s.engagements.length === 0) {
            <p appHelp data-role="no-stints">
              On file, but never employed. That is a legitimate row — the vet and whoever sold you
              an animal belong here too.
            </p>
          } @else {
            <ul class="space-y-2">
              @for (e of s.engagements; track e.id) {
                <li class="rounded-xl border border-line-subtle bg-surface-raised p-3 text-sm"
                  [attr.data-engagement]="e.id">
                  <div class="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      <span class="font-medium">{{ e.kind === 'daily' ? 'Dihari' : 'Salaried' }}</span>
                      @if (e.role) { <span class="text-content-muted">· {{ e.role }}</span> }
                    </span>
                    <span appHelp size="xs">
                      {{ e.started_on }} → {{ e.ended_on ?? 'open' }}
                      @if (e.end_reason) { <span class="text-content-subtle">({{ e.end_reason }})</span> }
                    </span>
                  </div>

                  <!-- The package, as its lines. Never as a total. -->
                  <p class="mt-1 text-xs text-content-secondary" [attr.data-role]="'package-' + e.id">
                    {{ packageLabel(e) }}
                  </p>

                  @if (e.ended_on === null) {
                    <button type="button" (click)="openClose(e)"
                      class="mt-2 text-xs text-content-muted underline" data-role="close-stint">
                      Close this stint
                    </button>
                  }
                </li>
              }
            </ul>
          }
        </section>

        @if (closing(); as e) {
          <form appCard class="space-y-3"
            (submit)="submitClose($event)" data-role="close-form">
            <h3 appSectionHeading>Close the stint</h3>
            <p appHelp size="xs" tone="subtle">
              A final settlement dated after this is fine and is not an error — /check reports it
              so it is visible, and nothing refuses it.
            </p>
            <label class="block space-y-1">
              <span appSubHeading>Last day</span>
              <input type="date" name="ended_on" [value]="endedOn()"
                (input)="endedOn.set($any($event.target).value)" appInput density="comfortable" />
              @if (closeState.fieldError('ended_on'); as msg) {
                <span appErrorText size="xs" tone="soft" class="block" data-role="error-ended-on">{{ msg }}</span>
              }
            </label>
            <label class="block space-y-1">
              <span appSubHeading>Why <span class="text-content-subtle">(optional)</span></span>
              <input name="end_reason" [value]="endReason()"
                (input)="endReason.set($any($event.target).value)" appInput density="comfortable" class="w-full" />
            </label>
            @if (closeState.formError(['ended_on', 'end_reason']); as msg) {
              <p appErrorPanel data-role="close-error">{{ msg }}</p>
            }
            <div class="flex gap-2">
              @if (session.ready()) {
                <button type="submit" appButton>
                  {{ closeState.submitting() ? 'Saving…' : 'Close stint' }}
                </button>
              } @else {
                <app-session-required what="the closing date" />
              }
              <button type="button" (click)="closing.set(null)"
                class="rounded-lg px-4 py-2 text-sm text-content-secondary">Cancel</button>
            </div>
          </form>
        }

        <!-- The statement proper, grouped by month. The monthly line is the
             artifact; the rows underneath are the evidence. -->
        <section class="space-y-3" data-role="months">
          <h3 appSectionHeading>Statement</h3>
          @if (s.months.length === 0) {
            <p appHelp data-role="no-months">Nothing recorded yet.</p>
          } @else {
            @for (m of s.months; track m.month) {
              <div class="overflow-hidden rounded-xl border border-line-subtle bg-surface-raised"
                [attr.data-month]="m.month">
                <div class="flex flex-wrap items-baseline justify-between gap-2 bg-surface-sunken px-3 py-2 text-sm">
                  <span class="font-medium text-content-primary">{{ m.month }}</span>
                  <span class="font-mono tabular-nums text-content-secondary">
                    earned {{ formatMinor(m.earned_minor) }} ·
                    paid {{ formatMinor(m.paid_minor) }} ·
                    <span class="font-medium">closing {{ formatMinor(m.closing_minor) }}</span>
                  </span>
                </div>
                <ul class="divide-y divide-divider text-sm">
                  @for (w of m.periods; track w.id) {
                    <li class="flex items-baseline justify-between px-3 py-1.5">
                      <span>
                        {{ w.kind === 'bonus' ? 'Bonus' : 'Wage' }}
                        {{ w.from_on }}@if (w.to_on !== w.from_on) { <span> → {{ w.to_on }}</span> }
                        @if (w.note) { <span appHelp size="xs" tone="subtle">· {{ w.note }}</span> }
                      </span>
                      <span class="font-mono tabular-nums">{{ formatMinor(w.amount_minor) }}</span>
                    </li>
                  }
                  @for (p of m.payments; track p.id) {
                    <li class="flex items-baseline justify-between px-3 py-1.5 text-content-secondary">
                      <span>
                        Paid {{ p.occurred_on }} <span appHelp size="xs" tone="subtle">{{ p.method }}</span>
                        @if (p.reference) { <span appHelp size="xs" tone="subtle">· {{ p.reference }}</span> }
                        @if (p.note) { <span appHelp size="xs" tone="subtle">· {{ p.note }}</span> }
                      </span>
                      <span class="font-mono tabular-nums">− {{ formatMinor(p.amount_minor) }}</span>
                    </li>
                  }
                </ul>
              </div>
            }
          }
        </section>

        <!-- Record a payment. -->
        <form class="space-y-4 rounded-xl border border-line bg-surface-raised p-4"
          (submit)="submitPayment($event)" data-role="payment-form">
          <h3 appSectionHeading>Record a payment</h3>

          <div class="space-y-1">
            <span appSubHeading>Method</span>
            <app-chip-group name="method" [options]="methodChips" [value]="method()"
              (changed)="setMethod($any($event))" />
            @if (method() === 'adjustment') {
              <span class="block text-xs text-content-subtle" data-role="adjustment-hint">
                The only signed kind, and it must say why. This is also how a deduction is
                recorded — damage, or milk taken above the allowance — because those reduce what
                the farm owes. A positive figure reduces the balance.
              </span>
            }
          </div>

          <div class="flex flex-wrap gap-4">
            <label class="space-y-1">
              <span class="block text-sm font-medium text-content-heading">Amount (Rs)</span>
              <input name="amount_minor" type="text" inputmode="decimal" [value]="amount()"
                (input)="amount.set($any($event.target).value)" appInput density="comfortable" class="w-36 text-right font-mono tabular-nums" />
              @if (payState.fieldError('amount_minor'); as msg) {
                <span appErrorText size="xs" tone="soft" class="block" data-role="error-amount">{{ msg }}</span>
              }
            </label>
            <label class="space-y-1">
              <span class="block text-sm font-medium text-content-heading">On</span>
              <input name="occurred_on" type="date" [value]="paidOn()"
                (input)="paidOn.set($any($event.target).value)" appInput density="comfortable" />
            </label>
            <label class="space-y-1">
              <span class="block text-sm font-medium text-content-heading">
                Reference <span class="text-content-subtle">(optional)</span>
              </span>
              <input name="reference" [value]="reference()"
                (input)="reference.set($any($event.target).value)" appInput density="comfortable" placeholder="peshgi" />
            </label>
          </div>

          <label class="block space-y-1">
            <span appSubHeading>
              Note @if (method() === 'adjustment') { <span class="text-danger-soft">(required)</span> }
              @else { <span class="text-content-subtle">(optional)</span> }
            </span>
            <input name="note" [value]="note()" (input)="note.set($any($event.target).value)" appInput density="comfortable" class="w-full" />
            @if (payState.fieldError('note'); as msg) {
              <span appErrorText size="xs" tone="soft" class="block" data-role="error-note">{{ msg }}</span>
            }
          </label>

          <label class="block space-y-1">
            <span appSubHeading>Handed over by</span>
            <app-identifier-input field="observed_by" label="Handed over by" name="observed_by"
              [value]="observedBy()" (changed)="observedBy.set($event)" />
          </label>

          @if (payState.formError(['amount_minor', 'note', 'occurred_on', 'method']); as msg) {
            <p appErrorPanel data-role="payment-error">{{ msg }}</p>
          }

          @if (session.ready()) {
            <button type="submit" [appButtonDisabled]="!canPay()" appButton>
              {{ payState.submitting() ? 'Saving…' : 'Record payment' }}
            </button>
          } @else {
            <app-session-required what="a payment" />
          }
        </form>
      } @else {
        @if (!loadError()) { <p appHelp tone="subtle">Loading…</p> }
      }
    </div>
  `,
})
export class PersonDetail {
  /** Bound from the route by withComponentInputBinding(). */
  readonly id = input.required<string>();

  private readonly api = inject(RegistryApi);
  protected readonly session = inject(Session);
  private readonly writeLog = inject(WriteLog);

  protected readonly statement = signal<WageStatement | null>(null);
  protected readonly loadError = signal<string | null>(null);

  protected readonly closing = signal<Engagement | null>(null);
  protected readonly endedOn = signal(farmToday());
  protected readonly endReason = signal('');
  protected readonly closeState = new FormState<unknown>();

  protected readonly method = signal<PaymentMethod>('cash');
  protected readonly amount = signal('');
  protected readonly paidOn = signal(farmToday());
  protected readonly reference = signal('');
  protected readonly note = signal('');
  protected readonly observedBy = signal('');
  protected readonly payState = new FormState<unknown>();

  protected readonly methodChips = [
    { value: 'cash', label: 'Cash' },
    { value: 'bank', label: 'Bank' },
    { value: 'adjustment', label: 'Adjustment', hint: 'signed, must say why' },
  ];

  protected readonly formatMinor = formatMinor;

  constructor() {
    effect(() => {
      const id = this.id();
      void this.load(id);
    });
  }

  private async load(id: string): Promise<void> {
    try {
      this.statement.set(await this.api.person(id, farmToday()));
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * "In advance" rather than a minus sign, and the same wording as the list.
   *
   * A negative balance is somebody paid ahead. The ledger needs no special case
   * for it; the sentence does, because a minus sign under "owed" reads as a
   * defect rather than a peshgi.
   */
  protected balanceLabel(s: WageStatement): string {
    if (s.balance_minor === 0) return 'Settled — nothing outstanding.';
    if (s.balance_minor < 0) return `${formatMinor(-s.balance_minor)} in advance.`;
    return `${formatMinor(s.balance_minor)} owed.`;
  }

  /** The package as prose. Never totalled -- see the module comment. */
  protected packageLabel(e: Engagement): string {
    const pkg = this.statement()?.packages.find((p) => p.engagement_id === e.id)?.current;
    if (!pkg || pkg.term === null) return 'No package agreed yet.';
    const parts = [formatPeriodRate(pkg.term.cash_minor, pkg.term.cash_period)];
    for (const b of pkg.benefits) parts.push(this.benefitLabel(b));
    return parts.join(' · ');
  }

  private benefitLabel(b: PayBenefit): string {
    if (b.quantity === null) return b.kind === 'other' ? (b.note ?? 'other') : b.kind;
    return `${b.quantity} ${b.unit} ${b.kind} / ${b.period}`;
  }

  protected openClose(e: Engagement): void {
    this.closing.set(e);
    this.endedOn.set(farmToday());
    this.endReason.set('');
    this.closeState.reset();
  }

  protected async submitClose(ev: Event): Promise<void> {
    ev.preventDefault();
    const e = this.closing();
    if (!e) return;
    const ok = await this.closeState.run((key) =>
      this.api.updateEngagement(
        e.id,
        { ended_on: this.endedOn(), end_reason: this.endReason().trim() || null },
        key,
      ),
    );
    if (ok) {
      this.writeLog.announce(`Stint closed ${this.endedOn()}`);
      this.closing.set(null);
      await this.load(this.id());
    }
  }

  protected setMethod(m: PaymentMethod): void {
    this.method.set(m);
  }

  protected readonly canPay = computed(
    () =>
      !this.payState.submitting() &&
      rupeesToMinor(this.amount()) !== null &&
      this.paidOn().length > 0,
  );

  protected async submitPayment(ev: Event): Promise<void> {
    ev.preventDefault();
    const minor = rupeesToMinor(this.amount());
    if (minor === null || !this.canPay()) return;

    const result = await this.payState.run((key) =>
      this.api.recordWagePayment(
        {
          person_id: this.id(),
          occurred_on: this.paidOn(),
          amount_minor: minor,
          method: this.method(),
          reference: this.reference().trim() || null,
          observed_by: this.observedBy().trim() || null,
          note: this.note().trim() || null,
          recorded_by: this.session.provenance().recorded_by,
        },
        key,
      ),
    );
    if (result) {
      this.writeLog.announce(
        `${this.statement()?.identifier ?? 'payment'}: ${formatMinor(minor)} ${this.method()}`,
      );
      this.amount.set('');
      this.note.set('');
      this.reference.set('');
      await this.load(this.id());
    }
  }
}
