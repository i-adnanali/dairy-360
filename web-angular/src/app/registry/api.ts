// Registry API client. The first HttpClient in this app -- everything before
// this cycle went through @ag-ui/client's SSE transport.

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  AnimalDetail, HerdRow, LinkCandidate, StorageInfo, TimelineEvent, Verification, WireError,
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

  damCandidates(): Promise<LinkCandidate[]> {
    return unwrap(
      firstValueFrom(this.http.get<{ candidates: LinkCandidate[] }>(`${BASE}/dam-candidates`)),
    ).then((r) => r.candidates);
  }

  verification(): Promise<Verification> {
    return unwrap(firstValueFrom(this.http.get<Verification>(`${BASE}/verification`)));
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

  addAnimal(body: Record<string, unknown>): Promise<{ animal_id: string; animal: AnimalDetail }> {
    return unwrap(firstValueFrom(this.http.post<{ animal_id: string; animal: AnimalDetail }>(`${BASE}/animals`, body)));
  }

  addEvent(body: Record<string, unknown>): Promise<{ event_id: string; animal: AnimalDetail }> {
    return unwrap(firstValueFrom(this.http.post<{ event_id: string; animal: AnimalDetail }>(`${BASE}/events`, body)));
  }

  recordCalving(body: Record<string, unknown>): Promise<{
    calf_id: string; linked: boolean; superseded_origin_event_id: string | null;
    dam: AnimalDetail; calf: AnimalDetail;
  }> {
    return unwrap(firstValueFrom(this.http.post<never>(`${BASE}/calvings`, body)));
  }

  correctCalving(eventId: string, body: Record<string, unknown>): Promise<{
    dam_id: string; calf_id: string; calving_event_id: string; birth_event_id: string;
    departure_event_id: string | null;
    superseded: { calving_event_id: string; birth_event_id: string; departure_event_id: string | null };
  }> {
    return unwrap(
      firstValueFrom(this.http.post<never>(`${BASE}/calvings/${eventId}/correction`, body)),
    );
  }
}
