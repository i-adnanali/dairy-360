import { TestBed } from '@angular/core/testing';
import { Shortcuts } from './shortcuts';

// ---------------------------------------------------------------------------
// The one owner of global keys. §12.6.
// ---------------------------------------------------------------------------
// §12.6's warning is the whole reason this class exists: "Nothing registers a
// global key handler today. Cmd+K, the held Cmd+Enter and anything after them
// need one owner, or the second one added silently shadows the first."
//
// So the tests are mostly about the collision and about NOT firing, which are
// the two behaviours a hand-rolled `document.addEventListener` gets wrong.

const IS_MAC = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/** A mod-key event for whichever platform the suite is running on. */
function press(key: string, opts: { mod?: boolean; target?: HTMLElement } = {}) {
  const e = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: opts.mod === true && IS_MAC,
    ctrlKey: opts.mod === true && !IS_MAC,
  });
  (opts.target ?? document.body).dispatchEvent(e);
  return e;
}

describe('Shortcuts — §12.6', () => {
  let s: Shortcuts;

  beforeEach(() => {
    TestBed.resetTestingModule();
    s = TestBed.inject(Shortcuts);
  });

  it('runs a registered chord and prevents the browser default', () => {
    let ran = 0;
    s.register('mod+/', 'test', () => { ran++; });
    const e = press('/', { mod: true });
    expect(ran).toBe(1);
    // Cmd+/ is unbound in most browsers, but Cmd+K is not and neither is
    // Ctrl+/. Claiming a chord means claiming it.
    expect(e.defaultPrevented).toBe(true);
  });

  it('REFUSES a chord somebody already has, and names both owners', () => {
    s.register('mod+k', 'CommandPalette', () => {});
    // The failure §12.6 predicts is silence -- two listeners, one of which
    // stops working on some keyboards. This is that failure turned into a
    // startup error with two names in it.
    expect(() => s.register('mod+k', 'AssistantPanel', () => {})).toThrowError(
      /already registered by CommandPalette.*AssistantPanel/s,
    );
  });

  it('frees the chord when the registration is undone', () => {
    const undo = s.register('mod+k', 'First', () => {});
    undo();
    // A registration that is never undone leaves the chord taken forever, and
    // the NEXT one throws for no visible reason. That is why register returns
    // its own undo rather than calling inject(DestroyRef) internally.
    expect(() => s.register('mod+k', 'Second', () => {})).not.toThrow();
    expect(s.claimed()).toEqual(['mod+k']);
  });

  it('does NOT fire a bare key from inside a text field', () => {
    // The rule that matters most on this app. The milking roster and the
    // dispatch sheet bind bare `m` and `n` INSIDE their litres inputs, the
    // composer takes free text, and both frozen forms are nothing but inputs.
    // A global bare-key handler that fired in them would be the fastest way to
    // lose a half-typed figure.
    let ran = 0;
    s.register('m', 'somethingReckless', () => { ran++; });

    const input = document.createElement('input');
    document.body.append(input);
    press('m', { target: input });
    expect(ran).toBe(0);

    press('m');
    expect(ran).toBe(1);
    input.remove();
  });

  it('DOES fire a modifier chord from inside a text field', () => {
    // Cmd+/ typed in the composer should still put the panel away: the person
    // pressing it is asking for exactly that, and their hands are already
    // there.
    let ran = 0;
    s.register('mod+/', 'AssistantPanel', () => { ran++; });
    const input = document.createElement('input');
    document.body.append(input);
    press('/', { mod: true, target: input });
    expect(ran).toBe(1);
    input.remove();
  });

  it('ignores a keystroke that is part of an IME composition', () => {
    // Skipping `isComposing` is what stops an input method mid-word from
    // triggering handlers. Not hypothetical for this farm: the identifier
    // fields take names typed in more than one script.
    let ran = 0;
    s.register('m', 'anything', () => { ran++; });
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'm', bubbles: true, isComposing: true }),
    );
    expect(ran).toBe(0);
  });
});
