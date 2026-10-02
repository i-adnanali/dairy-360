# Capture and validate camera payloads

Use this only for a deliberately bounded optional integration check. This is a runbook, not evidence that a camera or external service is currently accepted. The earlier Frigate and Double Take runs remain dated [records](../records/README.md).

## Preconditions

Use authorized hardware and a chosen capture window. Configure root `.env` from the example with local camera/RTSP settings, and local Frigate/Double Take configs from committed examples. Keep credentials and capture artifacts untracked. Confirm that the Compose project contains only the disposable capture stack before using its destructive teardown.

For Double Take, use only the synthetic enrolment subject and provenance described in [enrolment instructions](../../double-take/enroll/README.md). The capture preflight checks gallery contents, recognition and retention configuration. Do not bypass it to obtain a nominally successful capture. Historical upstream retention defects mean a configuration flag alone does not prove crops were never stored.

## Start and smoke-check

Run from the repository root:

```bash
docker compose -f docker-compose.frigate.yml up -d
```

Confirm the Frigate feed at http://localhost:5000 decodes before spending the capture window. For Double Take:

```bash
npm run enroll:synthetic -w server
```

Enrolment restarts the detector and verifies recognition; gallery loading requires that restart. A short capture can verify MQTT publication before a longer window:

```bash
npm run capture:frigate -w server -- --minutes=2 --max=5
npm run capture:doubletake -w server -- --minutes=2 --max=5
```

Choose the appropriate collector rather than assuming both are needed. Collectors write JSONL under `server/captures/` by default and do not import the live farm database. Record the actual duration, camera/source, topics and capture path.

## Capture and compare

```bash
npm run capture:frigate -w server -- --minutes=20
npm run capture:doubletake -w server -- --minutes=20
```

Use the returned path with the matching verifier. Workspace-relative paths begin with `captures/`; absolute paths are also explicit:

```bash
npm run verify:payload -w server -- --capture=captures/REPLACE-FRIGATE-FILE.jsonl
npm run verify:payload:dt -w server -- --capture=captures/REPLACE-DOUBLETAKE-FILE.jsonl
```

Review missing/added/type-different fields, normalized outcomes and event counts against both the original documentation baseline and synthetic generator. Zero usable messages is inconclusive/failure, not parity. Passing shape validation does not validate identity recognition, multi-zone behavior or farm deployment.

## Troubleshooting and teardown

If no Frigate messages arrive, inspect topic configuration; a bounded `--topic='frigate/#'` capture can discover topics. For Double Take, inspect image fetch/detector configuration and person counts. A healthy pipeline can find no usable face. Do not enable face saving or weaken preflight to hide that limitation.

At the end of the window, tear down the disposable stack:

```bash
docker compose -f docker-compose.frigate.yml down -v
```

`-v` destroys capture-stack media/gallery volumes. Confirm the target beforehand and do not leave the stack running beyond the intended window. Keep only permitted, appropriately scoped evidence; raw captures and real-person imagery must not enter public docs.

Detailed measured limits remain in the [Frigate record](../records/cycle-7-live-camera-validation.md) and [Double Take record](../records/Cycle7-fu3-double-take-validation.md). [OPEN](../OPEN.md) owns follow-up status.
