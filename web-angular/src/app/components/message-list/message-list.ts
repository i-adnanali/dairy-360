import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { TurnItem } from "../../core/turn-item.type";
import { Message } from "../message/message";

// Port of web-react/src/components/MessageList.tsx
@Component({
  selector: 'app-message-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Message],
  templateUrl: './message-list.html',
  styleUrl: './message-list.css',
})
export class MessageList {
  readonly renderLog = input.required<TurnItem[]>();
}
