# Gemini structured-output compatibility checkpoint — 02/10/2026

**HOLD MERGE. HTTP 400 compatibility fixed; strict targeted acceptance failed 3/6. Final ten not run. No merge, deployment, retries, key change or tuning after observation.**

Branch: `codex/multi-authority-workstreams`. Starting checkpoint: `ddb34cd230ce4f0196449bc09357a01b7c8ea96c`. Reviewed implementation commit: `35118fb00e2f1fe35e053e950bba9e4b5d2fbd7a`. Reports/artifacts form a subsequent checkpoint; its exact SHA is returned in the completion message.

## Confirmed cause and fix

The confirmed rejection trigger is `properties.issues.maxItems: 12` in the combined V2 provider schema. Original full V2 requests returned HTTP 400 using both the old and current formats. Omitting all upper array bounds accepted the request; omitting **only** the issue-array upper bound also returned HTTP 200 with JSON matching the provider schema and accepted by the unchanged strict V2 validator. All other constraints stayed present.

Minimal schemas accepted both formats. Isolated string and numeric enums, arrays, nested objects, numeric bounds, array bounds, and `additionalProperties: false` also passed. No universally unsupported JSON Schema keyword was established. The failure concerns the combination of constraints in this V2 schema, rather than a blanket field-name or maxItems incompatibility.

Failed full-schema probes retained HTTP/code **400**, provider status **INVALID_ARGUMENT**, and the reconstructed generic message **“Gemini request failed.”** The initial classifier did not recognize a more specific provider explanation. Raw bodies were not retained. The provider's internal compiler or limit explanation remains unknown; schema-complexity/state-limit claims are not asserted as confirmed facts.

Endpoint/model remain `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent` / `gemini-3.5-flash-lite`. Old schema-bearing generationConfig: `responseMimeType: application/json`, `responseJsonSchema: <V2>`, temperature 0. Corrected generationConfig: `responseFormat: { text: { mimeType: APPLICATION_JSON, schema: <V2 without issues.maxItems> } }`, temperature 0. No old MIME/schema field is serialized in schema mode. Schema-free Gemini retains its existing MIME format, and OpenAI/Azure payloads are unchanged.

Only the provider issue-array cap was omitted. The application still enforces at most 12 issues, rejects extra or missing root/concept/issue keys, enforces confidence and all other strict rules, and derives the internal calculation flag after validation. Semantic operations, authority/resolver/IRAS/CPF/MOM/evidence rules, acceptance thresholds, 8,000 ms timeout, temperature, model, key and retry policy are unchanged.

## First-party contract verification

- [generateContent GenerationConfig](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig) documents the current responseFormat structure. `responseSchema` and `_responseJsonSchema` are explicitly deprecated. The separate `responseJsonSchema` description is self-referential/inconsistent; minimal live acceptance shows it is not universally rejected.
- [TextResponseFormat](https://ai.google.dev/api/generate-content#TextResponseFormat) documents `text.mimeType` as the APPLICATION_JSON enum and `text.schema` as JSON Schema.
- [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) lists structured outputs as supported.
- [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output) documents the V2 keyword subset, including numeric enums, bounds and additionalProperties, while warning that schema complexity can cause rejection. The transport continues to use generateContent.

## Safe diagnostics and tests

Gemini error diagnostics are opt-in. Error streams are capped at 8 KiB; malformed, unreadable and oversized bodies fall back safely. Only bounded numeric/status metadata, fixed safe messages, canonical allowlisted field paths and static keyword/hint arrays are exposed. Hints do not claim a cause. Raw error text/descriptions, request bodies/headers, prompts/questions, credentials and model content are never copied into diagnostics. Synchronous throws and asynchronous callback rejections are contained without waiting for callbacks. Production errors remain generic.

Production/test files changed:

- `src/services/aiTransport.ts`
- `src/services/semanticQuestionUnderstanding.ts` — provider schema cap/comment only; application logic unchanged
- `tests/regression/test_semantic_provider_schema.mjs`
- `tests/regression/test_gemini_provider_diagnostics.mjs` — new
- `scripts/run_all_tests.mjs` — smoke registration

Regression coverage includes exact minimal/full payloads on both Gemini configuration paths, absent legacy schema fields, only the demonstrated provider constraint omitted, 13-issue rejection, strict extra/missing root and nested keys, malformed/oversized/read-error bodies, adversarial credential/prompt/body/path echoes, callback failures and nonsettling callbacks, current-format error paths, and schema-free Gemini/OpenAI/Azure preservation.

Node.js **22.23.1**: focused provider/diagnostic checks PASS; wire-contract, semantic-understanding, diagnostics/privacy and resolver/authority checks pass within the suites; lint PASS with unrelated existing/generated warnings; build PASS with bundle-size/deprecated-option warnings; smoke **60/60** (69.03 s); full **80/80** (120.38 s); `git diff --check` PASS. Independent reviewer approved the implementation and live harness before measurement, conditional on these completed checks and usage above the 7% floor. Pre-live usage check showed 23% five-hour and 67% weekly remaining; no reset credit was consumed.

## Fresh live observations

All compatibility observations are new, once-per-variant artifacts in `gemini-compatibility-live-2026-10-02/`. Old minimal and current minimal: HTTP 200, matching JSON. Original full old/current: HTTP 400. Full current with only issues.maxItems omitted: HTTP 200, provider-schema match and strict application acceptance PASS. No API key was changed.

The earlier all-maxItems-omitted probe used a combined provider/application matching flag and instructed synthetic confidence 0.5, below the existing 0.72 issue threshold. Its matchesSchema=false does not establish a provider-schema violation. The later one-cap probe separately measures provider and application acceptance, with synthetic confidence 0.9. Earlier artifacts remain unchanged; no model content was retained.

The fresh frozen six-case evaluation made exactly one request per case, with no retries and a minimum observed request-start gap of **17,104 ms** (required 15,250 ms).

| Frozen case | JSON / strict validator | Overall targeted acceptance |
| --- | --- | --- |
| target-mixed-ifrs-singapore-accounting | PASS | FAIL — semantic dimensions |
| control-general-recognition | PASS | PASS |
| A-paraphrase-2 | PASS | PASS |
| target-relief-entitlement | PASS | FAIL — requires-user-specific-facts expected true, actual false |
| dev-investment-comparison | PASS | FAIL — semantic dimensions, guards and requested coverage |
| target-sfrsi-general-recognition | PASS | PASS |

Protocol: **6/6 JSON**, **6/6 validator-valid**, zero HTTP 400, provider failures, timeouts, unexpected keys and missing keys. Strict acceptance: **3/6**, so the release gate failed. Canonical issue recall/precision 7/7; governing authority/domain/operation 7/7; contextual authority and population 6/7; routing 6/6. Successful routing does not imply every guard or semantic requirement passed.

Ten source and six fixture hashes agree before/captured/after/current; protected historical checks passed for 32 entries. The previous failed-400 cycle's four files also retain identical hashes. Frozen questions, labels, thresholds and old artifacts were not altered. Automatic approval initially blocked transmission; read-only verification of the exact synthetic fixtures and the user's explicit Phase 8 instruction established authorization, and the same action was approved before requests began.

**Final ten: NOT RUN**, because targeted acceptance failed. No source change or live call followed this observation. A separately scoped semantic investigation would be needed before another measurement cycle; this task does not tune those mismatches.

## Artifacts and disposition

The new directory contains compatibility probes, local-validation/usage evidence, targeted pre/post fingerprints, the fresh targeted JSON/Markdown reports, final-checkpoint.json and artifact-review.json. Independent final artifact review found no actionable issues and verified the counts, fingerprints, privacy safeguards and HOLD MERGE disposition without new tests, live calls, credential reads or source edits. No final-ten artifact exists. The technical HTTP 400 fix is validated, but merge readiness is not established. Preserve the checkpoint at **HOLD MERGE**.
