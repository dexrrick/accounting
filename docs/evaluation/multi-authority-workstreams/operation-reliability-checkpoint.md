# Stopping point — operation and reliability follow-up

30/09/2026, supervisor checkpoint in `D:\Accounting`, branch `codex/multi-authority-workstreams`. Base before this follow-up: `e67309a`. The commit containing this checkpoint completes the requested audit, bounded experiments, scoped implementation, independent review and final verification. Find its exact SHA with `git log -1`; no merge, push or deployment was performed.

The user requested a stopping point before usage exhaustion, then authorized finishing with a 7% remaining-usage floor. At the usage check, the account showed 68% used / 32% remaining in the five-hour window and 86% used / 14% remaining in the weekly window. These are a dated snapshot, not a promise of current availability. This cycle stops after committing and verifying the completed work; no additional investigation, live calls or automation is started.

## Completed

- Audited all 15 corrected matched-operation failures and the one held-out failure before production edits. Held-out observations were descriptive only.
- Improved generic per-issue operation guidance and mixed-operation legacy projection consistency. Added fixed-enum failure diagnostics; the runner preserves safe reasons on checkpoints, final rows and attempts.
- Kept strict validator acceptance, valid-operation preservation, evidence gates, routing, accounting/statutory/source rules and the 8-second production deadline unchanged.
- Controlled baseline: 16 calls, 8s arm 5/8 valid versus 15s arm 6/8 valid; zero timeouts, maximum 4,821 ms. Longer timeout did not demonstrate recovery. Four contradictory responses and one malformed JSON response were retained as safe diagnostics.
- Final once-only probes: 12 operation cases plus two reliability cases, 14 requests, 11 valid, three invalid, no retries/429s/timeouts; minimum start gap 15,251 ms.
- Seven fixed comparable development cases: matched operations 3/14 → 12/14, recall 14/14 unchanged, precision 14/15 → 14/14, complete issue coverage 6/7 → 7/7, routing 7/7 unchanged. New controls were scored separately.
- Builder implementation and independent reviewer cleared the code. Supervisor inspected the changes and results. Reviewer also supports holding merge.
- Node.js 22.23.1 focused checks, lint, build, smoke 49/49, full 69/69 and `git diff --check` passed. Existing lint/build warnings remain. No substantive answer correctness was measured by the live routing checks.
- Historical corrected/held-out reports and frozen fixture fingerprints match the protected manifest. No secret or invalid response body was added.

## Remaining issues and next scope

**Hold merge to main.** A-paraphrase-2 employer contribution and adversarial employee accommodation tax still select EXPLAIN_RULE for applied outcomes. A-paraphrase-3 still fails with CONTRADICTORY_FIELDS. General-recognition and general-interaction controls fail with SCHEMA_MISMATCH; absent matched pre-change controls, these are not proven new regressions. The valid general-comparison, journal and employer-filing controls retain the expected operations.

A separate future task can investigate generic contract consistency and safe field-level rejection diagnostics using independent development controls. Preserve strict rejection and fact gates. Do not introduce keyword operation replacements, change statutory conclusions/coverage, tune held-out cases, relabel frozen benchmarks, or overwrite/retry the saved once-only results to hide failures. No further work is active or scheduled.

## Files to read on resumption

1. `operation-reliability-audit.md` — full failure table, exact changes, experiment decision, before/after results, reviewer resolutions and limits.
2. `operation-reliability-comparison.json` — selected-case metrics and actual operations, independent controls, all final outcomes and request pacing.
3. `semantic-timeout-controlled-baseline.{json,md}` — frozen controlled baseline experiment.
4. `semantic-operation-followup-live.{json,md}` and `semantic-reliability-post-guidance-live.{json,md}` — final once-only probes.
5. `operation-reliability-protected-hashes.json` — immutable historical/frozen fixture fingerprints; baseline/post inspections contain prompt/source hashes and sizes.

Final interpreter SHA-256: `2e8c6cac5e0e5a2bb802823f30cb6c2af35040300c7e93eff519e65467893505`. Measured prompts add only four characters versus baseline; system instruction remains unchanged. All new live artifacts use new filenames.

Production changes: `src/services/semanticQuestionUnderstanding.ts`. Evaluation changes: `tests/evaluation/singapore/multi-authority-workstreams-live-evaluation.mjs`, new `semantic-reliability-experiment.mjs` and two bounded fixtures. Regression changes: new semantic-operation and experiment-harness tests, runner-safety additions, and smoke/full registration in `scripts/run_all_tests.mjs`.

Use `C:\Users\Admin\AppData\Local\node-v22.23.1-win-x64\node.exe` and the adjacent `npm.cmd`, with that directory first in PATH. The working Git binary is `C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe`. Validation logs are ignored `.tmp-ci/operation-followup-{lint,build,smoke,full}.log`; they need not be rerun unless relevant code changes. Existing credentials remain only in ignored configuration; do not print `.env.local`.
