# Semantic contract diagnosis baseline

- Model: gemini-3.5-flash-lite
- Production source SHA-256: 2e8c6cac5e0e5a2bb802823f30cb6c2af35040300c7e93eff519e65467893505
- Started: 2026-09-30T14:36:47.602Z

| Case | Mode | Failure | Rejection | Validator accepted | Prompt chars |
| --- | --- | --- | --- | --- | ---: |
| control-general-recognition | DETERMINISTIC_FALLBACK | INVALID_RESPONSE | CONCEPT_STRUCTURE | false | 7924 |
| control-general-interaction | DETERMINISTIC_FALLBACK | INVALID_RESPONSE | CONCEPT_STRUCTURE | false | 7948 |
| A-paraphrase-3 | DETERMINISTIC_FALLBACK | INVALID_RESPONSE | CALCULATION_FLAG_MISMATCH | false | 8022 |

Source hash consistent after each request: true
