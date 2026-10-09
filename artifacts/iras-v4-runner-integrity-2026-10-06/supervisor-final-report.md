# Supervisor runner-integrity checkpoint — 06/10/2026

**Reviewed runner and offline controls are committed. Configuration freeze and live acceptance remain HOLD.** This is a safe stopping checkpoint, not completion of the full runner-integrity phase.

The reviewed API-free baseline was committed at `42637dfb552dae45ed3cb72f4f495d6528a14272`. The new runner, regression, design and review records are committed at `187cdcda556a69703245197446376c8a7c9d2f2c` on `codex/multi-authority-workstreams`. Production, the existing evaluator, V4 contract JSON, test registration and consumed history remain unchanged.

The runner implements file-byte/HEAD/reviewed-commit/ancestry bindings, fixed capture and semantic budgets, response deadlines and raw-byte diagnostics, strict reusable replay, terminal integrity latches, guarded Node networking, complete history input inventories and exclusive execution reservation. Independent review exposed seven material issues; the builder corrected all seven and independent re-review closed them. Final Node 22 syntax checks, targeted lint with no warnings and the focused regression with external networking blocked pass. See `independent-review.md` and `validation.json` for exact hashes and scope.

## Actual final-verification failure

The supervisor attempted exclusive creation of `FROZEN_RUNNER_CONFIGURATION` using the actual committed checkout. Windows rejected the complete single Git-status argument vector with `spawn ENAMETOOLONG` at `collectCheckoutIntegritySnapshot`. This exposed a real inventory-scale issue not covered by small fixture repositories. The operation failed before creating `runner-configuration.json`; no freeze was performed. The earlier review signoff does not cover this newly observed failure.

**Next required step:** batch or otherwise bound Git-status arguments without omitting any inventory path. Add a focused scale control, run targeted validation, obtain independent review, commit the correction, and retry exclusive configuration creation. Then verify the frozen binding and probe a valid configuration with missing acquisition inventory/adapter to confirm live HOLD before dispatch. The existing live HOLD tests cover missing permits and invalid profiles only.

A runner configuration is separate from full V4 acceptance preregistration. After integrity freeze succeeds, a separately reviewed acquisition inventory, production observation adapter and contemporaneous official evidence corpus remain prerequisites for targeted acceptance. Captures must remain at most 24 hours old. Do not capture official pages while these prerequisites are unfinished. Do not treat synthetic passing cases or metadata-shaped hashes as official evidence or live acceptance.

## Resource and preservation boundary

The checkpoint was first saved at 12% five-hour remaining. Closure began at 8% five-hour /43% weekly remaining, above the user's 5% five-hour floor. No reset credit was used. No further implementation cycle was started after the final-verification failure because the 10% preparation threshold had been crossed.

No official/provider request, live consumption reservation, push, merge or deployment occurred. Runtime fixtures and synthetic reservations were temporary test-only data. The retained log is `.tmp/v4-runner-integrity-final.log`, SHA-256 `769bcb00c2554bd52c4a3696410187ae5bea465d8ab40d064fbbd9606b6e7713`. Checkpoint records are in this artifact directory, outside the protected-history traversal.

Reproduce the focused regression from `D:\Accounting` with the approved Node 22 executable:

```powershell
& 'C:\nvm4w\nodejs\node.exe' --import ./node_modules/tsx/dist/loader.mjs --import ./docs/evaluation/multi-authority-workstreams/iras-v4-negative-controls-2026-10-06/block-external-network.mjs tests/regression/test_iras_v4_capture_replay_runner.mjs
```

Use the explicit bundled Git executable `C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe`; the PATH Git shim is broken. Node 22 requires approved escalated execution in the current sandbox. Resume from this report and the committed source rather than from the earlier incomplete runner drafts.
