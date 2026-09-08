// The one owner of global keyboard shortcuts.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS BEFORE THERE ARE TWO OF THEM
// ---------------------------------------------------------------------------
// docs/UI_SYSTEM.md §12.6, verbatim:
//
//   "NOTHING REGISTERS A GLOBAL KEY HANDLER TODAY. Cmd+K, the held Cmd+Enter
//    and anything after them need one owner, or the second one added silently
//    shadows the first."
//
// §13.1's Cmd/Ctrl+/ is the first, so it is the one that pays for the registry.
// The alternative -- a `document.addEventListener` inside the assistant panel --
// works perfectly and is exactly what makes the second one a bug: two listeners
// on `keydown`, no shared record of which chords are taken, and the failure is
// that one of them silently stops firing on some keyboards. Held items §12.6
// names next: Cmd+K for the palette, and Cmd+Enter from
// REGISTRY_ENTRY_UX.md §11.
//
// ---------------------------------------------------------------------------
// WHAT IT REFUSES TO DO
// ---------------------------------------------------------------------------
// It is not a keymap system. No sequences, no contexts, no priorities -- those
// are the features that make a shortcut library, and this app has one shortcut.
// What it does have is the property the warning asks for: registering a chord
// that is already taken THROWS, at startup, naming both owners. A collision is
// a programming mistake and it should not be discoverable only by somebody on a
// different keyboard finding that Cmd+K does nothing.
//
// ---------------------------------------------------------------------------
// TYPING IS NOT A SHORTCUT
// ---------------------------------------------------------------------------
// Every handler is skipped while focus is in a text field, and that is not a
// nicety on this app. The milking roster and the dispatch sheet bind bare `m`
// and `n` inside their litres inputs (milking-roster.ts `onKey`), the composer
// takes free text, and both frozen forms are nothing but inputs. A global
// handler that fired inside them would be the fastest possible way to lose a
// half-typed figure.
//
// Modifier chords are exempt from that rule: Cmd+/ inside the composer should
// still close the panel, because the person pressing it is asking to put the
// panel away and their hands are already there.

import { Injectable } from '@angular/core';

/** A chord, normalised: `mod+/`, `mod+k`, `escape`. `mod` is Cmd or Ctrl. */
export type Chord = string;

interface Registration {
  chord: Chord;
  /** For the collision message: who took it first. */
  owner: string;
  run: (e: KeyboardEvent) => void;
}

/**
 * `mod` rather than `meta` or `ctrl`.
 *
 * Cmd on macOS, Ctrl everywhere else, and NOT "either one on both platforms":
 * Ctrl+/ on macOS is a live text-editing binding in some input methods, and
 * Cmd+/ on Windows is nothing. §13.1 writes it as "Cmd/Ctrl+/", which is the
 * same intent.
 */
function isMod(e: KeyboardEvent): boolean {
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? e.metaKey
    : e.ctrlKey;
}

/** What the event is, as a chord string. */
function chordOf(e: KeyboardEvent): Chord {
  return (isMod(e) ? 'mod+' : '') + e.key.toLowerCase();
}

/** Is focus somewhere that swallows a bare keystroke? */
function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  );
}

@Injectable({ providedIn: 'root' })
export class Shortcuts {
  private readonly registered = new Map<Chord, Registration>();

  constructor() {
    document.addEventListener('keydown', this.onKeyDown, { capture: true });
  }

  /**
   * Claim a chord. Throws if somebody already has it.
   *
   * `owner` is a label for that message and nothing else -- the component or
   * feature name is enough. It is the whole reason a collision is legible
   * rather than a mystery.
   *
   * RETURNS ITS OWN UNDO, and the caller wires that to a DestroyRef. Not an
   * `inject(DestroyRef)` in here: `inject` reads the CURRENT injection context,
   * which during a component's constructor is that component's -- so a method
   * on a root service would silently do the right thing when called from a
   * constructor and throw when called from anywhere else. That is the kind of
   * subtlety that costs an hour the first time somebody calls this from a
   * click handler.
   *
   * A registration that is never undone leaves the chord taken forever, and the
   * NEXT registration then throws for no visible reason -- so a transient owner
   * must undo, and a permanent one may ignore the return value.
   */
  register(chord: Chord, owner: string, run: (e: KeyboardEvent) => void): () => void {
    const existing = this.registered.get(chord);
    if (existing) {
      throw new Error(
        `Shortcut "${chord}" is already registered by ${existing.owner}; ` +
          `${owner} cannot also take it. See UI_SYSTEM.md §12.6.`,
      );
    }
    this.registered.set(chord, { chord, owner, run });
    return () => {
      if (this.registered.get(chord)?.owner === owner) this.registered.delete(chord);
    };
  }

  /** For a test, and for a diagnostic: what is taken. */
  claimed(): Chord[] {
    return [...this.registered.keys()].sort();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // A chord being assembled -- Dead keys, IME composition -- is not a
    // shortcut. `isComposing` is the standard signal and skipping it is what
    // stops a Japanese or Urdu input method from triggering handlers mid-word.
    if (e.isComposing) return;

    const hit = this.registered.get(chordOf(e));
    if (!hit) return;
    // Bare keys never fire from inside a field; modifier chords always do. See
    // the header -- the roster binds bare `m` and `n` inside its own inputs.
    if (!hit.chord.startsWith('mod+') && inTextField(e.target)) return;

    e.preventDefault();
    hit.run(e);
  };
}
