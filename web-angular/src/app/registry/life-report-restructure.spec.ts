// The lifetime report restructure: one row per record, a summary first, a
// range kept in the URL, contents that close what you left, and a printout
// without the JSON dump.

import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { LifeReport } from './life-report/life-report';
import { RegistryApi } from './api';
import { familyLine, lifeFacts, lifeRow, recordCount, taskStanding, withdrawalLine } from './life-report-model';
import { reportPrintPages } from './life-report/print-pages';

const tick = async (f: any) => {
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
};

function report(): any {
  return {
    animal_id: 'BD-0001',
    generated_at: '2026-11-08T14:03:17.967Z',
    filters: {},
    current_snapshot: {
      animal: { name: 'Noori', origin: 'acquired', sex: 'female', species: 'buffalo', tag_no: 'PK-1' },
      status: { status: 'lactating', parity: 3, birth_on: '2017-03-01', birth_precision: 'month', open_lactation_id: 'l3' },
    },
    health: {
      vaccinations: [],
      records: [
        { entity: 'tasks', id: 't1', status: 'pending', due_on: '2026-11-07', instructions: 'Recheck' },
        { entity: 'tasks', id: 't2', status: 'pending', due_on: '2026-11-20', instructions: 'Booster' },
        { entity: 'tasks', id: 't3', status: 'completed', due_on: '2026-11-01' },
      ],
      withdrawals: [{ target: 'meat', product_name: 'Vaccine A', state: 'unknown' }],
    },
    totals: { measured_litres: 25, measured_sessions: 5, unmeasured_sessions: 0, not_milked_sessions: 1 },
    sections: {
      reproduction: { records: [
        { type: 'calving', effective: true, occurred_on: '2024-01-08', date_precision: 'day', payload: {} },
        { type: 'calving', effective: true, occurred_on: '2021-02-11', date_precision: 'day', payload: {} },
      ] },
      lactations: { records: [{ id: 'l3', started_on: '2026-10-01', start_precision: 'day' }] },
      production: { records: [{ id: 'm1', occurred_on: '2026-11-06', session: 'evening', status: 'measured', yield_litres: 5, recorded_by: 'adnan', source_form: 'direct_entry' }] },
      health: { records: [] },
      feed: { records: [] },
    },
    timeline: [],
    coverage_warnings: ['No records means no evidence entered.'],
  };
}

function mount(healthGet = vi.fn(async (_path: string) => report())) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: RegistryApi, useValue: { healthGet } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({ id: 'BD-0001' })),
          snapshot: { paramMap: convertToParamMap({ id: 'BD-0001' }), queryParamMap: convertToParamMap({}) },
        },
      },
    ],
  });
  return { f: TestBed.createComponent(LifeReport), healthGet };
}

afterEach(() => TestBed.resetTestingModule());

describe('life report rows', () => {
  it('drops the subject and the ordinary record state, and keeps the unusual one', () => {
    const effective = lifeRow({ type: 'calving', effective: true, occurred_on: '2024-01-08', date_precision: 'day', animal_id: 'BD-0001', payload: { calf_id: 'BD-0018' } }, 'event', 'BD-0001');
    expect(effective.title).toBe('Calving');
    expect(effective.date).toBe('8 Jan 2024');
    expect(effective.facts.join(' ')).toContain('Calf: BD-0018');
    expect(effective.facts.join(' ')).not.toContain('Subject');
    expect(effective.state).toBeNull();
    const superseded = lifeRow({ type: 'calving', effective: false, occurred_on: '2024-01-08', payload: {} }, 'event', 'BD-0001');
    expect(superseded.state).toBe('Superseded');
  });

  it('dates a task by when it is due, not "Date not recorded"', () => {
    const task = lifeRow({ entity: 'tasks', due_on: '2026-11-07', status: 'pending', animal_id: 'BD-0001' }, 'health', 'BD-0001');
    expect(task.date).toBe('Due 7 Nov 2026');
    expect(task.facts.join(' ')).not.toContain('Due:');
  });

  it('reads family from her side', () => {
    expect(familyLine({ child_id: 'BD-0018', parent_ref: 'BD-0001', relation: 'dam', certainty: 'known' }, 'BD-0001')).toBe('Mother of BD-0018');
    expect(familyLine({ child_id: 'BD-0001', parent_ref: 'BD-0003', relation: 'dam', certainty: 'estimated' }, 'BD-0001')).toBe('Dam: BD-0003 (estimated)');
    // Born here, mother not known: an answer, not a gap.
    expect(familyLine({ child_id: 'BD-0001', parent_ref: null, relation: 'dam', certainty: 'unknown' }, 'BD-0001')).toBe('Dam: not known');
  });

  it('counts in words', () => {
    expect(recordCount(1)).toBe('1 record');
    expect(recordCount(0)).toBe('0 records');
  });

  it('reads a withdrawal and a task standing in words', () => {
    expect(withdrawalLine({ target: 'meat', product_name: 'Vaccine A' })).toBe('Meat withdrawal · Vaccine A · end not known, needs clarification');
    expect(taskStanding('2026-11-07', '2026-11-08')).toBe('overdue');
    expect(taskStanding('2026-11-08', '2026-11-08')).toBe('today');
  });
});

describe('life report summary', () => {
  it('states the facts people open it for, from fields the response carries', () => {
    const facts = Object.fromEntries(lifeFacts(report(), '2026-11-08').map((f) => [f.label, f]));
    expect(facts['Born'].value).toBe('Mar 2017 (month known)');
    expect(facts['Born'].note).toBe('about 9 years old');
    expect(facts['Calvings'].value).toBe('3');
    expect(facts['Last calving'].value).toBe('8 Jan 2024');
    expect(facts['In milk'].value).toBe('Day 38');
    expect(facts['Milk recorded'].value).toBe('25 L');
    expect(facts['Health tasks open'].value).toBe('2');
    expect(facts['Health tasks open'].note).toBe('1 overdue · 1 withdrawal');
  });
});

describe('life report page', () => {
  it('opens with the summary and shows each record as one row', async () => {
    const { f } = mount();
    await tick(f);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-role="summary"]')!.textContent).toContain('Last calving');
    expect(el.querySelector('#report-milk')!.textContent).toContain('Milk · 1 record');
    const row = el.querySelector('#report-milk')!.closest('section')!.querySelector('article')!;
    expect(row.querySelector('.rec-date')!.textContent).toContain('6 Nov 2026');
    expect(row.querySelector('.rec-source')!.textContent).toContain('Recorded by adnan');
    // Identity is shown once, not as a card and again as a folded section.
    expect(el.querySelectorAll('#report-identity').length).toBe(1);
    expect(el.textContent).not.toContain('Identity and provenance');
  });

  it('closes the section you left when you jump to another', async () => {
    const { f } = mount();
    await tick(f);
    const el = f.nativeElement as HTMLElement;
    document.body.append(el);
    const click = (id: string) => el.querySelector<HTMLAnchorElement>(`.report-toc a[href="#report-${id}"]`)!.click();
    for (const h of el.querySelectorAll('h3')) (h as HTMLElement).scrollIntoView = vi.fn();
    click('milk');
    expect((el.querySelector('#report-milk')!.closest('details') as HTMLDetailsElement).open).toBe(true);
    click('timeline');
    expect((el.querySelector('#report-milk')!.closest('details') as HTMLDetailsElement).open).toBe(false);
    f.detectChanges();
    expect(el.querySelector('.report-toc a[aria-current]')!.textContent).toContain('Timeline');
    el.remove();
  });

  it('reloads with corrections when the switch is turned on', async () => {
    const { f, healthGet } = mount();
    await tick(f);
    const box = (f.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[name="audit"]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await tick(f);
    expect(healthGet.mock.calls.at(-1)![0]).toContain('corrections=true');
  });

  it('asks for this lactation from its start date', async () => {
    const { f, healthGet } = mount();
    await tick(f);
    (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-role="range-lactation"]')!.click();
    await tick(f);
    expect(healthGet.mock.calls.at(-1)![0]).toContain('from=2026-10-01');
  });
});

it('leaves a no-print section out of the printed pages', () => {
  const source = document.createElement('div');
  source.innerHTML = `<section><h3>Milk</h3><article><p>Row</p></article></section>
    <section class="no-print"><h3>Technical audit</h3><pre>{"raw": true}</pre></section>`;
  const root = reportPrintPages(source, 'BD-0001');
  expect(root.textContent).toContain('Row');
  expect(root.textContent).not.toContain('raw');
  root.remove();
});
