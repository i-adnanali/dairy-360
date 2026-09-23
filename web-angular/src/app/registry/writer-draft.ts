import { DestroyRef, effect, inject, untracked, WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { DraftRegistry } from './draft-registry';
import { FormState } from './form-state';

let nextOwner = 0;
/** Explicit editable fields only: pagination, read responses and revision metadata are excluded. */
export function writerDraft(options: {
  name: string;
  description?: () => string;
  fields?: Record<string, WritableSignal<any>>;
  snapshot?: () => unknown;
  restore?: (value: any) => void;
  states: FormState<any>[];
  afterRestore?: () => void;
  replaces?: (url: string) => boolean;
}) {
  const registry = inject(DraftRegistry),
    router = inject(Router);
  const owner = options.name + '-' + ++nextOwner;
  const path = () => router.url.split('?')[0];
  const snapshot =
    options.snapshot ??
    (() => Object.fromEntries(Object.entries(options.fields ?? {}).map(([k, v]) => [k, v()])));
  const restore =
    options.restore ??
    ((value: any) =>
      Object.entries(options.fields ?? {}).forEach(([k, v]) => v.set(structuredClone(value[k]))));
  let baseline = JSON.stringify(snapshot());
  const accept = (value = snapshot()) => {
    baseline = JSON.stringify(value);
    registry.syncUnload();
  };
  const dirty = () => JSON.stringify(snapshot()) !== baseline;
  registry.register(
    {
      owner,
      context: path,
      description: options.description ?? (() => options.name + ' · ' + path()),
      snapshot: () => JSON.stringify(snapshot()),
      baseline: () => baseline,
      dirty,
      pending: () => options.states.some((s) => s.locked()),
      unresolved: () => options.states.some((s) => s.uncertain()),
      discard: () => {
        restore(JSON.parse(baseline));
        options.afterRestore?.();
        options.states.forEach((s) => s.reset());
      },
      replaces: options.replaces ?? ((url) => new URL(url, 'http://local').pathname !== path()),
    },
    inject(DestroyRef),
  );
  effect(() => {
    snapshot();
    options.states.forEach((s) => {
      s.result();
      s.locked();
    });
    untracked(() => registry.syncUnload());
  });
  return {
    accept,
    dirty,
    meaningful: () => semantic(snapshot()) !== semantic(JSON.parse(baseline)),
    check: () => registry.syncUnload(),
    async transition(action: () => void) {
      if (
        !registry.hasChanges((p) => p.owner === owner) ||
        (await registry.request((p) => p.owner === owner))
      ) {
        action();
        accept();
        return true;
      }
      return false;
    },
  };
}

export function replacesContext(
  path: string,
  current: () => Record<string, string>,
  defaults: Record<string, string>,
) {
  return (url: string) => {
    const next = new URL(url, 'http://local');
    return (
      next.pathname !== path ||
      Object.entries(current()).some(([k, v]) => (next.searchParams.get(k) || defaults[k]) !== v)
    );
  };
}

/** Optional text normalization and immutable attribution never create an empty correction. */
function semantic(value: any): string {
  const normalize = (v: any): any => {
    if (typeof v === 'string') return v.trim() || null;
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .filter(
            ([key]) =>
              !['recorded_at', 'recorded_by', 'source_form', 'revision', 'updated_at'].includes(
                key,
              ),
          )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, normalize(value)]),
      );
    return v;
  };
  return JSON.stringify(normalize(value));
}
