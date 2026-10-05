import { BehaviorSubject } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HealthPage } from "./health-page/health-page";
import { RegistryApi, ApiError } from './api';
import { Session } from './session';
import { routes } from '../app.routes';

describe('health management', () => {
  let write: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    write = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: RegistryApi,
          useValue: {
            healthGet: (path: string) =>
              Promise.resolve(
                path.includes('/board')
                  ? { tasks: [], overdue: 0, due: 0, upcoming: 0, open_cases: [], withdrawals: [] }
                  : [],
              ),
            herd: () => Promise.resolve([]),
            healthWrite: write,
          },
        },
      ],
    });
  });
  it('orders server standings stably and shows terminal tasks without completion actions', async () => {
    const f = TestBed.createComponent(HealthPage), c = f.componentInstance as any;
    await f.whenStable();
    const task = (id: string, standing: string, due_on: string, status = 'pending') => ({id, animal_id:'BD-0001', instructions:id, kind:'administration', standing, due_on, status, assignee:'Ali'});
    c.board.set({ overdue:2, due:1, upcoming:1, withdrawals:[], open_cases:[], tasks:[
      task('future','upcoming','2026-09-20'), task('today','due','2026-09-17'),
      task('b','overdue','2026-09-16'), task('a','overdue','2026-09-16'),
      task('done','completed','2026-09-10','completed'), task('cancelled','cancelled','2026-09-10','cancelled')
    ] }); f.detectChanges();
    expect(c.visibleTasks().map((t: any) => t.id)).toEqual(['a','b','today','future']);
    expect(f.nativeElement.textContent).toContain('Assigned to Ali');
    const select = f.nativeElement.querySelector('select[ng-reflect-name]') ?? Array.from(f.nativeElement.querySelectorAll('select') as NodeListOf<HTMLSelectElement>).find(s => s.textContent?.includes('All outstanding'))!;
    select.value = 'completed'; select.dispatchEvent(new Event('change')); await f.whenStable(); f.detectChanges();
    expect(c.visibleTasks().map((t: any) => t.id)).toEqual(['done']);
    expect(f.nativeElement.querySelector('.health-task').textContent).toContain('Completed');
    expect(f.nativeElement.querySelector('.health-task button')).toBeNull();
    select.value = 'cancelled'; select.dispatchEvent(new Event('change')); await f.whenStable(); f.detectChanges();
    expect(c.visibleTasks().map((t: any) => t.id)).toEqual(['cancelled']);
  });

  it('reveals dose exceptions without erasing entered historical explanations', async () => {
    const f = TestBed.createComponent(HealthPage), c = f.componentInstance as any;
    await f.whenStable();
    TestBed.inject(Session).set('direct_entry', 'operator');
    await c.create('administrations');
    await f.whenStable();
    f.detectChanges();
    const control = (key: string) => f.nativeElement.querySelector('#health-' + key) as HTMLInputElement;
    const field = (key: string) => control(key).closest('.field-group') as HTMLElement;
    expect(field('unknown_reason').hidden).toBe(true);
    control('details_unknown').click();
    await f.whenStable();
    expect(field('unknown_reason').hidden).toBe(false);
    control('unknown_reason').value = 'Original record lacks the batch';
    control('unknown_reason').dispatchEvent(new Event('input'));
    await f.whenStable();
    control('details_unknown').click();
    await f.whenStable();
    expect(field('unknown_reason').hidden).toBe(false);
    expect(c.form.unknown_reason).toBe('Original record lacks the batch');
    expect(field('duplicate_reason').hidden).toBe(true);
    Array.from(f.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(b => b.textContent?.includes('Add outside-ownership'))!.click();
    await f.whenStable();
    expect(field('duplicate_reason').hidden).toBe(false);
  });

  it('gates forms and submissions until provenance is set, preserving the draft', async () => {
    const f = TestBed.createComponent(HealthPage),
      c = f.componentInstance as any;
    await f.whenStable();
    Array.from(f.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.trim() === 'Start vet visit')!
      .click();
    await f.whenStable();
    c.form.vet = 'Doctor';
    f.detectChanges();
    expect(f.nativeElement.querySelector('app-session-required')).not.toBeNull();
    expect(f.nativeElement.querySelector('input[name="vet"]')).toBeNull();
    await c.save();
    expect(write).not.toHaveBeenCalled();
    TestBed.inject(Session).set('direct_entry', 'operator');
    await f.whenStable();
    f.detectChanges();
    expect(c.form.vet).toBe('Doctor');
    expect(f.nativeElement.querySelector('input[name="vet"]')).not.toBeNull();
  });
  it('focuses the visible error summary after a field refusal and keeps its field association', async () => {
    write.mockRejectedValue(new ApiError({ error: 'invalid_field', field: 'vet', message: 'Use the recorded vet name.' }, true));
    const f = TestBed.createComponent(HealthPage), c = f.componentInstance as any;
    await f.whenStable();
    TestBed.inject(Session).set('direct_entry', 'operator');
    await c.create('visits');
    c.dateChanged({ status: 'complete', value: { occurred_on: '2026-09-17', date_precision: 'day', occurred_time: null }, reading: '' });
    c.form.vet = 'Doctor';
    await c.save();
    await f.whenStable();
    await new Promise(resolve => setTimeout(resolve, 10));
    const summary = f.nativeElement.querySelector('[role="alert"]');
    expect(document.activeElement).toBe(summary);
    expect(summary.textContent).toContain('Use the recorded vet name.');
    const field = f.nativeElement.querySelector('#health-vet');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(field.getAttribute('aria-describedby'))?.textContent).toContain('Use the recorded vet name.');
    expect(c.form.vet).toBe('Doctor');
  });
  it('preserves inputs and retry key when a save outcome is uncertain', async () => {
    write.mockRejectedValue(
      new ApiError({ error: 'network_unreachable', message: 'Network unavailable' }, false),
    );
    const f = TestBed.createComponent(HealthPage),
      c = f.componentInstance as any;
    await f.whenStable();
    TestBed.inject(Session).set('direct_entry', 'operator');
    await c.create('visits');
    c.dateChanged({
      status: 'complete',
      value: { occurred_on: '2026-09-17', date_precision: 'day', occurred_time: null },
      reading: '',
    });
    c.form.vet = 'Doctor';
    await c.save();
    await c.save();
    expect(write.mock.calls[0][2]).toBe(write.mock.calls[1][2]);
    expect(c.form.vet).toBe('Doctor');
  });
  it('does not erase visit purpose after a save or replace it with the correction reason', async () => {
    const saved = {
      id: 'visit',
      entity: 'visits',
      revision: 1,
      reason: 'Routine examination',
      vet: 'Doctor',
    };
    write.mockResolvedValue(saved);
    const f = TestBed.createComponent(HealthPage),
      c = f.componentInstance as any;
    await f.whenStable();
    TestBed.inject(Session).set('direct_entry', 'operator');
    await c.create('visits');
    c.dateChanged({
      status: 'complete',
      value: { occurred_on: '2026-09-17', date_precision: 'day', occurred_time: null },
      reading: '',
    });
    c.form.reason = 'Routine examination';
    await c.save();
    expect(c.form.reason).toBe('Routine examination');
    expect(c.form.correction_reason).toBe('');
  });
  it('opens saved history as view, preserves precision and never silently adopts a newer revision', async () => {
    const f = TestBed.createComponent(HealthPage),
      c = f.componentInstance as any;
    await f.whenStable();
    TestBed.inject(Session).set('direct_entry', 'spec-review');
    await f.whenStable();
    const record = {
      id: 'visit-fixture',
      entity: 'visits',
      revision: 2,
      recorded_by: 'adnan',
      source_form: 'recall',
      occurred_on: '2023-03-01',
      date_precision: 'month',
      occurred_time: null,
      reason: 'Original reason',
      vet: 'Doctor',
    };
    await c.edit(record);
    f.detectChanges();
    expect(c.savedView).toBe(true);
    expect(c.hasUnsavedChanges()).toBe(false);
    await c.save();
    expect(write).not.toHaveBeenCalled();
    Array.from(f.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((b) => b.textContent?.trim() === 'Correct record')!
      .click();
    f.detectChanges();
    await f.whenStable();
    expect(c.meaningfulChange()).toBe(false);
    f.changeDetectorRef.markForCheck();
    f.detectChanges();
    await f.whenStable();
    f.componentRef.changeDetectorRef.markForCheck();
    f.detectChanges();
    expect(f.nativeElement.querySelector('textarea[name="reason"]').value).toBe('Original reason');
    const correction = f.nativeElement.querySelector(
      'input[name="correction_reason"]',
    ) as HTMLInputElement;
    correction.value = 'Clarifying';
    correction.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(c.form.reason).toBe('Original reason');
    expect(c.dateEntry.value).toEqual({
      occurred_on: '2023-03-01',
      date_precision: 'month',
      occurred_time: null,
    });
    c.form.reason = 'Corrected reason';
    c.form.correction_reason = 'Transcription correction';
    write.mockRejectedValue(
      new ApiError({ error: 'health_conflict', message: 'Original conflict prose' }, true),
    );
    await c.save();
    expect(write.mock.calls[0][1].expected_revision).toBe(2);
    expect(write.mock.calls[0][1].recorded_by).toBe('spec-review');
    expect(c.editing.recorded_by).toBe('adnan');
    const latest = { ...record, revision: 3, reason: 'Other correction' };
    const keep = c.acceptRevision(latest);
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    document.querySelector<HTMLButtonElement>('[data-role=keep-editing]')!.click();
    await keep;
    expect(c.form.reason).toBe('Corrected reason');
    expect(c.editing.revision).toBe(2);
    const discard = c.acceptRevision(latest);
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    document.querySelector<HTMLButtonElement>('[data-role=discard-changes]')!.click();
    await discard;
    expect(c.form.reason).toBe('Other correction');
    expect(c.editing.revision).toBe(3);
    expect(c.savedView).toBe(true);
  });
  it('cancelling a void keeps the correction and makes no write', async () => {
    const f = TestBed.createComponent(HealthPage),
      c = f.componentInstance as any;
    TestBed.inject(Session).set('direct_entry', 'fixture');
    await f.whenStable();
    await c.edit({
      id: 'visit-fixture',
      entity: 'visits',
      revision: 2,
      occurred_on: '2023-01-01',
      date_precision: 'year',
      vet: 'Doctor',
    });
    c.beginCorrection();
    c.form.correction_reason = 'Reason retained';
    const pending = c.voidRecord();
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    expect(document.body.textContent).toContain('Void this record?');
    document.querySelector<HTMLButtonElement>('[data-role=keep-editing]')!.click();
    await pending;
    expect(write).not.toHaveBeenCalled();
    expect(c.form.correction_reason).toBe('Reason retained');
  });
  it('clearing a historical date remains dirty and blocks the write', async () => {
    const f = TestBed.createComponent(HealthPage),
      c = f.componentInstance as any;
    await f.whenStable();
    TestBed.inject(Session).set('direct_entry', 'fixture');
    await c.edit({
      id: 'fixture',
      entity: 'visits',
      revision: 1,
      occurred_on: '2023-01-01',
      date_precision: 'year',
      vet: 'Doctor',
    });
    c.beginCorrection();
    c.dateChanged({ status: 'empty' });
    expect(c.hasUnsavedChanges()).toBe(true);
    await c.save();
    expect(write).not.toHaveBeenCalled();
  });
  it('retries a lost attachment response with the same bytes and key without linking twice', async () => {
    const f = TestBed.createComponent(HealthPage),
      c = f.componentInstance as any;
    await f.whenStable();
    TestBed.inject(Session).set('direct_entry', 'fixture');
    await c.create('visits');
    write
      .mockRejectedValueOnce(new ApiError({ error: 'network', message: 'Response lost' }, false))
      .mockResolvedValue({ id: 'attachment-fixture' });
    await c.upload({
      target: { files: [new File(['synthetic'], 'fixture.txt', { type: 'text/plain' })] },
    } as unknown as Event);
    expect(c.writeState.uncertain()).toBe(true);
    expect(c.hasUnsavedChanges()).toBe(true);
    const original = structuredClone(write.mock.calls[0]);
    await c.retryLast();
    expect(write.mock.calls[1]).toEqual(original);
    expect(c.form.attachment_ids).toEqual(['attachment-fixture']);
    expect(c.uploadStatus).toContain('Save the record to link it');
  });
  it('does not omit a started vaccination row without a disposition', async () => {
    const f = TestBed.createComponent(HealthPage),
      c = f.componentInstance as any;
    await f.whenStable();
    TestBed.inject(Session).set('direct_entry', 'fixture');
    await c.openRound();
    c.roundRows = { 'animal-fixture': { disposition: '', reason: 'Needs review' } };
    await c.saveRound();
    expect(write).not.toHaveBeenCalled();
    expect(c.hasUnsavedChanges()).toBe(true);
    expect(c.error()).toContain('Choose a disposition');
  });
  it('keeps health literal route before the animal serial route', () => {
    const paths = routes[0].children!.map((r) => r.path);
    expect(paths.indexOf('animals/health')).toBeLessThan(paths.indexOf('animals/:id'));
    expect(paths).toContain('animals/:id/report');
  });
});

it('consumes a second source link on the reused health route', async () => {
  const queryParamMap = new BehaviorSubject(convertToParamMap({ record: 'A' }));
  const route = { queryParamMap, snapshot: { queryParamMap: queryParamMap.value } };
  const doses = ['A', 'B'].map(id => ({ id, entity: 'administrations', revision: 1, animal_id: 'animal',
    milk_withdrawal: { state: 'unknown' }, meat_withdrawal: { state: 'unknown' } }));
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ActivatedRoute, useValue: route },
    { provide: RegistryApi, useValue: { herd: async () => [], healthGet: async (path: string) =>
      path.includes('/board') ? { tasks: [], withdrawals: [], open_cases: [], overdue: 0, due: 0, upcoming: 0 } :
      path === 'health/administrations' ? doses : [] } }] });
  const f = TestBed.createComponent(HealthPage); await f.whenStable();
  const c = f.componentInstance as any;
  expect(c.editing.id).toBe('A');
  route.snapshot.queryParamMap = convertToParamMap({ record: 'B' });
  queryParamMap.next(route.snapshot.queryParamMap);
  await new Promise(resolve => setTimeout(resolve, 0)); await f.whenStable();
  expect(c.editing.id).toBe('B');
  // A cancelled draft transition must not consume the source link.
  c.form.notes = 'Unsaved correction';
  const canLeave = vi.spyOn(c, 'canLeave').mockResolvedValue(false);
  route.snapshot.queryParamMap = convertToParamMap({ record: 'A' });
  queryParamMap.next(route.snapshot.queryParamMap);
  await new Promise(resolve => setTimeout(resolve, 0)); await f.whenStable();
  expect(c.editing.id).toBe('B');
  canLeave.mockResolvedValue(true);
  await c.load();
  expect(c.editing.id).toBe('A');
});
