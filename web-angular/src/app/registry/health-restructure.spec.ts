// The Health restructure: one panel for every view and form, a saved record
// read in words, history as what changed, and a To do page that says what
// needs doing first.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HealthPage } from './health-page/health-page';
import { RegistryApi } from './api';
import { Session } from './session';
import { healthView, revisionView } from './health-view';
import { healthLabel } from './health-model';

const caseRecord = {
  id: '0c1a7eb3', entity: 'cases', revision: 1, animal_id: 'BD-0001', title: 'Observation requiring follow-up',
  status: 'open', occurred_on: '2026-11-06', date_precision: 'day', recorded_by: 'health_fixture',
  source_form: 'direct_entry', source_ref: 'Synthetic harness health card', recorded_at: '2026-11-08T13:26:14.577Z', voided: false,
} as any;
const lookup = (ref: string, id: string) => (ref === 'animals' ? id + ' Noori' : null);

describe('a saved health record, read', () => {
  it('reads in words, with the bookkeeping out of the facts and the ids last', () => {
    const v = healthView(caseRecord, lookup);
    expect(v.date).toBe('6 Nov 2026');
    const text = v.facts.map((f) => f.label + ': ' + f.value).join('\n');
    expect(text).toContain('Animal: BD-0001 Noori');
    expect(text).toContain('Problem / case title: Observation requiring follow-up');
    expect(text).toContain('Case status: Open');
    for (const gone of ['entity', 'voided', 'recorded at', '2026-11-08T', 'Revision']) expect(text).not.toContain(gone);
    expect(v.recorded).toBe('Recorded by health_fixture · Direct entry · Synthetic harness health card · 8 Nov, 18:26');
    expect(v.ids[0]).toBe('Record 0c1a7eb3');
  });

  it('states a dose withdrawal with an unknown end as needing clarification', () => {
    const v = healthView({ id: 'a', entity: 'administrations', revision: 1, milk_withdrawal: { state: 'specified', instruction: '3 days' }, meat_withdrawal: { state: 'unknown' } } as any, lookup);
    expect(v.withdrawals).toEqual(['Milk withdrawal: 3 days · end not known, needs clarification', 'Meat withdrawal: not recorded']);
  });

  it('labels a record with its date in words, never ISO', () => {
    expect(healthLabel(caseRecord)).toBe('BD-0001 · Observation requiring follow-up · 6 Nov 2026');
  });

  it('reads a correction as what changed, not the whole record again', () => {
    const first = { id: 'r1', revision: 1, operation: 'create', recorded_at: '2026-11-08T13:26:14Z', recorded_by: 'adnan', reason: null, after_json: JSON.stringify({ status: 'open', reason: 'Round', vet: 'Dr A' }) };
    const second = { ...first, id: 'r2', revision: 2, operation: 'revise', reason: 'Visit finished', after_json: JSON.stringify({ status: 'closed', reason: 'Round', vet: 'Dr A' }) };
    const v = revisionView(second as any, first as any, 'visits', lookup);
    expect(v.head).toBe('Revision 2 · Corrected · 8 Nov, 18:26 · by adnan');
    expect(v.changes).toEqual(['Visit status changed from Open to Closed']);
    expect(revisionView(first as any, null, 'visits', lookup).changes).toContain('Veterinarian: Dr A');
  });
});

describe('the health page', () => {
  const task = (id: string, standing: string) => ({ id, entity: 'tasks', animal_id: 'BD-0001', instructions: id, kind: 'administration', standing, due_on: '2026-11-08', status: 'pending', revision: 1 });
  const board = {
    tasks: [task('t1', 'overdue'), task('t2', 'due'), task('t3', 'upcoming')], overdue: 1, due: 1, upcoming: 1,
    open_cases: [caseRecord],
    withdrawals: [{ animal_id: 'BD-0001', target: 'meat', status: 'clarify' }],
  };
  async function mount() {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: RegistryApi, useValue: {
          healthGet: (path: string) => Promise.resolve(path.includes('/board') ? structuredClone(board) : path === 'health/cases' ? [caseRecord] : []),
          herd: () => Promise.resolve([{ id: 'BD-0001', name: 'Noori' }]),
          healthWrite: vi.fn(),
        } },
      ],
    });
    TestBed.inject(Session).set('direct_entry', 'adnan');
    const f = TestBed.createComponent(HealthPage);
    await f.whenStable(); f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any };
  }
  afterEach(() => TestBed.resetTestingModule());

  it('says what needs doing in one line, withdrawals before tasks, cases as rows', async () => {
    const { el } = await mount();
    expect(el.querySelector('[data-role="health-summary"]')!.textContent!.replace(/\s+/g, ' ')).toContain(
      '1 overdue · 1 due today · 1 upcoming · 1 withdrawal needing attention · 1 open case',
    );
    const headings = Array.from(el.querySelectorAll('.health-block-title')).map((h) => h.textContent!.trim().split(/\s+/)[0]);
    expect(headings).toEqual(['Withdrawals', 'Outstanding', 'Open']);
    expect(el.querySelector('[data-role="case-row"]')!.textContent).toContain('Opened 6 Nov 2026');
  });

  it('opens Review case in the panel, reading in words, and closes back to the row', async () => {
    const { f, el } = await mount();
    document.body.append(el);
    const review = el.querySelector<HTMLButtonElement>('[data-role="review-case"]')!;
    review.focus();
    review.click();
    await f.whenStable(); f.detectChanges();
    const panel = el.querySelector('[data-role="health-panel"]')!;
    expect(panel.querySelector('#health-panel-title')!.textContent).toBe('Health case');
    expect(panel.textContent).toContain('BD-0001 Noori · Observation requiring follow-up');
    expect(panel.querySelector('[data-role="saved-facts"]')!.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(el.querySelector('[data-role="case-row"]')!.hasAttribute('data-current')).toBe(true);
    panel.querySelector<HTMLButtonElement>('.panel-close')!.click();
    await f.whenStable(); f.detectChanges();
    expect(el.querySelector('[data-role="health-panel"]')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(review);
    el.remove();
  });

  it('starts a completion with the task named at the top, and a Today shortcut', async () => {
    const { f, el, c } = await mount();
    el.querySelector<HTMLButtonElement>('[data-role="complete-task"]')!.click();
    await f.whenStable(); f.detectChanges();
    const panel = el.querySelector('[data-role="health-panel"]')!;
    expect(panel.querySelector('#health-panel-title')!.textContent).toBe('Record completion');
    expect(panel.querySelector('[data-role="completing"]')!.textContent).toContain('t1');
    expect(c.form.occurred_on).toBeUndefined();
    panel.querySelector<HTMLButtonElement>('[data-role="date-today"]')!.click();
    expect(c.form.occurred_on).toBe(c.today);
    expect(c.form.date_precision).toBe('day');
  });

  it('shows the animal filter on every view with a way to clear it', async () => {
    const { f, el, c } = await mount();
    c.animalFilter = 'BD-0001';
    c.setTab('records');
    f.detectChanges();
    expect(el.querySelector('[data-role="animal-chip"]')!.textContent).toContain('Showing only BD-0001 Noori');
    el.querySelector<HTMLButtonElement>('[data-role="animal-chip"] button')!.click();
    f.detectChanges();
    expect(c.animalFilter).toBe('');
    expect(el.querySelector('[data-role="animal-chip"]')).toBeNull();
    // The record types are visible choices with counts.
    expect(el.querySelector('.record-types [data-entity="cases"]')!.textContent).toContain('1');
  });
});

describe('arriving on Health from a link', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('marks the task Today linked to, on the To do view', async () => {
    const { BehaviorSubject } = await import('rxjs');
    const { ActivatedRoute, convertToParamMap } = await import('@angular/router');
    const q = new BehaviorSubject(convertToParamMap({ animal: 'BD-0001', task: 't2', tab: 'records' }));
    const board = { tasks: [{ id: 't1', entity: 'tasks', animal_id: 'BD-0001', kind: 'administration', standing: 'overdue', due_on: '2026-11-07', status: 'pending', revision: 1 },
      { id: 't2', entity: 'tasks', animal_id: 'BD-0001', kind: 'recheck', standing: 'due', due_on: '2026-11-08', status: 'pending', revision: 1 }],
      overdue: 1, due: 1, upcoming: 0, open_cases: [], withdrawals: [] };
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]),
      { provide: ActivatedRoute, useValue: { queryParamMap: q, snapshot: { queryParamMap: q.value } } },
      { provide: RegistryApi, useValue: { herd: async () => [], healthGet: async (p: string) => (p.includes('/board') ? board : []) } }] });
    const f = TestBed.createComponent(HealthPage);
    await f.whenStable(); f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect((f.componentInstance as any).tab).toBe('todo');
    expect(el.querySelector('[data-task="t2"]')!.hasAttribute('data-current')).toBe(true);
    expect(el.querySelector('[data-task="t1"]')!.hasAttribute('data-current')).toBe(false);
    // The deferred focus runs without CSS.escape (jsdom has none) and lands on
    // the linked task's own action. It used to throw after the test ended,
    // which failed CI as an unhandled error while every test passed.
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(el.querySelector('[data-task="t2"] [data-role="complete-task"]'));
  });
});
