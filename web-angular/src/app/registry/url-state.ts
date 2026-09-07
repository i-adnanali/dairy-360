// Screen state that lives in the URL.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// Every dated screen held its date and session in a plain signal seeded from
// farmToday(). So /milking ALWAYS opened on today and the guessed session: you
// could not link to yesterday evening's roster, a refresh lost your place, and
// "look at this session" was unsendable.
//
// The server was ready the whole time -- `on`, `session`, `from`, `to` and
// `as_of` are all accepted query params on the read routes, and the read models
// take them as parameters rather than reading a clock. Only the client was
// missing.
//
// ---------------------------------------------------------------------------
// A BARE URL MEANS "NOW", AND DEFAULTS ARE NOT WRITTEN INTO IT
// ---------------------------------------------------------------------------
// /milk/milking with no params opens today's likely session, and STAYS bare.
// Change the date and the params appear, at which point the URL names that
// specific session and can be sent to somebody.
//
// The alternative -- stamping today's date into the URL on load -- would make
// every bookmark freeze on the day it was made, which is the opposite of what
// somebody bookmarking a daily sheet wants.
//
// ---------------------------------------------------------------------------
// replaceUrl, NOT A HISTORY ENTRY PER CLICK
// ---------------------------------------------------------------------------
// Stepping through a fortnight of dates would otherwise bury the previous
// screen under fourteen back-button presses. The date control is a filter on
// one screen, not fourteen navigations.

import { computed, inject } from '@angular/core';
import type { Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

export interface UrlParams<K extends string> {
  /** The current values: whatever the URL says, else the default. */
  value: Signal<Record<K, string>>;
  /** Write some keys back to the URL. Others are left alone. */
  set: (patch: Partial<Record<K, string>>) => void;
}

/**
 * Bind a set of query params to signals.
 *
 * MUST be called in an injection context (a field initialiser or constructor).
 *
 * `defaults` is read once, which is correct for `farmToday()` and for a
 * month boundary: both are stable for as long as a screen is open, and a
 * default that moved under a mounted component would change what the screen
 * showed without anybody touching it.
 */
export function urlParams<K extends string>(defaults: Record<K, string>): UrlParams<K> {
  const route = inject(ActivatedRoute);
  const router = inject(Router);

  const map = toSignal(route.queryParamMap, {
    initialValue: route.snapshot.queryParamMap,
  });

  const value = computed(() => {
    const m = map();
    const out = { ...defaults };
    for (const key of Object.keys(defaults) as K[]) {
      const raw = m.get(key);
      // An EMPTY param is treated as absent rather than as an empty value: a
      // hand-edited `?on=` should fall back to today, not ask the server for
      // the roster of ''.
      if (raw !== null && raw.length > 0) out[key] = raw;
    }
    return out;
  });

  const set = (patch: Partial<Record<K, string>>): void => {
    void router.navigate([], {
      relativeTo: route,
      queryParams: patch,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  };

  return { value, set };
}
