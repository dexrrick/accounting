# IRAS evidence pipeline hardening — 26/09/2026

**Continuation:** The later [final IRAS hardening assessment](iras_evidence_completion_2026-09-26.md) records the builder/reviewer fixes, final 20-case live capture, ten-dimension assessment and Node-runtime limitation. The historical validation statements below describe the earlier phase.

This work addresses the shared causes in [the live-validation report](iras_live_validation_2026-09-26.md). It does not replace individual benchmark answers, change the reviewed expectations, or turn the original LIVE_FAIL results into passes.

## Failure analysis

All 19 cases have a retrieval-precision failure. The retriever awarded positive authority/domain/freshness scores even without topic-specific content, and the hybrid path filled its result limit with unrelated records before relevant local summaries. A second problem was admission: NEEDS_REVIEW local summaries were put into the prompt beside validated evidence. Live HTTP success and a matching source-map topic were also insufficient to establish support for the precise claim.

The response layer was a separate source of leakage. It could merge generic offline statutory templates, previous scenario state and model text, reintroducing Income Tax Act headings for GST, Companies Act/VCC material for overseas services, or unrelated 17%/30 November metadata. Citation verification established structural identity, not entailment. Missing-fact disclaimers did not stop categorical conclusions.

P = retrieval precision; E = insufficient validated evidence; G = grounding leakage; C = citation mismatch/missing/unverified citation; M = missing-fact handling. Evidence can be insufficient for one material claim even if another claim is supported.

| Case | Causes | Specific mechanism |
| --- | --- | --- |
| Customer/supplier meals | P, G, C | Irrelevant local padding; unsupported visitor exclusion; wrong legislation; final citations absent. |
| Passenger-car GST | P, E, G, C | Car-specific topic rejected; selected generic excerpt omits restriction; unreviewed local details and unsupported definition/exceptions. |
| Overseas services | P, E, G, C, M | Goods-heavy out-of-scope evidence cannot support all service-nexus claims; ACRA/VCC template and timing leak; required facts omitted. |
| December 2022 / January 2023 transition | P, G, C, M | Dated rates exist but do not determine the applicable transitional treatment without supply/payment facts; answer nevertheless selects 7%. |
| Generic expense deductibility | P, G, C, M | Core Section 14 rule is supported; unrelated rate/deadline metadata and unverifiable SSO citation; expense nature and period not elicited. |
| Immediate R&R | P | Core conditional rule, missing facts and canonical R&R citation are supported; unrelated loss/13W/WHT records remain unnecessary. |
| Section 14N YA2024 | P, G, C | Dated local rule supports the core; current timing metadata and unrelated GST reverse-charge citations are added downstream. |
| Section 14N YA2026 | P, E, G, C, M | Exact excerpt does not support every deduction option; no-proration condition/commencement facts omitted; unrelated metadata/citations. |
| CIT passenger car / capital allowances | P, E, G, C, M | Accepted generic CA evidence does not establish the car restriction; unreviewed local rule, generic expense facts and unrelated timing. |
| Loss carry-forward | P, E, G, C, M | Official page rejected; unvalidated Section 37 summary used; trade losses assumed without distinguishing other losses/allowances. |
| WHT interest | P, E, G, C | The 15% rate is absent from supplied evidence; scope citation cannot substantiate rate/exemption detail. |
| WHT management fees | P, E, G, C | Conditional service-location core is supported; additional deduction/transfer-pricing claims exceed supplied evidence and citation scope. |
| IR21 | P, E, G, C | Required page rejected; exact deadlines/withholding limits generated without supplied IR21 evidence. |
| Bonus timing | P, E, G, C, M | AIS filing evidence substituted for entitlement timing; receipt year selected despite unresolved contractual/discretionary facts. |
| GST 2023 | P, G, C | Correct dated rate/arithmetic; incorrect Income Tax Act attribution and missing citations. |
| GST 2024 | P, G, C | Correct dated rate/arithmetic; incorrect Income Tax Act attribution and missing citations. |
| Section 13W pre-2026 | P, C, M | Dated core rule is supported; exclusions/facts and PDF validation limitation omitted; citation absent. |
| Section 13W from 2026 | P, E, G, C, M | Preference-share wording contaminates routing with ACRA/accounting; post-2026 local record is unreviewed; missing facts/PDF limitation omitted. |
| Form C-S Lite / FTC YA2026 | P, G | Form eligibility and canonical citation supported; unrelated rate/deadline metadata breaks full-output grounding/date handling. |

The seven original provider failures are reliability failures, not one of these semantic causes. Retries did not repair the underlying evidence/answer defects. The date failures above arise from missing dated evidence, premature application, or unrelated structured metadata.

## Implementation policy

1. Retrieve validated local knowledge first. For IRAS, semantic extraction does not invoke Gemini before this decision. Use official retrieval only for uncovered local topics. An authority or current-date match is not sufficient source relevance.
2. Apply an evidence-quality gate to actual records before answer generation. Reject pointers, unrelated content, unreviewed or audit-overdue local rules, failed live provenance and period mismatches. Track covered/uncovered topics and unresolved facts. A live candidate needs the successful content/title/topic fetch trace; its source-map label alone is not evidence. A freshly fetched page is not accepted for an earlier historical target solely because a dated source-map pointer led to it; this implementation currently abstains on such live historical candidates.
3. Supply Gemini only admitted evidence. Do not supply rejected summaries, earlier model assertions, offline statutory templates or general-knowledge permission for tax claims. Prefer distinctive query terms when selecting long-page passages, with surrounding sentences retained.
4. Require generated tax claims to bind to a supplied record and complete source quotation. Check quotation identity, polarity/numbers, boundaries, canonical citation and period. Arbitrary paraphrases and case-application conclusions are not automatically verifiable and are withheld. This is conservative exact-source support, **not a general semantic-entailment model**.
5. Build IRAS tax presentation from accepted evidence rather than merging uncontrolled model/offline/current-state tax fields. Missing facts remain visible and the application does not declare eligibility complete from a quotation. Existing deterministic accounting measurement remains separate; valid balanced journal lines are preserved.

Insufficient evidence is a supported limitation, not a successful substantive answer. A source-bound local response or verified quotation is not an independently approved application conclusion. Correct answers may be withheld until a rule application can be deterministically verified. This is an explicit coverage limitation rather than a false grounding pass.

## Validation

The [offline replay](iras-evidence-hardening-2026-09-26/captured-evidence-admission.json) evaluated the gate against the original captured real evidence and its original human relevance labels. Across 19 cases, the original selected set contained 27 RELEVANT, 17 PARTIALLY_RELEVANT and 87 IRRELEVANT records. The revised gate admitted 13 RELEVANT and 10 PARTIALLY_RELEVANT records, with **zero IRRELEVANT admissions**. Case-level gate statuses were 4 LOCAL_SUFFICIENT, 3 RETRIEVED_SUFFICIENT, 7 LIMITED and 5 INSUFFICIENT. These are admission classifications only: they neither score new answers nor establish that a partly relevant excerpt supports every requested fact. The replay reconstructs only mechanical live-candidate provenance omitted by the compact capture, using recorded successful canonical fetches and hashes; it performs no network call.

The independent reviewer found freshness, historical-page and negated-fact risks. The revised checks reject overdue current local records, reject current fetched pages as historical proof without independently established page period, and abstain from deterministic GST arithmetic on negated registration, standard-rating or invoice/payment alignment. Mixed-authority requests now apply the IRAS gate to the IRAS component while withholding unrelated ACRA/IFRS records from the tax prompt. Ordinary accounting transactions that merely state GST facts keep their existing accounting path. The mixed customer-lunch regression preserves its balanced SGD 200 accounting entry and discussion while removing the unsupported GST claim; unrelated missing accounting facts do not suppress a separately established GST calculation.

The reviewer could not complete a final re-review after those fixes because the agent service stopped the turn. Supervisor review and the full regression suite completed; independent final sign-off remains outstanding.

`npm run test:smoke`, `npm test`, `npm run lint` and `npm run build` pass. The full suite includes the new evidence gate, quote verifier, local-first/order, mixed-answer preservation and source-driven GST arithmetic regressions. Lint and build retain existing generated-file/chunk-size warnings. The broad live integration suite was not run because it contacts ACRA, CPF and MOM in addition to IRAS; this task is IRAS-only.

**Overall phase: LIVE_FAIL remains unchanged.** A later [post-hardening live run and ten-dimension assessment](iras_live_followup_2026-09-26.md) exercised all 19 reviewed cases and the mixed customer-lunch case with real Gemini and official retrieval. It found sharply improved admitted-source precision and two passing dated local GST calculations, but source gaps, four provider timeouts and withheld case-application conclusions keep the phase incomplete. The final localized missing-fact and mixed-answer changes were checked offline after that capture, so another full live run would be needed to assess those final edits. Exact quotation verification deliberately does not prove case-level application; additional deterministic application checks or review would be needed before treating those conclusions as complete.
