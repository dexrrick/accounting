# Multi-authority semantic pipeline: stopping checkpoint

30/09/2026, Singapore time. **The authorized audit, implementation, independent review, local validation, corrected live benchmark and frozen held-out evaluation cycle is complete.** Remaining reliability/operation limitations are documented; this is the stopping point for a separately scoped follow-up. Changes remain uncommitted, with no PR or deployment.

## Resume here

Read `semantic-live-audit.md` for final measurements, adjudication, validation and next priorities. Do not rerun the completed live benchmarks or redo implementation by default. The original reports and frozen held-out fixture still match their original hashes. Production and scoring were not tuned from live/held-out results.

Fresh corrected: 42 calls, 30 valid, recall 70/71, precision 70/72, complete issue coverage 28/42, valid-response workstreams 30/30; 9 client timeouts and 3 invalid responses. One separately adjudicated scoring phrase gap gives recall 71/71, precision 71/72 and coverage 29/42 without altering raw reports.

Frozen held-out: 20 calls, 19 valid, recall/precision 23/23, complete issue coverage 19/20, workstreams 19/19, operation accuracy 22/23; one invalid response and no timeout. Local evidence/routing checks pass 42/42 and 20/20, but do not score substantive answers or correct operation selection.

Both runs returned zero HTTP 429. Corrected pacing had at most 8 request starts per rolling minute; held-out was slowed to at most 4 after the user's RPM question. The active project quota remains unverified. Corrected timeouts occur at the production 8-second abort deadline. Different questions and conditions prevent concluding RPM caused the timeout difference.

An initial evaluator crash lost one unclassified provider attempt before persistence. It is disclosed separately in `semantic-live-audit.md`; the subsequent 62 requests are retained with their outcomes. The evaluation-only checkpoint bug was fixed by builder, covered by a no-API Node 22 regression, and independently reviewed. Subsequent report-only generation made no provider calls.

Next work, if requested: confirm actual Google project RPM/TPM quotas and shared use; investigate the 8-second deadline/invalid structured responses separately; improve operation selection. No new source pack is justified yet. A narrow recognition/admission review of existing employee personal-CPF-relief coverage is preferable to broad statutory expansion. Preserve this frozen measurement baseline.

Final artifacts: `corrected-live-semantic-evaluation.{json,md}`, `heldout-live-semantic-evaluation.{json,md}`, `semantic-live-audit.md`, `semantic-live-adjudications.json`. Final fingerprints and all attempt histories are retained.

Both fresh reports have zero pending checkpoints and interpreter SHA-256 `4a032381ca71bffb6fd6b7c93ce8f8ff57a21a549486b5483ded01e223d1e221`. Their final attempt counts remain 42 and 20 after no-API report-only finalization.

## Historical checkpoint — 29/09/2026

The sections below preserve the prior local-validation stopping point. Deferred live work described below has now been completed; the old live commands are historical instructions, not tasks to repeat.

The user authorized audit, implementation, review, validation and subsequent live measurement in the attached supervisor request. Their later request was to finish current work, create a stopping point, and continue next time. No automation was created.

## Completed

- Audited all original saved cases before changing production. The failure table distinguishes benchmark ambiguity, subject scoring, model decomposition/operation/population, deterministic routing, taxonomy and evidence gaps.
- Corrected A-paraphrase-2's extra employee contribution expectation and adversarial-F's background-accounting expectation in a separate fixture. Recognized equivalent descriptions without using predicted authority/domain/population to force a match. Retained strict amount/journal expectations and one-to-one matching.
- Refined the generic prompt for single and compound requested outcomes, company employer versus taxpayer roles, employee personal-tax versus benefit-tax subjects, and calculation/journal/interaction operations. Old provider responses without issue arrays still validate.
- Validated requested issues control legacy accounting scope. Mapped topics retain routing priority. Topicless employee personal relief and salary, benefit tax, company deduction and explicit employer reporting have separate routes; unclear roles stay unresolved.
- Unassigned taxonomy matches remain visible gaps and prevent whole-question evidence completeness, while no longer generating extra requested workstreams or accounting requests.
- Added focused regressions and a shared scorer. Runner supports separate fixtures/output prefixes, offline rescoring, optional deterministic replay, explicit metric denominators and routing/evidence-guard checks. Original output prefix is protected in alternate-fixture/rescore modes.
- Frozen held-out set: 12 unique cases, 20 planned calls (four cases repeat three times), created before implementation/live measurement and not used for tuning. Corrected live fixture: 26 unique cases, 42 planned calls, including repeated difficult paraphrases.

## Verified measurements and limits

| Measurement | Original saved scoring | Corrected scoring of same saved responses | Updated deterministic routing replay |
|---|---:|---:|---:|
| Material issue recall | 66/77 (85.7%) | 74/75 (98.7%) | 74/75 (98.7%) |
| Material issue precision | 66/74 (89.2%) | 74/74 (100%) | 74/74 (100%) |
| Complete material issue coverage, all logical calls | 23/34 (67.6%) | 32/34 (94.1%) | 32/34 (94.1%) |
| Exact final workstream sets, valid interpretations | 25/33 (75.8%) | 26/33 (78.8%) | 33/33 (100%) |
| Local routing/evidence-guard checks | Not measured | Not measured | 33/33 (100%) |

Corrected scoring is an audit of the benchmark, **not evidence of model improvement**. Deterministic replay measures changed reconciliation/routing on old responses, not the new prompt. Thirty-three valid interpretations were reconstructed from persisted top-level and issue fields because original records omit full JSON concepts/facts; raw responses and schema failures cannot be reconstructed.

All 34 original logical rows and 54 original provider attempts are retained: 18 provider errors, 3 invalid-response attempts, and 33 valid final interpretations; one case ended invalid. Complete-question coverage uses all 34 logical calls; per-issue quality and routing use the 33 valid interpretations. Authority/domain accuracy among matched issues is not whole-question accuracy.

Remaining semantic defects in saved responses: A-paraphrase-3 merges separate employer/employee contribution outcomes, population accuracy is 70/74 and operation accuracy 60/74 under corrected scoring. All replayed questions remain evidence-incomplete where taxonomy/source coverage cannot support every issue. Local guard checks do not prove tax/accounting answer correctness, live source freshness, or missing-fact adequacy beyond the tested checks.

Ambiguities retained explicitly: adversarial-D states the work-pass need as possible background (original scope retained for comparability); adversarial-E does not identify the reporter (UNKNOWN or employer-reporting alternative allowed). The held-out salary/work-pass control requests both explicitly.

## Validation and review

- Three focused regressions passed under Node.js 22.23.1: material issue decomposition, authority workstreams, issue scoring.
- `npm run lint`: passed; existing warnings in unrelated tests, utility files and `.tmp-ci` remain.
- `npm run build`: passed for final production changes; existing bundle-size/deprecation warnings remain.
- `npm run test:smoke`: 47/47 suites passed on the final production revision. Final `npm test`: 67/67 suites passed after the last review fix. `git diff --check` also passed.
- Offline corrected rescore and deterministic replay passed; no credential or API call was needed.
- Independent review completed. Fixed the material finding where a company deduction could be mistaken for employee benefit tax because the employee was the recipient or model population. The reviewer confirmed corporate deductions, employee benefit outcomes and genuinely merged outcomes now remain distinct. Also closed original-prefix overwrite protection and metric-denominator findings. Supervisor reviewed the changes and verification results.
- A reviewer asked about the bare noun-order label `tax treatment accommodation benefit employee` with population UNKNOWN. The supervisor retained UNKNOWN: unlike the saved grammatical labels with an explicit employee tax subject, this label does not establish the taxpayer's requested outcome. This is an intentional unresolved classification, not an extra supported benefit-tax rule.
- No live external-source integration run was needed: transport/source logic was not changed. Fresh live semantic/held-out runs were deferred by the user.

Logs are ignored workspace files: `.tmp-ci/semantic-audit-{lint,build,smoke,full,replay}.log`.

## Files and artifacts

Production: `src/services/semanticQuestionUnderstanding.ts`, `src/services/authorityWorkstreams.ts`, `src/services/geminiService.ts`.

Evaluation: `tests/evaluation/singapore/multi-authority-workstreams-live-evaluation.mjs`, `multi-authority-issue-scoring.mjs`, `multi-authority-workstreams-corrected.json`, `multi-authority-workstreams-heldout.json`.

Regressions: `tests/regression/test_material_issue_decomposition.mjs`, `test_authority_workstreams.mjs`, `test_multi_authority_issue_scoring.mjs`, `test_multi_authority_runner_safety.mjs`; registered in `scripts/run_all_tests.mjs`.

Reports: this checkpoint; `semantic-audit.md`; `corrected-saved-response-rescore.{json,md}`; the canonical final `corrected-saved-routing-replay.{json,md}`, all in `docs/evaluation/multi-authority-workstreams/`. The builder also retained an additional offline replay copy named `corrected-saved-response-replay.{json,md}`; it is not a separate live measurement.

Base branch: `codex/multi-authority-workstreams`; base commit: `2ae0b7f11f5edaa55e6f97373f3ad175ff7c6d67`. Changes remain in the working tree, uncommitted. No PR or deployment was requested or created.

Original SHA256 fingerprints (verified unchanged):

- Original JSON: `8CCAD78F9623DA692C8AC39FD950330864FF25AE0383FE05E1D60C8A2AF22120`.
- Original Markdown: `E642C6BA01B7C9EC4D014630927B4ADABDC318424084DD52251CC8649EEFE6C7`.
- Original fixture: `92D54EDAD671D537CD4C38467A49663FCEF3E5463AC79D14F81450DCB7DE1B18`.
- Frozen held-out fixture: `297D1999DD24899833819CC0B7EE803F0680FDCA9C0E35C6088A8E0E234E1C35`.

## Historical live commands — completed on 30/09/2026

Work in `D:\Accounting`. The project requires Node 22; the default bundled `node` is 24. Use the existing Node 22 executable below. Sandbox execution at that path required escalation; approved validation commands succeeded. Gemini is already configured in ignored `.env.local`; do not print its contents or credentials. The ordinary `git` shim is broken; working Git is `C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe`.

```powershell
$taskNode = 'C:\Users\Admin\AppData\Local\node-v22.23.1-win-x64\node.exe'
& $taskNode --env-file=.env.local node_modules/tsx/dist/cli.mjs tests/evaluation/singapore/multi-authority-workstreams-live-evaluation.mjs --live --fixture=tests/evaluation/singapore/multi-authority-workstreams-corrected.json --output-prefix=corrected-live-semantic-evaluation
& $taskNode --env-file=.env.local node_modules/tsx/dist/cli.mjs tests/evaluation/singapore/multi-authority-workstreams-live-evaluation.mjs --live --fixture=tests/evaluation/singapore/multi-authority-workstreams-heldout.json --output-prefix=heldout-live-semantic-evaluation
```

Run these sequentially. Minimum request-start interval is 8,000 ms (runner adds a guard); increase it if the configured quota requires slower pacing. Use `--resume` with the same fixture and prefix after an interruption. Do not repeatedly run live evaluations during development. Preserve attempts and sanitize provider failures. Do not reuse the frozen original prefix.

After both runs: manually audit scorer mismatches, report distinct corrected/live/held-out denominators, material recall/precision, whole-question coverage, final scope and operation/population quality, provider/schema outcomes, and repeated-paraphrase stability. Reconciliation is deterministic; avoid changing evidence safeguards or introducing new statutory content to improve scores.

No source-coverage expansion is justified yet. First distinguish existing personal-relief/employer-reporting topic-recognition gaps from missing reviewed evidence in the pending results. Consider one narrowly scoped source review only if that evidence gap persists; do not broadly expand statutory coverage.
