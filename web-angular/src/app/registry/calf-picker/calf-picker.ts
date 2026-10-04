// Which calf this calving produced: pick an existing animal, or create one.
//
// ---------------------------------------------------------------------------
// WHAT THIS REPLACED, AND WHY IT WAS WORTH REPLACING
// ---------------------------------------------------------------------------
// A yes/no: "Is the calf already in the registry?", with copy warning that
// answering "new" for an animal that already exists creates a duplicate that
// cannot be repaired.
//
// Everything about that was true, and it was still the wrong question. It asked
// the operator to recall the contents of a database that is one tab away, at
// hour two of a transcription session, with an irreversible penalty for a wrong
// recall -- and the answer was always sitting in the database. Recognition
// beats recall, so the question became a query.
//
// The order is deliberate: existing animals first, ranked, and "none of these"
// LAST. The safe path is the one the eye reaches first, and creating a new
// animal is the deliberate act rather than the default.
//
// ---------------------------------------------------------------------------
// A STANDALONE COMPONENT, NOT MARKUP INSIDE calving-form
// ---------------------------------------------------------------------------
// The animal workbench replaces /calving with an inline composer and needs this
// same list, with the dam fixed by context rather than chosen from a dropdown.
// Everything it needs arrives as inputs and leaves as one output, so it does not
// know or care which surface it is on.
//
// It renders no warning about duplicates. The list IS the mitigation, and a
// warning that no longer describes a live risk is noise that teaches operators
// to skim warnings -- the same reason /check has no badge that turns green.

import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { LinkCandidate } from "../types";
import { Card } from "../../ui/surface";
import { ErrorText } from "../../ui/surface";
import { FieldLabel } from "../../ui/text";
import { HelpText } from "../../ui/text";
import { TextInput } from "../../ui/input";
import { SectionLabel } from "../../ui/text";

/** `null` means "create a new animal"; a string is an existing animal's id. */
export type CalfChoice = string | null;

@Component({
  selector: 'app-calf-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Card, ErrorText, FieldLabel, HelpText, SectionLabel, TextInput],
  templateUrl: './calf-picker.html',
  styleUrl: './calf-picker.css',
})
export class CalfPicker {
  /** Server-ranked. This component does not re-sort; the order is a server rule. */
  readonly candidates = input<LinkCandidate[]>([]);
  /**
   * False until the dam, the date AND the calf's sex are known, since
   * eligibility needs all three. The blocked message names all three too: a
   * precondition list that is shorter than the real one tells the operator to
   * do something they have already done.
   */
  readonly ready = input(false);
  readonly status = input<'idle' | 'loading' | 'loaded' | 'failed'>('idle');
  readonly error = input<string | null>(null);

  /** The chosen calf, or null for "create new". Null until `answered()`. */
  readonly chosen = signal<CalfChoice>(null);
  /** Distinguishes "create new" from "not answered yet" — both are `chosen() === null`. */
  readonly answered = signal(false);
  readonly calfName = signal('');

  readonly changed = output<{ choice: CalfChoice; name: string | null }>();

  protected readonly showFar = signal(false);

  protected readonly near = computed(() => this.candidates().filter((c) => c.within_match_window));
  protected readonly far = computed(() => this.candidates().filter((c) => !c.within_match_window));

  /**
   * How far this animal's recorded birth date sits from the proposed calving.
   *
   * "no birth date" is stated rather than left blank, because it is the reason
   * the animal is at the top of the list and a blank cell would read as a
   * missing value instead of as the signal it is.
   */
  protected distance(c: LinkCandidate): string {
    if (c.days_apart === null) return c.birth_on === null ? 'no birth date' : '';
    if (c.days_apart === 0) return 'same date';
    const days = Math.abs(c.days_apart);
    const when = c.days_apart > 0 ? 'earlier' : 'later';
    return days < 60 ? `${days}d ${when}` : `${Math.round(days / 30.44)}mo ${when}`;
  }

  protected pick(choice: CalfChoice): void {
    this.chosen.set(choice);
    this.answered.set(true);
    // A name only belongs to an animal being created. Carrying it into a link
    // would silently drop it, since recordCalving ignores it in link mode.
    if (choice !== null) this.calfName.set('');
    this.emit();
  }

  protected setName(v: string): void {
    this.calfName.set(v);
    this.emit();
  }

  private emit(): void {
    const name = this.calfName().trim();
    this.changed.emit({
      choice: this.chosen(),
      name: this.chosen() === null && name.length > 0 ? name : null,
    });
  }

  /** Called by a parent when the date or dam changes and the list is stale. */
  reset(): void {
    this.chosen.set(null);
    this.answered.set(false);
    this.calfName.set('');
    this.showFar.set(false);
  }
}
