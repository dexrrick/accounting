# Fresh live semantic evaluation — supervisor record

Resumed on 30/09/2026 after the reviewed local checkpoint. The original reports and frozen held-out fixture were fingerprinted before measurement and matched the checkpoint. The corrected benchmark and held-out evaluation use separate output prefixes. The held-out fixture remains unavailable for production or scorer tuning.

## Measurement integrity

The first corrected-benchmark invocation crashed after invoking the interpreter but before saving its first pending row: `summarizeAll` assumed every row already contained `failureTaxonomies`. No report or temporary result file was persisted. This is one additional interrupted, unclassified provider request outside the later report's attempt history; its response, HTTP status, and semantic outcome cannot be recovered. It must not be counted as a valid interpretation or silently attributed to a provider/schema failure. The preserved failure log is `.tmp-ci/semantic-corrected-live-initial-crash.log`.

The runner repair passed a Node 22 no-API regression and independent review before live measurement restarted. It safely writes pending JSON/Markdown, excludes stale retry scores, counts attempts exactly once, prevents pending suite completion, and resumes local finalization without another provider request. Logical-call provider completeness consistently refers to the latest attempt; historical responses remain in attempt counts. Production interpretation, routing, fixtures and scoring expectations were unchanged by this repair.

There were 62 persisted provider requests across the two completed run plans, plus the one unclassified interrupted request above. No invalid response or timeout was retried to improve scores. Original reports were preserved. Final report-only generation used saved attempts and made no provider calls.

## Results

| Measurement | Corrected saved-response rescore | Current routing on saved responses | Fresh corrected benchmark | Frozen held-out |
|---|---:|---:|---:|---:|
| Planned/attempted logical calls | 34/34 | 34/34 | 42/42 | 20/20 |
| Final valid interpretations | 33 | 33 | 30 | 19 |
| Material issue recall, valid responses | 74/75 (98.7%) | 74/75 (98.7%) | 70/71 (98.6%) | 23/23 (100%) |
| Material issue precision, valid responses | 74/74 (100%) | 74/74 (100%) | 70/72 (97.2%) | 23/23 (100%) |
| Complete issue coverage, all logical calls | 32/34 (94.1%) | 32/34 (94.1%) | 28/42 (66.7%) | 19/20 (95%) |
| Exact final workstreams, valid interpretations | 26/33 (78.8%) | 33/33 (100%) | 30/30 (100%) | 19/19 (100%) |
| Matched-issue population accuracy | 70/74 (94.6%) | 70/74 (94.6%) | 69/70 (98.6%) | 23/23 (100%) |
| Matched-issue operation accuracy | 60/74 (81.1%) | 60/74 (81.1%) | 55/70 (78.6%) | 22/23 (95.7%) |
| Local routing/evidence checks | Not measured | 33/33 | 42/42 | 20/20 |

The original scoring was recall 66/77, precision 66/74, complete issue coverage 23/34, and exact workstreams 25/33. Corrected saved scoring measures benchmark corrections, not model improvement. Current saved routing is deterministic replay, not a fresh prompt measurement.

Fresh matched authority, contextual-authority and domain accuracy are 70/70 corrected and 23/23 held-out. These are conditional issue metrics, not whole-question accuracy. The local guard denominator includes 12 corrected fallback/invalid rows and one held-out fallback/invalid row. Those checks test operation preservation and fail-closed coverage, not correct operation selection, missing-fact sufficiency, source freshness, or substantive accounting/tax answers.

The stricter raw semantic-understanding contract, including issue coverage and matched dimensions, passes 19/30 valid corrected interpretations (19/42 across all calls) and 18/19 valid held-out interpretations (18/20 across all calls). It is still an interpretation benchmark, not answer verification.

The fresh corrected run includes eight additional difficult-paraphrase repetitions. Restricting it to the same 34 case/repetition slots as the original gives 25 valid responses, recall 57/57, precision 57/58, complete coverage 24/34 (70.6%), exact routing 25/25, and operation accuracy 42/57 (73.7%). This is a comparable planned cohort, not a paired valid-response cohort. Failures change which responses enter issue-quality denominators. Fresh end-to-end reliability is not shown to improve over the corrected saved baseline.

## Manual audit of fresh discrepancies

Raw reports remain unchanged by adjudication. The separate `semantic-live-adjudications.json` records the following:

- Corrected D-paraphrase-1, run 2: `accounting treatment under SFRS(I)` correctly identifies the expense accounting outcome; the matcher misses its abbreviated subject. One justified extra match gives manually adjudicated recall 71/71, precision 71/72, and complete issue coverage 29/42. These are an explicitly separate interpretation, not rewritten benchmark scores.
- Corrected C-paraphrase-3: a third interaction issue duplicates the two requested tax outcomes. This is a genuine extra model issue.
- Corrected adversarial-E: the reporter is unspecified. The model's EMPLOYEE population violates the frozen UNKNOWN contract, while the final IRAS/UNKNOWN stream correctly stays unresolved. The raw RECONCILIATION_REJECTION flag is a failure-taxonomy artifact: no issue was actually REJECTED, and reporting remains NO_COVERAGE_TOPIC.
- Corrected CPF amount and identified housing-tax questions still receive EXPLAIN_RULE in several responses. These are real operation-selection faults that can affect fact requirements. They must not be hidden by perfect routing or operation-preservation checks.
- Held-out: no scoring mismatches found. The mixed-population question uses CALCULATE correctly for employer CPF but EXPLAIN_RULE for the employee's personal-relief eligibility, rather than CHECK_ELIGIBILITY/DETERMINE_TREATMENT. One explicit accounting-and-tax repeat is invalid. Unknown reporting stays IRAS/UNKNOWN; the unfamiliar charge stays uncovered and evidence-incomplete.

Independent review confirmed these findings. Production, matching rules and held-out labels were not tuned from either live run.

## Reliability, RPM and stability

Corrected: 42 persisted attempts, 33 provider responses, 30 valid interpretations, 9 TIMEOUT and 3 INVALID_RESPONSE. Held-out: 20 attempts/responses, 19 valid interpretations and 1 INVALID_RESPONSE. Both have zero HTTP 429, other provider errors, low-confidence fallbacks, and runtime-routing failures. Invalid response bodies are unavailable, so the exact parse/schema/length failure cannot be reconstructed.

Corrected request starts were at least 8,251 ms apart (nominally about 7.3 requests/minute; at most 8 starts within any rolling 60 seconds). After the user's RPM question, held-out starts were at least 15,250 ms apart, with at most 4 starts in a rolling 60 seconds. Runs were sequential, without concurrent evaluator provider requests. The active Google project quota and other clients' project usage remain unverified; runner pacing is not proof of account quota compliance.

All corrected TIMEOUT attempts took approximately 8,001–8,017 ms, matching `SEMANTIC_QUESTION_TIMEOUT_MS = 8_000` and the transport's AbortController. The observed termination is the client deadline. Absence of HTTP 429 provides no direct evidence of quota exhaustion; provider latency, networking or shared load could still contribute. Google's [rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits) states quotas are project-wide, and its [troubleshooting guidance](https://ai.google.dev/gemini-api/docs/troubleshooting) distinguishes rate exhaustion from timeouts. Held-out had no timeout at slower pacing, but different questions, time and provider conditions prevent attributing the difference solely to RPM. Timeout duration and production transport were not changed during measurement.

Corrected repeated workstreams were stable for 3 fully assessed cases out of 8, with 16/24 valid repeated outputs. A-paraphrase-3 has no valid output in its three attempts; five cases lack enough valid outputs for full stability assessment. Held-out was stable for 3 fully assessed cases out of 4, with 11/12 valid repeat outputs. The explicit accounting-and-tax case lacks its third valid output. These are workstream-set observations, not proof of semantic/operation stability.

## Validation, stopping point and next work

The production revision previously passed lint, build, smoke 47/47 and full 67/67 under Node 22.23.1 on 29/09/2026. Production files were unchanged during this resumed measurement. The evaluation-only checkpoint repair passed its focused Node 22 regression, lint and independent review on 30/09/2026. No broad suite repetition or external-source integration run was required for that repair. Original report/fixture and frozen held-out hashes remain preserved.

This audit/implementation/review/measurement cycle is complete, with the limitations above. All changes remain uncommitted on `codex/multi-authority-workstreams`; no deployment or PR was requested. The reports and attempt histories form the next stopping point.

Next priorities are to confirm the active project RPM/TPM quota and shared usage, then separately investigate the 8-second client deadline and invalid structured responses. Preserve this measurement as the baseline for any new reliability experiment. Address operation selection before treating routing success as complete understanding. Do not silently retry or tune away held-out failures.

No new statutory source pack is justified from these local measurements. A narrow recognition/admission review of the existing employee personal-CPF-relief topic is more justified than broad source expansion; varied valid relief descriptions still become NO_COVERAGE_TOPIC. Such a review must distinguish topic matching from source admission/freshness, keep fail-closed evidence behavior and use existing approved sources.
