// How a saved health record READS: what it is, when, the facts that matter,
// who recorded it and from what, and the ids last. It replaces a dump of every
// stored field ("entity: cases", "voided: false", ISO timestamps), which put
// the one line you came for under ten you never need.

import { HEALTH_FIELDS, type HealthField, type HealthRecord, type WithdrawalInstruction } from './health-model';
import type { HealthRevision } from './health-workflows';
import { readableParts } from './precision-display';
import { SOURCE_FORMS, feedLabel } from './feed-format';
import { farmMoment } from './today';
import type { DatePrecision } from './types';

/** Stored bookkeeping that is not a fact about the animal. */
const BOOKKEEPING = new Set([
  'id', 'entity', 'revision', 'voided', 'recorded_by', 'recorded_at', 'updated_at', 'source_form',
  'source_ref', 'occurred_on', 'date_precision', 'occurred_time', 'correction_reason', 'attachment_ids',
  'milk_withdrawal', 'meat_withdrawal', 'expected_revision', 'created_at',
]);

/** "14 Feb 2026", "Mar 2019 month" -- a date in words with its qualifier. */
export function healthDate(on: unknown, precision: unknown = 'day'): string {
  if (typeof on !== 'string' || !on) return '';
  const p = readableParts(on.slice(0, 10), (precision as DatePrecision) ?? 'day');
  return p.figure + (p.qualifier ? ' ' + p.qualifier : '');
}

/** The field label without its entry hint: "Veterinarian", not "Veterinarian (enter unknown if unavailable)". */
export function fieldName(f: HealthField): string {
  return f.label.replace(/\s*\(.*\)\s*$/, '').replace(/,? if (known|specified)$/, '').trim();
}

export interface HealthFact { label: string; value: string }
export interface HealthView {
  date: string;
  facts: HealthFact[];
  withdrawals: string[];
  recorded: string;
  ids: string[];
}

/** One stored value, in words. `lookup` names a referenced record. */
export function factValue(f: HealthField | undefined, key: string, value: unknown, lookup: (ref: string, id: string) => string | null): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (f?.reference && typeof value === 'string') return lookup(f.reference, value) ?? 'Linked record';
  if (typeof value === 'boolean') {
    if (key === 'archived' || key === 'details_unknown' || key === 'open_plans_reviewed') return value ? 'Yes' : null;
    return value ? 'Yes' : 'No';
  }
  if (f?.type === 'date' || /_on$/.test(key)) return healthDate(value);
  if (f?.type === 'select' || key === 'kind' || key === 'status') return feedLabel(String(value));
  if (typeof value === 'object') return null;
  return String(value);
}

export function withdrawalText(label: string, w: WithdrawalInstruction | undefined): string {
  if (!w || w.state === 'unknown') return `${label}: not recorded`;
  if (w.state === 'none') return `${label}: none, per ${w.issuer || 'the instruction'}`;
  const end = w.until ? 'until ' + farmMoment(w.until) : 'end not known, needs clarification';
  return [`${label}: ${w.instruction || 'specified'}`, end, w.issuer ? 'by ' + w.issuer : ''].filter(Boolean).join(' · ');
}

/** "Recorded by adnan · Direct entry · Synthetic harness health card · 8 Nov, 13:26". */
export function recordedText(r: Record<string, unknown>): string {
  const parts: string[] = [];
  if (r['recorded_by']) parts.push('Recorded by ' + r['recorded_by']);
  if (r['source_form']) parts.push(SOURCE_FORMS[String(r['source_form'])] ?? feedLabel(String(r['source_form'])));
  if (r['source_ref']) parts.push(String(r['source_ref']));
  if (r['recorded_at']) parts.push(farmMoment(String(r['recorded_at'])));
  return parts.join(' · ');
}

export function healthView(r: HealthRecord, lookup: (ref: string, id: string) => string | null): HealthView {
  const fields = HEALTH_FIELDS[r.entity] ?? [];
  const facts: HealthFact[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    seen.add(f.key);
    if (BOOKKEEPING.has(f.key)) continue;
    const v = factValue(f, f.key, r[f.key], lookup);
    if (v !== null) facts.push({ label: fieldName(f), value: v });
  }
  for (const [key, value] of Object.entries(r)) {
    if (seen.has(key) || BOOKKEEPING.has(key) || /_id$/.test(key)) continue;
    const v = factValue(undefined, key, value, lookup);
    if (v !== null) facts.push({ label: feedLabel(key), value: v });
  }
  const withdrawals =
    r.entity === 'administrations'
      ? [withdrawalText('Milk withdrawal', r.milk_withdrawal), withdrawalText('Meat withdrawal', r.meat_withdrawal)]
      : [];
  const ids = [`Record ${r.id}`, `Revision ${r.revision}`];
  for (const [key, value] of Object.entries(r))
    if (/_id$/.test(key) && key !== 'animal_id' && typeof value === 'string' && value) ids.push(`${feedLabel(key.replace(/_id$/, ''))} ${value}`);
  for (const id of r.attachment_ids ?? []) ids.push('Attachment ' + id);
  if (r['voided']) ids.push('Voided');
  const date = r.occurred_on
    ? healthDate(r.occurred_on, r.date_precision) + (r.occurred_time ? ', ' + r.occurred_time : '')
    : r.due_on
      ? 'Due ' + healthDate(r.due_on)
      : '';
  return { date, facts, withdrawals, recorded: recordedText(r), ids };
}

const OPERATIONS: Record<string, string> = { create: 'Recorded', revise: 'Corrected', void: 'Voided', action: 'Status changed' };

export interface RevisionView { head: string; reason: string | null; changes: string[] }

/**
 * One revision as what CHANGED from the one before it, not the whole record
 * again. The first revision lists what was recorded.
 */
export function revisionView(v: HealthRevision, previous: HealthRevision | null, entity: string, lookup: (ref: string, id: string) => string | null): RevisionView {
  const parse = (s: string | undefined) => {
    try {
      const x = s ? JSON.parse(s) : null;
      return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const after = parse(v.after_json);
  const before = previous ? parse(previous.after_json) : null;
  const fields = HEALTH_FIELDS[entity] ?? [];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const changes: string[] = [];
  const keys = [...new Set([...Object.keys(after), ...Object.keys(before ?? {})])];
  for (const key of keys) {
    if (BOOKKEEPING.has(key) && key !== 'occurred_on') continue;
    if (key === 'archived' || /_id$/.test(key) && !byKey.get(key)?.reference) continue;
    const f = byKey.get(key);
    const label = f ? fieldName(f) : feedLabel(key);
    const word = (x: Record<string, unknown>) =>
      key === 'occurred_on' ? healthDate(x[key], x['date_precision']) || null : factValue(f, key, x[key], lookup);
    const now = word(after);
    if (!before) {
      if (now) changes.push(`${label}: ${now}`);
      continue;
    }
    const was = word(before);
    if (was === now) continue;
    changes.push(`${label} changed from ${was ?? 'blank'} to ${now ?? 'blank'}`);
  }
  return {
    head: [`Revision ${v.revision}`, OPERATIONS[v.operation] ?? feedLabel(v.operation), farmMoment(v.recorded_at), v.recorded_by ? 'by ' + v.recorded_by : ''].filter(Boolean).join(' · '),
    reason: v.reason,
    changes,
  };
}
