// The override notice's logic, shared by every form that saves over a warning:
// the breeding form, the calving form and the calving correction. One system,
// not one per form; each form keeps its own markup around it.
//
// The server names each warning by its code. Two or more fired at once come
// back under `breeding_warnings`, each listed; one comes back under its own
// code, listed or (with the breeding flag off) as the bare message. The button
// sets only the flags of the warnings on screen, for one submit.

import { afterRenderEffect, computed } from '@angular/core';
import type { ElementRef, Signal } from '@angular/core';
import type { FormState } from './form-state';

/**
 * The warnings a calving (or a calving correction) can be saved over, and the
 * flag each one sets. Here rather than in either form, since both use it.
 */
export const CALVING_OVERRIDES = {
  near_duplicate_calving: 'allow_near_duplicate',
  calving_before_window: 'allow_calving_before_window',
  calving_past_extreme: 'allow_calving_past_extreme',
} as const;
export type CalvingWarning = keyof typeof CALVING_OVERRIDES;

/** Two or more warnings fired at once come back under this code, each listed. */
const SEVERAL = 'breeding_warnings';

export interface Warning {
  check: string;
  message: string;
}

/**
 * Call in an injection context (a field initializer or the constructor): the
 * focus move is an afterRenderEffect.
 *
 * `overrides` maps each warning the form can save over to the flag it sets.
 * `notice` is the element holding the sentences (role="alert", tabindex -1).
 */
export function saveOver<C extends string>(
  state: FormState<any>,
  overrides: Readonly<Record<C, string>>,
  notice: Signal<ElementRef<HTMLElement> | undefined>,
) {
  const codes = Object.keys(overrides) as C[];
  const known = (code: string): code is C => (codes as string[]).includes(code);

  /**
   * Every warning the last refusal carried: the listed ones under
   * `breeding_warnings`, or the single one named by its own code (whose body
   * may list it too, or not). Empty when the refusal is not a warning.
   */
  const warnings = computed<Warning[]>(() => {
    const e = state.error();
    if (!e || !e.isRefusal) return [];
    if (e.code === SEVERAL) return e.warnings ?? [];
    if (!known(e.code)) return [];
    return e.warnings?.length ? e.warnings : [{ check: e.code, message: e.message }];
  });

  /** The codes on screen that have a flag: exactly what a save-over sets. */
  const shown = computed(() =>
    warnings()
      .map((w) => w.check)
      .filter(known),
  );

  /** Every code on screen has a flag; one the client does not know has no way past it. */
  const canSaveOver = computed(() => {
    const ws = warnings();
    return ws.length > 0 && ws.every((w) => known(w.check));
  });

  // WriteLock focused the warning before the form stopped handing it over;
  // the notice takes that over, when it goes from hidden to shown.
  let noticeShown = false;
  afterRenderEffect(() => {
    const on = warnings().length > 0;
    if (on && !noticeShown) notice()?.nativeElement.focus();
    noticeShown = on;
  });

  return {
    warnings,
    shown,
    canSaveOver,
    /**
     * What WriteLock sees. A warning is shown once, in the override notice, so
     * WriteLock is not handed it to print again as a red line of its own.
     */
    lock: {
      locked: () => state.locked(),
      uncertain: () => state.uncertain(),
      error: () => (warnings().length > 0 ? null : state.error()),
    },
    /** Every flag, true for the codes in `allow` and false for the rest. */
    flags: (allow: readonly C[]): Record<string, boolean> =>
      Object.fromEntries(codes.map((c) => [overrides[c], allow.includes(c)])),
  };
}
