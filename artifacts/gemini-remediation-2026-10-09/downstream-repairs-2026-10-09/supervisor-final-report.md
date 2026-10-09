# Supervisor repair report — 09/10/2026

Completed the repairs identified in the latest nine-case Gemini diagnostic. All nine retained responses now pass every replay stage. Independent review found no remaining material issues after the supervisor resolved the reported ownership, payment-direction, integrity-reporting and fallback-integration regressions.

## Repairs

- V4 scoring accepts bounded dividend-receipt and GST input-tax issue labels using explicit question facts and structured population. Equivalent plural non-resident-company wording is accepted. Opposite direction, incorrect population, unregistered status, narrowed or mixed subjects, and separate requested outcomes retain negative controls. The existing V2 scorer is unchanged.
- Generic corporate-tax and business-purchase descriptors bind only to the corresponding requested issue. Separate director personal-tax requests and unrelated corporate issues remain unresolved. GST ownership is evaluated before the income-tax-only guard.
- Withholding scope recognizes the payment tense “paid” and preserves payer/recipient distinctions. Registered IRAS source pointers are restored when an uncovered provisional domain has no normal registered fallback selected. Existing same-domain fallback selection, private-expense source claims, and historical/local-only controls are preserved.
- The new replay harness verifies retained response hashes and captured request identities, blocks ambient network, checks protected inputs before and after, reports latched inventory violations as integrity failures, and returns a nonzero CLI status for failed cases.

## Replay evidence

`replay-report.json` records nine passing cases, eleven offline capture lookups, zero new provider calls, zero new source requests, zero ambient network attempts, healthy inventories, and unchanged protected inputs. Missing-fact cases retain conditional/unresolved application outcomes. The employer-contribution and unsupported-topic controls remain insufficient as expected.

This is an offline diagnostic using the retained official-source reference date of 08/10/2026. It does not establish fresh live Gemini acceptance or current official-source availability. Frozen captures, activation records, contract data and consumed-run inputs were preserved.

## Files changed in this repair cycle

- `src/services/authorityWorkstreams.ts`
- `src/services/groundingContextBuilder.ts`
- `src/retrieval/irasRuleConceptSupport.ts`
- `tests/evaluation/singapore/iras-first-targeted-acceptance-v4.mjs`
- `scripts/diagnose_latest_gemini_results.mjs` — shared offline helpers
- `scripts/replay_gemini_downstream_repairs.mjs`
- `scripts/run_all_tests.mjs`
- `tests/regression/test_authority_workstreams.mjs`
- `tests/regression/test_iras_cpf_context_private_enumeration.mjs`
- `tests/regression/test_iras_first_targeted_acceptance_v4.mjs`
- `tests/regression/test_gemini_downstream_repair_boundaries.mjs`
- `tests/regression/test_gemini_downstream_repair_replay.mjs`
- Reports and validation logs in this directory.

Pre-existing workspace edits were preserved. Accounting measurements, statutory rates, source-registry content and provider configuration were not changed in this cycle.

## Validation

- Passed focused V4 acceptance, authority-workstream, general-rule concept-support, CPF/private-context, withholding overview binding, semantic-boundary and nine-response replay regressions.
- `npm run lint`: passed (`lint-final.log`). Existing warnings remain.
- `npm run build`: passed (`build-final.log`). Existing bundle-size and build-option warnings remain.
- `npm run test:smoke`: all suites passed, 97.35 seconds (`smoke-final.log`).
- `npm test`: all suites passed, 160.09 seconds (`full-final.log`).
- `git diff --check`: passed.

The initial sandboxed smoke run encountered Windows temporary-file permission errors and in-progress repair failures. Final smoke and full validation ran outside that sandbox with approval, after the final source refinement. No live integration/provider rerun was performed.

No unresolved repair failures remain. Fresh live acceptance remains a separate verification step.
