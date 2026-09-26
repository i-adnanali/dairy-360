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
