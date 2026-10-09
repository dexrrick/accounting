# Authority and relief targeted live evaluation

- Model: gemini-3.5-flash-lite
- Timeout: 8000 ms
- Minimum provider request start gap: 15250 ms
- Calls attempted: 8
- Minimum observed start gap: 16861 ms

| Case | Group | Valid | Matched / expected | Predicted | Operation correct / matched | Routing correct | Failure |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| control-general-recognition | PRESELECTED_KNOWN_FAILURE | true | 1 / 1 | 1 | 1 / 1 | true | — |
| A-paraphrase-2 | PRESELECTED_KNOWN_FAILURE | true | 2 / 2 | 2 | 2 / 2 | true | — |
| target-sfrsi-general-recognition | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| target-mixed-ifrs-singapore-accounting | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | INVALID_RESPONSE |
| target-relief-entitlement | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| target-relief-amount | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| target-cpf-general-control | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| target-mom-general-control | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |

## Canonical contract scoring

Raw scoring above remains unchanged. The supplemental score canonicalizes only ACCOUNTING governing IFRS Foundation authority to ACCOUNTING_STANDARDS; contextual authorities remain unchanged. Explicit authority-relief operation requirements are included.

Strict acceptance passed: false (7 / 8 cases).

| Issue recall | Issue precision | Governing authority | Contextual authority | Domain | Population | Operation | Canonical workstream routing | Invalid responses | Timeouts | Provider failures | Pacing | Fingerprints | Zero failures |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 8 / 8 (1) | 8 / 8 (1) | 8 / 8 (1) | 8 / 8 (1) | 8 / 8 (1) | 8 / 8 (1) | 8 / 8 (1) | 7 / 8 (0.875) | 1 | 0 | 0 | true | true | false |

Per-case canonical contract acceptance:

| Case | Canonical matched / expected | Dimensions | Operation | Specificity | Workstream set | Requested mapped / runtime / retrieval | Guards | Strict case acceptance |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
| control-general-recognition | 1 / 1 | true | 1 / 1 | true | true | 1 / 1 / 1 / 1 | true | true |
| A-paraphrase-2 | 2 / 2 | true | 2 / 2 | true | true | 2 / 2 / 2 / 2 | true | true |
| target-sfrsi-general-recognition | 1 / 1 | true | 1 / 1 | true | true | 1 / 1 / 1 / 1 | true | true |
| target-mixed-ifrs-singapore-accounting | 0 / 0 | false | 0 / 0 | false | false | — | false | false |
| target-relief-entitlement | 1 / 1 | true | 1 / 1 | true | true | 1 / 1 / 1 / 1 | true | true |
| target-relief-amount | 1 / 1 | true | 1 / 1 | true | true | 1 / 1 / 1 / 1 | true | true |
| target-cpf-general-control | 1 / 1 | true | 1 / 1 | true | true | 1 / 1 / 1 / 1 | true | true |
| target-mom-general-control | 1 / 1 | true | 1 / 1 | true | true | 1 / 1 / 1 / 1 | true | true |

| Group | Valid / cases | Valid recall | All-case recall | Valid precision | Operation accuracy | Complete coverage | Routing / valid | Routing / all | Invalid / calls | Timeout | Provider failure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PRESELECTED_KNOWN_FAILURE | 2 / 2 | 3 / 3 | 3 / 3 | 3 / 3 | 3 / 3 | 2 / 2 | 2 / 2 | 2 / 2 | 0 / 2 | 0 | 0 |
| INDEPENDENT_CONTROL | 5 / 6 | 5 / 5 | 5 / 6 | 5 / 5 | 5 / 5 | 5 / 6 | 5 / 5 | 5 / 6 | 1 / 6 | 0 | 0 |
| COMBINED | 7 / 8 | 8 / 8 | 8 / 9 | 8 / 8 | 8 / 8 | 7 / 8 | 7 / 7 | 7 / 8 | 1 / 8 | 0 | 0 |

Source fingerprints stable during capture: true
Fixture fingerprints stable during capture: true
