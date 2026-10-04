import { ScrollRegion } from "../../ui/scroll-region";
import { Field } from "../../ui/field/field";
import { writerDraft } from "../writer-draft";
import { WriteLock } from "../write-lock";
import { pagedList } from "../paged-list";
import { Pagination } from "../../ui/pagination/pagination";
import { StatusBadge } from "../../ui/surface";
import { IdentifierLink, RowLink } from "../../ui/navigation";
// `/people` -- who works here, and what they are owed
// (docs/records/REGISTRY_PAYROLL.md §12.2).
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
// (docs/records/REGISTRY_SALES.md §15); this screen answers it one way so there is something
// concrete to disagree with.

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
import { formatMinor } from "../money";
import { farmToday } from "../today";
import type { EngagementKind, Person, WageBalanceRow } from "../types";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { ErrorText } from "../../ui/surface";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { PageHeading } from "../../ui/heading";
import { RowDivider } from "../../ui/surface";
import { SectionHeading } from "../../ui/heading";
import { SubHeading } from "../../ui/heading";
import { Button } from "../../ui/button";

@Component({
  selector: 'app-people-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollRegion, Field,
    WriteLock,
    Pagination,
    StatusBadge,
    IdentifierLink,
    RowLink,
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
  templateUrl: './people-list.html',
  styleUrl: './people-list.css',
})
export class PeopleList {
  protected readonly personSearch = signal('');
  protected matchingPeople<T extends {person_id: string; identifier: string; name: string | null}>(list: T[]) {
    const query = this.personSearch().trim().toLowerCase();
    return list.filter(p => p.person_id === this.engagePerson() || (p.identifier + ' ' + (p.name ?? '')).toLowerCase().includes(query));
  }
  protected focusAdd(event: Event) { event.preventDefault(); const field = document.querySelector<HTMLInputElement>('#add-person input'); field?.focus(); field?.scrollIntoView({ block: 'center' }); }
  protected focusStint(event: Event) { event.preventDefault(); document.querySelector<HTMLInputElement>('#open-stint input')?.focus(); }
  protected personDraft!: ReturnType<typeof writerDraft>;
  protected engageDraft!: ReturnType<typeof writerDraft>;
  protected readonly paging = pagedList<WageBalanceRow>('people');
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
    this.personDraft = writerDraft({
      name: 'New person',
      fields: { identifier: this.identifier, name: this.name, contact: this.contact },
      states: [this.personState],
    });

    this.engageDraft = writerDraft({
      name: 'Engagement',
      fields: {
        engagePerson: this.engagePerson,
        engageKind: this.engageKind,
        engageRole: this.engageRole,
        engageFrom: this.engageFrom,
      },
      states: [this.engageState],
    });

    void this.load();
  }

  private async load(): Promise<void> {
    this.paging.refresh();
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
    const result = await this.personState.runRequest(
      () =>
        [
          {
            identifier: this.identifier().trim(),
            name: this.name().trim() || null,
            contact: this.contact().trim() || null,
            recorded_by: this.session.provenance().recorded_by,
          },
        ] as const,
      (request, key) => this.api.addPerson(request[0], key),
    );
    if (result) {
      this.writeLog.announce(
        `${result.identifier} added — open a stint and record what they are on`,
      );
      this.identifier.set('');
      this.name.set('');
      this.contact.set('');
      this.personDraft.accept();
      await this.load();
    }
  }

  protected async submitEngagement(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.canEngage()) return;
    const personId = this.engagePerson();
    const who = this.rows()?.find((p) => p.person_id === personId)?.identifier ?? personId;
    const result = await this.engageState.runRequest(
      () =>
        [
          personId,
          {
            kind: this.engageKind(),
            role: this.engageRole().trim() || null,
            started_on: this.engageFrom(),
            recorded_by: this.session.provenance().recorded_by,
          },
        ] as const,
      (request, key) => this.api.addEngagement(request[0], request[1], key),
    );
    if (result) {
      this.writeLog.announce(
        `${who}: ${this.engageKind() === 'daily' ? 'dihari' : 'salaried'} stint from ` +
          `${this.engageFrom()} — record the package next`,
      );
      this.engageRole.set('');
      this.engageDraft.accept();
      await this.load();
    }
  }
}
