# Semantic wire-format targeted live evaluation

- Model: gemini-3.5-flash-lite
- Timeout: 8000 ms
- Minimum provider request start gap: 15250 ms
- Calls attempted: 6
- Minimum observed start gap: 16602 ms

| Case | Group | Valid | Matched / expected | Predicted | Operation correct / matched | Routing correct | Failure |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| target-mixed-ifrs-singapore-accounting | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | PROVIDER_ERROR |
| control-general-recognition | PRESELECTED_KNOWN_FAILURE | false | 0 / 1 | 0 | 0 / 0 | false | PROVIDER_ERROR |
| A-paraphrase-2 | PRESELECTED_KNOWN_FAILURE | false | 0 / 2 | 0 | 0 / 0 | false | PROVIDER_ERROR |
| target-relief-entitlement | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | PROVIDER_ERROR |
| dev-investment-comparison | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | PROVIDER_ERROR |
| target-sfrsi-general-recognition | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | PROVIDER_ERROR |

## Canonical contract scoring

Raw scoring above remains unchanged. The supplemental score canonicalizes only ACCOUNTING governing IFRS Foundation authority to ACCOUNTING_STANDARDS; contextual authorities remain unchanged. Fixed strict operation requirements are included.

Strict acceptance passed: false (0 / 6 cases).

| Issue recall | Issue precision | Governing authority | Contextual authority | Domain | Population | Operation | Canonical workstream routing | Invalid responses | Timeouts | Provider failures | Pacing | Fingerprints | Zero failures |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 0 / 0 (0) | 0 / 0 (0) | 0 / 0 (0) | 0 / 0 (0) | 0 / 0 (0) | 0 / 0 (0) | 0 / 0 (0) | 0 / 6 (0) | 6 | 0 | 6 | true | true | false |

Per-case canonical contract acceptance:

| Case | Canonical matched / expected | Dimensions | Operation | Specificity | Workstream set | Requested mapped / runtime / retrieval | Guards | Strict case acceptance |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| target-mixed-ifrs-singapore-accounting | 0 / 0 | false | 0 / 0 | false | false | — | false | false |
| control-general-recognition | 0 / 0 | false | 0 / 0 | false | false | — | false | false |
| A-paraphrase-2 | 0 / 0 | false | 0 / 0 | false | false | — | false | false |
| target-relief-entitlement | 0 / 0 | false | 0 / 0 | false | false | — | false | false |
| dev-investment-comparison | 0 / 0 | false | 0 / 0 | false | false | — | false | false |
| target-sfrsi-general-recognition | 0 / 0 | false | 0 / 0 | false | false | — | false | false |

| Group | Valid / cases | Valid recall | All-case recall | Valid precision | Operation accuracy | Complete coverage | Routing / valid | Routing / all | Invalid / calls | Timeout | Provider failure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PRESELECTED_KNOWN_FAILURE | 0 / 2 | 0 / 0 | 0 / 3 | 0 / 0 | 0 / 0 | 0 / 2 | 0 / 0 | 0 / 2 | 0 / 2 | 0 | 2 |
| INDEPENDENT_CONTROL | 0 / 4 | 0 / 0 | 0 / 4 | 0 / 0 | 0 / 0 | 0 / 4 | 0 / 0 | 0 / 4 | 0 / 4 | 0 | 4 |
| COMBINED | 0 / 6 | 0 / 0 | 0 / 7 | 0 / 0 | 0 / 0 | 0 / 6 | 0 / 0 | 0 / 6 | 0 / 6 | 0 | 6 |

Source fingerprints stable during capture: true
Fixture fingerprints stable during capture: true
