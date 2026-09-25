import { WithdrawalNotices } from './withdrawal-notices';
import { precisionParts } from './precision-display';
import { FormState } from './form-state';
import { PrecisionDateControl, DateEntry, PrecisionDate, dateBlocker } from './precision-date';
import { DraftRegistry } from './draft-registry';
import { LocalPagination } from '../ui/local-pagination';
import { SessionRequired } from './session-required';
import {
  Component,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
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
  imports: [
    WithdrawalNotices,
    PrecisionDateControl,
    LocalPagination,
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
  template: `
    <div data-page-layout="review" class="space-y-5">
      <header>
        <h2 appPageHeading>Animal health</h2>
        <p appHelp>
          Veterinary visits, actual treatments and vaccination plans. A planned dose is not an
          administered dose.
        </p>
        <div class="flex flex-wrap gap-2">
          <button appButton (click)="create('visits')">Start vet visit</button
          ><button appButton variant="secondary" (click)="create('administrations')">
            Record dose</button
          ><button appButton variant="secondary" (click)="openRound()">Vaccination round</button>
        </div>
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
          @for (entry of recordObjects(latest); track entry.key) {
            <details>
              <summary>{{ words(entry.key) }}</summary>
              <pre class="whitespace-pre-wrap break-all text-xs">{{ entry.value }}</pre>
            </details>
          }
          <p appHelp>
            Your draft remains in the form below. Review both before applying your correction.
          </p>
          <button appButton variant="secondary" (click)="acceptRevision(latest)">
            Discard draft and load latest
          </button>
          <button appButton variant="secondary" (click)="conflictRecord.set(null)">
            Keep my draft
          </button>
        </section>
      }
      @if (writeState.uncertain()) {
        <p role="status">
          The save outcome is unknown. Fields are locked until the exact request is retried.
        </p>
        <button appButton [busy]="busy()" (click)="retryLast()">Retry same request</button>
      }
      @if (notice()) {
        <p role="status" appHelp>{{ notice() }}</p>
      }
      @if (board(); as b) {
        <section appCard class="space-y-3">
          <div class="flex flex-wrap gap-3 items-end">
            <label
              ><span appFieldLabel>Health board date</span
              ><input appInput type="date" [(ngModel)]="on" (change)="load()"
            /></label>
            <div class="flex flex-wrap gap-2" aria-label="Task status summary">
              @for (status of ['overdue', 'due', 'upcoming']; track status) {
                <button
                  appButton
                  variant="secondary"
                  [attr.aria-pressed]="standingFilter === status"
                  (click)="standingFilter = standingFilter === status ? '' : status"
                >
                  {{ b[status] }} {{ taskStatus(status) }}
                </button>
              }
            </div>
          </div>
          <label
            ><span appFieldLabel>Filter animal</span
            ><select appInput [(ngModel)]="animalFilter">
              <option value="">All animals</option>
              @for (a of animals(); track a.id) {
                <option [value]="a.id">{{ a.id }} · {{ a.name || 'Unnamed' }}</option>
              }
            </select></label
          >
          <div class="rows">
            <label
              ><span appFieldLabel>Task type</span
              ><select appInput [(ngModel)]="taskFilter">
                <option value="">All task types</option>
                <option value="administration">Doses</option>
                <option value="recheck">Rechecks</option>
                <option value="test">Tests</option>
              </select></label
            >
            <label
              ><span appFieldLabel>Due status</span
              ><select appInput [(ngModel)]="standingFilter">
                <option value="">All outstanding</option>
                <option value="overdue">Overdue</option>
                <option value="due">Due today</option>
                <option value="upcoming">Upcoming</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="missed">Missed</option>
                <option value="deferred">Deferred</option>
              </select></label
            >
            <label
              ><span appFieldLabel>Assigned person</span
              ><input appInput [(ngModel)]="assigneeFilter" placeholder="Filter by name"
            /></label>
          </div>
          <h3 class="font-semibold">
            {{
              standingFilter && !['overdue', 'due', 'upcoming'].includes(standingFilter)
                ? taskStatus(standingFilter) + ' tasks'
                : 'Outstanding tasks'
            }}
          </h3>
          <app-local-pagination
            label="Health tasks"
            #pages0="localPagination"
            [total]="visibleTasks().length"
          />
          @for (t of pages0.records(visibleTasks()); track t.id) {
            <article
              class="health-task rounded-xl border border-line p-3 space-y-2"
              [attr.data-status]="t.standing"
            >
              <div class="page-header">
                <a class="underline" [routerLink]="['/animals', t.animal_id]"
                  ><span class="font-mono whitespace-nowrap">{{ t.animal_id }}</span>
                  {{ t.animal_name }}</a
                >
                <span class="task-status">{{ taskStatus(t.standing) }}</span>
              </div>
              <h4 class="font-medium">{{ t.instructions || words(t.kind) }}</h4>
              <p>
                {{ taskKind(t.kind) }} · Due <time>{{ t.due_on }} {{ t.due_time }}</time>
              </p>
              @if (t.assignee) {
                <p>Assigned to {{ t.assignee }}</p>
              }
              @if (t.needs_review) {
                <p appHelp>Animal has departed — review outstanding work.</p>
              }
              @if (t.status === 'pending') {
                <div class="flex flex-wrap gap-2">
                  <button
                    appButton
                    variant="secondary"
                    [attr.aria-label]="
                      'Record completion for ' + t.animal_id + ': ' + t.instructions
                    "
                    (click)="complete(t)"
                  >
                    Record completion
                  </button>
                  <button
                    appButton
                    variant="secondary"
                    [attr.aria-label]="'Change status for ' + t.animal_id + ': ' + t.instructions"
                    (click)="openAction(t)"
                  >
                    Change status
                  </button>
                </div>
              }
            </article>
          }
          @if (!visibleTasks().length) {
            <p appHelp>No tasks for this selection.</p>
          }
          @if (actionTask && session.ready()) {
            <form
              data-page-layout="entry"
              id="health-action"
              class="space-y-3"
              (ngSubmit)="saveAction()"
            >
              <fieldset [disabled]="locked()" class="space-y-3">
                <p>{{ actionTask.instructions }}</p>
                <label
                  >Action<select appInput name="action" [(ngModel)]="action">
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
                  >Reason<input appInput name="actionReason" [(ngModel)]="actionReason" required
                /></label>
              </fieldset>
              <button appButton [disabled]="busy()" [attr.aria-busy]="busy() || null">
                Save task action</button
              ><button appButton variant="secondary" type="button" (click)="closeDrafts()">
                Back
              </button>
            </form>
          }
          <section aria-labelledby="withdrawal-heading">
            <h3 id="withdrawal-heading" class="font-semibold">
              Withdrawal instructions needing attention ({{ b.withdrawals.length }})
            </h3>
            @if (b.withdrawals.length) {
              <app-withdrawal-notices
                [notices]="b.withdrawals"
                [expanded]="true"
                [localSource]="true"
                (source)="openSource($event)"
              />
            } @else {
              <p appHelp>No withdrawal instructions needing attention in this board response.</p>
            }
          </section>
          <details>
            <summary>Open cases ({{ b.open_cases.length }})</summary>
            <app-local-pagination
              label="Open health cases"
              #pages1="localPagination"
              [total]="b.open_cases.length"
            />
            @for (c of pages1.records(b.open_cases); track c.id) {
              <p>
                {{ label(c) }}
                <button appButton variant="secondary" (click)="edit(c)">Review case</button>
              </p>
            }
          </details>
        </section>
      }

      <section appCard class="space-y-3">
        <label
          ><span appFieldLabel>Records</span
          ><select appInput [(ngModel)]="entity" (change)="loadRecords()">
            @for (e of entities; track e) {
              <option [value]="e">{{ entityLabel(e) }}</option>
            }
          </select></label
        >
        @if (entity !== 'visits' && entity !== 'administrations') {
          <button appButton variant="secondary" (click)="create(entity)">
            Add {{ entityLabel(entity, true) }}
          </button>
        }
        <app-local-pagination
          label="Health records"
          #pages3="localPagination"
          [total]="visibleRecords().length"
        />
        @for (r of pages3.rows(visibleRecords()); track r.id) {
          <article class="border-t border-line py-3 space-y-2">
            <p class="font-medium">{{ label(r) }}</p>
            <p appHelp>
              {{ r.status || r.kind }} · {{ r.date_precision }} · revision {{ r.revision }} ·
              recorded by {{ r.recorded_by }}
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
            <div class="border-t border-line py-2">
              <p>
                Revision {{ v.revision }} · {{ v.operation }} · {{ v.recorded_at }} ·
                {{ v.reason }}
              </p>
              @for (line of revisionLines(v); track $index) {
                <p appHelp>{{ line }}</p>
              }
            </div>
          }
          <button appButton variant="secondary" (click)="revisions.set([])">Close history</button>
        </section>
      }
      @if (editing && !savedView && !session.ready()) {
        <section appCard>
          <h3>Saved record</h3>
          @for (line of recordLines(editing); track $index) {
            <p>{{ line }}</p>
          }
        </section>
      }
      @if (((editorOpen && !savedView) || roundOpen || actionTask) && !session.ready()) {
        <app-session-required what="health records" />
      }
      @if (editorOpen && (session.ready() || savedView)) {
        <section appCard class="space-y-4" data-page-layout="entry" id="health-editor">
          <h3 class="font-medium">
            {{ savedView ? 'Saved record' : editing ? 'Correct' : 'Record' }}
            {{ entityLabel(editEntity, true) }}
          </h3>
          @if (!savedView) {
            <p appHelp>
              The recorder and source come from your recording session. Enter the actual vet or
              administrator separately.
            </p>
          }
          @if (editing) {
            <p appHelp>
              Saved · revision {{ editing.revision }} · recorded by {{ editing.recorded_by }} ·
              {{ editing['source_form'] }} · {{ editing['source_ref'] || 'no source reference' }}
            </p>
          }
          @if (savedView) {
            @for (line of recordLines(editing!); track $index) {
              <p>{{ line }}</p>
            }
            @for (entry of recordObjects(editing!); track entry.key) {
              <details>
                <summary>{{ words(entry.key) }}</summary>
                <pre class="whitespace-pre-wrap break-all text-xs">{{ entry.value }}</pre>
              </details>
            }
            <button appButton (click)="beginCorrection()">Correct record</button>
            <button appButton variant="secondary" (click)="closeEditor()">Close</button>
          } @else {
            <p appHelp>
              {{
                editing ? 'This correction will be recorded by' : 'This entry will be recorded by'
              }}
              {{ session.recordedBy() }} · {{ session.sourceForm() }}
            </p>
            <form class="space-y-4" (ngSubmit)="save()">
              <fieldset [disabled]="locked()" class="space-y-4">
                <div class="rows">
                  @for (f of fields[editEntity]; track f.key) {
                    @if (f.key === 'date_precision') {
                      <app-precision-date
                        label="Record date"
                        [initialValue]="initialDate"
                        [resetKey]="dateGeneration"
                        (changed)="dateChanged($event)"
                      />
                    } @else if (f.key !== 'occurred_on' && f.key !== 'occurred_time') {
                      <label
                        ><span appFieldLabel>{{ f.label }}</span>
                        @if (f.reference) {
                          <select
                            appInput
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
                            appInput
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
                            appInput
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
                  }
                </div>
                @if (editEntity === 'administrations') {
                  @for (target of targets; track target) {
                    <fieldset class="space-y-2">
                      <legend class="font-medium">{{ target }} withdrawal instruction</legend>
                      <label
                        >Recorded state<select
                          appInput
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
                            Leave blank if the end needs clarification. The app does not invent
                            release times.
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
                    [attr.aria-busy]="busy() || null"
                /></label>
                @if (uploadStatus) {
                  <p role="status" appHelp>{{ uploadStatus }}</p>
                }
                @if (uploadStatus.startsWith('Upload failed') && !writeState.uncertain()) {
                  <button appButton variant="secondary" type="button" (click)="uploadSelected()">
                    Retry failed upload
                  </button>
                }
                @for (id of form.attachment_ids || []; track id) {
                  <p>
                    <a
                      [href]="'/api/registry/health/attachments/' + id"
                      target="_blank"
                      rel="noopener"
                      >Download attached document</a
                    >
                  </p>
                }
                @if (editing) {
                  <label
                    ><span appFieldLabel>Reason for correction / status change</span
                    ><input
                      appInput
                      name="correction_reason"
                      [(ngModel)]="form.correction_reason"
                      required
                  /></label>
                }
              </fieldset>
              <div class="flex flex-wrap gap-2">
                <button
                  appButton
                  type="submit"
                  [disabled]="
                    busy() || !session.ready() || (!meaningfulChange() && !writeState.uncertain())
                  "
                  [busy]="busy()"
                >
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
                    [attr.aria-busy]="busy() || null"
                    intent="danger"
                    (click)="voidRecord()"
                  >
                    Void record with reason
                  </button>
                }
              </div>
            </form>
          }
        </section>
      }
      @if (roundOpen && session.ready()) {
        <section appCard class="space-y-3">
          <h3 class="font-medium">Vaccination round</h3>
          <p appHelp>Confirm each animal separately. This batch saves all rows together.</p>
          <form
            data-page-layout="entry"
            id="health-round"
            class="space-y-3"
            (ngSubmit)="saveRound()"
          >
            <fieldset [disabled]="locked()" class="space-y-3">
              <div class="rows">
                <label
                  >Visit<select appInput name="roundVisit" [(ngModel)]="round.visit_id">
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
                ><label
                  >Unit<input appInput name="roundUnit" [(ngModel)]="round.unit" required /></label
                ><label
                  >Route<input
                    appInput
                    name="roundRoute"
                    [(ngModel)]="round.route"
                    required /></label
                ><label
                  >Administered by<input
                    appInput
                    name="roundBy"
                    [(ngModel)]="round.administrator"
                    required
                /></label>
              </div>
              @for (a of animals(); track a.id) {
                <div class="rows border-t border-line py-2">
                  <label
                    >{{ a.id }} · {{ a.name
                    }}<select
                      appInput
                      [name]="'round-' + a.id"
                      [(ngModel)]="roundRows[a.id].disposition"
                    >
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
              >
            </fieldset>
            <button appButton [disabled]="busy()" [attr.aria-busy]="busy() || null">
              Save vaccination round</button
            ><button appButton variant="secondary" type="button" (click)="closeDrafts()">
              Close round
            </button>
          </form>
        </section>
      }
    </div>
  `,
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
  protected savedView = false;
  protected dateGeneration = 0;
  protected initialDate: PrecisionDate | null = null;
  protected dateEntry: DateEntry = { status: 'empty' };
  protected readonly writeState = new FormState<any>();
  protected uploadStatus = '';
  private pendingAttachment: File | null = null;
  private retryAction: (() => Promise<void>) | null = null;
  protected locked() {
    return this.busy() || this.writeState.uncertain();
  }
  private setDate() {
    if (this.form.occurred_on) this.form.occurred_time ??= null;
    this.initialDate = this.form.occurred_on
      ? {
          occurred_on: this.form.occurred_on,
          date_precision: this.form.date_precision,
          occurred_time: this.form.occurred_time ?? null,
        }
      : null;
    this.dateEntry = this.initialDate
      ? { status: 'complete', value: this.initialDate, reading: '' }
      : { status: 'empty' };
    this.dateGeneration++;
  }
  protected dateChanged(entry: DateEntry) {
    this.dateEntry = entry;
    if (entry.status === 'complete') Object.assign(this.form, entry.value);
    else if (entry.status === 'empty') {
      delete this.form.occurred_on;
      delete this.form.date_precision;
      delete this.form.occurred_time;
    }
  }
  protected beginCorrection() {
    if (!this.locked()) {
      this.savedView = false;
      setTimeout(() => this.focusEditor());
    }
  }
  protected meaningfulChange() {
    if (!this.editing) return this.hasUnsavedChanges();
    const payload = (value: any) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(value)
            .filter(
              ([key]) =>
                ![
                  'correction_reason',
                  'recorded_by',
                  'source_form',
                  'recorded_at',
                  'updated_at',
                  'revision',
                ].includes(key),
            )
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
    return (
      payload({ ...this.form, occurred_time: this.form.occurred_time ?? null }) !==
      payload({ ...this.editing, occurred_time: this.editing['occurred_time'] ?? null })
    );
  }
  private async write<T>(path: string, body: unknown): Promise<T> {
    const value = await this.writeState.runRequest(
      () => ({ path, body }),
      (request, key) => this.api.healthWrite<T>(request.path, request.body, key),
    );
    if (value === null) throw this.writeState.error();
    return value as T;
  }
  protected label = healthLabel;
  protected words = healthWords;
  private readonly drafts = inject(DraftRegistry);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private loadGeneration = 0;
  private sourceOpened = false;
  private editorOrigin: HTMLElement | null = null;
  constructor() {
    this.drafts.register(
      {
        owner: 'health',
        context: () => this.editEntity + '/' + (this.editing?.id ?? 'new'),
        description: () =>
          'Health · ' + this.editEntity + (this.form.animal_id ? ' · ' + this.form.animal_id : ''),
        snapshot: () =>
          JSON.stringify([
            this.form,
            this.round,
            this.roundRows,
            this.roundConfirmed,
            this.action,
            this.actionReason,
            this.newDue,
          ]),
        baseline: () => this.draftBaseline,
        dirty: () => this.hasUnsavedChanges(),
        pending: () => this.locked(),
        unresolved: () => this.writeState.uncertain(),
        discard: () => this.resetDrafts(),
        replaces: (url) => new URL(url, 'http://local').pathname !== '/animals/health',
      },
      inject(DestroyRef),
    );
    void this.load();
  }
  ngDoCheck() {
    this.drafts.syncUnload();
  }
  protected async load() {
    const generation = ++this.loadGeneration;
    try {
      const [b, a, ...lists] = await Promise.all([
        this.api.healthGet<any>('health/board?on=' + this.on),
        this.api.herd(),
        ...this.entities.map((e) => this.api.healthGet<HealthRecord[]>('health/' + e)),
      ]);
      if (generation !== this.loadGeneration) return;
      this.board.set(b);
      this.animals.set(a);
      const c: Record<string, HealthRecord[]> = {};
      this.entities.forEach((e, i) => (c[e] = lists[i] as HealthRecord[]));
      this.catalog.set(c);
      this.records.set(c[this.entity]);
      const record = this.route.snapshot.queryParamMap.get('record');
      if (record && !this.sourceOpened) {
        this.sourceOpened = true;
        const source = c['administrations']?.find((r) => r.id === record);
        if (source) await this.edit(source);
        else this.notice.set('The source recorded dose is not available in the current records.');
      }
      for (const animal of a) this.roundRows[animal.id] ??= { disposition: '' };
    } catch (e) {
      this.error.set(String(e));
    }
  }
  protected loadRecords() {
    this.records.set(this.catalog()[this.entity] ?? []);
  }
  protected visibleTasks() {
    return (this.board()?.tasks ?? [])
      .filter(
        (t: any) =>
          (this.standingFilter ? t.standing === this.standingFilter : t.status === 'pending') &&
          (!this.animalFilter || t.animal_id === this.animalFilter) &&
          (!this.taskFilter || t.kind === this.taskFilter) &&
          (!this.standingFilter || t.standing === this.standingFilter) &&
          (!this.assigneeFilter ||
            String(t.assignee ?? '')
              .toLowerCase()
              .includes(this.assigneeFilter.toLowerCase())),
      )
      .sort((a: any, b: any) => {
        const rank: Record<string, number> = { overdue: 0, due: 1, upcoming: 2 };
        return (
          (rank[a.standing] ?? 3) - (rank[b.standing] ?? 3) ||
          String(a.due_on).localeCompare(String(b.due_on)) ||
          String(a.due_time ?? '').localeCompare(String(b.due_time ?? '')) ||
          String(a.id).localeCompare(String(b.id))
        );
      });
  }
  protected openSource(id: string) {
    const source = this.catalog()['administrations']?.find((r) => r.id === id);
    if (source) void this.edit(source);
    else this.notice.set('The source recorded dose is not available in the current records.');
  }
  protected entityLabel(entity: string, singular = false) {
    const labels: Record<string, [string, string]> = {
      visits: ['Veterinary visits', 'veterinary visit'],
      examinations: ['Examinations', 'examination'],
      cases: ['Health cases', 'health case'],
      products: ['Medicines and vaccines', 'medicine or vaccine'],
      plans: ['Treatment and vaccination plans', 'treatment or vaccination plan'],
      tasks: ['Scheduled tasks', 'scheduled task'],
      administrations: ['Recorded doses', 'recorded dose'],
      results: ['Test results', 'test result'],
      costs: ['Health costs', 'health cost'],
    };
    return labels[entity]?.[singular ? 1 : 0] ?? this.words(entity);
  }
  protected taskKind(kind: string) {
    return (
      ({ administration: 'Dose', recheck: 'Recheck', test: 'Test' } as Record<string, string>)[
        kind
      ] ?? this.words(kind)
    );
  }
  protected taskStatus(status: string) {
    return (
      (
        {
          due: 'Due today',
          overdue: 'Overdue',
          upcoming: 'Upcoming',
          completed: 'Completed',
          cancelled: 'Cancelled',
          missed: 'Missed',
          deferred: 'Deferred',
        } as Record<string, string>
      )[status] ?? this.words(status)
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
  protected async create(entity: string, initial: Record<string, any> = {}) {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    this.resetDrafts();
    this.editorOrigin = document.activeElement as HTMLElement;
    this.editEntity = entity;
    this.editing = null;
    this.savedView = false;
    this.form = {
      ...initial,
      animal_id: initial['animal_id'] ?? this.animalFilter,
      attachment_ids: [],
      milk_withdrawal: { state: 'unknown' },
      meat_withdrawal: { state: 'unknown' },
    };
    this.setDate();
    this.draftBaseline = JSON.stringify(this.form);
    this.editorOpen = true;
    this.changeDetector.markForCheck();

    this.error.set('');
    setTimeout(() => this.focusEditor());
    return true;
  }
  protected async edit(r: HealthRecord) {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    this.resetDrafts();
    this.editorOrigin = document.activeElement as HTMLElement;
    this.editEntity = r.entity;
    this.editing = structuredClone(r);
    this.savedView = true;
    this.form = structuredClone(r);
    this.form.correction_reason = '';
    this.setDate();
    this.draftBaseline = JSON.stringify(this.form);
    this.editorOpen = true;
    this.changeDetector.markForCheck();

    setTimeout(() => this.focusEditor());
  }
  hasUnsavedChanges() {
    return (
      this.pendingAttachment !== null ||
      (this.editorOpen &&
        (JSON.stringify(this.form) !== this.draftBaseline ||
          this.dateEntry.status === 'incomplete')) ||
      (this.roundOpen &&
        (this.roundConfirmed ||
          Object.keys(this.round).length > 0 ||
          Object.values(this.roundRows).some((r) =>
            Object.values(r).some((value) => value !== '' && value != null),
          ))) ||
      !!(this.actionTask && (this.action !== 'defer' || this.actionReason || this.newDue))
    );
  }
  canLeave() {
    return this.drafts.request((p) => p.owner === 'health');
  }
  private resetDrafts() {
    this.editorOpen = false;
    this.actionTask = null;
    this.roundOpen = false;
    this.pendingAttachment = null;
    this.uploadStatus = '';
    this.form = {};
    this.dateEntry = { status: 'empty' };
    this.savedView = false;
    this.round = {};
    this.roundConfirmed = false;
    this.roundRows = Object.fromEntries(this.animals().map((a) => [a.id, { disposition: '' }]));
    this.action = 'defer';
    this.actionReason = '';
    this.newDue = '';

    this.changeDetector.markForCheck();
  }
  private focusEditor() {
    const editor = document.getElementById('health-editor');
    editor?.scrollIntoView?.({ block: 'nearest' });
    const target =
      editor?.querySelector<HTMLElement>('input, select, textarea') ??
      editor?.querySelector<HTMLElement>('h3');
    if (target) {
      if (target.tagName === 'H3') target.tabIndex = -1;
      target.focus();
    }
  }
  protected async closeDrafts() {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    this.resetDrafts();
    this.editorOrigin?.focus();
  }
  protected closeEditor() {
    return this.closeDrafts();
  }
  protected async openRound() {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    this.resetDrafts();
    this.editorOrigin = document.activeElement as HTMLElement;
    this.roundOpen = true;
    setTimeout(() => document.querySelector<HTMLElement>('#health-round select')?.focus());
  }
  protected async openAction(t: HealthRecord) {
    if (this.drafts.hasChanges((p) => p.owner === 'health') && !(await this.canLeave())) return;
    this.resetDrafts();
    this.editorOrigin = document.activeElement as HTMLElement;
    this.actionTask = t;
    setTimeout(() => document.querySelector<HTMLElement>('#health-action select')?.focus());
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
  protected retryLast() {
    if (this.retryAction) return this.run(this.retryAction);
    return Promise.resolve();
  }
  private async run(fn: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const action = this.writeState.uncertain() && this.retryAction ? this.retryAction : fn;
      this.retryAction = action;
      await action();
      this.retryAction = null;
      this.shell.refresh();
    } catch (e) {
      this.error.set(String(e));
      if (this.uploadStatus.startsWith('Uploading'))
        this.uploadStatus = 'Upload failed. The attachment has not been linked to this record.';
      setTimeout(() => document.querySelector<HTMLElement>('[role=alert]')?.focus());
    } finally {
      this.busy.set(false);
    }
  }
  protected async save() {
    if (!this.writeState.uncertain()) {
      if (this.savedView || !this.meaningfulChange()) return;
      if (this.fields[this.editEntity].some((f) => f.key === 'date_precision')) {
        const error = dateBlocker(this.dateEntry, { label: 'record date', required: true });
        if (error) {
          this.error.set(error);
          this.focusEditor();
          return;
        }
      }
    }
    await this.run(async () => {
      const b = { ...this.form, ...this.provenance(), expected_revision: this.editing?.revision };
      if (this.editEntity === 'costs' && (b as any).amount_minor === '')
        (b as any).amount_minor = null;
      if (this.editEntity === 'costs' && (b as any).amount_minor === undefined)
        (b as any).amount_minor = null;

      const r = await this.write<HealthRecord>(
        'health/' + this.editEntity + (this.editing ? '/' + this.editing.id + '/revise' : ''),
        b,
      );

      this.editing = r;
      this.form = structuredClone(r);
      this.form.correction_reason = '';
      this.savedView = true;
      this.setDate();
      this.draftBaseline = JSON.stringify(this.form);
      this.notice.set('Record saved.');
      await this.load();
    });
  }
  protected async voidRecord() {
    await this.run(async () => {
      if (!this.editing) return;
      if (!this.form.correction_reason?.trim()) throw new Error('Enter the reason before voiding.');
      if (
        !this.writeState.uncertain() &&
        !(await this.drafts.confirm(
          'Void this record?',
          this.label(this.editing) +
            ' · ' +
            (this.editing.occurred_on ?? this.editing.due_on ?? '') +
            '. Its history will remain available.',
          'Void record',
        ))
      )
        return;
      await this.write('health/' + this.editEntity + '/' + this.editing.id + '/void', {
        ...this.provenance(),
        reason: this.form.correction_reason,
        expected_revision: this.editing.revision,
      });
      this.editorOpen = false;
      this.notice.set('Record voided; audit history retained.');
      await this.load();
    });
  }
  protected async complete(t: HealthRecord) {
    const created = await this.create(t.kind === 'administration' ? 'administrations' : 'results', {
      animal_id: t.animal_id,
      task_id: t.id,
      plan_id: t.plan_id,
      visit_id: t.visit_id,
      product_id: t.product_id,
      kind: t.kind === 'test' ? 'test' : t.kind === 'recheck' ? 'follow_up' : undefined,
    });
    if (created) this.referenceChanged('product_id');
  }
  protected async saveAction() {
    await this.run(async () => {
      if (!this.actionTask) return;

      await this.write('health/tasks/' + this.actionTask.id + '/actions', {
        ...this.provenance(),
        expected_revision: this.actionTask.revision,
        action: this.action,
        reason: this.actionReason,
        due_on: this.newDue,
      });

      this.actionTask = null;
      await this.load();
    });
  }
  protected recordObjects(r: HealthRecord) {
    return Object.entries(r)
      .filter(([, value]) => value !== null && typeof value === 'object')
      .map(([key, value]) => ({ key, value: JSON.stringify(value, null, 2) }));
  }
  protected recordLines(r: HealthRecord) {
    return Object.entries(r)
      .filter(([k, v]) => v !== null && typeof v !== 'object' && k !== 'date_precision')
      .map(([k, v]) => {
        if (k === 'occurred_on') {
          const date = precisionParts(v as string, r.date_precision as any);
          return 'Date: ' + date.figure + (date.qualifier ? ' ' + date.qualifier : '');
        }
        return `${healthWords(k)}: ${v}`;
      });
  }
  protected async reviewConflict() {
    if (!this.editing) return;
    const entity = this.editEntity,
      id = this.editing.id;
    try {
      const latest = await this.api.healthGet<HealthRecord>('health/' + entity + '/' + id);
      if (this.editEntity === entity && this.editing?.id === id) this.conflictRecord.set(latest);
    } catch (error) {
      if (this.editEntity === entity && this.editing?.id === id) this.error.set(String(error));
    }
  }
  protected async acceptRevision(r: HealthRecord) {
    if (this.locked()) return;
    if (this.hasUnsavedChanges() && !(await this.canLeave())) return;
    await this.edit(r);
    this.conflictRecord.set(null);
    this.writeState.reset();
    this.notice.set('Latest saved revision loaded.');
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
    if (!file || this.locked()) return;
    this.pendingAttachment = file;
    await this.uploadSelected();
  }
  protected async uploadSelected() {
    const file = this.pendingAttachment;
    if (!file) return;
    await this.run(async () => {
      this.uploadStatus = 'Uploading ' + file.name + '…';
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
      const a = await this.write<any>('health/attachments', { ...p, filename: file.name, base64 });
      this.form.attachment_ids = [...(this.form.attachment_ids ?? []), a.id];
      this.pendingAttachment = null;
      this.uploadStatus = 'Attachment stored. Save the record to link it.';
    });
  }
  protected async saveRound() {
    await this.run(async () => {
      if (
        Object.values(this.roundRows).some(
          (row) =>
            !row.disposition && Object.values(row).some((value) => value !== '' && value != null),
        )
      ) {
        throw new Error(
          'Choose a disposition for each vaccination row you started, or clear that row.',
        );
      }

      await this.write('health/rounds', {
        ...this.provenance(),
        confirmed: this.roundConfirmed,
        shared: { ...this.round, date_precision: 'day', kind: 'vaccine' },
        rows: Object.entries(this.roundRows)
          .filter(([, r]) => r.disposition)
          .map(([animal_id, r]) => ({ ...r, animal_id })),
      });

      this.roundOpen = false;
      this.round = {};
      this.roundRows = {};
      this.roundConfirmed = false;
      this.notice.set('Vaccination round saved.');
      await this.load();
    });
  }
}
