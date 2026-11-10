import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RegistryApi } from './api';
import { VerificationPanel } from './verification-panel/verification-panel';
import { errorText, precisionWords, violationHeading } from './check-presentation';

const summary = (quality: string, count: number) => ({ quality, count, mean_days: count ? 530 : null, min_days: count ? 523 : null, max_days: count ? 538 : null });

function verification() {
  return {
    as_of: '2026-11-09',
    counts: { animals: 31, events: 70, lactations: 17, milkings: 28 },
    violations: [
      { invariant: 3, name: 'one-origin-event', detail: 'animal BD-0007 has no birth or acquired event', target: { kind: 'animal', id: 'BD-0007' } },
    ],
    labour: [],
    histogram: [
      { source_form: 'recall', date_precision: 'day', count: 5 },
      { source_form: 'recall', date_precision: 'month', count: 40 },
    ],
    intervals: {
      intervals: [
        { animal_id: 'BD-0002', ordinal: 1, from_on: '2021-06-01', to_on: '2022-12-01', from_precision: 'month', to_precision: 'month', days: 548, quality: 'approximate' },
      ],
      measured: summary('measured', 0),
      approximate: summary('approximate', 1),
      caveat: 'server caveat',
    },
    milking: {
      rows: 12, measured: 10, milked_not_measured: 1, not_milked: 1, sessions: 2, complete_sessions: 1,
      first_on: '2026-11-08', last_on: '2026-11-08',
      recent: [
        { occurred_on: '2026-11-08', session: 'evening', expected: 6, recorded: 4, measured: 2 },
        { occurred_on: '2026-11-08', session: 'morning', expected: 6, recorded: 6, measured: 6 },
      ],
      caveat: 'server caveat',
    },
  };
}

async function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: RegistryApi, useValue: { verification: async () => verification(), reconcile: async () => { throw new Error('offline'); } } },
    ],
  });
  const f = TestBed.createComponent(VerificationPanel);
  f.detectChanges();
  await new Promise((r) => setTimeout(r, 0));
  f.detectChanges();
  return f;
}

describe('Check, ordered by consequence', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('opens with what needs an answer, in words, with the sheet that answers it', async () => {
    const f = await mount();
    const el = f.nativeElement as HTMLElement;
    const first = el.querySelector('section');
    expect(first?.getAttribute('data-role')).toBe('needs-answer');
    const items = Array.from(el.querySelectorAll('[data-role="attention-item"]'));
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('8 Nov 2026 evening milking: 2 animals not answered');
    expect(items[0].querySelector('a')?.getAttribute('href')).toContain('/milk/milking?on=2026-11-08&session=evening');
    expect(el.textContent).toContain('1 contradiction in the records');
  });

  it('shows a contradiction in plain words with a link to the animal, technical code last', async () => {
    const f = await mount();
    const li = (f.nativeElement as HTMLElement).querySelector('[data-role="violations"] li')!;
    expect(li.querySelector('h4')?.textContent).toBe('Birth or purchase missing, or recorded twice');
    expect(li.textContent).toContain('Animal BD-0007 has no birth');
    expect(li.querySelector('a')?.getAttribute('href')).toBe('/animals/BD-0007');
    expect(li.lastElementChild?.tagName).toBe('DETAILS');
  });

  it('dates a month-only calving to the month, never an invented day', async () => {
    const f = await mount();
    const row = (f.nativeElement as HTMLElement).querySelector('[data-role="intervals"] tbody tr')!;
    expect(row.textContent).toContain('Jun 2021');
    expect(row.textContent).not.toContain('1 Jun 2021');
  });

  it('does the backfill sum: exact days out of all dates, per source', async () => {
    const f = await mount();
    expect((f.nativeElement as HTMLElement).querySelector('[data-role="exact-share"]')?.textContent).toContain(
      '5 of 45 dates give an exact day (11%)',
    );
  });

  it('says "not answered" in words, not only in amber', async () => {
    const f = await mount();
    const cells = Array.from((f.nativeElement as HTMLElement).querySelectorAll('[data-role="milking-sessions"] td'));
    expect(cells.some((c) => c.textContent!.includes('4 of 6 · 2 not answered'))).toBe(true);
  });

  it('never prints an ISO date or an error class name', async () => {
    const f = await mount();
    const text = (f.nativeElement as HTMLElement).textContent!;
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toContain('Error:');
    expect(errorText(new Error('ApiError: The server failed'))).toBe('The server failed');
    expect(precisionWords('month')).toBe('Month only');
    expect(violationHeading('some_new_rule')).toBe('Some new rule');
  });
});
