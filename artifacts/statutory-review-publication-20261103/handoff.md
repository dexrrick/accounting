# Balanced statutory expansion and WHT scope safeguards

## Goal and status

Extend one focused practical area for each of ACRA, CPF, MOM, IRAS and MAS, retain the original-query WHT treaty safeguards, and preserve previously correct answers. Implementation and local offline validation are complete. Independent source and answer review found no remaining material findings in the final code. Publication is for review; merge, deployment, source activation and live acceptance are separate gates.

## Exact review target

- Repository: https://github.com/dexrrick/accounting
- Branch: `codex/statutory-knowledge-expansion-20261030`
- Validated source/test commit: `4129caa5f611073aeecf87d3ac95b5d32a79f274`
- Base: `24102c38d1b081f786cf22a643bc16747986eb3d`
- Source diff: https://github.com/dexrrick/accounting/compare/24102c38d1b081f786cf22a643bc16747986eb3d...4129caa5f611073aeecf87d3ac95b5d32a79f274
- No new PR was created. A following evidence/documentation commit publishes this handoff and the proof packet; its source/test content is identical to the validated code commit. The final chat identifies that published branch head separately.

## Changes and intended behavior

- **WHT:** `irasMasKnowledge20261027b.ts`, `semanticQuestionUnderstanding.ts`, `questionClassifier.ts`, and new `taxJurisdictionNames.ts` distinguish named treaties from general questions using the original complete request. “How do tax treaties with Australia affect withholding tax on payments to non-residents?” remains unresolved without treaty-specific evidence. “In general, how does a tax treaty affect withholding tax for non-resident payments?” retains supported general guidance. Tests cover plural forms, jurisdiction aliases, demonyms, ordinary lowercase complements and residual requests.
- **ACRA:** `targetDateResolver.ts` and `acraMomKnowledge20261027b.ts` treat an explicitly owned current registration date as a company-secretary workflow fact. They can apply the appointment deadline while preserving the sole-director restriction; another company's date cannot be borrowed.
- **CPF:** `cpfPayrollKnowledge20261027b.ts`, classification and semantic routing distinguish qualitative low-wage employee/employer shares from numeric contribution requests. A single explicit eligible employee and total monthly wages are required for the concrete wage cases. No employer amount or payroll journal is invented; explicit calculation intent retains priority.
- **MOM:** joint ordinary-salary/overtime requests receive separate deadlines and, where facts permit, applied dates. Single-deadline legacy questions retain their prior route. Payment completion is checked at the matched payment action, including same-sentence future/negated wording and contracted negation. Both evidence-date and answer gates reject cross-employee borrowing across name casing, possessives, and conventional employee IDs while preserving generic unnamed-employee cases.
- **IRAS:** health-screening/check-up language with employee context reaches the existing staff-medical input-tax rule and its source-supported exceptions. The rule itself was not liberalized.
- **MAS:** `statutoryWorkflows20261029.ts`, `statutoryKnowledge20261027b.ts`, `coverageRegistry.ts`, `authorityWorkstreams.ts` and `groundingContextBuilder.ts` add narrow VCFM branch approval/form guidance. Admission requires the complete native toolkit row 2, re-proves the selected quote and binds it to the fetched PDF hash and page locator. It does not borrow LFMC rules, the separate 20% acquisition limb, or generic fallback verification. The whole PDF remains marked table-structure ambiguous; this is bounded row evidence, not blanket table approval.
- Seven existing regression files were extended, including the WHT production application regression, ACRA/MOM knowledge, CPF expansion, IRAS/MAS knowledge, workflow expansion and GST locator suites. The MAS acceptance cases are inline rather than dependent on an untracked artifact.

## Verification actually performed

- **Local offline:** Node 22.23.3; preflight, maintained `src scripts tests` lint, TypeScript, Vite and Worker builds passed. Smoke **161/161** and full regression **184/184** passed on frozen source content. No broad functional checks were repeated for publication because source content remained unchanged.
- **Known local lint failure:** root lint reports 34 pre-existing parsing errors in the unrelated, untracked `artifacts/fresh-acceptance-2026-10-24/prepare.mjs`. That file is excluded from this publication. Maintained-code lint passed.
- **Application acceptance:** two cases per authority, **10/10 independently graded correct bounded guidance**. `balanced-iras-2` is a pre-existing working control, not a new coverage gain. Whole-question completeness and individual applicability remain conditional.
- **Frozen preservation:** 350 outputs comprise 150 natural application answers and 200 fixture-plan answers. **347/350 unchanged; all 213 previously correct answers byte-identical**. The three changed answers are `final75/iras-03`, `final75/acra-01`, `final75/mas-10`, each independently graded correct bounded guidance. Questions and frozen evidence did not drift; replay made zero network/model requests. The preceding WHT-only stage preserved all 350 baseline answers.
- **Before-capture lineage:** the original before-answer packet records code `847fdad2cfeea3e2d222ea4c4e1ce22ce7d46323`. Base `24102c38d1b081f786cf22a643bc16747986eb3d` changes only the CI checkout to `fetch-depth: 0`; product/test code is identical. The package verifier checks that only `.github/workflows/ci.yml` differs between those two commits.
- **Independent review:** final code, ten acceptance-answer hashes and three changed-answer hashes were bound to the frozen packet. Earlier review findings about date ownership, numeric CPF intent, MOM payment polarity/casing and untracked test dependencies were corrected and checked.
- **CI:** these are local results, not CI results. Check the newly pushed branch head's GitHub Actions result separately; no historical CI run proves this new head.
- **Not performed:** new live provider/browser acceptance, deployment, merge or source activation. Offline replay and hash stability do not establish legal correctness by themselves.

## Published evidence

All paths below are relative to this handoff's review packet directory. The README and hash manifest index the exact selected evidence. The five compact answer-capture files preserve the exact rendered before/after answer strings and questions for all 350 outputs; they are not the full 350 internal diagnostic traces. Full final application traces for the ten acceptance cases and both original WHT reproductions are included. Retained official source fixtures used by the regressions are already tracked in the repository.

- [Packet index](README.md), [evidence hashes](evidence-hashes.json), [source publication hashes](source-publication-hashes.json)
- [Preservation rows](preservation.json), [three changed answers](changed-answers.json), [final independent review](independent-review-final.json)
- [Ten application traces](final-acceptance.json), [acceptance questions](acceptance-cases.json), [MAS native row proof](mas-vcfm-branch-proof-diagnostic.json)
- [75-case exact answer pairs](final75-answer-strings.json), [60-case pairs](final60-answer-strings.json), [15-case pairs](fresh15-answer-strings.json), [original fixed100 pairs](fixed100-original-answer-strings.json), [enriched fixed100 pairs](fixed100-enriched-answer-strings.json)
- [Full regression log](full.txt), [smoke log](smoke.txt), [validation results](validation-results.json), [full result](full-results.json)
- [Original WHT questions](wht-review-cases.json), [WHT before traces](wht-review-before-app.json), [WHT after traces](wht-review-after-app.json)

The packet also includes frozen source hashes, canonical LF source hashes for Git's CRLF/LF handling, the full preservation row matrix, changed answers, independent grades, native MAS row diagnostic, final suite/build logs and a verifier. Source comparison allows only line-ending normalization; it does not permit substantive changes. Original local reports retain their historical “uncommitted/unpushed” fields from capture time; the publication commit and final chat supersede that historical publication status.

Requested source/test changes and selected evidence are committed for GitHub review. Unrelated existing workspace artifacts, exploratory captures and full 350 diagnostic traces remain local and are not included. No requested source/test file remains uncommitted.

## Review focus

1. Named treaty variants must never acquire general-rule completeness from a shortened issue label; ordinary general treaty questions must retain guidance.
2. Current workflow dates must remain owned event facts, not unsupported historical-law proof. Test cross-company/employee dates, explicit numerical CPF requests and missing material facts.
3. MOM future/negated payment wording, mixed-case names, employee IDs and a later named possessive must not create a completed payment or timeliness conclusion. Confirm unnamed positives and the old single-deadline answers remain intact.
4. MAS raw PDF identity, physical row boundaries, complete column reconstruction, selected-quote reproof, source hash and locator must all remain necessary. Reject incomplete, reversed, wrong-form, wrong-regime and mixed-scope evidence.
5. Independently assess rendered answers and official excerpts. Do not equate routing, quote presence, passing tests, preserved hashes or conditional guidance with full substantive correctness.

## Ready-to-copy review prompt

Independently review the changes identified above in https://github.com/dexrrick/accounting using your GitHub access. Inspect validated source commit `4129caa5f611073aeecf87d3ac95b5d32a79f274` against base `24102c38d1b081f786cf22a643bc16747986eb3d`, together with the published evidence packet on `codex/statutory-knowledge-expansion-20261030`. Confirm the exact commit you inspected. Use the handoff as context and verify its claims against the code, diff, tests, and available CI evidence. Report actionable findings with severity, file and line references, impact, and suggested fixes. State any access or verification limitations. Keep the review read-only.
