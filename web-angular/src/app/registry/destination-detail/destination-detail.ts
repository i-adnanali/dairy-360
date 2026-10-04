import { DestroyRef } from '@angular/core';
import { ScrollRegion } from "../../ui/scroll-region";
import { effect } from '@angular/core';
import { writerDraft } from "../writer-draft";
import { WriteLock } from "../write-lock";
import { LocalPagination } from "../../ui/local-pagination/local-pagination";
// `/buyers/:id` -- the statement (docs/records/REGISTRY_SALES.md §12.3).
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

import { ChipGroup } from "../chip-group/chip-group";
import { Cell } from "../../ui/cell";
import { Certainty } from "../../ui/certainty";
import type { CertaintyState } from "../../ui/certainty";
import { NO_RECORD } from "../precision-display";
import { FormState } from "../form-state";
import { RegistryApi } from "../api";
import { Session } from "../session";
import { SessionRequired } from "../session-required/session-required";
import { WriteLog } from "../after-write";
import { formatMinor, formatRate, rupeesToMinor } from "../money";
import { farmToday } from "../today";
import type { Dispatch, PaymentMethod, Statement, StatementMonth } from "../types";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { FieldLabel } from "../../ui/text";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { PageHeading } from "../../ui/heading";
import { RowDivider } from "../../ui/surface";
import { SectionHeading } from "../../ui/heading";
import { SectionLabel } from "../../ui/text";
import { Button } from "../../ui/button";

@Component({
  selector: 'app-destination-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ScrollRegion,
    WriteLock,
    LocalPagination,
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
  templateUrl: './destination-detail.html',
  styleUrl: './destination-detail.css',
})
export class DestinationDetail {
  protected writer!: ReturnType<typeof writerDraft>;
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
    inject(DestroyRef).onDestroy(() => ++this.loadSequence);
    this.writer = writerDraft({
      name: 'Buyer payment',
      fields: {
        amount: this.amount,
        occurredOn: this.occurredOn,
        method: this.method,
        reference: this.reference,
        note: this.note,
        negative: this.negative,
      },
      states: [this.payState],
    });

    // An effect rather than ngOnInit, so navigating between two buyers reloads.
    effect(() => {
      this.id();
      void this.load();
    });
  }

  private loadSequence = 0;
  private loadedId: string | null = null;

  private async load(id = this.id()): Promise<void> {
    const sequence = ++this.loadSequence;
    if (this.loadedId !== id) {
      this.statement.set(null);

    }
    this.loadedId = null;
    this.loadError.set(null);
    try {
      const statement = await this.api.statement(id);
      if (sequence !== this.loadSequence || id !== this.id()) return;
      this.loadedId = id;
      this.statement.set(statement);
    } catch (e) {
      if (sequence !== this.loadSequence || id !== this.id()) return;
      this.statement.set(null);
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }


  protected unpriced(s: Statement): number {
    return s.months.reduce(
      (count, month) =>
        count +
        month.dispatches.filter(
          (d) => d.status === 'taken' && (d.price_minor === null || d.price_unit_litres === null),
        ).length,
      0,
    );
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
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    return `${names[m - 1]} ${y}`;
  }

  protected readonly canPay = computed(() => {
    if (!(this.statement()?.destination_id === this.id()) || this.payState.submitting()) return false;
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
      this.method() === 'adjustment' && !this.negative() ? -Math.abs(minor) : Math.abs(minor);

    const result = await this.payState.runRequest(
      () =>
        [
          {
            destination_id: this.statement()!.destination_id,
            occurred_on: this.occurredOn(),
            amount_minor: signed,
            method: this.method(),
            reference: this.reference().trim().length > 0 ? this.reference().trim() : null,
            note: this.note().trim().length > 0 ? this.note().trim() : null,
            recorded_by: this.session.provenance().recorded_by,
          },
        ] as const,
      (request, key) => this.api.recordPayment(request[0], key),
    );

    if (result) {
      this.writeLog.announce(`${formatMinor(result.amount_minor)} recorded (${this.method()})`);
      this.amount.set('');
      this.reference.set('');
      this.note.set('');
      this.writer.accept();
      await this.load();
    }
  }
}
