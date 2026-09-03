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

import express from 'express';
import type { Request, Response } from 'express';

import { addAcquiredAnimal, appendLifeEvent } from './entry';
import { correctCalving, recordCalving } from './calving';
import { RegistryError, isRegistryError } from './errors';
import { animalDetail, calvingsFor, damCandidates, herd, linkCandidates } from './reads';
import { rebuild } from './projectStore';
import { snapshot } from './store';
import { checkSnapshot } from './invariants';
import { intervalReport, precisionHistogram } from './intervals';
import { canonicalOrder } from './project';
import { farmToday } from './time';
import type { Db } from './schema';
import type { Provenance, RegistryEvent, RegistrySex, SourceForm } from './types';
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

function groupByAnimal(events: RegistryEvent[]): Map<string, RegistryEvent[]> {
  const out = new Map<string, RegistryEvent[]>();
  for (const e of canonicalOrder(events)) {
    const list = out.get(e.animal_id);
    if (list) list.push(e);
    else out.set(e.animal_id, [e]);
  }
  return out;
}

/** Wrap a handler so a RegistryError becomes a 400 and nothing else does. */
function handle(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    try {
      fn(req, res);
    } catch (e) {
      if (isRegistryError(e)) {
        res.status(400).json(e.toWire());
        return;
      }
      throw e; // a bug: Express turns this into a 500, which is what it is
    }
  };
}

export function registryRouter(db: Db): express.Router {
  const router = express.Router();

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
        },
        violations: checkSnapshot(snap, asOf),
        histogram: precisionHistogram(snap.events),
        intervals: intervalReport(groupByAnimal(snap.events)),
      });
    }),
  );

  // --- writes --------------------------------------------------------------

  router.post(
    '/animals',
    handle((req, res) => {
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
    handle((req, res) => {
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
      });
      res.status(201).json({ ...result, animal: animalDetail(db, animalId) });
    }),
  );

  router.post(
    '/calvings',
    handle((req, res) => {
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
    handle((req, res) => {
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
      });
      res.status(201).json({
        ...result,
        dam: animalDetail(db, result.dam_id),
        calf: animalDetail(db, result.calf_id),
      });
    }),
  );

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
