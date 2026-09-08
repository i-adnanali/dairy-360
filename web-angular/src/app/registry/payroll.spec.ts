import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import type { Type } from '@angular/core';
import { provideRouter } from '@angular/router';

import { PayrollRunScreen, monthBounds } from './payroll-run';
import { PeopleList } from './people-list';
import { PersonDetail } from './person-detail';
import { RegistryApi } from './api';
import { Session } from './session';
import { formatPeriodRate } from './money';
import type { PayrollRun, PayrollRunRow, WageBalanceRow, WageStatement } from './types';

// ---------------------------------------------------------------------------
// money -- a package rate is two values, and is never converted
// ---------------------------------------------------------------------------

describe('formatPeriodRate', () => {
  it('AGREES WITH THE SERVER and prints the agreement, not a conversion', () => {
    // server/src/registry/money.ts asserts these exact strings. Two
    // implementations exist because the run needs a total before the server has
    // seen one; this is the spec that pins them together.
    expect(formatPeriodRate(2_500_000, 'month')).toBe('Rs 25,000.00 / month');
    expect(formatPeriodRate(120_000, 'day')).toBe('Rs 1,200.00 / day');
  });

  it('never renders a monthly salary as a per-day figure', () => {
    // Nobody is paid "Rs 833.33 a day", and the statement is shown to the
    // person it is about.
    expect(formatPeriodRate(2_500_000, 'month')).not.toContain('833');
  });
});

describe('monthBounds', () => {
  it('is farm-local arithmetic with no clock in it', () => {
    expect(monthBounds('2026-09-07')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthBounds('2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    // A leap February, because getting this wrong silently shortens a run.
    expect(monthBounds('2028-02-14')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthBounds('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const runRow = (
  identifier: string,
  over: Partial<PayrollRunRow> = {},
): PayrollRunRow => ({
  engagement: {
    id: `eng_${identifier}`, person_id: `per_${identifier}`, kind: 'permanent',
    role: 'milker', started_on: '2026-01-01', ended_on: null, end_reason: null,
    note: null, recorded_by: 'a', recorded_at: 't',
  },
  person: {
    id: `per_${identifier}`, identifier, name: identifier, contact: null, note: null,
    recorded_by: 'a', recorded_at: 't',
  },
  term: {
    id: `trm_${identifier}`, engagement_id: `eng_${identifier}`,
    effective_from: '2026-01-01', cash_minor: 2_500_000, cash_period: 'month',
    recorded_by: 'a', recorded_at: 't', note: null,
  },
  benefits: [],
  suggested_minor: 2_500_000,
  existing: null,
  milk: null,
  ...over,
});

const RUN: PayrollRun = {
  from_on: '2026-09-01',
  to_on: '2026-09-30',
  permanent: [
    runRow('imran', {
      benefits: [
        { id: 'b1', term_id: 'trm_imran', kind: 'milk', quantity: 2, unit: 'L', period: 'day', note: null },
        { id: 'b2', term_id: 'trm_imran', kind: 'accommodation', quantity: null, unit: null, period: null, note: null },
      ],
      milk: {
        allowance_per_day: 2, allowance_period: 'day', taken_litres: 74,
        expected_litres: 60, through_on: '2026-09-30', partial: false,
      },
    }),
    runRow('abdul', { suggested_minor: 2_000_000 }),
  ],
  daily: [],
  daily_candidates: [
    runRow('rashid', {
      engagement: {
        id: 'eng_rashid', person_id: 'per_rashid', kind: 'daily', role: null,
        started_on: '2026-01-01', ended_on: null, end_reason: null, note: null,
        recorded_by: 'a', recorded_at: 't',
      },
      suggested_minor: 120_000,
    }),
  ],
  through_on: '2026-09-30',
  answered: 0,
  outstanding: 2,
  total_minor: 0,
};

class FakeApi {
  run: PayrollRun = structuredClone(RUN);
  saved: Record<string, unknown> | null = null;
  peopleRows: WageBalanceRow[] = [];
  statement: WageStatement | null = null;
  addedPerson: Record<string, unknown> | null = null;
  payment: Record<string, unknown> | null = null;

  identifierValues() {
    return Promise.resolve({ observed_by: ['imran'], acquired_from: [], sire_ref: [] });
  }
  payrollRun(): Promise<PayrollRun> {
    return Promise.resolve(structuredClone(this.run));
  }
  saveRun(body: Record<string, unknown>): Promise<unknown> {
    this.saved = body;
    return Promise.resolve({
      from_on: '2026-09-01', to_on: '2026-09-30', written: 2, updated: 0,
      total_minor: 4_500_000,
    });
  }
  people(): Promise<WageBalanceRow[]> {
    return Promise.resolve(structuredClone(this.peopleRows));
  }
  person(): Promise<WageStatement> {
    return Promise.resolve(structuredClone(this.statement as WageStatement));
  }
  addPerson(body: Record<string, unknown>): Promise<unknown> {
    this.addedPerson = body;
    return Promise.resolve({ id: 'per_new', identifier: String(body['identifier']) });
  }
  addEngagement(): Promise<unknown> {
    return Promise.resolve({ id: 'eng_new' });
  }
  recordWagePayment(body: Record<string, unknown>): Promise<unknown> {
    this.payment = body;
    return Promise.resolve({ id: 'wpy_1', amount_minor: 1, method: 'cash' });
  }
  updateEngagement(): Promise<unknown> {
    return Promise.resolve({ id: 'eng_1' });
  }
}

function asApi(fake: FakeApi): RegistryApi {
  return fake as unknown as RegistryApi;
}

async function render<T>(component: Type<T>, api: FakeApi, inputs?: Record<string, unknown>) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: RegistryApi, useValue: asApi(api) },
    ],
  });
  TestBed.inject(Session).set('direct_entry', 'adnan');
  const fixture = TestBed.createComponent(component);
  if (inputs) for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('PayrollRunScreen', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('PRE-FILLS from the agreement and leaves the field editable', async () => {
    // The pre-filled figure is a DEFAULT. A month with leave is settled by
    // conversation, and a field that looks read-only is how it gets paid in
    // full by reflex.
    const { el } = await render(PayrollRunScreen, new FakeApi());
    const input = el.querySelector<HTMLInputElement>('[data-role="amount-imran"]')!;
    expect(input.value).toBe('25000');
    expect(input.disabled).toBe(false);
  });

  it('shows the agreement SEPARATELY from the figure being entered', async () => {
    const { el } = await render(PayrollRunScreen, new FakeApi());
    const agreed = el.querySelectorAll('[data-role="agreement"]')[0];
    expect(agreed.textContent).toContain('Rs 25,000.00 / month');
  });

  it('SPLITS the run: salaried must be answered, dihari must not', async () => {
    const { el } = await render(PayrollRunScreen, new FakeApi());
    expect(el.querySelectorAll('[data-engagement]').length).toBe(2);
    expect(el.querySelector('[data-role="daily"]')!.textContent).toContain('only the days');
    // Nothing in the dihari block is required, so the run is saveable with the
    // salaried rows pre-filled and no dihari at all.
    expect(el.querySelector<HTMLButtonElement>('[data-role="save"]')!.getAttribute('aria-disabled')).toBeNull();
  });

  it('BLOCKS the save when a salaried figure is cleared', async () => {
    const { fixture, el } = await render(PayrollRunScreen, new FakeApi());
    const input = el.querySelector<HTMLInputElement>('[data-role="amount-imran"]')!;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('[data-role="save"]')!.getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain(
      'an omission is not an answer',
    );
  });

  it('disables the field when there is no agreement to pay against', async () => {
    const api = new FakeApi();
    api.run.permanent[0] = runRow('imran', { term: null, suggested_minor: null });
    const { el } = await render(PayrollRunScreen, api);
    expect(el.querySelector<HTMLInputElement>('[data-role="amount-imran"]')!.disabled).toBe(true);
    expect(el.querySelector('[data-role="agreement"]')!.textContent).toContain('no package agreed');
  });

  it('shows the allowance AGAINST what was taken, and flags a difference', async () => {
    const { el } = await render(PayrollRunScreen, new FakeApi());
    const milk = el.querySelector('[data-role="milk"]')!;
    expect(milk.textContent).toContain('60 L due');
    expect(milk.textContent).toContain('74 L taken');
    // A settled month says "due", not "due to date".
    expect(milk.textContent).not.toContain('to date');
  });

  it('says "to date" while the period is still running', async () => {
    // Without this a 2 L/day allowance opened on the 7th reads as a 46 L
    // shortfall consisting of days that have not happened. Found in the harness.
    const api = new FakeApi();
    api.run.through_on = '2026-09-07';
    api.run.permanent[0].milk = {
      allowance_per_day: 2, allowance_period: 'day', taken_litres: 14,
      expected_litres: 14, through_on: '2026-09-07', partial: true,
    };
    const { el } = await render(PayrollRunScreen, api);
    const milk = el.querySelector('[data-role="milk"]')!;
    expect(milk.textContent).toContain('14 L due to date');
    expect(milk.textContent).toContain('through 2026-09-07');
  });

  it('lists the in-kind package WITHOUT ever totalling it', async () => {
    // A rupee total would need a reference price with no transaction behind it,
    // and the moment one is on screen somebody treats it as money owed.
    const { el } = await render(PayrollRunScreen, new FakeApi());
    const pkg = el.querySelector('[data-role="package"]')!;
    expect(pkg.textContent).toContain('accommodation');
    expect(pkg.textContent).not.toContain('Rs');
  });

  it('re-opens an already-saved run showing the SAVED figure, not the default', async () => {
    // Otherwise re-opening a corrected month would silently offer to overwrite
    // it with the agreement.
    const api = new FakeApi();
    api.run.permanent[0].existing = {
      id: 'wag_1', engagement_id: 'eng_imran', kind: 'wage',
      from_on: '2026-09-01', to_on: '2026-09-30', amount_minor: 2_200_000,
      observed_by: null, recorded_by: 'a', recorded_at: 't',
      source_form: 'direct_entry', note: 'four days leave',
    };
    const { el } = await render(PayrollRunScreen, api);
    expect(el.querySelector<HTMLInputElement>('[data-role="amount-imran"]')!.value).toBe('22000');
    expect(el.querySelector('[data-role="already-saved"]')!.textContent).toContain('Rs 22,000.00');
  });

  it('totals from what is TYPED, so the footer moves as the operator edits', async () => {
    const { fixture, el } = await render(PayrollRunScreen, new FakeApi());
    expect(el.querySelector('[data-role="total"]')!.textContent).toContain('Rs 45,000.00');
    const input = el.querySelector<HTMLInputElement>('[data-role="amount-imran"]')!;
    input.value = '22000';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-role="total"]')!.textContent).toContain('Rs 42,000.00');
  });

  it('posts paisa, not rupees', async () => {
    const api = new FakeApi();
    const { el } = await render(PayrollRunScreen, api);
    el.querySelector<HTMLButtonElement>('[data-role="save"]')!.click();
    await Promise.resolve();
    const entries = api.saved!['entries'] as { amount_minor: number }[];
    expect(entries[0].amount_minor).toBe(2_500_000);
    expect(entries.length).toBe(2);
  });

  it('sends a dihari day with its OWN date, not the run range', async () => {
    const api = new FakeApi();
    const { fixture, el } = await render(PayrollRunScreen, api);
    el.querySelector<HTMLButtonElement>('[data-role="add-day"]')!.click();
    fixture.detectChanges();

    const draft = el.querySelector('[data-role="dihari-draft"]')!;
    const who = draft.querySelector('select')!;
    who.value = 'eng_rashid';
    who.dispatchEvent(new Event('change'));
    const day = draft.querySelector<HTMLInputElement>('input[type="date"]')!;
    day.value = '2026-09-14';
    day.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('[data-role="save"]')!.click();
    await Promise.resolve();
    const entries = api.saved!['entries'] as Record<string, unknown>[];
    const dihari = entries.find((e) => e['engagement_id'] === 'eng_rashid')!;
    expect(dihari['from_on']).toBe('2026-09-14');
    expect(dihari['amount_minor']).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

describe('PeopleList', () => {
  afterEach(() => TestBed.resetTestingModule());

  const balance = (over: Partial<WageBalanceRow>): WageBalanceRow => ({
    person_id: 'per_1', identifier: 'imran', name: 'Imran', engaged: true,
    balance_minor: 0, last_period_on: null, last_payment_on: null, ...over,
  });

  it('SHOWS somebody with no open stint rather than hiding them', async () => {
    // Unlike the buyers list, which excludes home. Somebody who has left may
    // still be owed a final payment.
    const api = new FakeApi();
    api.peopleRows = [balance({ engaged: false, balance_minor: 500_000 })];
    const { el } = await render(PeopleList, api);
    const row = el.querySelector('tr[data-engaged="false"]')!;
    expect(row).toBeTruthy();
    expect(row.querySelector('[data-role="not-engaged"]')!.textContent).toContain('no open stint');
  });

  it('says "in advance" instead of showing a minus sign', async () => {
    const api = new FakeApi();
    api.peopleRows = [balance({ balance_minor: -800_000 })];
    const { el } = await render(PeopleList, api);
    const owed = el.querySelector('[data-role="balance"]')!;
    expect(owed.textContent).toContain('Rs 8,000.00 in advance');
    expect(owed.textContent).not.toContain('-Rs');
  });

  it('warns that the identifier cannot be changed, on the one form that sets it', async () => {
    const api = new FakeApi();
    api.peopleRows = [balance({})];
    const { el } = await render(PeopleList, api);
    const form = el.querySelector('[data-role="add-person"]')!;
    expect(form.textContent).toContain('cannot be changed later');
    expect(form.textContent).toContain('event log cannot be rewritten');
  });

  it('trims the identifier and omits an empty display name', async () => {
    const api = new FakeApi();
    api.peopleRows = [balance({})];
    const { fixture, el } = await render(PeopleList, api);
    const input = el.querySelector<HTMLInputElement>('input[name="identifier"]')!;
    input.value = '  nawaz  ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('[data-role="add-person"]') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await Promise.resolve();
    expect(api.addedPerson!['identifier']).toBe('nawaz');
    expect(api.addedPerson!['name']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The statement
// ---------------------------------------------------------------------------

describe('PersonDetail', () => {
  afterEach(() => TestBed.resetTestingModule());

  const STATEMENT: WageStatement = {
    person_id: 'per_imran',
    identifier: 'imran',
    name: 'Imran',
    as_of: '2026-09-07',
    engagements: [
      {
        id: 'eng_1', person_id: 'per_imran', kind: 'permanent', role: 'milker',
        started_on: '2026-01-01', ended_on: null, end_reason: null, note: null,
        recorded_by: 'a', recorded_at: 't',
      },
    ],
    packages: [
      {
        engagement_id: 'eng_1',
        terms: [],
        current: {
          term: {
            id: 'trm_1', engagement_id: 'eng_1', effective_from: '2026-01-01',
            cash_minor: 2_500_000, cash_period: 'month', recorded_by: 'a',
            recorded_at: 't', note: null,
          },
          benefits: [
            { id: 'b1', term_id: 'trm_1', kind: 'milk', quantity: 2, unit: 'L', period: 'day', note: null },
            { id: 'b2', term_id: 'trm_1', kind: 'flour', quantity: 20, unit: 'kg', period: 'month', note: null },
            { id: 'b3', term_id: 'trm_1', kind: 'accommodation', quantity: null, unit: null, period: null, note: null },
          ],
        },
      },
    ],
    months: [
      {
        month: '2026-08',
        earned_minor: 2_500_000,
        paid_minor: 1_500_000,
        closing_minor: 1_000_000,
        periods: [
          {
            id: 'wag_1', engagement_id: 'eng_1', kind: 'wage', from_on: '2026-08-01',
            to_on: '2026-08-31', amount_minor: 2_500_000, observed_by: null,
            recorded_by: 'a', recorded_at: 't', source_form: 'direct_entry', note: null,
          },
        ],
        payments: [
          {
            id: 'wpy_1', person_id: 'per_imran', occurred_on: '2026-09-02',
            amount_minor: 1_500_000, method: 'cash', reference: null, observed_by: null,
            recorded_by: 'a', recorded_at: 't', note: null,
          },
        ],
      },
    ],
    earned_minor: 2_500_000,
    paid_minor: 1_500_000,
    balance_minor: 1_000_000,
  };

  it('prints the package as its LINES and never as one number', async () => {
    const api = new FakeApi();
    api.statement = structuredClone(STATEMENT);
    const { el } = await render(PersonDetail, api, { id: 'per_imran' });
    const pkg = el.querySelector('[data-role="package-eng_1"]')!;
    expect(pkg.textContent).toContain('Rs 25,000.00 / month');
    expect(pkg.textContent).toContain('2 L milk / day');
    expect(pkg.textContent).toContain('20 kg flour / month');
    expect(pkg.textContent).toContain('accommodation');
    // One rupee figure only -- the cash. No total, because valuing the in-kind
    // lines needs a reference price with no transaction behind it.
    expect(pkg.textContent!.match(/Rs /g)!.length).toBe(1);
  });

  it('groups the statement by month with a running closing balance', async () => {
    const api = new FakeApi();
    api.statement = structuredClone(STATEMENT);
    const { el } = await render(PersonDetail, api, { id: 'per_imran' });
    const month = el.querySelector('[data-month="2026-08"]')!;
    expect(month.textContent).toContain('closing Rs 10,000.00');
    expect(el.querySelector('[data-role="balance"]')!.textContent).toContain('Rs 10,000.00 owed');
  });

  it('says "in advance" for a negative balance here too', async () => {
    const api = new FakeApi();
    api.statement = { ...structuredClone(STATEMENT), balance_minor: -800_000 };
    const { el } = await render(PersonDetail, api, { id: 'per_imran' });
    expect(el.querySelector('[data-role="balance"]')!.textContent).toContain(
      'Rs 8,000.00 in advance',
    );
  });

  it('explains that an adjustment is how a deduction is recorded', async () => {
    const api = new FakeApi();
    api.statement = structuredClone(STATEMENT);
    const { fixture, el } = await render(PersonDetail, api, { id: 'per_imran' });
    expect(el.querySelector('[data-role="adjustment-hint"]')).toBeNull();

    const chips = el.querySelectorAll<HTMLElement>('[data-role="payment-form"] [role="radio"]');
    chips[2].click();
    fixture.detectChanges();
    const hint = el.querySelector('[data-role="adjustment-hint"]')!;
    expect(hint.textContent).toContain('must say why');
    expect(hint.textContent).toContain('above the allowance');
  });

  it('posts a payment in paisa against the routed person', async () => {
    const api = new FakeApi();
    api.statement = structuredClone(STATEMENT);
    const { fixture, el } = await render(PersonDetail, api, { id: 'per_imran' });
    const amount = el.querySelector<HTMLInputElement>('input[name="amount_minor"]')!;
    amount.value = '10000';
    amount.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('[data-role="payment-form"]') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await Promise.resolve();
    expect(api.payment!['amount_minor']).toBe(1_000_000);
    expect(api.payment!['person_id']).toBe('per_imran');
    expect(api.payment!['method']).toBe('cash');
  });

  it('renders somebody on file with no stint at all', async () => {
    // The vet and whoever sold you an animal belong here, and the screen must
    // not treat that as an empty error state.
    const api = new FakeApi();
    api.statement = {
      ...structuredClone(STATEMENT), engagements: [], packages: [], months: [],
      earned_minor: 0, paid_minor: 0, balance_minor: 0,
    };
    const { el } = await render(PersonDetail, api, { id: 'per_imran' });
    expect(el.querySelector('[data-role="no-stints"]')!.textContent).toContain('never employed');
    expect(el.querySelector('[data-role="balance"]')!.textContent).toContain('Settled');
  });
});
