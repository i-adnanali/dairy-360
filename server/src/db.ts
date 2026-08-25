import Database from 'better-sqlite3';
import path from 'node:path';
import type {
  Animal,
  Delivery,
  FarmEvent,
  FarmFlagSeverity,
  FeedInventory,
  HealthEvent,
  IngestedFarmEvent,
  Milking,
  Vendor,
} from '@dairy/shared';

// dairy.db lives next to the server package root (one level up from src once
// running via tsx, this resolves to server/dairy.db).
export const DB_PATH = path.join(__dirname, '..', 'dairy.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const SCHEMA = `
CREATE TABLE animals (
  id            TEXT PRIMARY KEY,
  tag           TEXT NOT NULL,
  name          TEXT,
  species       TEXT NOT NULL,
  breed         TEXT,
  status        TEXT NOT NULL,
  date_of_birth TEXT,
  group_name    TEXT
);

CREATE TABLE milkings (
  id           TEXT PRIMARY KEY,
  animal_id    TEXT NOT NULL REFERENCES animals(id),
  date         TEXT NOT NULL,
  session      TEXT NOT NULL,
  yield_litres REAL NOT NULL
);
CREATE INDEX idx_milkings_date ON milkings(date);
CREATE INDEX idx_milkings_animal ON milkings(animal_id);

CREATE TABLE feed_inventory (
  id                   TEXT PRIMARY KEY,
  feed_type            TEXT NOT NULL,
  quantity_kg          REAL NOT NULL,
  daily_consumption_kg REAL NOT NULL,
  reorder_threshold_kg REAL NOT NULL
);

CREATE TABLE health_events (
  id            TEXT PRIMARY KEY,
  animal_id     TEXT NOT NULL REFERENCES animals(id),
  date          TEXT NOT NULL,
  type          TEXT NOT NULL,
  notes         TEXT,
  next_due_date TEXT
);

-- Vendor / sales domain (Cycle 2 multi-agent; see docs/MULTI_AGENT.md).
-- deliveries and milkings are deliberately NOT linked by a foreign key: they
-- belong to different agents' domains and are only ever joined read-only, by
-- the reconciliation tool get_yield_vs_deliveries.
CREATE TABLE vendors (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  contact         TEXT,
  price_per_litre REAL NOT NULL,
  status          TEXT NOT NULL
);

CREATE TABLE deliveries (
  id              TEXT PRIMARY KEY,
  vendor_id       TEXT NOT NULL REFERENCES vendors(id),
  date            TEXT NOT NULL,
  litres          REAL NOT NULL,
  price_per_litre REAL NOT NULL,
  paid            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_deliveries_date ON deliveries(date);
CREATE INDEX idx_deliveries_vendor ON deliveries(vendor_id);
`;

// ---------------------------------------------------------------------------
// Farm event ingestion (Cycle 4; see docs/FARM_EVENTS.md).
//
// Deliberately NOT part of SCHEMA and NOT in resetSchema()'s DROP list. Two
// reasons: `npm run seed -w server` would otherwise wipe every ingested event,
// and the Cycle 3 regression suite calls seed() in beforeEach -- which would
// truncate farm data mid-run. IF NOT EXISTS lets this be applied at module
// load, independent of whether the dairy tables have ever been seeded (so
// ingestion works against an unseeded DB, unlike the agent endpoints).
//
// No foreign key to any dairy table. Rows are correlated to each other by
// source_event_id (the Frigate event id that both webhooks carry); that column
// is indexed but deliberately NOT unique -- Frigate sends new/update/end for
// one id, and a single Double Take POST can carry several faces.
// ---------------------------------------------------------------------------
export const FARM_SCHEMA = `
CREATE TABLE IF NOT EXISTS farm_events (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('frigate','double_take')),
  source_event_id TEXT,
  is_synthetic    INTEGER NOT NULL DEFAULT 0,
  camera_id       TEXT NOT NULL,
  zone            TEXT,
  event_type      TEXT NOT NULL CHECK (
                    event_type IN ('detection','face_match','unknown_cluster')
                  ),
  identity        TEXT,
  confidence      REAL,
  occurred_at     TEXT NOT NULL,
  ingested_at     TEXT NOT NULL,
  snapshot_ref    TEXT,
  raw_payload     TEXT NOT NULL,
  -- Classification (Cycle 5; see docs/FARM_MONITOR.md). Additive and all
  -- nullable/defaulted, so an ingested row is valid with none of them set.
  -- NOTE: because this table is CREATE TABLE IF NOT EXISTS, adding columns
  -- here does NOT alter a dairy.db that already has the table -- the local
  -- table must be dropped so this runs fresh (FARM_MONITOR.md Decision 2).
  -- flag_severity is 'notable' | 'urgent', enforced by TypeScript types and the
  -- flag_anomaly input_schema enum rather than a CHECK: per FARM_EVENTS.md
  -- Decision 3, CHECKs here are reserved for webhook bodies arriving from
  -- outside the process. These values come from our own classifier or from a
  -- model already constrained by a tool schema.
  classified_at   TEXT,                        -- ISO-8601 UTC; NULL = unexamined
  flagged         INTEGER NOT NULL DEFAULT 0,
  flag_severity   TEXT,
  flag_reason     TEXT
);
CREATE INDEX IF NOT EXISTS idx_farm_events_occurred_at ON farm_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_farm_events_zone        ON farm_events(zone);
CREATE INDEX IF NOT EXISTS idx_farm_events_identity    ON farm_events(identity);
CREATE INDEX IF NOT EXISTS idx_farm_events_source_ref  ON farm_events(source_event_id);
`;

// Applied at module load: idempotent, and every farm code path needs the table
// to exist regardless of seed state.
db.exec(FARM_SCHEMA);

/** Drop everything and recreate the schema. Used by the seed script.
 * Deliberately does NOT touch farm_events -- see FARM_SCHEMA above. */
export function resetSchema(): void {
  db.exec(`
    DROP TABLE IF EXISTS deliveries;
    DROP TABLE IF EXISTS vendors;
    DROP TABLE IF EXISTS milkings;
    DROP TABLE IF EXISTS health_events;
    DROP TABLE IF EXISTS feed_inventory;
    DROP TABLE IF EXISTS animals;
  `);
  db.exec(SCHEMA);
}

/** True once the DB has been seeded (used by the unseeded-DB guard). */
export function isSeeded(): boolean {
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM animals`)
      .get() as { n: number };
    return row.n > 0;
  } catch {
    // animals table doesn't exist yet
    return false;
  }
}

// ---------------------------------------------------------------------------
// Read helpers (synchronous, better-sqlite3)
// ---------------------------------------------------------------------------

export function getAnimalById(id: string): Animal | undefined {
  return db.prepare(`SELECT * FROM animals WHERE id = ?`).get(id) as
    | Animal
    | undefined;
}

export function animalExists(id: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS x FROM animals WHERE id = ?`)
    .get(id) as { x: number } | undefined;
  return !!row;
}

export function groupExists(group: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS x FROM animals WHERE group_name = ? LIMIT 1`)
    .get(group) as { x: number } | undefined;
  return !!row;
}

export function allAnimals(): Animal[] {
  return db.prepare(`SELECT * FROM animals ORDER BY tag`).all() as Animal[];
}

export function allFeed(): FeedInventory[] {
  return db
    .prepare(`SELECT * FROM feed_inventory ORDER BY feed_type`)
    .all() as FeedInventory[];
}

export function animalsInScope(scope: {
  animal_id?: string;
  group?: string;
}): Animal[] {
  if (scope.animal_id) {
    const a = getAnimalById(scope.animal_id);
    return a ? [a] : [];
  }
  if (scope.group) {
    return db
      .prepare(`SELECT * FROM animals WHERE group_name = ? ORDER BY tag`)
      .all(scope.group) as Animal[];
  }
  return [];
}

export function milkingsForAnimals(
  animalIds: string[],
  from: string,
  to: string,
): Milking[] {
  if (animalIds.length === 0) return [];
  const placeholders = animalIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT * FROM milkings
       WHERE animal_id IN (${placeholders})
         AND date >= ? AND date <= ?
       ORDER BY date ASC`,
    )
    .all(...animalIds, from, to) as Milking[];
}

export function healthEventsForAnimal(animalId: string): HealthEvent[] {
  return db
    .prepare(
      `SELECT * FROM health_events WHERE animal_id = ? ORDER BY date DESC`,
    )
    .all(animalId) as HealthEvent[];
}

// ---------------------------------------------------------------------------
// Vendor / sales read helpers (Cycle 2). deliveries.paid is stored as 0/1 in
// SQLite; toDelivery() normalizes it to the boolean the Delivery type expects.
// ---------------------------------------------------------------------------

type DeliveryRow = Omit<Delivery, 'paid'> & { paid: number };

function toDelivery(row: DeliveryRow): Delivery {
  return { ...row, paid: !!row.paid };
}

export function getVendorById(id: string): Vendor | undefined {
  return db.prepare(`SELECT * FROM vendors WHERE id = ?`).get(id) as
    | Vendor
    | undefined;
}

export function vendorExists(id: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS x FROM vendors WHERE id = ?`)
    .get(id) as { x: number } | undefined;
  return !!row;
}

export function allVendors(): Vendor[] {
  return db.prepare(`SELECT * FROM vendors ORDER BY name`).all() as Vendor[];
}

export function deliveryExists(id: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS x FROM deliveries WHERE id = ?`)
    .get(id) as { x: number } | undefined;
  return !!row;
}

export function getDeliveryById(id: string): Delivery | undefined {
  const row = db.prepare(`SELECT * FROM deliveries WHERE id = ?`).get(id) as
    | DeliveryRow
    | undefined;
  return row ? toDelivery(row) : undefined;
}

/** Deliveries for one vendor (or all vendors when vendorId is undefined),
 * bounded to an inclusive date range. */
export function deliveriesInScope(scope: {
  vendorId?: string;
  from: string;
  to: string;
}): Delivery[] {
  const clauses = ['date >= ?', 'date <= ?'];
  const params: unknown[] = [scope.from, scope.to];
  if (scope.vendorId) {
    clauses.push('vendor_id = ?');
    params.push(scope.vendorId);
  }
  const rows = db
    .prepare(
      `SELECT * FROM deliveries WHERE ${clauses.join(' AND ')} ORDER BY date ASC`,
    )
    .all(...params) as DeliveryRow[];
  return rows.map(toDelivery);
}

/** All deliveries for one vendor, newest first (used by get_vendor detail). */
export function deliveriesForVendor(vendorId: string): Delivery[] {
  const rows = db
    .prepare(`SELECT * FROM deliveries WHERE vendor_id = ? ORDER BY date DESC`)
    .all(vendorId) as DeliveryRow[];
  return rows.map(toDelivery);
}

// ---------------------------------------------------------------------------
// Reconciliation (Cycle 2). The one place milkings and deliveries are joined --
// read-only, by summing each side over a date range. No FK between them.
// ---------------------------------------------------------------------------

/** Total litres milked across all animals over an inclusive date range. */
export function sumMilkYield(from: string, to: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(yield_litres), 0) AS s FROM milkings WHERE date >= ? AND date <= ?`,
    )
    .get(from, to) as { s: number };
  return row.s;
}

/** Total litres delivered to all vendors over an inclusive date range. */
export function sumDeliveredLitres(from: string, to: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(litres), 0) AS s FROM deliveries WHERE date >= ? AND date <= ?`,
    )
    .get(from, to) as { s: number };
  return row.s;
}

// ---------------------------------------------------------------------------
// Farm event helpers (Cycle 4). farm_events.is_synthetic is stored as 0/1 in
// SQLite; toFarmEvent() normalizes it to the boolean the FarmEvent type
// expects -- the same pattern as toDelivery() above.
// ---------------------------------------------------------------------------

type FarmEventRow = Omit<FarmEvent, 'is_synthetic' | 'flagged'> & {
  is_synthetic: number;
  flagged: number;
};

function toFarmEvent(row: FarmEventRow): FarmEvent {
  return { ...row, is_synthetic: !!row.is_synthetic, flagged: !!row.flagged };
}

/** Insert one normalized farm event. Throws on a CHECK violation -- the caller
 * (farm/routes.ts) catches that and maps it to a 400 rather than a 500.
 *
 * Takes an IngestedFarmEvent, not a FarmEvent: the classification columns are
 * left to their DB defaults (classified_at NULL, flagged 0) so ingestion stays
 * entirely unaware of Cycle 5. */
export function insertFarmEvent(e: IngestedFarmEvent): void {
  db.prepare(
    `INSERT INTO farm_events
       (id, source, source_event_id, is_synthetic, camera_id, zone, event_type,
        identity, confidence, occurred_at, ingested_at, snapshot_ref, raw_payload)
     VALUES
       (@id, @source, @source_event_id, @is_synthetic, @camera_id, @zone, @event_type,
        @identity, @confidence, @occurred_at, @ingested_at, @snapshot_ref, @raw_payload)`,
  ).run({ ...e, is_synthetic: e.is_synthetic ? 1 : 0 });
}

/** Insert several events in one transaction (one Double Take POST can carry
 * multiple faces, and either all of them land or none do). */
export function insertFarmEvents(events: IngestedFarmEvent[]): void {
  const tx = db.transaction((batch: IngestedFarmEvent[]) => {
    for (const e of batch) insertFarmEvent(e);
  });
  tx(events);
}

/** Every farm event, oldest first. Used by the verification script, which
 * resets the table per scenario so this stays a small result set. */
export function allFarmEvents(): FarmEvent[] {
  const rows = db
    .prepare(`SELECT * FROM farm_events ORDER BY occurred_at ASC, id ASC`)
    .all() as FarmEventRow[];
  return rows.map(toFarmEvent);
}

/** Farm events for one camera, oldest first (used by the absence assertions in
 * the camera-dropout scenario). */
export function farmEventsForCamera(cameraId: string): FarmEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM farm_events WHERE camera_id = ? ORDER BY occurred_at ASC, id ASC`,
    )
    .all(cameraId) as FarmEventRow[];
  return rows.map(toFarmEvent);
}

export function countFarmEvents(): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM farm_events`).get() as { n: number };
  return row.n;
}

/** Delete every farm event. How verify.ts scopes itself to one scenario at a
 * time against the shared dev DB (Decision 6 in docs/FARM_EVENTS.md) -- there
 * is no separate test database file.
 *
 * Cycle 5 makes this load-bearing beyond verification: per FARM_MONITOR.md
 * Decision 2, ANY classification-aware population calls this before each
 * scenario, because UNKNOWN_CLUSTER_A1 appears in two scenarios and a shared
 * table corrupts every recurrence count. */
export function resetFarmEvents(): void {
  db.exec(`DELETE FROM farm_events;`);
}

// ---------------------------------------------------------------------------
// Farm event classification (Cycle 5; see docs/FARM_MONITOR.md).
// ---------------------------------------------------------------------------

/** Id-integrity check for flag_anomaly's event_id, mirroring animalExists() /
 * vendorExists() so guardIds() can reject an unknown id before execution. */
export function farmEventExists(id: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS x FROM farm_events WHERE id = ?`)
    .get(id) as { x: number } | undefined;
  return !!row;
}

export function getFarmEventById(id: string): FarmEvent | undefined {
  const row = db.prepare(`SELECT * FROM farm_events WHERE id = ?`).get(id) as
    | FarmEventRow
    | undefined;
  return row ? toFarmEvent(row) : undefined;
}

/** Farm events in an inclusive-start / exclusive-end instant range, optionally
 * narrowed by zone and/or identity. Bounds are ISO-8601 UTC strings compared
 * lexicographically -- safe because every timestamp in this column is written
 * by isoToIso()/epochSecondsToIso() in canonical `...Z` form. */
export function farmEventsInRange(scope: {
  startIso: string;
  endIso: string;
  zone?: string;
  identity?: string;
}): FarmEvent[] {
  const clauses = ['occurred_at >= ?', 'occurred_at < ?'];
  const params: unknown[] = [scope.startIso, scope.endIso];
  if (scope.zone) {
    clauses.push('zone = ?');
    params.push(scope.zone);
  }
  if (scope.identity) {
    clauses.push('identity = ?');
    params.push(scope.identity);
  }
  const rows = db
    .prepare(
      `SELECT * FROM farm_events
       WHERE ${clauses.join(' AND ')}
       ORDER BY occurred_at ASC, id ASC`,
    )
    .all(...params) as FarmEventRow[];
  return rows.map(toFarmEvent);
}

/**
 * How many times this identity was already seen, in the same `event_type`,
 * strictly BEFORE the given instant and no earlier than `windowStartIso`.
 *
 * The window is event-relative, not now-relative (FARM_MONITOR.md Decision 3):
 * the caller derives windowStartIso from the event's own occurred_at, which is
 * what makes a classification pass reproducible whenever it runs.
 *
 * Ties on occurred_at break by id so an event never counts itself and two rows
 * sharing an instant still get distinct occurrence numbers -- one Double Take
 * POST can carry several faces at the same timestamp.
 */
export function countPriorSightings(scope: {
  identity: string;
  eventType: FarmEvent['event_type'];
  occurredAt: string;
  id: string;
  windowStartIso: string;
}): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM farm_events
       WHERE identity = ?
         AND event_type = ?
         AND occurred_at >= ?
         AND (occurred_at < ? OR (occurred_at = ? AND id < ?))`,
    )
    .get(
      scope.identity,
      scope.eventType,
      scope.windowStartIso,
      scope.occurredAt,
      scope.occurredAt,
      scope.id,
    ) as { n: number };
  return row.n;
}

/**
 * The single write path for a classification verdict -- no approval card, no
 * PendingWrite. classifyEvent() calls this directly for automatic flags, and
 * flag_anomaly's WRITE_EXECUTOR calls it for the human-approved manual
 * override (FARM_MONITOR.md Decision 6).
 *
 * Last-write-wins: there is deliberately no flag history and no unflagging
 * path in this cycle. A routine verdict clears the flag columns but still
 * stamps classified_at, so "examined and fine" stays distinguishable from
 * "never examined".
 */
export function setFarmEventFlag(scope: {
  id: string;
  severity: FarmFlagSeverity | null;
  reason: string | null;
  classifiedAt: string;
}): number {
  const flagged = scope.severity ? 1 : 0;
  const info = db
    .prepare(
      `UPDATE farm_events
          SET classified_at = @classified_at,
              flagged       = @flagged,
              flag_severity = @flag_severity,
              flag_reason   = @flag_reason
        WHERE id = @id`,
    )
    .run({
      id: scope.id,
      classified_at: scope.classifiedAt,
      flagged,
      flag_severity: flagged ? scope.severity : null,
      flag_reason: flagged ? scope.reason : null,
    });
  return info.changes;
}
