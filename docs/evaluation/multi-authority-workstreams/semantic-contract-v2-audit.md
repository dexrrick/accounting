# Semantic wire contract V2 follow-up

30/09/2026. Starting point: `9450e98`, branch `codex/multi-authority-workstreams`, clean checkout. The supervisor retains contract design, accounting/statutory judgment, benchmark integrity, final verification and merge recommendation. Scoped builders implement the production contract/regressions and the independent probe harness; an independent reviewer examines the completed changes before live evaluation.

## Contract and implementation boundary

The new provider wire contract uses `schemaVersion: 2`. It omits `calculationRequested`, requires a nonempty `issues` array, and projects into the existing internal interpretation type. The application derives the top-level flag from `requestedOperation === "CALCULATE"`, not from any per-issue calculation. Unversioned legacy responses retain their original exact-key validation and contradictory-flag rejection. Unknown versions, extra fields, missing fields and malformed concepts remain invalid.

The prompt explicitly defines concepts as objects with exactly `concept` and `role` and includes safe nonempty examples. Generic operation guidance distinguishes numerical results, including implied payable amounts, from applied treatment, eligibility, general rules, interaction, comparison, journals and filing. Illustrative amounts do not establish calculation intent. No keyword operation override, benchmark phrase patch, frozen-label change or statutory/source-coverage expansion is authorized.

The eight named operations and OTHER are covered by no-API regressions, alongside migration, mixed operations, UNKNOWN population, contextual authorities, fact/evidence gates and validator strictness. These tests verify contracts and downstream behavior; injected interpretations cannot establish live model accuracy.

## Fixed measurement and historical comparison

The frozen ten-case fixture is `tests/evaluation/singapore/semantic-contract-followup.json`. Five cases are previously failing development cases and five are independent controls fixed before this cycle. The new probe runs each once through the configured Gemini model at the unchanged eight-second timeout, without retries and with at least 15,250 ms between request starts. It refuses existing output filenames and retains only safe field diagnostics and scoring metadata. Questions, provider bodies, labels, supplied facts, unknown property names, credentials and arbitrary exception messages are not persisted.

Historical five-case comparison comes from the immutable `contract-followup-comparable-baseline.json`:

| Measure | Historical known failures |
| --- | ---: |
| Valid interpretations | 2/5 |
| Issue recall, valid interpretations | 3/3 |
| Issue recall, all expected issues | 3/8 |
| Issue precision, valid interpretations | 3/3 |
| Matched-issue operation accuracy | 1/3 |
| Complete question issue coverage, all cases | 2/5 |
| Workstream routing, valid interpretations | 2/2 |
| Workstream routing, all cases | 2/5 |
| Invalid-response rate | 3/5 |

The five independent controls have no historical comparable calls. Invalid interpretations have no predicted-issue or matched-operation denominator; all-case recall/complete-coverage/routing results expose their impact separately. Workstream-set and runtime guard checks do not measure substantive accounting or statutory answer correctness. This small selected sample cannot establish broad causal improvement or population-wide reliability.

## Review, results and final verification

Implementation and independent review are complete. The reviewer found no remaining material code risk and cleared the fixed probe after local validation. Findings resolved before live calls: preserve exact version/concept diagnostic codes; add direct V2 OTHER-with-CALCULATE and missing concept-key tests; distinguish transport failures from invalid responses; count all unresolved application issues including filing; preserve the distinction between verified evidence and unresolved application; and filter application expectations by planned issue IDs so UNKNOWN-governor abstention is not misreported as an application regression.

The supervisor inspected the implementation and the reviewer findings. No source-selection, source-admission, accounting measurement, statutory knowledge, authority-workstream or AI-transport code changed. Production timeout remains 8,000 ms. The final interpreter SHA-256 is `c152ecf2360ebc68fc4d6c5043e73e8dc2668cb5f342b983e07361549671de9a`; measured synthetic prompt size is 8,750 characters.

Changed production/evaluation/test files:

- `src/services/semanticQuestionUnderstanding.ts`
- `tests/evaluation/singapore/semantic-contract-diagnosis.mjs`
- New `tests/evaluation/singapore/semantic-contract-followup-evaluation.mjs`
- New `tests/regression/test_semantic_wire_contract.mjs`
- New `tests/regression/test_semantic_contract_followup_runner.mjs`
- `tests/regression/test_semantic_operations.mjs`
- `tests/regression/test_semantic_contract_diagnostics.mjs`
- `tests/regression/test_material_issue_decomposition.mjs` (obsolete prompt-prose assertions only)
- `scripts/run_all_tests.mjs`

Targeted checks pass under Node.js 22.23.1: wire contract, per-issue operations, diagnostics/privacy, probe mocks, material decomposition, semantic understanding, authority workstreams and routing priority. Lint and production build pass with existing warnings. Smoke passes 52/52 (36.82 seconds); full passes 72/72 (115.49 seconds).

Historical protected hashes were checked before and after implementation: contract-followup manifest 12/12 and operation-reliability manifest 7/7 match. `git diff --check` passes. No prior diagnostic requests were repeated.

## Final once-only live results

Saved to new `semantic-contract-followup-v2-live.json` and `.md`. Exactly 10 requests, one per case, with no retries. All calls use `gemini-3.5-flash-lite` and the unchanged 8,000 ms deadline. Minimum observed request-start gap: 17,013 ms. There are nine provider responses, nine valid V2 interpretations, no invalid schema responses, no low-confidence results, no provider errors and no 429s. One request times out; its measured elapsed time is 8,007.84 ms, including abort/return overhead. All source/fixture fingerprints remain stable throughout capture.

| Measure | Five known failures | Five independent controls | Combined ten |
| --- | ---: | ---: | ---: |
| Valid interpretations | 4/5 | 5/5 | 9/10 |
| Issue recall, valid interpretations | 7/7 | 6/6 | 13/13 |
| Issue recall, all expected issues | 7/8 | 6/6 | 13/14 |
| Issue precision, valid interpretations | 7/7 | 6/6 | 13/13 |
| Matched-issue operation accuracy | 5/7 | 6/6 | 11/13 |
| Complete question issue coverage, all cases | 4/5 | 5/5 | 9/10 |
| Workstream routing, valid interpretations | 4/4 | 5/5 | 9/9 |
| Workstream routing, all cases | 4/5 | 5/5 | 9/10 |
| Invalid-response rate | 0/5 | 0/5 | 0/10 |
| Timeout rate | 1/5 | 0/5 | 1/10 |
| Provider-error / rate-limit rate | 0/5 / 0/5 | 0/5 / 0/5 | 0/10 / 0/10 |

Runtime evidence/application/operation guards pass for 9/9 valid cases (known failures 4/4, controls 5/5), with all 72 individual guard checks passing. The timed-out case is unassessed, not a passing guard observation. All nine valid cases retain INSUFFICIENT evidence; correct workstream sets do not establish substantive answer correctness. Complete question issue coverage measures issue presence, not correct operations or complete answers.

For the five historical comparable failures: valid interpretations 2/5 → 4/5; matched operation accuracy 1/3 → 5/7; conditional issue recall 3/3 → 7/7; all-case recall 3/8 → 7/8; conditional precision 3/3 → 7/7; complete issue coverage 2/5 → 4/5; conditional routing 2/2 → 4/4; all-case routing 2/5 → 4/5; invalid responses 3/5 → 0/5, with a new timeout 1/5. Changing valid/matched denominators must remain visible. These are descriptive observations from a small selected sample with changed prompt and time, not evidence of broad causal improvement.

Remaining outcomes:

- `A-paraphrase-2`: personal relief is DETERMINE_TREATMENT; employer payable contribution is also DETERMINE_TREATMENT and fails its frozen numeric/eligibility operation contract. The employer operation changed from historical EXPLAIN_RULE but still misses the numerical intent. Case-fact gating now remains active for that issue.
- `adversarial-C-employee-benefit`: EXPLAIN_RULE still fails the applied-treatment/eligibility contract, with source-only evidence and no case-specific flag. Correct routing alone does not repair this error.
- `control-general-recognition`: TIMEOUT; no response body or post-change concept shape is available. Its prior schema defect is not demonstrated resolved by this observation.
- `control-general-interaction`: valid V2, safe exact concept shape and EXPLAIN_INTERACTION in this observation.
- `A-paraphrase-3`: valid V2 with top OTHER and two per-issue CALCULATE operations; the internal top calculation flag is deterministically false. No contradictory wire flag is requested or accepted.
- All five independent controls validate and match the six expected issue operations, including the illustrative-amount conceptual question and mixed journal/calculation question.

No semantic code was changed after live measurement and no case was retried. Retain eight seconds: one new timeout is a bounded transport observation and does not demonstrate that a longer deadline repairs the semantic errors. Prior probes had no timeout/429 problem. Any further deadline investigation is separate work requiring a new authorized design; do not silently repeat this fixed suite.

## Merge decision

**HOLD MERGE.** Production contract and regression changes are reviewed and local checks pass, but two known operation-intent failures and one unresolved timed-out conceptual case remain. No merge, push or deployment was performed. The supervisor stops this cycle after preserving the exact results and a new resume checkpoint; no active or scheduled work continues. Changes remain in the working tree based on `9450e98`.

The independent reviewer also inspected the final saved reports and recommends HOLD MERGE. They confirmed all ten source/fixture fingerprints against current files, request/model/timeout/pacing integrity, explicit denominators and safe diagnostics; they found no privacy concern, local routing failure or failed runtime guard. Implementation review remains clear; live acceptance remains incomplete.
