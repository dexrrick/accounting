# Semantic wire-format live checkpoint — 02/10/2026

**HOLD MERGE. Fresh targeted acceptance failed. Final ten was not run. No merge, push, deployment, retry or post-observation tuning.** Branch: `codex/multi-authority-workstreams`. Implementation checkpoint: `e13b808820394fed0fd536a604738e4626f20eaf`. This report and the fresh live artifacts belong to a subsequent artifact checkpoint; obtain its exact SHA with `git rev-parse HEAD`.

## Confirmed diagnosis and implementation

The prior 7/8 cycle failed because a received JSON object had one extra root key. Gemini previously received JSON MIME mode (`responseMimeType=application/json`) with no explicit provider schema; the V2 shape was in prompt text and the strict application validator. The raw extra key was intentionally omitted and remains unidentified. The absence of provider-side constraints is confirmed; the model's internal reason for producing the extra field is unknown.

The implementation adds optional generic schema forwarding to the transport and explicitly passes a native Gemini `responseJsonSchema` from semantic interpretation. Shared metadata supplies validator, prompt, diagnostics and provider keys/enums/limits. Root/concept/issue shapes have exactly 13/2/9 required properties and `additionalProperties: false`; enums, types, count bounds and confidence range 0–1 are represented. The provider does not request `calculationRequested`; it remains derived after validation. Unsupported provider-schema checks (safe labels, relationships, uniqueness, acceptance confidence and topic reconciliation) remain application-owned.

Strict validator behavior before/after is unchanged, including extra/missing root and nested key rejection, nonempty V2 issues, confidence decisions and legacy compatibility. The existing model, temperature 0, 8,000 ms timeout, no retries, fallback, evidence/source/privacy safeguards, operations and resolver fixes are unchanged. No authority coverage or accounting-rule expansion occurred.

First-party Google documentation supported this native schema design at review time. However, **the deployed endpoint did not accept these live requests**: all six returned HTTP 400. The transport intentionally withholds upstream error bodies, so the exact request rejection reason is not known. Do not attribute it to a specific schema keyword, model limitation or field name without further evidence. This task does not establish live compatibility or improved successful provider output.

## Local validation and review

Node.js 22.23.1. Provider payload/schema synchronization tests, semantic operations, wire contract and diagnostics/privacy targeted checks passed. Final lint and build passed with existing warnings; smoke **59/59** (39.61 s), full **79/79** (117.69 s), and `git diff --check` passed. The suites cover semantic understanding, provider boundaries, authority/relief, resolver coverage, workstreams/routing and accounting/source regressions. No source changed after final validation or live observation; post-capture hashes confirm validation remains applicable.

Independent reviewer found no unresolved material implementation issue and approved live evaluation conditional on local validation. All eight requested review questions were answered affirmatively: unchanged strict/legacy behavior, stronger requested provider constraints, exact structural match, safe unknown-key rejection, unrelated requests unaffected, unchanged acceptance/retry/timeout rules, protected artifacts intact, and generic wire-format scope. Added tests cover both Gemini configurations, schema-free/JSON-disabled Gemini, OpenAI/Azure preservation, exact key/enum/count synchronization, arbitrary extra root key rejection, missing/invalid/nested rejection, derived flags, and successful/failed/stale/no-overwrite final-ten gates. The runtime stub is explicitly synthetic gate-test data, not a coverage claim.

## Fresh targeted observation

New measurement cycle, Singapore time **02/10/2026 08:13:35–08:15:03**. Usage before calls: **73% five-hour / 75% weekly remaining**, above the 7% floor; no reset credit consumed. Ten source and six fixture hashes recorded before calls match captured and current hashes. All 32 protected historical entries still match, covering 31 distinct physical files because of an inherited path alias. Frozen questions/labels and old 7/8 artifacts remain intact.

Model `gemini-3.5-flash-lite`; temperature 0; JSON MIME mode plus native schema; timeout 8,000 ms; exactly one provider request per case; zero retries. Minimum observed start gap **16,602 ms**, above 15,250 ms.

| Fixed case | Outcome |
| --- | --- |
| target-mixed-ifrs-singapore-accounting | PROVIDER_ERROR, HTTP 400 |
| control-general-recognition | PROVIDER_ERROR, HTTP 400 |
| A-paraphrase-2 | PROVIDER_ERROR, HTTP 400 |
| target-relief-entitlement | PROVIDER_ERROR, HTTP 400 |
| dev-investment-comparison | PROVIDER_ERROR, HTTP 400 |
| target-sfrsi-general-recognition | PROVIDER_ERROR, HTTP 400 |

| Metric | Result and interpretation |
| --- | --- |
| Requests / received JSON responses | 6 / 0 |
| Validator-valid interpretations / strict accepted cases | 0/6 / 0/6 |
| Raw semantic all-case issue recall | 0/7; no model interpretation observed |
| Raw/canonical authority, operation and other semantic dimensions | Not measurable; zero valid matched issues |
| Canonical all-case routing gate | 0/6; no semantic runtime/evidence path evaluated |
| Received responses rejected by strict validator | 0; no response reached JSON validation |
| Artifact aggregate `invalidResponses` | 6; this aggregate counts missing valid interpretations and overlaps the six provider failures |
| Provider failures / timeouts | 6 (all HTTP 400) / 0 |
| Unexpected/missing key counts | Not measurable; no JSON response received |
| Fingerprints / pacing | PASS |
| Targeted acceptance | FAIL |
| Final ten | NOT RUN; gated by targeted failure |

Do not treat zero validator rejections as successful wire-format compliance. The preserved runner's zero-denominator display values do not establish semantic accuracy. The HTTP 400 failures, missing interpretations and artifact aggregate invalid count are overlapping observations, not twelve independent failures.

## Files and disposition

Implementation files: `src/services/aiTransport.ts`, `src/services/semanticQuestionUnderstanding.ts`, `tests/evaluation/singapore/semantic-contract-diagnosis.mjs`, `tests/evaluation/singapore/semantic-contract-followup-evaluation.mjs`, `tests/evaluation/singapore/semantic-intent-followup-evaluation.mjs`, `scripts/run_all_tests.mjs`; new tests `tests/regression/test_semantic_provider_schema.mjs` and `tests/regression/test_semantic_wire_format_evaluation.mjs`. New supporting documents: diagnosis, local checkpoint and protected-hashes manifest.

Fresh artifacts in `semantic-wire-format-live-2026-10-02/`: `pre-live-fingerprints.json`, `semantic-wire-format-targeted-live.json`, `semantic-wire-format-targeted-live.md`, `post-live-verification.json`. No final-ten file or call exists. No historical output was overwritten or rescored.

The strict live gate failed despite green local tests and pre-live review. Preserve this checkpoint and stop at **HOLD MERGE**. A separately scoped diagnostic cycle is required to identify the HTTP 400 reason and establish actual endpoint compatibility before another measurement. Do not weaken the validator or silently fall back to schema-free requests. No production change or additional live call was made after observing this failure.

Final independent artifact review passed with no material reporting/privacy finding. The reviewer independently rehashed all ten sources, six fixtures and 32 protected entries, confirmed pre/captured/current agreement and the absence of a final-ten artifact, and approved the HOLD MERGE disposition. No API calls or edits were made by the reviewer.
