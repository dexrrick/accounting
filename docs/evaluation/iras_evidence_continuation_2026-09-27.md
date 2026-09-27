# IRAS evidence hardening continuation — 27/09/2026

**Overall status: LIVE_FAIL.** The [20-case production capture](iras-live-2026-09-27/iras-e2e-captures-complete.jsonl) reruns all 19 reviewed IRAS questions and the mixed SGD 200 customer-meal case with real Gemini and official retrieval where the route required them. The [prior capture](iras-live-2026-09-26/iras-e2e-captures-complete.jsonl) remains unchanged. The fixture oracle is provisional; the matrix below is the supervisor's assessment of actual answers, not an automatic pass.

## Changes and independent review

- HTML cleaning now retains headings, paragraphs, sections, lists, table rows/cells and line breaks as distinct text boundaries. The excerpt selector prioritizes topic phrases and preserves source paragraph boundaries and gaps between disconnected selections. The strict whole-sentence/paragraph claim verifier was not relaxed.
- A reviewed local record explicitly bound through `sourceRecordIds` no longer needs a distinctive-word overlap to establish its topic association. It must still pass the normal status, lifecycle, review, freshness, date, domain, authority and grounding checks, and its full evidence-bearing payload must match the reviewed unified-registry record. The generic Section 14 rule now covers the rule-level deductibility question locally without a live fetch.
- The existing [IRAS Conditions for Claiming Input Tax page](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax) has an entertainment-expenses table row. The entertainment topic now requires its specific phrases together in one preserved page/excerpt block; generic input-tax text alone fails. The motor-vehicle topic no longer binds the generic blocked-input summary as if it were a complete motor rule, so its dedicated mapped page is fetched.

The builder implemented the scoped changes. The independent reviewer found two material risks during review: a substituted payload could borrow a bound registry ID, and entertainment terms could be scattered across unrelated sections. Both were fixed and tested. Its final review found no material finding remaining in the requested extraction, binding, topic validation, quote, URL-provenance or historical-scope areas. Two older synthetic meal-page fixtures were updated to include the entertainment section now required by production validation. No benchmark fixture question or provisional oracle was changed.

## Five previously failed cases

| Case | Prior capture | Current full capture | Assessment |
| --- | --- | --- | --- |
| Customer/supplier meals | Generic input-tax page was `TOPIC_MISMATCH`; no entertainment evidence | Same mapped page validated its entertainment row; four claims accepted, including conditional invoice and documentation passages | Improved to a useful conditional rule; facts still prevent a case-specific GST claim |
| Passenger-car input GST | Motor page fetched, but the quoted restriction failed whole-sentence verification | Motor page fetched; its complete Regulation 27 restriction and exception passage was accepted | Substantive conditional restriction now supported |
| Generic CIT expense | Generic live page fetched; no tax claim accepted | Reviewed local `ITA_SEC14_GENERAL_DEDUCTION` admitted; one statutory quotation accepted; no live fetch | Rule-level deduction test is stated; expense character and basis-period facts remain missing |
| IR21 | Detailed page fetched; quotation rejected | Detailed page and evidence admitted, but this full-run Gemini response had HTTP 200 with no candidate text; no final claim | Full-run answer remains failed. The preceding [focused IR21 run](iras-live-2026-09-27/focused-v2-employer-tax-clearance-ir21.jsonl) accepted one exact source claim, showing extraction can support it |
| Bonus timing | Two mapped pages fetched; quotation rejected | Both pages fetched; Gemini returned an empty `taxClaims` array | Answer remains failed; the missing contractual-entitlement and payment facts remain visible |

The focused regressions also showed that disconnected excerpts still cannot be combined into a fabricated quote. The full-run IR21 empty provider response was not retried because the bounded retry policy applies to transient provider errors, not an HTTP 200 empty candidate. No new deterministic application evaluator was added: the still-incomplete cases lack material facts, a usable generated claim, or both.

## Full live observations

The capture contains one metadata row and 20 distinct case rows. Five cases had successful Gemini answer generation, one had an empty HTTP 200 answer candidate recorded as `LIVE_FAIL`, and 14 followed local/deterministic routes without an answer-generation call. There were zero retries. The final evidence gates admitted 33 records (26 local, seven live) and returned two `LOCAL_SUFFICIENT`, 17 `LIMITED` and one `INSUFFICIENT`. Seven mapped fetches succeeded; no map attempt in this run failed topic or historical-scope validation. The gate accepted 28 source claims and rejected two. All 15 emitted Markdown URLs matched an admitted record with independently verified URL provenance. These counts show evidence admission and transport, not 20 complete answers.

The dated GST examples still calculate SGD 80 tax and SGD 1,080 invoice total for the 2023 SGD 1,000 supply, and SGD 90 tax and SGD 1,090 total for 2024. The mixed meal journal remains balanced at SGD 200 debit and SGD 200 credit; the GST claim is withheld because its mixed-context evidence remains insufficient. The existing Form C-S (Lite) and dated Section 13W application conclusions remain conditional.

### Ten-dimension assessment

`P` = supported pass; `L` = safe but incomplete or partly relevant; `F` = requested result absent or incorrect; `N` = not applicable or no fetch needed. Columns are classification (Cl), topic routing (Tp), selected-evidence precision (Sel), required retrieval (Ret), grounding (Gr), substantive answer (Ans), missing facts (Mf), effective dates (Dt), calculation/journal (Calc), and citation completeness/correctness (Cit). `Gr=P` includes safe abstention. `Cit=L` includes correctly suppressed unverified links where a useful authoritative citation is still unavailable.

| Case | Cl | Tp | Sel | Ret | Gr | Ans | Mf | Dt | Calc | Cit |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Customer/supplier meals | P | P | L | P | P | L | P | N | N | P |
| Passenger-car input GST | P | P | P | P | P | P | P | N | N | P |
| Overseas services | P | P | P | P | P | F | P | N | N | L |
| December 2022/January 2023 GST | P | P | P | N | P | L | P | P | N | L |
| Generic CIT expense | P | P | P | N | P | L | P | N | N | L |
| Immediate renovation deduction | P | P | P | N | P | L | P | N | N | P |
| Section 14N YA 2024 | P | P | P | N | P | L | P | P | N | P |
| Section 14N YA 2026 | P | P | P | N | P | L | P | P | N | P |
| CIT passenger car/allowances | P | P | P | N | P | L | P | N | N | L |
| Loss carry-forward | P | P | P | N | P | L | P | N | N | P |
| WHT interest | P | P | L | N | P | L | P | N | N | P |
| WHT management fees | P | P | L | N | P | L | P | N | N | P |
| IR21 | P | P | P | P | P | F | P | N | N | L |
| Bonus reporting | P | P | P | P | P | F | P | N | N | L |
| GST 2023 | P | P | P | N | P | P | P | P | P | L |
| GST 2024 | P | P | P | N | P | P | P | P | P | L |
| Section 13W before 2026 | P | P | P | N | P | L | P | P | N | L |
| Section 13W from 2026 | P | P | P | N | P | L | P | P | N | L |
| Form C-S (Lite)/FTC YA 2026 | P | P | P | N | P | P | P | P | N | P |
| Mixed customer-meal journal + GST | L | L | P | N | P | L | P | N | P | N |

The phase remains **LIVE_FAIL**. In particular, source retrieval and complete quotation preservation alone did not make the overseas-services, IR21, or bonus responses substantively complete. Other `L` rows present applicable rules while leaving eligibility or date facts unresolved. No model-generated official URL was accepted, and no historical rule was inferred from a current generic page.

## Validation

Focused HTML-boundary, source-map, evidence-gate, claim-verifier and routing tests passed. `npm run preflight`, `npm run lint`, `npm run build`, `npm run test:smoke`, `npm test`, and `git diff --check` passed with Node **v22.23.2**. Lint and Vite emitted non-fatal warnings. No CPF, MOM, ACRA or MAS content expansion was made. No commit or push was made.
