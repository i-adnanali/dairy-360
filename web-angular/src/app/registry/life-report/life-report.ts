import { reportPrintPages } from './print-pages';
import { ElementRef } from '@angular/core';
import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { lifeSections, lifeSummary, provenanceLines, reportDate } from "../life-report-model";
import { LocalPagination } from "../../ui/local-pagination/local-pagination";
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
import { RegistryApi } from "../api";
import { healthWords } from "../health-model";
import { Button } from "../../ui/button";
import { TextInput } from "../../ui/input";
import { Card, ErrorPanel } from "../../ui/surface";
import { PageHeading } from "../../ui/heading";
import { HelpText } from "../../ui/text";
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

  templateUrl: './life-report.html',
  styleUrl: './life-report.css',
})
export class LifeReport {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly element = inject(ElementRef<HTMLElement>);
  private printPages: HTMLElement | null = null;
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
    inject(DestroyRef).onDestroy(() => { ++this.request; this.printPages?.remove(); });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => {
      this.report.set(null);
      void this.load();
    });
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
    if (!this.printPages && this.report()) {
      const r = this.report();
      this.printPages = reportPrintPages(this.element.nativeElement,
        `${r.animal_id} · ${r.current_snapshot.animal.name || 'Unnamed'} · Generated ${r.generated_at}`);
    }
  }
  @HostListener('window:afterprint')
  afterPrint() {
    this.printPages?.remove();
    this.printPages = null;
    this.printing.set(false);
    this.cdr.detectChanges();
  }
  protected print() {
    if (this.loading() || this.error() || !this.report()) return;
    this.beforePrint();
    try { window.print(); } finally { this.afterPrint(); }
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
