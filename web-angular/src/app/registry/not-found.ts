import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from '../ui/button';
import { PageHeading } from '../ui/heading';
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [RouterLink, Button, PageHeading],
  template: `
    <section data-page-layout="entry" class="space-y-4">
      <h2 appPageHeading>Page not found</h2>
      <p>This address does not match a Dairy 360 page. Use the menu or return to Today to find the record.</p>
      <div class="flex flex-wrap gap-2">
        <a appButton routerLink="/">Go to Today</a>
        <a appButton variant="secondary" routerLink="/animals">Find an animal</a>
      </div>
    </section>
  `,
})
export class NotFound {}
