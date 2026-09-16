import { LocalPagination } from '../ui/local-pagination';
import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RegistryApi } from './api';
import { healthWords } from './health-model';
import { Button } from '../ui/button';
import { TextInput } from '../ui/input';
import { Card, ErrorPanel } from '../ui/surface';
import { PageHeading } from '../ui/heading';
import { HelpText } from '../ui/text';
@Component({
  selector: 'app-life-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LocalPagination,RouterLink, FormsModule, Button, TextInput, Card, ErrorPanel, PageHeading, HelpText],
  styles: [
    `
      :host {
        display: block;
      }
      td,
      th {
        text-align: left;
        padding: 0.5rem;
        vertical-align: top;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      tr {
        border-bottom: 1px solid var(--border);
      }
      .detail {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .print-identity {
        display: none;
      }
      @media print {
        .no-print {
          display: none !important;
        }
        .print-identity {
          display: table-header-group;
        }
        section {
          break-inside: auto;
        }
        article {
          break-inside: avoid;
        }
        h3 {
          break-after: avoid;
        }
        details {
          display: block;
        }
        :host {
          font-size: 10pt;
        }
        a {
          color: inherit;
        }
      }
    `,
  ],
  template: `<div class="space-y-5">
    <header>
      <h2 appPageHeading>Animal lifetime report</h2>
      <p appHelp>Recorded history with evidence, uncertainty and coverage gaps.</p>
    </header>
    @if (error()) {
      <p appErrorPanel role="alert">{{ error() }}</p>
      <button appButton (click)="load()">Retry</button>
    }
    <form class="no-print flex flex-wrap gap-3 items-end" (ngSubmit)="load()">
      <label>From<input appInput type="date" name="from" [(ngModel)]="from" /></label
      ><label>Through<input appInput type="date" name="to" [(ngModel)]="to" /></label
      ><label><input type="checkbox" name="audit" [(ngModel)]="audit" /> Include corrections</label
      ><button appButton variant="secondary">Apply</button>
    </form>
    @if (report(); as r) {
      <div class="no-print flex flex-wrap gap-2">
        <a appButton variant="secondary" [routerLink]="['/animals', r.animal_id]">Animal profile</a
        ><a appButton variant="secondary" routerLink="/animals/health">Manage health</a
        ><button appButton (click)="print()">Print / Save as PDF</button
        ><button appButton variant="secondary" (click)="download()">Export complete JSON</button>
      </div>
      <table>
        <thead class="print-identity">
          <tr>
            <th>
              {{ r.animal_id }} · {{ r.current_snapshot.animal.name }} · Generated
              {{ r.generated_at }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <section appCard>
                <h3 class="font-medium">
                  {{ r.animal_id }} · {{ r.current_snapshot.animal.name || 'Unnamed' }}
                </h3>
                <p>
                  Tag: {{ r.current_snapshot.animal.tag_no || 'Not recorded' }} ·
                  {{ r.current_snapshot.animal.sex }} · {{ r.current_snapshot.animal.species }}
                </p>
                <p>
                  Status: {{ r.current_snapshot.status?.status || 'Unknown' }} · Origin:
                  {{ words(r.current_snapshot.animal.origin) }}
                </p>
                <p appHelp>
                  Generated {{ r.generated_at }}. Coverage:
                  {{ from || 'all recorded life' }} through {{ to || 'latest record' }}.
                </p>
              </section>
              <section appCard class="space-y-3">
                <h3 class="font-medium">Vaccination card · all recorded history</h3>
                <p appHelp>
                  Only administered vaccines appear below. Absence is not evidence of no prior
                  vaccination.
                </p>
                @for (v of r.health.vaccinations; track v.id) {
                  <article class="border-t border-stroke py-3">
                    <p>{{ v.product_name }} · {{ date(v.occurred_on, v.date_precision) }}</p>
                    <p>
                      {{ v.amount ?? 'Unknown amount' }} {{ v.unit }} ·
                      {{ v.route || 'Route unknown' }} · Batch {{ v.batch || 'unknown' }}
                    </p>
                    <p>
                      Administered by {{ v.administrator || 'unknown' }} · Recorded by
                      {{ v.recorded_by }} · Source {{ v.source_ref || v.source_form }}
                    </p>
                    <p appHelp>Record {{ v.id }}</p>
                  </article>
                } @empty {
                  <p>No vaccinations recorded.</p>
                }
                <h4 class="font-medium">Outstanding instructions</h4>
                @for (t of r.health.records; track t.id) {
                  @if (t.entity === 'tasks' && t.status === 'pending') {
                    <p>{{ t.instructions }} · due {{ t.due_on }}</p>
                  }
                }
                <h4 class="font-medium">Withdrawal instructions requiring attention</h4>
                @for (w of r.health.withdrawals; track $index) {
                  <p>
                    {{ w.target }} · {{ w.product_name }} ·
                    {{ w.instruction || 'Instruction unknown' }} ·
                    {{ w.until || 'End needs clarification' }}
                  </p>
                } @empty {
                  <p>No active or unresolved instructions recorded.</p>
                }
              </section>
              <section appCard>
                <h3 class="font-medium">Recorded production totals</h3>
                <p>
                  {{ number(r.totals.measured_litres) }} measured litres ·
                  {{ r.totals.measured_sessions }} measured sessions ·
                  {{ r.totals.unmeasured_sessions }} milked but unmeasured ·
                  {{ r.totals.not_milked_sessions }} not milked
                </p>
                <p appHelp>Absent sessions are not zero; these totals describe entered records.</p>
              </section>
              @for (key of sectionKeys(); track key) {
                <section appCard class="space-y-3">
                  <h3 class="font-medium">{{ words(key) }} · {{ words(r.sections[key].state) }}</h3>
                  <p appHelp>{{ r.sections[key].note }}</p>
                  <app-local-pagination #sectionPages="localPagination" class="no-print" [hidden]="printing()" [total]="r.sections[key].records.length"/>
                  @for (record of printing() ? r.sections[key].records : sectionPages.rows(r.sections[key].records); track $index) {
                    <article class="border-t border-stroke pt-3">
                      @for (line of summaryLines(record); track $index) {
                        <p class="detail">{{ line }}</p>
                      }
                      <details [open]="printing()">
                        <summary>Source and linked records</summary>
                        @for (line of sourceLines(record); track $index) {
                          <p appHelp class="detail">{{ line }}</p>
                        }
                      </details>
                      @for (id of record.attachment_ids || []; track id) {
                        <a [href]="'/api/registry/health/attachments/' + id">Attached document</a>
                      }
                    </article>
                  }
                  @if (!r.sections[key].records.length) {
                    <p appHelp>No records available in this section.</p>
                  }

                </section>
              }
              <section appCard>
                <h3 class="font-medium">Coverage notes</h3>
                @for (w of r.coverage_warnings; track w) {
                  <p>{{ w }}</p>
                }
              </section>
              @if (r.corrections) {
                <section appCard>
                  <h3 class="font-medium">Corrections appendix</h3>
                  @for (line of lines(r.corrections); track $index) {
                    <p class="detail">{{ line }}</p>
                  }
                </section>
              }
            </td>
          </tr>
        </tbody>
      </table>
    }
  </div>`,
})
export class LifeReport {
  private api = inject(RegistryApi);
  private route = inject(ActivatedRoute);
  protected report = signal<any>(null);
  protected error = signal('');
  protected printing = signal(false);
  protected from = '';
  protected to = '';
  protected audit = false;
  protected limit = 10;
  protected words = healthWords;
  constructor() {
    void this.load();
  }
  protected async load() {
    try {
      this.error.set('');
      const id = this.route.snapshot.paramMap.get('id');
      const q = new URLSearchParams();
      if (this.from) q.set('from', this.from);
      if (this.to) q.set('to', this.to);
      if (this.audit) q.set('corrections', 'true');
      this.report.set(await this.api.healthGet('animals/' + id + '/life-report?' + q));
    } catch (e) {
      this.error.set(String(e));
    }
  }
  protected sectionKeys() {
    return Object.keys(this.report()?.sections ?? {});
  }
  protected visibleRows(key: string) {
    const rows = this.report().sections[key].records;
    return this.printing() ? rows : rows.slice(0, this.limit);
  }
  protected number(value: number) {
    return new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(value);
  }
  protected date(on: string, precision = 'day') {
    return precision === 'month'
      ? on.slice(0, 7) + ' (month known)'
      : precision === 'year'
        ? on.slice(0, 4) + ' (year known)'
        : precision === 'estimated'
          ? 'Approximately ' + on.slice(0, 4)
          : on;
  }
  private isSource(key: string) {
    return (
      key === 'id' ||
      key.endsWith('_id') ||
      key.endsWith('_ids') ||
      [
        'recorded_by',
        'recorded_at',
        'observed_by',
        'source_form',
        'source_ref',
        'revision',
      ].includes(key)
    );
  }
  protected sourceLines(record: any) {
    return this.lines(Object.fromEntries(Object.entries(record).filter(([k]) => this.isSource(k))));
  }
  protected summaryLines(record: any): string[] {
    const result: string[] = [];
    if (record.entity === 'costs' && record.amount_minor === null)
      result.push('Recorded cost: unknown');
    for (const [key, v] of Object.entries(record)) {
      if (
        v === null ||
        v === undefined ||
        v === '' ||
        this.isSource(key) ||
        [
          'voided',
          'effective',
          'date_precision',
          'recipients_confirmed',
          'correction_reason',
        ].includes(key)
      )
        continue;
      if (key === 'occurred_on') {
        result.push('Date: ' + this.date(String(v), record.date_precision));
        continue;
      }
      if (key === 'payload') {
        result.push(...this.summaryLines(v));
        continue;
      }
      if (key === 'amount_minor') {
        result.push(
          'Recorded cost: ' +
            record.currency +
            ' ' +
            this.number(
              Number(v) /
                10 **
                  (new Intl.NumberFormat('en', {
                    style: 'currency',
                    currency: record.currency,
                  }).resolvedOptions().maximumFractionDigits ?? 2),
            ),
        );
        continue;
      }
      if (typeof v === 'boolean') {
        if (v) result.push(healthWords(key));
        continue;
      }
      if (typeof v === 'object') {
        result.push(...this.lines(v, healthWords(key)));
        continue;
      }
      result.push(
        healthWords(key) + ': ' + (typeof v === 'number' ? this.number(v) : healthWords(String(v))),
      );
    }
    return result;
  }
  protected lines(value: any, prefix = ''): string[] {
    if (value === null || value === undefined) return [];
    if (typeof value !== 'object') return [`${prefix}: ${value}`];
    return Object.entries(value)
      .filter(([key]) => !['attachment_ids'].includes(key))
      .flatMap(([key, v]) =>
        this.lines(v, prefix ? prefix + ' / ' + healthWords(key) : healthWords(key)),
      );
  }
  protected print() {
    this.printing.set(true);
    setTimeout(() => {
      window.print();
      this.printing.set(false);
    }, 100);
  }
  protected download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(this.report(), null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = this.report().animal_id + '-life-report.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
