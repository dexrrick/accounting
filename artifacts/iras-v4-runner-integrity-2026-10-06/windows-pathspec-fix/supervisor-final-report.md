# Supervisor continuation report — 06/10/2026

**The Windows inventory blocker is fixed, independently reviewed and committed. The actual runner configuration is now frozen and verified. Official evidence and live acceptance remain HOLD.**

The correction is committed at `5db0905b49826ef9c834f917c93261c733e82d1c` on `codex/multi-authority-workstreams`, continuing from checkpoint `c5ae411`. Git-status requests now use conservative bounded batches of literal pathspecs. Every bound directory/file is retained, inconsistent status observations fail closed, and an individually oversized argument is rejected before dispatch. Dirty-file and untracked-executable rejection, symlink containment, raw-byte hashes, baseline ancestry and HEAD/reviewed-commit blob ownership remain enforced. Changes are limited to the runner, its regression and continuation records; production, the existing evaluator/contract, test registration and consumed history are unchanged.

The independent reviewer reports no material findings. Node 22 focused regression, both syntax checks, targeted lint with zero warnings, repository preflight and all 89 smoke suites pass. The new scale fixture exceeds the original Windows command limit and checks a late dirty bound file outside monitored directories, a late rogue `.cts` file and an individually oversized pathspec. Exact source/review/log hashes and validation scope are recorded in `validation.json` and `independent-review.md`.

Exclusive creation of `../runner-configuration.json` succeeded against the actual committed checkout. It binds 589 files and reviewed commit `5db0905b49826ef9c834f917c93261c733e82d1c`. The saved configuration was recomputed and verified successfully. Its file SHA-256 is `0d23efe222c4153030e2e91e445911e0d439fd399125144d294ae5c169183008`; integrity-body digest is `ec8abd02d2a89faee208b081020a828900b0dd2286b4644c5c07cdd0b018c358`. The externally blocked freeze/verification job exited 0. This closes the actual full-inventory failure reported by the preceding checkpoint.

The previously missing valid-configuration live HOLD proof also passes. `validateReviewedAcquisitionPermit` first recomputed and verified the real saved configuration, then rejected it with `V4_LIVE_CAPTURE_INVENTORY_NOT_REVIEWED`. No acquisition permit, reservation or output was created. Its acquisition inventory, production observation adapter and preregistration fields are all null. This proves the first missing-prerequisite gate; it does not separately exercise a configuration with a present inventory and missing adapter/preregistration.

## Remaining acceptance prerequisites

This is a freeze of runner safeguards, not a complete acceptance configuration or permanent V4 acceptance preregistration. The current schema deliberately regenerates null activation fields, so hand-editing or appending them cannot activate capture. Next work must design and implement a separately reviewed activation configuration that binds an actual acquisition inventory and production observation adapter, then freeze the full acceptance preregistration and verify its guards offline. Preserve this runner-only configuration as checkpoint evidence; do not overwrite it or weaken exact-body verification.

The observation adapter must retain actual production lifecycle/source/claim/coverage diagnostics and independent layer results. The current development-only synthetic adapter is not a live scorer. It cannot promote synthetic pages, hash-shaped metadata or expected outcomes into current official evidence. The bounded acquisition inventory must account for mapped pages, allowed discovery/fallback requests, redirects, request identities and all six evidence families before any official fetch.

Only after those prerequisites pass should a separately bound official corpus be acquired, reviewed and used within its 24-hour window. Targeted acceptance still requires fresh independently readable shared allowance, projected reserves, the separately authorized nine-call Gemini ceiling, unchanged prompts/schema/model, one-use consumption and strict replay. No official/provider request, live consumption reservation, push, merge or deployment occurred in this continuation.

## Resource checkpoint and reproduction

The interim checkpoint was saved at 90% five-hour /89% weekly remaining; closure began at 89% /89%, well above the user's 5% five-hour floor. No reset credit was used. Begin checkpoint closure at 10% five-hour or 5% weekly and finish above 5% five-hour and 2% weekly.

From `D:\Accounting`, run the focused offline regression with the approved Node 22 runtime:

```powershell
& 'C:\nvm4w\nodejs\node.exe' --import ./node_modules/tsx/dist/loader.mjs --import ./docs/evaluation/multi-authority-workstreams/iras-v4-negative-controls-2026-10-06/block-external-network.mjs tests/regression/test_iras_v4_capture_replay_runner.mjs
```

Reverify the existing configuration without recreating it:

```powershell
$env:CODEX_GIT_EXECUTABLE = 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
& 'C:\nvm4w\nodejs\node.exe' --import ./node_modules/tsx/dist/loader.mjs --import ./docs/evaluation/multi-authority-workstreams/iras-v4-negative-controls-2026-10-06/block-external-network.mjs scripts/iras_v4_capture_replay_runner.mjs --offline-check --binding artifacts/iras-v4-runner-integrity-2026-10-06/runner-configuration.json
```

The freeze harness text is retained as `supervisor-freeze-probe.mjs.txt` for audit; it was executed from `.tmp` during exclusive initial creation and must not be rerun to replace the configuration. Configuration verification recomputes every bound file and performs many local Git calls. Use the explicit bundled Git executable because the PATH shim is broken. Node 22 requires approved escalated execution in this sandbox.
