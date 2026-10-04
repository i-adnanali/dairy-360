import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from "../../ui/button";
import { PageHeading } from "../../ui/heading";
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  imports: [RouterLink, Button, PageHeading],
  templateUrl: './not-found.html',
  styleUrl: './not-found.css',
})
export class NotFound {}
