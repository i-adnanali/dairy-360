import { ScrollRegion } from "../../ui/scroll-region";
import { writerDraft } from "../writer-draft";
import { WriteLock } from "../write-lock";
import { pagedList } from "../paged-list";
import { Pagination } from "../../ui/pagination/pagination";
import { RowLink } from "../../ui/navigation";
import { StatusBadge } from "../../ui/surface";
// `/buyers` -- destinations, and what they pay (docs/records/REGISTRY_SALES.md §12.2).
//
// ---------------------------------------------------------------------------
// THE PRICE CONTROL TAKES THE RATE IN THE FARM'S UNIT
// ---------------------------------------------------------------------------
// Two inputs side by side, reading "Rs [7000] per [40] litres", with the
// derived per-litre rate shown back underneath as a check the operator can read
// but not type. That is the same parse-then-show-back contract as
// PrecisionDateControl, for the same reason: the operator enters what they
// know, the system shows what it understood, and the difference between the two
// is where a factor-of-forty slip becomes visible instead of silent.
//
// A per-litre-only field would make an operator who thinks in 40-litre lots
// divide by forty every time, and a slip between 17.50 and 175.00 would be
// invisible on a form that expects per-litre anyway.
//
// ---------------------------------------------------------------------------
// NO BATCH PRICE CHANGE, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE
// ---------------------------------------------------------------------------
// The design called for one, justified as "five forms and four chances to miss
// one" -- written before the farm was counted. The farm has one dodhi and two
// households, and the wholesale and retail rates do not move together, so a
// batch screen would mostly be used to change one row. Build it if the list
// grows past about six.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChipGroup } from "../chip-group/chip-group";
import { Cell } from "../../ui/cell";
import { Certainty } from "../../ui/certainty";
import { NO_RECORD } from "../precision-display";
import { FormState } from "../form-state";
import { RegistryApi } from "../api";
import { Session } from "../session";
import { SessionRequired } from "../session-required/session-required";
import { WriteLog } from "../after-write";
import { formatMinor, formatRate, minorToRupees, perLitreLabel, rupeesToMinor } from "../money";
import { farmToday } from "../today";
import type { DestinationKind, DestinationListRow } from "../types";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { FieldLabel } from "../../ui/text";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { PageHeading } from "../../ui/heading";
import { RowDivider } from "../../ui/surface";
import { SectionHeading } from "../../ui/heading";
import { TextLink } from "../../ui/text";
import { Button } from "../../ui/button";

@Component({
  selector: 'app-destinations-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollRegion,
    WriteLock,
    Pagination,
    RowLink,
    StatusBadge,
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
    SessionRequired,
    TextInput,
    TextLink,
  ],
  templateUrl: './destinations-list.html',
  styleUrl: './destinations-list.css',
})
export class DestinationsList {
  protected closeInline() {
    return this.priceDraft.transition(() => this.pricing.set(null));
  }

  protected addDraft!: ReturnType<typeof writerDraft>;
  protected priceDraft!: ReturnType<typeof writerDraft>;
  protected readonly paging = pagedList<DestinationListRow>('destinations');
  private readonly api = inject(RegistryApi);
  protected readonly session = inject(Session);
  private readonly writeLog = inject(WriteLog);


  protected readonly addFields = ['name', 'kind', 'standing', 'started_on', 'billable'] as const;
  protected readonly priceFields = ['price_minor', 'price_unit_litres', 'effective_from'] as const;
  protected readonly addState = new FormState<DestinationListRow>();
  protected readonly priceState = new FormState<unknown>();

  protected readonly name = signal('');
  protected readonly kind = signal<DestinationKind>('dodhi');
  protected readonly standing = signal<'yes' | 'no'>('yes');
  protected readonly startedOn = signal(farmToday());

  protected readonly pricing = signal<DestinationListRow | null>(null);
  protected readonly priceAmount = signal('');
  protected readonly priceUnit = signal('40');
  protected readonly priceFrom = signal(farmToday());

  protected readonly kindChips = [
    { value: 'dodhi', label: 'Dodhi' },
    { value: 'household', label: 'Household' },
    { value: 'shop', label: 'Shop' },
    { value: 'home', label: 'Home (kept)' },
    { value: 'other', label: 'Other' },
  ];
  protected readonly standingChips = [
    { value: 'yes', label: 'Every session' },
    { value: 'no', label: 'Only when they come' },
  ];

  constructor() {
    this.addDraft = writerDraft({
      name: 'New destination',
      fields: {
        name: this.name,
        kind: this.kind,
        standing: this.standing,
        startedOn: this.startedOn,
      },
      states: [this.addState],
    });

    this.priceDraft = writerDraft({
      name: 'Buyer rate',
      fields: {
        priceAmount: this.priceAmount,
        priceUnit: this.priceUnit,
        priceFrom: this.priceFrom,
      },
      states: [this.priceState],
    });

    void this.load();
  }

  private async load(): Promise<void> {
    this.paging.refresh();
  }

  /**
   * Both no-record branches are UNREACHABLE: the only call sites sit inside
   * `@else if (d.price)`. Left as type-level fallbacks and moved onto §6's en
   * dash so that if either ever does render, it renders the right glyph.
   */
  protected rate(d: DestinationListRow): string {
    return d.price ? formatRate(d.price.price_minor, d.price.price_unit_litres) : NO_RECORD;
  }

  protected perLitre(d: DestinationListRow): string {
    return d.price ? perLitreLabel(d.price.price_minor, d.price.price_unit_litres) : NO_RECORD;
  }

  protected setKind(k: DestinationKind): void {
    this.kind.set(k);
    // Home is always on every sheet: it is the row whose whole purpose is to
    // stop kept milk being forgotten, and an optional one would be forgotten.
    if (k === 'home') this.standing.set('yes');
  }

  protected readonly canAdd = computed(
    () =>
      !this.addState.submitting() && this.name().trim().length > 0 && this.startedOn().length > 0,
  );

  protected async openPrice(d: DestinationListRow): Promise<void> {
    await this.priceDraft.transition(() => {
      this.pricing.set(d);
      // Pre-filled from the CURRENT agreement, not blank: a rate change is
      // usually an edit to a number the operator already knows, and re-typing the
      // lot size every time is where 40 becomes 4.
      this.priceAmount.set(d.price ? minorToRupees(d.price.price_minor) : '');
      this.priceUnit.set(d.price ? String(d.price.price_unit_litres) : '40');
      this.priceFrom.set(farmToday());
    });
  }

  /**
   * What the form understood, or null while it is incomplete.
   *
   * Returning null rather than a partial guess is the point: the preview line
   * is what stands between a mistyped lot size and a rate agreed at forty times
   * the intended price.
   */
  protected readonly pricePreview = computed(() => {
    const minor = rupeesToMinor(this.priceAmount());
    const unit = Number(this.priceUnit().trim());
    if (minor === null || !Number.isFinite(unit) || unit <= 0) return null;
    if (this.priceFrom().length === 0) return null;
    return {
      minor,
      unit,
      rate: formatRate(minor, unit),
      perLitre: perLitreLabel(minor, unit),
    };
  });

  protected async submitPrice(e: Event): Promise<void> {
    e.preventDefault();
    const d = this.pricing();
    const p = this.pricePreview();
    // `submitting()` is re-checked HERE and not only on the button, because the
    // button no longer carries the native `disabled` attribute -- it carries
    // `aria-disabled`, so the browser has stopped suppressing the second click
    // for us. Every other write handler in the registry already re-checked its
    // own precondition; this was the one that only checked half of the button's.
    // The idempotency key survives an in-flight attempt, so a double submit was
    // a replay rather than a duplicate rate -- but it was still a second
    // request nobody asked for.
    if (!d || !p || this.priceState.submitting()) return;

    const ok = await this.priceState.runRequest(
      () =>
        [
          d.id,
          {
            effective_from: this.priceFrom(),
            price_minor: p.minor,
            price_unit_litres: p.unit,
            recorded_by: this.session.provenance().recorded_by,
          },
        ] as const,
      (request, key) => this.api.setPrice(request[0], request[1], key),
    );
    if (ok) {
      this.writeLog.announce(`${d.name}: ${p.rate} from ${this.priceFrom()}`);
      this.pricing.set(null);
      this.priceDraft.accept();
      await this.load();
    }
  }

  protected async submitDestination(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.canAdd()) return;

    const kind = this.kind();
    const result = await this.addState.runRequest(
      () =>
        [
          {
            name: this.name().trim(),
            kind,
            standing: this.standing() === 'yes',
            started_on: this.startedOn(),
            // Explicit rather than omitted, so the server never has to infer it.
            billable: kind !== 'home',
            recorded_by: this.session.provenance().recorded_by,
          },
        ] as const,
      (request, key) => this.api.addDestination(request[0], key),
    );
    if (result) {
      this.writeLog.announce(
        `${result.name} added` +
          (result.billable
            ? ' — agree a rate before their first sale'
            : ' — kept milk, never billed'),
      );
      this.name.set('');
      this.addDraft.accept();
      await this.load();
    }
  }

  protected readonly formatMinor = formatMinor;
}
