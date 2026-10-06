# Supervisor checkpoint — 06/10/2026

The reviewed API-free baseline was committed as `42637dfb552dae45ed3cb72f4f495d6528a14272` on `codex/multi-authority-workstreams`. Its saved hashes and all 389 historical rows / 221 paths were checked before commit. Production, the existing evaluator, V4 contract JSON and test registration remain unchanged.

The new integrity runner and isolated regression are implemented but remain uncommitted. Independent review found seven material issues. The builder corrected them and passed Node 22 syntax checks, targeted oxlint with no warnings, and the focused regression with the preserved external-network blocker. Focused independent re-review closed six findings.

**Runner freeze remains HOLD for one P2 finding:** committed/raw-byte bindings cover the 389 V9 historical-plan rows but must also include the complete current protected-history inventory returned by the evaluator's existing traversal. Preserve its V4-directory exclusions. This is the only material finding remaining in the second review.

Latest independently checked pre-final-fix hashes:

- Runner: `12d0f94fdfdb39165ec78773226d7bd7858beae994d93c1457fbd1b07eec763a`.
- Regression: `c28f4fd40cd68f6741015f798d9a4732544ff34230fc07dbe9178d91fd3de33d`.
- `.tmp/v4-runner-integrity-final.log`: `769bcb00c2554bd52c4a3696410187ae5bea465d8ab40d064fbbd9606b6e7713`.

Final correction requires another narrow validation and independent check. After signoff, commit runner/test/design, then exclusively write and verify `FROZEN_RUNNER_CONFIGURATION`. This is separate from full V4 acceptance preregistration. A valid frozen configuration with missing acquisition inventory/adapter needs a post-commit HOLD probe; the current regression proves missing-permit/invalid-profile rejection only.

No official evidence capture, provider call, live acceptance reservation, push, merge or deployment occurred. Live acquisition and acceptance remain HOLD for a separately reviewed inventory, production observation adapter, full preregistration and current bound official corpus.

Reproduce the focused offline run from `D:\Accounting`:

```powershell
& 'C:\nvm4w\nodejs\node.exe' --import ./node_modules/tsx/dist/loader.mjs --import ./docs/evaluation/multi-authority-workstreams/iras-v4-negative-controls-2026-10-06/block-external-network.mjs tests/regression/test_iras_v4_capture_replay_runner.mjs
```

Node 22 requires the approved escalated execution path in this sandbox. Use the bundled explicit Git executable `C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe`; the PATH shim is broken. Prepare closure at 10% five-hour remaining, finish above 5%, and do not use reset credits. This checkpoint is written before that floor, in response to the user's reminder.
