import { TestBed } from '@angular/core/testing';
import { ChipGroup } from './chip-group';
import type { ChipOption } from './chip-group';

const OUTCOMES: ChipOption[] = [
  { value: 'live', label: 'Live' },
  { value: 'stillborn', label: 'Stillborn' },
  { value: 'died_within_24h', label: 'Died within 24h' },
];

function make(options = OUTCOMES, value: string | null = 'live') {
  const fixture = TestBed.createComponent(ChipGroup);
  const emitted: string[] = [];
  // Fed back into the input, because this is a CONTROLLED component: the parent
  // owns the value. A harness that swallows the emission would leave `value`
  // pinned and make every arrow press look like the first one.
  fixture.componentInstance.changed.subscribe((v) => {
    emitted.push(v);
    fixture.componentRef.setInput('value', v);
    fixture.detectChanges();
  });
  fixture.componentRef.setInput('options', options);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('name', 'outcome');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;

  const group = () => el.querySelector('[role="radiogroup"]') as HTMLElement;
  const chip = (v: string) => el.querySelector(`[data-chip="${v}"]`) as HTMLButtonElement;
  const key = (k: string) => {
    group().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };
  const last = () => emitted[emitted.length - 1];
  return { fixture, el, emitted, group, chip, key, last };
}

describe('ChipGroup — one tab stop, arrows within', () => {
  it('is ONE tab stop, not one per option', () => {
    // A radiogroup is a single tab stop; a row of independent ones is what
    // turns a three-chip form into eight tab presses.
    const { el } = make();
    const tabbable = [...el.querySelectorAll('[data-chip]')].filter(
      (n) => n.getAttribute('tabindex') === '0',
    );
    expect(tabbable.length).toBe(1);
    expect(tabbable[0].getAttribute('data-chip')).toBe('live');
  });

  it('puts the tab stop on the FIRST chip when nothing is selected', () => {
    // Reachable is not the same as answered. The gate's source form starts
    // unanswered and still has to be arrivable by Tab.
    const { el } = make(OUTCOMES, null);
    const tabbable = [...el.querySelectorAll('[data-chip]')].filter(
      (n) => n.getAttribute('tabindex') === '0',
    );
    expect(tabbable.length).toBe(1);
    expect(tabbable[0].getAttribute('data-chip')).toBe('live');
    expect(el.querySelector('[aria-checked="true"]')).toBeNull();
  });

  it('moves the tab stop with the selection', () => {
    const { fixture, el } = make();
    fixture.componentRef.setInput('value', 'stillborn');
    fixture.detectChanges();
    expect(el.querySelector('[data-chip="stillborn"]')!.getAttribute('tabindex')).toBe('0');
    expect(el.querySelector('[data-chip="live"]')!.getAttribute('tabindex')).toBe('-1');
  });

  it('arrows move and select together, and wrap past both ends', () => {
    // In a group where every option is valid, arrowing to one IS choosing it;
    // a separate confirm step would be a keystroke that means nothing.
    const { key, last } = make();
    key('ArrowRight');
    expect(last()).toBe('stillborn');
    key('ArrowRight');
    expect(last()).toBe('died_within_24h');
    key('ArrowRight'); // wraps forward
    expect(last()).toBe('live');
    key('ArrowLeft'); // wraps backward
    expect(last()).toBe('died_within_24h');
    key('ArrowDown'); // Down behaves as Right, for a vertical group
    expect(last()).toBe('live');
  });

  it('Home and End jump to the ends', () => {
    const { key, last } = make(OUTCOMES, 'stillborn');
    key('End');
    expect(last()).toBe('died_within_24h');
    key('Home');
    expect(last()).toBe('live');
  });

  it('DIGITS select directly, and the digit is printed on the chip', () => {
    // The real accelerator on a transcription job. A shortcut nobody can see is
    // a shortcut nobody uses, so the number is rendered.
    const { el, key, last } = make();
    expect(el.querySelector('[data-chip="live"] [data-role="chip-key"]')!.textContent!.trim())
      .toBe('1');
    key('3');
    expect(last()).toBe('died_within_24h');
  });

  it('ignores a digit past the end of the list', () => {
    const { emitted, key } = make();
    key('9');
    expect(emitted.length).toBe(0);
  });

  it('selects by first letter when it is unambiguous', () => {
    const { key, last } = make();
    key('d');
    expect(last()).toBe('died_within_24h');
  });

  it('will NOT guess between two labels sharing a letter', () => {
    // Moving the selection somewhere the operator did not ask for is worse than
    // doing nothing.
    const { emitted, key } = make([
      { value: 'sold', label: 'Sold' },
      { value: 'sick', label: 'Sick' },
    ], 'sold');
    key('s');
    expect(emitted.length).toBe(0);
  });

  it('lets an unhandled key keep bubbling, or Enter would never reach the form', () => {
    const { group } = make();
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    group().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);

    const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    group().dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
  });

  it('does not swallow Tab', () => {
    const { group } = make();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    group().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('a click still selects, for the mouse path', () => {
    const { fixture, chip, last } = make();
    chip('stillborn').click();
    fixture.detectChanges();
    expect(last()).toBe('stillborn');
  });

  it('carries the ARIA a radiogroup promises', () => {
    // The old hand-rolled rows had role="radiogroup" with no key handling at
    // all, which advertised an affordance that did not exist.
    const { el, group } = make();
    expect(group().getAttribute('role')).toBe('radiogroup');
    expect(el.querySelector('[data-chip="live"]')!.getAttribute('role')).toBe('radio');
    expect(el.querySelector('[data-chip="live"]')!.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('[data-chip="stillborn"]')!.getAttribute('aria-checked')).toBe('false');
  });

  it('every chip is type=button, so none of them submits the form it sits in', () => {
    const { el } = make();
    for (const n of el.querySelectorAll('[data-chip]')) {
      expect(n.getAttribute('type')).toBe('button');
    }
  });

  it('renders a hint beside the label where one is given', () => {
    const { el } = make([{ value: 'recall', label: 'Recall', hint: 'reconstructed from memory' }], null);
    expect(el.querySelector('[data-chip="recall"]')!.textContent).toContain(
      'reconstructed from memory',
    );
  });
});
