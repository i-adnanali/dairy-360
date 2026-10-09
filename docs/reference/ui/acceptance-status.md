# Angular remediation acceptance status

Updated **9 October 2026**. Implementation and acceptance fixes are committed in `cb94fe9` on `main`. The requested remediation work is closed with the scope exclusions below; this is not a claim of exhaustive platform or accessibility certification.

## Verified work

The [7–8 October evidence](../../implementation/angular-acceptance-2026-10-07/ACCEPTANCE.md) records real Chrome feed comparison races with delayed successes/failures and retained current data/drafts, plus Chrome/Safari native PDF exports. Long animal identities no longer overlap content, Chromium no longer adds a blank trailing sheet, and buyer statements print all loaded rows with repeated identity and column context.

The latest recorded validation passed 529 frontend tests across 51 files, 779 server tests with no skips, compiler/type, template, contrast, documentation and production-build checks. The initial bundle was 675.62 kB against the unchanged 500 kB warning budget; the shared CommonJS warning remains. These are dated results for the implementation committed in `cb94fe9`, not a promise that later changes have been tested.

Earlier [5 October](../../implementation/angular-acceptance-2026-10-05/ACCEPTANCE.md), [6 October](../../implementation/angular-acceptance-2026-10-06/ACCEPTANCE.md) and [1 October](../../implementation/geist-screen-evidence/ACCEPTANCE.md) records retain their original scope and findings. The [remediation ledger](../../implementation/angular-remediation-2026-10-02.md) tracks the source fixes.

## Checks skipped by decision

On 9 October 2026, the project owner explicitly chose to skip the remaining follow-ups presented after `cb94fe9`:

- Alternative paper/orientation/scale support and further acceptance.
- Firefox/Gecko and additional independent report print coverage beyond buyer statements.
- Actual spoken screen-reader names, error/loading announcements and focus transitions.
- Native mobile keyboard, forms, scrolling and layout acceptance on a real device or simulator.

These are scope exclusions, not successful test results, and no longer block this remediation task. The known alternate-print limitation remains: Safari US Letter landscape at 80% split the A4 sheets and omitted repeated identity on 34 continuation pages. Use **A4 portrait at 100% scale** for the verified report configuration. Do not infer equivalent print support for every report.

The decision does not close unrelated product backlog, real-farm/operator trials, live assistant evaluation or other historical acceptance gaps. Those remain described in [OPEN](../../OPEN.md). No additional device, reader, browser or live-service checks were run to make this documentation update.

## Evidence and screenshots

[Final PDFs, fixtures and reproducible checks](../../implementation/angular-acceptance-2026-10-07/ACCEPTANCE.md#print-defects-and-fixes) substantiate the print results. The [README gallery](../../images/current/README.md) still contains its 1 October captures at `a56400a`; its directory name does not make those images a capture of the latest commit. Historical evidence is preserved rather than relabelled as newly executed.
