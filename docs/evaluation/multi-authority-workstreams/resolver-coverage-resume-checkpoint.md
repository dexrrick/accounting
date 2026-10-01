# Resolver/coverage checkpoint — 01/10/2026

**HOLD MERGE. No merge, deployment, push, live provider evaluation or final-ten run.** Branch `codex/multi-authority-workstreams`; starting commit `bdd825514c6437ff3dbc4cd173b8b15855755f97`. This document is included in the new checkpoint commit; obtain its exact SHA with `git rev-parse HEAD`.

Root causes: A-paraphrase-2's employer CPF contribution subject recognizes `cpf_contribution_rates`, but raw-query discovery lacks payment/contribution synonyms and the required independent intersection removes it. Generic MOM work-pass wording lacks a generic parent topic; selecting Employment Pass, S Pass or Work Permit would invent a fact. The resolver's transaction-semantic lexical suppression is not used in this issue-plan path. Neither failure is caused by authority/population filtering or compound suppression.

Fix: bounded payment/contribution query patterns on the existing CPF topic; new `mom-work-passes-general` in MOM_WORK_PASSES with MISSING coverage, no source records and no statutory citation. Resolver, issue-level intersection, semantic prompts/operations, provider selection, accounting/statutory rules, evidence/privacy gates, model/timeout/retries are unchanged. Authority-relief profiles now fingerprint resolver and coverage metadata.

Changed code/test files:
- `src/standards/coverageRegistry.ts`
- `scripts/run_all_tests.mjs`
- `tests/regression/test_resolver_coverage_contract.mjs`
- `tests/regression/test_material_issue_decomposition.mjs`
- `tests/regression/test_semantic_authority_relief_evaluation.mjs`
- `tests/evaluation/singapore/semantic-contract-followup-evaluation.mjs`
- `tests/evaluation/singapore/resolver-coverage-diagnosis.mjs`

New regression families: seven CPF cases, seven MOM cases, CPF/IRAS and MOM/CPF isolation within those families, plus independent ACRA/IRAS and accounting/tax compounds. Sixteen offline cases, 22 issues. A supervisor fixture correction replaced a tax-only question incorrectly supplied with a CPF outcome with actual independent CPF amount and corporate tax rate requests. The background-only CPF control remains.

Local mapping: **6/8 -> 8/8 fully mapped cases; 7/9 -> 9/9 mapped requested issues and actual default provider paths**. Final diagnostic uses adjudicated synthetic semantic inputs, default providers, empty local retriever, network-disabled execution and zero model calls. All guards pass, with zero unexpected topic leakage or unsupported-provider routes. These are local routing results, not live semantic metrics. Fresh final artifact: `resolver-coverage-final-local-routing-diagnosis.json`; seven fingerprints match final source bytes. The earlier `resolver-coverage-local-routing-diagnosis.json` predates a last MOM synonym refinement and is an intermediate observation, not acceptance evidence. Baseline remains `resolver-coverage-baseline-diagnosis.json`.

Broader audit: generic/specific/compound queries for eight requested families, 24 total. Fully mapped 14/24 -> 18/24; six unresolved generic questions remain NO_COVERAGE_TOPIC (individual tax, corporate tax, GST, company compliance, fund-manager regulation, general SFRS(I)). This small sample does not establish knowledge completeness. The final JSON records each question, query topics, requested issues, mapped topics, reasons, provider paths and guards. Diagnosis and design decisions: `resolver-coverage-contract-audit.md`.

Validation on exact Node.js 22.23.1:
- New resolver contract and corrected fixture: 16 cases/22 issues pass.
- Builder targeted suites pass: decomposition, authority-relief evaluation/contract, authority workstreams/presentation, topic resolver/provenance and coverage registry.
- Smoke **57/57**, 101.67 seconds. The final fixture correction was checked separately and included in the subsequent full run.
- Full **77/77**, 218.47 seconds, including the final smoke suites and required semantic intent boundaries, semantic contract runner, routing, evidence/privacy diagnostics and accounting/source invariants.
- Lint passes, including final corrected test; existing generated-file warnings remain.
- TypeScript/production build passes; existing chunk-size/deprecation warnings remain. Final production metadata was present before this build and did not change afterward.
- Final diagnostic fingerprints match, all 29 protected historical hashes match; `git diff --check` passes. No frozen fixture labels or historical observations were rewritten.

Independent reviewer: no material production findings; corrected CPF/tax fixture verified; fingerprint finding closed after fresh diagnostic. Conditional approval for targeted live evaluation after local validation and usage floors. No unresolved review findings.

**Live targeted: not run. Final ten: not run.** Pre-live usage check showed 93% used / **7% remaining** in the five-hour window, 20% used / **80% remaining** weekly. The five-hour remainder was exactly the user-required reserve, leaving no headroom to preserve at least 7% while continuing orchestration. No reset credit was consumed; no thresholds were lowered. Checkpoint rather than enter live evaluation.

Resume: recheck usage first, preserving at least 7% in both windows with sufficient orchestration headroom. Confirm unchanged final diagnostic/source fingerprints and protected historical hashes. Run the existing fixed eight-case `authority-relief-targeted-live` profile in a fresh output directory (suggested `docs/evaluation/multi-authority-workstreams/resolver-coverage-live-2026-10-01`, which did not exist at checkpoint). Keep model `gemini-3.5-flash-lite`, temperature 0, JSON mode, timeout 8,000 ms, no retries, exactly one request per case and >=15,250 ms between request starts. Do not tune after observing results. Strict acceptance remains 100%, exact dimensions/operations/flags, 9/9 mapped/provider paths, safe runtime guards and stable fingerprints. Any failure: HOLD MERGE, preserve reports, do not run final ten. Only complete targeted live acceptance permits the unchanged original ten-case final profile in the same fresh output directory, preserving separate raw historical and canonical scoring. Do not merge/deploy automatically.

Runtime paths: `C:\Users\Admin\AppData\Local\node-v22.23.1-win-x64\node.exe`, adjacent npm CLI; prepend that directory to PATH. Working Git: `C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe`. Runtime execution and Git metadata writes require sandbox escalation. Never print `.env.local`; the configured secret key name is GEMINI_API_KEY. Validation logs are ignored `.tmp-ci/resolver-coverage-*.log`.
