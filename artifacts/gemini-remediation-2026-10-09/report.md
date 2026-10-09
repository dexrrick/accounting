# Gemini failure remediation checkpoint

Status: implementation and repository validation complete; the subsequent fresh nine-case Gemini rerun is complete. All nine API calls succeeded, but five cases passed all diagnostic stages and four failed downstream checks. This file is the safe stopping point for the next repair cycle.

## Diagnosis

The retained nine cases originally contain three passes and six failures. Four usable Gemini interpretations pass all five semantic gates; five unavailable responses cannot be assessed. The remaining-six run contains four final timeouts and one HTTP 503, with subsequent inventory failures obscuring several original provider errors.

Gemini interprets the question and returns structured scope; the application selects official sources. The retained CPF paraphrase failure is an evidence-admission scope bug: the provisional topic excludes registered CPF context, rejects available CPF evidence, and attempts unnecessary SRS discovery. The saved evidence does not justify loosening accounting or source-integrity rules or claiming that Gemini lacks source documents.

## Implemented changes

- Managed Gemini interpretation retries transient failures once, with jitter, an eight-second cap per attempt and an eighteen-second total budget. Cancellation, permanent failures and malformed responses do not retry. Injected evaluation transports retain their existing four-option contract and one invocation.
- Results preserve sanitized provider attempt chronology and downstream failures. An unavailable response reports `NOT_ASSESSED`; a recovered retry preserves the earlier attempt without labeling the final successful response a failure.
- Provisional IRAS targets can admit evidence through registered topics in the same routed domain, while coverage remains assessed against requested targets. Existing provenance, period, population, concept and quality gates remain active. Bounded traces explain admission and rejection.
- A diagnostic harness replays only retained responses and captured source bytes, validates hashes and inventory identity, blocks ambient network, and checks original inputs remain unchanged.

## Evidence and limits

`latest-results-diagnostic.json` contains the derived diagnostic. All four usable saved responses pass the replayed acceptance stages after remediation. The CPF replay uses its captured CPF source without an SRS request; an auxiliary inspection records the coverage decision. Employer CPF remains insufficient, and case application remains unresolved when material facts are missing. Separate SRS and corporate scopes are not closed by individual CPF evidence.

No live Gemini or official-source calls were made during implementation validation. The subsequent user-authorized live Gemini rerun is recorded below. Historical captures and consumed-run inputs remain unchanged. Offline implementation results do not establish a fresh nine-case acceptance pass.

## Validation checkpoint

- Passed: targeted transport, semantic operations, residency compatibility, failure attribution, retained offline diagnostic, scoped IRAS evidence reuse, authority discovery, official citation fallback, acceptance adapter and capture/replay runner regressions.
- Passed: TypeScript checks, scoped lint, repository lint and production build. Repository lint and build were rerun successfully after the final compatibility fix (`lint-final.log`, `build-final.log`). Existing lint and bundle/deprecation warnings remain.
- Initial smoke run: one injected-transport compatibility failure; fixed and its targeted regression passed.
- Final smoke: passed, all suites green, 97.94 seconds (`smoke-final.log`).
- Full suite: passed, all suites green, 160.46 seconds (`full-final.log`).
- `git diff --check`: passed. Historical capture and consumed-run inputs are absent from the changed-file list, and the retained diagnostic checks their hashes remain unchanged.
- The previous final-validation launch was not executed because automatic approval review hit a usage limit. Both final suites subsequently executed with approval after usage became available. The latest usage check reported ordinary usage allowed, 95% five-hour remaining and 78% weekly remaining; no usage reset or credits were consumed.
- Independent review found no material issues in the main change or the narrow follow-up review of the final injected-transport compatibility fix.

## Safe stopping point and subsequent work

1. Read this report and `git status --short`; preserve existing edits.
2. Check usage before broad work. Stop with an updated checkpoint before either reported window has 5% remaining; do not consume a reset or purchase credits automatically.
3. Repository validation is complete; do not rerun passing suites unless code changes or new evidence justifies it. Windows integrity tests required approved unsandboxed execution because sandboxed `realpath` raises EPERM.
4. If proceeding to live verification, use a new run and its own inventory/capture/consumption records, preserving historical runs. Record actual transport attempts and source failures separately. Do not claim live recovery without that separately recorded fresh run.

## Changed files

Production changes: `src/services/aiTransport.ts`, `src/services/semanticQuestionUnderstanding.ts`, `src/services/groundingContextBuilder.ts`.

Diagnostics and acceptance reporting: `scripts/gemini_failure_diagnostics.mjs`, `scripts/diagnose_latest_gemini_results.mjs`, `scripts/iras_v4_production_acceptance_adapter.mjs`, `scripts/iras_v4_capture_replay_runner.mjs`.

Regression changes: `scripts/run_all_tests.mjs`, `tests/regression/test_gemini_provider_diagnostics.mjs`, `tests/regression/test_semantic_operations.mjs`, `tests/regression/test_gemini_failure_diagnostics.mjs`, `tests/regression/test_latest_gemini_offline_diagnostic.mjs`, `tests/regression/test_iras_scoped_fallback_reuse.mjs`.

## Authorized live rerun checkpoint

The user subsequently requested: "since it is completed let's do the gemini call again". The supervisor is preparing a fresh nine-case diagnostic using the configured `.env.local` credential, the same `gemini-3.5-flash-lite` model and production transport with bounded retry (at most eighteen requests across nine cases). There will be no provider probes or new official-source requests. Source evaluation uses the retained capture at its original reference date, separately from the current live provider execution timestamp. Existing historical run namespaces remain immutable.

The fresh launcher passed its four offline regression tests, scoped lint (one unused test-seam parameter warning), and independent review. Its real CLI `--check` passed with zero credential reads or network requests. A fresh tool observation before execution reported 82% five-hour remaining and 76% weekly remaining (`live-usage-observation.json`).

Execution finished in `live-rerun-2026-10-09`: nine HTTP 200 responses, zero retries/timeouts/HTTP errors, five diagnostic passes and four failures. The journal contains all nine cases, historical input hashes remain unchanged, and no new official-source requests or ambient network attempts were observed. Never relaunch into this consumed directory.

See `live-rerun-2026-10-09/report.md` and `failure-analysis.json`. The new failures involve subject-only scoring, unmapped generic concepts and an uncaptured withholding URL. The requested rerun is complete; the next stopping point is a scoped repair of these issues, preserving material scope and source-integrity guards.

Completion usage observation at 2026-10-09T00:48:49Z: ordinary usage allowed; 77% five-hour remaining and 75% weekly remaining. All completed records are saved, and no live execution remains pending.
