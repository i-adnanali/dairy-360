import { lifeSections, lifeSummary, provenanceLines, reportDate } from './life-report-model';
import { LocalPagination } from '../ui/local-pagination';
import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  HostListener,
  ChangeDetectorRef,
} from '@angular/core';
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
  imports: [
    LocalPagination,
    RouterLink,
    FormsModule,
    Button,
    TextInput,
    Card,
    ErrorPanel,
    PageHeading,
    HelpText,
  ],
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
        border-bottom: 1px solid rgb(var(--border-default));
      }
      .report-frame {
        table-layout: fixed;
      }
      h3 {
        scroll-margin-top: 5rem;
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
        pre {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        thead {
          display: table-header-group;
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
  template: `
    <div data-page-layout="report" class="space-y-5">
      <header>
        <h2 appPageHeading>Animal lifetime report</h2>
        <p appHelp>Recorded history with evidence, uncertainty and coverage gaps.</p>
      </header>
      @if (loading()) {
        <p role="status">Loading report…</p>
      }
      @if (error()) {
        <p appErrorPanel role="alert">{{ error() }}</p>
        <button appButton (click)="load()">Retry</button>
      }
      <form class="no-print flex flex-wrap gap-3 items-end" (ngSubmit)="load()">
        <label>From<input appInput type="date" name="from" [(ngModel)]="from" /></label
        ><label>Through<input appInput type="date" name="to" [(ngModel)]="to" /></label
        ><label
          ><input type="checkbox" name="audit" [(ngModel)]="audit" /> Include corrections</label
        ><button appButton variant="secondary">Apply</button>
      </form>
      @if (!loading() && !error() && report(); as r) {
        <div class="no-print flex flex-wrap gap-2">
          <a appButton variant="secondary" [routerLink]="['/animals', r.animal_id]"
            >Animal profile</a
          ><a appButton variant="secondary" routerLink="/animals/health">Manage health</a
          ><button appButton (click)="print()">Print / Save as PDF</button
          ><button appButton variant="secondary" (click)="download()">Export complete JSON</button>
        </div>
        <nav class="no-print flex flex-wrap gap-3" aria-label="Report contents">
          @for (section of sections(); track section.id) {
            <a class="underline" [href]="'#report-' + section.id" (click)="goTo($event, section.id)"
              >{{ section.title }} ({{ section.records.length }})</a
            >
          }
          <a class="underline" href="#report-audit" (click)="goTo($event, 'audit')"
            >Technical audit · complete response</a
          >
        </nav>
        <table class="report-frame" role="presentation">
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
                  <h3 id="report-identity" tabindex="-1" class="font-medium">
                    Identity and provenance · {{ r.animal_id }} ·
                    {{ r.current_snapshot.animal.name || 'Unnamed' }}
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
                    {{ r.filters?.from || 'all recorded life' }} through
                    {{ r.filters?.to || 'latest record' }}. Corrections
                    {{ r.filters?.corrections ? 'included' : 'excluded' }}. Vaccination card and
                    current identity cover all recorded history.
                  </p>
                </section>
                <section appCard class="space-y-3">
                  <h3 class="font-medium">Vaccination card · all recorded history</h3>
                  <p appHelp>
                    Only administered vaccines appear below. Absence is not evidence of no prior
                    vaccination.
                  </p>
                  @for (v of r.health.vaccinations; track v.id) {
                    <article class="border-t border-line py-3">
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
                      <p>{{ t.instructions }} · due {{ date(t.due_on) }}</p>
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
                  <p appHelp>
                    Absent sessions are not zero; these totals describe entered records.
                  </p>
                </section>
                @for (section of sections(); track section.id) {
                  <section appCard class="space-y-3">
                    <h3
                      class="font-medium"
                      [id]="section.id === 'identity' ? 'report-parentage' : 'report-' + section.id"
                      tabindex="-1"
                    >
                      {{ section.title }} · {{ section.records.length }} records
                    </h3>
                    <p appHelp>{{ section.note }}</p>
                    <app-local-pagination
                      [label]="section.title"
                      #sectionPages="localPagination"
                      class="no-print"
                      [hidden]="printing()"
                      [total]="section.records.length"
                    />
                    @for (
                      record of printing() ? section.records : sectionPages.rows(section.records);
                      track $index
                    ) {
                      <article class="border-t border-line pt-3">
                        @for (line of summary(record, section.domain); track $index) {
                          <p class="detail">{{ line }}</p>
                        }
                        <details [open]="printing()">
                          <summary>Source and linked records</summary>
                          @for (line of sources(record); track $index) {
                            <p appHelp class="detail">{{ line }}</p>
                          }
                        </details>
                        @for (id of record['attachment_ids'] || []; track id) {
                          <a [href]="'/api/registry/health/attachments/' + id">Attached document</a>
                        }
                      </article>
                    }
                    @if (!section.records.length) {
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
                <section appCard>
                  <h3 id="report-audit" tabindex="-1" class="font-medium">
                    Technical audit · complete response
                  </h3>
                  <p appHelp>
                    Original fields, unsupported domains, unknown record types and requested
                    corrections are retained below and in the JSON export. Main sections preserve
                    API record order.
                  </p>
                  <details [open]="printing()">
                    <summary>
                      Complete original report, including source records and corrections
                    </summary>
                    <pre class="detail text-xs">{{ json(r) }}</pre>
                  </details>
                </section>
              </td>
            </tr>
          </tbody>
        </table>
      }
    </div>
  `,
})
export class LifeReport {
  private readonly cdr = inject(ChangeDetectorRef);
  protected readonly sections = () => (this.report() ? lifeSections(this.report()) : []);
  protected readonly summary = lifeSummary;
  protected readonly sources = provenanceLines;
  protected readonly date = reportDate;
  protected readonly json = (value: unknown) => JSON.stringify(value, null, 2);
  protected readonly loading = signal(false);
  private request = 0;
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
    const request = ++this.request;
    this.loading.set(true);
    try {
      this.error.set('');
      const id = this.route.snapshot.paramMap.get('id');
      const q = new URLSearchParams();
      if (this.from) q.set('from', this.from);
      if (this.to) q.set('to', this.to);
      if (this.audit) q.set('corrections', 'true');
      // This endpoint returns a complete transaction snapshot, not a paged API.
      const report = await this.api.healthGet('animals/' + id + '/life-report?' + q);
      if (request !== this.request) return;
      this.report.set(report);
    } catch (e) {
      if (request === this.request) this.error.set(String(e));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
  protected goTo(event: Event, id: string) {
    event.preventDefault();
    const heading = document.getElementById('report-' + id);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  }
  protected number(value: number) {
    return new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(value);
  }
  @HostListener('window:beforeprint')
  beforePrint() {
    this.printing.set(true);
    this.cdr.detectChanges();
  }
  @HostListener('window:afterprint')
  afterPrint() {
    this.printing.set(false);
    this.cdr.detectChanges();
  }
  protected print() {
    if (this.loading() || this.error() || !this.report()) return;
    this.beforePrint();
    window.print();
    this.afterPrint();
  }
  protected download() {
    if (this.loading() || this.error() || !this.report()) return;
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
