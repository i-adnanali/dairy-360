import { ScrollRegion } from "../../ui/scroll-region";
import { TextInput } from "../../ui/input";
import { pagedList } from "../paged-list";
import { Pagination } from "../../ui/pagination/pagination";
import { ShellActions } from "../navigation";
import { IdentifierLink, RowLink } from "../../ui/navigation";
// The herd table. Exists to CHECK YOUR OWN WORK, not to be a dashboard.
//
// Deliberately a plain list before it is anything else -- the forms are what
// tests the schema, and this is what tells you whether what you entered is what
// you meant. Every date carries its precision.
//
// Empty and one-row states are BUILT, not discovered: the first hour of real
// entry is spent looking at exactly those two.

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RegistryApi } from "../api";
import { Cell } from "../../ui/cell";
import { Certainty, Qualifier } from "../../ui/certainty";
import { NO_RECORD, precisionParts } from "../precision-display";
import type { PrecisionParts } from "../precision-display";
import { lifeStageLabel } from "../life-stage";
import type { HerdRow } from "../types";
import { ErrorPanel } from "../../ui/surface";
import { HelpText } from "../../ui/text";
import { PageHeading } from "../../ui/heading";
import { Button } from "../../ui/button";
import { StatusBadge } from "../../ui/surface";

@Component({
  selector: 'app-herd-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollRegion,TextInput,Pagination,
    IdentifierLink,
    RowLink,
    Button,
    Cell,
    Certainty,
    ErrorPanel,
    HelpText,
    PageHeading,
    Qualifier,
    RouterLink,
    StatusBadge,
  ],
  templateUrl: './herd-list.html',
  styleUrl: './herd-list.css',
})
export class HerdList {
  protected readonly shell = inject(ShellActions);
  /** §6's no-record glyph, for the template. An en dash. */
  protected readonly noRecord = NO_RECORD;

  /** The farm's word for this animal's stage. Stored enum unchanged. */
  protected stage(r: HerdRow): string {
    return lifeStageLabel(r.status, r.sex);
  }

  /** The birth date at the precision it was known to. See precision-display.ts. */
  protected born(r: HerdRow): PrecisionParts {
    return precisionParts(r.birth_on, r.birth_precision);
  }

  protected readonly paging = pagedList<HerdRow>('animals');
  protected readonly rows = computed(() => this.paging.result()?.items ?? null);
  protected readonly loadError = this.paging.error;
}
