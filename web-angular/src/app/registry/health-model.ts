export interface HealthRecord {
  [key: string]: any;
  id: string;
  entity: string;
  revision: number;
  animal_id?: string;
  title?: string;
  name?: string;
  product_name?: string;
  reason?: string;
  instructions?: string;
  findings?: string;
  result?: string;
  occurred_on?: string;
  due_on?: string;
  due_time?: string;
  kind?: string;
  status?: string;
  archived?: boolean;
  plan_id?: string;
  visit_id?: string;
  case_id?: string;
  task_id?: string;
  product_id?: string;
  date_precision?: string;
  recorded_by?: string;
}

export interface HealthField {
  key: string;
  label: string;
  type?: 'date' | 'number' | 'time' | 'text' | 'textarea' | 'checkbox' | 'select';
  options?: string[];
  reference?: string;
  required?: boolean;
}
const date: HealthField[] = [
  {
    key: 'date_precision',
    label: 'How precisely is the date known?',
    type: 'select',
    options: ['day', 'month', 'year', 'estimated'],
    required: true,
  },
  {
    key: 'occurred_on',
    label: 'Date (month: first day; year/estimated: January 1)',
    type: 'date',
    required: true,
  },
  { key: 'occurred_time', label: 'Time, if known', type: 'time' },
];
const animal: HealthField = {
  key: 'animal_id',
  label: 'Animal',
  reference: 'animals',
  required: true,
};
const visit: HealthField = { key: 'visit_id', label: 'Veterinary visit', reference: 'visits' };
const caseField: HealthField = { key: 'case_id', label: 'Health case', reference: 'cases' };
const plan: HealthField = {
  key: 'plan_id',
  label: 'Treatment / vaccination plan',
  reference: 'plans',
};
export const HEALTH_FIELDS: Record<string, HealthField[]> = {
  visits: [
    ...date,
    { key: 'vet', label: 'Veterinarian (enter unknown if unavailable)', required: true },
    { key: 'reason', label: 'Reason for visit', type: 'textarea', required: true },
    {
      key: 'status',
      label: 'Visit status',
      type: 'select',
      options: ['open', 'closed'],
      required: true,
    },
  ],
  examinations: [
    animal,
    { ...visit, required: true },
    caseField,
    ...date,
    { key: 'findings', label: 'Observations / examination', type: 'textarea', required: true },
    { key: 'diagnosis', label: 'Diagnosis recorded by vet' },
    {
      key: 'certainty',
      label: 'Diagnosis certainty',
      type: 'select',
      options: ['suspected', 'confirmed'],
    },
    {
      key: 'recommendations',
      label: 'Recommendations / measurements with units',
      type: 'textarea',
    },
  ],
  cases: [
    animal,
    ...date,
    { key: 'title', label: 'Problem / case title', required: true },
    {
      key: 'status',
      label: 'Case status',
      type: 'select',
      options: ['open', 'resolved', 'closed'],
      required: true,
    },
    { key: 'outcome', label: 'Outcome', type: 'textarea' },
    { key: 'open_plans_reviewed', label: 'I reviewed remaining active plans', type: 'checkbox' },
  ],
  products: [
    { key: 'name', label: 'Product name', required: true },
    {
      key: 'kind',
      label: 'Product type',
      type: 'select',
      options: ['vaccine', 'medicine', 'other'],
      required: true,
    },
    { key: 'strength', label: 'Formulation / strength' },
    { key: 'archived', label: 'Archive from new selections', type: 'checkbox' },
  ],
  plans: [
    { key: 'series', label: 'Vaccine series / course label (optional)' },
    animal,
    visit,
    caseField,
    {
      key: 'kind',
      label: 'Plan type',
      type: 'select',
      options: ['treatment', 'vaccination'],
      required: true,
    },
    {
      key: 'instructions',
      label: 'Instructions from veterinarian',
      type: 'textarea',
      required: true,
    },
    { key: 'prescriber', label: 'Prescriber', required: true },
    {
      key: 'status',
      label: 'Plan status',
      type: 'select',
      options: ['active', 'completed', 'stopped'],
      required: true,
    },
  ],
  tasks: [
    { key: 'dose_label', label: 'Dose / booster label (optional)' },
    animal,
    plan,
    visit,
    {
      key: 'kind',
      label: 'Task type',
      type: 'select',
      options: ['administration', 'recheck', 'test'],
      required: true,
    },
    { key: 'instructions', label: 'Instructions', type: 'textarea', required: true },
    { key: 'product_id', label: 'Planned product (optional)', reference: 'products' },
    { key: 'due_on', label: 'Due date', type: 'date', required: true },
    { key: 'due_time', label: 'Due time, if specified', type: 'time' },
    { key: 'assignee', label: 'Assigned to' },
  ],
  administrations: [
    { key: 'dose_label', label: 'Dose / booster label (optional)' },
    animal,
    ...date,
    visit,
    { key: 'examination_id', label: 'Examination', reference: 'examinations' },
    caseField,
    plan,
    { key: 'task_id', label: 'Complete a planned dose', reference: 'tasks' },
    { key: 'product_id', label: 'Product from catalog (optional)', reference: 'products' },
    { key: 'product_name', label: 'Product name as administered', required: true },
    {
      key: 'kind',
      label: 'Product type',
      type: 'select',
      options: ['vaccine', 'medicine', 'other'],
      required: true,
    },
    { key: 'amount', label: 'Amount administered', type: 'number' },
    { key: 'unit', label: 'Unit (for example mL)' },
    { key: 'route', label: 'Administration route' },
    { key: 'administrator', label: 'Administered by' },
    { key: 'batch', label: 'Batch / lot' },
    { key: 'expiry', label: 'Product expiry, if known', type: 'date' },
    { key: 'details_unknown', label: 'Historical details are incomplete', type: 'checkbox' },
    { key: 'unknown_reason', label: 'Which details are unknown and why?' },
    { key: 'external_history_reason', label: 'Reason for history outside farm ownership' },
    { key: 'duplicate_reason', label: 'If a similar dose exists, why is this distinct?' },
  ],
  results: [
    animal,
    ...date,
    visit,
    caseField,
    { key: 'task_id', label: 'Follow-up task', reference: 'tasks' },
    {
      key: 'kind',
      label: 'Result type',
      type: 'select',
      options: ['test', 'follow_up'],
      required: true,
    },
    { key: 'result', label: 'Result / outcome', type: 'textarea', required: true },
  ],
  costs: [
    { ...animal, required: false },
    visit,
    { key: 'administration_id', label: 'Administration', reference: 'administrations' },
    ...date,
    {
      key: 'amount_minor',
      label: 'Amount in minor units (PKR: paisa); blank means unknown',
      type: 'number',
    },
    { key: 'currency', label: 'Currency (e.g. PKR)', required: true },
  ],
};
export function healthLabel(r: HealthRecord): string {
  return [
    r.animal_id,
    r.title ??
      r.name ??
      r.product_name ??
      r.reason ??
      r.instructions ??
      r.findings ??
      r.result ??
      r.entity,
    r.occurred_on ?? r.due_on,
  ]
    .filter(Boolean)
    .join(' · ');
}
export function healthWords(s: string): string {
  return s.replaceAll('_', ' ');
}
