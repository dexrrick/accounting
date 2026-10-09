# Accounting authority and relief operation contract audit

01/10/2026. Supervisor audit before production edits. Starting HEAD: fa0f851ee5a548162353f1500f65b0cbf3eae77a; branch codex/multi-authority-workstreams. HOLD MERGE; no merge or deployment. Timeout investigation remains separate.

## Authority diagnosis and decision

`validateSemanticQuestionInterpretation` accepts ACCOUNTING with ACCOUNTING_STANDARDS, IFRS_FOUNDATION, ACRA or SSO as its single issue governor. Top-level accounting candidates also allow IFRS_FOUNDATION. The strict V2 schema and legacy validation must retain their existing constraints.

`semanticAuthorityCoversTopic` already treats both IFRS_FOUNDATION and ACCOUNTING_STANDARDS as compatible with the accounting topics represented by ACRA. Reconciliation therefore can retain independently recognized accounting topic IDs for an IFRS Foundation interpretation. However, `sourceDomainMatchesAuthority` in authorityWorkstreams special-cases only ACCOUNTING_STANDARDS; IFRS_FOUNDATION topics are discarded during internal planning. SUPPORTED_LOCAL_AUTHORITIES excludes IFRS_FOUNDATION, and retrievalAuthority has no mapping for it. The exact current path returns ISSUE_UNMAPPED before provider selection because its planned topic IDs are empty; an interpretation with no reconciled topics returns NO_COVERAGE_TOPIC. It does not currently reach PROVIDER_UNAVAILABLE on this accounting path. Were topic compatibility alone repaired, the missing provider would then produce PROVIDER_UNAVAILABLE. The correction must address both planner topic compatibility and provider routing through the existing canonical adapter.

The existing accounting adapter retrieves ACRA ACCOUNTING_SFRS records. It admits only reviewed registry sources with appropriate provenance, domain, topic, date and quoted support. Routing an authority alias to this adapter does not certify that every IFRS question is answered by Singapore material: absent or unsuitable evidence must continue to produce INSUFFICIENT. It must not relabel ACRA records as IFRS Foundation publications or add a separate provider merely to satisfy a benchmark.

Decision A: IFRS_FOUNDATION is a semantically valid governing authority for accounting and names the same application evidence workstream as ACCOUNTING_STANDARDS. Normalize only an ACCOUNTING issue's governing authority at reconciliation and defensively at the public planning boundary. Keep raw validated interpretations and contextual authorities intact. Preserve domain, operation, independently mapped topic IDs and derived evidence requirements. No contextual authority becomes a workstream. Non-accounting routes remain unchanged. SSO has no provider and accounting topic association is unsupported; it intentionally remains unresolved with NO_COVERAGE_TOPIC or ISSUE_UNMAPPED, rather than acquiring an unrelated source/provider mapping in this task. UNKNOWN has no governing route and reports NO_GOVERNING_AUTHORITY. ACRA retains its existing adapter and may fail evidence admission rather than provider selection. No new substantive accounting rule is needed.

The validator enum is broader than supported evidence coverage. IRAS, CPF, MOM, ACRA and MAS have existing adapters, and ACCOUNTING_STANDARDS uses the existing ACRA accounting adapter. A schema-valid issue still requires an independently recognized topic and a canonical area. In particular IRAS_OTHER has no canonical workstream area in canonicalDomainForIssue and remains UNKNOWN/INSUFFICIENT with CANONICAL_AREA_UNRESOLVED (or its prior unresolved-topic reason). This intentional limitation is documented rather than expanded in an IFRS/relief task. An unsupported domain/area or missing topic must never become VERIFIED merely because the schema accepts its authority.

## Operation adjudication

Operations describe the requested result, separately for each issue:

| Operation | Requested result |
| --- | --- |
| CALCULATE | A numeric result, amount, total or balance, even if material inputs are missing. |
| CHECK_ELIGIBILITY | Whether a claimant qualifies, is entitled, or may claim a relief or benefit. |
| DETERMINE_TREATMENT | Classification or treatment of a supplied transaction or arrangement, including taxability or deductible status. |
| EXPLAIN_RULE | General principles or conditions without applying them to a claimant or transaction. |
| EXPLAIN_INTERACTION | A requested relationship between rules, including how relief interacts with a cap. |

“What can I claim?” and “Can I claim this relief?” ask entitlement (CHECK_ELIGIBILITY). “How much relief can I claim?” requests an amount (CALCULATE). “What relief applies?” asks entitlement when the subject is a claimant; it asks DETERMINE_TREATMENT when the requested outcome is the treatment of a supplied contribution or transaction. “How does this relief work?” is EXPLAIN_RULE absent requested personal application. General cap interaction is EXPLAIN_INTERACTION even when the cap is expressed numerically. Facts, example amounts and caps do not themselves request numeric output.

For A-paraphrase-2, the personal question “what can they claim for personal tax relief on compulsory CPF” requests entitlement; SGD 6,000 monthly salary is a supplied fact. Its employer-payable issue separately requests a numeric CPF contribution. Select CHECK_ELIGIBILITY for personal relief and CALCULATE for employer CPF. Do not infer relief arithmetic from the other issue. The existing frozen personal-relief eligibility/treatment expectation does not require correction: CALCULATE should remain excluded. A new stricter independently adjudicated entitlement control can require CHECK_ELIGIBILITY without rewriting the historical fixture.

Use a short generic requested-result clarification for claims and reliefs. Do not introduce deterministic phrase replacements, additional substantive tax rules or further broad prompt tuning.

## Measurement plan fixed before implementation/live capture

Add no-API authority families for IFRS, SFRS(I), mixed IFRS/Singapore wording and contextual IFRS; test schema validation through reconciliation, planning, default provider selection and retrieval. Include direct planner input, preserved raw interpretations, source/evidence gates and documented intentionally unsupported governors. Add relief families for explicit entitlement, explicit amount, ambiguous entitlement, general rules, cap interaction, salary facts only, salary with requested relief amount, and transaction treatment. Mocks demonstrate contract retention and routing, not model inference.

New targeted selection: original general-recognition and A-paraphrase-2 plus independent SFRS(I) and mixed accounting controls, explicit relief entitlement and amount controls, and two unrelated controls. Include additional relief boundaries where practical. Require every targeted case to pass strict validity, exact issue recall/precision, all dimensions/operations, independently fixed case-specific flags, canonical routing and all runtime safeguards, with zero invalid responses/timeouts/provider failures and stable fingerprints. Threshold is 100%, not a two-original-case pass.

Preserve historical report bytes and frozen fixtures. New reports must retain raw-authority historical scoring alongside separately identified canonical-contract scoring. IFRS alias equivalence is justified by the architecture above, not by the observed live label. Do not retroactively rescore or overwrite saved observations. Conditional final evaluation uses the unchanged original ten questions and frozen expectations, records raw scores, and separately assesses the canonical contract. Run only after full targeted acceptance, local validation, reviewer approval and a usage check showing at least 7% remaining in both windows. Same Gemini model, temperature 0, JSON mode, eight seconds, one request per case, no retry and at least 15,250 ms between starts. Do not tune after results.

## Baseline and regression-first evidence

Before production changes, exact Node.js 22.23.1 passed seven existing suites: semantic wire contract, intent boundaries, semantic question understanding, authority workstreams, semantic routing priority, semantic contract diagnostics and intent follow-up runner. The previous checkpoint records smoke 54/54 and full 74/74; those are historical results, not reruns in this cycle.

The builder's new authority regression failed before production edits because a schema-valid IFRS Foundation accounting issue did not produce ACCOUNTING_STANDARDS/ACCOUNTING, despite resolving the same topics as an equivalent ACCOUNTING_STANDARDS control. An earlier assertion assumed one lease topic; it was corrected because the resolver legitimately recognizes both sfrsi_lease_subsequent-measurement and sfrsi_leases. That test-setup failure is not evidence of a production defect. The actual red compares independently resolved topic sets, then checks the canonical planner path.

All 23 historical protected files matched their hashes before work. The new authority-relief-protected-hashes.json preserves those plus six previous intent artifacts/fixture (29 entries). It does not rewrite historical observations or benchmark labels.

## Independent review and additional local coverage diagnosis

The first independent review found that matching canonical workstream names alone could pass strict evaluation even when topics were unmapped or no provider was attempted. This material finding was corrected before any live request. New-profile-only diagnostics require every requested issue to be mapped, present in canonical runtime, lifecycle-mapped and retrieved, with no blocking or unclassified requested routing gaps and no runtime timeout. Both case acceptance and the persisted final-ten gate enforce those counters. Provider-unavailable, authority-mismatch and provider-error states fail; ordinary evidence exhaustion after retrieval can remain INSUFFICIENT. Diagnostics contain only fixed codes, counts and booleans. Independent re-review cleared the code finding.

The stricter regression then exposed unrealistic mock subjects and two real pre-existing coverage gaps. The frozen subject label `general-recognition` is a benchmark matching label, not a sufficiently specific interpreted subject; a faithful intangible-recognition mock resolves correctly. A mixed lease mock omitted IFRS 16, which is present in the question; a faithful subject resolves correctly. Correcting mock subjects does not change fixed questions or expected labels.

However, the unchanged A-paraphrase-2 query independently recognizes only iras-individual-reliefs. Its requested employer CPF contribution issue cannot acquire cpf_contribution_rates through the existing subject/query-topic intersection. A faithful personal-relief subject maps the relief topic; the employer issue remains NO_COVERAGE_TOPIC. The independently chosen generic MOM work-pass control recognizes no specific work-pass topic and remains NO_COVERAGE_TOPIC. The registry covers specific Employment Pass, S Pass, Work Permit and quota topics, without generic wording coverage in this fixed question.

`authority-relief-local-routing-diagnosis.json` preserves exact safe local reconciliation results and source fingerprints. Fully mapped cases: 6/8; mapped requested issues: 7/9. These are synthetic no-API mapping results, not semantic issue recall, model accuracy or live acceptance. The strict targeted threshold remains 8/8 and is not lowered. The benchmark questions and expectations remain unchanged.

Independent reviewer agrees with HOLD MERGE and no live execution: the topic intersection means improved model wording cannot supply the missing query inventory topic. The earlier code finding remains resolved, but execution approval is withdrawn because the fixed 100% target is deterministically blocked. Expanding CPF/MOM topic recognition would be a separately scoped resolver/routing task; this task does not weaken the independent mapping gate or add keyword replacements. No live targeted or final-ten request will be made. Timeout work remains separate.

Initial supervisor validation on Node.js 22.23.1: lint and production build pass with existing warnings; smoke 56/56 passes before the evaluator guard correction; initial full run passes 75/76 in 220.99 seconds, with only the new evaluator's incorrect all-mapped mock assumption failing. Corrected targeted and final full results are recorded below. The full run confirmed all existing accounting, wire-contract, routing, diagnostics/privacy and authority suites pass.

## Final results and files

Exact Node.js 22.23.1: both corrected new targeted regressions pass, along with the existing intent-boundary, intent-runner, contract-runner and authority-workstream checks. Final full suite **76/76 passes in 216.46 seconds**, including all 56 smoke groups on the final evaluator/test version. The standalone smoke run was **56/56 in 103.44 seconds** before the stronger evaluator guard; the final full run supersedes that version for all included smoke checks. V2/legacy wire contract, semantic interpretation, per-issue operations, issue decomposition, authority workstreams, routing priority, retrieval authority/domain conjunction, privacy/diagnostics, source integrity and accounting invariants all pass. Final lint passes with existing warnings. Production build passes with existing chunk-size/deprecation warnings; production source did not change after the successful build. git diff --check passes; staged diff is checked before commit. No integration or live evaluation was run.

Reviewer cleared the corrected tests: faithful issue subjects, mixed top-level UNKNOWN/OTHER, realistic lifecycle mocks, explicit strict rejection of the two uncovered cases, and separate wrong-operation testing on a mapped relief case. Gate-only synthetic passing data stays in temporary test files and makes no provider calls; it is not a captured observation. No remaining material code, privacy or benchmark-integrity finding. **HOLD MERGE/no live** because coverage acceptance is not achieved.

No frozen benchmark expectations changed. The only expectation-related adjustment is a documented prompt-character test ceiling, not an operation/authority label. New canonical scoring reflects the application alias decision while raw historical scoring is retained. All 29 protected entries still match. New live targeted/final files and the previously skipped semantic-intent-final files do not exist. Live metrics are **unmeasured**; provider requests in this task: **zero**. The safe local mapping diagnosis remains 6/8 fully mapped cases and 7/9 mapped requested issues, without asserting model issue recall or precision.

Changed files (13):

- src/services/semanticQuestionUnderstanding.ts
- src/services/authorityWorkstreams.ts
- scripts/run_all_tests.mjs
- tests/evaluation/singapore/semantic-contract-followup-evaluation.mjs
- tests/evaluation/singapore/semantic-intent-followup-evaluation.mjs
- tests/evaluation/singapore/authority-relief-targeted.json
- tests/regression/test_semantic_intent_boundaries.mjs
- tests/regression/test_semantic_authority_relief_contract.mjs
- tests/regression/test_semantic_authority_relief_evaluation.mjs
- docs/evaluation/multi-authority-workstreams/authority-relief-protected-hashes.json
- docs/evaluation/multi-authority-workstreams/authority-relief-local-routing-diagnosis.json
- docs/evaluation/multi-authority-workstreams/semantic-authority-relief-contract-audit.md
- docs/evaluation/multi-authority-workstreams/authority-relief-resume-checkpoint.md

No accounting/statutory/source rule, source-quality gate, privacy control, eight-second timeout, retry policy, Gemini model, live pacing or unrelated production authority mapping changed. See the resume checkpoint for the continuing scope, runtime and exact commit lookup. Do not merge, deploy, run final ten, or expand the unresolved resolver coverage during this task.
