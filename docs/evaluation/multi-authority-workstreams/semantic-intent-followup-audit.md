# Semantic intent follow-up audit

01/10/2026, `D:\Accounting`, branch `codex/multi-authority-workstreams`.

**HOLD MERGE.** The two previously missed operations select the intended values in the new targeted observations, but a personal-relief operation mismatch, an accounting-authority/routing mismatch and two independent-control timeouts prevent acceptance. The targeted probe stopped after its fixed eight requests; the conditional final ten-case evaluation was not run. No retry, subsequent tuning, merge, push or deployment occurred.

## Preserved starting point

The request described the reviewed V2 changes as uncommitted. Actual inspection found a clean tree at `4d4655d0f51d033a86df0279d4ddd7600763484e`; its thirteen-file diff against `9450e98` and interpreter hash matched the reviewed audit. Checkpoint commit `887cc38f3e727076bf9ad19113ad422e17c10c18` preserves that state and records the reviewed result before additional production changes. Reviewed work was not reset or overwritten. All 23 protected historical files and frozen fixtures still match `semantic-intent-protected-hashes.json` after live capture.

## Diagnosis and implementation

The employer payable error was operation interpretation, not arithmetic, response validation or routing. The old dense paragraph mentioned implied payable values but did not sharply separate requested numeric output from liability classification and withholding procedures. The applied-benefit error similarly selected general-rule explanation for a stated arrangement; the correct authority route did not repair the operation. These prompt explanations are reasoned diagnoses, not recovered provider reasoning.

The production change is confined to `RESPONSE_SCHEMA` in `src/services/semanticQuestionUnderstanding.ts`:

- Select CALCULATE for a requested numeric payable/contribution/remittance/deduction/withholding/charge/provided value even without an explicit amount/calculation command. Missing inputs preserve numeric intent and fact gates; numbers alone or illustrations do not establish it.
- Select DETERMINE_TREATMENT for the treatment/classification of a stated transaction, receipt, expense, benefit or person's circumstances. General principles without applying them to a case remain EXPLAIN_RULE. Qualification/entitlement remains CHECK_ELIGIBILITY, including UNKNOWN claimant status.
- Distinguish a withholding amount from a separately requested filing/reporting procedure. Preserve per-issue mixed operations, populations, governing/contextual authorities and case specificity.
- Remove redundant legacy-provider narration and duplicate/internal mapping/population prose; retain exact V2 keys, concept keys, nonempty issues, enum requirements, a complete nested example and explicit authority/domain consistency. Clarify the example's eligibility subject.

No deterministic keyword operation replacement, benchmark phrase patch, validator/projection/routing/transport change, accounting/statutory rule change, timeout increase or dependency was introduced. V2 and legacy acceptance/rejection remain strict. The schema prompt is 8,460 characters versus V2's 8,622, a reduction of 162 (1.9%); the system instruction remains 259. The same recognition question changed from 8,726 to 8,564 prompt characters. This small reduction does not establish a latency improvement.

Twelve new independent no-API families cover implicit employer contribution, withholding/remittance amount, tax-liability classification, eligibility with numbers, conceptual illustrative amounts, general benefits, concrete benefit/receipt/expense treatment, general concepts, mixed calculation/filing and UNKNOWN population with contextual MOM. Mocked V2 responses check strict contract retention, derived evidence/fact gates and routing; they do not demonstrate model inference accuracy. The implicit employer question contains none of `amount`, `how much` or `calculate`.

## Review and measurement integrity

Independent implementation review identified an acceptance gap: live scoring did not compare the top case-specific flag with fixed expectations. The builder added supplemental expected/actual booleans and negative tests for schema-valid wrong flags in both directions. A second review corrected the supervisor's initial corporate-filing expectation to false: the unchanged question asks general filing guidance. Both findings were resolved and independently cleared before live calls.

The default historical V2 runner retains its filenames, loader and scoring. New fixed profiles reuse the reviewed safe harness: `intent-targeted` selects three known failures plus five independent controls; `intent-final` selects the unchanged original ten. New filenames refuse overwrite. Intent acceptance requires validity, complete coverage/no extra issues, all issue dimensions/operations, fixed case specificity, routing and runtime guards. Supplemental strict checks require employer CALCULATE and applied-benefit DETERMINE_TREATMENT without changing broader frozen historical operation labels. Source, wrapper and relevant fixture hashes are monitored during capture. Diagnostics omit questions/prompts, provider bodies, label text, supplied facts, unknown property names, credentials and arbitrary errors.

## Once-only targeted live result

`semantic-intent-targeted-live.json` and `.md`: exactly eight requests, one per case, Gemini `gemini-3.5-flash-lite`, temperature zero, JSON mode, 8,000 ms, no retries; minimum measured start gap **16,808 ms**, above 15,250 ms. Source/fixture fingerprints are stable. Six valid V2 responses, no invalid/low-confidence/provider-error/429 responses, two timeouts. All six valid fact flags and all 48 runtime guard checks pass; timeout guards are unassessed. All six valid runtime evidence statuses remain INSUFFICIENT. These checks do not measure substantive accounting answers.

| Measure | Prior V2 ten-case result | New targeted eight-case result |
| --- | ---: | ---: |
| Valid interpretations | 9/10 | 6/8 |
| Recall on valid responses | 13/13 | 7/7 |
| Recall over all expected issues | 13/14 | 7/9 |
| Precision on valid responses | 13/13 | 7/7 |
| Matched-operation accuracy | 11/13 | 6/7 |
| Complete issue coverage | 9/10 | 6/8 |
| Routing on valid / all cases | 9/9 / 9/10 | 5/6 / 5/8 |
| Invalid responses | 0/10 | 0/8 |
| Timeouts | 1/10 | 2/8 |
| Supplemental strict intent acceptance | Not measured | 4/8 |

These are different selections with different valid/matched denominators; they must not be treated as a comparable final-ten rerun or evidence of broad statistical improvement. The three shared known cases have 3/3 valid, 4/4 recall/precision, 3/4 operations and 2/3 routing. The five independent controls have 3/5 valid, 3/3 valid recall/precision/operations, 3/5 overall recall/complete coverage, 3/3 valid routing and two timeouts.

| Case | Observed outcome |
| --- | --- |
| A-paraphrase-2 | Employer correctly CALCULATE. Personal-relief issue also CALCULATE, outside its frozen CHECK_ELIGIBILITY/DETERMINE_TREATMENT labels; operations 1/2, acceptance false. Requested-output distinction is not reliably resolved across the full mixed question. |
| adversarial-C-employee-benefit | Correct DETERMINE_TREATMENT, case flag true, correct routing; acceptance true. |
| control-general-recognition | Valid EXPLAIN_RULE, UNKNOWN population and false case flag in 1,549.31 ms. Governor IFRS_FOUNDATION instead of frozen ACCOUNTING_STANDARDS; authority and canonical workstream checks fail. IFRS_FOUNDATION is validator-allowed; this is an observed canonical contract/routing mismatch, not proof that the authority is substantively fictitious. No labels were changed to obtain a pass. |
| employer-cpf-implicit-calculation | TIMEOUT at 8,008.14 ms; no body; operation unassessed. |
| wht-payment-amount-calculation | Correct CALCULATE; acceptance true. |
| general-employment-benefit-rule | Correct EXPLAIN_RULE and false case flag; acceptance true. |
| specific-employee-benefit-treatment | TIMEOUT at 8,014.06 ms; no body; operation unassessed. |
| withholding-tax-liability-classification | Correct DETERMINE_TREATMENT rather than calculation; acceptance true. |

## Timeout and final validation

See `semantic-intent-timeout-analysis.md`. The original recognition timeout did not recur, but two new independent controls timed out. Their prompts (8,643 and 8,661 characters) overlap successful request sizes (8,564–8,658). The six successful new calls took 1,549.31–2,242.99 ms, median 1,705.97 ms, and returned 976–1,522 characters. The timed-out bodies and provider processing/finish metadata remain unavailable. Request structure/size and the prior controlled experiment do not justify a larger production deadline. Retain eight seconds and no retries; isolated provider latency is plausible, not convincingly established for acceptance. Reliability remains unresolved.

Node.js **22.23.1**: targeted operations/boundary/new and historical runner checks, V2/legacy contract, diagnostics/privacy, semantic understanding, routing priority and decomposition pass. Lint and production build pass with existing warnings. Final smoke **54/54** and full **74/74** pass (full 92.74 seconds); focused runner checks also pass after the final evaluation-only expectation correction. `git diff --check` passes. Production interpreter SHA-256: `b5f6091a231169146b026b8eafacd48d96e20c763d5f636157b23f1fb6e60133`.

Changed implementation files: `src/services/semanticQuestionUnderstanding.ts`; `scripts/run_all_tests.mjs`; `tests/regression/test_semantic_operations.mjs`; new `test_semantic_intent_boundaries.mjs` and `test_semantic_intent_followup_runner.mjs`; `tests/evaluation/singapore/semantic-contract-followup-evaluation.mjs`; new `semantic-intent-followup-evaluation.mjs` and `semantic-intent-boundaries.json`. Documentation/artifacts: starting checkpoint, this audit, timeout analysis, protected hashes, targeted JSON/Markdown reports and the new resume checkpoint. Historical files remain unchanged.

Pre-live usage was 78% five-hour / 91% weekly remaining. The 7% floor was respected; no reset credit was consumed. The independent saved-results reviewer also recommends **HOLD MERGE** and confirmed all metrics, call/pacing integrity, fact flags, runtime guards, current fingerprints and all 23 protected hashes, with no material reporting/privacy findings. Final commit details are recorded in the resume checkpoint. Stop here: no additional calls, tuning or scheduled work.
