import { TestBed } from '@angular/core/testing';
import { Theme } from './theme';

/**
 * The stored value is USER-WRITABLE, which is the reason most of this file
 * exists. Anybody can put anything in localStorage, and a bad value would
 * otherwise flow through `resolved()` into `classList.toggle` and
 * `style.colorScheme`.
 */
const KEY = 'dairy360.theme';

function fresh(): Theme {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(Theme);
}

describe('Theme', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
  });
  afterEach(() => {
    localStorage.removeItem(KEY);
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
  });

  it('defaults to system rather than to a hard-coded light', () => {
    // Section 8 asks for three states, and `system` is the one most operators
    // should stay on -- the answer genuinely differs between a bright veranda
    // in the morning and entering the evening session indoors.
    expect(fresh().mode()).toBe('system');
  });

  it('cycles system -> light -> dark -> system', () => {
    const theme = fresh();
    expect(theme.mode()).toBe('system');
    theme.cycle();
    expect(theme.mode()).toBe('light');
    theme.cycle();
    expect(theme.mode()).toBe('dark');
    theme.cycle();
    // Back to system, which a two-way toggle could never reach again.
    expect(theme.mode()).toBe('system');
  });

  it('resolves an explicit choice to itself, ignoring the OS', () => {
    const theme = fresh();
    theme.set('dark');
    expect(theme.resolved()).toBe('dark');
    theme.set('light');
    expect(theme.resolved()).toBe('light');
  });

  it('puts the class and color-scheme on <html>, and takes them off again', () => {
    const theme = fresh();
    theme.set('dark');
    TestBed.tick();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    // The half people forget: `.dark` restyles what the app draws, and
    // `color-scheme` is what makes the browser's own scrollbars, date pickers
    // and select dropdowns follow. Without it a dark page opens a white
    // calendar over itself.
    expect(document.documentElement.style.colorScheme).toBe('dark');

    theme.set('light');
    TestBed.tick();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('persists the choice, unlike Session — see the header of theme.ts', () => {
    const theme = fresh();
    theme.set('dark');
    TestBed.tick();
    expect(localStorage.getItem(KEY)).toBe('dark');
    // A second instance reads it back, which is the whole point.
    expect(fresh().mode()).toBe('dark');
  });

  it('REFUSES a junk stored value instead of passing it through', () => {
    localStorage.setItem(KEY, 'banana');
    expect(fresh().mode()).toBe('system');
  });

  it('refuses a plausible-looking one too', () => {
    // Not in the union. The check is membership, not truthiness.
    localStorage.setItem(KEY, 'Dark');
    expect(fresh().mode()).toBe('system');
  });
});
