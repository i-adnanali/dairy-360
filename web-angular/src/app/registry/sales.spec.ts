import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { DispatchSheetScreen } from './dispatch-sheet';
import { DestinationsList } from './destinations-list';
import { RegistryApi } from './api';
import { Session } from './session';
import {
  amountMinor,
  formatMinor,
  formatRate,
  minorToRupees,
  perLitreLabel,
  rupeesToMinor,
} from './money';
import type { DispatchSheet, SheetRow } from './types';

// ---------------------------------------------------------------------------
// money -- the factor of forty
// ---------------------------------------------------------------------------

describe('money', () => {
  it('AGREES WITH THE SERVER on the worked example', () => {
    // server/src/registry/money.ts asserts this exact figure. The two
    // implementations exist because the sheet needs a running total before the
    // server has seen one; this is the spec that pins them together, the same
    // way compareEvents() is pinned to the SQL ordering it duplicates.
    expect(amountMinor(12.5, 700_000, 40)).toBe(218_750);
    expect(formatMinor(218_750)).toBe('Rs 2,187.50');
  });

  it('is 40x wrong with the lot size lost, which is why it has no default', () => {
    expect(amountMinor(10, 700_000, 40)).toBe(175_000);
    expect(amountMinor(10, 700_000, 1)).toBe(7_000_000);
  });

  it('shows a rate AS AGREED and never converts it to per-litre', () => {
    expect(formatRate(700_000, 40)).toBe('Rs 7,000.00 / 40 L');
    expect(formatRate(700_000, 40)).not.toContain('175');
  });

  it('shows the per-litre rate back only as a check', () => {
    expect(perLitreLabel(700_000, 40)).toBe('Rs 175.00 per litre');
  });

  it('always shows two decimals so a column can be scanned', () => {
    expect(formatMinor(0)).toBe('Rs 0.00');
    expect(formatMinor(700_000)).toBe('Rs 7,000.00');
    expect(formatMinor(123_456_789)).toBe('Rs 1,234,567.89');
    expect(formatMinor(-31_290)).toBe('-Rs 312.90');
  });

  it('parses typed rupees, and REFUSES anything it cannot round-trip', () => {
    expect(rupeesToMinor('7000')).toBe(700_000);
    expect(rupeesToMinor('7,000')).toBe(700_000);
    expect(rupeesToMinor('7000.50')).toBe(700_050);
    // Refused rather than coerced: a silently-dropped third decimal is money
    // going missing at the one boundary where a person is typing.
    expect(rupeesToMinor('7000.505')).toBeNull();
    expect(rupeesToMinor('')).toBeNull();
    expect(rupeesToMinor('abc')).toBeNull();
    expect(rupeesToMinor('-500')).toBeNull();
  });

  it('round-trips back to an editable string', () => {
    expect(minorToRupees(700_000)).toBe('7000');
    expect(minorToRupees(700_050)).toBe('7000.50');
  });

  it('never produces a plausible number from nonsense', () => {
    expect(amountMinor(Number.NaN, 700_000, 40)).toBe(0);
    expect(amountMinor(10, 700_000, 0)).toBe(0);
    expect(amountMinor(-1, 700_000, 40)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The dispatch sheet
// ---------------------------------------------------------------------------

const row = (over: Partial<SheetRow> & Pick<SheetRow, 'destination_id' | 'name'>): SheetRow => ({
  kind: 'dodhi',
  billable: true,
  standing: true,
  existing: null,
  previous: null,
  price: {
    id: 'prc_1',
    destination_id: over.destination_id,
    effective_from: '2026-01-01',
    price_minor: 700_000,
    price_unit_litres: 40,
    recorded_by: 'a',
    recorded_at: 't',
    note: null,
  },
  ...over,
});

const SHEET: DispatchSheet = {
  occurred_on: '2026-02-01',
  session: 'morning',
  previous_session: { occurred_on: '2026-01-31', session: 'morning' },
  standing: [
    row({ destination_id: 'dst_dodhi', name: 'Bashir' }),
    row({ destination_id: 'dst_home', name: 'Home', kind: 'home', billable: false, price: null }),
  ],
  occasional: [
    row({ destination_id: 'dst_ali', name: 'Ali', kind: 'household', standing: false }),
  ],
  litres: 0,
  amount_minor: 0,
  produced: {
    measured_litres: 22,
    measured: 3,
    not_measured: 0,
    not_milked: 0,
    expected: 3,
    recorded: 3,
  },
};

class FakeApi {
  sheet: DispatchSheet = structuredClone(SHEET);
  saved: Record<string, unknown> | null = null;

  /** The sheet's IdentifierInput asks for these on construction. */
  identifierValues(): Promise<{ observed_by: string[]; acquired_from: string[]; sire_ref: string[] }> {
    return Promise.resolve({ observed_by: ['imran', 'abdul'], acquired_from: [], sire_ref: [] });
  }

  dispatchSheet(): Promise<DispatchSheet> {
    return Promise.resolve(structuredClone(this.sheet));
  }
  saveDispatchSession(body: Record<string, unknown>): Promise<unknown> {
    this.saved = body;
    return Promise.resolve({
      occurred_on: '2026-02-01', session: 'morning',
      written: 2, taken: 2, none: 0, updated: 0, litres: 15, amount_minor: 218_750,
    });
  }
}

async function renderSheet(api: FakeApi) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: RegistryApi, useValue: api },
    ],
  });
  const session = TestBed.inject(Session);
  session.set('direct_entry', 'adnan');

  const fixture = TestBed.createComponent(DispatchSheetScreen);
  fixture.detectChanges();
  // The effect that loads the sheet resolves on a microtask; without the tick
  // the component still renders its empty state.
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('DispatchSheetScreen', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('SPLITS the sheet: standing must be answered, occasional must not', async () => {
    const { el } = await renderSheet(new FakeApi());
    expect(el.querySelector('[data-role="standing-head"]')!.textContent).toContain(
      'leave none of these unanswered',
    );
    expect(el.querySelector('[data-role="occasional-head"]')!.textContent).toContain(
      'nothing to answer here',
    );
    // The occasional row is not an input until someone says it took milk.
    expect(el.querySelector('[data-role="add-dst_ali"]')).not.toBeNull();
    expect(el.querySelector('[data-role="litres-dst_ali"]')).toBeNull();
  });

  it('BLOCKS THE SAVE on an unanswered standing destination, and NAMES it', async () => {
    // Named, not counted: "2 left" makes the operator hunt, and the hunt is
    // where one gets skipped.
    const { el } = await renderSheet(new FakeApi());
    const blocked = el.querySelector('[data-role="blocked"]')!;
    expect(blocked.textContent).toContain('Bashir');
    expect(blocked.textContent).toContain('Home');
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
  });

  it('does NOT block on an untouched occasional destination', async () => {
    const { fixture, el } = await renderSheet(new FakeApi());
    for (const id of ['dst_dodhi', 'dst_home']) {
      const input = el.querySelector(`[data-role="litres-${id}"]`) as HTMLInputElement;
      input.value = '12';
      input.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
    expect(el.querySelector('[data-role="blocked"]')).toBeNull();
    expect((el.querySelector('[data-role="submit"]') as HTMLButtonElement).getAttribute('aria-disabled')).toBeNull();
  });

  it('shows the rate AS AGREED, and the amount it produces', async () => {
    const { fixture, el } = await renderSheet(new FakeApi());
    const input = el.querySelector('[data-role="litres-dst_dodhi"]') as HTMLInputElement;
    input.value = '12.5';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const dodhiRow = el.querySelector('[data-row="dst_dodhi"]')!;
    expect(dodhiRow.querySelector('[data-role="rate"]')!.textContent).toContain('Rs 7,000.00 / 40 L');
    expect(el.querySelector('[data-role="amount-dst_dodhi"]')!.textContent).toContain('Rs 2,187.50');
  });

  it('marks home as kept rather than sold, and never prices it', async () => {
    const { fixture, el } = await renderSheet(new FakeApi());
    const homeRow = el.querySelector('[data-row="dst_home"]')!;
    expect(homeRow.querySelector('[data-role="not-billed"]')!.textContent).toContain('kept, not sold');
    expect(homeRow.querySelector('[data-role="rate"]')!.textContent).toContain('not billed');

    const input = el.querySelector('[data-role="litres-dst_home"]') as HTMLInputElement;
    input.value = '3';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // WAS AN EM DASH, AND THE DASH WAS THE WRONG ANSWER. §15 rule 1: "an
    // absence is named, not blanked ... The one dash permitted is §6's
    // no-record state, which is the absence of an answer rather than an
    // answer." Home milk having no amount is not a missing record -- it is a
    // destination that is not billed, which the rate column beside it has
    // always said in words. So the amount says it too.
    //
    // The test's own name is "never prices it", and `not billed` keeps that
    // promise more legibly than a dash did.
    const amount = el.querySelector('[data-role="amount-dst_home"]')!;
    expect(amount.textContent).toContain('not billed');
    // §6's third state: an answer was given, so it is italic and it is words.
    expect(amount.querySelector('[data-certainty="absent"]')).not.toBeNull();
  });

  it('sends only rows with an answer -- an absent neighbour is not an omission', async () => {
    const api = new FakeApi();
    const { fixture, el } = await renderSheet(api);
    for (const [id, v] of [['dst_dodhi', '12.5'], ['dst_home', '3']] as const) {
      const input = el.querySelector(`[data-role="litres-${id}"]`) as HTMLInputElement;
      input.value = v;
      input.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    const entries = api.saved!['entries'] as { destination_id: string }[];
    expect(entries.map((e) => e.destination_id).sort()).toEqual(['dst_dodhi', 'dst_home']);
  });

  it('clearing a number returns the row to untouched rather than to a zero', async () => {
    // A zero would be a claim that they came and took nothing, which is what
    // "nothing taken" is for.
    const { fixture, el } = await renderSheet(new FakeApi());
    const input = el.querySelector('[data-role="litres-dst_dodhi"]') as HTMLInputElement;
    input.value = '12';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.value = '';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-role="blocked"]')!.textContent).toContain('Bashir');
  });

  it('says production is a LOWER BOUND when something was not weighed, without alarming', async () => {
    const api = new FakeApi();
    api.sheet.produced = {
      measured_litres: 14, measured: 2, not_measured: 1, not_milked: 0, expected: 3, recorded: 3,
    };
    const { el } = await renderSheet(api);
    const note = el.querySelector('[data-role="produced-note"]')!;
    expect(note.textContent).toContain('lower bound');
    expect(note.textContent).toContain('1 milked but not weighed');
    // Tone matters as much as content here: this fires for months on a farm
    // that is still learning to weigh, and an alarm would be trained away.
    expect(note.className).not.toContain('red');
  });

  it('says nothing about production when nothing is missing', async () => {
    const { el } = await renderSheet(new FakeApi());
    expect(el.querySelector('[data-role="produced-note"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The buyers screen
// ---------------------------------------------------------------------------

class FakeDestApi {
  rows = [
    {
      id: 'dst_dodhi', name: 'Bashir', kind: 'dodhi' as const, billable: true, standing: true,
      contact: null, started_on: '2026-01-01', ended_on: null, note: null,
      recorded_by: 'a', recorded_at: 't', active: true,
      price: {
        id: 'prc_1', destination_id: 'dst_dodhi', effective_from: '2026-01-01',
        price_minor: 700_000, price_unit_litres: 40, recorded_by: 'a', recorded_at: 't', note: null,
      },
    },
  ];
  saved: unknown = null;
  destinations(): Promise<unknown[]> {
    return Promise.resolve(structuredClone(this.rows));
  }
  setPrice(_id: string, body: unknown): Promise<unknown> {
    this.saved = body;
    return Promise.resolve(body);
  }
  addDestination(body: unknown): Promise<unknown> {
    this.saved = body;
    return Promise.resolve({ ...(body as object), id: 'dst_new', billable: true, name: 'X' });
  }
}

async function renderBuyers(api: FakeDestApi) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: RegistryApi, useValue: api },
    ],
  });
  TestBed.inject(Session).set('direct_entry', 'adnan');
  const fixture = TestBed.createComponent(DestinationsList);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('DestinationsList', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the rate in the farm’s unit, with the per-litre figure only as a check', async () => {
    const { el } = await renderBuyers(new FakeDestApi());
    const rate = el.querySelector('[data-role="rate-dst_dodhi"]')!.textContent!;
    expect(rate).toContain('Rs 7,000.00 / 40 L');
    expect(rate).toContain('Rs 175.00 per litre');
  });

  it('says whether a destination is on every sheet, in words', async () => {
    const { el } = await renderBuyers(new FakeDestApi());
    expect(el.querySelector('[data-role="standing-dst_dodhi"]')!.textContent).toContain(
      'must be answered',
    );
  });

  it('PREVIEWS the rate it understood before it will accept it', async () => {
    // The parse-then-show-back contract. This line is what stands between a
    // mistyped lot size and a rate agreed at forty times the intended price.
    const { fixture, el } = await renderBuyers(new FakeDestApi());
    (el.querySelector('[data-role="price-dst_dodhi"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const amount = el.querySelector('[data-role="price-amount"]') as HTMLInputElement;
    amount.value = '7200';
    amount.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const preview = el.querySelector('[data-role="price-preview"]')!.textContent!;
    expect(preview).toContain('Rs 7,200.00 / 40 L');
    expect(preview).toContain('Rs 180.00 per litre');
  });

  it('refuses to submit a rate it could not parse', async () => {
    const { fixture, el } = await renderBuyers(new FakeDestApi());
    (el.querySelector('[data-role="price-dst_dodhi"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const unit = el.querySelector('[data-role="price-unit"]') as HTMLInputElement;
    unit.value = '0';
    unit.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(el.querySelector('[data-role="price-preview"]')!.textContent).toContain(
      'Enter an amount',
    );
    expect((el.querySelector('[data-role="price-submit"]') as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
  });

  it('sends the lot size as its own number, not folded into the rate', async () => {
    const api = new FakeDestApi();
    const { fixture, el } = await renderBuyers(api);
    (el.querySelector('[data-role="price-dst_dodhi"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const amount = el.querySelector('[data-role="price-amount"]') as HTMLInputElement;
    amount.value = '7200';
    amount.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('[data-role="price-form"]') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    await fixture.whenStable();

    const saved = api.saved as { price_minor: number; price_unit_litres: number };
    expect(saved.price_minor).toBe(720_000);
    expect(saved.price_unit_litres).toBe(40);
  });

  it('says out loud that home milk is never billed', async () => {
    const { fixture, el } = await renderBuyers(new FakeDestApi());
    const homeChip = [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Home (kept)'),
    )!;
    homeChip.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-role="home-note"]')!.textContent).toContain('never billed');
  });
});
