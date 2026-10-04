import { isDataset, isPendingWrites, isAgentKind } from './custom-events';
import { TestBed } from '@angular/core/testing';
import { ChatStore } from './chat-store';
import { EventType } from '@ag-ui/core';
import { AGENT_DATASET_EVENT, AGENT_PENDING_EVENT, AGENT_SELECTION_EVENT } from '@dairy/shared';

it('validates every field consumed by charts and confirmation cards', () => {
  expect(isDataset({ datasetId: 'x', kind: 'timeseries', interval: 'day', scopeLabel: 'Farm', points: [] })).toBe(true);
  expect(isDataset({ datasetId: 'x', kind: 'timeseries', interval: ['day'], scopeLabel: 'Farm', points: [] })).toBe(false);
  expect(isDataset({ points: [null] })).toBe(false);
  expect(isPendingWrites([null])).toBe(false);
  expect(isPendingWrites([{ toolUseId: 'x', toolName: 'save', summary: 'Save', details: [{ label: 'A', value: 'B' }] }])).toBe(true);
  expect(isPendingWrites([{ toolUseId: 'x', toolName: 'save', summary: 'Save', details: [], rows: [null] }])).toBe(false);
  expect(isAgentKind('future')).toBe(false);
});
for (const [name, value] of [[AGENT_DATASET_EVENT, {}], [AGENT_PENDING_EVENT, [null]], [AGENT_SELECTION_EVENT, 'future']]) {
  it(`reports malformed ${name} without losing prior display state`, () => {
    const store = TestBed.inject(ChatStore);
    const pending = [{ toolUseId: 'old', toolName: 'save', summary: 'Save', details: [] }];
    store.pending.set(pending);
    expect(() => (store as any).handleEvent({ type: EventType.CUSTOM, name, value })).not.toThrow();
    expect(store.error()).toContain('Invalid');
    expect(store.pending()).toEqual(pending);
  });
}
