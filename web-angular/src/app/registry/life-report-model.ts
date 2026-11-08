import { formatMinor } from './money';
import { healthWords } from './health-model';

// Explicit reading adapters; the untouched response remains the technical/export contract.
type RecordData = Record<string, any>;
export interface LifeSection {
  id: string;
  title: string;
  note: string;
  records: RecordData[];
  domain: string;
}
export function reportDate(on: string | null | undefined, precision = 'day'): string {
  if (!on) return 'Date not recorded';
  if (precision === 'estimated') return 'Approximately ' + on.slice(0, 4);
  if (precision === 'year') return on.slice(0, 4) + ' (year known)';
  const d = new Date(on.slice(0, 10) + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime())) return on;
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      ...(precision === 'month' ? {} : { day: 'numeric' }),
    }).format(d) + (precision === 'month' ? ' (month known)' : '')
  );
}
export function lifeSections(r: any): LifeSection[] {
  const collection = (key: string) => r.sections?.[key]?.records ?? [];
  const note = (...keys: string[]) =>
    keys
      .map((k) => r.sections?.[k]?.note)
      .filter(Boolean)
      .join(' ');
  const result: LifeSection[] = [
    {
      id: 'identity',
      title: 'Identity and provenance',
      domain: 'identity',
      records: collection('parentage'),
      note: 'Current identity above; recorded parentage below. Identity events appear in Timeline.',
    },
    {
      id: 'timeline',
      title: 'Timeline',
      domain: 'timeline',
      records: r.timeline ?? collection('life_events'),
      note: note('life_events'),
    },
    {
      id: 'calvings',
      title: 'Calvings and reproduction',
      domain: 'event',
      records: collection('reproduction'),
      note: note('reproduction'),
    },
    {
      id: 'milk',
      title: 'Milk',
      domain: 'milk',
      records: collection('production'),
      note: note('production'),
    },
    {
      id: 'lactations',
      title: 'Lactations',
      domain: 'lactation',
      records: collection('lactations'),
      note: note('lactations'),
    },
    {
      id: 'health',
      title: 'Health records',
      domain: 'health',
      records: collection('health'),
      note: note('health'),
    },
    {
      id: 'visits',
      title: 'Veterinary visits',
      domain: 'health',
      records: collection('veterinary_visits'),
      note: note('veterinary_visits'),
    },
    { id: 'feed', title: 'Feed', domain: 'feed', records: collection('feed'), note: note('feed') },
  ];
  for (const [key, title] of [
    ['financial', 'Direct health costs'],
    ['shared_visit_costs', 'Shared visit costs'],
  ]) {
    if (r.sections?.[key])
      result.push({ id: key, title, domain: 'cost', records: collection(key), note: note(key) });
  }
  if (r.corrections) {
    result.push({
      id: 'event-corrections',
      title: 'Superseded animal events',
      domain: 'event',
      records: r.corrections.animal_events ?? [],
      note: 'Corrected originals, in the order returned by the report. Effective events remain in Timeline.',
    });
    const revisions: RecordData[] = r.corrections.health ?? [];
    const latest = new Map<string, number>();
    for (const revision of revisions)
      latest.set(
        revision['record_id'],
        Math.max(latest.get(revision['record_id']) ?? 0, revision['revision']),
      );
    result.push({
      id: 'health-revisions',
      title: 'Health revision history',
      domain: 'health',
      records: revisions.map((revision) => ({
        ...revision,
        record: parseRecord(revision['after_json']),
        audit_state:
          revision['revision'] === latest.get(revision['record_id'])
            ? 'Latest retained revision'
            : 'Superseded revision',
      })),
      note: 'All returned revisions, including creation, corrections and voids. Original before/after JSON is retained in Technical audit.',
    });
  }
  return result;
}
function parseRecord(value: unknown): RecordData | undefined {
  try {
    const record = typeof value === 'string' ? JSON.parse(value) : value;
    return record && typeof record === 'object' && !Array.isArray(record) ? record : undefined;
  } catch {
    return undefined;
  }
}
const HEALTH: Record<string, string> = {
  visits: 'Veterinary visit',
  examinations: 'Examination',
  cases: 'Health case',
  plans: 'Care plan',
  tasks: 'Health task',
  administrations: 'Administration',
  results: 'Result',
  costs: 'Recorded cost',
};
export function lifeSummary(original: RecordData, domain: string): string[] {
  const r = original['record'] ?? original;
  const payload = r.payload && typeof r.payload === 'object' ? r.payload : {};
  const lines: string[] = [];
  const add = (label: string, value: any) => {
    if (value !== null && value !== undefined && value !== '') lines.push(`${label}: ${value}`);
  };
  const event = ['birth', 'acquired', 'calving', 'dry_off', 'departure', 'note'].includes(r.type);
  const known =
    event || HEALTH[r.entity] || ['identity', 'milk', 'lactation', 'feed', 'cost'].includes(domain);
  if (!known)
    return [
      'Additional record · see Technical audit for complete original fields.',
      ...provenanceLines(r),
    ];
  const title = event
    ? healthWords(r.type)
    : (HEALTH[r.entity] ??
      (
        {
          identity: 'Parentage',
          milk: 'Milking',
          lactation: 'Lactation',
          feed: 'Shared feeding',
          cost: 'Recorded cost',
        } as Record<string, string>
      )[domain]);
  lines.push(title);
  add(
    original['date_basis'] === 'recorded'
      ? 'Recorded date'
      : original['date_basis'] === 'scheduled'
        ? 'Scheduled date'
        : 'Date',
    reportDate(
      r.occurred_on ?? r.on ?? r.started_on ?? original['on'],
      r.date_precision ?? r.start_precision ?? original['date_precision'],
    ),
  );
  add('Subject', r.animal_id ?? r.child_id);
  if (r.effective !== undefined) add('Record state', r.effective ? 'Effective' : 'Superseded');
  if (original['audit_state']) {
    add('Revision state', original['audit_state']);
    add('Operation', original['operation']);
    add('Correction reason', original['reason']);
  }
  if (r.voided !== undefined)
    add(
      'Record state',
      r.voided
        ? 'Voided'
        : original['audit_state']
          ? 'Not voided at this revision'
          : 'Current revision',
    );
  if (event) {
    for (const [key, label] of [
      ['calf_id', 'Calf'],
      ['calf_sex', 'Calf sex'],
      ['dam_id', 'Dam'],
      ['sire_ref', 'Sire'],
      ['outcome', 'Outcome'],
      ['assistance', 'Assistance'],
      ['from', 'Acquired from'],
      ['reason', 'Reason'],
      ['to', 'Destination'],
      ['cause', 'Cause'],
      ['notes', 'Notes'],
      ['text', 'Note'],
    ])
      add(label, payload[key]);
    if (payload.estimated_birth_on)
      add('Birth date', reportDate(payload.estimated_birth_on, payload.estimated_birth_precision));
  } else if (domain === 'milk') {
    add('Session', r.session);
    add(
      'Measurement',
      r.status === 'measured'
        ? `${r.yield_litres} L`
        : r.status === 'not_milked'
          ? 'Not milked'
          : r.status === 'milked_not_measured'
            ? 'Milked, no measurement'
            : 'See Technical audit',
    );
  } else if (domain === 'feed') {
    add('Item', r.item_name);
    add(
      'Quantity',
      r.quantity === null
        ? 'Unknown quantity'
        : r.quantity === undefined
          ? 'Not recorded'
          : `${r.quantity} ${r.unit ?? ''}`,
    );
    add('Recipients', (r.animal_ids ?? []).join(', ') || 'Not recorded');
    add('Recipient group', r.recipients);
    add('Notes', r.note);
    lines.push('Shared feed quantity; individual intake is not measured.');
  } else if (domain === 'identity') {
    add('Parent', r.parent_ref);
    add('Relationship', r.relation);
    add('Confidence', r.certainty);
  } else if (domain === 'lactation') {
    add('Ended', r.ended_on ? reportDate(r.ended_on, r.end_precision) : 'No end recorded');
    add('Start precision', r.start_precision);
    add('End reason', r.end_reason ? healthWords(r.end_reason) : null);
  }
  if (HEALTH[r.entity]) {
    for (const [key, label] of [
      ['title', 'Subject'],
      ['kind', 'Type'],
      ['status', 'Status'],
      ['vet', 'Veterinarian'],
      ['reason', 'Purpose / reason'],
      ['findings', 'Findings'],
      ['diagnosis', 'Diagnosis'],
      ['certainty', 'Certainty'],
      ['instructions', 'Instructions'],
      ['prescriber', 'Prescriber'],
      ['assignee', 'Assigned to'],
      ['product_name', 'Product'],
      ['route', 'Route'],
      ['batch', 'Batch'],
      ['administrator', 'Administered by'],
      ['result', 'Result'],
      ['outcome', 'Outcome'],
      ['unknown_reason', 'Unknown details'],
      ['external_history_reason', 'Historical evidence'],
    ])
      add(label, r[key]);
    if (r.due_on) add('Due', reportDate(r.due_on));
    if ('amount' in r) add('Amount', r.amount === null ? 'Unknown' : `${r.amount} ${r.unit ?? ''}`);
    for (const target of ['milk', 'meat']) {
      const w = r[target + '_withdrawal'];
      if (w)
        add(
          healthWords(target) + ' withdrawal',
          `${w.state === 'none' ? 'Explicitly none' : w.state === 'unknown' ? 'Unknown; needs clarification' : w.state} · ${w.instruction ?? 'Instruction not recorded'} · ${w.until ?? 'End not recorded'} · Issuer ${w.issuer ?? 'unknown'}`,
        );
    }
  }
  if (domain === 'cost' || r.entity === 'costs')
    add('Recorded cost', reportMoney(r.amount_minor, r.currency));
  return lines;
}
function reportMoney(minor: number | null, currency: string): string {
  if (minor == null) return 'Unknown';
  if (currency === 'PKR') return formatMinor(minor);
  try {
    const formatter = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    });
    return formatter.format(minor / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
  } catch {
    return 'See Technical audit for original currency and amount';
  }
}
export function provenanceLines(record: RecordData): string[] {
  const r = record['record'] ?? record;
  return [
    `Record: ${r.id ?? 'Not supplied'}`,
    `Recorded by: ${r.recorded_by ?? 'Not recorded'}`,
    `Source: ${r.source_ref ?? r.source_form ?? 'Not recorded'}`,
    ...[
      'observed_by',
      'recorded_at',
      'revision',
      'correction_reason',
      'summary_id',
      'source_event_id',
      'opened_by_event_id',
      'closed_by_event_id',
      'supersedes_id',
      'superseded_by_id',
      'visit_id',
      'case_id',
      'plan_id',
      'task_id',
      'engagement_id',
    ]
      .filter((k) => r[k] != null)
      .map((k) => `${healthWords(k)}: ${r[k]}`),
  ];
}

// ---------------------------------------------------------------------------
// ONE LINE PER RECORD
// ---------------------------------------------------------------------------
// The report showed every record as a stack of "Label: value" lines, five to
// eight per record, repeating "Subject: BD-0001" and "Record state: Effective"
// on a report that is already about her. `lifeRow` reads the same adapter
// output (`lifeSummary`, so every domain keeps its wording and its states) and
// lays it out as one row: when, what, the details, and -- only when it is not
// the normal case -- the record's state.

export interface LifeRow {
  date: string;
  title: string;
  facts: string[];
  /** Superseded, voided or a revision state. Null for the ordinary case. */
  state: string | null;
}

const ORDINARY_STATE = new Set(['Record state: Effective', 'Record state: Current revision']);

export function lifeRow(record: RecordData, domain: string, animalId?: string): LifeRow {
  const lines = lifeSummary(record, domain);
  const [first, ...rest] = lines;
  let date = '';
  let state: string | null = null;
  const facts: string[] = [];
  let due = '';
  for (const line of rest) {
    const m = /^(Date|Recorded date|Scheduled date): (.*)$/.exec(line);
    if (m && !date) { date = m[2]; continue; }
    if (animalId && line === `Subject: ${animalId}`) continue;
    if (ORDINARY_STATE.has(line)) continue;
    if (/^(Record state|Revision state): /.test(line)) {
      state = state ? `${state} · ${line.split(': ')[1]}` : line.split(': ')[1];
      continue;
    }
    if (line.startsWith('Due: ')) { due = line.slice(5); continue; }
    facts.push(line);
  }
  // A task has a due date, not an occurred one: "Date not recorded" beside a
  // due date read as a missing fact when it was simply the wrong field.
  if ((!date || date === 'Date not recorded') && due) date = 'Due ' + due;
  else if (due) facts.push('Due: ' + due);
  return {
    date: date || 'Date not recorded',
    title: first ? first.charAt(0).toUpperCase() + first.slice(1) : '',
    facts,
    state,
  };
}

/** "Recorded by adnan · Cycle card (card-01)" -- the provenance that stays in print. */
export function recordedLine(record: RecordData): string {
  const r = record['record'] ?? record;
  const parts: string[] = [];
  if (r.recorded_by) parts.push('Recorded by ' + r.recorded_by);
  if (r.observed_by) parts.push('seen by ' + r.observed_by);
  const form = r.source_form ? healthWords(r.source_form) : '';
  const source = r.source_ref ? (form ? `${form} (${r.source_ref})` : r.source_ref) : form;
  if (source) parts.push(source.charAt(0).toUpperCase() + source.slice(1));
  return parts.join(' · ');
}

/** "1 record", "3 records". */
export function recordCount(n: number): string {
  return `${n} ${n === 1 ? 'record' : 'records'}`;
}

// ---------------------------------------------------------------------------
// THE SUMMARY AT THE TOP
// ---------------------------------------------------------------------------
// What someone opens a lifetime report to learn, from fields the response
// already carries. Nothing here is computed from absent records: a missing
// count stays missing rather than becoming zero.

export interface LifeFact {
  label: string;
  value: string;
  note?: string;
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function lifeFacts(r: any, today: string): LifeFact[] {
  const status = r.current_snapshot?.status ?? {};
  const facts: LifeFact[] = [];
  if (status.birth_on) {
    const years = Math.floor(daysBetween(status.birth_on, today) / 365.25);
    const exact = status.birth_precision === 'day';
    facts.push({
      label: 'Born',
      value: reportDate(status.birth_on, status.birth_precision),
      note: years >= 0 ? `${exact ? '' : 'about '}${years} ${years === 1 ? 'year' : 'years'} old` : undefined,
    });
  } else facts.push({ label: 'Born', value: 'Not recorded' });

  facts.push({ label: 'Calvings', value: status.parity == null ? 'Not recorded' : String(status.parity) });

  const calvings = (r.sections?.reproduction?.records ?? []).filter(
    (e: RecordData) => e['type'] === 'calving' && e['effective'] !== false,
  );
  const last = calvings
    .map((e: RecordData) => e['occurred_on'] as string)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (last) {
    const lastRecord = calvings.find((e: RecordData) => e['occurred_on'] === last)!;
    facts.push({ label: 'Last calving', value: reportDate(last, lastRecord['date_precision']) });
  }

  const open = (r.sections?.lactations?.records ?? []).find(
    (l: RecordData) => l['id'] === status.open_lactation_id,
  );
  if (open?.started_on && open.start_precision === 'day') {
    facts.push({ label: 'In milk', value: `Day ${daysBetween(open.started_on, today)}`, note: 'of this lactation' });
  } else if (status.status) {
    facts.push({ label: 'Now', value: healthWords(status.status) });
  }

  const t = r.totals ?? {};
  if (t.measured_litres != null) {
    const parts = [`${t.measured_sessions ?? 0} measured`];
    if (t.unmeasured_sessions) parts.push(`${t.unmeasured_sessions} not measured`);
    if (t.not_milked_sessions) parts.push(`${t.not_milked_sessions} not milked`);
    facts.push({
      label: r.filters?.from || r.filters?.to ? 'Milk in range' : 'Milk recorded',
      value: `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(t.measured_litres)} L`,
      note: parts.join(' · ') + ' sessions',
    });
  }

  const tasks = (r.health?.records ?? []).filter(
    (h: RecordData) => h['entity'] === 'tasks' && h['status'] === 'pending',
  );
  const overdue = tasks.filter((h: RecordData) => h['due_on'] && h['due_on'] < today).length;
  const withdrawals = (r.health?.withdrawals ?? []).length;
  const healthParts: string[] = [];
  if (overdue) healthParts.push(`${overdue} overdue`);
  if (withdrawals) healthParts.push(`${withdrawals} ${withdrawals === 1 ? 'withdrawal' : 'withdrawals'}`);
  facts.push({
    label: 'Health tasks open',
    value: String(tasks.length),
    note: healthParts.join(' · ') || undefined,
  });
  return facts;
}

/** A pending task's standing against today, for its badge. */
export function taskStanding(due: string | null | undefined, today: string): 'overdue' | 'today' | 'upcoming' | 'undated' {
  if (!due) return 'undated';
  return due < today ? 'overdue' : due === today ? 'today' : 'upcoming';
}

/** "Meat withdrawal · Demonstration vaccine · end not known, needs clarification". */
export function withdrawalLine(w: RecordData): string {
  const target = w['target'] ? healthWords(w['target']) : 'Unknown';
  const parts = [`${target.charAt(0).toUpperCase() + target.slice(1)} withdrawal`];
  if (w['product_name']) parts.push(w['product_name']);
  if (w['instruction']) parts.push(w['instruction']);
  parts.push(w['until'] ? 'until ' + reportDate(w['until']) : 'end not known, needs clarification');
  return parts.join(' · ');
}

/**
 * One parentage record in words, from this animal's side: "Mother of BD-0018",
 * or "Dam: BD-0003" when the record is about her own parent. Confidence is
 * kept only when it is not "known".
 */
export function familyLine(r: RecordData, animalId: string): string {
  const relation = String(r['relation'] ?? 'parent');
  const sure = r['certainty'] && r['certainty'] !== 'known' ? ` (${healthWords(r['certainty'])})` : '';
  if (r['parent_ref'] === animalId && r['child_id'])
    return `${relation === 'dam' ? 'Mother' : relation === 'sire' ? 'Father' : 'Parent'} of ${r['child_id']}${sure}`;
  const label = relation.charAt(0).toUpperCase() + relation.slice(1);
  return `${label}: ${r['parent_ref'] ?? 'not recorded'}${sure}`;
}
