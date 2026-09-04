// Seed a walkthrough herd into the registry HARNESS, over HTTP.
//
// ---------------------------------------------------------------------------
// WHY THIS IS AN HTTP CLIENT AND NOT A FIXTURE MODULE
// ---------------------------------------------------------------------------
// Two properties fall out of it, and both matter more than the convenience:
//
//   1. It cannot touch dairy.db. It imports nothing from server/, opens no
//      database, and reaches the registry only through the same four POST
//      routes the entry forms use. The isolation rule in REGISTRY.md
//      ("nothing synthetic ever touches registry_animals in dairy.db") is
//      therefore enforced by this file having no way to break it, rather than
//      by a test asserting an absence -- plus the guard below.
//   2. Every row goes in through the real write path. `recordCalving`'s
//      transaction, `assertDatePrecision()`, the near-duplicate guard and the
//      projection rebuild all run, so the seed cannot express a herd the
//      production code would refuse.
//
// ---------------------------------------------------------------------------
// RE-RUNNABLE, VIA THE APP'S OWN IDEMPOTENCY KEYS
// ---------------------------------------------------------------------------
// Every write carries a FIXED Idempotency-Key derived from its step name. So:
//
//   harness still running, herd already seeded -> all ~60 writes REPLAY.
//                                                 Nothing is duplicated.
//   harness restarted (fresh :memory:)         -> keys are unknown, seeds fresh.
//
// One command, either way. The key store is a per-router in-process LRU of 500
// entries and this seed makes far fewer writes than that, so no key is evicted
// mid-run. Restarting the harness is the reset path -- there is no other,
// because the harness has no persistence and must not grow one.
//
//   node scripts/harness-seed.mjs            # default http://localhost:4000
//   node scripts/harness-seed.mjs --wait=90  # poll until the harness is up
//   HARNESS_URL=http://localhost:4100 node scripts/harness-seed.mjs
//
// `--wait` exists for `npm run harness:app`, which starts the harness and this
// script concurrently -- concurrently(1) does not order its processes, so the
// seed has to tolerate arriving first. Off by default: run standalone with the
// harness down and the useful answer is the error, immediately, not 90 seconds
// of silence.
//
// NOT application code. Nothing in server/ or web-angular/ imports it, and
// deleting it changes nothing.

const BASE = (process.env.HARNESS_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const API = `${BASE}/api/registry`;

/** Seconds to keep polling for a backend before giving up. 0 = one attempt. */
const WAIT_SECONDS = (() => {
  const flag = process.argv.slice(2).find((a) => a === '--wait' || a.startsWith('--wait='));
  if (flag === undefined) return 0;
  const [, v] = flag.split('=');
  const n = v === undefined ? 60 : Number(v);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`--wait must be a non-negative number of seconds, got '${v}'`);
    process.exit(1);
  }
  return n;
})();

// Session-level provenance, the way the entry UI's gate sets it.
const RECORDER = 'adnan';

/** Farm-local today, and N days before it. Matches the server's convention. */
const FARM_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
});
const today = () => FARM_DATE.format(new Date());
const dayAgo = (n) => FARM_DATE.format(new Date(Date.now() - n * 86400000));

// ---------------------------------------------------------------------------
// The guard. This is the load-bearing part of the file.
// ---------------------------------------------------------------------------

/**
 * Refuse to write anywhere but an in-memory database.
 *
 * `memory` is the discriminator, not the path, for the reason GET /storage
 * gives: an in-memory database cannot be the real registry, because nothing in
 * it outlives the process. A path check would also pass against a second
 * on-disk file if the deferred two-file design ever lands.
 */
async function assertHarness() {
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  let info;
  let lastError = 'never asked';
  for (;;) {
    try {
      const res = await fetch(`${API}/storage`);
      if (!res.ok) throw new Error(`GET /storage -> ${res.status}`);
      info = await res.json();
      break;
    } catch (e) {
      lastError = e.message;
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (info === undefined) {
    die(
      `nothing usable answered at ${API}/storage (${lastError})` +
        `${WAIT_SECONDS > 0 ? ` after waiting ${WAIT_SECONDS}s` : ''}.\n` +
        `Start the harness first:\n` +
        `  npm run registry:harness -w server -- --port=4000 --empty`,
    );
  }
  if (info.memory !== true) {
    die(
      `REFUSING TO SEED.\n\n` +
        `${BASE} reports storage=${JSON.stringify(info.storage)} memory=${info.memory}.\n` +
        `That is not the harness -- it is a real database file, and this seed writes\n` +
        `synthetic animals. Registry rows are the only records in this repo that\n` +
        `cannot be regenerated by re-running a seed.\n\n` +
        `Stop whatever holds that port and start the harness:\n` +
        `  lsof -tiTCP:4000 -sTCP:LISTEN | xargs kill\n` +
        `  npm run registry:harness -w server -- --port=4000 --empty`,
    );
  }
  console.log(`target   ${info.storage}  (memory: true)  -- harness confirmed\n`);
}

function die(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

let replays = 0;
let writes = 0;

async function post(path, key, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': `seed:${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    die(
      `POST ${path} (${key}) -> ${res.status}\n` +
        `  ${payload.error ?? '?'}: ${payload.message ?? text}\n\n` +
        `The seed stops on the first refusal rather than skipping it: a half-seeded\n` +
        `herd is worse to read than none, and a refusal here is a real finding.`,
    );
  }
  writes += 1;
  return payload;
}

async function get(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) die(`GET ${path} -> ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Provenance shorthands. `observed_by` is per-row and NEVER defaulted -- most
// of a recall backfill has nobody who saw it.
// ---------------------------------------------------------------------------

const recall = (observed_by = null) => ({
  source_form: 'recall',
  source_ref: null,
  observed_by,
  recorded_by: RECORDER,
});
const card = (ref, observed_by = null) => ({
  source_form: 'cycle_card',
  source_ref: ref,
  observed_by,
  recorded_by: RECORDER,
});
const sheet = (ref, observed_by = null) => ({
  source_form: 'daily_herd_sheet',
  source_ref: ref,
  observed_by,
  recorded_by: RECORDER,
});

// ---------------------------------------------------------------------------
// Pass one -- the animals that arrived from elsewhere
// ---------------------------------------------------------------------------
//
// Serials are allocated in POST order, so this list IS the numbering. Named
// references are resolved from the responses rather than hard-coded, so a
// change here cannot silently point a calving at the wrong animal.

const ACQUIRED = [
  {
    ref: 'noori', name: 'Noori', sex: 'female', post_no: '1', tag_no: 'PK-4412',
    acquired_on: '2019-01-01', date_precision: 'year',
    birth_on: '2017-03-01', birth_precision: 'month',
    from: 'Chak 42 dairy', prov: card('card-01', 'abdul'),
    note: 'day-precision calving history -> MEASURED intervals',
  },
  {
    ref: 'sohni', name: 'Sohni', sex: 'female', post_no: '2', tag_no: 'PK-4418',
    acquired_on: '2019-01-01', date_precision: 'year',
    birth_on: '2016-01-01', birth_precision: 'year',
    // 'Abdul' vs 'abdul' on purpose: two spellings of one person, both listed by
    // GET /identifier-values, which is the thing worth seeing.
    from: 'Chak 42 dairy', prov: card('card-02', 'Abdul'),
    note: 'calvings entered OUT OF ORDER',
  },
  {
    ref: 'kali', name: 'Kali', sex: 'female', post_no: '3', tag_no: 'PK-4425',
    acquired_on: '2020-02-01', date_precision: 'month',
    birth_on: '2018-01-01', birth_precision: 'estimated',
    // 'chak 42 dairy' -- the case variant on the source, same reason as Abdul.
    from: 'chak 42 dairy', prov: recall(),
    note: 'mixed-precision pair + a pre-applied paired date correction',
  },
  {
    ref: 'bholi', name: 'Bholi', sex: 'female', post_no: '4', tag_no: 'PK-4430',
    acquired_on: '2016-01-01', date_precision: 'year',
    birth_on: '2012-01-01', birth_precision: 'estimated',
    from: 'Sahiwal mandi', prov: recall('rafiq'),
    note: 'the matriarch; her 2018 calving LINKS to Reshma',
  },
  {
    ref: 'rani', name: 'Rani', sex: 'female', post_no: '5', tag_no: 'PK-4431',
    acquired_on: '2021-01-01', date_precision: 'year',
    birth_on: '2019-07-01', birth_precision: 'month',
    from: 'Sahiwal mandi', prov: card('card-05', 'abdul'),
    note: 'one calving, then dried off -> majj . dry',
  },
  {
    ref: 'chandni', name: 'Chandni', sex: 'female', post_no: '6', tag_no: 'PK-4437',
    acquired_on: '2022-01-01', date_precision: 'estimated',
    birth_on: null, birth_precision: null,
    from: null, prov: recall(),
    note: 'NO birth date -> choti despite her age; ranks FIRST in the calf picker',
  },
  {
    ref: 'heera', name: 'Heera', sex: 'male', post_no: '7', tag_no: 'PK-4440',
    acquired_on: '2024-01-01', date_precision: 'year',
    birth_on: '2023-06-01', birth_precision: 'month',
    from: 'Sahiwal mandi', prov: recall(),
    note: 'male -> the calf picker\'s sex-mismatch refusal',
  },
  {
    ref: 'zeba', name: 'Zeba', sex: 'female', post_no: '8', tag_no: 'PK-4444',
    acquired_on: '2019-01-01', date_precision: 'year',
    birth_on: '2018-01-01', birth_precision: 'year',
    from: 'Chak 42 dairy', prov: recall(),
    note: 'sold in 2024 -> departed; an overridden write and a post-departure note',
  },
  {
    ref: 'guddi', name: 'Guddi', sex: 'female', post_no: '9', tag_no: 'PK-4450',
    acquired_on: '2021-01-01', date_precision: 'year',
    birth_on: '2018-01-01', birth_precision: 'estimated',
    from: 'Sahiwal mandi', prov: recall(),
    note: 'THE OLD MAIDEN -- parity 0, ~8 years old -> choti, not majj',
  },
  {
    ref: 'pari', name: 'Pari', sex: 'female', post_no: '10', tag_no: 'PK-4455',
    acquired_on: '2025-08-01', date_precision: 'month',
    birth_on: '2025-04-01', birth_precision: 'month',
    from: 'Chak 42 dairy', prov: sheet('2025-08-14'),
    note: 'katti at 17 months, parity 0 -- the age side of the boundary',
  },
  {
    ref: 'bhoori', name: 'Bhoori', sex: 'female', post_no: '11', tag_no: 'PK-4460',
    acquired_on: '2026-03-01', date_precision: 'month',
    birth_on: '2025-06-01', birth_precision: 'month',
    from: 'Sahiwal mandi', prov: recall(),
    note: 'ITEM 10: recorded age 15 months AND parity 1 -> must read majj, not katti',
  },
  {
    ref: 'lali', name: 'Lali', sex: 'female', post_no: '12', tag_no: 'PK-4465',
    acquired_on: '2020-01-01', date_precision: 'year',
    birth_on: '2018-01-01', birth_precision: 'estimated',
    from: 'Chak 42 dairy', prov: recall('rafiq'),
    note: 'a stillbirth that still opens a lactation and counts toward parity',
  },
  {
    ref: 'kalo', name: 'Kalo', sex: 'female', post_no: '13', tag_no: 'PK-4470',
    acquired_on: '2021-01-01', date_precision: 'estimated',
    birth_on: '2019-01-01', birth_precision: 'estimated',
    from: 'Sahiwal mandi', prov: recall(),
    note: 'one edit from Kali -> the name_near duplicate warning',
  },
  {
    ref: 'reshma', name: 'Reshma', sex: 'female', post_no: '14', tag_no: 'PK-4475',
    acquired_on: '2020-01-01', date_precision: 'estimated',
    birth_on: '2018-01-01', birth_precision: 'estimated',
    from: 'Chak 42 dairy', prov: recall(),
    note: 'entered as acquired in pass one; pass two LINKS her and sharpens her birth date',
  },
  {
    ref: 'sadqa', name: 'Sadqa', sex: 'female', post_no: '15', tag_no: 'PK-4485',
    acquired_on: '2026-07-01', date_precision: 'month',
    birth_on: '2026-02-01', birth_precision: 'month',
    from: null, prov: recall(),
    note: 'the IN-WINDOW eligible calf-picker candidate for a Mar 2026 calving (28d apart)',
  },
];

// ---------------------------------------------------------------------------
// Pass two -- calvings and life events, in POST order
// ---------------------------------------------------------------------------
//
// Buffalo-plausible: Nili-Ravi intervals here run 487-550 days, all inside the
// 380-700 "normal" band from REGISTRY_ENTRY_UX.md 7.2, and none inside the
// 60-day double-entry window.

const STEPS = [
  // --- Noori: three day-precision calvings with dry-offs between -----------
  { kind: 'calve', key: 'noori-c1', dam: 'noori', on: '2021-02-11', prec: 'day',
    time: '05:40', sex: 'female', name: 'Mithi', sire: 'Sultan', prov: card('card-01', 'abdul'),
    mint: 'mithi' },
  { kind: 'event', key: 'noori-d1', animal: 'noori', type: 'dry_off',
    on: '2021-11-06', prec: 'day', reason: 'scheduled', prov: card('card-01') },
  { kind: 'calve', key: 'noori-c2', dam: 'noori', on: '2022-07-19', prec: 'day',
    sex: 'female', sire: 'sultan', prov: card('card-01', 'abdul'), mint: 'noori-c2-calf' },
  { kind: 'event', key: 'noori-d2', animal: 'noori', type: 'dry_off',
    on: '2023-04-02', prec: 'day', reason: 'scheduled', prov: card('card-01') },
  { kind: 'calve', key: 'noori-c3', dam: 'noori', on: '2024-01-08', prec: 'day',
    sex: 'male', sire: 'Toori Wala', prov: card('card-01'), mint: 'noori-c3-calf' },
  { kind: 'event', key: 'noori-note', animal: 'noori', type: 'note',
    on: '2026-02-14', prec: 'day',
    text: 'off feed two days after the morning round, back to normal by the 16th',
    prov: sheet('2026-02-14', 'abdul') },

  // --- Sohni: month precision, ENTERED OUT OF ORDER ------------------------
  // Middle calving first, then the latest, then the earliest. The projection
  // re-derives from occurred_on, so the lactation chain comes out right; what
  // is visibly out of step is recorded_at, and the calf serials.
  { kind: 'calve', key: 'sohni-c2', dam: 'sohni', on: '2022-12-01', prec: 'month',
    sex: 'female', name: 'Chitti', prov: card('card-02', 'Abdul'), mint: 'chitti' },
  { kind: 'calve', key: 'sohni-c3', dam: 'sohni', on: '2024-04-01', prec: 'month',
    sex: 'male', prov: card('card-02'), mint: 'sohni-c3-calf' },
  { kind: 'calve', key: 'sohni-c1', dam: 'sohni', on: '2021-06-01', prec: 'month',
    sex: 'female', prov: card('card-02'), mint: 'sohni-c1-calf' },

  // --- Kali: a day-precision calving and a month-precision one -------------
  { kind: 'calve', key: 'kali-c1', dam: 'kali', on: '2022-09-14', prec: 'day',
    sex: 'female', name: 'Neeli', sire: 'Sultan', prov: recall(), mint: 'neeli' },
  { kind: 'calve', key: 'kali-c2', dam: 'kali', on: '2024-02-01', prec: 'month',
    sex: 'female', prov: recall(), mint: 'kali-c2-calf' },
  { kind: 'event', key: 'kali-d1', animal: 'kali', type: 'dry_off',
    on: '2025-11-01', prec: 'month', reason: 'low_yield', prov: recall() },

  // --- Bholi: LINK MODE, then a minted calf --------------------------------
  // Reshma exists already, entered as `acquired` in pass one because pass one
  // has no calvings yet. This is the reconciliation the mode exists for: her
  // acquired origin is superseded by a birth, her origin is promoted to
  // born_on_farm, and 'estimated 2018' sharpens to '2018-06-01 (month)'.
  { kind: 'calve', key: 'bholi-c1-link', dam: 'bholi', on: '2018-06-01', prec: 'month',
    sex: 'female', link: 'reshma', prov: recall('rafiq') },
  { kind: 'calve', key: 'bholi-c2', dam: 'bholi', on: '2019-11-01', prec: 'month',
    sex: 'female', prov: recall(), mint: 'bholi-c2-calf' },
  { kind: 'event', key: 'bholi-d1', animal: 'bholi', type: 'dry_off',
    on: '2020-08-01', prec: 'month', reason: 'scheduled', prov: recall() },

  // --- Rani: one calving, then dry -----------------------------------------
  { kind: 'calve', key: 'rani-c1', dam: 'rani', on: '2023-10-01', prec: 'month',
    sex: 'male', prov: card('card-05', 'abdul'), mint: 'rani-c1-calf' },
  { kind: 'event', key: 'rani-d1', animal: 'rani', type: 'dry_off',
    on: '2024-07-01', prec: 'month', reason: 'scheduled', prov: card('card-05') },

  // --- Lali: a stillbirth, then a live calving -----------------------------
  // The stillborn calf is still an animal, still has a birth event, still
  // opens the lactation and still counts toward parity -- plus a departure
  // with reason 'died'. Suppressing it would corrupt the interval metric.
  { kind: 'calve', key: 'lali-c1', dam: 'lali', on: '2023-05-01', prec: 'month',
    sex: 'female', outcome: 'stillborn', prov: recall('rafiq'), mint: 'lali-c1-calf' },
  { kind: 'event', key: 'lali-d1', animal: 'lali', type: 'dry_off',
    on: '2024-02-01', prec: 'month', reason: 'health', prov: recall() },
  { kind: 'calve', key: 'lali-c2', dam: 'lali', on: '2024-11-01', prec: 'month',
    sex: 'female', assistance: 'assisted', prov: recall('rafiq'), mint: 'lali-c2-calf' },

  // --- Bhoori: the item-10 case -------------------------------------------
  // Recorded birth Jun 2025, calving Jul 2026. Biologically unreachable
  // (gestation is ~310 days), very reachable by a birth-year typo -- which is
  // exactly what a backfill produces. Parity is checked BEFORE age, so she
  // reads majj . in milk. Under the old rule order she read katti.
  { kind: 'calve', key: 'bhoori-c1', dam: 'bhoori', on: '2026-07-01', prec: 'month',
    sex: 'female', prov: recall(), mint: 'bhoori-c1-calf' },

  // --- Zeba: history, an OVERRIDDEN write, a departure, a post-departure note
  { kind: 'calve', key: 'zeba-c1', dam: 'zeba', on: '2022-08-01', prec: 'month',
    sex: 'female', prov: recall(), mint: 'zeba-c1-calf' },
  { kind: 'event', key: 'zeba-dep', animal: 'zeba', type: 'departure',
    on: '2024-05-01', prec: 'month', reason: 'sold', to: 'Sahiwal mandi', prov: recall() },
  // Found on the cycle card AFTER she was sold and entered out of order. The
  // guard fires on the EXISTENCE of a departure, not on the date, so this needs
  // allow_after_departure -- and because the dry-off is dated BEFORE the
  // departure, invariant 5 stays clean. The override is recorded from the
  // CONDITION, so this event carries override: { check, reason } in its payload.
  { kind: 'event', key: 'zeba-dry-override', animal: 'zeba', type: 'dry_off',
    on: '2024-03-01', prec: 'month', reason: 'scheduled',
    allow_after_departure: true,
    override_reason: 'found on the cycle card after she was sold; dated before the sale',
    prov: card('card-08') },
  // A note is ALWAYS allowed after a departure -- no flag, no override.
  { kind: 'event', key: 'zeba-note', animal: 'zeba', type: 'note',
    on: '2024-09-12', prec: 'day',
    text: 'buyer rang about her papers; nothing owed',
    prov: recall() },

  // --- What actually happens to the farm-born stock ------------------------
  // Without this block the herd reads wrong in a way no invariant can see:
  // nine grown farm-born daughters at parity 0, which no dairy has. Bull
  // calves leave within months, surplus heifers get sold, and the ones kept
  // calve at three-and-a-half to four years.
  { kind: 'event', key: 'dep-noori-c3-calf', animal: 'noori-c3-calf', type: 'departure',
    on: '2024-04-01', prec: 'month', reason: 'sold', to: 'Sahiwal mandi', prov: recall() },
  { kind: 'event', key: 'dep-sohni-c3-calf', animal: 'sohni-c3-calf', type: 'departure',
    on: '2024-07-01', prec: 'month', reason: 'sold', to: 'Sahiwal mandi', prov: recall() },
  { kind: 'event', key: 'dep-rani-c1-calf', animal: 'rani-c1-calf', type: 'departure',
    on: '2024-01-01', prec: 'month', reason: 'sold', to: 'Sahiwal mandi', prov: recall() },
  { kind: 'event', key: 'dep-noori-c2-calf', animal: 'noori-c2-calf', type: 'departure',
    on: '2024-03-01', prec: 'month', reason: 'sold', to: 'Chak 42 dairy', prov: recall() },
  { kind: 'event', key: 'dep-sohni-c1-calf', animal: 'sohni-c1-calf', type: 'departure',
    on: '2023-09-01', prec: 'month', reason: 'sold', to: 'Chak 42 dairy', prov: recall() },
  { kind: 'event', key: 'dep-bholi-c2-calf', animal: 'bholi-c2-calf', type: 'departure',
    on: '2021-05-01', prec: 'month', reason: 'sold', to: 'Sahiwal mandi', prov: recall() },
  { kind: 'event', key: 'dep-zeba-c1-calf', animal: 'zeba-c1-calf', type: 'departure',
    on: '2024-05-01', prec: 'month', reason: 'sold', to: 'Sahiwal mandi', prov: recall() },
  { kind: 'event', key: 'died-lali-c2-calf', animal: 'lali-c2-calf', type: 'departure',
    on: '2025-03-01', prec: 'month', reason: 'died', cause: 'pneumonia after the cold spell',
    prov: recall('rafiq') },

  // Two farm-born daughters kept and bred -- a second generation, so the
  // pedigree has depth and the dam dropdown has more than acquired animals.
  { kind: 'calve', key: 'mithi-c1', dam: 'mithi', on: '2025-06-14', prec: 'day',
    time: '22:10', sex: 'female', sire: 'Toori Wala', assistance: 'assisted',
    prov: sheet('2025-06-15', 'abdul'), mint: 'mithi-c1-calf' },
  { kind: 'calve', key: 'neeli-c1', dam: 'neeli', on: '2026-05-01', prec: 'month',
    sex: 'male', sire: 'sultan', prov: recall(), mint: 'neeli-c1-calf' },

  // --- A pre-applied PAIRED date correction on Kali's first calving --------
  // Both halves in one transaction: the calving on Kali and the birth on
  // Neeli. Superseded events are returned by the API, not filtered, so both
  // timelines show the old row struck through and naming its replacement.
  { kind: 'correct', key: 'kali-c1-correction', calving: 'kali-c1',
    on: '2022-10-02', prec: 'day',
    notes: 'date corrected from 14 Sep on a second reading of the card',
    prov: recall() },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const ids = new Map();   // ref -> BD-xxxx
const events = new Map(); // step key -> calving event id
const promotions = [];

function resolve(ref) {
  const id = ids.get(ref);
  if (id === undefined) die(`internal: no animal recorded for ref '${ref}'`);
  return id;
}

async function seedAcquired() {
  console.log('pass one -- animals that arrived from elsewhere');
  for (const a of ACQUIRED) {
    const r = await post('/animals', `animal:${a.ref}`, {
      sex: a.sex,
      name: a.name,
      acquired_on: a.acquired_on,
      date_precision: a.date_precision,
      birth_on: a.birth_on,
      birth_precision: a.birth_precision,
      from: a.from,
      post_no: a.post_no,
      tag_no: a.tag_no,
      ...a.prov,
    });
    ids.set(a.ref, r.animal_id);
    const stage = r.animal.status?.status ?? '?';
    console.log(`  ${r.animal_id}  ${a.name.padEnd(8)} ${String(stage).padEnd(10)} ${a.note}`);
  }
}

async function seedSteps() {
  console.log('\npass two -- calvings and life events, oldest-first per animal');
  for (const s of STEPS) {
    if (s.kind === 'calve') {
      const r = await post('/calvings', `calving:${s.key}`, {
        dam_id: resolve(s.dam),
        occurred_on: s.on,
        occurred_time: s.time ?? null,
        date_precision: s.prec,
        calf_id: s.link ? resolve(s.link) : null,
        calf_sex: s.sex,
        calf_name: s.name ?? null,
        outcome: s.outcome ?? 'live',
        sire_ref: s.sire ?? null,
        assistance: s.assistance ?? null,
        ...s.prov,
      });
      events.set(s.key, r.calving_event_id);
      if (s.mint) ids.set(s.mint, r.calf_id);
      const what = r.linked ? `LINKED ${r.calf_id}` : `minted ${r.calf_id}`;
      const extra = r.departure_event_id ? '  + departure(died) on the calf' : '';
      if (r.linked) {
        promotions.push(
          `${r.calf_id} ${r.calf.animal.name ?? ''}: acquired -> birth ` +
            `(origin now ${r.calf.animal.origin}, birth ` +
            `${r.calf.status?.birth_on} ${r.calf.status?.birth_precision})`,
        );
      }
      console.log(
        `  ${s.key.padEnd(20)} calving  ${resolve(s.dam)}  ${s.on} (${s.prec})  ${what}${extra}`,
      );
    } else if (s.kind === 'event') {
      await post('/events', `event:${s.key}`, {
        animal_id: resolve(s.animal),
        type: s.type,
        occurred_on: s.on,
        occurred_time: null,
        date_precision: s.prec,
        reason: s.reason ?? null,
        to: s.to ?? null,
        cause: s.cause ?? null,
        text: s.text ?? null,
        allow_after_departure: s.allow_after_departure === true,
        override_reason: s.override_reason ?? null,
        ...s.prov,
      });
      console.log(
        `  ${s.key.padEnd(20)} ${s.type.padEnd(9)} ${resolve(s.animal)}  ${s.on} (${s.prec})` +
          (s.allow_after_departure ? '  [OVERRIDE recorded]' : ''),
      );
    } else if (s.kind === 'correct') {
      const eventId = events.get(s.calving);
      if (!eventId) die(`internal: no calving event recorded for '${s.calving}'`);
      const r = await post(`/calvings/${eventId}/correction`, `correction:${s.key}`, {
        occurred_on: s.on,
        occurred_time: null,
        date_precision: s.prec,
        notes: s.notes ?? null,
        ...s.prov,
      });
      console.log(
        `  ${s.key.padEnd(20)} paired correction on ${r.dam_id} + ${r.calf_id} -> ${s.on} (${s.prec})`,
      );
    }
  }
}

/**
 * A few milking sessions over the most recent lactations.
 *
 * DELIBERATELY NOT COMPLETE, and not uniform. The point of the /check
 * completeness panel is to show the difference between a session where everyone
 * has a row and one where they do not, and between a row that carries a number
 * and one that says nobody weighed it -- so the fixture has to contain both or
 * the panel has nothing to display but a green wall.
 *
 * The dates are relative to today so the roster opens on something the moment
 * the app starts, rather than on an empty screen dated whenever this was
 * written.
 */
async function seedMilkings() {
  const roster = await get(`/milking/roster?on=${today()}&session=morning`);
  if (roster.rows.length === 0) {
    console.log('\nmilking  nobody is in milk today -- skipped');
    return;
  }

  const ids = roster.rows.map((r) => r.animal_id);
  // A plausible curve: more milk earlier in the lactation, and a per-animal
  // constant so the same animal reads consistently across sessions.
  // A per-animal constant from the SERIAL DIGITS, so the same animal reads
  // consistently across sessions. `id.charCodeAt(8)` was the first attempt and
  // it is NaN -- 'BD-0001' is seven characters -- which made yield_litres NaN,
  // serialized to null, and the write boundary refused it by name. Left
  // recorded because it is a small live specimen of the thing this seed is for:
  // every row goes through the real write path, so the fixture cannot express a
  // herd the production code would reject.
  const serial = (id) => Number(id.slice(3)) || 0;
  const base = (id, dim) =>
    Math.round((9 - Math.min(dim, 300) / 60 + (serial(id) % 3)) * 10) / 10;

  const plan = [
    { back: 2, session: 'morning', cover: 1.0, measure: 1.0 },
    { back: 2, session: 'evening', cover: 1.0, measure: 0.6 },
    { back: 1, session: 'morning', cover: 1.0, measure: 1.0 },
    // An INCOMPLETE session: two animals never got a row at all. This is what
    // the completeness panel exists to surface.
    { back: 1, session: 'evening', cover: 0.6, measure: 0.5 },
    { back: 0, session: 'morning', cover: 1.0, measure: 0.8 },
  ];

  for (const p of plan) {
    const on = dayAgo(p.back);
    const r = await get(`/milking/roster?on=${on}&session=${p.session}`);
    if (r.rows.length === 0) continue;
    const take = Math.max(1, Math.round(r.rows.length * p.cover));
    const entries = r.rows.slice(0, take).map((row, i) => {
      // `not_milked` on exactly one animal, so the third status is present.
      if (p.back === 1 && p.session === 'morning' && i === 0) {
        return { animal_id: row.animal_id, status: 'not_milked', reason: 'under treatment' };
      }
      if (i < Math.round(take * p.measure)) {
        return {
          animal_id: row.animal_id,
          status: 'measured',
          yield_litres: base(row.animal_id, row.days_in_milk),
        };
      }
      return { animal_id: row.animal_id, status: 'milked_not_measured' };
    });

    await post('/milking/session', `milking:${on}:${p.session}`, {
      occurred_on: on,
      session: p.session,
      observed_by: p.session === 'morning' ? 'abdul' : 'imran',
      entries,
      source_form: 'direct_entry',
      recorded_by: RECORDER,
    });
  }
  console.log(`\nmilking  ${plan.length} sessions across ${ids.length} animals in milk`);
}

async function report() {
  const { animals } = await get('/animals');
  const verification = await get('/verification');

  console.log(`\nherd     ${animals.length} animals`);
  console.log(
    `  ${'id'.padEnd(9)} ${'name'.padEnd(9)} ${'status'.padEnd(10)} ${'parity'.padEnd(7)} ` +
      `${'birth'.padEnd(24)} post  tag`,
  );
  for (const a of animals) {
    const birth = a.birth_on ? `${a.birth_on} (${a.birth_precision})` : 'unknown';
    console.log(
      `  ${a.id.padEnd(9)} ${(a.name ?? '-').padEnd(9)} ${String(a.status).padEnd(10)} ` +
        `${String(a.parity).padEnd(7)} ${birth.padEnd(24)} ` +
        `${(a.post_no ?? '-').padEnd(5)} ${a.tag_no ?? '-'}`,
    );
  }

  if (promotions.length) {
    console.log('\nlink-mode promotions (enter, then SHARPEN)');
    for (const p of promotions) console.log(`  ${p}`);
  }

  const v = verification.violations;
  console.log(
    `\ncheck    as_of ${verification.as_of}  |  ${verification.counts.animals} animals, ` +
      `${verification.counts.events} events, ${verification.counts.lactations} lactations`,
  );
  console.log(`  violations  ${v.length === 0 ? 'none' : v.length}`);
  for (const x of v) console.log(`    [${x.invariant}] ${x.name}: ${x.detail}`);

  const iv = verification.intervals;
  const fmt = (c) =>
    c == null || c.count === 0
      ? 'none'
      : `n=${c.count} mean ${Math.round(c.mean_days)}d range ${c.min_days}-${c.max_days}d`;
  console.log(`  intervals   measured ${fmt(iv.measured)}`);
  console.log(`              approximate ${fmt(iv.approximate)}`);

  const mk = verification.milking;
  console.log(
    `\nmilk     ${mk.rows} row(s) over ${mk.sessions} session(s), ` +
      `${mk.complete_sessions} complete`,
  );
  console.log(
    `  measured ${mk.measured}  |  milked, not measured ${mk.milked_not_measured}  |  ` +
      `not milked ${mk.not_milked}`,
  );
  for (const s2 of mk.recent) {
    const flag = s2.recorded >= s2.expected ? ' ' : '!';
    console.log(
      `  ${flag} ${s2.occurred_on} ${s2.session.padEnd(8)} ` +
        `${s2.recorded}/${s2.expected} recorded, ${s2.measured} measured`,
    );
  }

  console.log('\nidentifier values now offered by the datalists');
  const idv = await get('/identifier-values');
  console.log(`  observed_by    ${idv.observed_by.join(' | ')}`);
  console.log(`  acquired_from  ${idv.acquired_from.join(' | ')}`);
  console.log(`  sire_ref       ${idv.sire_ref.join(' | ')}`);

  console.log(`\n${writes} writes issued. Re-run this command any time: the fixed`);
  console.log(`Idempotency-Keys make every one of them a replay while this harness lives.`);
}

async function main() {
  console.log(`registry harness seed  ->  ${API}\n`);
  await assertHarness();

  // Expected herd size: pass one, plus every calving that MINTS a calf. Link
  // mode creates no animal, so it does not count.
  const expected =
    ACQUIRED.length + STEPS.filter((s) => s.kind === 'calve' && s.mint).length;

  const { animals } = await get('/animals');
  if (animals.length > 0) {
    const first = animals.find((a) => a.id === 'BD-0001');
    if (!first || first.name !== ACQUIRED[0].name) {
      die(
        `the harness already holds ${animals.length} animal(s) that are not this seed\n` +
          `(BD-0001 is ${first ? JSON.stringify(first.name) : 'absent'}, expected ` +
          `${JSON.stringify(ACQUIRED[0].name)}).\n\n` +
          `Most likely the harness was started WITHOUT --empty, so it is serving the\n` +
          `13-animal cleanHerd() fixture and every serial below would be shifted.\n` +
          `Restart it and re-run:\n` +
          `  npm run registry:harness -w server -- --port=4000 --empty`,
      );
    }
    // A replay only stays a replay while the request BODIES are byte-identical:
    // the key store is keyed on (key, body), deliberately, so a failed submit
    // that is then edited is processed as new. That is right for a form and it
    // means EDITING THIS FILE INVALIDATES THE REPLAY -- the dry-offs and notes
    // have no uniqueness guard, so they would append a second time and the
    // herd would compound. Caught here rather than discovered halfway through.
    if (animals.length !== expected) {
      die(
        `the harness holds ${animals.length} animals; this seed produces ${expected}.\n\n` +
          `Either this file changed since the harness was seeded (the replay is keyed on\n` +
          `(key, BODY), so an edited body is a new write), or a partial run left it\n` +
          `half-applied. There is no way to un-append an event -- the log is append-only\n` +
          `and the harness has no reset of its own.\n\n` +
          `Restart the harness, which discards everything, and re-run:\n` +
          `  lsof -tiTCP:4000 -sTCP:LISTEN | xargs kill\n` +
          `  npm run registry:harness -w server -- --port=4000 --empty\n` +
          `  node scripts/harness-seed.mjs`,
      );
    }
    console.log(`herd already seeded (${animals.length} animals) -- replaying every write\n`);
  }

  await seedAcquired();
  await seedSteps();
  await seedMilkings();
  await report();
}

main().catch((e) => die(e.stack ?? String(e)));
