import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
  ElementRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { RegistryApi } from './api';
import { Session } from './session';
import { SessionRequired } from './session-required';
import { FormState } from './form-state';
import { WriteLog } from './after-write';
import { TextInput } from '../ui/input';
import { Button } from '../ui/button';
import { Card, ErrorPanel } from '../ui/surface';
import { FieldLabel, HelpText } from '../ui/text';
import { PageHeading } from '../ui/heading';
import { FeedEditor } from './feed-editor';
import { blankFeed, type FeedRecord, type FeedLine } from './feed-model';
import { farmToday } from './today';

@Component({
  selector: 'app-feed-daily',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    SessionRequired,
    TextInput,
    Button,
    Card,
    ErrorPanel,
    FieldLabel,
    HelpText,
    PageHeading,
    FeedEditor,
  ],
  template: `
    <div class="mx-auto max-w-[720px] space-y-5">
      <header>
        <h2 appPageHeading>Daily feeding</h2>
        <p appHelp>
          One account for the day. Unknown quantity and unspecified recipients are valid.
        </p>
      </header>
      @if (loadError()) {
        <p appErrorPanel>{{ loadError() }}</p>
        <button appButton variant="secondary" (click)="load()">Retry loading</button>
      }
      @if (loaded()) {
        @if (draft.id) {
          <p appHelp>
            Saved {{ draft.completeness }} account · revision {{ draft.revision }} ·
            {{ draft.source_form }} · {{ draft.recorded_by }}. Editing keeps confirmed recipients
            unless refreshed.
          </p>
        }
        @if (purchaseSaved()) {
          <p appCard>
            Purchase saved independently. Cancelling this daily form leaves it available.
            <a [routerLink]="['/feed/purchases', purchaseSaved()]" class="underline"
              >Review purchase</a
            >. Add its feed line explicitly if given.
          </p>
        }
        <form
          class="space-y-5"
          (ngSubmit)="review ? save() : reviewDraft()"
          data-role="feed-daily-form"
        >
          @if (!review) {
            <label class="block"
              ><span appFieldLabel>Date</span
              ><input
                appInput
                type="date"
                name="on"
                [(ngModel)]="draft.on"
                (ngModelChange)="refreshSuggestions()"
                required
            /></label>
            <section appCard class="space-y-4">
              <h3 class="font-medium">Fresh fodder</h3>
              <label class="block"
                ><span appFieldLabel>Fresh fodder account</span
                ><select
                  appInput
                  name="fresh_status"
                  [(ngModel)]="draft.fresh_status"
                  (ngModelChange)="freshChanged()"
                >
                  <option value="">Choose an answer</option>
                  <option value="given">Given — add source line below</option>
                  <option value="none">None given</option>
                  <option value="unknown">Unknown</option>
                </select></label
              >
              <label class="block"
                ><span appFieldLabel>Fresh-fodder supply assessment</span
                ><select appInput name="assessment" [(ngModel)]="draft.assessment">
                  <option value="">Choose assessment</option>
                  @for (a of assessments; track a) {
                    <option [value]="a">{{ words(a) }}</option>
                  }
                </select></label
              >
              <p appHelp>
                Your assessment of fresh-fodder supply; no nutritional adequacy is calculated.
              </p>
              @if (draft.assessment === 'short') {
                <button
                  appButton
                  variant="secondary"
                  type="button"
                  (click)="openNested('purchases')"
                >
                  Add a purchase for the shortfall
                </button>
              }
            </section>
            <section appCard class="space-y-4">
              <h3 class="font-medium">Additional feed</h3>
              <label class="block"
                ><span appFieldLabel>Additional-feed account</span
                ><select appInput name="additional_status" [(ngModel)]="draft.additional_status">
                  <option value="">Choose an answer</option>
                  <option value="given">Given — add lines below</option>
                  <option value="none">None given</option>
                  <option value="unknown">Unknown</option>
                </select></label
              >
            </section>
            @for (l of draft.lines; track l; let i = $index) {
              <details appCard class="space-y-4" [open]="!l.id" data-role="feeding-line">
                <summary class="cursor-pointer font-medium">
                  {{ itemName(l.item_id) || 'New feed line' }} ·
                  {{ l.quantity === null ? 'unmeasured' : l.quantity + ' ' + l.unit }} ·
                  {{ words(l.recipients) }}
                </summary>
                <label class="block"
                  ><span appFieldLabel>Item</span
                  ><select
                    appInput
                    [name]="'item' + i"
                    [(ngModel)]="l.item_id"
                    (ngModelChange)="l.sources = []"
                  >
                    <option value="">Choose item</option>
                    @for (item of items(); track item.id) {
                      <option [value]="item.id">
                        {{ item.label }}{{ item.archived ? ' (archived)' : '' }}
                      </option>
                    }
                  </select></label
                >
                <fieldset class="space-y-2">
                  <legend appFieldLabel>Sources — select all that apply</legend>
                  @if (category(l.item_id) === 'fresh_fodder') {
                    @for (c of suggestedCrops(); track c.id) {
                      <label class="flex gap-2 text-sm"
                        ><input
                          type="checkbox"
                          [checked]="hasSource(l, 'crop', c.id)"
                          (change)="toggleSource(l, 'crop', c.id)"
                        />{{ c.label }} · {{ c.status }}{{ c.archived ? ' · archived' : '' }}</label
                      >
                    }
                  }
                  @for (p of purchases(); track p.id) {
                    @if (p.item_id === l.item_id) {
                      <label class="flex gap-2 text-sm"
                        ><input
                          type="checkbox"
                          [checked]="hasSource(l, 'purchase', p.id)"
                          (change)="toggleSource(l, 'purchase', p.id)"
                        />Purchase {{ p.on }} · {{ p.supplier || 'supplier unspecified' }}</label
                      >
                    }
                  }
                  @for (k of ['purchased', 'other', 'unknown']; track k) {
                    <label class="flex gap-2 text-sm"
                      ><input
                        type="checkbox"
                        [checked]="hasSource(l, k, null)"
                        (change)="toggleSource(l, k, null)"
                      />{{
                        k === 'purchased'
                          ? 'Purchased stock (no linked invoice)'
                          : k === 'other'
                            ? 'Other source'
                            : 'Unknown source'
                      }}</label
                    >
                  }
                </fieldset>
                <div class="grid gap-4 sm:grid-cols-2">
                  <label
                    ><span appFieldLabel>Quantity (optional)</span
                    ><input
                      appInput
                      type="number"
                      step="any"
                      [name]="'quantity' + i"
                      [(ngModel)]="l.quantity"
                      class="w-full" /></label
                  ><label
                    ><span appFieldLabel>Unit</span
                    ><input appInput [name]="'unit' + i" [(ngModel)]="l.unit" class="w-full"
                  /></label>
                </div>
                <p appHelp>
                  {{
                    l.quantity === null
                      ? 'Unmeasured — no quantity will be inferred.'
                      : 'Quantity of feed only; preparation water is excluded.'
                  }}
                </p>
                <label class="block"
                  ><span appFieldLabel>Recipients</span
                  ><select
                    appInput
                    [name]="'recipients' + i"
                    [(ngModel)]="l.recipients"
                    (ngModelChange)="refreshLine(l)"
                  >
                    <option value="unspecified">Unspecified</option>
                    <option value="milking">Milking group</option>
                    <option value="herd">Whole herd</option>
                    <option value="selected">Selected animals</option>
                  </select></label
                >
                @if (l.recipients === 'selected') {
                  @for (a of suggestions().herd; track a.id) {
                    <label class="flex gap-2 text-sm"
                      ><input
                        type="checkbox"
                        [checked]="l.animal_ids.includes(a.id)"
                        (change)="toggleAnimal(l, a.id)"
                      />{{ a.id }} {{ a.name }}</label
                    >
                  }
                }
                @if (l.recipients !== 'unspecified') {
                  <p appHelp>
                    Recipients: {{ recipientNames(l) || 'Empty set' }}. Saved snapshots are not
                    updated automatically.
                  </p>
                  <button appButton variant="secondary" type="button" (click)="refreshLine(l)">
                    Refresh from this date
                  </button>
                  <label class="flex gap-2 text-sm"
                    ><input
                      type="checkbox"
                      [name]="'confirmed' + i"
                      [(ngModel)]="l.recipients_confirmed"
                    />I confirm these recipients</label
                  >
                }
                <label class="block"
                  ><span appFieldLabel>Preparation</span
                  ><select appInput [name]="'preparation' + i" [(ngModel)]="l.preparation">
                    @for (p of ['unknown', 'dry', 'water_mixed', 'other']; track p) {
                      <option [value]="p">{{ words(p) }}</option>
                    }
                  </select></label
                >
                <label class="block"
                  ><span appFieldLabel>Stated purpose (optional)</span
                  ><input appInput [name]="'purpose' + i" [(ngModel)]="l.purpose" class="w-full"
                /></label>
                <label class="block"
                  ><span appFieldLabel>Notes / exceptions (optional)</span
                  ><textarea
                    appInput
                    [name]="'lineNotes' + i"
                    [(ngModel)]="l.notes"
                    class="w-full"
                  ></textarea>
                </label>
                <button
                  appButton
                  variant="secondary"
                  type="button"
                  (click)="draft.lines.splice(i, 1)"
                >
                  Remove line
                </button>
              </details>
            }
            <div class="flex flex-wrap gap-2">
              <button appButton variant="secondary" type="button" (click)="addLine()">
                Add feed line</button
              ><button appButton variant="secondary" type="button" (click)="openNested('items')">
                Create feed item</button
              ><button
                appButton
                variant="secondary"
                type="button"
                (click)="openNested('purchases')"
              >
                Record purchase
              </button>
            </div>
            <p appHelp>
              Common items such as wanda, khall and silage are choices, not presumed feeding.
            </p>
            <label class="block"
              ><span appFieldLabel>Day notes (optional)</span
              ><textarea appInput name="notes" [(ngModel)]="draft.notes" class="w-full"></textarea>
            </label>
            <label class="block"
              ><span appFieldLabel>Source reference (optional)</span
              ><input appInput name="source_ref" [(ngModel)]="draft.source_ref" class="w-full"
            /></label>
          } @else {
            <section appCard class="space-y-3" tabindex="-1" data-role="feed-review">
              <h3 class="font-medium">Review {{ draft.on }}</h3>
              <p>
                Fresh fodder: {{ draft.fresh_status }} · supply {{ words(draft.assessment) }}.
                Additional feed: {{ draft.additional_status }}.
              </p>
              <p>
                {{
                  [draft.fresh_status, draft.additional_status, draft.assessment].includes(
                    'unknown'
                  )
                    ? 'Partial account'
                    : 'Recorded feeding account'
                }}
              </p>
              @for (l of draft.lines; track l) {
                <div class="border-t border-line-subtle pt-3">
                  <strong>{{ itemName(l.item_id) }}</strong>
                  <p>{{ sourceNames(l) }}</p>
                  <p>
                    {{ l.quantity === null ? 'Unmeasured' : l.quantity + ' ' + l.unit }} ·
                    {{ words(l.preparation) }}
                  </p>
                  <p>{{ words(l.recipients) }}: {{ recipientNames(l) || 'not specified' }}</p>
                  <p>{{ l.purpose }} {{ l.notes }}</p>
                </div>
              }
              <p>{{ draft.notes }}</p>
              <p appHelp>
                Provenance: {{ session.sourceForm() || draft.source_form }} ·
                {{ session.recordedBy() || draft.recorded_by }} ·
                {{ draft.source_ref || 'no source reference' }}
              </p>
            </section>
            <button appButton variant="secondary" type="button" (click)="review = false">
              {{ draft.id ? 'Edit account' : 'Back to editing' }}
            </button>
          }
          @if (localError) {
            <p appErrorPanel role="alert">{{ localError }}</p>
          }
          @if (state.error(); as e) {
            <p appErrorPanel role="alert">{{ e.message }}</p>
            @if (e.code === 'feed_conflict') {
              <button appButton variant="secondary" type="button" (click)="loadLatest()">
                Load latest alongside my draft
              </button>
            }
          }
          @if (latest()) {
            <section appCard>
              <h3>Latest saved account</h3>
              <p>{{ latest()?.on }} · revision {{ latest()?.revision }} · {{ latest()?.notes }}</p>
              <button appButton variant="secondary" type="button" (click)="adoptLatest()">
                Use latest saved account (discard this draft)
              </button>
            </section>
          }
          @if (session.ready()) {
            <button
              appButton
              type="submit"
              [appButtonDisabled]="state.submitting() || nested !== ''"
            >
              {{
                state.submitting()
                  ? 'Saving…'
                  : review
                    ? 'Save feeding summary'
                    : 'Review feeding summary'
              }}
            </button>
          } @else {
            <app-session-required what="this feeding summary" />
          }
          <a routerLink="/" appButton variant="secondary">Cancel daily entry</a>
        </form>
        @if (draft.id) {
          <button appButton variant="secondary" type="button" (click)="showRevisions()">
            Correction history
          </button>
          @for (r of revisions(); track r.id) {
            <details appCard>
              <summary>{{ r.operation }} · revision {{ r.revision }} · {{ r.recorded_at }}</summary>
              <p appHelp>
                Previous and saved account, including confirmed recipients and provenance.
              </p>
              <pre class="whitespace-pre-wrap break-all text-xs">{{ r.before_json }}</pre>
              <pre class="whitespace-pre-wrap break-all text-xs">{{ r.after_json }}</pre>
              <p>{{ r.provenance }}</p>
            </details>
          }
          <button appButton variant="secondary" type="button" (click)="removing = true">
            Remove summary
          </button>
        }
        @if (removing) {
          <div appCard>
            <p>
              Remove only this date's summary? Its audit trail remains. The date returns to not
              recorded.
            </p>
            <button
              appButton
              (click)="remove()"
              [appButtonDisabled]="!session.ready() || state.submitting()"
            >
              Confirm removal</button
            ><button appButton variant="secondary" (click)="removing = false">Keep summary</button>
          </div>
        }
        @if (nested) {
          <app-feed-editor
            [entity]="nested"
            [items]="items()"
            (saved)="nestedSaved($event)"
            (cancelled)="nested = ''"
            (addItem)="nestedItem = true"
          />
        }
        @if (nestedItem) {
          <app-feed-editor
            entity="items"
            (saved)="itemSaved($event)"
            (cancelled)="nestedItem = false"
          />
        }
      }
    </div>
  `,
})
export class FeedDailyScreen {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly api = inject(RegistryApi);
  readonly session = inject(Session);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly log = inject(WriteLog);
  readonly items = signal<FeedRecord[]>([]);
  readonly crops = signal<FeedRecord[]>([]);
  readonly purchases = signal<FeedRecord[]>([]);
  readonly loaded = signal(false);
  readonly loadError = signal('');
  readonly latest = signal<FeedRecord | null>(null);
  readonly purchaseSaved = signal('');
  readonly suggestions = signal<{
    herd: { id: string; name: string | null }[];
    milking: { id: string; name: string | null }[];
  }>({ herd: [], milking: [] });
  readonly state = new FormState<FeedRecord>();
  draft = blankFeed();
  review = false;
  nested = '';
  nestedItem = false;
  removing = false;
  localError = '';
  originalId = '';
  readonly assessments = ['enough', 'short', 'surplus', 'unknown', 'not_applicable'];
  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => void this.load());
  }
  async load() {
    this.loaded.set(false);
    try {
      const on = this.route.snapshot.paramMap.get('on') ?? farmToday();
      const [r] = await Promise.all([
        this.api.feedGet<FeedRecord | null>('daily/on/' + on),
        this.catalogues(),
      ]);
      this.draft = { ...blankFeed(), ...structuredClone(r ?? {}), on: r?.on ?? on };
      this.originalId = r?.id ?? '';
      this.review = !!r;
      await this.refreshSuggestions();
      this.loadError.set('');
      this.loaded.set(true);
    } catch (e) {
      this.loadError.set(String(e));
    }
  }
  async catalogues() {
    const [i, c, p] = await Promise.all([
      this.api.feedGet<FeedRecord[]>('items'),
      this.api.feedGet<FeedRecord[]>('crops'),
      this.api.feedGet<FeedRecord[]>('purchases'),
    ]);
    this.items.set(i);
    this.crops.set(c);
    this.purchases.set(p);
  }
  async refreshSuggestions() {
    try {
      this.suggestions.set(await this.api.feedGet('recipients?on=' + this.draft.on));
    } catch (e) {
      this.localError = String(e);
    }
  }
  suggestedCrops() {
    return this.crops().filter(
      (c) =>
        this.draft.on < farmToday() ||
        (!c.archived && c.status !== 'finished') ||
        this.draft.lines.some((l) => l.sources.some((s) => s.ref_id === c.id)),
    );
  }
  words(v: string) {
    return v.replaceAll('_', ' ');
  }
  category(id: string) {
    return this.items().find((x) => x.id === id)?.category;
  }
  itemName(id: string) {
    return this.items().find((x) => x.id === id)?.label ?? id;
  }
  freshChanged() {
    if (this.draft.fresh_status === 'none') this.draft.assessment = 'not_applicable';
    else if (this.draft.fresh_status === 'unknown') this.draft.assessment = 'unknown';
    else this.draft.assessment = '';
  }
  addLine() {
    this.draft.lines.push({
      item_id: '',
      quantity: null,
      unit: null,
      preparation: 'unknown',
      recipients: 'unspecified',
      animal_ids: [],
      recipients_confirmed: false,
      sources: [],
      purpose: null,
      notes: null,
    });
  }
  hasSource(l: FeedLine, k: string, id: string | null) {
    return l.sources.some((s) => s.kind === k && s.ref_id === id);
  }
  toggleSource(l: FeedLine, k: string, id: string | null) {
    if (this.hasSource(l, k, id))
      l.sources = l.sources.filter((s) => !(s.kind === k && s.ref_id === id));
    else l.sources.push({ kind: k, ref_id: id });
  }
  refreshLine(l: FeedLine) {
    l.animal_ids =
      l.recipients === 'herd'
        ? this.suggestions().herd.map((a) => a.id)
        : l.recipients === 'milking'
          ? this.suggestions().milking.map((a) => a.id)
          : [];
    l.recipients_confirmed = false;
  }
  toggleAnimal(l: FeedLine, id: string) {
    l.animal_ids = l.animal_ids.includes(id)
      ? l.animal_ids.filter((x) => x !== id)
      : [...l.animal_ids, id];
    l.recipients_confirmed = false;
  }
  recipientNames(l: FeedLine) {
    return l.animal_ids
      .map((id) => {
        const a = this.suggestions().herd.find((a) => a.id === id);
        return a?.name ? id + ' ' + a.name : id;
      })
      .join(', ');
  }
  sourceNames(l: FeedLine) {
    return l.sources
      .map((s) =>
        s.kind === 'crop'
          ? 'Own crop: ' + (this.crops().find((c) => c.id === s.ref_id)?.label ?? s.ref_id)
          : s.kind === 'purchase'
            ? 'Purchase: ' + (this.purchases().find((p) => p.id === s.ref_id)?.on ?? s.ref_id)
            : s.kind + ' source',
      )
      .join('; ');
  }
  reviewDraft() {
    this.localError = '';
    if (!this.draft.fresh_status || !this.draft.additional_status || !this.draft.assessment) {
      this.localError =
        'Answer fresh fodder, supply assessment and additional feed before review. Unknown is a valid partial account.';
      return;
    }
    if (this.draft.lines.some((l) => l.recipients !== 'unspecified' && !l.recipients_confirmed)) {
      this.localError = 'Confirm the displayed recipients on each resolved line.';
      return;
    }
    this.review = true;
  }
  async save() {
    if (!this.session.ready() || this.state.submitting() || this.nested || !this.review) return;
    const r = await this.state.run((k) =>
      this.api.feedWrite<FeedRecord>(
        'daily' + (this.originalId ? '/' + this.originalId : ''),
        { ...this.draft, ...this.session.provenance() },
        k,
      ),
    );
    if (r) {
      this.log.announce(
        `Feed ${r.completeness === 'partial' ? 'partially ' : ''}recorded for ${r.on}.`,
      );
      await this.router.navigate(['/'], { queryParams: { on: r.on } });
    }
  }
  openNested(entity: string) {
    this.nested = entity;
    requestAnimationFrame(() => {
      const input = this.host.nativeElement.querySelector(
        'app-feed-editor input',
      ) as HTMLElement | null;
      input?.focus();
      input?.scrollIntoView({ block: 'center' });
    });
  }
  async nestedSaved(r: FeedRecord) {
    if (this.nested === 'purchases') this.purchaseSaved.set(r.id);
    this.nested = '';
    await this.catalogues();
  }
  async itemSaved(r: FeedRecord) {
    this.nestedItem = false;
    await this.catalogues();
  }
  async loadLatest() {
    try {
      const latest = await this.api.feedGet<FeedRecord | null>('daily/on/' + this.draft.on);
      this.latest.set(latest);
      if (!latest)
        this.localError = 'This date no longer has a saved account. Your draft is preserved.';
    } catch (e) {
      this.localError = String(e);
    }
  }
  readonly revisions = signal<
    {
      id: string;
      operation: string;
      revision: number;
      recorded_at: string;
      before_json: string;
      after_json: string;
      provenance: string;
    }[]
  >([]);
  async showRevisions() {
    try {
      this.revisions.set(await this.api.feedGet('daily/' + this.originalId + '/revisions'));
    } catch (e) {
      this.localError = String(e);
    }
  }
  adoptLatest() {
    const r = this.latest();
    if (r) {
      this.draft = structuredClone(r);
      this.originalId = r.id;
      this.review = false;
      this.state.reset();
      this.latest.set(null);
    }
  }
  async remove() {
    if (!this.session.ready() || this.state.submitting()) return;
    const r = await this.state.run((k) =>
      this.api.feedWrite<FeedRecord>(
        'daily/' + this.originalId + '/delete',
        { revision: this.draft.revision, ...this.session.provenance() },
        k,
      ),
    );
    if (r) {
      this.log.announce('Removed feeding summary; audit trail retained.');
      await this.router.navigate(['/'], { queryParams: { on: this.draft.on } });
    }
  }
}
