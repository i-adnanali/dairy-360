# Documentation

Start with the task you need to complete. Current guides and references describe delivered behavior; dated records preserve decisions and evidence without acting as instructions to rebuild old plans.

| Task | Start here |
|---|---|
| Install, run or troubleshoot | [Local development](guides/development.md) |
| Validate a change or prepare evidence | [Testing](guides/testing.md) |
| Back up or restore records | [Backup and restore](guides/backup-restore.md) |
| Use registry command-line tools | [Registry CLI](guides/registry-cli.md) |
| Understand application boundaries | [System architecture](architecture/system.md) |
| Work on frontend or assistant | [Frontend](architecture/frontend.md), [assistant](architecture/assistant.md), [protocol](architecture/protocol.md) |
| Change domain behavior or calculations | [Registry references](reference/registry/README.md) |
| Change presentation or navigation | [UI design system](reference/ui/design-system.md), [application interactions](reference/ui/application-interactions.md) |
| Operate optional integrations | [Camera operations](guides/camera-operations.md), [capture](guides/camera-capture.md), [tracing](guides/observability.md) |
| Look up integration contracts | [Integration references](reference/integrations/README.md) |
| See recorded appearance | [Screenshot gallery](images/current/README.md) |
| Find remaining work | [Open items](OPEN.md) |
| Review what was verified and what was skipped | [Acceptance status](reference/ui/acceptance-status.md) |
| Understand why something is the way it is | [Decision index](decisions/README.md), [dated records](records/README.md) |

## Conventions

- Each maintained page owns a clear topic. Link to its contract rather than copying evolving test counts or complete procedures.
- Guides explain prerequisites, steps, expected outcomes and recovery. References state current behavior, invariants, interfaces, examples and limitations. Architecture pages explain boundaries and reasoning.
- Dated records keep original proposals, decisions and measurements; source comments cite them for the reasoning behind code. They are not current instructions. Bulky verification evidence (logs, PDFs, screenshot sets) is not kept in the tree; git history has the earlier sets.
- [Documentation maintenance](guides/documentation.md) describes link checking, source citations and screenshot refresh requirements.

The root [README](../README.md) owns the product introduction and quick start. This index routes readers to deeper material without repeating them.
