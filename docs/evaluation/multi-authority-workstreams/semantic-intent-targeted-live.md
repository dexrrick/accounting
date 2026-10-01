# Semantic intent targeted live evaluation

- Model: gemini-3.5-flash-lite
- Timeout: 8000 ms
- Minimum provider request start gap: 15250 ms
- Calls attempted: 8
- Minimum observed start gap: 16808 ms

| Case | Group | Valid | Matched / expected | Predicted | Operation correct / matched | Routing correct | Failure |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| A-paraphrase-2 | PRESELECTED_KNOWN_FAILURE | true | 2 / 2 | 2 | 1 / 2 | true | — |
| adversarial-C-employee-benefit | PRESELECTED_KNOWN_FAILURE | true | 1 / 1 | 1 | 1 / 1 | true | — |
| control-general-recognition | PRESELECTED_KNOWN_FAILURE | true | 1 / 1 | 1 | 1 / 1 | false | — |
| employer-cpf-implicit-calculation | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | TIMEOUT |
| wht-payment-amount-calculation | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| general-employment-benefit-rule | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| specific-employee-benefit-treatment | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | TIMEOUT |
| withholding-tax-liability-classification | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |

| Group | Valid / cases | Valid recall | All-case recall | Valid precision | Operation accuracy | Complete coverage | Routing / valid | Routing / all | Invalid / calls | Timeout | Provider failure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PRESELECTED_KNOWN_FAILURE | 3 / 3 | 4 / 4 | 4 / 4 | 4 / 4 | 3 / 4 | 3 / 3 | 2 / 3 | 2 / 3 | 0 / 3 | 0 | 0 |
| INDEPENDENT_CONTROL | 3 / 5 | 3 / 3 | 3 / 5 | 3 / 3 | 3 / 3 | 3 / 5 | 3 / 3 | 3 / 5 | 0 / 5 | 2 | 0 |
| COMBINED | 6 / 8 | 7 / 7 | 7 / 9 | 7 / 7 | 6 / 7 | 6 / 8 | 5 / 6 | 5 / 8 | 0 / 8 | 2 | 0 |

| Case | Intent acceptance | Case-specific facts expected / actual | Strict operation checks |
| --- | --- | --- | --- |
| A-paraphrase-2 | false | true / true (true) | employer-cpf-contribution: CALCULATE → CALCULATE (true) |
| adversarial-C-employee-benefit | true | true / true (true) | employee-accommodation-benefit-tax: DETERMINE_TREATMENT → DETERMINE_TREATMENT (true) |
| control-general-recognition | false | false / false (true) | — |
| employer-cpf-implicit-calculation | false | UNKNOWN | — |
| wht-payment-amount-calculation | true | true / true (true) | — |
| general-employment-benefit-rule | true | false / false (true) | — |
| specific-employee-benefit-treatment | false | UNKNOWN | — |
| withholding-tax-liability-classification | true | true / true (true) | — |

Source fingerprints stable during capture: true
Fixture fingerprints stable during capture: true
