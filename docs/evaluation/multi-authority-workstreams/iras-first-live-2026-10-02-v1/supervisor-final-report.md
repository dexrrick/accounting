# IRAS-first v1 supervisor checkpoint — HOLD MERGE

Date: 02/10/2026. Branch: `codex/multi-authority-workstreams`. This cycle is finished at a bounded stopping point. No merge or deployment occurred. The original final ten and new final twelve were not run.

## 1. Root cause of the false case-facts flag

The previous personal CPF-relief response was structurally valid despite `requiresUserSpecificFacts=false`. Eligibility could follow generic-rule prompt guidance, while validation primarily enforced calculation implications rather than checking a specific claimant's application intent. It therefore accepted a contradiction between a personal entitlement request and the root flag. A model's internal reason for choosing that flag is not established by the evidence.

## 2. Adopted semantic invariant

The flag remains model-produced, with deterministic consistency validation; contradictory observations are rejected, never silently rewritten. Supplied facts do not turn a case application into a conceptual question.

| Operation | Invariant |
| --- | --- |
| CALCULATE, DETERMINE_TREATMENT, PREPARE_JOURNAL | Require case facts, including individual issues beneath mixed OTHER. |
| CHECK_ELIGIBILITY | A specific claimant/transaction requires facts; class eligibility, conditions, and who qualifies are general. |
| EXPLAIN_RULE | General by default; explicit application can prove a contradictory false flag. |
| EXPLAIN_INTERACTION, COMPARE, FILING_REQUIREMENT, OTHER | Infer application/general/unknown from query and issue alignment; uncertainty preserves the model flag. |

A false root flag conflicts with any proven applied issue. A true root flag conflicts only when all issues are proven general. Evidence requirements follow each issue's own specificity; unrelated general issues do not automatically inherit a mixed request's applied flag. The V2 wire schema is unchanged.

## 3. Benchmark adjudications

For the explicitly named IFRS 16/SFRS(I) control, either no contextual authority or contextual `IFRS_FOUNDATION` is acceptable; the governing and canonical route remains `ACCOUNTING_STANDARDS`. For the general investment comparison, COMPANY or UNKNOWN is acceptable because no reporting entity is specified. Comprehensive accounting coverage is not claimed. These changes apply only to versioned IRAS-first expectations; historical fixtures/results are unchanged.

## 4. IRAS-first scope

Semantic correctness remains required across all authorities. IRAS additionally requires mapping, the correct canonical area, provider/retrieval progress, complete admitted and verified source support, and no blocking gaps. Missing case facts may leave an application unresolved/overall conditional, but cannot excuse missing rule evidence. The evaluation uses the localOnly runtime path, so it does not establish current authority-page retrieval or substantive answer completion.

## 5. Authority coverage states

IRAS is RELEASE_REQUIRED. CPF, MOM, ACRA, MAS and ACCOUNTING_STANDARDS are PARTIAL. IFRS_FOUNDATION is a partial contextual/accounting alias, not a separate canonical workstream. SSO and UNKNOWN are NOT_YET_COVERED. Inventory counts document existing registries and do not prove source admission, completeness, or readiness. No unrelated authority knowledge was expanded.

## 6. Old versus new gate

The original gate and ten-case profile remain intact. The versioned gate permits visible unsupported non-IRAS coverage while retaining correct semantics, authority ownership, routing and evidence safeguards. IRAS coverage failures still block. Final issue or aggregate VERIFIED requires complete admitted/verified/covered support; partial source lifecycle progress may remain INSUFFICIENT.

Previous six-case observations remain 6/6 JSON and validator-valid with 3/6 old strict acceptance. The fresh targeted set overlaps only two original final-ten questions: its historical recognition metric is 0/3 expected issues, all-dimension cases 0/2. This is a subset comparison, not an original-ten rerun or reevaluation of the old strict gate.

## 7. Files changed

The implementation commit changes 24 files:

- Production semantic contract: `src/services/semanticQuestionUnderstanding.ts`.
- Evaluation and diagnostics: `tests/evaluation/singapore/semantic-contract-diagnosis.mjs`, `semantic-contract-diagnostics.mjs`, `semantic-contract-followup-evaluation.mjs`, `semantic-intent-followup-evaluation.mjs`; new `iras-first-release-contract.mjs` and `iras-first-evaluation-config-v1.json`.
- New fixture and regressions: `tests/fixtures/irasFirstSemanticCases.mjs`; `tests/regression/test_iras_first_semantic_contract.mjs`, `test_iras_first_release_gate.mjs`, `test_iras_first_runner_safety.mjs`.
- Existing regression updates: semantic question understanding, intent boundaries, diagnostics, both follow-up runners, material issue decomposition, resolver coverage, and reliability experiment.
- Suite registration: `scripts/run_all_tests.mjs`.
- Contract documentation: `semantic-query-consistency-contract.md`, this cycle's `release-contract.md`, `benchmark-adjudications.md`, and new historical hash manifest.

This checkpoint also adds fresh live JSON/Markdown, local validation/reviewer evidence, and this report. Accounting measurement, source admission, retrieval/verification production logic, statutory knowledge, and provider schema were not changed.

## 8. Tests added

The case-facts fixture covers 35 operation families plus mixed issues across tax, payroll, employment and accounting, including personal/class eligibility, general conditions, treatment, amounts, illustrative figures, owned facts, audience phrasing, modifiers, supplied facts, and legacy/V2 shapes. Gate negatives cover all nine requested failure categories, false verification, route ownership, orphan/duplicate runtime assignments, residual gaps, and scope failures. Runner tests cover fixed profiles, privacy, unchanged history, pacing, protected outputs, fingerprints, synthetic positive source support, explicit unsupported shells/no-shell outcomes, and forged final prerequisites. Positive source support is labelled synthetic; it does not represent actual release coverage.

## 9. Local validation

All required checks passed on Node.js **22.23.1** before live capture: semantic intent and facts regressions; V2/legacy/provider contracts; authority/relief; resolver (16 cases/22 issues); workstreams/routing; evidence/privacy; gate and safety; lint; build; smoke (63 suites, 43.16 seconds); full suite (83 suites, 125.33 seconds); and `git diff --check`. Existing scratch lint and build-size/deprecation warnings remain. Earlier stale mock/prompt failures were fixed before the final passing runs. See `local-validation-and-review.md`.

## 10. Fresh targeted semantic results

The fixed nine-case capture made exactly nine requests with the existing Gemini model/key, temperature 0, timeout 8,000 ms, no retries. Minimum observed start gap was **17,491 ms**, exceeding 15,250 ms. Pre-live ordinary usage was allowed with 98% primary/63% weekly remaining, above the 7% floor.

Six responses arrived, with complete JSON key shapes, zero unexpected/missing keys and no malformed received JSON. Three passed the strict semantic validator. Three were rejected as CASE_FLAG_CONTRADICTION; three timed out. There were no other transport/provider failures or HTTP 400s. Source/fixture fingerprints remained stable.

| Case | Observed outcome |
| --- | --- |
| target-relief-entitlement | CASE_FLAG_CONTRADICTION; safely rejected. |
| target-relief-amount | CASE_FLAG_CONTRADICTION; safely rejected. |
| A-paraphrase-2 | CASE_FLAG_CONTRADICTION; safely rejected. |
| private-expense-treatment | Validator-valid; contextual-authority mismatch; IRAS NO_COVERAGE_TOPIC/INSUFFICIENT. |
| foreign-dividend-receipt-treatment | All five semantic dimensions and case flag correct; IRAS NO_COVERAGE_TOPIC/INSUFFICIENT. |
| corporate-residency-general-rule | TIMEOUT. |
| target-mixed-ifrs-singapore-accounting | TIMEOUT. |
| dev-investment-comparison | TIMEOUT. |
| unsupported-sfrsi-6-exploration-evaluation | Correct accounting semantics; explicit unsupported INSUFFICIENT; passes scoped contract. |

Accepted issue recall is **3/10** expected issues, precision **3/3** accepted predictions. On those three matches, governing authority/domain/population/operation are each 3/3; contextual authority is 2/3. These matched-only rates are not evidence of overall readiness. Correct case flags are 3/9 cases; overall case acceptance is **1/9**. Rejected and timed-out rows contribute no accepted issue matches.

## 11. IRAS release metrics

There are six expected IRAS issues. Topic mapping is **0/6**; correct canonical shells **2/6**; successful provider path **0/6**; retrieval attempt **0/6**; complete source support **0/6**. Six IRAS-containing cases block. Two accepted corporate issues expose six scoped blocking gap occurrences in total, including missing topic, incomplete residual plan and unrouted material concepts. A canonical shell alone is not provider/retrieval success. Rejected/timed-out cases were not routed; their zero observed runtime gap counts mean unavailable diagnostics, not clean coverage. Evidence safeguard checks pass for one of six expected IRAS issues, with the others failing or unavailable; no IRAS issue qualifies for release.

## 12. Non-IRAS semantic metrics

Four non-IRAS issues are expected: CPF plus three accounting controls. One of four is accepted with correct dimensions and a canonical route or explicit unsupported outcome. Each non-IRAS dimension is 1/4 on the full expected denominator. The CPF-containing response was rejected; mixed accounting and investment timed out. Those semantic/transport failures remain visible and cannot be waived as unfinished knowledge.

## 13. Non-IRAS coverage gaps

The SFRS(I) 6 control explicitly records NO_COVERAGE_TOPIC and ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL, with INSUFFICIENT evidence, no admitted records or verified claims, no fabricated VERIFIED state and no false IRAS route. Its missing coverage does not fail the IRAS gate. The other accounting controls timed out, so fresh coverage outcomes for them were not observed; their historical limitations and adjudications remain documented separately.

## 14. Reviewer verdict

The independent reviewer approved the frozen source and API-free regressions, answered all nine Phase 8 questions positively, and independently passed both new gate/safety tests. The reviewer then assessed the completed fresh capture and independently confirmed **HOLD**, all failure metrics, unsupported accounting visibility, no false IRAS route or VERIFIED outcome, stable current fingerprints, all 110 historical hashes, no prohibited payload keys/URL strings, and absence of final-cycle artifacts. Source approval stands; release approval is withheld.

## 15. Exact commit and evidence integrity

Reviewed implementation: **`c8f6466556c257f5c2ca3786df4dfe3490cb337d`**. Baseline: `d194d2bc7121b2c9a1deec562f77eafdfb98cd90`; earlier structured-output implementation: `35118fb00e2f1fe35e053e950bba9e4b5d2fbd7a`. All 110 protected historical JSON/Markdown files were rehashed after capture and remain unchanged. The fresh JSON has zero prohibited private-payload field names; saved output excludes raw query/facts/provider text, credentials and source URLs. This report and evidence are committed as a separate checkpoint after the implementation.

## 16. Recommendation and stopping point

**HOLD MERGE.** Local validation and source review pass, but live semantic consistency, transport reliability and IRAS topic/source coverage fail the release contract. The final twelve prerequisite was explicitly checked without loading a key: it rejected the failed target before key lookup/provider calls and created no final artifacts. The original final ten also remains unrun.

No tuning or retries occurred after observation. No merge or deployment occurred. Resume in a new reviewed measurement cycle to address the remaining semantic-generation contradiction, investigate transport failures and repair the in-scope IRAS mapping/source path while preserving these observations. Those are future work, not waived release conditions.
