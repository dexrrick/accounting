# IRAS end-to-end validation — 26 September 2026

## Status

Offline implementation, independent reviews and substitute validation are complete. The overall IRAS answer benchmark remains **PENDING_REVIEW**. The user confirmed that no AI provider is configured and requested that live-answer validation be reported as pending.

The 19-case fixture contains the 12 requested accountant workflows plus historical GST, Section 14N, Section 13W and YA 2026 filing variants. An independent content reviewer approved the expected substantive conclusions, missing facts, effective dates and calculations for all 19 cases. Catalog/source-policy review is recorded separately. Neither approval promotes synthetic execution into a verified live answer.

## Observed results

| Check | Result | Limit |
| --- | --- | --- |
| Domain/authority classification | 12/12 provisional passes | Deterministic, no model |
| Required topic routing | 12/12 provisional passes | Optional topic expectations remain pending |
| Synthetic mapped-page retrieval trace | 11 passes; 1 local-path response not evaluated | Synthetic HTML, not live IRAS retrieval |
| Required dated local records | 6/6 observed passes | Evidence presence and date scope, not answer correctness |
| Seven additional fixture contexts | 7/7 observed passes | Expected maps/local records only |
| Live substantive answers, grounding, citations, missing-fact answers and effective-date answers | Not evaluated | No provider |
| Numeric GST answer calculations | Not evaluated at runtime | Reviewed expected amounts: SGD 80/1,080 for 2023 and SGD 90/1,090 for 2024 |
| General claim-to-source semantic support | Unverified | Citation structure does not prove support for prose |

There is no overall 19/19 answer-quality pass. Source-selection precision and actual final-answer citation support remain pending.

## Changes and review findings

- Added exact-question routing and missing-fact coverage for meals, passenger cars, overseas services, generic deductions, renovation, prior-year losses, withholding tax, IR21 and bonus reporting.
- Removed income-tax passenger-car routing into GST and goods-export source selection for service-only questions. Current loss-carry-forward guidance remains available for the generic phrase “prior-year losses”.
- Allowed mapped fallback for a catalog-validated topic when no adequate local record is retrieved. Rejected navigation-only and generic-page content at both validation and fallback boundaries.
- Kept historical questions from using undated current maps. Added linked local GST rate versions only for explicitly stated adjacent-year invoice/payment boundaries. The December 2022/January 2023 context now contains the 7%, 8% and time-of-supply records; it does not select an applicable rate without the missing facts.
- Corrected current GST time of supply versus pre-2011 rules; qualified international-services zero-rating and separated it from input-tax recovery; clarified motor-car exceptions, including the statutory taxi authorised-purpose limit.
- Corrected Section 13W period/group/property conditions, withholding-tax payment timing, Section 14N fixed-period/reset/no-proration conditions, and loss-versus-capital-allowance comparison dates. Curated guidance is not presented as verbatim statute.
- Removed categorical car-advisory treatment where facts are unresolved and aligned the displayed car response with its ordinary S-plate assumptions.
- Added a narrow meal-GST response guard across compact/freeform messages, rendered summaries/advisories and disclaimers. It suppresses unsupported categorical yes/no language and unresolved claimability badges while preserving conditional wording and candidate-source status. The final retrieval reviewer found no remaining blocker in these named paths. General semantic verification remains outside this guard.
- Preserved fabricated-URL stripping, candidate-only citation status and source-map/evidence separation.

Independent content and retrieval reviewers identified the above issues; builders implemented the fixes and the supervisor reviewed integration. The local source retrieval diagnostics also expose additional candidates beyond required records; they are not counted as a precision pass or as proof that a final answer uses only relevant evidence.

Content review references include [IRAS time of supply](https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/charging-gst-%28output-tax%29/when-to-report-supplies-in-gst-returns), [international services](https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/charging-gst-%28output-tax%29/when-to-charge-0-gst-%28zero-rate%29/providing-international-services), [Section 13W guidance](https://www.iras.gov.sg/media/docs/default-source/e-tax/etaxguide_certainty-of-non-taxation-of-companies-gain-on-disposal-of-equity-investments.pdf), [Section 14N guidance](https://www.iras.gov.sg/media/docs/default-source/e-tax/etaxguide_it_deduction_r_r_costs.pdf), and [Income Tax Act section 15](https://sso.agc.gov.sg/Act/ITA1947?ProvIds=pr15-). These review references do not imply that the application fetched the PDFs during the synthetic run.

## Validation

- **52/52 registered suites passed in the final esbuild-bundled substitute run.** All smoke-tier suites were included. An earlier temporary output-file lock was resolved before this final run.
- `node node_modules/typescript/bin/tsc -b`: passed.
- `node node_modules/oxlint/bin/oxlint`: exit 0, 67 warning lines.
- `node node_modules/vite/bin/vite.js build`: passed, with the large-chunk warning.
- `git diff --check`: passed.
- Temporary supervisor bundles and runner were removed.

Canonical `npm run lint`, `npm run build`, `npm run test:smoke` and `npm test` remain unavailable. The project requires Node **22.x**; the shell provides Node **24.19.0**, npm is absent, and preflight reports an unavailable OS user profile that prevents `tsx` startup. Bundled substitutes are **not equivalent to canonical validation**.

## Files changed

- Routing/retrieval: `src/classification/questionClassifier.ts`, `src/standards/coverageRegistry.ts`, `src/retrieval/externalSourceValidator.ts`, `src/services/groundingContextBuilder.ts`.
- Rules/answers: `src/standards/statutes/gst.ts`, `src/standards/statutes/iras.ts`, `src/standards/singaporeStatutesKnowledge.ts`, `src/engine/scenarioParser.ts`, `src/engine/responseAssembler.ts`, `src/services/geminiService.ts`.
- Benchmark/regressions: `iras-answer-e2e.json`, `tests/regression/test_iras_e2e_routing.mjs`, `tests/regression/test_iras_end_to_end_provisional.mjs`, `test_iras_missing_fact_guards.mjs`, `test_phase3_coverage.mjs`, `test_statutory_engine.mjs`, and `scripts/run_all_tests.mjs`.

## Remaining gates

1. Run the canonical commands under Node 22 with npm and a working OS user profile.
2. Run the reviewed cases through a configured provider and real official retrieval; inspect each final claim against its cited excerpt, including source relevance, dates and calculations.
3. Complete source-selection precision and answer/citation review before marking the IRAS phase complete.

No commit or push was performed. No CPF/MOM/ACRA/MAS expansion was undertaken.
