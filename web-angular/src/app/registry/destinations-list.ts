import { RowLink } from '../ui/navigation';
import { StatusBadge } from '../ui/surface';
// `/buyers` -- destinations, and what they pay (docs/REGISTRY_SALES.md §12.2).
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

import { ChipGroup } from './chip-group';
import { Cell } from '../ui/cell';
import { Certainty } from '../ui/certainty';
import { NO_RECORD } from './precision-display';
import { FormState } from './form-state';
import { RegistryApi } from './api';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { WriteLog } from './after-write';
import { formatMinor, formatRate, minorToRupees, perLitreLabel, rupeesToMinor } from './money';
import { farmToday } from './today';
import type { DestinationKind, DestinationListRow } from './types';
import { Card } from '../ui/surface';
import { ErrorPanel } from '../ui/surface';
import { FieldLabel } from '../ui/text';
import { HelpText } from '../ui/text';
import { TextInput } from '../ui/input';
import { PageHeading } from '../ui/heading';
import { RowDivider } from '../ui/surface';
import { SectionHeading } from '../ui/heading';
import { TextLink } from '../ui/text';
import { Button } from '../ui/button';

@Component({
  selector: 'app-destinations-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
  template: `
    <div class="mx-auto max-w-4xl space-y-6">
      <header>
        <h2 appPageHeading>Buyers</h2>
        <p appHelp class="mt-1">
          Everyone milk goes to, and what they pay for it. The house is here too — milk kept at home
          is a disposition, not a sale, so it has no price and never appears in a balance.
        </p>
      </header>

      @if (loadError(); as e) {
        <p appErrorPanel size="lg" data-role="load-error">{{ e }}</p>
      }

      @if (rows(); as list) {
        @if (list.length === 0) {
          <p appCard empty data-role="empty">
            No destinations yet. Add the dodhi, the neighbours who buy, and
            <strong>the house</strong> — without a home row, milk kept for the family disappears
            into the reconciliation gap instead of being recorded.
          </p>
        } @else {
          <div class="overflow-hidden rounded-xl border border-line bg-surface-raised">
            <table class="w-full text-left text-sm">
              <thead
                class="border-b border-line-subtle text-xs uppercase tracking-wide text-content-muted"
              >
                <tr>
                  <th appCell>Name</th>
                  <th appCell>Kind</th>
                  <th appCell>On every sheet</th>
                  <th appCell>Rate today</th>
                  <th appCell></th>
                </tr>
              </thead>
              <tbody>
                @for (d of list; track d.id) {
                  <tr
                    appRowDivider
                    [appRowLink]="d.billable ? '/milk/buyers/' + d.id : null"
                    [attr.data-row]="d.id"
                    [class.opacity-50]="!d.active"
                  >
                    <td appCell>
                      @if (d.billable) {
                        <a
                          [routerLink]="['/milk/buyers', d.id]"
                          appTextLink
                          tone="strong"
                          [attr.data-role]="'open-' + d.id"
                          >{{ d.name }}</a
                        >
                      } @else {
                        <span class="text-content-heading">{{ d.name }}</span>
                      }
                      @if (!d.active) {
                        <span appBadge tone="ended" class="ml-2" data-role="closed">
                          stopped {{ d.ended_on }}
                        </span>
                      }
                    </td>
                    <td appCell tone="secondary">{{ d.kind }}</td>
                    <td appCell tone="secondary" [attr.data-role]="'standing-' + d.id">
                      {{ d.standing ? 'yes — must be answered' : 'only when they come' }}
                    </td>
                    <td appCell tone="secondary" [attr.data-role]="'rate-' + d.id">
                      <!-- Three of §6's states in one cell, and the third one
                           KEEPS ITS AMBER rather than being quietened into the
                           no-record grey. A billable destination with no agreed
                           rate is milk leaving the farm for a price nobody has
                           written down: that is "still required", not "nothing
                           was ever entered", and there is a "change rate" button
                           on the same row to act on it. It was already amber, so
                           the census gains nothing here -- it is simply
                           classified now instead of being a bare utility. -->
                      @if (!d.billable) {
                        <span appCertainty="absent" data-certainty="absent">not billed</span>
                      } @else if (d.price) {
                        {{ rate(d) }}
                        <span class="ml-1 text-xs text-content-subtle">({{ perLitre(d) }})</span>
                      } @else {
                        <span appCertainty="unanswered" data-certainty="unanswered"
                          >no price agreed</span
                        >
                      }
                    </td>
                    <td appCell numeric>
                      @if (d.billable) {
                        <button
                          type="button"
                          [attr.data-role]="'price-' + d.id"
                          (click)="openPrice(d)"
                          class="rounded-lg border border-line px-2 py-1 text-xs text-content-secondary hover:border-line-strong"
                        >
                          change rate
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      } @else if (!loadError()) {
        <p appHelp data-role="loading">Loading…</p>
      }

      <!-- change a rate ------------------------------------------------- -->
      @if (pricing(); as d) {
        <form appCard class="space-y-3" data-role="price-form" (submit)="submitPrice($event)">
          <h3 appSectionHeading>Rate for {{ d.name }}</h3>

          <div class="flex flex-wrap items-end gap-3">
            <label class="block">
              <span appFieldLabel>Amount (Rs)</span>
              <input
                data-role="price-amount"
                inputmode="decimal"
                [value]="priceAmount()"
                (input)="priceAmount.set($any($event.target).value)"
                appInput
                class="w-32"
              />
            </label>
            <span class="pb-2 text-sm text-content-muted">per</span>
            <label class="block">
              <span appFieldLabel>Litres</span>
              <input
                data-role="price-unit"
                inputmode="decimal"
                [value]="priceUnit()"
                (input)="priceUnit.set($any($event.target).value)"
                appInput
                class="w-24"
              />
            </label>
            <label class="block">
              <span appFieldLabel>From</span>
              <input
                type="date"
                data-role="price-from"
                [value]="priceFrom()"
                (change)="priceFrom.set($any($event.target).value)"
                appInput
              />
            </label>
          </div>

          <!-- SHOWN BACK, never typed. Where a factor-of-forty slip surfaces. -->
          <p appHelp size="xs" data-role="price-preview">
            @if (pricePreview(); as p) {
              Will be recorded as <strong>{{ p.rate }}</strong> — that is {{ p.perLitre }}.
            } @else {
              Enter an amount and the litres it covers.
            }
          </p>
          <p appHelp size="xs" tone="subtle" data-role="price-note">
            A rate change is a new agreement from that date. Milk already dispatched keeps the rate
            it was billed at — changing this never re-prices what is already recorded.
          </p>

          @if (priceState.formError(priceFields); as e) {
            <p appErrorPanel data-role="price-error">{{ e }}</p>
          }

          <div class="flex gap-2">
            @if (session.ready()) {
              <button
                type="submit"
                data-role="price-submit"
                [appButtonDisabled]="pricePreview() === null || priceState.submitting()"
                appButton
              >
                {{ priceState.submitting() ? 'Saving…' : 'Agree this rate' }}
              </button>
            } @else {
              <app-session-required what="a rate" />
            }
            <button
              type="button"
              data-role="price-cancel"
              (click)="pricing.set(null)"
              class="rounded-xl border border-line px-4 py-2 text-sm text-content-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      }

      <!-- add a destination ---------------------------------------------- -->
      <form appCard class="space-y-3" data-role="add-form" (submit)="submitDestination($event)">
        <h3 appSectionHeading>Add a destination</h3>

        <div class="flex flex-wrap items-end gap-3">
          <label class="block">
            <span appFieldLabel>Name</span>
            <input
              data-role="name"
              [value]="name()"
              (input)="name.set($any($event.target).value)"
              appInput
              class="w-56"
            />
          </label>
          <div>
            <div appFieldLabel inline>Kind</div>
            <app-chip-group
              name="kind"
              label="Kind"
              [options]="kindChips"
              [value]="kind()"
              (changed)="setKind($any($event))"
            />
          </div>
          <label class="block">
            <span appFieldLabel>Buying since</span>
            <input
              type="date"
              data-role="started-on"
              [value]="startedOn()"
              (change)="startedOn.set($any($event.target).value)"
              appInput
            />
          </label>
        </div>

        <div>
          <div appFieldLabel inline>On every sheet?</div>
          <app-chip-group
            name="standing"
            label="On every sheet"
            [options]="standingChips"
            [value]="standing()"
            (changed)="standing.set($any($event))"
          />
          <!-- NOT defaulted: it decides whether the sheet demands an answer,
               which is a question about how the farm works rather than a fact
               about the buyer. -->
          <p appHelp size="xs" class="mt-1" data-role="standing-help">
            <strong>Every session</strong> for someone who is always accounted for — the dodhi, the
            house. <strong>Only when they come</strong> for a neighbour who takes surplus: they will
            never be marked absent, so nothing trains anyone to click past the sheet.
          </p>
        </div>

        @if (kind() === 'home') {
          <p
            class="rounded-lg bg-surface-page px-3 py-2 text-xs text-content-secondary"
            data-role="home-note"
          >
            Milk kept at home is never billed and can never carry a price or a payment. Recording it
            is what keeps it out of the unexplained gap.
          </p>
        }

        @if (addState.formError(addFields); as e) {
          <p appErrorPanel data-role="add-error">{{ e }}</p>
        }

        @if (session.ready()) {
          <button type="submit" data-role="add-submit" [appButtonDisabled]="!canAdd()" appButton>
            {{ addState.submitting() ? 'Saving…' : 'Add destination' }}
          </button>
        } @else {
          <app-session-required what="a destination" />
        }
      </form>
    </div>
  `,
})
export class DestinationsList {
  private readonly api = inject(RegistryApi);
  protected readonly session = inject(Session);
  private readonly writeLog = inject(WriteLog);

  protected readonly rows = signal<DestinationListRow[] | null>(null);
  protected readonly loadError = signal<string | null>(null);

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
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.rows.set(await this.api.destinations(farmToday()));
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
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

  protected openPrice(d: DestinationListRow): void {
    this.pricing.set(d);
    // Pre-filled from the CURRENT agreement, not blank: a rate change is
    // usually an edit to a number the operator already knows, and re-typing the
    // lot size every time is where 40 becomes 4.
    this.priceAmount.set(d.price ? minorToRupees(d.price.price_minor) : '');
    this.priceUnit.set(d.price ? String(d.price.price_unit_litres) : '40');
    this.priceFrom.set(farmToday());
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

    const ok = await this.priceState.run((key) =>
      this.api.setPrice(
        d.id,
        {
          effective_from: this.priceFrom(),
          price_minor: p.minor,
          price_unit_litres: p.unit,
          recorded_by: this.session.provenance().recorded_by,
        },
        key,
      ),
    );
    if (ok) {
      this.writeLog.announce(`${d.name}: ${p.rate} from ${this.priceFrom()}`);
      this.pricing.set(null);
      await this.load();
    }
  }

  protected async submitDestination(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.canAdd()) return;

    const kind = this.kind();
    const result = await this.addState.run((key) =>
      this.api.addDestination(
        {
          name: this.name().trim(),
          kind,
          standing: this.standing() === 'yes',
          started_on: this.startedOn(),
          // Explicit rather than omitted, so the server never has to infer it.
          billable: kind !== 'home',
          recorded_by: this.session.provenance().recorded_by,
        },
        key,
      ),
    );
    if (result) {
      this.writeLog.announce(
        `${result.name} added` +
          (result.billable
            ? ' — agree a rate before their first sale'
            : ' — kept milk, never billed'),
      );
      this.name.set('');
      await this.load();
    }
  }

  protected readonly formatMinor = formatMinor;
}
