# Private-expense planning residual fix - 03/10/2026

Residual blocker: CLOSED for the diagnosed factual-conjunction case. HOLD MERGE. This checkpoint does not establish application completeness or release acceptance.

## Scope and root cause

Continuation base: `08ce02bbcc3305e1d88ba692f0b5010b0e19b959`. The frozen pre-fix proof at `4af6be29683765f266880de55bf2019b401268f2` was read, not rerun or modified.

The owning-layer cause was the residual heuristic in `QueryTopicResolver.decomposeQuery`: it split factual `and` coordination into request fragments and checked those fragments only against lexical keywords. Whole-query recognition already used registered contextual query patterns. Thus both private-expense tax topics and their single semantic issue mapped correctly, while the payment/recording facts produced two false unresolved fragments.

## Changes

Only production file changed: `src/retrieval/queryTopicResolver.ts`.

The residual decomposition preserves a bounded past-payment/`recorded it as ... expense` factual coordination when its spans contain no recognized request language. Other conjunctions remain residual boundaries. Fragment matching uses existing keywords, token matching, exclusions and registered query patterns. Additional punctuation-delimited clauses after the primary request are checked independently, regardless of their opening verb. Unknown or unsupported fragments are retained; the independent topic inventory and semantic reconciliation are unchanged.

Other changed files:

- `tests/regression/test_factual_conjunction_residual.mjs`: new prospective schema-v2 regression using a fixed private-expense semantic issue.
- `tests/regression/test_iras_rule_concept_support.mjs`: update only the synthetic current-production private-case planning expectations. Rule-evidence and application assertions remain intact, including the unresolved private application.
- `scripts/run_all_tests.mjs`: register the new regression in smoke/full.
- This supervisor report.

## Regression and validation results

- Factual conjunction and punctuation-equivalent forms: both tax topics recognized, one mapped semantic issue, no residual, coverage established.
- Exact frozen foreign-dividend extension: `iras-foreign-sourced-income` remains `UNASSIGNED_QUERY_TOPIC`; coverage remains incomplete.
- Unknown conjunction and punctuation requests, including Provide/Confirm/Please and unknown trailing material: residual retained and coverage fails closed.
- Unsupported journal outcome: resolver residual and unresolved accounting issue retained. Deterministic fallback remains fail closed.
- Focused residual and general-rule concept-support regressions: PASS. Adjacent material-issue and 33-case natural-language resolver checks: PASS, also covered by final suites.
- Node.js 22.23.1: final lint PASS and build PASS, with inherited warnings and no lint warnings in changed files.
- Final smoke: 87/87 PASS, 91.60 seconds. Final full: 107/107 PASS, 161.42 seconds. Diff check: PASS.

The first smoke run had one stale assertion expecting the diagnosed private residual (86/87). That current-production regression expectation was corrected without changing evidence or application gates, and final smoke/full passed.

## Independent review and stop boundary

The reviewer identified an additional imperative-request gap in the initial punctuation handling. The builder repaired it by checking all clauses after the primary request, rather than relying on an exhaustive starter list, and added focused controls. The reviewer independently inspected the revised production code, tests and expectation update: no remaining material findings. Revised focused tests and final validation passed afterward.

Consumed historical V1-V9 evaluations, fixtures and the frozen probe remain unchanged. Suite harness-safety regressions used their existing temporary synthetic workflow; consumed captures were not rerun or rescored. No changes to model prompts, provider schema, IRAS evidence rules, source maps, evidence retrieval, quote verification, accounting rules or application gates. No new nine-case targeted acceptance, final profile, merge, push or deployment was run.

This closes the diagnosed planning residual only. It does not resolve taxpayer application facts, establish model interpretation accuracy, or authorize the separate acceptance phase. Work stops at this clean checkpoint; its exact commit SHA is returned with the completion report.
