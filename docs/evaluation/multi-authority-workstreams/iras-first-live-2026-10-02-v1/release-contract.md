# IRAS-first evaluation contract v1

This evaluation gates the current IRAS-first product phase. Its fixed profiles preserve semantic checks across all authorities while making coverage release-required only for IRAS.

## Authority scope

`RELEASE_REQUIRED` means the authority must meet the release coverage criteria below. `PARTIAL` means semantic recognition and routing remain required, while incomplete topic or evidence coverage may be reported as an explicit insufficient outcome. `NOT_YET_COVERED` means a supported knowledge/provider path is absent and the issue must remain visible as unsupported.

| Authority | State | Current inventory | Scope note |
| --- | --- | ---: | --- |
| IRAS | `RELEASE_REQUIRED` | 107 topics / 71 records | All requested IRAS issues must map, reach their canonical workstream and retrieval path, have admitted verified support, and have no blocking coverage gaps. |
| CPF | `PARTIAL` | 15 topics / 7 records | Semantic and routing checks remain required. |
| MOM | `PARTIAL` | 26 topics / 10 records | Semantic and routing checks remain required. |
| ACRA | `PARTIAL` | 111 topics / 51 records | Semantic and routing checks remain required. |
| MAS | `PARTIAL` | 16 topics / 6 records | Semantic and routing checks remain required. |
| Accounting standards | `PARTIAL` | 85 topics / 41 records | This phase does not require comprehensive SFRS(I) topic coverage. |
| IFRS Foundation | `PARTIAL` | Alias | Contextual authority or accounting alias; it is not an independent canonical workstream. |
| SSO, UNKNOWN | `NOT_YET_COVERED` | No supported provider | Issues must be represented as unsupported when there is no supported path. |

Topic and record counts are registry inventory counts. They do not assert knowledge completeness, source admission, or answer quality.

## Per-issue gate

The runner derives issue diagnostics from the runtime issue plan, workstream membership, lifecycle flags, evidence counts, and scoped gap codes. Persisted per-issue diagnostics contain only authority/domain/operation/status enums, numeric counts, and allowlisted gap codes. They do not contain questions, facts, subjects, response labels, credentials, URLs, source text, or raw provider output. If plan or lifecycle metadata is missing, the gate fails closed.

Every issue must be semantically represented with the expected domain, governing and contextual authorities, population, operation, and case-specific-facts flag. Unsupported issues cannot be dropped or routed into IRAS to exploit its stronger coverage. A non-IRAS issue passes coverage only when it reaches its expected canonical route or an explicit insufficient/unsupported state is recorded. Expected unsupported controls additionally require `NO_COVERAGE_TOPIC` and `INSUFFICIENT`.

For each IRAS issue, the gate requires a mapped topic, the expected canonical IRAS area, a retrieval attempt, mapped/retrieved/admitted/verified/covered lifecycle completion, admitted records and verified claims, `VERIFIED` issue evidence, and zero blocking routing or evidence coverage gaps, including global IRAS gaps that cannot be attached to one issue. A rejected candidate alone does not block when other evidence is admitted and fully supports the issue. An application may remain unresolved for missing user facts; the overall status must then remain conditional while the source-supported rule path is checked.

Across every authority, `VERIFIED` requires admitted evidence and at least one verified claim. Provider errors, rate limits, timeouts, invalid semantic JSON, missing calls, extra calls, and unstable fingerprints always fail.

The runtime uses the `localOnly` evidence path. A pass validates local routing, retrieval-path behavior, and guardrails; it does not establish current live authority-page retrieval or substantive answer completion.

## Separate score groups

Semantic quality is reported across all authorities: response validity, issue recall and precision, governing and contextual authority, domain, population, operation, and case-specific-facts flag.

Release coverage is reported for IRAS only: topic mapping, canonical workstream, provider path, retrieval attempt, admitted verified support, and blocking gaps. Non-IRAS semantic checks and coverage gaps are reported separately. An unsupported accounting topic cannot become an IRAS release failure by aggregation.

## Fixed profiles

`iras-first-targeted-v1-live` uses the nine fixed IDs in `tests/evaluation/singapore/iras-first-evaluation-config-v1.json`: the two central relief cases, `A-paraphrase-2`, two existing corporate IRAS controls, corporate residency, mixed IFRS/SFRS(I), investment comparison, and a separate SFRS(I) 6 unsupported control. `iras-first-final-v1-live` uses the unchanged historical ten plus the two central relief cases. Arbitrary caller-supplied cases are rejected. The final profile is gated on row-by-row revalidation of the targeted output, exact current fingerprints, pacing, and protected historical artifacts.

The original ten-case fixture and prior live JSON/Markdown artifacts remain unchanged. New expectation adjudications apply only to v1 profiles.
