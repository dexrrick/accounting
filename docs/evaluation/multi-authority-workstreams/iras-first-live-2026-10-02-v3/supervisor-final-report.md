# IRAS-first bounded continuation — 02/10/2026

**HOLD MERGE.** This is a stopping point after one reviewed implementation and diagnostic cycle. No merge, push, deployment, targeted acceptance rerun, or final IRAS-first profile was performed. The original final-ten profile remains unchanged and unrun.

Baseline checkpoint: `5c4469023003bc4e247366c76c3e65f9deed761f`.
Reviewed implementation: `78f1d2625a02869ecbc85708dc30cc43d55ac861`.
The following evidence checkpoint contains this report and the immutable v3 observations; obtain its exact SHA from Git HEAD after the checkpoint commit.

## Implementation and retained decisions

The previous v2 decisions remain in force: specificity is application-derived, compatible provider flags are normalized rather than causing rejection, real structural/semantic contradictions still reject, existing generic IRAS mappings remain, and the production semantic timeout remains 8,000 ms. The original requested 17-item report, mapping root causes, and controlled timeout experiment are recorded in `../iras-first-live-2026-10-02-v2/supervisor-final-report.md` and its linked artifacts.

This cycle fixed an evidence-scope inconsistency in `src/services/authorityWorkstreams.ts`. A routing-only parent such as `iras-individual-reliefs` was treated as requiring its own supporting quotation, although the registry defines it as a discovery aid and the grounding layer already excludes it from evidence coverage. IRAS quality assessment and quotation coverage now use substantive topics. Original planned topics, retrieval scope, requested concepts, source sections, and routing metadata are preserved. Parent-only mappings remain insufficient. Other authorities are unchanged.

No topic mappings, statutory knowledge, source records, citations, tax rates, provider settings, or application-fact gates changed. The regression isolates the scope fix using explicitly synthetic evidence; it also preserves missing-child, missing-sibling, unsupported-quotation, and parent-only failures.

## Frozen residency diagnostic

Artifacts are in `../residency-diagnostic-v3/`. Three preregistered synthetic questions each received two independent calls using the existing Gemini structured schema, `gemini-3.5-flash-lite`, temperature 0, 8,000 ms timeout, and no retries.

| Measure | Result |
| --- | --- |
| Requests / received responses / valid interpretations | 6 / 6 / 6 |
| Timeouts / provider failures | 0 / 0 |
| Correct root and issue authority/domain/population/operation | 6 / 6 |
| Correct derived specificity | 6 / 6 |
| Subject matcher / overall diagnostic pass | 1 / 6 |
| Minimum request-start gap | 17,329 ms, above the 15,250 ms floor |
| Maximum completion latency | 2,215.87 ms |

The diagnostic isolates the failed score to subject matching. It cannot establish whether a model subject was materially incorrect or the matching contract rejected equivalent terminology: raw subjects and responses were intentionally not retained. No matcher, prompt, fixture, production semantic code, or expected outcome was tuned after observation. These six calls are diagnostic evidence, not targeted acceptance or a replacement timeout experiment. Retain 8,000 ms.

## Actual mapped-source diagnostic

`iras-mapped-source-plan-v3.json` was saved before live retrieval. Nine fixed cases contain eight IRAS issues and derive nine existing registered map URLs. The transport cap was 18 GETs: one canonical attempt and at most one attested same-path IRAS host redirect per URL. Discovery/search adapters returned empty results, and model calls were disabled.

The single saved run made **9 GETs, all HTTP 200**, with eight cache reuses, no policy rejection, no retries, and no model request. Five invocations of each empty discovery adapter caused no external discovery/search request. HTML was not persisted. Page availability does not itself prove statutory support.

| Fixed issue(s) | Existing provider outcome | Remaining gap |
| --- | --- | --- |
| Three CPF-relief cases | Admitted evidence, verified claims, fully covered | Case application unresolved |
| Private expense | Admitted evidence and one verified claim | Disallowed-expense map topic mismatch; scoped topic/concept coverage incomplete |
| Foreign dividend | Admitted evidence | No verified claim; scoped topic/concept coverage incomplete |
| Corporate residency | HTTP 200 page, no candidate | Mapped-page topic mismatch |
| Withholding-tax royalty rule | Existing local evidence and one verified claim | Live maps failed domain/topic checks; scoped coverage incomplete |
| GST input tax | Mapped-page candidates admitted | No verified claim; scoped coverage incomplete |

Aggregate runtime results: candidates/admission **7/8**, issues with verified claims **5/8**, fully covered rule evidence **3/8**. All five case-specific applications remain unresolved; the three general questions do not require application. Unresolved application alone is permitted by the original acceptance contract, but the five remaining evidence gaps prevent release coverage. The unsupported accounting control uses the fixed contract, not a fresh live semantic observation.

The previous local diagnostic disabled live fetches with `localOnly: true`. This capture changes retrieval availability as well as applying the reviewed scope fix, so aggregate improvement must not be attributed solely to the code change.

## Validation and review

Exact runtime: Node 22.23.1. Targeted workstream and both API-free diagnostic safety regressions passed. Repository lint and build passed; smoke passed **68/68** in 56.17 s; full passed **88/88** in 120.86 s. The final source-body failure regression was added after smoke and passed both targeted verification and the final full suite. The final two-file source-harness lint was clean. Existing build and unrelated lint warnings remain nonblocking. No broad live external integration suite was run; the bounded actual-source diagnostic exercised the relevant existing pipeline.

The independent reviewer approved the scope design, final implementation, both pre-live harnesses, and saved evidence consistency. Review findings concerning historical-file verification, transport bookkeeping, per-map attribution, pre-fetch output refusal, and body-read failure caching were resolved before the applicable live run.

All **125** protected historical files remain unchanged. All **13** saved measurement fingerprints match after retrieval. Outputs contain safe dimensions, counts, statuses, and hashes; raw responses, query/fact payloads, source HTML, and credentials were not persisted. Earlier observations and profiles remain frozen.

Changed implementation files: `src/services/authorityWorkstreams.ts`; `scripts/run_all_tests.mjs`; `tests/regression/test_authority_workstreams.mjs`; the two new v3 diagnostic runners; the residency fixed config and protected baseline; and the two new diagnostic safety regressions. This evidence checkpoint adds only the new v3 plan, fingerprint snapshot, diagnostic outputs, and report.

## Resume from this checkpoint

1. Preserve all v1/v2/v3 observations and profiles. Do not overwrite or retrospectively re-score this cycle.
2. Review the subject-matching contract and define prospective privacy-safe subject diagnostics in a new version before another semantic capture. Do not infer the absent raw subjects or change production semantics merely to improve a benchmark score.
3. Address the five identified source-content/admission/claim gaps separately at their owning layers, using existing authoritative maps and preserving admission safeguards. HTTP availability has been demonstrated; broad discovery or new authority coverage is unnecessary for these findings.
4. Run a new versioned targeted acceptance profile only after its engineering prerequisites and independent review pass. The final IRAS-first profile remains gated on full targeted acceptance.

Usage at closeout: **59% five-hour and 19% weekly remaining**, above the user's 7% floor. End this bounded cycle here; do not start another optional implementation or measurement cycle automatically.
