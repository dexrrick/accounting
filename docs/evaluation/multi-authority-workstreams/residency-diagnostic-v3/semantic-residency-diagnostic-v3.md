# Singapore corporate residency semantic diagnostic V3

- Profile: semantic-residency-diagnostic-v3
- Model: gemini-3.5-flash-lite
- Requests: 6 / 6
- Minimum observed request-start gap: 17329 ms
- Protected V1/V2 artifacts reverified: 125

This fixed diagnostic reports semantic dimensions only. It is not an acceptance decision or an accounting/tax conclusion.

| Question ID | Replicate | Outcome | Request duration (ms) | Valid interpretation | Subject match | Root dimensions | Issue dimensions | Derived case specificity |
| --- | ---: | --- | ---: | --- | --- | --- | --- | --- |
| corporate-residency-original-general | 1 | RESPONSE_RECEIVED | 2090.35 | true | false | true | true | false |
| corporate-residency-general-paraphrase | 1 | RESPONSE_RECEIVED | 2182.31 | true | false | true | true | false |
| corporate-residency-case-applied-control | 1 | RESPONSE_RECEIVED | 2215.87 | true | false | true | true | true |
| corporate-residency-case-applied-control | 2 | RESPONSE_RECEIVED | 2170.83 | true | false | true | true | true |
| corporate-residency-general-paraphrase | 2 | RESPONSE_RECEIVED | 2047.06 | true | false | true | true | false |
| corporate-residency-original-general | 2 | RESPONSE_RECEIVED | 2012.8 | true | true | true | true | false |

No raw query, prompt, response, subject, fact text, URL, or credential is persisted.
