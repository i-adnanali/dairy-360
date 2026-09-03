import { TestBed } from '@angular/core/testing';
import { PrecisionDateControl, dateBlocker } from './precision-date';
import type { DateEntry } from './precision-date';

function make() {
  const fixture = TestBed.createComponent(PrecisionDateControl);
  const emitted: DateEntry[] = [];
  fixture.componentInstance.changed.subscribe((v) => emitted.push(v));
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;

  const type = (v: string) => {
    const n = el.querySelector('[data-role="date-text"]') as HTMLInputElement;
    n.value = v;
    n.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const last = () => emitted[emitted.length - 1];
  /** The completed value, or a failure naming the state that came back instead. */
  const val = () => {
    const e = last();
    if (e.status !== 'complete') throw new Error(`expected complete, got ${e.status}`);
    return e.value;
  };
  return { fixture, el, emitted, type, last, val };
}

describe('PrecisionDateControl — one field, precision read from it', () => {
  it('starts empty and emits EMPTY, not a date', () => {
    const { el, last } = make();
    expect((el.querySelector('[data-role="date-text"]') as HTMLInputElement).value).toBe('');
    expect(last().status).toBe('empty');
  });

  it('reads a year, a month and a day from what was typed', () => {
    const { type, val } = make();
    type('2019');
    expect(val()).toEqual({
      occurred_on: '2019-01-01',
      date_precision: 'year',
      occurred_time: null,
    });
    type('Mar 2019');
    expect(val().date_precision).toBe('month');
    type('6 Jul 2023');
    expect(val().occurred_on).toBe('2023-07-06');
  });

  it('SHOWS THE READING BACK, because an unseen inference is a default', () => {
    const { el, type } = make();
    type('Mar 2019');
    const reading = el.querySelector('[data-role="reading"]')!;
    expect(reading.textContent).toContain('month only');
    expect(reading.textContent).toContain('stored as the 1st');
  });

  it('offers retyping as the escape, and no way to claim a day that was not typed', () => {
    // The whole guarantee. A control that could assert day precision over
    // `Mar 2019` would rebuild the fabrication the empty-fields fix closed.
    const { el, type } = make();
    type('Mar 2019');
    expect(el.querySelector('[data-role="reading-escape"]')!.textContent).toContain(
      'Nothing here can claim a day you did not type',
    );
    expect(el.querySelector('[data-precision="day"]')).toBeNull();
  });

  it('offers a time input ONLY once a day has been typed', () => {
    const { el, type } = make();
    type('Mar 2019');
    expect(el.querySelector('[data-role="time"]')).toBeNull();
    type('6 Jul 2023');
    expect(el.querySelector('[data-role="time"]')).not.toBeNull();
  });

  it('drops a time when the date stops being a day, so it cannot be sent above it', () => {
    const { fixture, el, type, val } = make();
    type('6 Jul 2023');
    const t = el.querySelector('[data-role="time"]') as HTMLInputElement;
    t.value = '05:30';
    t.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(val().occurred_time).toBe('05:30');

    type('Mar 2019');
    expect(val().occurred_time).toBeNull();
  });
});

describe('PrecisionDateControl — the three states', () => {
  it('text that does not parse is INCOMPLETE and says why, without emitting a date', () => {
    const { el, type, last } = make();
    type('06/07/2023');
    expect(last().status).toBe('incomplete');
    expect(el.querySelector('[data-role="incomplete"]')!.textContent).toContain('Ambiguous');
    expect(el.querySelector('[data-role="reading"]')).toBeNull();
  });

  it('goes back to EMPTY when cleared, which is a different state from incomplete', () => {
    const { type, last } = make();
    type('06/07/2023');
    expect(last().status).toBe('incomplete');
    type('');
    expect(last().status).toBe('empty');
  });

  it('retracts a complete date when the text is emptied', () => {
    const { type, last } = make();
    type('2019');
    expect(last().status).toBe('complete');
    type('');
    expect(last().status).toBe('empty');
  });
});

describe('PrecisionDateControl — the estimated modifier', () => {
  const box = (el: HTMLElement) => el.querySelector('[data-role="estimated"]') as HTMLInputElement;
  const tick = (fixture: { detectChanges(): void }, el: HTMLElement) => {
    box(el).checked = true;
    box(el).dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  it('turns a bare year into an estimated year', () => {
    const { fixture, el, type, val } = make();
    type('2019');
    tick(fixture, el);
    expect(val().date_precision).toBe('estimated');
    expect(el.querySelector('[data-role="reading"]')!.textContent).toContain('estimated year');
  });

  it('stores January 1 either way, so the convention is untouched', () => {
    const { fixture, el, type, val } = make();
    type('2019');
    const plain = val().occurred_on;
    tick(fixture, el);
    expect(val().occurred_on).toBe(plain);
  });

  it('is DISABLED with the reason showing where it cannot apply', () => {
    // Disabled rather than hidden, so the answer is readable before it is
    // needed. An estimate stores January 1, so it can only qualify a year.
    const { el, type } = make();
    type('6 Jul 2023');
    expect(box(el).disabled).toBe(true);
    expect(el.querySelector('[data-role="estimated-why"]')!.textContent).toContain(
      'only applies to a bare year',
    );
  });

  it('a stale tick cannot alter a month or a day', () => {
    const { fixture, el, type, val } = make();
    type('2019');
    tick(fixture, el);
    type('6 Jul 2023');
    expect(val().date_precision).toBe('day');
  });
});

describe('PrecisionDateControl — the explainer', () => {
  it('carries the no-default rationale by default', () => {
    const { el } = make();
    expect(el.querySelector('[data-role="hint"]')!.textContent).toContain('a default is how');
  });

  it('drops only the rationale when explain is false', () => {
    const { fixture, el } = make();
    fixture.componentRef.setInput('explain', false);
    fixture.detectChanges();
    const hint = el.querySelector('[data-role="hint"]')!.textContent!;
    expect(hint).toContain('read from what you type');
    expect(hint).not.toContain('a default is how');
  });

  it('shows the server refusal verbatim', () => {
    const { fixture, el } = make();
    const prose =
      "month precision must be stored as the 1st of the month, got '2024-03-14'. " +
      'A month row dated mid-month means a known date was silently downgraded.';
    fixture.componentRef.setInput('error', prose);
    fixture.detectChanges();
    expect(el.querySelector('[data-role="error"]')!.textContent!.trim()).toBe(prose);
  });
});

describe('dateBlocker — the shared rule three forms must not disagree about', () => {
  const entry = (status: DateEntry['status']): DateEntry =>
    status === 'complete'
      ? {
          status: 'complete',
          value: { occurred_on: '2019-01-01', date_precision: 'year', occurred_time: null },
          reading: 'x',
        }
      : status === 'incomplete'
        ? { status: 'incomplete', message: 'x' }
        : { status: 'empty' };

  it('blocks an INCOMPLETE date whether it is required or not', () => {
    // Half-typed text on an OPTIONAL field would otherwise be sent as null --
    // a birth year the operator typed, gone without a trace.
    for (const required of [true, false]) {
      expect(dateBlocker(entry('incomplete'), { label: 'birth date', required })).toContain(
        'not understood yet',
      );
    }
  });

  it('blocks an EMPTY date only when it is required', () => {
    expect(dateBlocker(entry('empty'), { label: 'arrival date', required: true })).toContain(
      'Enter the arrival date',
    );
    expect(dateBlocker(entry('empty'), { label: 'birth date', required: false })).toBeNull();
  });

  it('never blocks a complete date', () => {
    for (const required of [true, false]) {
      expect(dateBlocker(entry('complete'), { label: 'd', required })).toBeNull();
    }
  });

  it('names the field, so a form with two dates says which one', () => {
    expect(dateBlocker(entry('incomplete'), { label: 'birth date', required: false })).toContain(
      'birth date',
    );
  });
});
