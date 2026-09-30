# Diagnostic stopping point

30/09/2026, `D:\Accounting`, branch `codex/multi-authority-workstreams`, base `47a6e4a`. This commit completes the reviewed diagnostic stage only. Production fixes and the final focused probe are pending. The user requires stopping before either remaining usage window reaches 7%; the pre-checkpoint snapshot showed 14% five-hour and 11% weekly remaining. No active or scheduled work continues after this commit.

Read `contract-consistency-audit.md` first. Exact new field evidence:

- General recognition and interaction: concept objects lack required `concept` and add one unknown key; exact-key validation rejects them. The prompt currently does not declare the concept object's keys, and shows only an empty concepts array.
- A-paraphrase-3: top OTHER + calculationRequested=true contradicts the defined equality. It has two CALCULATE issues, demonstrating the model's erroneous any-issue summary interpretation in this observation.
- The three old raw invalid bodies remain unavailable. New diagnoses reproduce their labels but do not reconstruct them.

The user explicitly authorized the three pre-change synthetic requests to Google's Gemini API after automatic review twice rejected runner creation. No bypass occurred. Exactly three once-only requests completed, all invalid, without 429s/timeouts/provider errors; latency max 5,494 ms. Saved shapes omit labels, facts, raw bodies/prompts, unknown names, arbitrary errors and credentials. Model/timeout/source/fixture fingerprints and safe sizes/timings are retained.

Files: `semantic-contract-diagnosis-baseline.{json,md}` (immutable new report); `contract-followup-comparable-baseline.json` (five historical before results); `contract-followup-protected-hashes.json` (prior-report/final-fixture hashes); `tests/evaluation/singapore/semantic-contract-followup.json` (fixed ten-case final probe, uncalled). Original historical manifests also remain intact.

Implementation so far: evaluation-only `semantic-contract-diagnosis.mjs` (pure diagnostic utility), `semantic-contract-diagnostics.mjs` (three-case gated runner), `test_semantic_contract_diagnostics.mjs` (mocked safety/privacy checks) and smoke/full registration. Builder's focused Node 22.23.1 check passed; reviewer cleared code and saved results after safe CLI-error handling and explicit model propagation were fixed. Final checkpoint validation results are recorded in the audit. Production source remains hash `2e8c6cac5e0e5a2bb802823f30cb6c2af35040300c7e93eff519e65467893505` with an eight-second deadline.

**HOLD MERGE.** Next implement the explicit concept-object schema and versioned omission/derivation of calculationRequested, preserving contradictory-legacy rejection and the existing interpretation/callers. Then improve generic intent guidance for the two operation misses; no exact benchmark phrase patches or arbitrary deterministic overrides. Add migration/validator and all-eight-operation independent regressions. Review independently before the final ten-case live probe. Add safe field diagnostics to that probe without logging raw invalid content; use a new prefix, no retries, eight seconds, existing model and at least 15,250 ms start gaps. The default older evaluation runner can retry 429s, so explicitly provide/test a no-retry mode rather than silently using that behavior.

No production change is implemented yet; no before/after improvement or no-regression claim is established for the requested fixes. Do not broaden statutory sources, tune held-out cases, relabel frozen cases, repeat diagnosis calls, overwrite reports, merge or deploy. Use Node.js 22.23.1 and the runtime paths in the prior `operation-reliability-checkpoint.md`. Obtain current usage on resumption; do not automatically consume reset credits.
