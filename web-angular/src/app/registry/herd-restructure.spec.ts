import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HealthPage } from './health-page/health-page';
import { RegistryApi } from './api';
import { Session } from './session';
import { readableParts } from './precision-display';

describe('readable precision dates', () => {
  it('writes the figure in words and keeps the precision word (never a bare date)', () => {
    expect(readableParts('2021-02-11', 'day')).toMatchObject({ figure: '11 Feb 2021', qualifier: null });
    expect(readableParts('2017-03-01', 'month')).toMatchObject({ figure: 'Mar 2017', qualifier: 'month', state: 'approximate' });
    expect(readableParts('2016-01-01', 'year')).toMatchObject({ figure: '2016', qualifier: 'year' });
    expect(readableParts('2018-01-01', 'estimated')).toMatchObject({ figure: '~2018', qualifier: 'est' });
    expect(readableParts(null, null).state).toBe('no-record');
  });
});

describe('health page arrangement', () => {
  const task = (id: string, standing: string) => ({ id, animal_id: 'BD-0001', instructions: id, kind: 'administration', standing, due_on: '2026-11-08', status: 'pending', revision: 1 });
  const board = {
    tasks: [task('t1', 'overdue'), task('t2', 'due')], overdue: 1, due: 1, upcoming: 0, open_cases: [],
    withdrawals: [
      { animal_id: 'BD-0002', target: 'meat', status: 'clarify' },
      { animal_id: 'BD-0003', target: 'milk', status: 'clarify', administration_id: 'a1', revision: 1 },
    ],
  };
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: RegistryApi, useValue: {
          healthGet: (path: string) => Promise.resolve(path.includes('/board') ? structuredClone(board) : []),
          herd: () => Promise.resolve([]),
          healthWrite: vi.fn(),
        } },
      ],
    });
  });

  it('splits records from the reference lists, and keeps tasks on To do', async () => {
    const f = TestBed.createComponent(HealthPage), c = f.componentInstance as any;
    await f.whenStable();
    c.setTab('records');
    expect(c.tabEntities()).not.toContain('products');
    expect(c.tabEntities()).not.toContain('tasks');
    expect(c.tabEntities()).toContain('administrations');
    c.setTab('reference');
    expect(c.tabEntities()).toEqual(['products', 'plans']);
    expect(c.entity).toBe('products');
  });

  it('puts milk withdrawals first and folds meat below them', async () => {
    const f = TestBed.createComponent(HealthPage), c = f.componentInstance as any;
    await f.whenStable(); f.detectChanges();
    expect(c.milkWithdrawals(c.board()).map((w: any) => w.animal_id)).toEqual(['BD-0003']);
    const fold = (f.nativeElement as HTMLElement).querySelector('details.health-fold summary')!;
    expect(fold.textContent).toContain('Meat and other withdrawals (1)');
  });

  it('opens a task change in the panel beside the list, and marks the task', async () => {
    TestBed.inject(Session).set('direct_entry', 'adnan');
    const f = TestBed.createComponent(HealthPage);
    await f.whenStable(); f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const row = el.querySelector<HTMLElement>('.health-task')!;
    // One main action per row; the status change is under "More".
    expect(Array.from(row.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Change status').length).toBe(0);
    row.querySelector<HTMLButtonElement>('[data-role="task-more"]')!.click();
    f.detectChanges();
    row.querySelector<HTMLButtonElement>('[data-role="change-status"]')!.click();
    await f.whenStable(); f.detectChanges();
    const panel = el.querySelector('[data-role="health-panel"]')!;
    expect(panel.querySelector('#health-action')).not.toBeNull();
    expect(panel.textContent).toContain('Change task status');
    expect(row.hasAttribute('data-current')).toBe(true);
    // The list did not move: nothing was inserted between the rows.
    expect(el.querySelector('.task-rows')!.querySelectorAll('form').length).toBe(0);
  });
});
