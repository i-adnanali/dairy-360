import { checkFeed, feedList, feedGet, feedDaily, feedSave, feedRemove, feedRecipients, feedHistory, feedOverview, cropDays, object, type FeedEntity } from './feed';
// Animal registry -- HTTP routes for the entry UI.
//
// ---------------------------------------------------------------------------
// A FACTORY, NOT A CONST -- and that is the whole point
// ---------------------------------------------------------------------------
// farm/routes.ts exports `farmRouter` as a const that imports the `db`
// singleton. This one is `registryRouter(db)`, taking a handle, because the
// development harness must be able to serve the fixture herd from an
// `:memory:` database.
//
// That is not a convenience. The standing rule for this cycle is that NOTHING
// SYNTHETIC TOUCHES registry_animals in dairy.db -- the registry holds the only
// records in this repo that cannot be regenerated, and "I will delete them
// after" is how they stop being the only records. A router that could only ever
// reach the singleton would make developing the forms against real-shaped data
// impossible without breaking that rule.
//
// So this module imports no `../db`, and registry.harness.test.ts asserts it.
//
// ---------------------------------------------------------------------------
// ERROR MAPPING
// ---------------------------------------------------------------------------
// Every domain refusal is a RegistryError and comes back as 400 with
// `{ error, field?, message }`, the prose VERBATIM. The form shows the message
// unchanged and attaches it to the control named by `field`. Anything that is
// not a RegistryError is a bug and becomes a 500 -- it must not be dressed up
// as a validation failure the operator can fix.
//
// better-sqlite3 is synchronous, so every handler is synchronous and a throw
// propagates to Express's error handling without an async wrapper.
//
// ---------------------------------------------------------------------------
// EVERY ROUTE THAT WRITES REQUIRES AN `Idempotency-Key`
// ---------------------------------------------------------------------------
// Every `router.post` below goes through `write()`, which refuses a request
// with no `Idempotency-Key` as a 400 rather than accepting it unprotected. The
// one deliberate exception is /rebuild, and the comment on it says why. See
// idempotency.ts for what the key closes, and for the two holes it does not.
//
// The heading used to say "appends an event", which the milking routes broke:
// they write a measurement table and append nothing. The rule was never about
// events -- it is about any request that changes state and could arrive twice.
//
// THERE WAS AN ENUMERATION HERE AND IT HAS BEEN DELETED, on its own advice. It
// said "the three write routes", then six, then thirteen, and it went stale
// every single time the code moved -- so it ended by conceding that "if it
// disagrees with the router below, the router is right". The labour cycle would
// have made it wrong a fourth time. A list of route paths in a comment beside
// the list of route paths is not documentation, it is a second copy: the rule
// is the sentence above, and `write()` is where it is enforced.
//
// Why the correction route in particular needs a key: it appends a superseding
// calving, a superseding birth and sometimes a departure. Replayed without one
// it does not merely duplicate -- it hits the partial unique index on
// `supersedes_id`, which is a raw SQLite constraint error rather than a
// RegistryError, so it surfaces as a 500. Cheaper to protect than to explain.
//
// /rebuild is deliberately unkeyed; the comment on it says why.

import express from 'express';
import type { Request, Response } from 'express';

import { addAcquiredAnimal, appendLifeEvent } from './entry';
import {
  addDestination,
  destinationList,
  pricesFor,
  setPrice,
  updateDestination,
} from './destinations';
import {
  deleteDispatches,
  dispatchSheet,
  reconcileRange,
  saveDispatchSession,
} from './dispatch';
import { balances, deletePayment, recordPayment, statement } from './ledger';
import {
  addEngagement,
  addPerson,
  engagementsFor,
  getPerson,
  updateEngagement,
  updatePerson,
} from './people';
import {
  benefitsFor,
  correctTerm,
  deleteWagePeriods,
  packageOn,
  payrollRun,
  saveRun,
  setTerm,
  termsFor,
} from './payroll';
import {
  deleteWagePayment,
  recordWagePayment,
  wageBalances,
  wageStatement,
} from './wages';
import { correctCalving, recordCalving } from './calving';
import {
  deleteMilkings,
  milkingReport,
  milkingRoster,
  milkingsForAnimal,
  saveMilkingSession,
} from './milking';
import { RegistryError, isRegistryError } from './errors';
import {
  IDEMPOTENCY_HEADER,
  IdempotencyStore,
  MISSING_KEY_MESSAGE,
  bodyHash,
} from './idempotency';
import {
  animalDetail,
  calvingsFor,
  damCandidates,
  herd,
  duplicateCandidates,
  identifierValues,
  linkCandidates,
} from './reads';
import { dayBoard } from './overview';
import { rebuild } from './projectStore';
import { snapshot } from './store';
import { checkSnapshot, labourReport } from './invariants';
import { groupByAnimal, intervalReport, precisionHistogram } from './intervals';
import { farmToday } from './time';
import type { Db } from './schema';
import type { BenefitInput, WagePeriodEntryInput } from './payroll';
import type {
  DestinationKind,
  EngagementKind,
  PaymentMethod,
  Provenance,
  RegistrySex,
  SourceForm,
} from './types';
import { SOURCE_FORMS } from './types';

type Body = Record<string, unknown>;

function body(req: Request): Body {
  const b = req.body as unknown;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) {
    throw new RegistryError('invalid_payload', 'the request body must be a JSON object');
  }
  return b as Body;
}

function str(b: Body, key: string): string | null {
  const v = b[key];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') {
    throw new RegistryError('invalid_payload', `${key} must be a string`, key);
  }
  return v;
}

function requireStr(b: Body, key: string): string {
  const v = str(b, key);
  if (v === null) throw new RegistryError('invalid_payload', `${key} is required`, key);
  return v;
}

/**
 * Provenance from the body.
 *
 * `observed_by` is read but NEVER defaulted -- not to the session person, not
 * to `recorded_by`. Leaving it blank is the cheap path and asserting a witness
 * takes a deliberate act, the same shape as precision-before-date: the honest
 * thing is the default, and the claim requires doing something.
 */
function provenance(b: Body): Provenance {
  const form = requireStr(b, 'source_form');
  if (!(SOURCE_FORMS as readonly string[]).includes(form)) {
    throw new RegistryError(
      'invalid_payload',
      `source_form must be one of ${SOURCE_FORMS.join(' | ')}, got '${form}'`,
      'source_form',
    );
  }
  return {
    source_form: form as SourceForm,
    source_ref: str(b, 'source_ref'),
    observed_by: str(b, 'observed_by'),
    recorded_by: requireStr(b, 'recorded_by'),
  };
}

/**
 * `date_precision` is required and never defaulted, exactly as it is at every
 * other boundary. The form makes submitting without one impossible; this is
 * what makes it true for any client.
 */
function requirePrecision(b: Body, key = 'date_precision'): string {
  const v = str(b, key);
  if (v === null) {
    throw new RegistryError(
      'precision_not_defaulted',
      `${key} is required and is never defaulted. A default is how 'day' gets applied to a ` +
        `guess. One of: day | month | year | estimated -- state 'year' or 'estimated' if ` +
        `that is what you know.`,
      key,
    );
  }
  return v;
}

function asOfFrom(b: Body): string {
  return str(b, 'as_of') ?? farmToday();
}

function num(b: Body, key: string): number | null {
  const v = b[key];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new RegistryError('invalid_payload', `${key} must be a number`, key);
  }
  return v;
}

function requireNum(b: Body, key: string): number {
  const v = num(b, key);
  if (v === null) throw new RegistryError('invalid_payload', `${key} is required`, key);
  return v;
}

/**
 * A boolean that is REQUIRED and never coerced.
 *
 * `standing` and `billable` decide whether the daily sheet demands an answer
 * and whether money follows the milk. A missing one silently becoming `false`
 * would turn off the sheet's only completeness guarantee, so a non-boolean is
 * refused rather than read as falsy.
 */
function requireBool(b: Body, key: string): boolean {
  const v = b[key];
  if (typeof v !== 'boolean') {
    throw new RegistryError(
      'invalid_payload',
      `${key} must be true or false, got ${JSON.stringify(v)}`,
      key,
    );
  }
  return v;
}

function optBool(b: Body, key: string): boolean | undefined {
  const v = b[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') {
    throw new RegistryError(
      'invalid_payload',
      `${key} must be true or false, got ${JSON.stringify(v)}`,
      key,
    );
  }
  return v;
}

function sessionOf(v: unknown): 'morning' | 'evening' {
  if (v !== 'morning' && v !== 'evening') {
    throw new RegistryError(
      'invalid_payload',
      `session must be morning | evening, got ${JSON.stringify(v)}`,
      'session',
    );
  }
  return v;
}

/** Wrap a handler so a RegistryError becomes a 400 and nothing else does. */
function handle(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    try {
      fn(req, res);
    } catch (e) {
      if (isRegistryError(e)) {
        res.status(e.code === 'feed_conflict' ? 409 : 400).json(e.toWire());
        return;
      }
      throw e; // a bug: Express turns this into a 500, which is what it is
    }
  };
}

/**
 * `handle`, plus replay protection. Every route that APPENDS AN EVENT uses this.
 *
 * A missing key is REFUSED, not waved through. A silently unprotected write is
 * the exact failure this exists to close, and nothing in the repo needs keyless
 * writes: the CLI does not go through these routes at all -- add.ts, calve.ts,
 * event.ts and correct.ts call the domain functions directly against the `db`
 * singleton -- so the only callers are the entry UI and tests.
 *
 * The success capture wraps `res.json` rather than sitting after the handler,
 * because better-sqlite3 is synchronous and these handlers respond inline;
 * there is no completion callback to hang it off. `res.statusCode` is already
 * set by the time `.json()` runs, since `res.status(201).json(x)` sets it
 * first, which is what makes the 2xx test here correct.
 */
function write(store: IdempotencyStore, fn: (req: Request, res: Response) => void) {
  const inner = handle(fn);
  return (req: Request, res: Response): void => {
    const key = req.header(IDEMPOTENCY_HEADER)?.trim();
    if (key === undefined || key.length === 0) {
      res
        .status(400)
        .json(
          new RegistryError(
            'missing_idempotency_key',
            MISSING_KEY_MESSAGE,
            IDEMPOTENCY_HEADER,
          ).toWire(),
        );
      return;
    }

    const hash = bodyHash(req.body);
    const replayed = store.get(key, hash);
    if (replayed !== undefined) {
      // The ORIGINAL response, byte for byte, and nothing written. Not a 409:
      // the caller asked for a state that already holds, and telling it so with
      // an error would make every retry path have to special-case success.
      res.status(replayed.status).json(replayed.body);
      return;
    }

    const send = res.json.bind(res);
    res.json = (payload: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        store.remember(key, hash, { status: res.statusCode, body: payload });
      }
      return send(payload);
    };

    inner(req, res);
  };
}

export function registryRouter(db: Db): express.Router {
  const router = express.Router();

  // Per-router, not module-level. registryRouter is a FACTORY precisely so the
  // harness can serve an `:memory:` database, and a shared store would let one
  // router replay a response describing rows in the other's database.
  const replays = new IdempotencyStore();

  // Feed uses the existing write gate, with durable key/body binding confined
  // to this domain. Failed attempts remain editable; successful keys are immutable.
  const feedWrite = (fn: (req: Request) => unknown) => write(new IdempotencyStore(), (req, res) => {
    const result = db.transaction(() => {
      const key = req.header(IDEMPOTENCY_HEADER)!.trim();
      const hash = bodyHash({ path: req.path, body: req.body });
      const prior = db.prepare('SELECT hash, response FROM registry_feed_requests WHERE id=?').get(key) as {hash:string;response:string}|undefined;
      if (prior) {
        if(prior.hash !== hash) throw new RegistryError('feed_conflict','This successful request key was already used with different content. Reload and review the saved record.');
        return JSON.parse(prior.response) as unknown;
      }
      const response = fn(req);
      db.prepare('INSERT INTO registry_feed_requests VALUES (?,?,?)').run(key,hash,JSON.stringify(response));
      return response;
    }).immediate();
    res.json(result);
  });
  router.get('/feed/recipients', handle((req,res) => res.json(feedRecipients(db,String(req.query.on ?? farmToday())))));
  router.get('/feed/history', handle((req,res) => res.json(feedHistory(db,String(req.query.from),String(req.query.to)))));
  router.get('/feed/overview', handle((req,res) => {
    const first = feedList(db,'daily').map(r=>String(r.on)).sort()[0];
    res.json(feedOverview(db,String(req.query.from ?? first ?? farmToday()),String(req.query.to ?? farmToday())));
  }));
  router.get('/feed/daily/on/:on', handle((req,res) => res.json(feedDaily(db,req.params.on))));
  for (const entity of ['items','crops','expenses','purchases','daily'] as FeedEntity[]) {
    router.get('/feed/'+entity, handle((_req,res) => res.json(feedList(db,entity))));
    router.get('/feed/'+entity+'/:id', handle((req,res) => {
      const record = feedGet(db,entity,req.params.id);
      res.json(entity==='crops' ? {...record, expenses:feedList(db,'expenses').filter(e=>e.crop_id===record.id), supply_days:cropDays(db,record.id)} : record);
    }));
    router.get('/feed/'+entity+'/:id/revisions', handle((req,res) => res.json(db.prepare('SELECT * FROM registry_feed_revisions WHERE entity=? AND entity_id=? ORDER BY revision').all(entity,req.params.id))));
    router.post('/feed/'+entity, feedWrite(req => feedSave(db,entity,object(req.body))));
    router.post('/feed/'+entity+'/:id', feedWrite(req => feedSave(db,entity,object(req.body),req.params.id)));
    router.post('/feed/'+entity+'/:id/delete', feedWrite(req => feedRemove(db,entity,req.params.id,object(req.body))));
  }

  // --- reads ---------------------------------------------------------------

  router.get(
    '/animals',
    handle((_req, res) => {
      res.json({ animals: herd(db) });
    }),
  );

  router.get(
    '/animals/:id',
    handle((req, res) => {
      const detail = animalDetail(db, req.params.id);
      if (!detail) {
        res
          .status(404)
          .json(
            new RegistryError(
              'unknown_animal',
              `unknown registry animal '${req.params.id}'`,
              'animal_id',
            ).toWire(),
          );
        return;
      }
      res.json(detail);
    }),
  );

  router.get(
    '/animals/:id/calvings',
    handle((req, res) => {
      res.json({ calvings: calvingsFor(db, req.params.id) });
    }),
  );

  /** One animal's yield history, each row's lactation derived rather than stored. */
  router.get(
    '/animals/:id/milkings',
    handle((req, res) => {
      res.json({ milkings: milkingsForAnimal(db, req.params.id) });
    }),
  );

  /**
   * The milking roster for one session -- who was in milk on that date.
   *
   * Derived from the LACTATION ROWS rather than from the status projection, so
   * opening a past date shows who was in milk THEN. Entering yesterday evening's
   * session is an ordinary thing to do.
   */
  router.get(
    '/milking/roster',
    handle((req, res) => {
      const on = typeof req.query.on === 'string' ? req.query.on : farmToday();
      const session = req.query.session === 'evening' ? 'evening' : 'morning';
      res.json(milkingRoster(db, { occurred_on: on, session }));
    }),
  );

  /** Link-mode picker. Includes ineligible animals, each with its reason. */
  router.get(
    '/link-candidates',
    handle((req, res) => {
      const damId = typeof req.query.dam === 'string' ? req.query.dam : undefined;
      const calfSex =
        req.query.calf_sex === 'female' || req.query.calf_sex === 'male'
          ? (req.query.calf_sex as RegistrySex)
          : undefined;
      const occurredOn = typeof req.query.occurred_on === 'string' ? req.query.occurred_on : undefined;
      const datePrecision =
        typeof req.query.date_precision === 'string'
          ? (req.query.date_precision as never)
          : undefined;
      res.json({
        candidates: linkCandidates(db, { damId, calfSex, occurredOn, datePrecision }),
      });
    }),
  );

  /**
   * Previously-used values for the free-text identifier fields, for a datalist.
   * Suggestions, never a constraint -- a new name must stay typeable.
   */
  /**
   * Animals that might already be the one being entered. A SOFT signal: this
   * route judges nothing and blocks nothing, and no write consults it.
   *
   * Answers `[]` for an empty query rather than returning the whole herd, so a
   * form that fires on every keystroke gets nothing until something is typed.
   */
  router.get(
    '/duplicate-candidates',
    handle((req, res) => {
      const q = req.query;
      const one = (k: string): string | null =>
        typeof q[k] === 'string' && q[k] !== '' ? (q[k] as string) : null;
      res.json({
        candidates: duplicateCandidates(db, {
          name: one('name'),
          post_no: one('post_no'),
          tag_no: one('tag_no'),
          sex: q.sex === 'female' || q.sex === 'male' ? (q.sex as RegistrySex) : undefined,
          exclude_id: one('exclude_id') ?? undefined,
        }),
      });
    }),
  );

  router.get(
    '/identifier-values',
    handle((_req, res) => {
      res.json(identifierValues(db));
    }),
  );

  router.get(
    '/dam-candidates',
    handle((_req, res) => {
      res.json({ candidates: damCandidates(db) });
    }),
  );

  /**
   * Which database this router writes to. Answered the SAME WAY on the harness
   * and on the real server, and that symmetry is the whole point.
   *
   * Before this, a client could only ask "am I on the harness?" and only by the
   * ABSENCE of the harness's own `/api/harness` -- and an absence is a bad
   * signal for the dangerous direction. A 404 from the real server, an older
   * build, and an unreachable server all look identical, so nothing ever stated
   * "these writes are real" affirmatively; the operator was asked to notice a
   * banner that was not there.
   *
   * `memory` is the discriminator rather than the path, because an in-memory
   * database CANNOT be the real registry: nothing in it survives the process.
   * The path is reported too, since it is the fact that matters if the deferred
   * two-file design ever lands (Decision 1, "When two database files come back")
   * -- at that point "not the harness" stops being the same claim as "dairy.db".
   */
  router.get(
    '/storage',
    handle((_req, res) => {
      res.json({ storage: db.name, memory: db.memory === true });
    }),
  );

  /**
   * What still needs recording today -- the landing screen.
   *
   * Composed from the read models that already exist, on the server, so "this
   * session is done" means the same thing here as on the screen that records
   * it. Six client round trips would each have been a second implementation of
   * a rule that lives in one place.
   */
  router.get(
    '/today',
    handle((req, res) => {
      const on = typeof req.query.on === 'string' ? req.query.on : farmToday();
      res.json(dayBoard(db, on));
    }),
  );

  /** Everything verify:registry reports, for checking your own work in the UI. */
  router.get(
    '/verification',
    handle((req, res) => {
      const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : farmToday();
      const snap = snapshot(db);
      res.json({
        as_of: asOf,
        counts: {
          animals: snap.animals.length,
          events: snap.events.length,
          lactations: snap.lactations.length,
          milkings: snap.milkings.length,
        },
        violations: [...checkSnapshot(snap, asOf), ...checkFeed(db)],
        histogram: precisionHistogram(snap.events),
        intervals: intervalReport(groupByAnimal(snap.events)),
        milking: milkingReport(snap.milkings, snap.lactations),
        // A REPORT, not violations -- every line fires on rows the farm asked to
        // be able to write, so /check must render them differently or people
        // learn to ignore the page. See REGISTRY_PAYROLL.md §13.
        labour: labourReport(snap, asOf),
      });
    }),
  );

  // --- writes --------------------------------------------------------------

  router.post(
    '/animals',
    write(replays, (req, res) => {
      const b = body(req);
      const result = addAcquiredAnimal(db, {
        sex: requireStr(b, 'sex') as RegistrySex,
        name: str(b, 'name'),
        species: str(b, 'species'),
        acquired_on: requireStr(b, 'acquired_on'),
        date_precision: requirePrecision(b) as never,
        birth_on: str(b, 'birth_on'),
        birth_precision: str(b, 'birth_precision') as never,
        from: str(b, 'from'),
        post_no: str(b, 'post_no'),
        tag_no: str(b, 'tag_no'),
        notes: str(b, 'notes'),
        provenance: provenance(b),
        asOf: asOfFrom(b),
      });
      res.status(201).json({ ...result, animal: animalDetail(db, result.animal_id) });
    }),
  );

  router.post(
    '/events',
    write(replays, (req, res) => {
      const b = body(req);
      const animalId = requireStr(b, 'animal_id');
      const result = appendLifeEvent(db, {
        animal_id: animalId,
        type: requireStr(b, 'type') as never,
        occurred_on: requireStr(b, 'occurred_on'),
        occurred_time: str(b, 'occurred_time'),
        date_precision: requirePrecision(b) as never,
        reason: str(b, 'reason'),
        to: str(b, 'to'),
        cause: str(b, 'cause'),
        text: str(b, 'text'),
        notes: str(b, 'notes'),
        provenance: provenance(b),
        asOf: asOfFrom(b),
        allow_after_departure: b.allow_after_departure === true,
        override_reason: str(b, 'override_reason'),
      });
      res.status(201).json({ ...result, animal: animalDetail(db, animalId) });
    }),
  );

  router.post(
    '/calvings',
    write(replays, (req, res) => {
      const b = body(req);
      const damId = requireStr(b, 'dam_id');
      // `calf_id` present => link mode. Absent => mint mode. The form asks this
      // as an explicit choice rather than inferring it from a blank field.
      const existing = str(b, 'calf_id');
      const result = recordCalving(db, {
        dam_id: damId,
        occurred_on: requireStr(b, 'occurred_on'),
        occurred_time: str(b, 'occurred_time'),
        date_precision: requirePrecision(b) as never,
        calf: {
          existing_id: existing ?? undefined,
          sex: requireStr(b, 'calf_sex') as RegistrySex,
          name: str(b, 'calf_name'),
          outcome: requireStr(b, 'outcome') as never,
        },
        sire_ref: str(b, 'sire_ref'),
        assistance: str(b, 'assistance') as never,
        notes: str(b, 'notes'),
        provenance: provenance(b),
        asOf: asOfFrom(b),
        allow_near_duplicate: b.allow_near_duplicate === true,
        override_reason: str(b, 'override_reason'),
      });
      res.status(201).json({
        ...result,
        dam: animalDetail(db, damId),
        calf: animalDetail(db, result.calf_id),
      });
    }),
  );

  router.post(
    '/calvings/:eventId/correction',
    write(replays, (req, res) => {
      const b = body(req);
      const result = correctCalving(db, {
        calving_event_id: req.params.eventId,
        occurred_on: requireStr(b, 'occurred_on'),
        occurred_time: str(b, 'occurred_time'),
        date_precision: requirePrecision(b) as never,
        assistance: b.assistance === undefined ? undefined : (str(b, 'assistance') as never),
        notes: b.notes === undefined ? undefined : str(b, 'notes'),
        provenance: provenance(b),
        asOf: asOfFrom(b),
        allow_near_duplicate: b.allow_near_duplicate === true,
        override_reason: str(b, 'override_reason'),
      });
      res.status(201).json({
        ...result,
        dam: animalDetail(db, result.dam_id),
        calf: animalDetail(db, result.calf_id),
      });
    }),
  );

  /**
   * A whole milking session, all rows or none.
   *
   * Keyed like every other write. The replay case is not hypothetical here: the
   * roster is a dozen numbers typed in one go, and a double-submit or a retry
   * over a flaky connection would otherwise re-run an upsert whose `recorded_at`
   * has moved -- writing a second, indistinguishable version of the same
   * session.
   */
  router.post(
    '/milking/session',
    write(replays, (req, res) => {
      const b = body(req);
      const raw = b.entries;
      if (!Array.isArray(raw)) {
        throw new RegistryError('invalid_payload', 'entries must be an array', 'entries');
      }
      const result = saveMilkingSession(db, {
        occurred_on: requireStr(b, 'occurred_on'),
        session: requireStr(b, 'session') as never,
        occurred_time: str(b, 'occurred_time'),
        observed_by: str(b, 'observed_by'),
        entries: raw as never[],
        provenance: provenance(b),
      });
      res.status(201).json(result);
    }),
  );

  /**
   * Remove a session, or one animal's row in it.
   *
   * The repair path for a session entered against the wrong date, which
   * update-in-place leaves no other way to fix. Deliberately narrow -- a date
   * and a session, never a range -- so there is no shape of call that clears
   * history. This is the only DELETE any registry route exposes, and it reaches
   * the one registry table that is a measurement rather than a record of what
   * happened; see milking.ts.
   */
  router.post(
    '/milking/session/delete',
    write(replays, (req, res) => {
      const b = body(req);
      const removed = deleteMilkings(db, {
        occurred_on: requireStr(b, 'occurred_on'),
        session: requireStr(b, 'session') as never,
        animal_id: str(b, 'animal_id') ?? undefined,
      });
      res.status(200).json({ removed });
    }),
  );

  // --- destinations, prices, dispatch and the ledger -----------------------
  //
  // docs/REGISTRY_SALES.md. Note that NONE of these touches an animal: they are
  // the first registry routes that do not, which is why the sales half works
  // against an empty herd.

  /** Every destination, with the price in force on `as_of` (default today). */
  router.get(
    '/destinations',
    handle((req, res) => {
      const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : farmToday();
      res.json({ as_of: asOf, destinations: destinationList(db, asOf) });
    }),
  );

  /** One destination's statement: dispatches and payments by month, plus the balance. */
  router.get(
    '/destinations/:id',
    handle((req, res) => {
      const s = statement(db, req.params.id);
      if (!s) {
        res
          .status(404)
          .json(
            new RegistryError(
              'unknown_destination',
              `unknown destination '${req.params.id}'`,
              'destination_id',
            ).toWire(),
          );
        return;
      }
      res.json({ ...s, prices: pricesFor(db, req.params.id) });
    }),
  );

  /** Balances for the billable destinations. Home is absent, not zero. */
  router.get(
    '/balances',
    handle((_req, res) => {
      res.json({ balances: balances(db) });
    }),
  );

  router.post(
    '/destinations',
    write(replays, (req, res) => {
      const b = body(req);
      const kind = requireStr(b, 'kind') as DestinationKind;
      res.status(201).json(
        addDestination(db, {
          name: requireStr(b, 'name'),
          kind,
          // `billable` defaults to true for every kind but home, where the
          // schema forbids anything else. `standing` is REQUIRED: it decides
          // whether the sheet demands an answer, which is a question about how
          // the farm works rather than a fact about the buyer.
          billable: optBool(b, 'billable'),
          standing: requireBool(b, 'standing'),
          contact: str(b, 'contact'),
          started_on: requireStr(b, 'started_on'),
          ended_on: str(b, 'ended_on'),
          note: str(b, 'note'),
          // REQUIRED for `staff` and refused for every other kind. It was
          // missing here while addDestination() supported it, so a staff milk
          // allowance could not be created over HTTP at all -- the fixtures
          // call the domain function directly, so nothing caught it until the
          // harness seed, which goes through the routes on purpose.
          person_id: str(b, 'person_id'),
          recorded_by: requireStr(b, 'recorded_by'),
        }),
      );
    }),
  );

  /**
   * Amend a destination.
   *
   * `kind`, `billable` and `started_on` are absent on purpose -- see
   * updateDestination(). A destination set up wrongly is closed and a new one
   * opened, which is also what actually happened if the milk was going
   * somewhere else.
   */
  router.post(
    '/destinations/:id',
    write(replays, (req, res) => {
      const b = body(req);
      res.json(
        updateDestination(db, req.params.id, {
          name: str(b, 'name') ?? undefined,
          standing: optBool(b, 'standing'),
          contact: b.contact === undefined ? undefined : str(b, 'contact'),
          ended_on: b.ended_on === undefined ? undefined : str(b, 'ended_on'),
          note: b.note === undefined ? undefined : str(b, 'note'),
          recorded_by: requireStr(b, 'recorded_by'),
        }),
      );
    }),
  );

  /**
   * Agree a price from a date.
   *
   * TWO NUMBERS, and `price_unit_litres` is required with no default. A rate of
   * Rs 7,000 per 40 litres is (700000, 40); a default of 1 would store the same
   * agreement as forty times the price and it would still look like a price.
   */
  router.post(
    '/destinations/:id/prices',
    write(replays, (req, res) => {
      const b = body(req);
      res.status(201).json(
        setPrice(db, {
          destination_id: req.params.id,
          effective_from: requireStr(b, 'effective_from'),
          price_minor: requireNum(b, 'price_minor'),
          price_unit_litres: requireNum(b, 'price_unit_litres'),
          note: str(b, 'note'),
          recorded_by: requireStr(b, 'recorded_by'),
        }),
      );
    }),
  );

  /**
   * The dispatch sheet for one session -- who milk went to on that date.
   *
   * Derived from the destinations' ACTIVE RANGES rather than a current status,
   * so opening a past date shows who was buying THEN. Same argument as the
   * milking roster reading lactation rows.
   */
  router.get(
    '/dispatch/sheet',
    handle((req, res) => {
      const on = typeof req.query.on === 'string' ? req.query.on : farmToday();
      const session = req.query.session === 'evening' ? 'evening' : 'morning';
      res.json(dispatchSheet(db, { occurred_on: on, session }));
    }),
  );

  /**
   * Save a whole session. ALL ROWS OR NONE, and keyed like every other write.
   *
   * The replay case is not hypothetical: a double-submit would otherwise re-run
   * an upsert whose `recorded_at` has moved, writing a second indistinguishable
   * version of the same session.
   */
  router.post(
    '/dispatch/session',
    write(replays, (req, res) => {
      const b = body(req);
      const raw = b.entries;
      if (!Array.isArray(raw)) {
        throw new RegistryError('invalid_payload', 'entries must be an array', 'entries');
      }
      res.status(201).json(
        saveDispatchSession(db, {
          occurred_on: requireStr(b, 'occurred_on'),
          session: sessionOf(b.session),
          occurred_time: str(b, 'occurred_time'),
          observed_by: str(b, 'observed_by'),
          entries: raw as never[],
          provenance: provenance(b),
        }),
      );
    }),
  );

  /**
   * Remove a session, or one destination's row in it.
   *
   * The repair path for a session entered against the wrong date. Deliberately
   * narrow -- a date and a session, never a range. The second DELETE any
   * registry route exposes, and it reaches a measurement-shaped table for the
   * same reason the first one does.
   */
  router.post(
    '/dispatch/session/delete',
    write(replays, (req, res) => {
      const b = body(req);
      res.json({
        removed: deleteDispatches(db, {
          occurred_on: requireStr(b, 'occurred_on'),
          session: sessionOf(b.session),
          destination_id: str(b, 'destination_id') ?? undefined,
        }),
      });
    }),
  );

  /**
   * Produced against dispatched, over a range.
   *
   * `gap_pct` comes back NULL whenever production is incomplete, with
   * `gap_pct_withheld_because` saying which. That escalates past a caveat field
   * on purpose: this number ends up in front of a buyer, and a caveat can be
   * dropped by a consumer while a null cannot be quoted.
   */
  router.get(
    '/reconcile',
    handle((req, res) => {
      const to = typeof req.query.to === 'string' ? req.query.to : farmToday();
      const from = typeof req.query.from === 'string' ? req.query.from : to;
      res.json(reconcileRange(db, from, to));
    }),
  );

  /** Money received, or a signed adjustment that has to say why. */
  router.post(
    '/payments',
    write(replays, (req, res) => {
      const b = body(req);
      res.status(201).json(
        recordPayment(db, {
          destination_id: requireStr(b, 'destination_id'),
          occurred_on: requireStr(b, 'occurred_on'),
          amount_minor: requireNum(b, 'amount_minor'),
          method: requireStr(b, 'method') as PaymentMethod,
          reference: str(b, 'reference'),
          observed_by: str(b, 'observed_by'),
          note: str(b, 'note'),
          recorded_by: requireStr(b, 'recorded_by'),
        }),
      );
    }),
  );

  /**
   * Remove one payment, by id.
   *
   * A payment entered against the wrong buyer has no other repair: correcting
   * it in place would move money between two people's balances without either
   * statement saying so.
   */
  router.post(
    '/payments/:id/delete',
    write(replays, (req, res) => {
      res.json({ removed: deletePayment(db, req.params.id) });
    }),
  );

  // -------------------------------------------------------------------------
  // Labour: people, engagements, packages, the run and the wage ledger
  // (docs/REGISTRY_PAYROLL.md §10)
  // -------------------------------------------------------------------------

  /** Everybody on file, with their balance. People with no open stint are
   *  included and flagged rather than hidden -- somebody who has left may still
   *  be owed a final payment, and hiding them is how it gets forgotten. */
  router.get(
    '/people',
    handle((req, res) => {
      const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : farmToday();
      res.json({ as_of: asOf, people: wageBalances(db, asOf) });
    }),
  );

  /** One person's statement: stints, package, wage periods, payments, balance. */
  router.get(
    '/people/:id',
    handle((req, res) => {
      const st = wageStatement(db, req.params.id);
      if (!st) {
        res
          .status(404)
          .json(
            new RegistryError('unknown_person', `unknown person '${req.params.id}'`, 'person_id')
              .toWire(),
          );
        return;
      }
      const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : farmToday();
      // The package as it stands on each stint, so the screen can show what
      // somebody is on without a second round trip per engagement.
      const packages = st.engagements.map((e) => ({
        engagement_id: e.id,
        terms: termsFor(db, e.id).map((t) => ({ ...t, benefits: benefitsFor(db, t.id) })),
        current: packageOn(db, e.id, asOf),
      }));
      res.json({ ...st, as_of: asOf, packages });
    }),
  );

  router.post(
    '/people',
    write(replays, (req, res) => {
      const b = body(req);
      res.status(201).json(
        addPerson(db, {
          identifier: requireStr(b, 'identifier'),
          name: str(b, 'name'),
          contact: str(b, 'contact'),
          note: str(b, 'note'),
          recorded_by: requireStr(b, 'recorded_by'),
        }),
      );
    }),
  );

  /**
   * Amend a person. `identifier` is accepted only so it can be REFUSED with an
   * explanation -- every record naming them stores it as text and the event log
   * cannot be rewritten, so renaming would orphan all of it.
   */
  router.post(
    '/people/:id',
    write(replays, (req, res) => {
      const b = body(req);
      res.json(
        updatePerson(db, req.params.id, {
          name: str(b, 'name'),
          contact: str(b, 'contact'),
          note: str(b, 'note'),
          identifier: str(b, 'identifier') ?? undefined,
        }),
      );
    }),
  );

  /** Open a stint. Overlapping an existing one is deliberately NOT refused. */
  router.post(
    '/people/:id/engagements',
    write(replays, (req, res) => {
      const b = body(req);
      res.status(201).json(
        addEngagement(db, {
          person_id: req.params.id,
          kind: requireStr(b, 'kind') as EngagementKind,
          role: str(b, 'role'),
          started_on: requireStr(b, 'started_on'),
          ended_on: str(b, 'ended_on'),
          end_reason: str(b, 'end_reason'),
          note: str(b, 'note'),
          recorded_by: requireStr(b, 'recorded_by'),
        }),
      );
    }),
  );

  /** Amend a stint -- typically to close it. `kind`, `person_id` and
   *  `started_on` are not amendable; a new stint is the repair. */
  router.post(
    '/engagements/:id',
    write(replays, (req, res) => {
      const b = body(req);
      res.json(
        updateEngagement(db, req.params.id, {
          role: str(b, 'role'),
          ended_on: str(b, 'ended_on'),
          end_reason: str(b, 'end_reason'),
          note: str(b, 'note'),
        }),
      );
    }),
  );

  router.get(
    '/engagements/:id/terms',
    handle((req, res) => {
      res.json({
        terms: termsFor(db, req.params.id).map((t) => ({ ...t, benefits: benefitsFor(db, t.id) })),
      });
    }),
  );

  /**
   * A new package agreement, with its in-kind lines, effective from a date.
   *
   * The benefits travel WITH the term because the package is the unit that
   * changes -- a raise usually moves the milk allowance too, and dating the
   * parts separately is how they drift out of step.
   */
  router.post(
    '/engagements/:id/terms',
    write(replays, (req, res) => {
      const b = body(req);
      res.status(201).json(
        setTerm(db, {
          engagement_id: req.params.id,
          effective_from: requireStr(b, 'effective_from'),
          cash_minor: requireNum(b, 'cash_minor'),
          cash_period: requireStr(b, 'cash_period') as 'month' | 'day',
          benefits: Array.isArray(b.benefits) ? (b.benefits as BenefitInput[]) : [],
          note: str(b, 'note'),
          recorded_by: requireStr(b, 'recorded_by'),
        }),
      );
    }),
  );

  /**
   * Correct a package typed wrong and caught immediately.
   *
   * Safe for the reason correcting a price is safe: every wage period holds its
   * own figure, so this moves only the default offered to future entry. A
   * genuine change of agreement is a NEW term with a later date.
   */
  router.post(
    '/terms/:id/correct',
    write(replays, (req, res) => {
      const b = body(req);
      res.json(
        correctTerm(db, req.params.id, {
          effective_from: requireStr(b, 'effective_from'),
          cash_minor: requireNum(b, 'cash_minor'),
          cash_period: requireStr(b, 'cash_period') as 'month' | 'day',
          benefits: Array.isArray(b.benefits) ? (b.benefits as BenefitInput[]) : [],
          note: str(b, 'note'),
          recorded_by: requireStr(b, 'recorded_by'),
        }),
      );
    }),
  );

  /** The derived run for a period: who must be answered, and what dihari days
   *  are already in. */
  router.get(
    '/payroll/run',
    handle((req, res) => {
      const to = typeof req.query.to === 'string' ? req.query.to : farmToday();
      const from = typeof req.query.from === 'string' ? req.query.from : to;
      // `as_of` is overridable so a test can open a mid-month run at a fixed
      // date; it defaults to farm-local today, which is what clips a per-day
      // allowance to the days that have actually happened.
      const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : farmToday();
      res.json(payrollRun(db, from, to, asOf));
    }),
  );

  /** Save a whole run. All rows or none, and every permanent engagement in the
   *  period must have a figure. */
  router.post(
    '/payroll/run',
    write(replays, (req, res) => {
      const b = body(req);
      res.status(201).json(
        saveRun(db, {
          from_on: requireStr(b, 'from_on'),
          to_on: requireStr(b, 'to_on'),
          entries: Array.isArray(b.entries) ? (b.entries as WagePeriodEntryInput[]) : [],
          provenance: provenance(b),
        }),
      );
    }),
  );

  /**
   * Remove wage periods, by explicit id.
   *
   * Narrow on purpose: a run entered against the wrong month has no other
   * repair, because UNIQUE (engagement_id, from_on) means the wrong dates keep
   * holding the rows until they are removed.
   */
  router.post(
    '/payroll/run/delete',
    write(replays, (req, res) => {
      const b = body(req);
      const ids = Array.isArray(b.ids) ? (b.ids as unknown[]) : [];
      if (ids.length === 0 || !ids.every((i) => typeof i === 'string')) {
        throw new RegistryError('invalid_payload', 'ids must be a non-empty array of strings', 'ids');
      }
      res.json({ removed: deleteWagePeriods(db, ids as string[]) });
    }),
  );

  /** Money paid to somebody, or a signed adjustment that has to say why. An
   *  advance is an ordinary payment -- the balance simply goes negative. */
  router.post(
    '/wage-payments',
    write(replays, (req, res) => {
      const b = body(req);
      res.status(201).json(
        recordWagePayment(db, {
          person_id: requireStr(b, 'person_id'),
          occurred_on: requireStr(b, 'occurred_on'),
          amount_minor: requireNum(b, 'amount_minor'),
          method: requireStr(b, 'method') as PaymentMethod,
          reference: str(b, 'reference'),
          observed_by: str(b, 'observed_by'),
          note: str(b, 'note'),
          recorded_by: requireStr(b, 'recorded_by'),
        }),
      );
    }),
  );

  router.post(
    '/wage-payments/:id/delete',
    write(replays, (req, res) => {
      res.json({ removed: deleteWagePayment(db, req.params.id) });
    }),
  );

  /**
   * The one POST that is NOT replay-protected, and the reason is not an
   * oversight: a rebuild appends nothing. It recomputes projection tables from
   * the event log, so running it twice lands on the same rows -- that is
   * invariant 0, idempotence, which the suite already asserts. Requiring a key
   * here would be ceremony over a route that is idempotent by construction.
   */
  router.post(
    '/rebuild',
    handle((req, res) => {
      const b = body(req);
      const asOf = asOfFrom(b);
      res.json({ as_of: asOf, ...rebuild(db, { asOf, animalId: str(b, 'animal_id') ?? undefined }) });
    }),
  );

  return router;
}
