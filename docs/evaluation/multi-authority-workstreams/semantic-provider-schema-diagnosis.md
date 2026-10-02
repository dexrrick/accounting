# Semantic provider wire-contract diagnosis — 02/10/2026

Pre-change checkpoint: `9bc8b4e171dcfc471332bc01b5b74ee186773036`, branch `codex/multi-authority-workstreams`. HOLD MERGE; no merge or deployment.

## Confirmed pre-change request path

`interpretSemanticQuestion` builds a V2 natural-language schema and interpretation prompt, then calls `executeStructuredLlmCall` with JSON mode, temperature 0 and an 8,000 ms timeout. Both Gemini entry paths (API-key string and ProviderSettings) call the same direct transport. The transport POSTs to `v1beta/models/gemini-3.5-flash-lite:generateContent` and sends `generationConfig.responseMimeType=application/json` plus temperature. It sends neither `responseSchema` nor `responseJsonSchema`. Thus exact V2 structure exists in prompt text and the application validator, but not a provider request schema.

The transport returns the first candidate's first text part without rewriting JSON fields. The interpreter bounds response length, parses JSON, executes the strict validator, then checks root confidence. Invalid objects retain deterministic fallback. There is one call, no retry, and no response repair. No transport schema transformation currently exists because no schema is sent.

The preserved 01/10/2026 targeted artifact confirms a valid JSON object with 14 root keys, one unexpected key, no missing required key, and a correctly shaped issue object. The strict validator rejected it. This establishes a wire-format failure and a missing provider constraint; it does not identify the omitted raw key or explain the model's internal choice to generate it.

## Provider capability and implementation decision

Google's [Gemini 3.5 Flash-Lite model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) lists structured outputs as supported. Its [GenerateContent API reference](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig) exposes `responseJsonSchema` with JSON MIME mode, and lists required/properties/additionalProperties, primitive types, enums, object/array structure, numeric bounds and array counts. The newer [structured-output guide](https://ai.google.dev/gemini-api/docs/structured-output) also describes this supported subset and application validation. Checked 02/10/2026. The guide now emphasizes Interactions; keep the existing GenerateContent endpoint for the smallest change rather than migrate APIs.

Use native Gemini `generationConfig.responseJsonSchema` via a generic optional transport argument, explicitly supplied by the semantic interpreter. Retain MIME mode. Require all 13 root properties, both concept properties and all nine issue properties; set `additionalProperties: false` on all three object shapes. Use shared validator enum/key metadata and supported count/range constraints. Do not request `calculationRequested`. String length, safe-label content, uniqueness, domain/authority relationships, confidence acceptance and other semantic safeguards remain application-owned because the documented provider subset cannot fully express them. Preserve low-confidence handling rather than force confidence above its threshold in the provider schema.

No provider-schema fallback, retry, timeout, model, resolver, authority operation, evidence rule or accounting change is authorized by this diagnosis. OpenAI/Azure and non-semantic requests retain their current request format. Strict V2 and legacy acceptance behavior must remain unchanged.

## Contract duplication audit and fixed evaluation plan

Before changes, types, validator enums/keys, prompt schema and evaluation diagnosis enums/keys independently describe the contract. Share reusable keys/enums where narrow, generate prompt metadata from the same values where practical, and add provider-versus-validator exact-set regressions. Avoid a schema-framework rewrite.

Freeze a new six-case wire-format profile before any live observation, reusing unchanged questions and expectations: `target-mixed-ifrs-singapore-accounting`, `control-general-recognition`, `A-paraphrase-2`, `target-relief-entitlement`, `dev-investment-comparison`, `target-sfrsi-general-recognition`. Reuse the existing strict canonical scoring/runtime gates and privacy-safe diagnostics. Fresh directory and filenames only; historical eight-case results remain protected. Final ten remains unchanged and requires this six-case profile to pass first. Preserve one call per case, 8,000 ms timeout and minimum 15,250 ms starts. Local validation, independent review, recorded fingerprints and usage above 7% are prerequisites.

Supervisor preconditions verified before implementation: clean requested branch and exact checkpoint; installed Node.js 22.23.1 executes successfully and passes repository preflight; 29 existing protected hash entries match, with the latest resolver checkpoint and its two 7/8 live artifacts additionally captured in `semantic-wire-format-protected-hashes.json` (32 hash entries covering 31 distinct physical files; two inherited path spellings identify the same fixture). Initial usage remaining: 96% five-hour, 79% weekly. No reset credit used. Credential presence checked without printing its value. No live calls have occurred at this stage.
