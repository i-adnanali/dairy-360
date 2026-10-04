import { writerDraft } from "../writer-draft";
import { WriteLock } from "../write-lock";
// Add an acquired animal. Pass one of the backfill.

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { RegistryApi } from "../api";
import { FormState } from "../form-state";
import { Session } from "../session";
import { WriteLog, focusAfterWrite } from "../after-write";
import { ChipGroup } from "../chip-group/chip-group";
import { DuplicateWarning } from "../duplicate-warning/duplicate-warning";
import { IdentifierInput } from "../identifier-input/identifier-input";
import { Identifiers } from "../identifiers";
import { PrecisionDateControl, dateBlocker } from "../precision-date/precision-date";
import type { DateEntry } from "../precision-date/precision-date";
import type { AnimalDetail, RegistrySex } from "../types";
import { Card } from "../../ui/surface";
import { ErrorPanel } from "../../ui/surface";
import { ErrorText } from "../../ui/surface";
import { FieldLabel } from "../../ui/text";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { PageHeading } from "../../ui/heading";
import { SectionLabel } from "../../ui/text";
import { Button } from "../../ui/button";

const FIELDS = ['sex', 'occurred_on', 'date_precision', 'birth_on', 'birth_precision'] as const;

@Component({
  selector: 'app-animal-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    WriteLock,
    Button,
    Card,
    ChipGroup,
    DuplicateWarning,
    ErrorPanel,
    ErrorText,
    FieldLabel,
    HelpText,
    IdentifierInput,
    PageHeading,
    PrecisionDateControl,
    SectionLabel,
    TextInput,
  ],
  templateUrl: './animal-form.html',
  styleUrl: './animal-form.css',
})
export class AnimalForm {
  protected writer!: ReturnType<typeof writerDraft>;
  /**
   * The NATIVE submit event, not FormsModule's `ngSubmit`.
   *
   * `(ngSubmit)` is an output on the `NgForm` directive, so without importing
   * FormsModule it binds to nothing at all -- the form falls through to a real
   * browser submission and the page reloads. Caught by the specs, which saw
   * zero requests. The native event needs `preventDefault()` for the same
   * reason, and avoids pulling in a forms library this app does not otherwise
   * use.
   */
  protected onSubmit(e: Event): void {
    e.preventDefault();
    this.submit();
  }

  private readonly api = inject(RegistryApi);
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  protected readonly identifiers = inject(Identifiers);
  private readonly writeLog = inject(WriteLog);

  /** Where the caret goes after a write, so the next animal is just typing. */
  private readonly firstField = viewChild<ElementRef<HTMLInputElement>>('firstField');
  /** Both date controls, cleared together after a write. */
  private readonly dateControls = viewChildren(PrecisionDateControl);

  protected readonly fields = FIELDS;
  protected readonly sexChips = [
    { value: 'female', label: 'female' },
    { value: 'male', label: 'male' },
  ];
  protected readonly state = new FormState<{ animal_id: string; animal: AnimalDetail }>();

  protected readonly sex = signal<RegistrySex>('female');
  protected readonly name = signal('');
  protected readonly from = signal('');
  protected readonly postNo = signal('');
  protected readonly tagNo = signal('');
  protected readonly observedBy = signal('');
  protected readonly acquired = signal<DateEntry>({ status: 'empty' });
  protected readonly birth = signal<DateEntry>({ status: 'empty' });
  /**
   * Bumped after each write so the duplicate query re-runs.
   *
   * The fields usually do not change between a successful submit and the next
   * record, so nothing else would re-trigger it -- and the animal just created
   * is exactly the one worth matching against if the operator submits again.
   */
  protected readonly writes = signal(0);

  /**
   * THE BIRTH DATE IS OPTIONAL AND STILL BLOCKS WHEN HALF-TYPED.
   *
   * That asymmetry is the point. `required` decides only whether an EMPTY field
   * blocks; a field with text in it that does not parse blocks either way,
   * because the alternative is sending `birth_on: null` for a birth year the
   * operator typed -- a record indistinguishable from one where nothing was
   * entered. A fabrication is visible to the next reader; a disappearance is
   * visible to nobody.
   */
  protected readonly blockedReason = computed(
    () =>
      dateBlocker(this.acquired(), { label: 'arrival date', required: true }) ??
      dateBlocker(this.birth(), { label: 'birth date', required: false }),
  );

  protected readonly canSubmit = computed(
    () => this.blockedReason() === null && !this.state.submitting(),
  );

  constructor() {
    this.writer = writerDraft({
      name: 'New animal',
      fields: {
        sex: this.sex,
        name: this.name,
        from: this.from,
        postNo: this.postNo,
        tagNo: this.tagNo,
        observedBy: this.observedBy,
        acquired: this.acquired,
        birth: this.birth,
      },
      states: [this.state],
      afterRestore: () => {
        this.dateControls().forEach((c) => c.reset());
      },
    });

    void this.identifiers.refresh();
  }

  protected async submit(): Promise<void> {
    const a = this.acquired();
    const b = this.birth();
    // Belt and braces behind the disabled button: an incomplete optional date
    // must never reach the wire as a null.
    if (a.status !== 'complete' || b.status === 'incomplete') return;
    const r = await this.state.runRequest(
      () =>
        [
          {
            sex: this.sex(),
            name: blank(this.name()),
            acquired_on: a.value.occurred_on,
            date_precision: a.value.date_precision,
            birth_on: b.status === 'complete' ? b.value.occurred_on : null,
            birth_precision: b.status === 'complete' ? b.value.date_precision : null,
            from: blank(this.from()),
            post_no: blank(this.postNo()),
            tag_no: blank(this.tagNo()),
            observed_by: blank(this.observedBy()),
            ...this.session.provenance(),
          },
        ] as const,
      (request, key) => this.api.addAnimal(request[0], key),
    );
    // Refreshed AFTER the write, so a name typed on this animal is offered on
    // the next one. That is the whole point of the datalist.
    void this.identifiers.refresh();
    this.writes.update((n) => n + 1);
    if (r) this.readyForNext(r.animal_id, r.animal.animal.name);
  }

  /**
   * The round trip, collapsed. See after-write.ts for why this is the item that
   * decides whether a separate roster screen is needed at all.
   *
   * `sex` deliberately SURVIVES: it has a strong prior, consecutive animals in
   * a backfill are usually the same sex, and re-answering it twenty times is
   * exactly the tax the defaults rule exists to avoid. Everything that is a
   * fact about THIS animal is cleared, because carrying it forward is how the
   * next submit becomes a duplicate.
   */
  private readyForNext(id: string, name: string | null): void {
    this.name.set('');
    this.from.set('');
    this.postNo.set('');
    this.tagNo.set('');
    this.observedBy.set('');
    for (const c of this.dateControls()) c.reset();
    this.acquired.set({ status: 'empty' });
    this.birth.set({ status: 'empty' });
    this.writeLog.announce(`Wrote ${id}${name ? ` — ${name}` : ''}. Ready for the next.`);
    focusAfterWrite(this.firstField()?.nativeElement);
    this.writer.accept();
  }

  protected open(id: string): void {
    void this.router.navigate(['/animals', id]);
  }
}

function blank(v: string): string | null {
  return v.trim().length === 0 ? null : v.trim();
}
