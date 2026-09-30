# Semantic reliability timeout experiment

Status: COMPLETE; model: gemini-3.5-flash-lite; temperature: 0; request-start interval: 15250 ms; retries: 0.
Requests: 16/16; valid interpretations: 11; timeouts: 0; invalid structured responses: 5.

Descriptive 4-case comparison; two observations per timeout arm and case. This is not a statistical causal guarantee.

Prompt text, system text, user questions, response bodies, credentials, and arbitrary provider error messages are not persisted.

## Timeout arms

| Timeout | Requests | Valid | Timeouts | Invalid | Median ms | P95 ms | Operation dimension |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 8000 | 8 | 5 | 0 | 3 | 2379 | 4821 | 9/9 |
| 15000 | 8 | 6 | 0 | 2 | 2347 | 4760 | 13/13 |

## Signature comparison by case

| Case | 8s observations | 15s observations | 8s stable | 15s stable | Arm signatures differ |
|---|---|---|---|---|---|
| A-paraphrase-3 | no-valid-signature, no-valid-signature | no-valid-signature, no-valid-signature | unassessed | unassessed | unassessed |
| A-paraphrase-4 | 9e4c4afa9b40, no-valid-signature | 34c17402a9ad, 34c17402a9ad | unassessed | true | unassessed |
| D-original | 44fd80b8abfd, 44fd80b8abfd | 44fd80b8abfd, 44fd80b8abfd | true | true | false |
| D-paraphrase-1 | 47447ed7f10f, 47447ed7f10f | bdab1abf2a3a, bdab1abf2a3a | true | true | true |

## Request outcomes

| Call | Case | Observation | Timeout | Outcome | Diagnostic | Latency ms | Response chars | Response bytes | Issue recall | Complete issues | Workstream set |
|---|---|---:|---:|---|---|---:|---:|---:|---:|---|---|
| A-paraphrase-3::observation-1::timeout-8000 | A-paraphrase-3 | 1 | 8000 | INVALID_RESPONSE | CONTRADICTORY_FIELDS | 4821 | 1744 | 1744 | 0/3 | false | false |
| A-paraphrase-3::observation-1::timeout-15000 | A-paraphrase-3 | 1 | 15000 | INVALID_RESPONSE | CONTRADICTORY_FIELDS | 2252 | 1742 | 1742 | 0/3 | false | false |
| A-paraphrase-3::observation-2::timeout-15000 | A-paraphrase-3 | 2 | 15000 | INVALID_RESPONSE | CONTRADICTORY_FIELDS | 2347 | 1801 | 1801 | 0/3 | false | false |
| A-paraphrase-3::observation-2::timeout-8000 | A-paraphrase-3 | 2 | 8000 | INVALID_RESPONSE | CONTRADICTORY_FIELDS | 2993 | 1807 | 1807 | 0/3 | false | false |
| A-paraphrase-4::observation-1::timeout-15000 | A-paraphrase-4 | 1 | 15000 | VALID_INTERPRETATION | VALID_SCHEMA | 3527 | 1854 | 1854 | 3/3 | true | true |
| A-paraphrase-4::observation-1::timeout-8000 | A-paraphrase-4 | 1 | 8000 | VALID_INTERPRETATION | VALID_SCHEMA | 2630 | 1842 | 1842 | 3/3 | true | true |
| A-paraphrase-4::observation-2::timeout-8000 | A-paraphrase-4 | 2 | 8000 | INVALID_RESPONSE | MALFORMED_JSON | 2600 | 1882 | 1882 | 0/3 | false | false |
| A-paraphrase-4::observation-2::timeout-15000 | A-paraphrase-4 | 2 | 15000 | VALID_INTERPRETATION | VALID_SCHEMA | 2454 | 1804 | 1804 | 3/3 | true | true |
| D-original::observation-1::timeout-8000 | D-original | 1 | 8000 | VALID_INTERPRETATION | VALID_SCHEMA | 2379 | 1410 | 1410 | 2/2 | true | true |
| D-original::observation-1::timeout-15000 | D-original | 1 | 15000 | VALID_INTERPRETATION | VALID_SCHEMA | 4760 | 1453 | 1453 | 2/2 | true | true |
| D-original::observation-2::timeout-15000 | D-original | 2 | 15000 | VALID_INTERPRETATION | VALID_SCHEMA | 2294 | 1469 | 1469 | 2/2 | true | true |
| D-original::observation-2::timeout-8000 | D-original | 2 | 8000 | VALID_INTERPRETATION | VALID_SCHEMA | 2049 | 1453 | 1453 | 2/2 | true | true |
| D-paraphrase-1::observation-1::timeout-15000 | D-paraphrase-1 | 1 | 15000 | VALID_INTERPRETATION | VALID_SCHEMA | 1961 | 1405 | 1405 | 1/2 | false | true |
| D-paraphrase-1::observation-1::timeout-8000 | D-paraphrase-1 | 1 | 8000 | VALID_INTERPRETATION | VALID_SCHEMA | 2011 | 1501 | 1501 | 1/2 | false | true |
| D-paraphrase-1::observation-2::timeout-8000 | D-paraphrase-1 | 2 | 8000 | VALID_INTERPRETATION | VALID_SCHEMA | 2111 | 1464 | 1464 | 1/2 | false | true |
| D-paraphrase-1::observation-2::timeout-15000 | D-paraphrase-1 | 2 | 15000 | VALID_INTERPRETATION | VALID_SCHEMA | 3254 | 1462 | 1462 | 2/2 | true | true |

## Source and prompt fingerprints

Fixture SHA-256: c15aa10f9acff1e805c16d4ef703707dd46a5b1c36b0a2f23ab3886d88a390cb.
semanticQuestionUnderstanding SHA-256: 4a032381ca71bffb6fd6b7c93ce8f8ff57a21a549486b5483ded01e223d1e221.
aiTransport SHA-256: e1f65b7baa6e8a546a369ce4079445f11daaecd23fea714d92264e8b6bfea265.

- A-paraphrase-3::observation-1::timeout-8000: prompt 289ce1f1f89266add01a2cbf13a0b7fba7ded77512bb379acff01ce043e6a454 (8018 chars/8018 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 8000 ms, 0.
- A-paraphrase-3::observation-1::timeout-15000: prompt 289ce1f1f89266add01a2cbf13a0b7fba7ded77512bb379acff01ce043e6a454 (8018 chars/8018 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 15000 ms, 0.
- A-paraphrase-3::observation-2::timeout-15000: prompt 289ce1f1f89266add01a2cbf13a0b7fba7ded77512bb379acff01ce043e6a454 (8018 chars/8018 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 15000 ms, 0.
- A-paraphrase-3::observation-2::timeout-8000: prompt 289ce1f1f89266add01a2cbf13a0b7fba7ded77512bb379acff01ce043e6a454 (8018 chars/8018 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 8000 ms, 0.
- A-paraphrase-4::observation-1::timeout-15000: prompt 68c0f77f2ed366efe556084835095c658021b80bcb4bc7d696a35c6478a96361 (7994 chars/7994 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 15000 ms, 0.
- A-paraphrase-4::observation-1::timeout-8000: prompt 68c0f77f2ed366efe556084835095c658021b80bcb4bc7d696a35c6478a96361 (7994 chars/7994 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 8000 ms, 0.
- A-paraphrase-4::observation-2::timeout-8000: prompt 68c0f77f2ed366efe556084835095c658021b80bcb4bc7d696a35c6478a96361 (7994 chars/7994 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 8000 ms, 0.
- A-paraphrase-4::observation-2::timeout-15000: prompt 68c0f77f2ed366efe556084835095c658021b80bcb4bc7d696a35c6478a96361 (7994 chars/7994 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 15000 ms, 0.
- D-original::observation-1::timeout-8000: prompt 466cf394b697d9900271994b2c1dff50cbef053361829da19703d56f670edd6f (7948 chars/7948 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 8000 ms, 0.
- D-original::observation-1::timeout-15000: prompt 466cf394b697d9900271994b2c1dff50cbef053361829da19703d56f670edd6f (7948 chars/7948 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 15000 ms, 0.
- D-original::observation-2::timeout-15000: prompt 466cf394b697d9900271994b2c1dff50cbef053361829da19703d56f670edd6f (7948 chars/7948 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 15000 ms, 0.
- D-original::observation-2::timeout-8000: prompt 466cf394b697d9900271994b2c1dff50cbef053361829da19703d56f670edd6f (7948 chars/7948 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 8000 ms, 0.
- D-paraphrase-1::observation-1::timeout-15000: prompt 957958510a63d4e57a2a09333669e8accc6b5beafcf5cf9e8764b3b1b402e3e3 (7972 chars/7972 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 15000 ms, 0.
- D-paraphrase-1::observation-1::timeout-8000: prompt 957958510a63d4e57a2a09333669e8accc6b5beafcf5cf9e8764b3b1b402e3e3 (7972 chars/7972 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 8000 ms, 0.
- D-paraphrase-1::observation-2::timeout-8000: prompt 957958510a63d4e57a2a09333669e8accc6b5beafcf5cf9e8764b3b1b402e3e3 (7972 chars/7972 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 8000 ms, 0.
- D-paraphrase-1::observation-2::timeout-15000: prompt 957958510a63d4e57a2a09333669e8accc6b5beafcf5cf9e8764b3b1b402e3e3 (7972 chars/7972 bytes); system 9a1d92f733600f87848aa217625daaf4291300b29d762319b7ad0cc402c404a3 (259 chars/259 bytes); transport gemini-3.5-flash-lite, 15000 ms, 0.
