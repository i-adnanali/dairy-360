// `/people` -- who works here, and what they are owed
// (docs/REGISTRY_PAYROLL.md §12.2).
//
// ---------------------------------------------------------------------------
// PEOPLE WITH NO OPEN STINT ARE SHOWN, DIMMED -- NOT HIDDEN
// ---------------------------------------------------------------------------
// The buyers list excludes non-billable destinations, because a zero beside
// "Home" would read as "settled" and imply there was something to settle. This
// list diverges deliberately: somebody who has left may still be owed a final
// payment, and hiding them is exactly how it gets forgotten. They are also the
// referent for every historical `observed_by` that names them.
//
// ---------------------------------------------------------------------------
// THE IDENTIFIER IS OFFERED ONCE AND NEVER AGAIN
// ---------------------------------------------------------------------------
// It is the string that also appears in `observed_by` on milkings, dispatches
// and events, matched BY VALUE -- and the event log is append-only, so it can
// never be repointed. The add form asks for it; nothing on this screen or the
// detail screen lets it be edited, and `RegistryApi.updatePerson` does not even
// accept the field. A person entered with the wrong identifier is corrected by
// adding the right one and closing this stint.
//
// ---------------------------------------------------------------------------
// A NEGATIVE BALANCE IS "in advance", NOT A MINUS SIGN
// ---------------------------------------------------------------------------
// Somebody paid ahead is an ordinary state that needs no special case in the
// ledger, but a bare "-Rs 8,000.00" in a column headed "owed" reads as a defect
// rather than a peshgi. The wording question is open for buyers too
// (REGISTRY_SALES.md §15); this screen answers it one way so there is something
// concrete to disagree with.

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
import { formatMinor } from './money';
import { farmToday } from './today';
import type { EngagementKind, Person, WageBalanceRow } from './types';
import { Card } from '../ui/surface';
import { ErrorPanel } from '../ui/surface';
import { ErrorText } from '../ui/surface';
import { HelpText } from '../ui/text';
import { TextInput } from '../ui/input';
import { PageHeading } from '../ui/heading';
import { RowDivider } from '../ui/surface';
import { SectionHeading } from '../ui/heading';
import { SubHeading } from '../ui/heading';
import { Button } from '../ui/button';

@Component({
  selector: 'app-people-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    Card,
    Cell,
    Certainty,
    ChipGroup,
    ErrorPanel,
    ErrorText,
    HelpText,
    PageHeading,
    RouterLink,
    RowDivider,
    SectionHeading,
    SessionRequired,
    SubHeading,
    TextInput,
  ],
  template: `
    <div class="mx-auto max-w-4xl space-y-6">
      <header>
        <h2 appPageHeading>People</h2>
        <p appHelp class="mt-1">
          Everyone the farm employs, and what is owed to them. Also anyone whose name appears on a
          record — the vet, whoever sold you an animal — so “everything Imran milked” has somebody
          to point at.
        </p>
      </header>

      @if (loadError(); as e) {
        <p appErrorPanel size="lg" data-role="load-error">{{ e }}</p>
      }

      @if (rows(); as list) {
        @if (list.length === 0) {
          <p appCard empty
            data-role="empty">
            Nobody on file yet. Add the people who work here — then open a stint for each, and
            record what they are on.
          </p>
        } @else {
          <table class="w-full overflow-hidden rounded-xl border border-line-subtle bg-surface-raised text-sm"
            data-role="people-table">
            <thead class="bg-surface-sunken text-left text-xs uppercase tracking-wide text-content-muted">
              <tr>
                <th appCell>Identifier</th>
                <th appCell>Name</th>
                <th appCell numeric>Owed</th>
                <th appCell>Last paid</th>
              </tr>
            </thead>
            <tbody>
              @for (p of list; track p.person_id) {
                <tr appRowDivider [class.opacity-60]="!p.engaged"
                  [attr.data-engaged]="p.engaged">
                  <td appCell small class="font-mono">
                    <!-- WAS "decoration-certainty-rule", AND IT HAD TO MOVE.
                         §6.2 listed this as "the dotted rule, now named" -- but
                         it is a SOLID underline on an identifier link, and from
                         this phase on "--certainty-rule" is the dotted rule that
                         means "this figure is approximate". Leaving it here
                         would have said this person's identifier was a guess.
                         "line-strong" is the value §14.2 specifies for exactly
                         this treatment: "an identifier is a name, not a link". -->
                    <a [routerLink]="['/labour/people', p.person_id]"
                      class="text-content-heading underline decoration-line-strong">{{ p.identifier }}</a>
                    @if (!p.engaged) {
                      <span class="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] uppercase
                        tracking-wide text-content-muted" data-role="not-engaged">no open stint</span>
                    }
                  </td>
                  <td appCell>
                    <span [appCertainty]="p.name ? 'known' : 'no-record'"
                    >{{ p.name ?? noRecord }}</span>
                  </td>
                  <!-- THE ZERO BRANCH IS THE ONE THAT MOVED, and it moved
                       because it was the inverse of §15's rule rather than an
                       instance of it. "owed()" returned a bare "—" for a
                       balance of exactly zero -- a dash standing in for a
                       number that IS known, from a ledger with entries in it
                       that net to nothing. §15 rule 1 forbids "a zero standing
                       in for an unknown"; this was an unknown standing in for a
                       zero, which is the same lie facing the other way.

                       "settled" is the answer, so it is words, and it is §6's
                       third state: the amount owed is deliberately nil.

                       The other two branches keep their existing treatment and
                       the cell keeps its amber. A "text-certainty-known" span
                       inside would have won the cascade against the <td>'s
                       "text-warning-fg" and silently deleted the in-advance
                       highlight -- which is a liability marker, not a certainty
                       state, and not this phase's to remove. -->
                  <td appCell numeric
                    [class.text-warning-fg]="p.balance_minor < 0" [attr.data-role]="'balance'">
                    @if (p.balance_minor === 0) {
                      <span appCertainty="absent" data-certainty="absent">settled</span>
                    } @else {
                      {{ owed(p) }}
                    }
                  </td>
                  <td appCell tone="muted">
                    <span [appCertainty]="p.last_payment_on ? 'known' : 'no-record'"
                      [attr.data-certainty]="p.last_payment_on ? 'known' : 'no-record'"
                    >{{ p.last_payment_on ?? noRecord }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      } @else {
        <p appHelp tone="subtle">Loading…</p>
      }

      <!-- Add a person. The identifier is asked for HERE and nowhere else. -->
      <form class="space-y-4 rounded-xl border border-line bg-surface-raised p-4"
        (submit)="submitPerson($event)" data-role="add-person">
        <h3 appSectionHeading>Add a person</h3>

        <label class="block space-y-1">
          <span appSubHeading>Identifier</span>
          <input name="identifier" [value]="identifier()"
            (input)="identifier.set($any($event.target).value)" appInput density="comfortable" class="w-full font-mono"
            placeholder="imran" autocomplete="off" />
          <span class="block text-xs text-content-subtle">
            A short, stable name — the same one you type into “observed by”. It cannot be changed
            later: every milking and dispatch that names them stores it as text, and the event log
            cannot be rewritten.
          </span>
          @if (personState.fieldError('identifier'); as msg) {
            <span appErrorText size="xs" tone="soft" class="block" data-role="error-identifier">{{ msg }}</span>
          }
        </label>

        <label class="block space-y-1">
          <span appSubHeading>Display name <span class="text-content-subtle">(optional)</span></span>
          <input name="name" [value]="name()" (input)="name.set($any($event.target).value)" appInput density="comfortable" class="w-full" placeholder="Imran" />
        </label>

        <label class="block space-y-1">
          <span appSubHeading>Contact <span class="text-content-subtle">(optional)</span></span>
          <input name="contact" [value]="contact()" (input)="contact.set($any($event.target).value)" appInput density="comfortable" class="w-full" />
        </label>

        @if (personState.formError(['identifier']); as msg) {
          <p appErrorPanel data-role="person-form-error">{{ msg }}</p>
        }

        @if (session.ready()) {
          <button type="submit" [appButtonDisabled]="!canAddPerson()" appButton>
            {{ personState.submitting() ? 'Saving…' : 'Add person' }}
          </button>
        } @else {
          <app-session-required what="a person" />
        }
      </form>

      <!-- Open a stint. Separate from adding a person BECAUSE a person is not an
           employment: somebody may be on file and not employed, and somebody
           returning gets a second stint rather than an edited first one. -->
      @if (rows(); as list) {
        @if (list.length > 0) {
          <form class="space-y-4 rounded-xl border border-line bg-surface-raised p-4"
            (submit)="submitEngagement($event)" data-role="add-engagement">
            <h3 appSectionHeading>Open a stint</h3>
            <p appHelp size="xs" tone="subtle">
              Somebody who left and came back gets a second stint, not an edited first one — which
              is what stops their old salary quietly applying to the new one. Two stints at once is
              fine too, for somebody holding two roles.
            </p>

            <label class="block space-y-1">
              <span appSubHeading>Person</span>
              <select name="person_id" [value]="engagePerson()"
                (change)="engagePerson.set($any($event.target).value)" appInput density="comfortable" class="w-full">
                <option value="">Choose…</option>
                @for (p of list; track p.person_id) {
                  <option [value]="p.person_id">{{ p.identifier }}</option>
                }
              </select>
            </label>

            <div class="space-y-1">
              <span appSubHeading>Kind</span>
              <app-chip-group name="kind" [options]="kindChips" [value]="engageKind()"
                (changed)="engageKind.set($any($event))" />
              <span class="block text-xs text-content-subtle">
                Salaried people are on every monthly run and must be answered. Dihari are not a row
                until they worked a day.
              </span>
            </div>

            <label class="block space-y-1">
              <span appSubHeading>Role <span class="text-content-subtle">(optional)</span></span>
              <input name="role" [value]="engageRole()" (input)="engageRole.set($any($event.target).value)" appInput density="comfortable" class="w-full" placeholder="milker" />
            </label>

            <label class="block space-y-1">
              <span appSubHeading>Started on</span>
              <input name="started_on" type="date" [value]="engageFrom()"
                (input)="engageFrom.set($any($event.target).value)" appInput density="comfortable" />
              @if (engageState.fieldError('started_on'); as msg) {
                <span appErrorText size="xs" tone="soft" class="block" data-role="error-started-on">{{ msg }}</span>
              }
            </label>

            @if (engageState.formError(['started_on', 'kind', 'person_id']); as msg) {
              <p appErrorPanel
                data-role="engage-form-error">{{ msg }}</p>
            }

            @if (session.ready()) {
              <button type="submit" [appButtonDisabled]="!canEngage()" appButton>
                {{ engageState.submitting() ? 'Saving…' : 'Open stint' }}
              </button>
            } @else {
              <app-session-required what="a stint" />
            }
          </form>
        }
      }
    </div>
  `,
})
export class PeopleList {
  private readonly api = inject(RegistryApi);
  protected readonly session = inject(Session);
  private readonly writeLog = inject(WriteLog);

  protected readonly rows = signal<WageBalanceRow[] | null>(null);
  protected readonly loadError = signal<string | null>(null);

  protected readonly identifier = signal('');
  protected readonly name = signal('');
  protected readonly contact = signal('');
  protected readonly personState = new FormState<Person>();

  protected readonly engagePerson = signal('');
  protected readonly engageKind = signal<EngagementKind>('permanent');
  protected readonly engageRole = signal('');
  protected readonly engageFrom = signal(farmToday());
  protected readonly engageState = new FormState<unknown>();

  protected readonly kindChips = [
    { value: 'permanent', label: 'Salaried', hint: 'on every monthly run' },
    { value: 'daily', label: 'Dihari', hint: 'per day, when hired' },
  ];

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.rows.set(await this.api.people(farmToday()));
      this.loadError.set(null);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * "In advance" rather than a minus sign.
   *
   * A negative balance is somebody paid ahead, which the ledger handles with no
   * special case -- but "-Rs 8,000.00" under a heading that says "owed" reads as
   * a defect rather than a peshgi.
   */
  /** §6's no-record glyph, for the template. An en dash. */
  protected readonly noRecord = NO_RECORD;

  /**
   * The zero case is handled in the template, not here, because it needs a
   * treatment and not only a word. See the cell's comment.
   */
  protected owed(p: WageBalanceRow): string {
    if (p.balance_minor === 0) return 'settled';
    if (p.balance_minor < 0) return `${formatMinor(-p.balance_minor)} in advance`;
    return formatMinor(p.balance_minor);
  }

  protected readonly canAddPerson = computed(
    () => !this.personState.submitting() && this.identifier().trim().length > 0,
  );

  protected readonly canEngage = computed(
    () =>
      !this.engageState.submitting() &&
      this.engagePerson().length > 0 &&
      this.engageFrom().length > 0,
  );

  protected async submitPerson(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.canAddPerson()) return;
    const result = await this.personState.run((key) =>
      this.api.addPerson(
        {
          identifier: this.identifier().trim(),
          name: this.name().trim() || null,
          contact: this.contact().trim() || null,
          recorded_by: this.session.provenance().recorded_by,
        },
        key,
      ),
    );
    if (result) {
      this.writeLog.announce(
        `${result.identifier} added — open a stint and record what they are on`,
      );
      this.identifier.set('');
      this.name.set('');
      this.contact.set('');
      await this.load();
    }
  }

  protected async submitEngagement(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.canEngage()) return;
    const personId = this.engagePerson();
    const who = this.rows()?.find((p) => p.person_id === personId)?.identifier ?? personId;
    const result = await this.engageState.run((key) =>
      this.api.addEngagement(
        personId,
        {
          kind: this.engageKind(),
          role: this.engageRole().trim() || null,
          started_on: this.engageFrom(),
          recorded_by: this.session.provenance().recorded_by,
        },
        key,
      ),
    );
    if (result) {
      this.writeLog.announce(
        `${who}: ${this.engageKind() === 'daily' ? 'dihari' : 'salaried'} stint from ` +
          `${this.engageFrom()} — record the package next`,
      );
      this.engageRole.set('');
      await this.load();
    }
  }
}
