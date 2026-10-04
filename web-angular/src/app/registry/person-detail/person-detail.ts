import { DestroyRef } from '@angular/core';
import { writerDraft } from "../writer-draft";
import { WriteLock } from "../write-lock";
import { StatusBadge } from "../../ui/surface";
// `/people/:id` -- the statement (docs/records/REGISTRY_PAYROLL.md §12.2).
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

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChipGroup } from "../chip-group/chip-group";
import { FormState } from "../form-state";
import { IdentifierInput } from "../identifier-input/identifier-input";
import { RegistryApi } from "../api";
import { Session } from "../session";
import { SessionRequired } from "../session-required/session-required";
import { WriteLog } from "../after-write";
import { formatMinor, formatPeriodRate, rupeesToMinor, signedRupeesToMinor } from "../money";
import { farmToday } from "../today";
import type { Engagement, PaymentMethod, PayBenefit, WageStatement } from "../types";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { ErrorText } from "../../ui/surface";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { PageHeading } from "../../ui/heading";
import { SectionHeading } from "../../ui/heading";
import { SubHeading } from "../../ui/heading";
import { Button } from "../../ui/button";

@Component({
  selector: 'app-person-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    WriteLock,
    StatusBadge,
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
  templateUrl: './person-detail.html',
  styleUrl: './person-detail.css',
})
export class PersonDetail {
  protected openStints(s: { engagements: { ended_on: string | null }[] }) { return s.engagements.filter(e => e.ended_on === null).length; }
  protected focusPayment(event: Event) { event.preventDefault(); document.querySelector<HTMLInputElement>('#person-payment input[name="amount_minor"]')?.focus(); }

  protected closeInline() {
    return this.closeDraft.transition(() => this.closing.set(null));
  }

  protected closeDraft!: ReturnType<typeof writerDraft>;
  protected payDraft!: ReturnType<typeof writerDraft>;
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
    inject(DestroyRef).onDestroy(() => ++this.loadSequence);
    this.closeDraft = writerDraft({
      name: 'Close engagement',
      fields: { closing: this.closing, endedOn: this.endedOn, endReason: this.endReason },
      states: [this.closeState],
    });

    this.payDraft = writerDraft({
      name: 'Person payment',
      fields: {
        method: this.method,
        amount: this.amount,
        paidOn: this.paidOn,
        reference: this.reference,
        note: this.note,
        observedBy: this.observedBy,
      },
      states: [this.payState],
    });

    effect(() => {
      const id = this.id();
      void this.load(id);
    });
  }

  private loadSequence = 0;
  private loadedId: string | null = null;

  private async load(id = this.id()): Promise<void> {
    const sequence = ++this.loadSequence;
    if (this.loadedId !== id) {
      this.statement.set(null);
      this.closing.set(null);
    }
    this.loadedId = null;
    this.loadError.set(null);
    try {
      const statement = await this.api.person(id, farmToday());
      if (sequence !== this.loadSequence || id !== this.id()) return;
      this.loadedId = id;
      this.statement.set(statement);
    } catch (e) {
      if (sequence !== this.loadSequence || id !== this.id()) return;
      this.statement.set(null);
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

  protected async openClose(e: Engagement): Promise<void> {
    await this.closeDraft.transition(() => {
      this.closing.set(e);
      this.endedOn.set(farmToday());
      this.endReason.set('');
      this.closeState.reset();
    });
  }

  protected async submitClose(ev: Event): Promise<void> {
    ev.preventDefault();
    const e = this.closing();
    if (!e || !(this.statement()?.person_id === this.id()) || !this.statement()!.engagements.some((entry) => entry.id === e.id)) return;
    const ok = await this.closeState.runRequest(
      () =>
        [e.id, { ended_on: this.endedOn(), end_reason: this.endReason().trim() || null }] as const,
      (request, key) => this.api.updateEngagement(request[0], request[1], key),
    );
    if (ok) {
      this.writeLog.announce(`Stint closed ${this.endedOn()}`);
      this.closing.set(null);
      this.closeDraft.accept();
      await this.load(this.id());
    }
  }

  protected setMethod(m: PaymentMethod): void {
    this.method.set(m);
  }

  private paymentMinor(): number | null {
    return this.method() === 'adjustment' ? signedRupeesToMinor(this.amount()) : rupeesToMinor(this.amount());
  }

  protected readonly canPay = computed(() => {
    const minor = this.paymentMinor();
    return this.statement()?.person_id === this.id() && !this.payState.submitting() &&
      minor !== null && minor !== 0 && this.paidOn().length > 0 &&
      (this.method() !== 'adjustment' || this.note().trim().length > 0);
  });

  protected async submitPayment(ev: Event): Promise<void> {
    ev.preventDefault();
    const minor = this.paymentMinor();
    if (minor === null || !this.canPay()) return;

    const result = await this.payState.runRequest(
      () =>
        [
          {
            person_id: this.statement()!.person_id,
            occurred_on: this.paidOn(),
            amount_minor: minor,
            method: this.method(),
            reference: this.reference().trim() || null,
            observed_by: this.observedBy().trim() || null,
            note: this.note().trim() || null,
            recorded_by: this.session.provenance().recorded_by,
          },
        ] as const,
      (request, key) => this.api.recordWagePayment(request[0], key),
    );
    if (result) {
      this.writeLog.announce(
        `${this.statement()?.identifier ?? 'payment'}: ${formatMinor(minor)} ${this.method()}`,
      );
      this.amount.set('');
      this.note.set('');
      this.reference.set('');
      this.payDraft.accept();
      await this.load(this.id());
    }
  }
}
