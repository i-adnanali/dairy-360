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
  {
    label: 'Herd',
    path: '/animals',
    views: [
      { label: 'Animals', path: '/animals' },
      { label: 'Calvings', path: '/animals/calvings' },
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
  { label: 'Check', path: '/check', views: [], actions: [] },
];
export function sectionFor(url: string): Section {
  const path = url.split(/[?#]/)[0];
  return (
    SECTIONS.find(
      (s) => s.path !== '/' && path.startsWith(s.path.split('/').slice(0, 2).join('/')),
    ) ?? SECTIONS[0]
  );
}
@Injectable({ providedIn: 'root' })
export class ShellActions {
  readonly inShell = signal(false);
  readonly recheck = signal(0);
  refresh(): void {
    this.recheck.update((n) => n + 1);
  }
}
