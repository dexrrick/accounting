# IRAS-first v1 targeted evaluation

- Model: gemini-3.5-flash-lite
- Timeout: 8000 ms
- Minimum provider request start gap: 15250 ms
- Calls attempted: 9
- Minimum observed start gap: 17491 ms

| Case | Group | Valid | Matched / expected | Predicted | Operation correct / matched | Routing correct | Failure |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| target-relief-entitlement | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | INVALID_RESPONSE |
| target-relief-amount | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | INVALID_RESPONSE |
| A-paraphrase-2 | PRESELECTED_KNOWN_FAILURE | false | 0 / 2 | 0 | 0 / 0 | false | INVALID_RESPONSE |
| private-expense-treatment | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| foreign-dividend-receipt-treatment | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |
| corporate-residency-general-rule | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | TIMEOUT |
| target-mixed-ifrs-singapore-accounting | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | TIMEOUT |
| dev-investment-comparison | INDEPENDENT_CONTROL | false | 0 / 1 | 0 | 0 / 0 | false | TIMEOUT |
| unsupported-sfrsi-6-exploration-evaluation | INDEPENDENT_CONTROL | true | 1 / 1 | 1 | 1 / 1 | true | — |

## IRAS-first release contract

- Profile: iras-first-v1
- Acceptance passed: false
- Topic and record counts describe current registry inventory only; they do not assert completeness or source admission.
- Runtime evidence uses the localOnly retrieval path and guardrails; it does not establish current live authority-page retrieval or substantive answer completion.

| Authority | Scope state | Topics | Records | Note |
| --- | --- | ---: | ---: | --- |
| IRAS | RELEASE_REQUIRED | 107 | 71 | provider available |
| CPF | PARTIAL | 15 | 7 | provider available |
| MOM | PARTIAL | 26 | 10 | provider available |
| ACRA | PARTIAL | 111 | 51 | provider available |
| MAS | PARTIAL | 16 | 6 | provider available |
| ACCOUNTING_STANDARDS | PARTIAL | 85 | 41 | provider available |
| IFRS_FOUNDATION | PARTIAL | — | — | alias of ACCOUNTING_STANDARDS |
| SSO | NOT_YET_COVERED | — | — | no supported provider |
| UNKNOWN | NOT_YET_COVERED | — | — | no supported provider |

Semantic quality across all authorities:

| Valid responses | Issue recall | Issue precision | Case-specific facts | Governing authority | Contextual authority | Domain | Population | Operation |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 / 9 | 3 / 10 | 3 / 3 | 3 / 9 | 3 / 3 | 2 / 3 | 3 / 3 | 3 / 3 | 3 / 3 |

Release-required coverage (IRAS only):

| Issues | Topic mapped | Canonical workstream | Provider path reached | Retrieval attempted | Evidence supported | Blocking gaps | Blocking cases |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 | 0 | 2 | 0 | 0 | 0 | 6 | 6 |

Non-IRAS semantic checks:

- Correctly recognized and routed or explicitly unsupported: 1 / 4.
- Non-IRAS coverage gaps by authority are recorded below; explicit insufficient outcomes remain visible.

| Authority | Issues | Explicit unsupported | Gap-code counts |
| --- | ---: | ---: | --- |
| ACCOUNTING_STANDARDS | 1 | 1 | {"NO_COVERAGE_TOPIC":1,"UNKNOWN_DOMAIN":0,"UNASSIGNED_QUERY_TOPIC":0,"CANONICAL_AREA_UNRESOLVED":0,"ISSUE_UNMAPPED":0,"NO_GOVERNING_AUTHORITY":0,"PROVIDER_UNAVAILABLE":0,"PROVIDER_AUTHORITY_MISMATCH":0,"PROVIDER_ERROR":0,"ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL":1,"ISSUE_PLAN_COVERAGE_UNESTABLISHED":0,"NO_CANDIDATE_EVIDENCE":0,"CANDIDATE_REJECTED":0,"NO_ADMITTED_EVIDENCE":0,"NO_VERIFIED_CLAIM":0,"ISSUE_CONCEPT_UNCOVERED":0,"IRAS_SCOPE_NOT_COVERED":0,"EMPTY_ISSUE_PLAN":0,"UNROUTED_MATERIAL_CONCEPT":0,"OTHER_GAP":0} |

| Case | Versioned expectation | IRAS issues passed / total | Non-IRAS passed / total | Semantic quality | Case accepted |
| --- | --- | ---: | ---: | --- | --- |
| target-relief-entitlement | iras-first-v1 | 0 / 1 | 0 / 0 | false | false |
| target-relief-amount | iras-first-v1 | 0 / 1 | 0 / 0 | false | false |
| A-paraphrase-2 | iras-first-v1 | 0 / 1 | 0 / 1 | false | false |
| private-expense-treatment | iras-first-v1 | 0 / 1 | 0 / 0 | false | false |
| foreign-dividend-receipt-treatment | iras-first-v1 | 0 / 1 | 0 / 0 | true | false |
| corporate-residency-general-rule | iras-first-v1 | 0 / 1 | 0 / 0 | false | false |
| target-mixed-ifrs-singapore-accounting | iras-first-v1 / iras-first-v1 | 0 / 0 | 0 / 1 | false | false |
| dev-investment-comparison | iras-first-v1 / iras-first-v1 | 0 / 0 | 0 / 1 | false | false |
| unsupported-sfrsi-6-exploration-evaluation | iras-first-v1 | 0 / 0 | 1 / 1 | true | true |

All-authority recognition against unchanged historical expectations:

- Scope: targeted-profile historical overlap (2 / 10 historical cases).
- This recognition metric is not the original strict-gate acceptance result.
- Cases scored: 2 / 10.
- Issue recall: 0 / 3 (0).
- Issue precision: 0 / 0 (null).
- All five dimensions correct: 0 / 2 (0).
- Original strict-gate acceptance: NOT_REEVALUATED.
| Historical dimension | Correct / matched / expected | Rate on expected |
| --- | ---: | ---: |
| governingAuthority | 0 / 0 / 3 | 0 |
| contextualAuthority | 0 / 0 / 3 | 0 |
| domain | 0 / 0 / 3 | 0 |
| population | 0 / 0 / 3 | 0 |
| operation | 0 / 0 / 3 | 0 |
- Complete cases: 0 / 2 (0).

| Group | Valid / cases | Valid recall | All-case recall | Valid precision | Operation accuracy | Complete coverage | Routing / valid | Routing / all | Invalid / calls | Timeout | Provider failure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PRESELECTED_KNOWN_FAILURE | 0 / 1 | 0 / 0 | 0 / 2 | 0 / 0 | 0 / 0 | 0 / 1 | 0 / 0 | 0 / 1 | 1 / 1 | 0 | 0 |
| INDEPENDENT_CONTROL | 3 / 8 | 3 / 3 | 3 / 8 | 3 / 3 | 3 / 3 | 3 / 8 | 3 / 3 | 3 / 8 | 2 / 8 | 3 | 0 |
| COMBINED | 3 / 9 | 3 / 3 | 3 / 10 | 3 / 3 | 3 / 3 | 3 / 9 | 3 / 3 | 3 / 9 | 3 / 9 | 3 | 0 |

Source fingerprints stable during capture: true
Fixture fingerprints stable during capture: true
