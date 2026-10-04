import type { HealthRecord } from './health-model';
import { healthWords } from './health-model';
import type { WithdrawalNotice } from './withdrawal-notices/withdrawal-notices';

export interface HealthTask extends HealthRecord {
  entity: 'tasks';
  kind: string;
  status: string;
  standing: string;
  due_on: string;
  animal_name?: string;
  assignee?: string;
  needs_review?: boolean;
}
export interface HealthBoard {
  on: string;
  tasks: HealthTask[];
  overdue: number;
  due: number;
  upcoming: number;
  open_cases: HealthRecord[];
  withdrawals: WithdrawalNotice[];
}
export interface HealthRevision {
  id: string;
  revision: number;
  operation: string;
  recorded_at: string;
  recorded_by: string;
  reason: string | null;
  after_json: string;
}
export interface VaccinationRound {
  visit_id?: string;
  occurred_on?: string;
  product_name?: string;
  batch?: string;
  amount?: number | null;
  unit?: string;
  route?: string;
  administrator?: string;
}
export interface VaccinationRow {
  disposition: '' | 'given' | 'deferred' | 'not_given';
  reason?: string;
  due_on?: string;
}
/** Validates row completeness without owning drafts, requests or retry keys. */
export function vaccinationRows(rows: Record<string, VaccinationRow>) {
  if (Object.values(rows).some(row => !row.disposition &&
    Object.values(row).some(value => value !== '' && value != null))) {
    throw new Error('Choose a disposition for each vaccination row you started, or clear that row.');
  }
  return Object.entries(rows).filter(([, row]) => row.disposition)
    .map(([animal_id, row]) => ({ ...row, animal_id }));
}
export function revisionLines(revision: HealthRevision): string[] {
  const value: unknown = JSON.parse(revision.after_json);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).filter(([key, entry]) => typeof entry !== 'object' &&
    !['id', 'entity', 'revision'].includes(key)).map(([key, entry]) => `${healthWords(key)}: ${entry}`);
}
export async function attachmentBase64(file: File, linkedCount: number): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Maximum file size is 10 MiB.');
  if (linkedCount >= 10) throw new Error('Maximum ten attachments.');
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
