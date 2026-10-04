import { Component, ElementRef, afterRenderEffect, contentChild, input } from '@angular/core';
import { TextInput } from "../input";

let nextField = 0;
/** Owns the label and descriptions; projects the existing native appInput control. */
@Component({
  selector: 'app-field',
  host: { class: 'block field-group' },
  templateUrl: './field.html',
  styleUrl: './field.css',
})
export class Field {
  readonly label = input.required<string>();
  readonly help = input('');
  readonly error = input<string | null>(null);
  readonly controlId = `field-${++nextField}`;
  readonly helpId = this.controlId + '-help';
  readonly errorId = this.controlId + '-error';
  private readonly control = contentChild(TextInput, { read: ElementRef });
  constructor() {
    afterRenderEffect(() => {
      const el = this.control()?.nativeElement as HTMLElement | undefined;
      const help = this.help(), error = this.error();
      if (!el) return;
      el.id = this.controlId;
      const description = [help ? this.helpId : '', error ? this.errorId : ''].filter(Boolean).join(' ');
      if (description) el.setAttribute('aria-describedby', description);
      else el.removeAttribute('aria-describedby');
      if (error) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    });
  }
}
