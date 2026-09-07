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
import { FormState } from './form-state';
import { RegistryApi } from './api';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { WriteLog } from './after-write';
import { formatMinor } from './money';
import { farmToday } from './today';
import type { EngagementKind, Person, WageBalanceRow } from './types';

@Component({
  selector: 'app-people-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChipGroup, RouterLink, SessionRequired],
  template: `
    <div class="mx-auto max-w-4xl space-y-6">
      <header>
        <h2 class="text-lg font-semibold text-farm-900">People</h2>
        <p class="mt-1 text-sm text-farm-600">
          Everyone the farm employs, and what is owed to them. Also anyone whose name appears on a
          record — the vet, whoever sold you an animal — so “everything Imran milked” has somebody
          to point at.
        </p>
      </header>

      @if (loadError(); as e) {
        <p class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" data-role="load-error">{{ e }}</p>
      }

      @if (rows(); as list) {
        @if (list.length === 0) {
          <p class="rounded-xl border border-farm-300 bg-white p-4 text-sm text-farm-600"
            data-role="empty">
            Nobody on file yet. Add the people who work here — then open a stint for each, and
            record what they are on.
          </p>
        } @else {
          <table class="w-full overflow-hidden rounded-xl border border-farm-200 bg-white text-sm"
            data-role="people-table">
            <thead class="bg-farm-100 text-left text-xs uppercase tracking-wide text-farm-600">
              <tr>
                <th class="px-3 py-2">Identifier</th>
                <th class="px-3 py-2">Name</th>
                <th class="px-3 py-2 text-right">Owed</th>
                <th class="px-3 py-2">Last paid</th>
              </tr>
            </thead>
            <tbody>
              @for (p of list; track p.person_id) {
                <tr class="border-t border-farm-100" [class.opacity-60]="!p.engaged"
                  [attr.data-engaged]="p.engaged">
                  <td class="px-3 py-2 font-mono text-xs">
                    <a [routerLink]="['/labour/people', p.person_id]"
                      class="text-farm-800 underline decoration-farm-300">{{ p.identifier }}</a>
                    @if (!p.engaged) {
                      <span class="ml-2 rounded bg-farm-100 px-1.5 py-0.5 text-[10px] uppercase
                        tracking-wide text-farm-600" data-role="not-engaged">no open stint</span>
                    }
                  </td>
                  <td class="px-3 py-2">{{ p.name ?? '—' }}</td>
                  <td class="px-3 py-2 text-right tabular-nums"
                    [class.text-amber-800]="p.balance_minor < 0" [attr.data-role]="'balance'">
                    {{ owed(p) }}
                  </td>
                  <td class="px-3 py-2 text-farm-600">{{ p.last_payment_on ?? '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      } @else {
        <p class="text-sm text-farm-500">Loading…</p>
      }

      <!-- Add a person. The identifier is asked for HERE and nowhere else. -->
      <form class="space-y-4 rounded-xl border border-farm-300 bg-white p-4"
        (submit)="submitPerson($event)" data-role="add-person">
        <h3 class="text-sm font-semibold text-farm-900">Add a person</h3>

        <label class="block space-y-1">
          <span class="text-sm font-medium text-farm-800">Identifier</span>
          <input name="identifier" [value]="identifier()"
            (input)="identifier.set($any($event.target).value)"
            class="w-full rounded-lg border border-farm-300 px-3 py-2 font-mono text-sm"
            placeholder="imran" autocomplete="off" />
          <span class="block text-xs text-farm-500">
            A short, stable name — the same one you type into “observed by”. It cannot be changed
            later: every milking and dispatch that names them stores it as text, and the event log
            cannot be rewritten.
          </span>
          @if (personState.fieldError('identifier'); as msg) {
            <span class="block text-xs text-red-700" data-role="error-identifier">{{ msg }}</span>
          }
        </label>

        <label class="block space-y-1">
          <span class="text-sm font-medium text-farm-800">Display name <span class="text-farm-500">(optional)</span></span>
          <input name="name" [value]="name()" (input)="name.set($any($event.target).value)"
            class="w-full rounded-lg border border-farm-300 px-3 py-2 text-sm" placeholder="Imran" />
        </label>

        <label class="block space-y-1">
          <span class="text-sm font-medium text-farm-800">Contact <span class="text-farm-500">(optional)</span></span>
          <input name="contact" [value]="contact()" (input)="contact.set($any($event.target).value)"
            class="w-full rounded-lg border border-farm-300 px-3 py-2 text-sm" />
        </label>

        @if (personState.formError(['identifier']); as msg) {
          <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-role="person-form-error">{{ msg }}</p>
        }

        @if (session.ready()) {
          <button type="submit" [disabled]="!canAddPerson()"
            class="rounded-lg bg-farm-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
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
          <form class="space-y-4 rounded-xl border border-farm-300 bg-white p-4"
            (submit)="submitEngagement($event)" data-role="add-engagement">
            <h3 class="text-sm font-semibold text-farm-900">Open a stint</h3>
            <p class="text-xs text-farm-500">
              Somebody who left and came back gets a second stint, not an edited first one — which
              is what stops their old salary quietly applying to the new one. Two stints at once is
              fine too, for somebody holding two roles.
            </p>

            <label class="block space-y-1">
              <span class="text-sm font-medium text-farm-800">Person</span>
              <select name="person_id" [value]="engagePerson()"
                (change)="engagePerson.set($any($event.target).value)"
                class="w-full rounded-lg border border-farm-300 px-3 py-2 text-sm">
                <option value="">Choose…</option>
                @for (p of list; track p.person_id) {
                  <option [value]="p.person_id">{{ p.identifier }}</option>
                }
              </select>
            </label>

            <div class="space-y-1">
              <span class="text-sm font-medium text-farm-800">Kind</span>
              <app-chip-group name="kind" [options]="kindChips" [value]="engageKind()"
                (changed)="engageKind.set($any($event))" />
              <span class="block text-xs text-farm-500">
                Salaried people are on every monthly run and must be answered. Dihari are not a row
                until they worked a day.
              </span>
            </div>

            <label class="block space-y-1">
              <span class="text-sm font-medium text-farm-800">Role <span class="text-farm-500">(optional)</span></span>
              <input name="role" [value]="engageRole()" (input)="engageRole.set($any($event.target).value)"
                class="w-full rounded-lg border border-farm-300 px-3 py-2 text-sm" placeholder="milker" />
            </label>

            <label class="block space-y-1">
              <span class="text-sm font-medium text-farm-800">Started on</span>
              <input name="started_on" type="date" [value]="engageFrom()"
                (input)="engageFrom.set($any($event.target).value)"
                class="rounded-lg border border-farm-300 px-3 py-2 text-sm" />
              @if (engageState.fieldError('started_on'); as msg) {
                <span class="block text-xs text-red-700" data-role="error-started-on">{{ msg }}</span>
              }
            </label>

            @if (engageState.formError(['started_on', 'kind', 'person_id']); as msg) {
              <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
                data-role="engage-form-error">{{ msg }}</p>
            }

            @if (session.ready()) {
              <button type="submit" [disabled]="!canEngage()"
                class="rounded-lg bg-farm-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
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
  protected owed(p: WageBalanceRow): string {
    if (p.balance_minor === 0) return '—';
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
