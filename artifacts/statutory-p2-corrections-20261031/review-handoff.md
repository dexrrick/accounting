# ACRA FYE and mixed MOM obligations — review handoff

## Goal and status

Both reported P2 defects were reproduced, corrected, independently reviewed and locally validated. The correction is pushed to the existing branch. This batch changes date interpretation and obligation handling; it adds no statutory rule content or source captures. No PR, merge, deployment, source activation or live-model/browser acceptance occurred.

The ACRA example now gives the conditional general annual-return date **31/07/2026** for the stated private-company FYE of `2025-12-31`, retaining the overseas-register exception and individual-application limitations. MOM mixed questions retain a distinct final-salary `CALCULATE` obligation and separately sourced payslip guidance. Salary arithmetic remains explicitly unresolved; this batch does not add a final-salary calculator.

## Exact review target

- Repository: https://github.com/dexrrick/accounting
- Branch: `codex/statutory-knowledge-expansion-20261030`
- Original comparison base: `2f8abb90a1af5303eaeeaf98c184644b5ea3e323`
- Previously reviewed implementation: `80034813f8bcb3b6ac58b5d017bd2c9a85f52620`
- Starting remote head, prior handoff and correction base: `2184ee0592076dd1891113a3ad74cb014eb439eb`
- Final implementation/evidence SHA: **`a4035b6e34d49373df0e4b2a0f3a3ee3e7800fc9`**, pushed and remote-verified.
- [Correction comparison](https://github.com/dexrrick/accounting/compare/2184ee0592076dd1891113a3ad74cb014eb439eb...a4035b6e34d49373df0e4b2a0f3a3ee3e7800fc9)

This handoff and CI snapshot are documentation-only successors. Review the fixed implementation SHA above, rather than treating a later documentation head as a new implementation.

## Findings, changes and regression coverage

**ACRA P2 confirmed.** The workflow's last-four-character year check rejected ISO dates. Downstream FYE interpretation also disagreed on `was`, colon and `year ended` wording. `src/retrieval/companyFyeDate.ts` now supplies one strictly validated company-owned FYE to both `targetDateResolver.ts` and `acraMomKnowledge20261027b.ts`. It requires one date and year, validates the actual calendar date, and rejects ambiguity and unrelated ownership. Existing historical-law and recent-workflow safeguards remain. The separate ECI workflow implementation was left unchanged.

**MOM P2 confirmed in deterministic/no-provider fallback.** Grouped MOM topics received a calculation operation, while the recovery principally covered misconduct timing. `src/services/semanticQuestionUnderstanding.ts` now separates final salary, independently requested payslip timing/issuance/delivery, and requested salary deductions. Calculation wording includes `how much` and explicit calculation verbs. `src/standards/coverageRegistry.ts` recognizes payslip delivery requests. `src/classification/questionClassifier.ts` preserves explicit journals while avoiding an automatic journal for a final-salary amount question, and identifies an absent contractual salary rate.

`src/utils/authorityEvidenceRouting.ts` admits only the bounded employer MOM salary-calculation plus payslip plan, optionally with the deduction obligation. It retains the unresolved calculation beside the answerable rule instead of suppressing payslip evidence. This works with partially supplied salary facts and inferred IRAS classifier metadata; actual tax analysis, accounting, journals and images remain excluded from this special route.

Two existing registered regression suites were extended:

- `tests/regression/test_acra_mom_knowledge_20261027b.mjs`: ISO, DD/MM/YYYY and named-month formats; `is`, `was`, `of`, colon and `year ended`; listed/non-listed AGM and annual-return dates; affirmative overseas-register exceptions; invalid/leap/ambiguous dates, unrelated companies and historical safeguards; actual application entry.
- `tests/regression/test_statutory_multipart_issue_refinements_20261030.mjs`: resignation with notice, resignation without notice, employer termination and misconduct; separate timing, issuance and delivery; calculation verbs; missing/stated salary rate; numeric uniform deduction; explicit tax/journal/image controls; actual `processAccountingQuery` responses.

Before-fix tests failed for both original defects. Independent review additionally found a duplicate import, missed non-timing payslip requests, inconsistent calculation-verb handling and partial-fact routing; these were fixed and rechecked. Supervisor application testing found inferred IRAS policy suppressing the numeric deduction example; that final route correction also passed independent review. Final review: no remaining material findings in the requested scope.

## Actual verification

Node 22.23.3 was used. Package commands were run through the canonical Node runtime directly, including Oxlint, `tsc -b`, Vite, the Worker build script and the smoke/full runner tiers.

| Check | Final result |
|---|---|
| Both extended focused suites and application examples | Passed |
| Maintained-code lint (`src scripts tests`) | Passed; existing warnings retained |
| TypeScript typecheck | Passed |
| Vite and Worker builds | Passed |
| Complete smoke | **159/159 passed** |
| Complete full regression | **182/182 passed** |
| Five requested corpus captures | All exited 0; zero network/model requests |
| Frozen inputs and prior answer hashes | Unchanged; inherited grades matched published answer hashes |
| Reviewed source/test hash drift and CRLF-aware diff check | No drift; passed |

Root lint separately failed with **34 parse errors**, all in the pre-existing untracked `artifacts/fresh-acceptance-2026-10-24/prepare.mjs`. That archive is absent from the clean committed tree and was not published.

Interrupted/environment checks are retained locally: an initial tsx startup failed at Windows `os.userInfo` before application code; the existing local username shim allowed capture. An initial smoke run was interrupted for the deduction-route fix. A later restricted-process smoke run passed 158/159 but failed the isolated MAS transport diagnostic; that test passed with normal Windows process access, followed by the complete passing smoke/full runs there. The offline external-fetch guard was retained. No unrelated MAS code was changed.

GitHub returned no combined status checks and no PR-triggered workflow runs for the implementation SHA. The connector workflow query is PR-filtered. Repository CI triggers on main/master pushes or PRs targeting them; no CI was manually dispatched. These local results are not a CI or production-success claim. No live integration suite or browser/model acceptance was performed.

## Before/after answer quality and preservation

Values below are **correct / partial / incorrect / unsupported**. Original and enriched Fixed100 are two source configurations of the same questions.

| Corpus | Before | After |
|---|---|---|
| Frozen75 | 30 / 8 / 0 / 37 | 30 / 8 / 0 / 37 |
| Earlier60 | 59 / 0 / 0 / 1 | 59 / 0 / 0 / 1 |
| Fixed100 original | 50 / 12 / 0 / 38 | 50 / 12 / 0 / 38 |
| Fixed100 enriched | 66 / 8 / 0 / 26 | 66 / 8 / 0 / 26 |
| Fresh15 | 4 / 0 / 0 / 11 | 4 / 0 / 0 / 11 |

All previously correct answers were preserved byte-for-byte: 30/30, 59/59, 50/50, 66/66 and 4/4 respectively. Of the 350 captured configuration outcomes, 349 complete answers were unchanged. The only change, Frozen75 `acra-15`, was independently read and remains **UNSUPPORTED**: generic unsupported excerpts became explicit evidence gaps, not a listed-company deadline answer. No correctness gain is claimed. Neither Fixed100 configuration lost a verified evidence path. The original `iras-eci-03` intentionally remains insufficient; enriched-source status is separate. No frozen question or expected answer was modified.

Frozen75/Earlier60/Fresh15 use application-entry rules-only understanding without issue hints. Fixed100 uses guided issue/source replay. Source verification is not whole-answer correctness, and unchanged grades are inherited only after complete-answer hash checks.

## Remaining gaps and next priorities

Coverage is still incomplete. The published quality report retains every case grade, including Frozen75's 37 unsupported and eight partial answers and Fresh15's eleven unsupported. Recommended next source-backed work, outside this corrective batch:

1. **CPF:** contractual payable-date ownership for OW/AW, AW ceiling year and PR commencement boundaries; preserve separate employee/payment dates.
2. **MOM:** date-specific salary-payment application, separation-reason comparisons and deduction permissions/notification duties. Keep these separate from unsupported arithmetic.
3. **ACRA:** secretary multipart cases, dormant-company statement exemptions, XBRL/PDF/signing and AGM declaration details; retain audit/filing distinctions. `acra-15` remains an explicit interpretation/evidence gap.
4. **IRAS:** WHT deemed-payment dates and continued filing despite relief, ECI/assessment consequences, and claim-specific GST medical/import/vehicle exceptions with effective dates.
5. **MAS:** exact toolkit forms, periods, misconduct/financial-distress notification and QDC applicability. Do not infer precise requirements from adjacent general guidance.

Increasing question counts alone is not coverage. Each expansion should add authoritative support, applicability and complete practical explanations, followed by independent answer review.

## Evidence and access limits

Published, pinned to the final implementation:

- [Completion snapshot](https://github.com/dexrrick/accounting/blob/a4035b6e34d49373df0e4b2a0f3a3ee3e7800fc9/artifacts/statutory-p2-corrections-20261031/completion-summary.json)
- [Per-case grades and before/after counts](https://github.com/dexrrick/accounting/blob/a4035b6e34d49373df0e4b2a0f3a3ee3e7800fc9/artifacts/statutory-p2-corrections-20261031/quality-report.json)
- [Preservation comparison](https://github.com/dexrrick/accounting/blob/a4035b6e34d49373df0e4b2a0f3a3ee3e7800fc9/artifacts/statutory-p2-corrections-20261031/preservation-comparison.json)
- [Validation exits/times](https://github.com/dexrrick/accounting/blob/a4035b6e34d49373df0e4b2a0f3a3ee3e7800fc9/artifacts/statutory-p2-corrections-20261031/validation-results.json)
- [Independent review record](https://github.com/dexrrick/accounting/blob/a4035b6e34d49373df0e4b2a0f3a3ee3e7800fc9/artifacts/statutory-p2-corrections-20261031/independent-code-review.md)
- [Changed-answer grade](https://github.com/dexrrick/accounting/blob/a4035b6e34d49373df0e4b2a0f3a3ee3e7800fc9/artifacts/statutory-p2-corrections-20261031/changed-answer-grades.json)

The initial large evidence push was rejected by automatic approval review. A smaller package of nine implementation/test files and eight bounded reports was then successfully pushed. Full captures, logs, comparison/replay helpers and intermediate diagnostics remain **local-only, untracked or ignored**, under `D:\Accounting\artifacts\statutory-p2-corrections-20261031\`; they are unavailable through GitHub. In particular, `final75.json`, `final60.json`, `fresh15.json`, both `fixed100-*.json`, `acceptance-answers.json`, `changed-answer-review.json`, `smoke.log` and `full.log` remain there. A GitHub-only reviewer can inspect the implementation, regression tests and published summaries, but cannot directly inspect those new raw captures. Prior published corpus/source packages remain in the repository.

No implementation or test changes remain uncommitted or unpushed. Pre-existing unrelated local archives, `.tmp/` and `.pnpm-store/` were preserved. The last prepublication usage check showed 55% five-hour and 4% seven-day allowance remaining; no reset credit was consumed.

## Ready-to-copy review prompt

Independently review https://github.com/dexrrick/accounting, branch `codex/statutory-knowledge-expansion-20261030`, final implementation commit `a4035b6e34d49373df0e4b2a0f3a3ee3e7800fc9` against correction base `2184ee0592076dd1891113a3ad74cb014eb439eb` (original broader comparison base `2f8abb90a1af5303eaeeaf98c184644b5ea3e323`). Confirm the exact commit you inspected. Use this handoff as context and verify its claims against the code, diff, tests and available CI evidence. Focus on strict FYE parsing, historical/entity/date ambiguity safeguards, conditional listed/non-listed deadlines, independent MOM obligation operations and bounded runtime routing. Report actionable findings with severity, file and line references, impact and suggested fixes. State access and verification limitations, including unavailable local raw captures. Keep the review read-only.
