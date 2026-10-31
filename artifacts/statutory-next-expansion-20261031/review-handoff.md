# Statutory knowledge expansion — independent review handoff

## Goal and status

Expand authoritative Singapore statutory coverage, starting with ACRA while improving CPF, MOM, IRAS and MAS; preserve independent obligations and their facts, effective dates, financial years and assessment years. The immediate target was 30–35 correct Frozen75 answers, zero incorrect answers and no loss of previously correct answers.

The offline batch meets that target. Source and regression fixes are implemented, independently reviewed, and locally validated. CI, live-model/browser acceptance, source activation, merge and deployment have not occurred. This is not a production acceptance claim.

## Exact review target

- Repository: https://github.com/dexrrick/accounting
- Branch: `codex/statutory-knowledge-expansion-20261030`
- Code/evidence review head: `80034813f8bcb3b6ac58b5d017bd2c9a85f52620`
- Base: `2f8abb90a1af5303eaeeaf98c184644b5ea3e323`
- [Complete review comparison](https://github.com/dexrrick/accounting/compare/2f8abb90a1af5303eaeeaf98c184644b5ea3e323...80034813f8bcb3b6ac58b5d017bd2c9a85f52620)
- No PR was created. A documentation-only successor adds this handoff; the fixed code/evidence SHA above is the functional review target.

The implementation commit includes the pre-existing uncommitted statutory corrections and the next expansion batch. `preexisting.patch` records the corrections present when the batch began; `new-batch.patch` isolates the subsequent expansion against that dirty baseline. Review the complete base-to-head diff for integration correctness.

## Changes and main files

- `src/retrieval/acraMomKnowledge20261027b.ts`: source-backed ACRA AGM/annual-return deadlines, audit criteria, company/officer/FYE changes and secretary guidance; complete same-source quotations; conditional date calculations. Retains the complete deadline table and its header. Extra-month calculations require affirmative company-owned capital/register facts; negation defeats the extension.
- `src/retrieval/externalSourceValidator.ts`, `momAcraMasCoverageRules.ts`, and `src/services/groundingContextBuilder.ts`: bounded native-page extraction, visible audit-context labels, hidden-subtree exclusion, exact company/group numeric and polarity proof, and complete claim-bound evidence. Hidden thresholds cannot substantiate the audit rule. Unsupported AGM duration, AR historical-boundary/example attribution, and 5% shareholder-audit assertions were removed.
- `src/services/semanticQuestionUnderstanding.ts` and `src/standards/coverageRegistry.ts`: preserve separately requested obligations, distinguish filing deadlines from proposed annual-return delay context, retain email-change notification routing, and prevent unrelated MAS/company facts from creating ACRA obligations.
- `src/retrieval/targetDateResolver.ts`, `statutoryWorkflows20261029.ts`, `irasMasKnowledge20261027b.ts`, and `src/standards/singaporeStatutesKnowledge.ts`: date-role handling and practical CPF/MOM/IRAS/MAS coverage, including prior CPF date ownership/current-year ECI corrections. Financial years, assessment years, current guidance and explicit transition dates remain distinct.
- `src/classification/questionClassifier.ts` and `src/retrieval/momSalaryPaymentRule.ts`: OW/AW-base questions remain statutory advice unless contribution arithmetic is requested; salary-frequency aliases require an owned salary question. The fresh CPF question no longer invents payroll assumptions or a journal.
- Regression tests under `tests/regression/` cover public routing, actual source admission, negative/hidden/misattributed source mutations, date roles, multipart scope and preserved calculations. Nine new official native captures and their provenance manifest are in `tests/fixtures/statutoryKnowledge20261031/`.

## Actual answer-quality results

| Corpus/configuration | Correct | Partial | Incorrect | Unsupported |
|---|---:|---:|---:|---:|
| Frozen75 | 30 | 8 | 0 | 37 |
| Earlier60 | 59 | 0 | 0 | 1 |
| Fixed100 original | 50 | 12 | 0 | 38 |
| Fixed100 enriched | 66 | 8 | 0 | 26 |
| Fresh independently written 15 | 4 | 0 | 0 | 11 |

Frozen75 improved from 22 to 30 correct: IRAS +1, CPF +1, MOM +3, ACRA +2, MAS +1. Its final authority breakdown is:

| Authority | Correct | Partial | Incorrect | Unsupported |
|---|---:|---:|---:|---:|
| IRAS | 6 | 4 | 0 | 5 |
| CPF | 7 | 0 | 0 | 8 |
| MOM | 7 | 1 | 0 | 7 |
| ACRA | 4 | 3 | 0 | 8 |
| MAS | 6 | 0 | 0 | 9 |

Prior correct preservation: Frozen75 22/22, Earlier60 59/59, Fixed100 original 50/50 and enriched 62/62. The enriched Fixed100 gains are four AGM questions. Original and enriched are two source configurations of the same 100 questions, not separate question sets.

Frozen75/Earlier60/Fresh15 use application-entry rules-only understanding without issue hints. Fixed100 is guided issue/source replay. Evidence-path status is not whole-answer correctness. Changed complete answers were independently read; unchanged answers inherit recorded grades only after byte-identity checks. The final quality report is authoritative; intermediate ledgers retain earlier, superseded grades and findings.

## Verification actually performed

Node 22.23.3 was used. npm was unavailable in this Windows session; the underlying package commands were executed directly with the canonical Node runtime. Tests/captures used the offline request guard; all five final corpus captures recorded zero network and model requests.

| Check | Actual result |
|---|---|
| Root `oxlint` | Failed on the known pre-existing untracked `artifacts/fresh-acceptance-2026-10-24/prepare.mjs` archive; archive excluded from this publication |
| `oxlint src scripts tests` | Passed |
| `tsc -b` | Passed |
| Vite production build | Passed |
| Cloudflare worker build | Passed |
| Smoke runner `--tier=smoke` | 159/159 passed |
| Full runner `--tier=full` | 182/182 passed |
| Final five corpus captures | All exited 0 |
| Source/corpus integrity | 66 frozen inputs unchanged; nine new capture hashes and byte lengths match |
| Evidence-path preservation | No verified-path losses in either Fixed100 configuration; original `iras-eci-03` intentionally remains insufficient |
| Final committed source bytes | All 88 selected fixture/bundle files match their validated working-file bytes |
| Whitespace | CRLF-aware source/test diff check passed |

Independent code review reproduced branch-negation and hidden-audit-threshold defects; the builder fixed them, focused controls passed, and the reviewer confirmed both resolved. Final broad checks ran after the source freeze. No substantive source/test edits were made after those checks. This handoff is documentation only.

CI has not been run for this head. The repository CI workflow runs on pushes to main/master and PRs targeting them; this feature-branch push does not trigger it. No workflow was manually dispatched and no live integration test was run.

Portable replay inputs are published in this artifact directory: `combined-sources/` for the three natural/application runs and `fixed100-enriched-sources/` for the enriched guided run. Use the retained evaluation scripts, corpora and these manifests with Node 22; `audit.mjs` verifies the retained hashes/comparisons. The Windows `.tmp/canonical-node22` runtime is local tooling, not a repository dependency.

## Evidence links

All links below are pinned to the functional review commit:

- [Completion snapshot](https://github.com/dexrrick/accounting/blob/80034813f8bcb3b6ac58b5d017bd2c9a85f52620/artifacts/statutory-next-expansion-20261031/completion-summary.json)
- [Final grades by case and authority](https://github.com/dexrrick/accounting/blob/80034813f8bcb3b6ac58b5d017bd2c9a85f52620/artifacts/statutory-next-expansion-20261031/quality-report.json)
- [Preservation and source integrity](https://github.com/dexrrick/accounting/blob/80034813f8bcb3b6ac58b5d017bd2c9a85f52620/artifacts/statutory-next-expansion-20261031/preservation-report.json)
- [Final validation results](https://github.com/dexrrick/accounting/blob/80034813f8bcb3b6ac58b5d017bd2c9a85f52620/artifacts/statutory-next-expansion-20261031/validation-results.json)
- [Smoke log](https://github.com/dexrrick/accounting/blob/80034813f8bcb3b6ac58b5d017bd2c9a85f52620/artifacts/statutory-next-expansion-20261031/smoke.log) and [full-suite log](https://github.com/dexrrick/accounting/blob/80034813f8bcb3b6ac58b5d017bd2c9a85f52620/artifacts/statutory-next-expansion-20261031/full.log)
- [Final independent code-review record](https://github.com/dexrrick/accounting/blob/80034813f8bcb3b6ac58b5d017bd2c9a85f52620/artifacts/statutory-next-expansion-20261031/resumed/final-code-review.json)
- [Final changed-answer review packet](https://github.com/dexrrick/accounting/blob/80034813f8bcb3b6ac58b5d017bd2c9a85f52620/artifacts/statutory-next-expansion-20261031/resumed/finish-answer-delta-packet.json)
- [Official capture provenance manifest](https://github.com/dexrrick/accounting/blob/80034813f8bcb3b6ac58b5d017bd2c9a85f52620/tests/fixtures/statutoryKnowledge20261031/source-manifest.json)

The same artifact directory contains complete final answers (`final75.json`, `final60.json`, `fresh15.json`, `fixed100-original.json`, `fixed100-enriched.json`), baseline natural captures, baseline grades and captured review ledgers. Preceding Fixed100 answers and the Earlier60 corpus are published under `artifacts/statutory-review-followup-20261030/`.

## Remaining concerns and review focus

Coverage remains incomplete: Frozen75 has 37 unsupported and eight partial answers; Fresh15 has eleven unsupported. In particular, Frozen75 `acra-08` supplies adjacent filing-deadline guidance but does not answer the requested AGM-dispensation declaration date/details, so it remains unsupported. Secretary multipart and CPF OW/AW questions also retain honest evidence gaps. Do not treat a mapped rule, a green test, or a generic verified label as complete practical correctness.

Review exact source/claim support and financial-year/date roles, hidden/navigational text exclusion, numeric/polarity mutations, same-document completeness, company/group ownership, affirmative and negated branch-register facts, independent multipart obligations, historical/transition fail-closed behavior, and preservation of previously supported accounting/journal behavior. Inspect the complete base-to-head change, including the initial correction patch.

Implementation and necessary review evidence are committed. Local-only untracked material remains: `.tmp/`, `.pnpm-store/`, unrelated historical archives and omitted intermediate diagnostics/helpers. Those are not part of this review target; no implementation source/test corrections are intentionally left local. Completion snapshots were recorded before publication and therefore say uncommitted/unpushed; that is historical state, superseded by the published review target and final push confirmation.

## Ready-to-copy review prompt

Independently review https://github.com/dexrrick/accounting, branch `codex/statutory-knowledge-expansion-20261030`, code/evidence commit `80034813f8bcb3b6ac58b5d017bd2c9a85f52620` against base `2f8abb90a1af5303eaeeaf98c184644b5ea3e323`. A documentation-only successor contains this handoff. Confirm the exact commit you inspected. Use the handoff as context and verify its claims against the code, diff, tests, and available CI evidence. Report actionable findings with severity, file and line references, impact, and suggested fixes. State any access or verification limitations. Keep the review read-only.
