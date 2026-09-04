// Registry read tools (Cycle 9; see docs/REGISTRY_TOOLS.md).
//
// The first tools in this repo that read a `registry_*` table -- facts about
// actual animals rather than the seeded demo herd. Reads only, and unrestricted:
// REGISTRY.md's deferral says "reads unrestricted, writes confirmation-gated",
// and the writes are a later cycle for the reasons in REGISTRY_TOOLS.md §"What
// we're NOT doing".
//
// ---------------------------------------------------------------------------
// EVERYTHING HERE TAKES A HANDLE; THIS FILE IMPORTS NO `../db`
// ---------------------------------------------------------------------------
// `registryReadExecutors(db)` is a factory, for the same reason
// `registryRouter(db)` is one: a test must be able to build the digest for a
// fixture herd on `:memory:` without reading the real registry to find out what
// a digest looks like.
//
// The singleton is reached ONE level up, in index.ts, which already imports it.
// That is not fussiness about layering -- it is what keeps `npm test` from ever
// opening dairy.db. No test in the enumerated suite imports `../db` today, so
// running the tests neither creates nor migrates that file, and a tool module
// that bound the singleton at import time would have quietly ended that.
//
// It is also the rule registry.harness.test.ts states positively: reaching the
// singleton is a TRANSPORT decision, made in one place per transport. See
// REGISTRY_TOOLS.md §4.
//
// ---------------------------------------------------------------------------
// PRECISION IS THE PRODUCT
// ---------------------------------------------------------------------------
// Every digest here carries how well the record knows what it is reporting, and
// `get_calving_intervals` passes `intervalReport`'s `caveat` through verbatim.
// Nothing in a digest can stop a model averaging a measured interval with an
// approximate one -- that instruction is prose, and it lives in
// systemPrompt.ts's registrySection(), the same way farmSection() owns the
// "report those verdicts, do not re-litigate them" rule for camera severity.

import type { ReadToolResult, ToolError } from '@dairy/shared';
import { isRegistryError } from '../registry/errors';
import { groupByAnimal, intervalReport, intervalsForAnimal } from '../registry/intervals';
import { animalDetail, herd } from '../registry/reads';
import type { Db } from '../registry/schema';
import { allEvents, animalExists, eventsForAnimal } from '../registry/store';
import { REGISTRY_ANIMAL_STATUSES } from '../registry/types';
import type { ToolSchema } from './index';

type Args = Record<string, unknown>;

/**
 * Run a read and map a domain refusal onto a ToolError.
 *
 * `RegistryError.toWire()` IS ALREADY THE RIGHT SHAPE -- errors.ts chose
 * `error` as its wire key, and ToolError is `{ error: string, ... }`. So there
 * is no adapter and no second error vocabulary: the model gets the stable
 * `code` to reason about plus the prose that was written to teach an operator
 * what to do. See REGISTRY_TOOLS.md §9.
 *
 * The spread is not decoration. `WireError` is a declared interface, and only
 * fresh object literals get TypeScript's implicit index signature, so
 * `toWire() satisfies ToolError` is rejected even though every value it
 * produces is a valid ToolError. Spreading into a literal is the honest fix:
 * it asserts nothing and it keeps the check.
 *
 * Anything that is NOT a RegistryError is a bug and rethrows, matching
 * routes.ts's rule that a bug must not be dressed up as a validation failure.
 */
function guarded(fn: () => ReadToolResult): ReadToolResult {
  try {
    return fn();
  } catch (e: unknown) {
    if (isRegistryError(e)) return { modelDigest: { ...e.toWire() } satisfies ToolError };
    throw e;
  }
}

/** The `serial` argument, as a trimmed string. */
function serialOf(args: Args): string {
  return typeof args.serial === 'string' ? args.serial.trim() : '';
}

// ---------------------------------------------------------------------------
// list_registry_animals
// ---------------------------------------------------------------------------

/**
 * The whole herd, with derived status and birth precision per row.
 *
 * NO CAP AND NO `tooMany` FLAG, unlike search_animals (8) and get_farm_events
 * (50). The registry holds a real herd of roughly twenty animals, and returning
 * all of them is both cheaper and more honest than paginating a list the farmer
 * thinks of as one page. REGISTRY_TOOLS.md § Open items records that this is a
 * decision rather than an oversight, and what would trigger revisiting it.
 */
export function listRegistryAnimals(db: Db, args: Args): ReadToolResult {
  const status = typeof args.status === 'string' ? args.status : undefined;
  const rows = herd(db).filter((r) => (status ? r.status === status : true));

  return {
    modelDigest: {
      count: rows.length,
      animals: rows.map((r) => ({
        serial: r.id,
        name: r.name,
        sex: r.sex,
        status: r.status,
        parity: r.parity,
        origin: r.origin,
        birth_on: r.birth_on,
        // Reported beside the date, always, so the model never has to infer
        // exactness from the shape of a string: `2018-01-01` at year precision
        // means "some time in 2018", and stringifying it alone loses that.
        birth_precision: r.birth_precision,
        event_count: r.event_count,
        in_milk: r.open_lactation_id !== null,
      })),
      ...(status ? { filtered_by_status: status } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// get_registry_animal
// ---------------------------------------------------------------------------

/**
 * One animal with its whole event list, INCLUDING superseded events.
 *
 * reads.ts:101 argues inclusion for the entry UI -- "an event that simply
 * vanished would be indistinguishable from one that was never written" -- and
 * the argument holds identically for a model. One that cannot see the
 * correction cannot explain why a date changed, which is most of what a
 * corrected record is for. Every row carries `effective` and, when replaced,
 * `superseded_by_id`.
 *
 * The animal's own calving intervals come along, because "how is she doing"
 * is one question and making it two tool calls buys nothing.
 */
export function getRegistryAnimal(db: Db, args: Args): ReadToolResult {
  const serial = serialOf(args);
  const detail = animalDetail(db, serial);
  if (!detail) {
    // Hand-mapped rather than thrown: animalDetail returns null instead of
    // refusing, and this matches get_animal's existing shape for the demo herd.
    // Same `unknown_animal` code as errors.ts, keyed on `serial` -- the key is
    // what says which id space was meant.
    return { modelDigest: { error: 'unknown_animal', serial } satisfies ToolError };
  }

  const intervals = intervalsForAnimal(serial, eventsForAnimal(db, serial));

  return {
    modelDigest: {
      serial: detail.animal.id,
      name: detail.animal.name,
      sex: detail.animal.sex,
      species: detail.animal.species,
      origin: detail.animal.origin,
      status: detail.status?.status ?? null,
      parity: detail.status?.parity ?? null,
      birth_on: detail.status?.birth_on ?? null,
      birth_precision: detail.status?.birth_precision ?? null,
      in_milk: (detail.status?.open_lactation_id ?? null) !== null,
      calving_intervals: intervals.map((i) => ({
        ordinal: i.ordinal,
        from_on: i.from_on,
        to_on: i.to_on,
        days: i.days,
        quality: i.quality,
      })),
      events: detail.events.map((e) => ({
        type: e.type,
        occurred_on: e.occurred_on,
        date_precision: e.date_precision,
        payload: e.payload,
        source_form: e.source_form,
        observed_by: e.observed_by,
        effective: e.effective,
        // Present only on a replaced row, so an unremarkable timeline stays
        // unremarkable in the digest and a correction stands out in it.
        ...(e.effective ? {} : { superseded: true }),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// get_calving_intervals
// ---------------------------------------------------------------------------

/**
 * Calving intervals, for one animal or the whole herd.
 *
 * THE MEASURED/APPROXIMATE SPLIT IS THE POINT, and this tool cannot blend it
 * even by accident: `intervalReport` returns two summaries and no combined one,
 * and `summarise` takes a pre-filtered list precisely so there is no overload
 * that could be handed a mixed one (intervals.ts:70). The `caveat` is passed
 * through VERBATIM because it travels as a field for exactly this reason -- a
 * consumer has to actively drop it, and this one does not.
 */
export function getCalvingIntervals(db: Db, args: Args): ReadToolResult {
  const serial = serialOf(args);

  if (serial) {
    if (!animalExists(db, serial)) {
      return { modelDigest: { error: 'unknown_animal', serial } satisfies ToolError };
    }
    // One animal still goes through intervalReport rather than
    // intervalsForAnimal alone, so a per-animal answer carries the same two
    // summaries and the same caveat as a herd answer. A shape that changed with
    // the scope would let the caveat vanish on the narrower question.
    const report = intervalReport(groupByAnimal(eventsForAnimal(db, serial)));
    return { modelDigest: { scope: serial, ...report } };
  }

  const report = intervalReport(groupByAnimal(allEvents(db)));
  return { modelDigest: { scope: 'herd', ...report } };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
// Colocated with the executors, following reconcile.ts and farmWrites.ts (the
// recent precedent) rather than the older split that keeps the dairy and vendor
// schemas in index.ts.
//
// EVERY SCHEMA NAMES ITS ANIMAL `serial`, NEVER `animal_id`. guardIds() runs
// before every tool call and checks `animal_id` against the DEMO animals table,
// so a registry tool declaring that name would be rejected with
// `unknown_animal` before its executor ran. Two id spaces, two parameter names,
// and guardIds guards both. See REGISTRY_TOOLS.md §6.

export const REGISTRY_READ_TOOLS: ToolSchema[] = [
  {
    name: 'list_registry_animals',
    description:
      "The REAL herd from the animal registry -- the farm's actual animals, not the demo fixtures. Returns every animal with its serial (e.g. BD-0001), derived status, parity, birth date AND that date's precision, and whether it is currently in milk. Use this for any question about the animals the farm actually has. Optionally filter by status. Birth dates carry a precision: `day` is exact, `month`/`year` are known only to that granularity, and `estimated` is a guess -- never report a non-day date as exact.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: [...REGISTRY_ANIMAL_STATUSES] },
      },
    },
  },
  {
    name: 'get_registry_animal',
    description:
      "Full detail for one real animal by its registry serial (e.g. BD-0001): identity, derived status and parity, its calving intervals, and its COMPLETE event list oldest-first. Superseded events are included and marked with `superseded: true` -- those are corrections, so use them to explain why a value changed and never report a superseded row as current. Every event carries `date_precision` and the form it was recorded from.",
    input_schema: {
      type: 'object',
      required: ['serial'],
      properties: {
        serial: { type: 'string', description: 'Registry serial, e.g. BD-0001' },
      },
    },
  },
  {
    name: 'get_calving_intervals',
    description:
      "Calving intervals for one real animal (pass serial) or the whole registry herd (omit it). Returns each interval with a `quality` of `measured` (both calvings known to the day) or `approximate` (either one is not), plus SEPARATE summaries for the two -- and a `caveat` explaining why. NEVER average or compare across the two qualities and never report a single blended figure: an approximate interval from two month-precision calvings carries roughly +/-60 days, which is larger than the difference between a good interval and a bad one. Report the caveat with the numbers.",
    input_schema: {
      type: 'object',
      properties: {
        serial: {
          type: 'string',
          description: 'Registry serial, e.g. BD-0001. Omit for the whole herd.',
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

export function registryReadExecutors(
  db: Db,
): Record<string, (args: Args) => ReadToolResult> {
  return {
    list_registry_animals: (args) => guarded(() => listRegistryAnimals(db, args)),
    get_registry_animal: (args) => guarded(() => getRegistryAnimal(db, args)),
    get_calving_intervals: (args) => guarded(() => getCalvingIntervals(db, args)),
  };
}

// ---------------------------------------------------------------------------
// The registry half of the id guard
// ---------------------------------------------------------------------------

/**
 * Validate a `serial` argument against `registry_animals`.
 *
 * Lives here rather than inline in guardIds() so it can be tested in BOTH
 * directions. guardIds is bound to the singleton, which makes its accepting
 * path untestable: proving it lets `BD-0001` through would mean writing a
 * fixture animal into dairy.db, and the standing rule of the registry cycle is
 * that nothing synthetic ever touches `registry_animals` there. A guard
 * exercised only on its rejecting path is one that could reject everything and
 * still pass.
 *
 * `serial` rather than `animal_id`, and the reason is not cosmetic: guardIds
 * runs before EVERY tool call and resolves `animal_id` against the DEMO
 * `animals` table, so a registry tool declaring that name would be rejected
 * with `unknown_animal` for a serial that exists, before its executor ran.
 * Renaming alone would have left registry ids unguarded, so both halves ship
 * together. See REGISTRY_TOOLS.md §6.
 */
export function guardSerial(db: Db, args: Args): ToolError | null {
  if (typeof args.serial === 'string' && args.serial) {
    if (!animalExists(db, args.serial)) {
      return { error: 'unknown_animal', serial: args.serial };
    }
  }
  return null;
}
