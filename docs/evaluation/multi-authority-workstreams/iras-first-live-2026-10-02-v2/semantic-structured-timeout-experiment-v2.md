# Structured semantic timeout experiment V2

- Model: gemini-3.5-flash-lite
- Calls: 18 / 18
- Minimum observed request-start gap: 17276 ms
- Baseline production timeout: 8000 ms
- Recommended timeout: 8000 ms (RETAIN_8000)
- Protocol guards passed: true
- Historical artifacts reverified: true

Response completion latency excludes timeouts. Timeout durations are reported separately as censored observations.
All arm denominators include six scheduled calls. Prompt length, issue count, response bytes, and the fixed schema fingerprint are descriptive only; this three-case pilot does not identify causal effects.

| Timeout | Scheduled | Responses | Valid | Semantically correct | Timeouts | Provider failures | Completion latency min / median / p95 / max (ms) | Timeout censored min / median / p95 / max (ms) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 8000 | 6 | 6 | 6 | 4 | 0 | 0 | 1912.02 / 2245.07 / 2473.4 / 2473.4 | — / — / — / — |
| 12000 | 6 | 6 | 6 | 4 | 0 | 0 | 2015.27 / 2181.95 / 2579.32 / 2579.32 | — / — / — / — |
| 15000 | 6 | 6 | 6 | 5 | 0 | 0 | 2091.04 / 2124.66 / 2623.72 / 2623.72 | — / — / — / — |

Per-observation descriptive response measurements:

| Case ID | Timeout | Replicate | Outcome | Prompt chars | Issue count | Output bytes | Completion latency (ms) | Timeout censored duration (ms) |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| corporate-residency-general-rule | 8000 | 1 | RESPONSE_RECEIVED | 8834 | 1 | 913 | 2245.07 | — |
| corporate-residency-general-rule | 12000 | 1 | RESPONSE_RECEIVED | 8834 | 1 | 939 | 2015.27 | — |
| corporate-residency-general-rule | 15000 | 1 | RESPONSE_RECEIVED | 8834 | 1 | 892 | 2116.95 | — |
| target-mixed-ifrs-singapore-accounting | 12000 | 1 | RESPONSE_RECEIVED | 8873 | 1 | 1183 | 2181.95 | — |
| target-mixed-ifrs-singapore-accounting | 15000 | 1 | RESPONSE_RECEIVED | 8873 | 1 | 1093 | 2229.28 | — |
| target-mixed-ifrs-singapore-accounting | 8000 | 1 | RESPONSE_RECEIVED | 8873 | 1 | 964 | 2102.73 | — |
| A-paraphrase-2 | 15000 | 1 | RESPONSE_RECEIVED | 8908 | 2 | 1482 | 2570.28 | — |
| A-paraphrase-2 | 8000 | 1 | RESPONSE_RECEIVED | 8908 | 2 | 1484 | 2274.79 | — |
| A-paraphrase-2 | 12000 | 1 | RESPONSE_RECEIVED | 8908 | 2 | 1512 | 2521.61 | — |
| A-paraphrase-2 | 12000 | 2 | RESPONSE_RECEIVED | 8908 | 2 | 1530 | 2514.17 | — |
| A-paraphrase-2 | 8000 | 2 | RESPONSE_RECEIVED | 8908 | 2 | 1476 | 2387.89 | — |
| A-paraphrase-2 | 15000 | 2 | RESPONSE_RECEIVED | 8908 | 2 | 1520 | 2623.72 | — |
| target-mixed-ifrs-singapore-accounting | 8000 | 2 | RESPONSE_RECEIVED | 8873 | 1 | 1130 | 2473.4 | — |
| target-mixed-ifrs-singapore-accounting | 15000 | 2 | RESPONSE_RECEIVED | 8873 | 1 | 1159 | 2124.66 | — |
| target-mixed-ifrs-singapore-accounting | 12000 | 2 | RESPONSE_RECEIVED | 8873 | 1 | 1186 | 2579.32 | — |
| corporate-residency-general-rule | 15000 | 2 | RESPONSE_RECEIVED | 8834 | 1 | 927 | 2091.04 | — |
| corporate-residency-general-rule | 12000 | 2 | RESPONSE_RECEIVED | 8834 | 1 | 895 | 2087.2 | — |
| corporate-residency-general-rule | 8000 | 2 | RESPONSE_RECEIVED | 8834 | 1 | 925 | 1912.02 | — |

Recommendation criteria were preregistered in the versioned V2 evaluation config. This n=6/arm measurement is a limited pilot, not statistical proof.
