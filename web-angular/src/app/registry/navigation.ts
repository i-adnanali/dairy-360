import { farmToday } from './today';
import { Injectable, signal } from '@angular/core';

export interface NavigationItem {
  label: string;
  path: string;
  fragment?: string;
  primary?: boolean;
}
export interface Section {
  label: string;
  path: string;
  views: NavigationItem[];
  actions: NavigationItem[];
}
export const SECTIONS: Section[] = [
  { label: 'Today', path: '/', views: [], actions: [] },
  { label: 'Analytics', path: '/analytics', views: [], actions: [] },
  {
    label: 'Herd',
    path: '/animals',
    views: [
      { label: 'Animals', path: '/animals' },
      { label: 'Calvings', path: '/animals/calvings' },
      { label: 'Health', path: '/animals/health' },
    ],
    actions: [
      { label: 'Record calving', path: '/animals/calvings/new' },
      { label: 'Add animal', path: '/animals/new', primary: true },
    ],
  },
  {
    label: 'Milk',
    path: '/milk/milking',
    views: [
      { label: 'Milking', path: '/milk/milking' },
      { label: 'Dispatch', path: '/milk/dispatch' },
      { label: 'Buyers', path: '/milk/buyers' },
    ],
    actions: [],
  },
  {
    label: 'Feed',
    path: '/feed',
    views: [
      { label: 'Overview', path: '/feed' },
      { label: 'Days', path: '/feed/daily' },
      { label: 'Crops', path: '/feed/crops' },
      { label: 'Purchases', path: '/feed/purchases' },
      { label: 'Catalogue', path: '/feed/items' },
    ],
    actions: [
      { label: 'Record feeding', path: '/feed/daily/' + farmToday(), primary: true },
      { label: 'Add crop', path: '/feed/crops/new' },
      { label: 'Record purchase', path: '/feed/purchases/new' },
    ],
  },
  {
    label: 'Labour',
    path: '/labour/people',
    views: [
      { label: 'People', path: '/labour/people' },
      { label: 'Payroll', path: '/labour/payroll' },
    ],
    actions: [
      { label: 'Add person', path: '/labour/people', fragment: 'add-person', primary: true },
    ],
  },
  { label: 'Monitor', path: '/monitor', views: [], actions: [] },
  { label: 'Check', path: '/check', views: [], actions: [] },
];
/**
 * A route that belongs to no nav section (the full-page Assistant). It used to
 * fall through to SECTIONS[0], which underlined Today while you were on /chat
 * (audit F18). It is not in SECTIONS, so no nav link is ever marked current.
 */
export const ASSISTANT_SECTION: Section = { label: 'Assistant', path: '/chat', views: [], actions: [] };

export function sectionFor(url: string): Section {
  const path = url.split(/[?#]/)[0];
  if (path === '/chat' || path.startsWith('/chat/')) return ASSISTANT_SECTION;
  return (
    SECTIONS.find(
      (s) => s.path !== '/' && path.startsWith(s.path.split('/').slice(0, 2).join('/')),
    ) ?? SECTIONS[0]
  );
}
/**
 * Which of a section's views the address is inside: the LONGEST view path that
 * is the address or a parent of it. The sub-nav used exact matching, so a
 * crop, a purchase or one day's feeding page marked no view at all and you
 * lost your place one click in. `/feed` only matches itself, otherwise it
 * would claim every Feed page.
 */
export function activeViewPath(section: Section, url: string): string | null {
  const path = url.split(/[?#]/)[0];
  let best: string | null = null;
  for (const v of section.views) {
    const hit = v.path === section.path ? path === v.path : path === v.path || path.startsWith(v.path + '/');
    if (hit && (best === null || v.path.length > best.length)) best = v.path;
  }
  // An address under the section with no view of its own (an animal's page)
  // belongs to the section's first view.
  if (best === null && section.views.some((v) => v.path === section.path) && path.startsWith(section.path + '/'))
    best = section.path;
  return best;
}

@Injectable({ providedIn: 'root' })
export class ShellActions {
  readonly inShell = signal(false);
  readonly recheck = signal(0);
  refresh(): void {
    this.recheck.update((n) => n + 1);
  }
}
