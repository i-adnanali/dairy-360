import { effect, inject, signal } from '@angular/core';
import type { Page } from '@dairy/shared';
import { RegistryApi } from './api';
import { urlParams } from './url-state';
/** One request identity prevents stale page responses replacing newer navigation. */
export function pagedList<T>(kind: string, sort = 'identifier') {
  const api = inject(RegistryApi),
    url = urlParams({
      page: '1',
      pageSize: '25',
      search: '',
      sort,
      direction: sort === 'date' ? 'desc' : 'asc',
    });
  const result = signal<Page<T> | null>(null),
    error = signal<string | null>(null),
    loading = signal(false),
    revision = signal(0);
  let request = 0;
  effect(() => {
    const query = url.value();
    revision();
    const id = ++request;
    loading.set(true);
    error.set(null);
    void api
      .list<T>(kind, query)
      .then((r) => {
        if (id !== request) return;
        result.set(r);
        if (r.page !== Number(query.page)) url.set({ page: '' + r.page });
      })
      .catch((e) => {
        if (id === request) error.set(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (id === request) loading.set(false);
      });
  });
  return { url, result, error, loading, refresh: () => revision.update((n) => n + 1) };
}
