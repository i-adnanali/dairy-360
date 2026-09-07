// Registry API client. The first HttpClient in this app -- everything before
// this cycle went through @ag-ui/client's SSE transport.

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  AnimalDetail, BalanceRow, DestinationListRow, DestinationPrice, DispatchSheet,
  DayBoard, DuplicateCandidate, Engagement, HerdRow, IdentifierValues, LinkCandidate,
  MilkingHistoryRow, MilkingRoster, PayrollRun, PayTermWithBenefits, Person,
  Reconciliation, Statement, StorageInfo, TimelineEvent, Verification,
  WageBalanceRow, WageStatement, WireError,
} from './types';

const BASE = '/api/registry';

/**
 * A server refusal, carrying the wire shape through to whatever caught it.
 *
 * The message is NEVER rewritten here. The server's prose was written to teach
 * an operator what to do, and a client that paraphrases it is throwing away the
 * only part that helps.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly field?: string;
  /** True when this is a domain refusal (400/404) rather than a bug or a network fault. */
  readonly isRefusal: boolean;

  constructor(wire: WireError, isRefusal: boolean) {
    super(wire.message);
    this.name = 'ApiError';
    this.code = wire.error;
    this.field = wire.field;
    this.isRefusal = isRefusal;
  }
}

/** Turn an HttpErrorResponse into an ApiError without losing the wire shape. */
function toApiError(e: unknown): ApiError {
  if (e instanceof HttpErrorResponse) {
    const body = e.error as Partial<WireError> | null;
    if (body && typeof body.message === 'string' && typeof body.error === 'string') {
      return new ApiError(body as WireError, e.status === 400 || e.status === 404);
    }
    // A 500, or a network fault, or HTML from a dev server. NOT a refusal: the
    // operator cannot fix it by editing the form, and pretending otherwise
    // would send them hunting for a mistake they did not make.
    return new ApiError(
      {
        error: e.status === 0 ? 'network_unreachable' : 'server_error',
        message:
          e.status === 0
            ? 'Could not reach the server. Is it running?'
            : `The server failed with HTTP ${e.status}. This is a bug, not something to fix in the form.`,
      },
      false,
    );
  }
  return new ApiError({ error: 'unknown', message: String(e) }, false);
}

async function unwrap<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw toApiError(e);
  }
}

export interface ProvenanceFields {
  source_form: SourceFormValue;
  source_ref?: string | null;
  observed_by?: string | null;
  recorded_by: string;
}
type SourceFormValue = import('./types').SourceForm;
type MilkingSessionValue = import('./types').MilkingSession;

@Injectable({ providedIn: 'root' })
export class RegistryApi {
  private readonly http = inject(HttpClient);

  // --- reads ---------------------------------------------------------------

  herd(): Promise<HerdRow[]> {
    return unwrap(
      firstValueFrom(this.http.get<{ animals: HerdRow[] }>(`${BASE}/animals`)),
    ).then((r) => r.animals);
  }

  animal(id: string): Promise<AnimalDetail> {
    return unwrap(firstValueFrom(this.http.get<AnimalDetail>(`${BASE}/animals/${id}`)));
  }

  calvings(id: string): Promise<TimelineEvent[]> {
    return unwrap(
      firstValueFrom(this.http.get<{ calvings: TimelineEvent[] }>(`${BASE}/animals/${id}/calvings`)),
    ).then((r) => r.calvings);
  }

  /**
   * Link-mode candidates.
   *
   * `occurredOn` and `datePrecision` are REQUIRED by the caller even though the
   * endpoint tolerates their absence: without them the list cannot apply the
   * timeline rule and would offer animals the server then refuses -- a picker
   * that says yes and then a refusal, with a real animal in front of you.
   */
  linkCandidates(opts: {
    dam: string;
    calfSex: string;
    occurredOn: string;
    datePrecision: string;
  }): Promise<LinkCandidate[]> {
    const q = new URLSearchParams({
      dam: opts.dam,
      calf_sex: opts.calfSex,
      occurred_on: opts.occurredOn,
      date_precision: opts.datePrecision,
    });
    return unwrap(
      firstValueFrom(this.http.get<{ candidates: LinkCandidate[] }>(`${BASE}/link-candidates?${q}`)),
    ).then((r) => r.candidates);
  }

  /**
   * Animals that might already be the one being entered.
   *
   * A soft signal: nothing branches on it and no write consults it. An empty
   * query is answered with `[]` by the server rather than the whole herd.
   */
  duplicateCandidates(opts: {
    name?: string | null;
    post_no?: string | null;
    tag_no?: string | null;
    sex?: string | null;
    exclude_id?: string | null;
  }): Promise<DuplicateCandidate[]> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(opts)) {
      if (typeof v === 'string' && v.length > 0) q.set(k, v);
    }
    return unwrap(
      firstValueFrom(
        this.http.get<{ candidates: DuplicateCandidate[] }>(`${BASE}/duplicate-candidates?${q}`),
      ),
    ).then((r) => r.candidates);
  }

  /** Previously-used free-text identifier values, for the datalists. */
  identifierValues(): Promise<IdentifierValues> {
    return unwrap(firstValueFrom(this.http.get<IdentifierValues>(`${BASE}/identifier-values`)));
  }

  damCandidates(): Promise<LinkCandidate[]> {
    return unwrap(
      firstValueFrom(this.http.get<{ candidates: LinkCandidate[] }>(`${BASE}/dam-candidates`)),
    ).then((r) => r.candidates);
  }

  /** What still needs recording. Assembled server-side; see overview.ts. */
  today(on?: string): Promise<DayBoard> {
    const q = on ? `?on=${on}` : '';
    return unwrap(firstValueFrom(this.http.get<DayBoard>(`${BASE}/today${q}`)));
  }

  /**
   * `asOf` is optional and normally absent, because /check is a "how does it
   * look now" screen. It exists so a URL carrying `?as_of=` can pin the run to
   * a date -- which is what makes a violation reproducible when somebody sends
   * you one.
   */
  verification(asOf?: string): Promise<Verification> {
    const q = asOf ? `?as_of=${asOf}` : '';
    return unwrap(firstValueFrom(this.http.get<Verification>(`${BASE}/verification${q}`)));
  }

  /**
   * Who was in milk on that date, with the context that catches typos.
   *
   * `on` is required rather than defaulted to today HERE, even though the server
   * would default it: the screen already knows which date it is showing, and a
   * client that could omit it would be able to disagree with its own header.
   */
  milkingRoster(on: string, session: MilkingSessionValue): Promise<MilkingRoster> {
    const q = new URLSearchParams({ on, session });
    return unwrap(firstValueFrom(this.http.get<MilkingRoster>(`${BASE}/milking/roster?${q}`)));
  }

  milkings(animalId: string): Promise<MilkingHistoryRow[]> {
    return unwrap(
      firstValueFrom(
        this.http.get<{ milkings: MilkingHistoryRow[] }>(`${BASE}/animals/${animalId}/milkings`),
      ),
    ).then((r) => r.milkings);
  }

  /**
   * Which database the server writes to, or null if it would not say.
   *
   * Deliberately NOT the harness's `/api/harness`: that endpoint answers by
   * existing, so its absence had to stand in for "this is the real registry" --
   * and an absence cannot distinguish the real server from an unreachable one,
   * or state the real case at all. `/storage` is on the shared registry router,
   * so both servers answer the same question the same way.
   *
   * The distinction between "no server" and "a server that did not answer" is
   * kept, because they call for different words in front of an operator.
   */
  async storage(): Promise<{ info: StorageInfo | null; reachable: boolean }> {
    try {
      return { info: await firstValueFrom(this.http.get<StorageInfo>(`${BASE}/storage`)), reachable: true };
    } catch (e) {
      const status = e instanceof HttpErrorResponse ? e.status : 0;
      return { info: null, reachable: status !== 0 };
    }
  }

  // --- writes --------------------------------------------------------------
  //
  // EVERY WRITE TAKES AN IDEMPOTENCY KEY, AND IT IS NOT OPTIONAL. The server
  // refuses a keyless write with a 400 rather than accepting it unprotected, so
  // an optional parameter here would only move the failure from compile time to
  // an operator's screen. FormState.run() hands the key to its callback for the
  // same reason. See form-state.ts for the one-key-per-attempt-sequence rule.

  /** The header every write carries. `Idempotency-Key`, cased conventionally. */
  private static keyed(idempotencyKey: string): { headers: Record<string, string> } {
    return { headers: { 'Idempotency-Key': idempotencyKey } };
  }

  addAnimal(
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ animal_id: string; animal: AnimalDetail }> {
    return unwrap(firstValueFrom(this.http.post<{ animal_id: string; animal: AnimalDetail }>(
      `${BASE}/animals`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  addEvent(
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ event_id: string; animal: AnimalDetail }> {
    return unwrap(firstValueFrom(this.http.post<{ event_id: string; animal: AnimalDetail }>(
      `${BASE}/events`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  recordCalving(body: Record<string, unknown>, idempotencyKey: string): Promise<{
    calf_id: string; linked: boolean; superseded_origin_event_id: string | null;
    dam: AnimalDetail; calf: AnimalDetail;
  }> {
    return unwrap(firstValueFrom(
      this.http.post<never>(`${BASE}/calvings`, body, RegistryApi.keyed(idempotencyKey)),
    ));
  }

  /**
   * A whole session, all rows or none.
   *
   * Keyed like every other write, and the replay case is real here rather than
   * theoretical: the roster is a dozen numbers typed in one go, so a
   * double-submit is exactly the shape of mistake that happens.
   */
  saveMilkingSession(body: Record<string, unknown>, idempotencyKey: string): Promise<{
    occurred_on: string; session: MilkingSessionValue;
    written: number; measured: number; milked_not_measured: number; not_milked: number;
    updated: number;
  }> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/milking/session`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  correctCalving(eventId: string, body: Record<string, unknown>, idempotencyKey: string): Promise<{
    dam_id: string; calf_id: string; calving_event_id: string; birth_event_id: string;
    departure_event_id: string | null;
    superseded: { calving_event_id: string; birth_event_id: string; departure_event_id: string | null };
  }> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/calvings/${eventId}/correction`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  // --- sales, home use and the ledger (docs/REGISTRY_SALES.md) -------------

  destinations(asOf?: string): Promise<DestinationListRow[]> {
    const q = asOf ? `?${new URLSearchParams({ as_of: asOf })}` : '';
    return unwrap(
      firstValueFrom(
        this.http.get<{ destinations: DestinationListRow[] }>(`${BASE}/destinations${q}`),
      ),
    ).then((r) => r.destinations);
  }

  statement(id: string): Promise<Statement> {
    return unwrap(firstValueFrom(this.http.get<Statement>(`${BASE}/destinations/${id}`)));
  }

  balances(): Promise<BalanceRow[]> {
    return unwrap(
      firstValueFrom(this.http.get<{ balances: BalanceRow[] }>(`${BASE}/balances`)),
    ).then((r) => r.balances);
  }

  dispatchSheet(on: string, session: MilkingSessionValue): Promise<DispatchSheet> {
    const q = new URLSearchParams({ on, session });
    return unwrap(firstValueFrom(this.http.get<DispatchSheet>(`${BASE}/dispatch/sheet?${q}`)));
  }

  reconcile(from: string, to: string): Promise<Reconciliation> {
    const q = new URLSearchParams({ from, to });
    return unwrap(firstValueFrom(this.http.get<Reconciliation>(`${BASE}/reconcile?${q}`)));
  }

  addDestination(body: Record<string, unknown>, idempotencyKey: string): Promise<DestinationListRow> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/destinations`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  updateDestination(
    id: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<DestinationListRow> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/destinations/${id}`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  /**
   * Agree a price from a date.
   *
   * `price_unit_litres` is a REQUIRED argument rather than an optional field on
   * the body, so a caller cannot omit the lot size and get a rate read as
   * per-litre -- which would be the same numbers at forty times the price.
   */
  setPrice(
    id: string,
    body: {
      effective_from: string;
      price_minor: number;
      price_unit_litres: number;
      note?: string | null;
      recorded_by: string;
    },
    idempotencyKey: string,
  ): Promise<DestinationPrice> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/destinations/${id}/prices`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  saveDispatchSession(body: Record<string, unknown>, idempotencyKey: string): Promise<{
    occurred_on: string; session: MilkingSessionValue;
    written: number; taken: number; none: number; updated: number;
    litres: number; amount_minor: number;
  }> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/dispatch/session`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  deleteDispatchSession(
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ removed: number }> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/dispatch/session/delete`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  recordPayment(body: Record<string, unknown>, idempotencyKey: string): Promise<{
    id: string; amount_minor: number; method: string;
  }> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/payments`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  deletePayment(id: string, idempotencyKey: string): Promise<{ removed: number }> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/payments/${id}/delete`, {}, RegistryApi.keyed(idempotencyKey),
    )));
  }

  // -------------------------------------------------------------------------
  // Labour (docs/REGISTRY_PAYROLL.md §10)
  // -------------------------------------------------------------------------

  people(asOf?: string): Promise<WageBalanceRow[]> {
    const q = asOf ? `?as_of=${asOf}` : '';
    return unwrap(
      firstValueFrom(
        this.http.get<{ people: WageBalanceRow[] }>(`${BASE}/people${q}`),
      ).then((r) => r.people),
    );
  }

  person(id: string, asOf?: string): Promise<WageStatement> {
    const q = asOf ? `?as_of=${asOf}` : '';
    return unwrap(firstValueFrom(this.http.get<WageStatement>(`${BASE}/people/${id}${q}`)));
  }

  payrollRun(from: string, to: string): Promise<PayrollRun> {
    const q = new URLSearchParams({ from, to });
    return unwrap(firstValueFrom(this.http.get<PayrollRun>(`${BASE}/payroll/run?${q}`)));
  }

  terms(engagementId: string): Promise<PayTermWithBenefits[]> {
    return unwrap(
      firstValueFrom(
        this.http.get<{ terms: PayTermWithBenefits[] }>(
          `${BASE}/engagements/${engagementId}/terms`,
        ),
      ).then((r) => r.terms),
    );
  }

  addPerson(body: Record<string, unknown>, idempotencyKey: string): Promise<Person> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/people`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  /**
   * Amend a person.
   *
   * `identifier` is deliberately NOT part of this body type. It cannot be
   * changed once records exist -- the link to history is by value and the event
   * log cannot be rewritten -- and the server refuses it. Keeping it out of the
   * type means a form cannot accidentally send it and discover that at runtime.
   */
  updatePerson(
    id: string,
    body: { name?: string | null; contact?: string | null; note?: string | null },
    idempotencyKey: string,
  ): Promise<Person> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/people/${id}`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  addEngagement(
    personId: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<Engagement> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/people/${personId}/engagements`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  updateEngagement(
    id: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<Engagement> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/engagements/${id}`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  /**
   * Agree a package from a date.
   *
   * `cash_period` is a REQUIRED field on a typed body rather than an optional
   * one, for the reason `setPrice` takes `price_unit_litres` as an argument: a
   * figure with no period is not a salary, and a default of 'month' would make
   * every forgotten dihari rate a thirtyfold overpayment that still looks like
   * a salary.
   */
  setTerm(
    engagementId: string,
    body: {
      effective_from: string;
      cash_minor: number;
      cash_period: 'month' | 'day';
      benefits?: {
        kind: string;
        quantity?: number | null;
        unit?: string | null;
        period?: string | null;
        note?: string | null;
      }[];
      note?: string | null;
      recorded_by: string;
    },
    idempotencyKey: string,
  ): Promise<PayTermWithBenefits> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/engagements/${engagementId}/terms`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  saveRun(body: Record<string, unknown>, idempotencyKey: string): Promise<{
    from_on: string; to_on: string; written: number; updated: number; total_minor: number;
  }> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/payroll/run`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  deleteWagePeriods(ids: string[], idempotencyKey: string): Promise<{ removed: number }> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/payroll/run/delete`, { ids }, RegistryApi.keyed(idempotencyKey),
    )));
  }

  recordWagePayment(body: Record<string, unknown>, idempotencyKey: string): Promise<{
    id: string; amount_minor: number; method: string;
  }> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/wage-payments`, body, RegistryApi.keyed(idempotencyKey),
    )));
  }

  deleteWagePayment(id: string, idempotencyKey: string): Promise<{ removed: number }> {
    return unwrap(firstValueFrom(this.http.post<never>(
      `${BASE}/wage-payments/${id}/delete`, {}, RegistryApi.keyed(idempotencyKey),
    )));
  }

}
