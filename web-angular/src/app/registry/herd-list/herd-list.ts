import { Segmented } from "../../ui/selection";
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
import { NO_RECORD, readableParts } from "../precision-display";
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
  imports: [Segmented, ScrollRegion,TextInput,Pagination,
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
    return readableParts(r.birth_on, r.birth_precision);
  }

  /** "Born here" / "Bought in" instead of born_on_farm / acquired. */
  protected origin(r: HerdRow): string {
    return r.origin === 'born_on_farm' ? 'Born here' : r.origin === 'acquired' ? 'Bought in' : String(r.origin);
  }

  protected readonly groups = [
    { value: 'current', label: 'On the farm' },
    { value: 'departed', label: 'Departed' },
    { value: 'all', label: 'All' },
  ];
  /** The farm's words, mapped to the stored status the server filters on. */
  protected readonly stages = [
    { value: '', label: 'Every stage' },
    { value: 'lactating', label: 'majj · in milk' },
    { value: 'dry', label: 'majj · dry' },
    { value: 'heifer', label: 'choti' },
    { value: 'calf', label: 'katti / katta (calves)' },
    { value: 'male', label: 'sandda' },
  ];

  /** One URL filter value by name -- `group` and `status` are page-specific. */
  protected q(key: string): string {
    return (this.paging.url.value() as Record<string, string>)[key] ?? '';
  }
  protected setFilter(patch: Record<string, string>) {
    this.paging.url.set({ ...patch, page: '1' } as never);
  }
  protected sortBy(column: string) {
    const q = this.paging.url.value() as Record<string, string>;
    const direction = q['sort'] === column ? (q['direction'] === 'asc' ? 'desc' : 'asc') : column === 'identifier' ? 'asc' : 'desc';
    this.setFilter({ sort: column, direction });
  }
  protected ariaSort(column: string): 'ascending' | 'descending' | null {
    const q = this.paging.url.value() as Record<string, string>;
    return q['sort'] === column ? (q['direction'] === 'asc' ? 'ascending' : 'descending') : null;
  }

  // The herd you have, by default: departed animals are a filter away, not
  // mixed into the working list.
  protected readonly paging = pagedList<HerdRow>('animals', 'identifier', { group: 'current', status: '' });
  protected readonly rows = computed(() => this.paging.result()?.items ?? null);
  protected readonly loadError = this.paging.error;
}
