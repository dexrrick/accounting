# Semantic wire-format local checkpoint — 02/10/2026

HOLD MERGE pending fresh targeted and unchanged final-ten live acceptance. No merge, push or deployment. Starting checkpoint: `9bc8b4e171dcfc471332bc01b5b74ee186773036`. Obtain the implementation checkpoint SHA from the commit containing this document.

## Implementation and preserved behavior

The confirmed reliability gap was JSON MIME mode without a provider schema. The prior extra root key remains unidentified; no raw response/key name is reconstructed. `aiTransport.ts` now accepts an optional generic `responseJsonSchema`, forwarded only to Gemini when JSON mode is enabled. `interpretSemanticQuestion` explicitly supplies the exact V2 schema. All 13 root properties, two concept properties and nine issue properties are required, and all three object shapes disallow additional properties. Supported enums, primitive types, array bounds and confidence range 0–1 are represented; each issue has exactly one governing authority.

Validator/prompt/provider/diagnostics share key, enum and limit metadata. Application validation still owns safe labels, uniqueness, domain/authority consistency, topic reconciliation and confidence acceptance. Strict rejection, legacy compatibility and derived `calculationRequested` remain unchanged. Model `gemini-3.5-flash-lite`, temperature 0, timeout 8,000 ms, no retries, deterministic fallback, operations, evidence/privacy and resolver behavior are preserved. No CPF/MOM/ACRA/MAS coverage or accounting rule was expanded.

Changed implementation files: `src/services/aiTransport.ts`, `src/services/semanticQuestionUnderstanding.ts`, `tests/evaluation/singapore/semantic-contract-diagnosis.mjs`, `tests/evaluation/singapore/semantic-contract-followup-evaluation.mjs`, `tests/evaluation/singapore/semantic-intent-followup-evaluation.mjs`, `scripts/run_all_tests.mjs`. New tests: `tests/regression/test_semantic_provider_schema.mjs`, `tests/regression/test_semantic_wire_format_evaluation.mjs`. Supporting diagnosis and the protected historical manifest are new documents.

## Regression and independent review

No-API tests assert provider/validator exact root/concept/issue property sets and enums/counts; both Gemini paths emit the exact schema; no calculation flag is requested; arbitrary extra root/nested fields, every missing object key and invalid enums reject; valid V2 derives the flag; existing legacy regressions pass. Non-semantic Gemini and JSON-disabled Gemini, OpenAI and Azure request formats remain unchanged. Wire profile tests retain the fixed six questions/order and original ten expectations, exercise a passing six-case gate, reject missing/failed/stale targeted reports before provider execution, and refuse existing output files. Their injected lifecycle stub is synthetic gate-test data, not a resolver or evidence-coverage assertion.

Independent reviewer answered all eight requested questions and found no unresolved material issue. Native schema capability is supported by first-party Google documentation. Final reread approved the frozen diff and test stub conditional on green local validation; that condition is now satisfied. All 32 protected hash entries match (31 distinct physical files because of an inherited fixture path alias). Historical artifacts and frozen fixtures are unchanged.

## Final local validation

Node.js **22.23.1**. Five focused tests pass: provider schema, wire-profile safety, semantic operations, existing wire contract and diagnostics/privacy. Semantic question understanding, provider boundaries, authority/relief, resolver coverage, workstream/routing and adjacent regressions also pass within smoke/full.

| Check | Final result |
| --- | --- |
| lint | PASS, existing warnings |
| build | PASS, existing chunk-size/deprecation warnings |
| smoke | 59/59, 39.61 seconds |
| full | 79/79, 117.69 seconds |
| git diff --check | PASS |

An initial development smoke run caught changed concept-example wording against an existing exact prompt regression. Original wording was restored using shared metadata, the old regression remained strict, and final checks above passed. The positive gate test initially had an incomplete synthetic lifecycle stub; only test data was corrected. Neither finding changed validator/acceptance rules or caused a live call.

## Live gate

The fixed fresh profile is `semantic-wire-format-targeted-live`, six cases exactly as preselected in the diagnosis. New output directory: `semantic-wire-format-live-2026-10-02`. Final profile `semantic-wire-format-final-live` uses the original unchanged ten and requires complete strict six-case acceptance with current fingerprints and protected historical hashes. Before calls, record source/fixture fingerprints and check both usage windows above the 7% floor. Each case gets one request; no retries; minimum request-start gap 15,250 ms. Any targeted failure means HOLD MERGE and no final ten. No post-observation tuning in this measurement cycle.
