import type { AgentKind, Dataset, PendingWrite } from '@dairy/shared';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function isDataset(value: unknown): value is Dataset {
  return object(value) && typeof value['datasetId'] === 'string' && value['kind'] === 'timeseries' &&
    typeof value['scopeLabel'] === 'string' && typeof value['interval'] === 'string' && ['day', 'week', 'month'].includes(value['interval']) &&
    Array.isArray(value['points']) && value['points'].every(point => object(point) &&
      typeof point['periodStart'] === 'string' && finite(point['totalLitres']) && finite(point['avgPerAnimal']));
}
export function isPendingWrites(value: unknown): value is PendingWrite[] {
  return Array.isArray(value) && value.every(card => object(card) &&
    typeof card['toolUseId'] === 'string' && typeof card['toolName'] === 'string' &&
    typeof card['summary'] === 'string' && Array.isArray(card['details']) &&
    card['details'].every(detail => object(detail) && typeof detail['label'] === 'string' && typeof detail['value'] === 'string') &&
    (card['rows'] === undefined || (Array.isArray(card['rows']) && card['rows'].every(row => object(row) &&
      typeof row['tag'] === 'string' && typeof row['value'] === 'string' &&
      (row['name'] === undefined || typeof row['name'] === 'string')))));
}
export function isAgentKind(value: unknown): value is AgentKind {
  return value === 'dairy' || value === 'vendor' || value === 'both';
}
