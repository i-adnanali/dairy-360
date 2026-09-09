import { ShellActions } from './navigation';
// The verification read: invariants, precision histogram, calving intervals.
//
// ---------------------------------------------------------------------------
// READ-ONLY, AND NOTHING BRANCHES ON IT
// ---------------------------------------------------------------------------
// Two conditions this view is built under, both deliberate:
//
//   1. NO VIEW BRANCHES ON IT. No other component reads this data, nothing is
//      hidden or enabled by it, no form consults it before submitting. It is a
//      window, not a gate -- the moment something depends on it, it stops being
//      a diagnostic and becomes load-bearing, and then a wrong number here
//      breaks entry instead of informing it.
//
//   2. VISIBLY DIAGNOSTIC, NOT DECORATIVE. Numbers to read, not a badge that
//      turns green. A green tick invites you to glance at the colour and stop
//      looking, which is how a check you do not read becomes a check that is
//      not a check. So: counts, a histogram you have to interpret, and
//      violations printed in full with their invariant numbers.
//
// It exists because the alternative was switching to a terminal mid-entry to
// read the histogram, which nobody keeps doing past animal five.

import {
  ChangeDetectionStrategy,
  Component,
  effect,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RegistryApi } from './api';
import { urlParams } from './url-state';
import { formatMinor, formatRate } from './money';
import { farmToday } from './today';
import type { Reconciliation, Verification } from './types';
import { Certainty } from '../ui/certainty';
import { NO_RECORD } from './precision-display';
import { Cell } from '../ui/cell';
import { Card } from '../ui/surface';
import { ErrorPanel } from '../ui/surface';
import { HelpText } from '../ui/text';
import { PageHeading } from '../ui/heading';
import { RowDivider } from '../ui/surface';
import { SectionHeading } from '../ui/heading';
import { SectionLabel } from '../ui/text';
import { SubHeading } from '../ui/heading';

@Component({
  selector: 'app-verification-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Card,
    Cell,
    Certainty,
    ErrorPanel,
    HelpText,
    PageHeading,
    RowDivider,
    SectionHeading,
    SectionLabel,
    SubHeading,
  ],
  template: `
    <div class="mx-auto max-w-3xl space-y-5">
      <header>
        <h2 appPageHeading>Check the records</h2>
        <p appHelp class="mt-1">
          Read these; they are not assertions. Nothing in the rest of the app changes based on what
          is here.
        </p>
      </header>

      @if (!actions.inShell()) {
        <button
          type="button"
          data-role="refresh"
          (click)="load()"
          class="rounded-xl border border-line bg-surface-raised px-4 py-2 text-sm font-medium text-content-heading"
        >
          Recheck
        </button>
      }
      @if (loadError(); as e) {
        <p appErrorPanel size="lg" data-role="load-error">{{ e }}</p>
      } @else if (v(); as data) {
        <section appCard>
          <h3 appSubHeading>Invariants</h3>
          @if (data.violations.length === 0) {
            <p class="mt-2 text-sm text-content-secondary" data-role="violations-none">
              No violations across {{ data.counts.animals }} animal(s),
              {{ data.counts.events }} event(s), {{ data.counts.lactations }} lactation(s), as of
              {{ data.as_of }}.
              @if (data.counts.animals === 0) {
                <span class="italic">
                  An empty registry passes every check vacuously — this says nothing yet.</span
                >
              }
            </p>
          } @else {
            <ul class="mt-2 space-y-1" data-role="violations">
              @for (x of data.violations; track x.detail) {
                <li appErrorPanel>
                  <span class="font-mono text-xs">[{{ x.invariant }}] {{ x.name }}</span>
                  <span class="ml-2">{{ x.detail }}</span>
                </li>
              }
            </ul>
          }
        </section>

        <!-- THE LABOUR REPORT, AND IT IS NOT A VIOLATIONS LIST.
             Every line here fires on rows the farm ASKED to be able to write:
             overlapping stints, a settlement paid after somebody left, a figure
             that differs from the agreement because there was leave. So it is
             rendered in amber and headed "worth a look", never in the red the
             invariants use -- a report styled as a defect list is one people
             learn to ignore, which costs more than the four lines are worth.
             See docs/REGISTRY_PAYROLL.md §13. -->
        <section appCard>
          <h3 appSubHeading>People — worth a look</h3>
          @if (data.labour.length === 0) {
            <p class="mt-2 text-sm text-content-secondary" data-role="labour-none">
              Nothing to flag. These are not violations — they are things that are legitimate and
              still worth seeing.
            </p>
          } @else {
            <ul class="mt-2 space-y-1" data-role="labour">
              @for (l of data.labour; track l.detail) {
                <li class="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning-strong">
                  <span class="font-mono text-xs">{{ l.kind }}</span>
                  <span class="ml-2">{{ l.detail }}</span>
                </li>
              }
            </ul>
          }
        </section>

        <section appCard>
          <h3 appSubHeading>How the dates were known</h3>
          <p appHelp size="xs" class="mt-1">
            Source against precision. Nothing can detect a date that is more precise than the memory
            behind it — this is the number that shows it. A backfill coming out mostly exact-day
            recall is the signal worth acting on.
          </p>
          @if (data.histogram.length === 0) {
            <p class="mt-2 text-sm italic text-content-subtle" data-role="histogram-empty">
              No events yet.
            </p>
          } @else {
            <table class="mt-2 w-full text-left text-sm" data-role="histogram">
              <thead class="text-xs uppercase tracking-wide text-content-muted">
                <tr>
                  <th appCell>Source</th>
                  <th appCell>Precision</th>
                  <th appCell numeric>Events</th>
                </tr>
              </thead>
              <tbody>
                @for (c of data.histogram; track c.source_form + c.date_precision) {
                  <tr appRowDivider>
                    <td appCell tone="heading">{{ c.source_form }}</td>
                    <!-- THE ONE COLUMN IN THE APP WHOSE VALUES ARE THE
                         VOCABULARY'S OWN WORDS. "day" is a known date and
                         "month"/"year"/"estimated" are approximate ones, so the
                         word is set in the state it names. This is where the
                         vocabulary is learnable: a reader who has seen "month"
                         dotted here reads a dotted "2017-03" on /animals
                         without being told. -->
                    <td appCell>
                      <span
                        [appCertainty]="c.date_precision === 'day' ? 'known' : 'approximate'"
                        [attr.data-certainty]="c.date_precision === 'day' ? 'known' : 'approximate'"
                        >{{ c.date_precision }}</span
                      >
                    </td>
                    <td appCell numeric emphasis tone="primary">{{ c.count }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>

        <section appCard>
          <h3 appSubHeading>Calving intervals</h3>
          @if (data.intervals.intervals.length === 0) {
            <p class="mt-2 text-sm italic text-content-subtle" data-role="intervals-empty">
              No animal has two or more calvings yet.
            </p>
          } @else {
            <table class="mt-2 w-full text-left text-sm" data-role="intervals">
              <thead class="text-xs uppercase tracking-wide text-content-muted">
                <tr>
                  <th appCell>Animal</th>
                  <th appCell>From</th>
                  <th appCell>To</th>
                  <th appCell numeric>Days</th>
                  <th appCell>Quality</th>
                </tr>
              </thead>
              <tbody>
                @for (i of data.intervals.intervals; track i.animal_id + i.ordinal) {
                  <tr appRowDivider>
                    <td appCell tone="heading" class="font-mono">{{ i.animal_id }}</td>
                    <td appCell tone="secondary">{{ i.from_on }}</td>
                    <td appCell tone="secondary">{{ i.to_on }}</td>
                    <!-- THE INTERVAL TAKES ITS OWN QUALITY, which is the
                         typographic form of what intervalReport() refuses to do
                         in arithmetic: an interval computed from two approximate
                         calvings is not the same number as one computed from two
                         exact days, and until now they were set identically. -->
                    <td appCell numeric emphasis>
                      <span
                        [appCertainty]="i.quality === 'measured' ? 'known' : 'approximate'"
                        [attr.data-certainty]="i.quality === 'measured' ? 'known' : 'approximate'"
                        >{{ i.days }}</span
                      >
                    </td>
                    <td appCell>
                      <span [appCertainty]="i.quality === 'measured' ? 'known' : 'approximate'">{{
                        i.quality
                      }}</span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            <!-- The two sets are reported separately and never blended. -->
            <div class="mt-3 grid gap-2 sm:grid-cols-2" data-role="summaries">
              @for (s of [data.intervals.measured, data.intervals.approximate]; track s.quality) {
                <div class="rounded-lg bg-surface-page px-3 py-2 text-sm">
                  <div appSectionLabel>{{ s.quality }}</div>
                  @if (s.count === 0) {
                    <!-- NO RECORD, NOT AN ABSENT ANSWER. Nobody said "there are
                         no approximate intervals"; there simply are none yet, so
                         this is §6's fifth state and it loses the italic it used
                         to carry. It keeps the WORD rather than taking the en
                         dash: §6's dash belongs in a value slot where a figure
                         is expected, and a dash under a heading reads as a
                         rendering fault. §15 rule 1 -- an absence is named. -->
                    <div appCertainty="no-record" data-certainty="no-record">none</div>
                  } @else {
                    <div>
                      <span
                        [appCertainty]="s.quality === 'measured' ? 'known' : 'approximate'"
                        [attr.data-certainty]="s.quality === 'measured' ? 'known' : 'approximate'"
                        >n = {{ s.count }} · mean {{ s.mean_days }}d</span
                      >
                    </div>
                    <div appHelp size="xs">min {{ s.min_days }}d · max {{ s.max_days }}d</div>
                  }
                </div>
              }
            </div>
          }
          <p appHelp size="xs" class="mt-3" data-role="caveat">{{ data.intervals.caveat }}</p>
        </section>

        <section appCard>
          <h3 appSubHeading>How complete the milk record is</h3>
          <p appHelp size="xs" class="mt-1">
            A session is complete when every animal in milk has a row — not when every row carries a
            number. The two are separate on purpose: a session of all “not measured” is a complete
            record and empty data, and one blended percentage would hide exactly that.
          </p>
          @if (data.milking.rows === 0) {
            <p class="mt-2 text-sm italic text-content-subtle" data-role="milking-empty">
              No milking recorded yet.
            </p>
          } @else {
            <div class="mt-2 grid gap-2 sm:grid-cols-3" data-role="milking-summary">
              <div class="rounded-lg bg-surface-page px-3 py-2 text-sm">
                <div appSectionLabel>sessions</div>
                <div class="text-content-primary">
                  {{ data.milking.complete_sessions }} complete of {{ data.milking.sessions }}
                </div>
                <div appHelp size="xs">
                  <span [appCertainty]="data.milking.first_on ? 'known' : 'no-record'">{{
                    data.milking.first_on ?? noRecord
                  }}</span>
                  →
                  <span [appCertainty]="data.milking.last_on ? 'known' : 'no-record'">{{
                    data.milking.last_on ?? noRecord
                  }}</span>
                </div>
              </div>
              <div class="rounded-lg bg-surface-page px-3 py-2 text-sm">
                <div appSectionLabel>measured</div>
                <div class="text-content-primary">{{ data.milking.measured }} row(s)</div>
                <div appHelp size="xs">carry a number</div>
              </div>
              <div class="rounded-lg bg-surface-page px-3 py-2 text-sm">
                <div appSectionLabel>not measured</div>
                <div class="text-content-primary">
                  {{ data.milking.milked_not_measured }} row(s)
                </div>
                <div appHelp size="xs">
                  milked, unweighed · {{ data.milking.not_milked }} not milked
                </div>
              </div>
            </div>

            <table class="mt-3 w-full text-left text-sm" data-role="milking-sessions">
              <thead class="text-xs uppercase tracking-wide text-content-muted">
                <tr>
                  <th appCell>Date</th>
                  <th appCell>Session</th>
                  <th appCell numeric>Recorded</th>
                  <th appCell numeric>In milk</th>
                  <th appCell numeric>Measured</th>
                </tr>
              </thead>
              <tbody>
                @for (s of data.milking.recent; track s.occurred_on + s.session) {
                  <tr appRowDivider>
                    <td appCell tone="secondary">{{ s.occurred_on }}</td>
                    <td appCell tone="secondary">{{ s.session }}</td>
                    <!-- A session with fewer rows than animals in milk has
                         animals nobody answered for, which is §6's fifth state.
                         The colour is unchanged -- this was already amber, and
                         it is one of the nine sites PHASE5_PRECHECK.md's census
                         classifies as amber's PERMITTED first meaning. What
                         changes is that it now says so in the vocabulary
                         instead of in a ternary. -->
                    <td appCell numeric emphasis>
                      <span
                        [appCertainty]="s.recorded >= s.expected ? 'known' : 'unanswered'"
                        [attr.data-certainty]="s.recorded >= s.expected ? 'known' : 'unanswered'"
                        >{{ s.recorded }}</span
                      >
                    </td>
                    <td appCell numeric tone="secondary">{{ s.expected }}</td>
                    <td appCell numeric tone="secondary">{{ s.measured }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
          <p appHelp size="xs" class="mt-3" data-role="milking-caveat">{{ data.milking.caveat }}</p>
        </section>

        <!-- ---------------------------------------------------------------
             Produced against dispatched.

             NOT AN ALERT, and nothing here is styled as one. More milk going
             out than was recorded as produced is what 'milked_not_measured'
             MEANS -- the milk existed, nobody weighed it -- and an alarm that
             fires every day for months is trained away, taking the real signal
             with it. See docs/REGISTRY_SALES.md §11.
             --------------------------------------------------------------- -->
        @if (reconciliation(); as r) {
          <section appCard>
            <h3 appSectionHeading>Where the milk went</h3>
            <p appHelp size="xs" class="mt-1">{{ r.from }} → {{ r.to }}</p>

            @if (r.dispatched_total === 0 && r.produced_measured === 0) {
              <p class="mt-2 text-sm italic text-content-subtle" data-role="reconcile-empty">
                Nothing recorded in this period.
              </p>
            } @else {
              <div class="mt-2 grid gap-2 sm:grid-cols-4" data-role="reconcile-summary">
                <div class="rounded-lg bg-surface-page px-3 py-2 text-sm">
                  <div appSectionLabel>Measured</div>
                  <div class="text-content-primary" data-role="produced">
                    {{ r.produced_measured }} L
                  </div>
                  <div appHelp size="xs">from {{ r.measured_rows }} row(s)</div>
                </div>
                <div class="rounded-lg bg-surface-page px-3 py-2 text-sm">
                  <div appSectionLabel>Sold</div>
                  <div class="text-content-primary" data-role="sold">{{ r.dispatched_sold }} L</div>
                  <div appHelp size="xs">{{ money(r.billed_minor) }}</div>
                </div>
                <div class="rounded-lg bg-surface-page px-3 py-2 text-sm">
                  <div appSectionLabel>Kept at home</div>
                  <div class="text-content-primary" data-role="home">{{ r.dispatched_home }} L</div>
                  <div appHelp size="xs">its own term, not the gap</div>
                </div>
                <div class="rounded-lg bg-surface-page px-3 py-2 text-sm">
                  <div appSectionLabel>Gap</div>
                  <div class="text-content-primary" data-role="gap">{{ r.gap_litres }} L</div>
                  <div appHelp size="xs" data-role="gap-pct">
                    @if (r.gap_pct !== null) {
                      {{ r.gap_pct }}% of measured
                    } @else {
                      <!-- DELIBERATELY ABSENT, not no-record. The server
                           withholds this percentage on purpose and says why in
                           the panel below, so an answer WAS given -- §6's third
                           state, italic and in words, never a dash. -->
                      <span appCertainty="absent" data-certainty="absent">no percentage</span>
                    }
                  </div>
                </div>
              </div>

              <!-- The withheld percentage says WHY rather than showing a dash:
                   a missing number with no explanation reads as a bug. -->
              @if (r.gap_pct_withheld_because; as why) {
                <p
                  class="mt-2 rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning-strong"
                  data-role="gap-withheld"
                >
                  No percentage, on purpose — {{ why }}
                </p>
              }

              <p class="mt-2 text-sm text-content-secondary" data-role="reconcile-sessions">
                {{ r.complete_sessions }} of {{ r.sessions }} dispatch session(s) had every standing
                destination answered.
              </p>

              @if (r.incomplete.length > 0) {
                <table class="mt-2 w-full text-left text-sm" data-role="reconcile-incomplete">
                  <thead class="text-xs uppercase tracking-wide text-content-muted">
                    <tr>
                      <th appCell>Session</th>
                      <th appCell numeric>Answered</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (s of r.incomplete; track s.occurred_on + s.session) {
                      <tr appRowDivider>
                        <td appCell tone="secondary">{{ s.occurred_on }} {{ s.session }}</td>
                        <td appCell numeric tone="secondary">
                          {{ s.recorded_standing }} of {{ s.expected_standing }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }

              <!-- A LIST TO READ, never a violation: a deliberate discount and
                   a stale default look identical from here. -->
              @if (r.off_schedule.length > 0) {
                <div class="mt-3" data-role="off-schedule">
                  <h4 class="text-xs font-semibold uppercase tracking-wide text-content-secondary">
                    Billed at something other than the agreed rate
                  </h4>
                  <ul class="mt-1 space-y-1 text-sm text-content-secondary">
                    @for (o of r.off_schedule; track o.dispatch_id) {
                      <li>
                        {{ o.occurred_on }} {{ o.session }} · {{ o.name }} — billed
                        {{ rate(o.captured_minor, o.captured_unit_litres) }}, agreed
                        {{ rate(o.agreed_minor, o.agreed_unit_litres) }}
                      </li>
                    }
                  </ul>
                  <p appHelp size="xs" class="mt-1">
                    Not necessarily wrong — a one-off discount looks exactly like a stale default.
                  </p>
                </div>
              }
            }

            <p appHelp size="xs" class="mt-3" data-role="reconcile-interpretation">
              {{ r.interpretation }}
            </p>
          </section>
        }
      } @else {
        <p appHelp data-role="loading">Loading…</p>
      }
    </div>
  `,
})
export class VerificationPanel {
  /** §6's no-record glyph, for the template. An en dash. */
  protected readonly noRecord = NO_RECORD;

  private readonly api = inject(RegistryApi);

  protected readonly v = signal<Verification | null>(null);
  protected readonly reconciliation = signal<Reconciliation | null>(null);
  protected readonly loadError = signal<string | null>(null);

  protected readonly actions = inject(ShellActions);
  constructor() {
    effect(() => {
      this.actions.recheck();
      void this.load();
    });
  }

  /**
   * `?as_of=` pins the run to a date. Absent -- the normal case -- means today,
   * and the URL stays bare so a bookmark to /check keeps meaning "now".
   *
   * There is deliberately NO date control for this. /check answers "how does it
   * look", and a date picker would invite treating it as a history browser,
   * which it is not. The parameter exists so a violation can be reproduced from
   * a link somebody sent.
   */
  private readonly url = urlParams({ as_of: '' });
  protected readonly asOf = computed(() => this.url.value().as_of || undefined);

  protected async load(): Promise<void> {
    try {
      this.v.set(await this.api.verification(this.asOf()));
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
    // Loaded SEPARATELY and failing quietly: the reconciliation is a diagnostic
    // over a different set of tables, and a farm that has not started recording
    // sales must still be able to read its herd verification. One failing
    // section must not take the page with it.
    try {
      this.reconciliation.set(await this.api.reconcile(this.rangeStart(), farmToday()));
    } catch {
      this.reconciliation.set(null);
    }
  }

  /** The trailing window the gap is reported over. */
  private rangeStart(): string {
    const [y, m, d] = farmToday().split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - RECONCILE_DAYS + 1)).toISOString().slice(0, 10);
  }

  protected money(minor: number): string {
    return formatMinor(minor);
  }

  protected rate(minor: number, unit: number): string {
    return formatRate(minor, unit);
  }
}

/** Trailing days the /check reconciliation covers. A diagnostic window. */
const RECONCILE_DAYS = 30;
