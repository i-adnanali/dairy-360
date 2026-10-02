# Camera simulation and classification

Optional integration. Use disposable data and a separately configured server; these scripts can clear `farm_events`. The registry memory harness is not a complete farm-ingestion server. Commands run from the repository root.

## Farm event ingestion (synthetic)

Synthetic camera-event plumbing — these commands need no hardware or agent reasoning. Needs the server
running; see [event contracts](../reference/integrations/farm-events.md).

```bash
# replay one scenario, backdated 3 days
npm run simulate:farm -w server -- --scenario=night-visitor-unknown --days-ago=3

# replay every scenario
npm run simulate:farm -w server -- --all --days-ago=14

# list the scenario names and flags
npm run simulate:farm -w server -- --help

# prove every scenario lands correctly in farm_events (exits non-zero on a diff)
npm run verify:farm -w server
```

> `verify:farm` clears `farm_events` before each scenario and again when it
> finishes, so it leaves the table empty. It does not touch the dairy tables,
> and `npm run seed -w server` does not touch `farm_events`.

## Live camera capture

Use [the capture runbook](camera-capture.md) for prerequisites, bounded capture, validation and teardown. Historical hardware windows remain in records.

## Farm event classification

Reads those rows for meaning: routine / notable / urgent per event, plus
attendance and camera-silence reconciliation across a day. Needs the server
running; see [classification rules](../reference/integrations/farm-monitor.md).

```bash
# classify + reconcile every scenario and assert the verdicts
npm run verify:classify -w server

# one scenario only
npm run verify:classify -w server -- --scenario=recurring-unknown-visitor
```

> Both farm scripts pin `TZ=Asia/Karachi`: the generator composes scenario start
> times in the *host's* zone, so an unpinned run on a UTC machine would stamp
> `night-visitor-unknown` at 02:14 UTC — 07:14 farm-local, inside working hours,
> silently failing the off-hours flag the scenario exists to produce.
>
> `verify:classify` resets `farm_events` before each scenario, and that is
> required rather than tidy: the `unknown_a1` cluster id appears in two
> scenarios, so a shared table would give it four sightings in one lookback
> window and corrupt every recurrence count. `simulate:farm --all` accumulates
> all six scenarios into one table and is for ingestion checks only — never use
> it as the basis for a recurrence assertion.
## Expected outcomes and recovery

Verification should exit successfully with scenario expectations met. A timezone/recurrence failure requires isolated scenario data and the configured farm timezone, not weaker assertions. If ingestion fails, inspect the structured normalizer error and endpoint/configuration. Do not rerun destructive verification over events that need preserving.

[Event contracts](../reference/integrations/farm-events.md) and [classification rules](../reference/integrations/farm-monitor.md) own semantics. Hardware, live-camera and gallery acceptance are not established by synthetic scenario success.
