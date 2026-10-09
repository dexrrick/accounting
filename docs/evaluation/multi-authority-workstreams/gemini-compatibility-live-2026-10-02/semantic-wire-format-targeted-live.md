# Semantic wire-format targeted live evaluation

- Model: gemini-3.5-flash-lite
- Timeout: 8000 ms
- Minimum provider request start gap: 15250 ms
- Calls attempted: 6
- Minimum observed start gap: 17104 ms

| Case | Group | Valid | Matched / expected | Predicted | Operation correct / matched | Routing correct | Failure |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| target-mixed-ifrs-singapore-accounting | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| control-general-recognition | PRESELECTED_KNOWN_FAILURE | true | 1 / 1 | 1 | 1 / 1 | true | — |
| A-paraphrase-2 | PRESELECTED_KNOWN_FAILURE | true | 2 / 2 | 2 | 2 / 2 | true | — |
| target-relief-entitlement | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| dev-investment-comparison | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| target-sfrsi-general-recognition | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |

## Canonical contract scoring

Raw scoring above remains unchanged. The supplemental score canonicalizes only ACCOUNTING governing IFRS Foundation authority to ACCOUNTING_STANDARDS; contextual authorities remain unchanged. Fixed strict operation requirements are included.

Strict acceptance passed: false (3 / 6 cases).

| Issue recall | Issue precision | Governing authority | Contextual authority | Domain | Population | Operation | Canonical workstream routing | Invalid responses | Timeouts | Provider failures | Pacing | Fingerprints | Zero failures |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 7 / 7 (1) | 7 / 7 (1) | 7 / 7 (1) | 6 / 7 (0.8571) | 7 / 7 (1) | 6 / 7 (0.8571) | 7 / 7 (1) | 6 / 6 (1) | 0 | 0 | 0 | true | true | true |

Per-case canonical contract acceptance:

| Case | Canonical matched / expected | Dimensions | Operation | Specificity | Workstream set | Requested mapped / runtime / retrieval | Guards | Strict case acceptance |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| target-mixed-ifrs-singapore-accounting | 1 / 1 | false | 1 / 1 | true | true | 1 / 1 / 1 / 1 | true | false |
| control-general-recognition | 1 / 1 | true | 1 / 1 | true | true | 1 / 1 / 1 / 1 | true | true |
| A-paraphrase-2 | 2 / 2 | true | 2 / 2 | true | true | 2 / 2 / 2 / 2 | true | true |
| target-relief-entitlement | 1 / 1 | true | 1 / 1 | false | true | 1 / 1 / 1 / 1 | true | false |
| dev-investment-comparison | 1 / 1 | false | 1 / 1 | true | true | 0 / 1 / 1 / 0 | false | false |
| target-sfrsi-general-recognition | 1 / 1 | true | 1 / 1 | true | true | 1 / 1 / 1 / 1 | true | true |

| Group | Valid / cases | Valid recall | All-case recall | Valid precision | Operation accuracy | Complete coverage | Routing / valid | Routing / all | Invalid / calls | Timeout | Provider failure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PRESELECTED_KNOWN_FAILURE | 2 / 2 | 3 / 3 | 3 / 3 | 3 / 3 | 3 / 3 | 2 / 2 | 2 / 2 | 2 / 2 | 0 / 2 | 0 | 0 |
| INDEPENDENT_CONTROL | 4 / 4 | 4 / 4 | 4 / 4 | 4 / 4 | 4 / 4 | 4 / 4 | 4 / 4 | 4 / 4 | 0 / 4 | 0 | 0 |
| COMBINED | 6 / 6 | 7 / 7 | 7 / 7 | 7 / 7 | 7 / 7 | 6 / 6 | 6 / 6 | 6 / 6 | 0 / 6 | 0 | 0 |

Source fingerprints stable during capture: true
Fixture fingerprints stable during capture: true
