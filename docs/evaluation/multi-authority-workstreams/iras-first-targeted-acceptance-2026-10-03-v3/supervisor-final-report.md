# Nine-case targeted acceptance — 03/10/2026

**TARGETED ACCEPTANCE = FAIL / HOLD. HOLD MERGE.** One fixed capture is complete and independently audited. Only the unsupported control passed (1/9 cases); all eight requested IRAS rule-evidence gates failed. Stop at the clean evidence checkpoint. No production patch, second capture, historical rescoring, final profile, merge, push or deployment was performed.

## Checkpoints and profile

- Exact starting SHA: `f919dc90d76b439f35765ad9555f9b4701037675`.
- Branch: `codex/multi-authority-workstreams`.
- Exact profile: `iras-first-targeted-acceptance-v3`, using unchanged `iras-first-v2` case expectations and current generic gates, plus prospective integrity/topic/lifecycle/overall checks.
- Frozen preregistration and harness commit: `0fad212cb44cb86e1cc22bd09c26d7fd6ab32c5b`.
- Preregistration-envelope SHA256: `444e98ec44a553e76eae797dc58cfbd206bb8eaa983fda1d9405b6b97cb41d03`.
- Exact plan-file SHA256: `b6bc1065468f2e71e2be02be46166cdcc569fb58bc3f32bdff44adf4fc960906`.
- The exact stopping commit SHA is supplied in the completion message. This report is part of that checkpoint; embedding its own commit hash would be self-referential.

The unused v2 output namespace was preserved. Independent pre-run review rejected its unchanged runner because it lacked pre-call permanent consumption reservation and bound acceptance to obsolete timeout-pilot fingerprints. The new harness preserves the original runner, configuration and captures. Its permanent exclusive marker was reserved before transport, and it verifies committed plan bytes, production/template fingerprints and protected history before/between/after requests. No final-profile mode is supported.

## Calls and semantic results

Nine actual provider/model transport calls to `gemini-3.5-flash-lite`, one per frozen case, zero retries or extra calls. Timeout/provider-error/invalid-response/pre-transport-failure counts: **0 / 0 / 0 / 0**. All nine responses passed production semantic validation. Expected issue recall and precision were each **8/10 (80%)**; seven cases satisfied the complete semantic contract. Governing/contextual authority, domain, population and operation were correct for all eight matched issues. Case-specific-facts classification was correct for **9/9** cases.

Both foreign/GST misses occurred in expected-subject matching, with one expected and one emitted issue each. Their correct safe routing/dimension metadata does not settle the unretained subject wording. Do not call these proven model omissions, provider instability or confirmed scoring bugs. No rescore or new diagnostic capture was attempted.

Production timeout remained **8,000 ms**, temperature zero, existing JSON schema and prompts. Minimum observed request-start gap was **17,589 ms**, above the **15,250 ms** minimum. Capture ran from 22:41:25 to 22:43:51 Singapore time on 03/10/2026; its exact UTC timestamps remain in the artifacts. Shared allowance immediately before invocation was 30% five-hour / 60% weekly remaining, above the preserved 7% / 3% reserve floors with checkpoint buffer. No reset or credit purchase was used.

## Exact nine-case results

All overall and rule-evidence statuses below are the actual runtime projections. Application facts were preserved and never fabricated. Missing facts alone are not the cause of any failure.

| Exact case ID | Expected identity match | Actual canonical route | Rule evidence / application / overall | Result and first demonstrated failing stage |
| --- | --- | --- | --- | --- |
| target-relief-entitlement | 1/1 | IRAS/IRAS_INDIVIDUAL_TAX | INSUFFICIENT / UNRESOLVED / INSUFFICIENT | FAIL: independent topic coverage; unassigned CPF contribution topic. Requested relief topics map, but retrieval also yields no candidate evidence. |
| target-relief-amount | 1/1 | IRAS/IRAS_INDIVIDUAL_TAX | INSUFFICIENT / UNRESOLVED / INSUFFICIENT | FAIL: independent topic coverage; unassigned CPF contribution topic. No candidate rule evidence afterward. |
| A-paraphrase-2 | 2/2 | IRAS/IRAS_INDIVIDUAL_TAX and CPF/CPF_PAYROLL | INSUFFICIENT / UNRESOLVED / INSUFFICIENT | FAIL: IRAS candidate evidence absent after retrieval; CPF candidates rejected. CPF remains a separate partial-authority result. |
| private-expense-treatment | 1/1 | IRAS/IRAS_CORPORATE_TAX | INSUFFICIENT / UNRESOLVED / INSUFFICIENT | FAIL: claim verification after admission. Both required tax topics map; the conjunction planning residual remains closed. |
| foreign-dividend-receipt-treatment | 0/1 | IRAS/IRAS_CORPORATE_TAX | INSUFFICIENT / UNRESOLVED / INSUFFICIENT | FAIL: expected-subject matching. Subsequent rule evidence also lacks candidates. |
| corporate-residency-general-rule | 1/1 | IRAS/IRAS_CORPORATE_TAX | INSUFFICIENT / NOT_REQUIRED / INSUFFICIENT | FAIL: no candidate evidence after retrieval. |
| wht-royalty-general-rule | 1/1 | IRAS/IRAS_CORPORATE_TAX | INSUFFICIENT / NOT_REQUIRED / INSUFFICIENT | FAIL: final requested-concept coverage; two admitted records and two verified claims do not complete the rule lifecycle. |
| gst-input-tax-general-rule | 0/1 | IRAS/IRAS_GST | INSUFFICIENT / NOT_REQUIRED / INSUFFICIENT | FAIL: expected-subject matching; subsequent claim verification is also incomplete. |
| unsupported-sfrsi-6-exploration-evaluation | 1/1 | ACCOUNTING_STANDARDS/ACCOUNTING | INSUFFICIENT / NOT_REQUIRED / INSUFFICIENT | PASS: issue remains visible with NO_COVERAGE_TOPIC, no evidence/claims, and no IRAS route. |

Every emitted IRAS issue mapped to its expected canonical route and attempted retrieval. The generic release summary credits six matched IRAS issues for mapping/routing/retrieval because foreign/GST lack an expected-issue identity match. **Zero of eight IRAS issues has VERIFIED rule evidence or complete support.** The generic release summary records 25 blocking gap counts; two WHT verified claims remain insufficient for full requested-concept coverage. This is not a failure caused merely by unresolved taxpayer application facts.

The frozen JSON's coarse admission-stage labels are preserved. Independent audit establishes private expense's first demonstrated lifecycle failure at claim verification and A/residency's failure at missing candidates. See `reviewer-audit.md` for the distinction between initial admission and final returned source counts. These annotations do not change captured scoring or results.

## Integrity, review and validation

All 174 current source and 185 historical fingerprint rows match, with matching prompt/schema fingerprints and stable plan/marker/report bindings. The legacy 118-artifact manifest and all 389 V9 frozen historical rows remain unchanged, including consumed V1–V9/public artifacts and the frozen pre-fix conjunction proof. Reservation precedes all requests; exact nine-case inventory and call counts are confirmed. The consumed capture was never rerun, overwritten, mutated or rescored.

Independent reviewer verdict: capture integrity and FAIL/HOLD decision verified; no remaining material artifact/gate defect. Application statuses are correct. The unsupported accounting control remains fail closed. Two subject-matching causes remain unresolved because raw subjects are deliberately not retained. The reviewer performed no provider calls or capture mutations.

Pre-run checks passed: per-issue release-gate regression, semantic-contract regression for 35 operation families/mixed issues, new API-free v3 safety regression, targeted syntax/lint and diff checks. Production was unchanged, so the starting checkpoint's validated lint/build, smoke 87/87 and full 107/107 results were inherited without repeating those suites. New files comprise the targeted harness/safety test and preregistration, usage, consumed marker, capture and audit/report artifacts in this folder. Temporary task runtime is removed before the clean checkpoint.

Evidence mode is **localOnly**. This profile tests current semantic interpretation, routing, local evidence-path behavior, rule/application gates and release guardrails. It does not establish live substantive IRAS-page retrieval, even though prior separately audited V9 captures verified five evidence families.

No broad diagnostic cycle or production change follows this failed acceptance. Final profile stays NOT RUN and HOLD MERGE remains in force.
