# Supervisor contract resolution — 04/10/2026

Original requested starting SHA: `31b012130110253ec38fe61f52114a784874c644`. This continuation started from clean diagnostic checkpoint `8366db0c1b8b0307e21e7f2d732edc3eab8e26f2`, on `codex/multi-authority-workstreams`. The completion message records the final stopping SHA containing this report.

## Acceptance decision

Consumed targeted V3 is a valid local-capability observation but structurally inconsistent as complete production-release acceptance. Its `localOnly` mode disables mapped official-source and discovery fallback while demanding complete VERIFIED rules for cases with no substantive reviewed local coverage. Correct reconciliation cannot create missing source evidence. No new local storage requirement was established; no live wording has been copied into local records.

The prospective contract separates semantic ownership, reviewed-local capability, governed rule evidence, and case application. See the prior checkpoint's `../iras-first-contract-audit-2026-10-03/acceptance-design.md` and this folder's independently reviewed `diagnosis.md`. No new acceptance runner or final profile was created or consumed.

## Nine-case root causes

| Case | Primary classification | Finding and disposition |
| --- | --- | --- |
| target-relief-entitlement | ACCEPTANCE_CONTRACT_DEFECT | Empty/non-grounding IRAS relief pointer cannot supply local rules. Separately, broad lexical CPF inventory became a material residual because reconciliation only accounted for governing mapped topics. A pure relief eligibility question requests no independent CPF payroll outcome. Contextual accounting of that inventory is the production correction; it supplies no evidence. |
| target-relief-amount | ACCEPTANCE_CONTRACT_DEFECT | Same local source limitation and contextual residual. The old amount detector also interpreted “how much … tax relief … CPF contributions” as a contribution calculation. Relief amounts must remain IRAS; separately requested CPF rates, contributions or obligations remain material. |
| A-paraphrase-2 | LOCAL_COVERAGE_GAP | IRAS relief has no local substantive rule. CPF employer contributions are a separate material issue. Current `CPF_RATES_BY_AGE_2026` is NEEDS_REVIEW, rejected as LOCAL_SOURCE_NOT_VERIFIED despite editorial provenance. Its authority/domain/topic/date do not override status. Historical capture retains one rejected candidate without its ID; the current default replay returns five candidates, so their identities/counts are not substituted for history. |
| private-expense-treatment | PIPELINE_DEFECT | Reviewed VERIFIED/ACTIVE `ITA_SEC15_PROHIBITED_DEDUCTIONS` is permitted CURATED_SUMMARY evidence. Its full quotation literally verifies, but the source-form matcher missed the affirmative enumerative disallowance (“disallows … deductions … including domestic or private expenses”). Retain the supported general rule with statutory-exception and selected-limbs caveats. Section 14 and motor-car rules alone do not prove private-expense disallowance; independent topic coverage and application remain necessary. |
| foreign-dividend-receipt-treatment | SEMANTIC_SCORING_UNRESOLVED | Frozen dimensions are correct; raw subject is absent. Legacy matcher reproducibly rejects equivalent overseas-dividend wording and accepts domestic-dividend wording. This establishes a prospective scoring defect, not a recoverable historical semantic omission. Empty local map pointer correctly needs mapped/live fallback. |
| corporate-residency-general-rule | ACCEPTANCE_CONTRACT_DEFECT | Correct semantics/routing; empty local pointer means no local candidate is expected. V9 independently verified three live residency claims. No production retrieval defect or duplicated local rule is warranted. |
| wht-royalty-general-rule | OTHER | Frozen two verified claims plus one uncovered and one unrouted concept do not identify their missing labels or establish complete general royalty support. Current local section 45 is interest-specific; section 45A is a facts-dependent caution. Separately, a validated mock proves topicless `semantic_nonresident_company` / “nonresident company” fails ownership against “non-resident company”. Normalize this orthography without equating ordinary resident or supplying missing rules. The historical exact label remains unknowable. |
| gst-input-tax-general-rule | SEMANTIC_SCORING_UNRESOLVED | The current local `GST_REG26_BLOCKED_INPUT_TAX` quotation can pass literal verification but correctly fails affirmative general input-recovery support and binding. This is a local rule gap. The legacy subject matcher also misses equivalent acquisition wording; correct only prospectively because raw historical subject is absent. |
| unsupported-sfrsi-6-exploration-evaluation | OTHER | No defect. Preserve visible unsupported issue, NO_COVERAGE_TOPIC, no evidence, no IRAS governor and overall INSUFFICIENT. |

The detailed topic/source/requested-concept inventory is in `local-record-matrix.json`; source policy and lifecycle traces are in `lifecycle-proof.json`. These are explicitly labelled validated API-free mocks/current registry replays, not reconstructed Gemini responses. Exact historical private/WHT concept labels, admitted record IDs and quotations were intentionally unretained; this task cannot honestly identify them. `wht-concept-proof-data.json` distinguishes frozen counters from the seven controlled spelling/role mocks.

## Implementation and verification

The supervisor approved each owning-layer plan before the builder changed production code. An independent reviewer checked production changes and the prospective scorer, with identified boundary issues corrected before final validation.

Production changes are limited to five modules: `semanticQuestionUnderstanding.ts` distinguishes pure IRAS relief context from separately requested or represented CPF payroll issues; `irasRuleConceptSupport.ts` recognizes affirmative private-expense enumeration and bounded non-resident spelling equivalence; `evidenceQualityGate.ts` uses validated issue scope for topic sufficiency; `groundingContextBuilder.ts` carries that scope through local, mapped-fallback and final quality checks; `authorityWorkstreams.ts` preserves the same scope at final verification and normalizes topicless concept ownership. These changes provide neither evidence nor application facts.

New focused regressions cover relief context, explicit CPF obligations, enumerative private support and negations, default-local-to-injected-mapped private fallback, topicless WHT ownership, and prospective semantic scoring. `multi-authority-issue-scoring-v2.mjs` is a new bounded prospective scorer; the consumed scorer and historical scores remain untouched.

The first expanded smoke run failed six suites. One was the mixed-issue CPF annotation defect, corrected and checked against the unchanged material-decomposition test. The other five exposed obsolete evidence-stage/concept and fallback assumptions. Independently approved current-scope V2 adapters retain pinned V4/V5/V8/V9 source bytes and execute their control bodies with exact-once changes to those assertions; the unfrozen GST locator distinguishes complete-positive closure from incomplete-rule registered fallback. The test runner names this prospective replay explicitly. This is not historical acceptance consumption or a claim that the original archived dynamic assertions pass with corrected production behavior. See `compatibility-review.md`.

Independent final review is **APPROVED, no remaining material findings**, recorded in `implementation-review.md`. The supervisor inspected the final compatibility guards and GST positive closure assertions.

Validation used package-script-equivalent commands with the verified Node 22 executable, because npm was unavailable in the shell. Preflight, focused regressions, semantic contract and release-gate controls pass. Final lint and TypeScript/Vite/Cloudflare worker build pass. Final smoke passes **88/88 suites**, including one aggregate compatibility suite executing all four archived control bodies, in 89.42 seconds. Full-suite results are recorded below. Lint reports existing repository/generated-fixture warnings and three unused-variable warnings in new diagnostic producers; build retains the existing chunk-size and deprecated inlineDynamicImports warnings. There are no lint or build errors.

Normal-path integration additionally proved a private-expense sufficiency defect: a minimal valid private-expense concept let metadata/lexical coverage report LOCAL_SUFFICIENT and suppress the registered deduction-topic fetch while final scoped verification correctly rejected section14. A transient concept fetch did not fill that topic. `lifecycle-local-mapped-proof-v4.json` preserves the pre-correction result. The independently approved owning-layer plan is in `architecture-review.md`; no central/source/literal gate relaxation is authorized.

## Preservation and limitations

The pre-implementation check passed all 389 frozen V9 fingerprint rows (221 distinct paths). Existing consumed semantic scorer, V1–V9 captures, targeted V3 harness/profile/capture, source registries and statutory text are frozen. Final checks are recorded below.

No Gemini calls, live IRAS retrieval, targeted acceptance, final profile, merge, push or deployment were performed. A checksum-verified official Node 22 runtime was downloaded only to run the repository's required tooling because the bundled runtime did not match its Node 22 contract; it was removed after final validation, before the stopping commit. Validation uses no environment credential loading.

V9 establishes five live evidence families, not complete applied-question acceptance or live CPF relief. API-free prospective fixtures can compare family behaviour; unretained V9 quotation payloads cannot be reconstructed from hashes/counters. Local source gaps remain fail-closed, and rule verification never promotes unresolved application to VERIFIED.

## Final supervisor validation and stopping point

- Preflight: PASS using the repository's required Node 22 runtime.
- Focused regressions, semantic contract, release gate, current-scope adapters and GST transport controls: PASS.
- Lint and TypeScript/Vite/worker build: PASS, with the warnings described above.
- Final smoke: **88/88 suites PASS**, 89.42 seconds.
- Final full regression: **108/108 suites PASS**, 152.70 seconds. The lower suite-row count reflects grouping four archived control bodies into one prospective compatibility row; no remaining control body was skipped.
- Independent final review: **APPROVED**, no remaining material findings.
- Post-full historical verification: **389/389 fingerprint rows PASS**, 221 distinct paths. Consumed history remains byte-identical.
- Final `git diff --check`: PASS. Changes comprise the five approved production modules, test registration, prospective scorer/tests and this separate resolution report/proof directory. No statutory/source registry, frozen scorer, frozen test/harness or consumed capture was changed.
- Temporary runtime and compatibility modules: removed. Ignored local validation logs remain under `.tmp`; this report retains their outcomes.

The current task stops at a clean commit on `codex/multi-authority-workstreams`; its exact SHA is supplied in the completion message and ignored `.tmp/contract-resolution-checkpoint.log` receipt. This report is part of that commit. The next authorized activity is **designing** a new targeted acceptance contract; no new targeted run is authorized or consumed here. Existing evidence gaps and unresolved applications must remain explicit in that design. Exact unretained historical concept labels remain an evidence limitation, not a fabricated reconstruction.

READY TO DESIGN NEW TARGETED ACCEPTANCE
