# MAS integration stopping point — 16 October 2026

## Latest restart checkpoint — resumed and verified

The user requested another stopping point to restart ChatGPT, then restored the Cloudflare connection and asked to continue. The pending CI and Cloudflare checks are now confirmed below. No automatic continuation or future wakeup was scheduled. The original stopping-point observations farther below are historical.

- Worktree: `C:/Users/Admin/.codex/worktrees/mas-stack-integration/Accounting`.
- Branch: `codex/mas-stack-integration`; source/documentation tip `055c7efa178524afe2d2ea3692a4a2539267996e` is pushed to draft PR #21: https://github.com/dexrrick/accounting/pull/21 . This latest restart-note commit is local only.
- Main remains `75680018b91c707f7ac900963bebb63d7317ca69`; a fresh fetch confirmed it is an ancestor of the integration branch.
- PR #19 is unchanged and draft at `4c9d91696ffb7df73650becd15975c03cd84fc63`; PR #20 is unchanged and draft at `8cea28165c036cc7f06fbc197413580c449fb0a4`.
- All four integration findings are now independently cleared, including the final version-ID alias/ledger-overwrite fix. The read-only reviewer reproduced pending, active and rolled-back alias cases, found no material issues and changed no files.
- Final current-code local checks passed on Node 22.23.1: all 112 smoke suites; adjacent Phase 4 retrieval (56 checks) and shared-document admission regressions; lint and TypeScript/Vite/Cloudflare worker build. Existing warnings remain. Offline runs used the existing fetch guard.
- Latest full CI for pushed `055c7ef`: run `38843838213`, job `116789722687`, https://github.com/dexrrick/accounting/actions/runs/38843838213 . Confirmed SUCCESS: lint, build and all 132 full regression suites passed. The job log contains 132 passing summary rows and ALL SUITES PASSED. This is the final integration-head run, not the earlier initial-merge success.
- Cloudflare connection is restored. Read-only checks confirmed the integration preview build `c55720f4-e14d-46a0-91bf-5e9dc0b1edca` succeeded for `055c7ef` via `wrangler versions upload`: https://codex-mas-stack-integration-accounting.dexrrick-goh.workers.dev . Production is unchanged: deployment `a5987ee3-1142-4319-b1dc-a8eba0193b6e`, version `865f7a5a-35b8-4438-a7a9-af74aff5df84`, 100% traffic. No Cloudflare write was attempted.
- No merge to main, manual production deployment/activation, source approval, monitor registration, authority expansion or schedule was performed.
- PR #21's title and description are updated with all four cleared review fixes, final 112-suite smoke and 132-suite combined CI results, successful preview build, unchanged production, and the actual browser acceptance limitation. It remains draft at `055c7ef`. Local notes after that head do not change source/scripts/tests/dependencies and are intentionally not pushed merely to rerun unchanged CI.

Completed verification and next work:

1. Read this latest section and confirm current refs before new work. Do not redo cleared source/PDF/transport reviews or passing checks unless relevant code changes or a new failure warrants it.
2. Complete CI for `055c7ef` is confirmed passing and linked in PR #21. No test failure remains to fix.
3. Cloudflare preview success and unchanged production are confirmed. Account `0c07eba7cff6c7a8e3c9356cf0fcc503`, worker `accounting`, build tag `80a4da2ff88d4272970259201875427c`. Do not deploy or move production traffic.
4. PR #21 metadata is current; keep it draft pending the remaining release gates. No source change was required to close these verification items.
5. Keep the browser acceptance limitation explicit. The user already configured Gemini directly in the PR #20 preview and its UI showed Connected. The question returned a response but retained Evidence Incomplete — Review Required; approved-document citation/version binding was not demonstrated. Missing credentials are no longer the blocker; never read or copy credentials.
6. A bounded code trace confirmed the default feed service does not register the MAS document adapter, and `Header.tsx` exposes stage/verify/activate but no explicit MAS approval action. This is the concrete next browser-integration gap; do not bypass approval or enable production monitoring to manufacture acceptance. Broader ACRA/CPF/MOM work and scheduling stay deferred.

Latest local logs: `D:/Accounting/.tmp/mas-transport-investigation/resume-{adjacent,lint,build,smoke}.log`. Runtime, offline guard and prior checkpoint details remain below. The browser tab may need to be reacquired after restart; no fresh browser test is needed merely to repeat the known conditional result.

## Original stopping-point observations

Status: historical checkpoint, saved at the user's request in `de5455e` and resumed on 16 October 2026. See the “Combined integration review and browser boundary” continuation in `statutory_authority_parity.md` and PR #21 for current validation and release gates. The observations below describe the original stopping point.

## Workspaces and branches

- Integration worktree: C:/Users/Admin/.codex/worktrees/mas-stack-integration/Accounting
- Integration branch: codex/mas-stack-integration
- Draft integration PR: https://github.com/dexrrick/accounting/pull/21 (base main).
- Main baseline: 75680018b91c707f7ac900963bebb63d7317ca69.
- Initial integration merge: 2da3233f2657a80f30f18d9f363ecbc39f54e495.
- Reviewed local date fix: 3189690 (not pushed).
- This local checkpoint also saves the feed/versioning fixes and their regression cases; those changes are not pushed.
- Previous investigation worktree: D:/Accounting/.worktrees/mas-controlled-acceptance, branch codex/mas-transport-investigation.
- PR #20 remains draft at 8cea28165c036cc7f06fbc197413580c449fb0a4.
- PR #19 remains unchanged and draft at 4c9d91696ffb7df73650becd15975c03cd84fc63.
- No merge into main, production deployment/activation, automatic monitor or schedule was performed.

## Review findings and current implementation

1. Composite retrieval discarded target dates parsed from natural-language questions during its final admission check. Fixed in 3189690 by sharing the resolved date across local retrieval and final admission. Focused tests and independent re-review passed.
2. A legacy non-MAS package could reuse an active/pending/historical managed MAS record ID and bypass approval protection. The feed now checks managed registry, candidate and ledger identity at staging, raw verification, official-source verification and activation. The original reproduction was independently confirmed rejected.
3. First-version legacy rollback cleared the ledger pointer but left a registry row. The feed now keeps exact nullable pre-activation registry snapshots for all authorities and preflights rollback ownership before restoring/deleting rows. The original reproduction and baseline/newer-version cases were independently cleared.
4. Final re-review found a version-ID alias: packageId 'MAS' plus an unrelated recordId equal to the remainder of an existing MAS version ID generated the same version key. That could overwrite the managed ledger and its approval receipt despite record-ID checks. A fix is now present but still needs independent re-review and final broad validation:
   - Feed collision-free version-ID allocation applies to every authority.
   - SourceVersioningManager rejects already-reserved candidate/ledger IDs at registration.
   - Activation rejects an existing ledger key before mutation.
   - Pending, active and rolled-back alias/duplicate reservation regressions were added.

Current checkpoint delta after 3189690:
- src/retrieval/liveRegulatoryFeed.ts
- src/standards/sourceVersioning.ts
- tests/regression/test_mas_regulatory_lifecycle.mjs
- this checkpoint document

The shared-admission legacy-baseline retrieval exception remains unchanged. No source or approval checks were weakened.

## Validation evidence

- Initial combined CI at 2da3233 passed lint, build and all 132 suites:
  https://github.com/dexrrick/accounting/actions/runs/38824512257
- The first three integration fixes passed local 112-suite smoke, lint and build before the final version-ID guard was added. Those results do not validate the final manager change.
- At the stopping point, the complete current test_mas_regulatory_lifecycle.mjs, including the version-ID alias cases, passed with Node 22 and an offline fetch guard.
- Final independent review, adjacent regressions, final lint/build/smoke and the complete CI run for the latest local fixes remain outstanding.
- The stopping-point diff passed git diff --check.
- Dependencies are installed in the integration worktree; package/lock files were not changed.

Runtime: C:/Users/Admin/AppData/Local/node-v22.23.1-win-x64/node.exe.
Use git.exe, since the git shim is broken in this environment.
Node 22 commands need execution outside the restrictive sandbox for the OS user-profile preflight; do not add a shim.
Offline guard: D:/Accounting/.tmp/mas-transport-investigation/offline-fetch-guard.cjs.
Local logs: D:/Accounting/.tmp/mas-transport-investigation/integration-{install,lint,build,smoke}.log.

## Browser check

Preview: https://codex-mas-transport-investigation-accounting.dexrrick-goh.workers.dev/

The user configured the provider directly in Settings. The UI showed Gemini 3.5-flash-lite Connected. No credential was read, copied or saved into repository files.

Question tested: What are MAS's admission criteria and applicable requirements for fund management licensing in Singapore? Cite the official MAS guidance and state any limits on what you can verify.

The browser returned a response, but still displayed Evidence Incomplete — Review Required. It did not demonstrate the approved-document citation/version binding established by the isolated captured-source lifecycle tests. This is partial browser acceptance, not a verified positive live answer. The initial missing-provider blocker is resolved; the governed live-answer integration remains open. Do not infer legal approval or change the production registry to make this check pass.

## Resume in this order

1. Inspect this checkpoint and the diff from 3189690; preserve both earlier draft checkpoints.
2. Re-review only the final version-ID reservation/allocation delta with the reviewer, including the original alias probe. Previously cleared PDF/transport work need not be repeated without relevant changes.
3. Run focused phase4_live_retrieval and shared_document_admission regressions, then final lint/build/smoke on the completed code. Run full validation through the main-based PR CI after pushing the reviewed integration commits; fix any relevant failures.
4. Update PR #21's description with the four review fixes, final validation and the actual browser limitation. Its current description still records the earlier missing-provider state.
5. Verify current main/PR refs and production invariants before any release decision. Keep draft until the remaining gates are satisfied; merging main triggers production deployment through the existing setup.
6. Resolve governed MAS browser answer acceptance before broader authority work, production monitoring or scheduling. ACRA PR #12 remains deferred.

Agent work was interrupted for this stop. No automatic continuation or future wakeup was scheduled.
