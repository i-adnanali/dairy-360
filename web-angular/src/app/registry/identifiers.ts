// The suggestion lists for the free-text identifier fields, fetched once.
//
// A service rather than a per-form fetch, for two reasons. The lists are the
// same on every surface, so three forms asking separately would be three
// requests for one answer. And they have to be REFRESHED AFTER A WRITE: the
// whole point is that the name you typed on animal four is offered on animal
// five, and a list fetched once at page load would never contain it.
//
// Nothing here is persisted across a reload. Same tripwire rule as Session:
// no local state outliving a page load.

import { Injectable, inject, signal } from '@angular/core';
import { RegistryApi } from './api';
import type { IdentifierValues } from './types';

const EMPTY: IdentifierValues = { observed_by: [], acquired_from: [], sire_ref: [] };

@Injectable({ providedIn: 'root' })
export class Identifiers {
  private readonly api = inject(RegistryApi);

  readonly values = signal<IdentifierValues>(EMPTY);

  /** One in-flight request at a time, like Target.probe(). */
  private inFlight: Promise<void> | null = null;

  /**
   * Fetch, or join the fetch already running.
   *
   * A FAILURE IS SWALLOWED ON PURPOSE. These are suggestions; an unreachable
   * server should leave the inputs behaving as plain text fields, not surface an
   * error next to a field the operator was not asking about. The write itself
   * will report the server being down, in the place where it matters.
   */
  refresh(): Promise<void> {
    this.inFlight ??= this.api
      .identifierValues()
      .then((v) => this.values.set(v))
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
