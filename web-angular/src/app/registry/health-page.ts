import { LocalPagination } from '../ui/local-pagination';
import { SessionRequired } from './session-required';
import { Component, ChangeDetectionStrategy, HostListener, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { RegistryApi } from './api';
import { Session } from './session';
import { ShellActions } from './navigation';
import { farmToday } from './today';
import { HEALTH_FIELDS, healthLabel, healthWords, type HealthRecord } from './health-model';
import { Button } from '../ui/button';
import { TextInput } from '../ui/input';
import { Card, ErrorPanel } from '../ui/surface';
import { PageHeading } from '../ui/heading';
import { FieldLabel, HelpText } from '../ui/text';

@Component({
  selector: 'app-health-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LocalPagination,
    SessionRequired,
    FormsModule,
    RouterLink,
    Button,
    TextInput,
    Card,
    ErrorPanel,
    PageHeading,
    FieldLabel,
    HelpText,
  ],
  styles: [
    `
      :host {
        display: block;
      }
      label {
        display: block;
      }
      select,
      textarea {
        width: 100%;
        padding: 0.6rem;
        border: 1px solid var(--border);
        border-radius: 0.4rem;
        background: transparent;
      }
      textarea {
        min-height: 5rem;
      }
      .rows {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
      }
    `,
  ],
  template: ` <div class="space-y-5">
    <header>
      <h2 appPageHeading>Animal health</h2>
      <p appHelp>
        Veterinary visits, actual treatments and vaccination plans. A planned dose is not an
        administered dose.
      </p>
    </header>
    @if (error()) {
      <p appErrorPanel role="alert">{{ error() }}</p>
      <button appButton variant="secondary" (click)="load()">Reload records</button>
    }
    @if (error() && editing) {
      <button appButton variant="secondary" (click)="reviewConflict()">
        Compare latest saved record
      </button>
    }
    @if (conflictRecord(); as latest) {
      <section appCard>
        <h3>Latest saved revision {{ latest.revision }}</h3>
        @for (line of recordLines(latest); track $index) {
          <p>{{ line }}</p>
        }
        <p appHelp>
          Your draft remains in the form below. Review both before applying your correction.
        </p>
        <button appButton variant="secondary" (click)="acceptRevision(latest)">
          Use this revision for my correction
        </button>
      </section>
    }
    @if (notice()) {
      <p role="status" appHelp>{{ notice() }}</p>
    }
    @if (board(); as b) {
      <section appCard class="space-y-3">
        <div class="flex flex-wrap gap-3 items-end">
          <label
            ><span appFieldLabel>Health board date</span
            ><input appInput type="date" [(ngModel)]="on" (change)="load()" /></label
          ><span>{{ b.overdue }} overdue · {{ b.due }} due · {{ b.upcoming }} upcoming</span>
        </div>
        <label
          ><span appFieldLabel>Filter animal</span
          ><select [(ngModel)]="animalFilter">
            <option value="">All animals</option>
            @for (a of animals(); track a.id) {
              <option [value]="a.id">{{ a.id }} · {{ a.name || 'Unnamed' }}</option>
            }
          </select></label
        >
        <div class="rows">
          <label
            ><span appFieldLabel>Task type</span
            ><select [(ngModel)]="taskFilter">
              <option value="">All task types</option>
              <option value="administration">Doses</option>
              <option value="recheck">Rechecks</option>
              <option value="test">Tests</option>
            </select></label
          >
          <label
            ><span appFieldLabel>Due status</span
            ><select [(ngModel)]="standingFilter">
              <option value="">All outstanding</option>
              <option value="overdue">Overdue</option>
              <option value="due">Due today</option>
              <option value="upcoming">Upcoming</option>
            </select></label
          >
          <label
            ><span appFieldLabel>Assigned person</span
            ><input appInput [(ngModel)]="assigneeFilter" placeholder="Filter by name"
          /></label>
        </div>
        <app-local-pagination #pages0="localPagination" [total]="visibleTasks().length"/>
          @for (t of pages0.records(visibleTasks()); track t.id) {
          <div class="border-t border-stroke pt-3 space-y-2">
            <p>
              <a [routerLink]="['/animals', t.animal_id]">{{ t.animal_id }}</a> ·
              {{ t.instructions }} · {{ t.due_on }} {{ t.due_time }} · {{ t.standing }}
            </p>
            @if (t.needs_review) {
              <p appHelp>Animal has departed — review outstanding work.</p>
            }
            <div class="flex flex-wrap gap-2">
              <button appButton variant="secondary" (click)="complete(t)">Record completion</button
              ><button
                appButton
                variant="secondary"
                (click)="actionTask = t; action = 'defer'; actionReason = ''; newDue = ''"
              >
                Defer / miss / cancel
              </button>
            </div>
          </div>
        }
        @if (!visibleTasks().length) {
          <p appHelp>No outstanding tasks for this selection.</p>
        }
        @if (actionTask && session.ready()) {
          <form class="space-y-3" (ngSubmit)="saveAction()">
            <p>{{ actionTask.instructions }}</p>
            <label
              >Action<select name="action" [(ngModel)]="action">
                <option value="defer">Defer</option>
                <option value="miss">Missed</option>
                <option value="cancel">Cancel</option>
              </select></label
            >
            @if (action === 'defer') {
              <label
                >Replacement date<input
                  appInput
                  type="date"
                  name="newDue"
                  [(ngModel)]="newDue"
                  required
              /></label>
            }
            <label
              >Reason<input
                appInput
                name="actionReason"
                [(ngModel)]="actionReason"
                required /></label
            ><button appButton [disabled]="busy()">Save task action</button
            ><button appButton variant="secondary" type="button" (click)="actionTask = null">
              Back
            </button>
          </form>
        }
        <details>
          <summary>Open cases ({{ b.open_cases.length }})</summary>
          <app-local-pagination #pages1="localPagination" [total]="b.open_cases.length"/>
          @for (c of pages1.records(b.open_cases); track c.id) {
            <p>
              {{ label(c) }}
              <button appButton variant="secondary" (click)="edit(c)">Review case</button>
            </p>
          }
        </details>
        <details>
          <summary>
            Withdrawal instructions requiring attention ({{ b.withdrawals.length }})
          </summary>
          <app-local-pagination #pages2="localPagination" [total]="b.withdrawals.length"/>
          @for (w of pages2.records(b.withdrawals); track $index) {
            <p>
              {{ w.animal_id }} · {{ w.product_name }} · {{ w.target }} · {{ words(w.status) }}
              {{ w.until || 'End needs clarification' }} · {{ w.instruction }}
            </p>
          }
        </details>
      </section>
    }
    <div class="flex flex-wrap gap-2">
      <button appButton (click)="create('visits')">Start vet visit</button
      ><button appButton variant="secondary" (click)="create('administrations')">Record dose</button
      ><button appButton variant="secondary" (click)="roundOpen = true">Vaccination round</button>
    </div>
    <section appCard class="space-y-3">
      <label
        ><span appFieldLabel>Records</span
        ><select [(ngModel)]="entity" (change)="loadRecords()">
          @for (e of entities; track e) {
            <option [value]="e">{{ words(e) }}</option>
          }
        </select></label
      ><button appButton variant="secondary" (click)="create(entity)">
        Add {{ words(entity) }}
      </button>
      <app-local-pagination #pages3="localPagination" [total]="visibleRecords().length"/>
          @for (r of pages3.rows(visibleRecords()); track r.id) {
        <article class="border-t border-stroke py-3 space-y-2">
          <p class="font-medium">{{ label(r) }}</p>
          <p appHelp>
            {{ r.status || r.kind }} · {{ r.date_precision }} · revision {{ r.revision }} · recorded
            by {{ r.recorded_by }}
          </p>
          <div class="flex flex-wrap gap-2">
            <button appButton variant="secondary" (click)="edit(r)">View / edit</button
            ><button appButton variant="secondary" (click)="history(r)">History</button>
            @if (r.entity === 'visits') {
              <button
                appButton
                variant="secondary"
                (click)="create('examinations', { visit_id: r.id })"
              >
                Examine animal</button
              ><button
                appButton
                variant="secondary"
                (click)="create('administrations', { visit_id: r.id })"
              >
                Record dose
              </button>
            }
            @if (r.entity === 'plans') {
              <button
                appButton
                variant="secondary"
                (click)="create('tasks', { plan_id: r.id, animal_id: r.animal_id })"
              >
                Add scheduled task
              </button>
            }
            @if (r.animal_id) {
              <a appButton variant="secondary" [routerLink]="['/animals', r.animal_id, 'report']"
                >Life report / vaccination card</a
              >
            }
          </div>
        </article>
      }
      @if (!visibleRecords().length) {
        <p appHelp>No records entered for this selection.</p>
      }
    </section>
    @if (revisions().length) {
      <section appCard>
        <h3 class="font-medium">Correction history</h3>
        @for (v of revisions(); track v.id) {
          <div class="border-t border-stroke py-2">
            <p>
              Revision {{ v.revision }} · {{ v.operation }} · {{ v.recorded_at }} · {{ v.reason }}
            </p>
            @for (line of revisionLines(v); track $index) {
              <p appHelp>{{ line }}</p>
            }
          </div>
        }
        <button appButton variant="secondary" (click)="revisions.set([])">Close history</button>
      </section>
    }
    @if (editing && !session.ready()) {
      <section appCard>
        <h3>Saved record</h3>
        @for (line of recordLines(editing); track $index) {
          <p>{{ line }}</p>
        }
      </section>
    }
    @if ((editorOpen || roundOpen || actionTask) && !session.ready()) {
      <app-session-required what="health records" />
    }
    @if (editorOpen && session.ready()) {
      <section appCard class="space-y-4" id="health-editor">
        <h3 class="font-medium">
          {{ editing ? 'Review / correct' : 'Record' }} {{ words(editEntity) }}
        </h3>
        <p appHelp>
          The recorder and source come from your recording session. Enter the actual vet or
          administrator separately.
        </p>
        <form class="space-y-4" (ngSubmit)="save()">
          <div class="rows">
            @for (f of fields[editEntity]; track f.key) {
              <label
                ><span appFieldLabel>{{ f.label }}</span>
                @if (f.reference) {
                  <select
                    [name]="f.key"
                    [attr.name]="f.key"
                    [(ngModel)]="form[f.key]"
                    [required]="!!f.required"
                    (change)="referenceChanged(f.key)"
                  >
                    <option value="">Unknown / not linked</option>
                    @for (r of options(f.reference); track r.id) {
                      <option [value]="r.id">{{ label(r) }}</option>
                    }
                  </select>
                } @else if (f.type === 'select') {
                  <select
                    [name]="f.key"
                    [attr.name]="f.key"
                    [(ngModel)]="form[f.key]"
                    [required]="!!f.required"
                  >
                    <option value="">Choose</option>
                    @for (v of f.options; track v) {
                      <option [value]="v">{{ words(v) }}</option>
                    }
                  </select>
                } @else if (f.type === 'textarea') {
                  <textarea
                    [name]="f.key"
                    [attr.name]="f.key"
                    [(ngModel)]="form[f.key]"
                    [required]="!!f.required"
                  ></textarea>
                } @else if (f.type === 'checkbox') {
                  <input
                    type="checkbox"
                    [name]="f.key"
                    [attr.name]="f.key"
                    [(ngModel)]="form[f.key]"
                  />
                } @else {
                  <input
                    appInput
                    [type]="f.type || 'text'"
                    [name]="f.key"
                    [attr.name]="f.key"
                    [(ngModel)]="form[f.key]"
                    [required]="!!f.required"
                    step="any"
                  />
                }
              </label>
            }
          </div>
          @if (editEntity === 'administrations') {
            @for (target of targets; track target) {
              <fieldset class="space-y-2">
                <legend class="font-medium">{{ target }} withdrawal instruction</legend>
                <label
                  >Recorded state<select
                    [name]="target + 'State'"
                    [(ngModel)]="form[target + '_withdrawal'].state"
                  >
                    <option value="unknown">Unknown</option>
                    <option value="none">Explicitly none per instruction</option>
                    <option value="specified">Specified by veterinarian</option>
                  </select></label
                >
                @if (form[target + '_withdrawal'].state !== 'unknown') {
                  <label
                    >Instruction<input
                      appInput
                      [name]="target + 'Instruction'"
                      [(ngModel)]="form[target + '_withdrawal'].instruction"
                      required /></label
                  ><label
                    >Issuer<input
                      appInput
                      [name]="target + 'Issuer'"
                      [(ngModel)]="form[target + '_withdrawal'].issuer"
                      required
                  /></label>
                  @if (form[target + '_withdrawal'].state === 'specified') {
                    <label
                      >Exact end timestamp with timezone, if given<input
                        appInput
                        [name]="target + 'Until'"
                        [(ngModel)]="form[target + '_withdrawal'].until"
                        placeholder="YYYY-MM-DDTHH:MM:SS+05:00"
                    /></label>
                    <p appHelp>
                      Leave blank if the end needs clarification. The app does not invent release
                      times.
                    </p>
                  }
                }
              </fieldset>
            }
          }
          <label
            ><span appFieldLabel>Source reference / prescription number</span
            ><input appInput name="source_ref" [(ngModel)]="form.source_ref"
          /></label>
          <label
            ><span appFieldLabel
              >Prescription, photo or lab report (JPEG, PNG, PDF; 10 MiB each)</span
            ><input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              (change)="upload($event)"
              [disabled]="busy()"
          /></label>
          @for (id of form.attachment_ids || []; track id) {
            <p>
              <a [href]="'/api/registry/health/attachments/' + id" target="_blank" rel="noopener"
                >Download attached document</a
              >
            </p>
          }
          @if (editing) {
            <label
              ><span appFieldLabel>Reason for correction / status change</span
              ><input appInput name="reason" [(ngModel)]="form.correction_reason" required
            /></label>
          }
          <div class="flex flex-wrap gap-2">
            <button appButton type="submit" [disabled]="busy()">
              {{ busy() ? 'Saving…' : 'Save record' }}</button
            ><button appButton variant="secondary" type="button" (click)="closeEditor()">
              Close
            </button>
            @if (editing && editEntity !== 'tasks') {
              <button
                appButton
                variant="secondary"
                type="button"
                [disabled]="busy()"
                (click)="voidRecord()"
              >
                Void record with reason
              </button>
            }
          </div>
        </form>
      </section>
    }
    @if (roundOpen && session.ready()) {
      <section appCard class="space-y-3">
        <h3 class="font-medium">Vaccination round</h3>
        <p appHelp>Confirm each animal separately. This batch saves all rows together.</p>
        <form class="space-y-3" (ngSubmit)="saveRound()">
          <div class="rows">
            <label
              >Visit<select name="roundVisit" [(ngModel)]="round.visit_id">
                <option value="">No visit linked</option>
                @for (v of catalog()['visits'] || []; track v.id) {
                  <option [value]="v.id">{{ label(v) }}</option>
                }
              </select></label
            ><label
              >Date<input
                appInput
                type="date"
                name="roundDate"
                [(ngModel)]="round.occurred_on"
                required /></label
            ><label
              >Vaccine name<input
                appInput
                name="roundProduct"
                [(ngModel)]="round.product_name"
                required /></label
            ><label>Batch<input appInput name="roundBatch" [(ngModel)]="round.batch" /></label
            ><label
              >Amount<input
                appInput
                type="number"
                step="any"
                name="roundAmount"
                [(ngModel)]="round.amount"
                required /></label
            ><label>Unit<input appInput name="roundUnit" [(ngModel)]="round.unit" required /></label
            ><label
              >Route<input appInput name="roundRoute" [(ngModel)]="round.route" required /></label
            ><label
              >Administered by<input
                appInput
                name="roundBy"
                [(ngModel)]="round.administrator"
                required
            /></label>
          </div>
          @for (a of animals(); track a.id) {
            <div class="rows border-t border-stroke py-2">
              <label
                >{{ a.id }} · {{ a.name
                }}<select [name]="'round-' + a.id" [(ngModel)]="roundRows[a.id].disposition">
                  <option value="">Not selected</option>
                  <option value="given">Given</option>
                  <option value="deferred">Deferred</option>
                  <option value="not_given">Not given</option>
                </select></label
              >
              @if (
                roundRows[a.id].disposition === 'deferred' ||
                roundRows[a.id].disposition === 'not_given'
              ) {
                <label
                  >Reason<input
                    appInput
                    [name]="'reason-' + a.id"
                    [(ngModel)]="roundRows[a.id].reason"
                    required
                /></label>
                @if (roundRows[a.id].disposition === 'deferred') {
                  <label
                    >New due date<input
                      appInput
                      type="date"
                      [name]="'due-' + a.id"
                      [(ngModel)]="roundRows[a.id].due_on"
                      required
                  /></label>
                }
              }
            </div>
          }
          <label
            ><input type="checkbox" name="confirmed" [(ngModel)]="roundConfirmed" required /> I
            checked the selected animals and their individual outcomes.</label
          ><button appButton [disabled]="busy()">Save vaccination round</button
          ><button appButton variant="secondary" type="button" (click)="roundOpen = false">
            Close round
          </button>
        </form>
      </section>
    }
  </div>`,
})
export class HealthPage {
  private api = inject(RegistryApi);
  protected session = inject(Session);
  private shell = inject(ShellActions);
  private route = inject(ActivatedRoute);
  protected board = signal<any>(null);
  protected animals = signal<any[]>([]);
  protected records = signal<HealthRecord[]>([]);
  protected catalog = signal<Record<string, HealthRecord[]>>({});
  protected error = signal('');
  protected conflictRecord = signal<HealthRecord | null>(null);
  protected notice = signal('');
  protected busy = signal(false);
  protected revisions = signal<any[]>([]);
  protected fields = HEALTH_FIELDS;
  protected entities = Object.keys(HEALTH_FIELDS);
  protected entity = 'visits';
  protected editEntity = 'visits';
  protected form: any = {};
  protected editing: HealthRecord | null = null;
  protected editorOpen = false;
  protected on = farmToday();
  protected animalFilter = '';
  protected taskFilter = '';
  protected standingFilter = '';
  protected assigneeFilter = '';
  protected targets = ['milk', 'meat'];
  protected actionTask: HealthRecord | null = null;
  protected action = 'defer';
  protected actionReason = '';
  protected newDue = '';
  protected roundOpen = false;
  protected round: any = {};
  protected roundRows: Record<string, any> = {};
  protected roundConfirmed = false;
  private draftBaseline = '';
  private key = '';
  private actionKey = '';
  private roundKey = '';
  protected label = healthLabel;
  protected words = healthWords;
  constructor() {
    void this.load();
  }
  protected async load() {
    try {
      const [b, a, ...lists] = await Promise.all([
        this.api.healthGet<any>('health/board?on=' + this.on),
        this.api.herd(),
        ...this.entities.map((e) => this.api.healthGet<HealthRecord[]>('health/' + e)),
      ]);
      this.board.set(b);
      this.animals.set(a);
      const c: Record<string, HealthRecord[]> = {};
      this.entities.forEach((e, i) => (c[e] = lists[i] as HealthRecord[]));
      this.catalog.set(c);
      this.records.set(c[this.entity]);
      for (const animal of a) this.roundRows[animal.id] ??= { disposition: '' };
    } catch (e) {
      this.error.set(String(e));
    }
  }
  protected loadRecords() {
    this.records.set(this.catalog()[this.entity] ?? []);
  }
  protected visibleTasks() {
    return (this.board()?.tasks ?? []).filter(
      (t: any) =>
        t.status === 'pending' &&
        (!this.animalFilter || t.animal_id === this.animalFilter) &&
        (!this.taskFilter || t.kind === this.taskFilter) &&
        (!this.standingFilter || t.standing === this.standingFilter) &&
        (!this.assigneeFilter ||
          String(t.assignee ?? '')
            .toLowerCase()
            .includes(this.assigneeFilter.toLowerCase())),
    );
  }
  protected visibleRecords() {
    return this.records().filter(
      (r) => !this.animalFilter || !r.animal_id || r.animal_id === this.animalFilter,
    );
  }
  protected options(ref: string): HealthRecord[] {
    if (ref === 'animals')
      return this.animals().map((a) => ({
        ...a,
        animal_id: a.id,
        entity: 'animal',
        revision: 0,
        title: a.name || 'Unnamed',
      }));
    return (this.catalog()[ref] ?? []).filter(
      (r) =>
        !r.archived &&
        (!this.form.animal_id || !r.animal_id || r.animal_id === this.form.animal_id),
    );
  }
  protected create(entity: string, initial: Record<string, any> = {}) {
    if (!this.canLeave()) return;
    this.editEntity = entity;
    this.editing = null;
    this.form = {
      ...initial,
      animal_id: initial['animal_id'] ?? this.animalFilter,
      attachment_ids: [],
      milk_withdrawal: { state: 'unknown' },
      meat_withdrawal: { state: 'unknown' },
    };
    this.draftBaseline = JSON.stringify(this.form);
    this.editorOpen = true;
    this.key = '';
    this.error.set('');
    setTimeout(() =>
      document.getElementById('health-editor')?.scrollIntoView({ behavior: 'smooth' }),
    );
  }
  protected edit(r: HealthRecord) {
    if (!this.canLeave()) return;
    this.editEntity = r.entity;
    this.editing = r;
    this.form = structuredClone(r);
    this.form.correction_reason = '';
    this.draftBaseline = JSON.stringify(this.form);
    this.editorOpen = true;
    this.key = '';
    setTimeout(() =>
      document.getElementById('health-editor')?.scrollIntoView({ behavior: 'smooth' }),
    );
  }
  hasUnsavedChanges() {
    return (
      (this.editorOpen && JSON.stringify(this.form) !== this.draftBaseline) ||
      (this.roundOpen &&
        (Object.keys(this.round).length > 0 ||
          Object.values(this.roundRows).some((r) => r.disposition))) ||
      !!(this.actionTask && (this.actionReason || this.newDue))
    );
  }
  canLeave() {
    return (
      !this.hasUnsavedChanges() || confirm('Leave this form? Unsaved health changes will be lost.')
    );
  }
  @HostListener('window:beforeunload', ['$event']) beforeUnload(event: BeforeUnloadEvent) {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  protected closeEditor() {
    if (confirm('Close this form? Unsaved changes will be lost.')) this.editorOpen = false;
  }
  protected referenceChanged(key: string) {
    if (key === 'product_id') {
      const p = this.catalog()['products']?.find((p) => p.id === this.form.product_id);
      if (p) {
        this.form.product_name = p.name;
        this.form.kind = p.kind;
      }
    }
  }
  private provenance() {
    if (!this.session.ready()) {
      this.session.requestSetup();
      throw new Error('Start a recording session, then save again.');
    }
    return { recorded_by: this.session.recordedBy(), source_form: this.session.sourceForm() };
  }
  private async run(fn: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await fn();
      this.shell.refresh();
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.busy.set(false);
    }
  }
  protected async save() {
    await this.run(async () => {
      const b = { ...this.form, ...this.provenance(), expected_revision: this.editing?.revision };
      if (this.editEntity === 'costs' && (b as any).amount_minor === '')
        (b as any).amount_minor = null;
      if (this.editEntity === 'costs' && (b as any).amount_minor === undefined)
        (b as any).amount_minor = null;
      this.key ||= crypto.randomUUID();
      const r = await this.api.healthWrite<HealthRecord>(
        'health/' + this.editEntity + (this.editing ? '/' + this.editing.id + '/revise' : ''),
        b,
        this.key,
      );
      this.key = '';
      this.editing = r;
      this.form = structuredClone(r);
      this.form.correction_reason = '';
      this.draftBaseline = JSON.stringify(this.form);
      this.notice.set('Record saved.');
      await this.load();
    });
  }
  protected async voidRecord() {
    await this.run(async () => {
      if (!this.editing) return;
      if (!this.form.correction_reason?.trim()) throw new Error('Enter the reason before voiding.');
      if (!confirm('Void this record? Its history will remain available.')) return;
      await this.api.healthWrite(
        'health/' + this.editEntity + '/' + this.editing.id + '/void',
        {
          ...this.provenance(),
          reason: this.form.correction_reason,
          expected_revision: this.editing.revision,
        },
        crypto.randomUUID(),
      );
      this.editorOpen = false;
      this.notice.set('Record voided; audit history retained.');
      await this.load();
    });
  }
  protected complete(t: HealthRecord) {
    this.create(t.kind === 'administration' ? 'administrations' : 'results', {
      animal_id: t.animal_id,
      task_id: t.id,
      plan_id: t.plan_id,
      visit_id: t.visit_id,
      product_id: t.product_id,
      kind: t.kind === 'test' ? 'test' : t.kind === 'recheck' ? 'follow_up' : undefined,
    });
    this.referenceChanged('product_id');
  }
  protected async saveAction() {
    await this.run(async () => {
      if (!this.actionTask) return;
      this.actionKey ||= crypto.randomUUID();
      await this.api.healthWrite(
        'health/tasks/' + this.actionTask.id + '/actions',
        {
          ...this.provenance(),
          expected_revision: this.actionTask.revision,
          action: this.action,
          reason: this.actionReason,
          due_on: this.newDue,
        },
        this.actionKey,
      );
      this.actionKey = '';
      this.actionTask = null;
      await this.load();
    });
  }
  protected recordLines(r: HealthRecord) {
    return Object.entries(r)
      .filter(([, v]) => v !== null && typeof v !== 'object')
      .map(([k, v]) => `${healthWords(k)}: ${v}`);
  }
  protected async reviewConflict() {
    if (!this.editing) return;
    try {
      this.conflictRecord.set(
        await this.api.healthGet<HealthRecord>('health/' + this.editEntity + '/' + this.editing.id),
      );
    } catch (e) {
      this.error.set(String(e));
    }
  }
  protected acceptRevision(r: HealthRecord) {
    this.editing = r;
    this.key = '';
    this.conflictRecord.set(null);
    this.notice.set(
      'Latest revision selected. Review your draft and save with a correction reason.',
    );
  }
  protected async history(r: HealthRecord) {
    try {
      this.revisions.set(
        await this.api.healthGet<any[]>('health/' + r.entity + '/' + r.id + '/revisions'),
      );
    } catch (e) {
      this.error.set(String(e));
    }
  }
  protected revisionLines(v: any) {
    const b = JSON.parse(v.after_json);
    return Object.entries(b)
      .filter(([k, x]) => typeof x !== 'object' && !['id', 'entity', 'revision'].includes(k))
      .map(([k, x]) => `${healthWords(k)}: ${x}`);
  }
  protected async upload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    await this.run(async () => {
      const p = this.provenance();
      if (file.size > 10 * 1024 * 1024) throw new Error('Maximum file size is 10 MiB.');
      if ((this.form.attachment_ids ?? []).length >= 10)
        throw new Error('Maximum ten attachments.');
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const a = await this.api.healthWrite<any>(
        'health/attachments',
        { ...p, filename: file.name, base64 },
        crypto.randomUUID(),
      );
      this.form.attachment_ids = [...(this.form.attachment_ids ?? []), a.id];
    });
  }
  protected async saveRound() {
    await this.run(async () => {
      this.roundKey ||= crypto.randomUUID();
      await this.api.healthWrite(
        'health/rounds',
        {
          ...this.provenance(),
          confirmed: this.roundConfirmed,
          shared: { ...this.round, date_precision: 'day', kind: 'vaccine' },
          rows: Object.entries(this.roundRows)
            .filter(([, r]) => r.disposition)
            .map(([animal_id, r]) => ({ ...r, animal_id })),
        },
        this.roundKey,
      );
      this.roundKey = '';
      this.roundOpen = false;
      this.round = {};
      this.roundRows = {};
      this.roundConfirmed = false;
      this.notice.set('Vaccination round saved.');
      await this.load();
    });
  }
}
