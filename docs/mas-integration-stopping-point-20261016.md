# MAS integration stopping point — 16 October 2026

Status: intentionally stopped at the user's request. Do not treat the integration as release-ready.

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
