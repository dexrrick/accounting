# IRAS live end-to-end validation — 26/09/2026

**Overall: LIVE_FAIL. The IRAS E2E phase is not complete.** All 19 reviewed cases produced real Gemini answers across 26 benchmark attempts: 12 succeeded on the first attempt, seven timed out and each received one successful retry. No synthetic provider responses or synthetic IRAS HTML were used. None of the 19 cases passes every dimension: every case selected unnecessary evidence, and several also failed substantive reasoning, grounding, missing-fact enforcement, dates or citations.

## Execution and artifacts

The environment key was present and used only for temporary provider execution. Its value, fragments and request headers were never captured. The existing processAccountingQuery → classification/topic/local knowledge → governed source-map retrieval → actual official fetch → grounding → existing Gemini provider → production post-processing/citation verification flow was exercised. The optional diagnostic callback observes the real grounding context without changing it. Normal UI defaults were used for the benchmark.

Provider/model: **Gemini / gemini-3.5-flash-lite**, the repository-compatible default, confirmed against [Google's model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite). Existing provider settings, system instructions, semantic extraction, grounding and deterministic safeguards were retained. No separate Gemini client was introduced. Final answer generation is distinguished from semantic-extraction calls.

- [Complete reviewed assessment and per-case evidence](iras-live-2026-09-26/assessment.json): authoritative ten-dimensional scores and normalized observations.
- [19 first attempts](iras-live-2026-09-26/iras-e2e-captures.jsonl), [isolated overseas retry](iras-live-2026-09-26/isolated-provider-check.jsonl), [six remaining single retries](iras-live-2026-09-26/bounded-retries.jsonl): original request context, exact provider candidate, full final output, actual fetches, hashes, excerpts and timestamps.
- [Independent citation checks](iras-live-2026-09-26/iras-citation-verification.jsonl): URL/canonical/title/topic checks; not additional grounding supplied to Gemini.
- [Mixed meal, UI defaults](iras-live-2026-09-26/mixed-meal-default-capture.jsonl), [explicit journal/statutory preferences](iras-live-2026-09-26/mixed-meal-capture.jsonl), [corrected replay](iras-live-2026-09-26/mixed-meal-guard-replay.json).

Raw captures are preserved. Some early derived fields copied context missing facts rather than final requests, treated any provider call as local knowledge being used, or equated HTTP success with retrieval success. The assessment corrects those fields using actual final output and exact evidence supplied. Seven timeout attempts are BLOCKED_BY_PROVIDER; their underlying network cause was not established. A later success does not erase the failure history. No malformed-JSON failure was observed; production safeguards remain in place but that live failure mode was not induced.

## Real retrieval and precision

Across all 26 benchmark attempts: **63 source HTTP requests**, including robots checks; **39 IRAS content requests** across **15 distinct content URLs**. IRAS content HTTP statuses: {"200":39}. Source HTTP statuses including robots: {"200":39,"403":12,"404":12}.

For the latest 19 selected attempts: topic-validation outcomes were **{"SUCCESS":17,"TOPIC_MISMATCH":11,"HISTORICAL_SCOPE_UNVERIFIED":10}**. A SUCCESS is a validator observation, not a semantic evidence pass. 44 source requests used manual redirect handling; no 3xx response occurred. HTTPS/approved-host, requested and final URL, title, canonical identity and content were recorded. No fabricated replacement URL was supplied. The IRAS robots 404 and SSO robots 403 were not treated as content evidence.

Required car, loss/shareholding, IR21 and bonus-timing topics were rejected even when IRAS returned HTTP 200. Generic WHT evidence was accepted while the interest/management-specific topic validation failed. These are real source-selection/validator problems. A rejected page never becomes grounding merely because a separate network capture contains its text.

Six cases intentionally used dated-local policy and did not fetch a current IRAS page: GST transition, GST 2023, GST 2024, Section 14N YA2024 and both Section 13W periods. Their live retrieval score is NOT_EVALUATED; local content and date validity are scored separately. In particular, the post-2026 Section 13W local record is NEEDS_REVIEW and cannot establish validated grounding.

Selected-record precision over the latest cases: **{"IRRELEVANT":87,"RELEVANT":27,"PARTIALLY_RELEVANT":17}**. Each record is rated RELEVANT, PARTIALLY_RELEVANT or IRRELEVANT; rejected required-topic evidence is separately UNAVAILABLE. Topical relevance does not upgrade local NEEDS_REVIEW summaries into validated tax rules. Live candidate excerpts are assessed as actually retrieved official evidence, without pretending they became reviewed local statutes.

For meals, selected evidence included irrelevant bad-debt, registration-threshold, de-minimis, remission and export records; invoice guidance was only partial. This is a precision failure despite successful IRAS retrieval. Similar unrelated local-record padding occurs in all 19 cases. The mixed meal default request resolves no IRAS topic IDs and consequently performs no IRAS page retrieval.

## Separate dimension scores

P = LIVE_PASS; F = LIVE_FAIL; N = NOT_EVALUATED; S = BLOCKED_BY_SOURCE. BLOCKED_BY_PROVIDER applies to the seven first attempts. BLOCKED_BY_NETWORK is reserved for a demonstrated network block, not inferred from an abort. The table uses the latest generated answer, including structured fields. Retrieval means usable relevant evidence, not HTTP reachability. All overall case results are LIVE_FAIL only after these dimensions were assessed separately.

| Case | Classification | Topic | Selection | Retrieval | Grounding | Substance | Missing facts | Date | Calculation | Citation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1. GST meals | P | P | F | P | F | F | P | P | N | F |
| 2. GST passenger car | P | P | F | S | F | P | P | F | N | F |
| 3. Overseas services | P | P | F | P | F | P | F | F | N | F |
| 4. GST Dec 2022 / Jan 2023 | P | P | F | N | F | F | F | F | N | F |
| 5. Generic CIT expense | P | P | F | P | F | P | F | F | N | S |
| 6. R&R missing period | P | P | F | P | P | P | P | P | N | P |
| 7. Section 14N YA2024 | P | P | F | N | F | P | P | F | N | F |
| 8. Section 14N YA2026 | P | P | F | P | F | F | F | F | N | F |
| 9. CIT passenger car / CA | P | P | F | S | F | P | F | F | N | S |
| 10. Loss carry-forward | P | P | F | S | F | F | F | P | N | F |
| 11. WHT interest | P | P | F | F | F | F | P | F | N | F |
| 12. WHT management | P | P | F | P | F | P | P | P | N | F |
| 13. IR21 | P | P | F | S | F | P | P | P | N | F |
| 14. Bonus reporting | P | P | F | F | F | F | F | F | N | F |
| 15. GST 2023 | P | P | F | N | F | P | P | P | P | F |
| 16. GST 2024 | P | P | F | N | F | P | P | P | P | F |
| 17. Section 13W pre-2026 | P | P | F | N | P | F | F | P | N | F |
| 18. Section 13W from 2026 | F | F | F | N | F | F | F | P | N | F |
| 19. Form C-S Lite / FTC YA2026 | P | P | F | P | F | P | P | F | N | P |

Grounding review compares material rules, percentages, thresholds, deadlines, exemptions, historical conditions and qualifications against the exact supplied excerpts or validated dated local records. Findings below identify supported content and unsupported or overstated claims. Later citation retrieval cannot repair absent prompt evidence. Missing-fact fields do not pass if the prose makes the guarded conclusion anyway, as in the transition and bonus cases.

## Citation findings

The supplemental audit contains **22 case-citation records across eight distinct normalized URLs**. Three IRAS targets (R&R M-R, WHT scope and Form C-S overview) returned HTTP 200 and passed title/topic/canonical checks. Five distinct SSO statute URLs returned HTTP 403 and remain BLOCKED_BY_SOURCE. No redirect was observed. Query parameters were preserved and fragment variants normalized without discarding provision identity.

URL validity is separate from semantic and period support. The WHT scope page does not substantiate the answer's 15% rate; the management-fee citation does not support every added transfer-pricing/deduction assertion. Unrelated VCC and GST reverse-charge citations fail even if their host is approved. YA2024 requires dated historical support; a later check of a current R&R URL does not prove that it grounded the generated historical claim. Final citation lists are empty in many cases. Full per-citation transport metadata and per-case semantic/date findings are linked above.

## Meal guard fix and preservation proof

The default-preference mixed question reached real Gemini: “We paid SGD 200 for a customer lunch. What is the accounting entry, and can we claim the GST?” Gemini incorrectly said business-entertainment input tax is generally disallowed unless statutory exceptions apply. The original final answer retained that broad unsupported claim while producing a balanced Dr Entertainment Expense / Cr Cash or Bank journal of SGD 200.

The narrow guard now corrects the offending GST sentence/clause or structured field when GST-specific facts remain unresolved. It preserves accounting discussion, monetary decimals, neighboring clauses, valid conditional eligibility statements and the journal. Unrelated missing facts, such as another component's YA, do not suppress an otherwise supported GST conclusion. Specific private/non-business cost restrictions are preserved.

The captured real candidate was replayed through production post-processing with network disabled and identical captured local evidence. It passed: unsupported GST claim removed, accounting sentence preserved, exact original debit/credit/account lines preserved and balanced. This is **DETERMINISTIC_REPLAY_OF_REAL_CAPTURE**, not a new live provider run or retroactive live pass. Compact/freeform regressions also cover unconditional positive claims, negative blocked claims, conditional wording, clause boundaries, decimals and unrelated missing facts.

With explicit journal/statutory toggles enabled, a separate attempt short-circuited before Gemini and asked for amount/nature/payment facts already present. Provider evaluation is NOT_EVALUATED on that path. This parser/request-mode issue remains open; no broad parser redesign was made.

## Bugs fixed, checks and remaining work

Implemented an opt-in real-pipeline capture runner, safe provider-error handling, read-only grounding diagnostics and an independent controlled-retriever citation audit. Fixed meal-guard whole-response replacement and gating on unrelated missing facts, then the actual captured broad-negative claim gap. No statutory source content or provider architecture was redesigned.

Verification after the final fix: targeted routing/missing-fact regressions passed under Node 22; captured-answer replay passed; npm test passed all 52 suites; npm run test:smoke passed all 32 suites; npm run lint passed (existing warnings); npm run build passed (existing large-chunk warning). The standalone live-capture helper regression also passed. Tests use synthetic regression fixtures where appropriate; they are not counted as live benchmark passes. The sandbox Node 24 environment could not load tsx due to user-info ENOMEM; canonical checks ran with the working Node 22 runtime.

Remaining blockers: reduce irrelevant source selection; correct rejected/poorly excerpted required topics; supply validated current/historical evidence instead of relying on NEEDS_REVIEW local rules; enforce all missing-fact guards; remove wrong authority headings and unrelated timing metadata/citations; correct transition and bonus conclusions; verify missing canonical claim-level citations; repair mixed explicit-journal routing; investigate initial provider timeout reliability. No further retries or broad fixes were attempted merely to force passes.

The benchmark's runtime approval remains pending. This run provides real failure evidence and a scoped guard correction, not production acceptance. No new CPF, MOM, ACRA or MAS work was started; incidental unrelated retrieved records are reported as defects. Nothing was committed or pushed.

## Case findings

### 1. gst-customer-supplier-meals

Relevant entertainment conditions were supplied, but much of the selected local context concerns bad debt, registration, de minimis, remission and exports. Invoicing guidance is only partly relevant. Entertainment-specific mapping was rejected although the input-tax mapping accepted the same page.

Conditional eligibility is supported; the added rule excluding entertainment for non-business visitors is stronger than supplied evidence. The output also labels GST with the Income Tax Act.

GST-specific missing facts are retained. No numeric calculation applies. Final citations are empty.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 2. gst-passenger-car-input-tax

The generic input-tax page was retrieved, but its selected excerpt omits the passenger-car rule. The motor-vehicle topic failed TOPIC_MISMATCH. GST_REG26 is a NEEDS_REVIEW local summary.

Broad conditional blocked-car treatment is consistent with the oracle, but the 7-passenger/3,000kg definition, exceptions and running-cost details lack validated evidence in the actual prompt.

Vehicle class/use/exceptions are requested. No relevant period is established, and the wrong Income Tax Act heading and absent citations remain.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 3. gst-overseas-services-zero-rated-or-out-of-scope

International-services evidence is relevant. Out-of-scope evidence is partly relevant: the supplied page focuses heavily on goods/FTZ transactions and cannot establish every services nexus assertion.

The successful retry gives the correct conditional distinction, but finishes with an unrelated ACRA/VCC heading, VCCA Section 5 citation and Companies Act timing metadata. Unrelated local GST records remain.

The generated final state does not request the required services facts. The VCC citation is irrelevant and independently returned 403. The first attempt was a provider timeout with an unrelated deterministic fallback.

Capture: [isolated-provider-check.jsonl](iras-live-2026-09-26/isolated-provider-check.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 4. gst-invoice-december-2022-payment-january-2023

Dated 7%, 8% and time-of-supply records were supplied. Current IRAS maps were intentionally withheld under historical policy; this is not a live retrieval pass.

The answer selects 7% from the December invoice before establishing the supply/delivery and split-payment facts. A transitional-rule caveat does not repair the premature conclusion.

Missing facts are listed but not enforced. No numerical amount was supplied. Citations are empty.

Capture: [bounded-retries.jsonl](iras-live-2026-09-26/bounded-retries.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 5. cit-business-expense-deductibility-missing-facts

The Business Expenses page and verified Section 14 general-deduction record support a conditional test. EIS, passenger-car, withholding-tax and CPF material is unnecessary.

Core wholly-and-exclusively/revenue-versus-capital treatment is supported, but final structured metadata adds an unrelated 17% headline rate and 30 November deadline without adequate supplied support.

Expense nature/what was acquired and basis period/YA are not adequately elicited. The final Section 14 SSO citation independently returned 403.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 6. cit-renovation-immediate-deduction-missing-period

The M-R R&R page is relevant; general Business Expenses and Section 14/15 are partly relevant. Loss carry-back, Section 13W and withholding-tax records are unnecessary.

The answer appropriately distinguishes qualifying R&R from immediate general deduction, conditions Section 14N relief on the relevant YA/scope/cap, and avoids an unconditional claim.

Missing-period and eligibility questions are retained. The final R&R URL was independently verified at its canonical IRAS page and supports the conditional claim. No calculation can be made from the question.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 7. cit-renovation-section-14n-ya2024

Only the HISTORICAL YA2018-24 Section 14N record establishes the YA2024 treatment; Section 14 is partly relevant. No current-page retrieval was used to prove history.

The three-year deduction, first-claim three-year cap and YA2024 one-year election are supported by the dated local record. Unrelated 17%/30 November structured metadata is not.

The output adds an irrelevant GST reverse-charge citation and SSO citations that could not be verified. The later verified current R&R page does not retroactively become supplied historical grounding.

Capture: [bounded-retries.jsonl](iras-live-2026-09-26/bounded-retries.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 8. cit-renovation-section-14n-ya2026

Live R&R evidence supports the fixed YA2025-27 cap and designer-fee change. The current local Section 14N record is NEEDS_REVIEW; other selected local topics are irrelevant.

The response does not expressly preserve the full cap without proration for part-period commencement, omits the normal three-year treatment, and suggests a one-year option absent from the exact supplied live excerpt.

Commencement date is not requested. Generic 17%/30 November timing metadata and irrelevant GST reverse-charge citations remain.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 9. cit-passenger-car-expense-and-capital-allowance

The Business Expenses mapping was rejected; accepted capital-allowance evidence is only partial for the passenger-car restriction. The local car restriction is NEEDS_REVIEW.

The conditional car restriction and accounting-depreciation-versus-tax-allowance distinction are plausible against the oracle, but validated supplied evidence does not support all car-specific rules.

The final missing facts remain generic expense questions rather than ownership, stock-in-trade/exception and YA facts. Structured timing is unrelated. Section 14/15/19A SSO citations returned 403.

Capture: [bounded-retries.jsonl](iras-live-2026-09-26/bounded-retries.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 10. cit-prior-year-loss-carry-forward

The Unutilised Items page was fetched but rejected for both loss and shareholding topics. It therefore did not enter grounding. The only topical local Section 37 record is NEEDS_REVIEW.

The retry assumes trade losses and says they carry forward indefinitely subject to shareholding; it does not adequately distinguish loss types from capital allowances.

Loss type, available amount/prior utilisation and corresponding eligibility facts remain unresolved. Final citations are absent.

Capture: [bounded-retries.jsonl](iras-live-2026-09-26/bounded-retries.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 11. wht-overseas-interest-payment

WHT scope and rates pages were fetched; subtype interest/royalty validations failed. The exact supplied rates excerpt does not contain the asserted 15%. Other local corporation-tax records are unnecessary.

The 15% default and some exemption conditions are not established by supplied validated evidence. A live scope-page citation does not support that percentage.

Residence, beneficial ownership, treaty, loan source and payment timing are requested; no payable amount can be calculated. Period-specific rate support is missing.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 12. wht-overseas-related-management-fee

The WHT scope page supports management-fee and physical-service-location distinctions. The rates page is partial. Management-specific mappings were rejected; the local Section 45A summary is unvalidated.

The core conditional answer is consistent with the oracle, but added Section 12(7)(c), deduction-compliance and blanket contemporaneous transfer-pricing-documentation assertions exceed the exact supplied evidence.

Missing service-location/scope, recipient residence, treaty and payment-period facts are retained. The canonical WHT citation supports the core only, not all additional material claims.

Capture: [bounded-retries.jsonl](iras-live-2026-09-26/bounded-retries.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 13. employer-tax-clearance-ir21

The live IR21 page was fetched but rejected TOPIC_MISMATCH; no IR21 evidence reached the provider. All selected local corporation-tax material is irrelevant.

The answer states exact one-month filing and 30-day/clearance withholding rules despite no supplied authoritative IR21 evidence. Plausibility against the oracle is not grounding.

Status, cessation/departure, exemption and withholding facts are requested. No final citations support the deadlines.

Capture: [bounded-retries.jsonl](iras-live-2026-09-26/bounded-retries.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 14. employer-bonus-reporting-timing

AIS/IR8A evidence supports reporting obligations but not the bonus entitlement decision. The employment-income timing page was rejected and not supplied.

The answer chooses the April receipt year without resolving contractual versus discretionary entitlement. Its broad receipt-basis rule is unsupported.

Although the final state lists entitlement/date facts, the conclusion bypasses them. Applicable income/reporting year is therefore wrong or premature. Citations are absent.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 15. gst-historical-standard-rated-supply-2023

The dated 8% local rate is relevant; Section 11 is partly relevant. Bad debt, registration threshold, de minimis and exports are unnecessary. No current page was used as historical proof.

SGD 1,000 × 8% = SGD 80 GST and SGD 1,080 total are correct for the stated 2023 facts.

No material fact is missing for this computation, but the output wrongly labels GST under the Income Tax Act and supplies no final citation.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 16. gst-historical-standard-rated-supply-2024

The dated 9% local rate is relevant; Section 11 is partly relevant. Registration, bad debt, de minimis and reverse charge are unnecessary. No live retrieval was attempted under dated-local policy.

SGD 1,000 × 9% = SGD 90 GST and SGD 1,090 total are correct for the stated 2024 facts.

No material fact is missing for this computation, but the output wrongly labels GST under the Income Tax Act and supplies no final citation.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 17. cit-section-13w-pre-2026-disposal

The HISTORICAL pre-2026 Section 13W record supports the ordinary-share 20%/24-month rule and its period. Other local topics are unrelated. No live PDF/page was supplied.

The core historical rule is supported, but the answer omits the benchmark-required disclosure that the underlying PDF has not been validated and does not finish the exclusions/capital-versus-revenue analysis.

Final missing-fact requests and citations are absent. The raw candidate PDF URL is not a verified final citation.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 18. cit-section-13w-post-2026-disposal

Classification adds ACRA_COMPANIES/MULTI_AUTHORITY and an ACRA preference-share topic to a tax-only question. ACRA Section 156, IFRS 9, IAS 21, losses and WHT evidence is unrelated.

The post-2026 Section 13W local summary is NEEDS_REVIEW, not validated evidence. The answer asserts preference-share/group/20%/24-month conditions without verified official support and has a misleading SSO heading.

Missing facts and the required PDF-validation limitation are absent. The correct January 2026 boundary alone is insufficient; no final citations exist.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.

### 19. cit-form-cs-lite-foreign-tax-credit-ya2026

The Form C-S overview is relevant and the foreign-credit page partly relevant. Other Section 14/WHT/13W/R&R records are unnecessary.

The no-Form-C-S/Lite conclusion for a company claiming foreign tax credit, Form C route and SGD 200,000 Lite threshold are supported by the supplied Form C-S evidence.

The final canonical Form C-S citation was independently verified. Final timing instead carries unrelated 17%/30 November metadata and does not anchor the requested YA2026.

Capture: [iras-e2e-captures.jsonl](iras-live-2026-09-26/iras-e2e-captures.jsonl). The assessment JSON contains the exact question, classification, authority, topic/source IDs, source fetches, evidence relevance, final answer and structured fields, citations, actual requested facts, dates, calculations and ten separate scores.
