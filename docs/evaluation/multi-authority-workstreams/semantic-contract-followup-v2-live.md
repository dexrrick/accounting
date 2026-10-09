# Semantic contract follow-up v2 live evaluation

- Model: gemini-3.5-flash-lite
- Timeout: 8000 ms
- Minimum provider request start gap: 15250 ms
- Calls attempted: 10
- Minimum observed start gap: 17013 ms

| Case | Group | Valid | Matched / expected | Predicted | Operation correct / matched | Routing correct | Failure |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| A-paraphrase-2 | PRESELECTED_KNOWN_FAILURE | true | 2 / 2 | 2 | 1 / 2 | true | — |
| adversarial-C-employee-benefit | PRESELECTED_KNOWN_FAILURE | true | 1 / 1 | 1 | 0 / 1 | true | — |
| control-general-recognition | PRESELECTED_KNOWN_FAILURE | false | 0 / 1 | 0 | 0 / 0 | false | TIMEOUT |
| control-general-interaction | PRESELECTED_KNOWN_FAILURE | true | 1 / 1 | 1 | 1 / 1 | true | — |
| A-paraphrase-3 | PRESELECTED_KNOWN_FAILURE | true | 3 / 3 | 3 | 3 / 3 | true | — |
| dev-conceptual-illustration | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| dev-training-entitlement | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| dev-mixed-entry-total | INDEPENDENT_CONTROL | true | 2 / 2 | 2 | 2 / 2 | true | — |
| dev-corporate-filing | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| dev-investment-comparison | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |

| Group | Valid / cases | Valid recall | All-case recall | Valid precision | Operation accuracy | Complete coverage | Routing / valid | Routing / all | Invalid / calls | Timeout | Provider failure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PRESELECTED_KNOWN_FAILURE | 4 / 5 | 7 / 7 | 7 / 8 | 7 / 7 | 5 / 7 | 4 / 5 | 4 / 4 | 4 / 5 | 0 / 5 | 1 | 0 |
| INDEPENDENT_CONTROL | 5 / 5 | 6 / 6 | 6 / 6 | 6 / 6 | 6 / 6 | 5 / 5 | 5 / 5 | 5 / 5 | 0 / 5 | 0 | 0 |
| COMBINED | 9 / 10 | 13 / 13 | 13 / 14 | 13 / 13 | 11 / 13 | 9 / 10 | 9 / 9 | 9 / 10 | 0 / 10 | 1 | 0 |

Source fingerprints stable during capture: true
Fixture fingerprints stable during capture: true
