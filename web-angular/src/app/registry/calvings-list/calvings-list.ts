import { ScrollRegion } from "../../ui/scroll-region";
import { TextInput } from "../../ui/input";
import { Button } from "../../ui/button";
import { computed } from '@angular/core';
import { pagedList } from "../paged-list";
import { Pagination } from "../../ui/pagination/pagination";
// A herd-wide read over the existing per-animal timeline contract. Precision
// and correction status travel with the dates; failed reads never look empty.
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RegistryApi } from "../api";
import { HerdRow, TimelineEvent } from "../types";
import { precisionParts } from "../precision-display";
import { Certainty, Qualifier } from "../../ui/certainty";
import { Cell } from "../../ui/cell";
import { ErrorPanel, StatusBadge } from "../../ui/surface";
import { PageHeading } from "../../ui/heading";
import { IdentifierLink, RowLink } from "../../ui/navigation";

@Component({
  selector: 'app-calvings-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollRegion,TextInput,Button,Pagination,
    RouterLink,
    Certainty,
    Qualifier,
    Cell,
    ErrorPanel,
    StatusBadge,
    PageHeading,
    IdentifierLink,
    RowLink,
  ],
  templateUrl: './calvings-list.html',
  styleUrl: './calvings-list.css',
})
export class CalvingsList {
  readonly paging = pagedList<{animal:HerdRow;event:TimelineEvent}>('calvings','date');
  readonly rows = computed(() => this.paging.result()?.items ?? null);
  readonly error = this.paging.error;
  readonly precision = precisionParts;
  load() { this.paging.refresh(); }
}
