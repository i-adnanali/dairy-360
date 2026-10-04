import { Component, inject } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Button } from "../../ui/button";
@Component({
  selector: 'app-draft-dialog',
  imports: [Button],
  templateUrl: './draft-dialog.html',
  styleUrl: './draft-dialog.css',
})
export class DraftDialog {
  readonly data = inject<{
    pending: boolean;
    unresolved: boolean;
    description: string;
    title?: string;
    cancelLabel?: string;
    confirmLabel?: string;
  }>(DIALOG_DATA);
  readonly ref = inject(DialogRef<boolean>);
}
