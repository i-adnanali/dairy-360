// Every tab and history entry was titled "Dairy 360", so five open tabs looked
// the same. Each route now names itself ("Animal health · Dairy 360"), and a
// detail page names its subject once it has loaded ("BD-0001 Noori · Dairy 360").

import { Injectable, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';

export const APP_NAME = 'Dairy 360';

export function fullTitle(page: string | null | undefined): string {
  return page ? `${page} · ${APP_NAME}` : APP_NAME;
}

@Injectable({ providedIn: 'root' })
export class FarmTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.title.setTitle(fullTitle(this.buildTitle(snapshot)));
  }
}

/** A detail page names its subject once loaded. Call in an injection context. */
export function subjectTitle(subject: () => string | null | undefined): void {
  const title = inject(Title);
  effect(() => {
    const s = subject();
    if (s) title.setTitle(fullTitle(s));
  });
}
