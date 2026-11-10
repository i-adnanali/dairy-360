import { Segmented } from "../../ui/selection";
import { reportPrintPages } from './print-pages';
import { ElementRef, computed } from '@angular/core';
import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  familyLine,
  lifeFacts,
  lifeRow,
  lifeSections,
  lifeSummary,
  provenanceLines,
  recordCount,
  recordedLine,
  reportDate,
  taskStanding,
  withdrawalLine,
  type LifeSection,
} from "../life-report-model";
import { LocalPagination } from "../../ui/local-pagination/local-pagination";
import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  HostListener,
  ChangeDetectorRef,
  afterNextRender,
  Injector,
} from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RegistryApi } from "../api";
import { healthWords } from "../health-model";
import { Button } from "../../ui/button";
import { TextInput } from "../../ui/input";
import { ErrorPanel } from "../../ui/surface";
import { PageHeading } from "../../ui/heading";
import { HelpText } from "../../ui/text";
import { farmMoment, farmToday } from "../today";

/** The ranges people actually ask for, before "custom". */
type RangePreset = 'all' | 'lactation' | 'year' | 'custom';

@Component({
  selector: 'app-life-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Segmented, 
    LocalPagination,
    RouterLink,
    FormsModule,
    Button,
    TextInput,
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
  private readonly injector = inject(Injector);
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private printPages: HTMLElement | null = null;
  /** Identity is shown once, as its own section; the loop renders the rest. */
  protected readonly sections = computed<LifeSection[]>(() =>
    this.report() ? lifeSections(this.report()).filter((s) => s.id !== 'identity') : [],
  );
  protected readonly parentage = computed<LifeSection | null>(() =>
    this.report() ? (lifeSections(this.report()).find((s) => s.id === 'identity') ?? null) : null,
  );
  protected readonly summary = lifeSummary;
  protected readonly row = lifeRow;
  protected readonly recorded = recordedLine;
  protected readonly count = recordCount;
  protected readonly sources = provenanceLines;
  protected readonly date = reportDate;
  protected readonly withdrawal = withdrawalLine;
  protected readonly family = familyLine;
  protected readonly json = (value: unknown) => JSON.stringify(value, null, 2);
  protected readonly loading = signal(false);
  private request = 0;
  private api = inject(RegistryApi);
  private route = inject(ActivatedRoute);
  protected report = signal<any>(null);
  protected error = signal('');
  protected printing = signal(false);
  protected readonly today = farmToday();

  // The range and the corrections switch live in the URL, so a filtered report
  // survives a reload and can be sent to someone.
  protected from = '';
  protected to = '';
  protected audit = false;
  protected readonly preset = signal<RangePreset>('all');
  protected words = healthWords;

  /** The section whose heading is nearest the top, for the contents. */
  protected readonly current = signal<string>('');
  private observer: IntersectionObserver | null = null;

  constructor() {
    const q = this.route.snapshot?.queryParamMap;
    this.from = q?.get('from') ?? '';
    this.to = q?.get('to') ?? '';
    this.audit = q?.get('corrections') === 'true';
    const p = q?.get('range') as RangePreset | null;
    this.preset.set(p && ['all', 'lactation', 'year', 'custom'].includes(p) ? p : this.from || this.to ? 'custom' : 'all');
    inject(DestroyRef).onDestroy(() => {
      ++this.request;
      this.printPages?.remove();
      this.observer?.disconnect();
    });
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
      this.writeUrl(id);
      afterNextRender(() => this.watchSections(), { injector: this.injector });
    } catch (e) {
      if (request === this.request) this.error.set(String(e));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  private writeUrl(id: string | null) {
    if (!id || typeof window === 'undefined' || !window.location.pathname.endsWith('/report')) return;
    const queryParams: Record<string, string> = {};
    if (this.preset() !== 'all') queryParams['range'] = this.preset();
    if (this.from) queryParams['from'] = this.from;
    if (this.to) queryParams['to'] = this.to;
    if (this.audit) queryParams['corrections'] = 'true';
    this.location.replaceState(this.router.createUrlTree(['/animals', id, 'report'], { queryParams }).toString());
  }

  /** The open lactation's start, when it is known to the day. */
  protected readonly lactationStart = computed<string | null>(() => {
    const r = this.report();
    const id = r?.current_snapshot?.status?.open_lactation_id;
    const l = (r?.sections?.lactations?.records ?? []).find((x: any) => x.id === id);
    return l?.started_on ?? null;
  });

  protected choose(p: RangePreset) {
    if (p === this.preset() && p !== 'custom') return;
    this.preset.set(p);
    if (p === 'custom') return; // the two date fields appear; Apply loads.
    if (p === 'all') { this.from = ''; this.to = ''; }
    if (p === 'lactation') { this.from = this.lactationStart() ?? ''; this.to = ''; }
    if (p === 'year') {
      const d = new Date(this.today + 'T12:00:00Z');
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      this.from = d.toISOString().slice(0, 10);
      this.to = '';
    }
    void this.load();
  }
  protected toggleCorrections(on: boolean) {
    this.audit = on;
    void this.load();
  }
  protected readonly rangeText = () => {
    if (!this.from && !this.to) return 'All recorded life';
    const f = this.from ? reportDate(this.from) : 'the first record';
    const t = this.to ? reportDate(this.to) : 'today';
    return `${f} to ${t}`;
  };

  protected readonly facts = computed(() => (this.report() ? lifeFacts(this.report(), this.today) : []));
  protected readonly pendingTasks = computed(() =>
    (this.report()?.health?.records ?? [])
      .filter((t: any) => t.entity === 'tasks' && t.status === 'pending')
      .sort((a: any, b: any) => String(a.due_on ?? '').localeCompare(String(b.due_on ?? ''))),
  );
  protected standing(due: string | null | undefined) {
    return taskStanding(due, this.today);
  }
  protected readonly animalName = () => this.report()?.current_snapshot?.animal?.name ?? '';
  protected readonly animalId = () =>
    this.report()?.animal_id ?? this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly moment = farmMoment;

  /** Contents entries, in page order. */
  protected readonly contents = computed(() => {
    const items = [
      { id: 'identity', title: 'Identity and family', n: this.parentage()?.records.length ?? null },
      { id: 'vaccination', title: 'Health now', n: null as number | null },
      ...this.sections().map((s) => ({ id: s.id, title: s.title, n: s.records.length as number | null })),
      { id: 'audit', title: 'Technical audit', n: null },
    ];
    return items;
  });

  /**
   * Jump to a section and open it. Other folded sections close, so the page
   * does not grow with every jump (four jumps took it from 2,200px to 11,000px).
   */
  protected goTo(event: Event, id: string) {
    event.preventDefault();
    const heading =
      document.getElementById('report-' + id) ??
      (id === 'identity' ? document.getElementById('report-parentage') : null);
    const fold = heading?.closest('details');
    if (!this.printing())
      this.element.nativeElement
        .querySelectorAll('details.report-fold[open]')
        .forEach((d: HTMLDetailsElement) => { if (d !== fold) d.open = false; });
    if (fold && !fold.open) fold.open = true;
    this.current.set(id);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  }
  /** Jump from the phone's contents menu. */
  protected jump(id: string) {
    if (id) this.goTo(new Event('jump'), id);
  }

  /** Marks the section being read, for the contents. */
  private watchSections() {
    this.observer?.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    const root = this.element.nativeElement.closest('main') ?? null;
    this.observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = top?.target.getAttribute('data-section');
        if (id) this.current.set(id);
      },
      { root, rootMargin: '0px 0px -70% 0px' },
    );
    this.element.nativeElement
      .querySelectorAll('[data-section]')
      .forEach((s: Element) => this.observer!.observe(s));
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
      this.printPages = reportPrintPages(
        this.element.nativeElement,
        `${r.animal_id} · ${r.current_snapshot.animal.name || 'Unnamed'} · Generated ${farmMoment(r.generated_at)}`,
        'Lifetime report · ' + this.rangeText(),
      );
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
