# IRAS post-hardening live validation — 26/09/2026

**Continuation:** A subsequent [final IRAS hardening assessment](iras_evidence_completion_2026-09-26.md) supersedes the case results below with a new 20-case real Gemini/IRAS capture. This document preserves the earlier run and its original limitations.

**Overall: LIVE_FAIL. The IRAS E2E phase remains incomplete.** The original reviewed 19-case benchmark and a separate mixed customer-lunch question were run through `processAccountingQuery` with the existing Gemini provider (`gemini-3.5-flash-lite`) and real controlled official retrieval. The [sanitized capture](iras-evidence-hardening-2026-09-26/live-final-captures.jsonl) records the questions, classification, topic and source-map selections, actual fetches, redirects, canonical URLs, excerpts, provider candidate, final answer, citations, missing facts, dates, journals and per-request gate diagnostics. The original [LIVE_FAIL assessment](iras_live_validation_2026-09-26.md) is unchanged. No key or request headers were captured.

The capture precedes the final two localized corrections to generic missing-fact prompts and mixed-answer clause preservation. Those corrections were verified by the full offline suite and by replaying the captured Gemini lunch candidate through the corrected post-processor; they were **not** presented as a new complete live run. There were no synthetic provider responses or synthetic IRAS pages in the live capture.

Across the 20 requests, five benchmark cases and the mixed lunch case received a real Gemini answer. Four benchmark provider calls timed out (`BLOCKED_BY_PROVIDER`); ten requests appropriately avoided Gemini through local-first or insufficient-evidence paths. No timeout was converted into a pass or retried in this run. The controlled retriever made 42 HTTP requests, including robots requests; 26 IRAS content responses returned HTTP 200 across 15 distinct URLs, and the other requests returned 403 or 404 for robots resources. There were no redirects. Topic validation recorded 16 `SUCCESS`, 12 `TOPIC_MISMATCH` and two `HISTORICAL_SCOPE_UNVERIFIED` attempts. HTTP 200 alone never counted as relevant retrieved evidence.

The final grounding contexts admitted 22 records across all requests: 13 `RELEVANT`, nine `PARTIALLY_RELEVANT`, and **zero `IRRELEVANT`** using the original human labels for identical selected record IDs. This fixes the earlier unrelated-source padding in the supplied context; it does not prove full evidence coverage. The gates returned two `LOCAL_SUFFICIENT`, 11 `LIMITED` and seven `INSUFFICIENT` statuses. A missing required topic, unreviewed local record or undated current-page historical scope still blocks or limits many cases. Source ranking and admission are now precise on these captures, but the source map still fails to yield usable car, loss, IR21, bonus-timing and some date-specific evidence.

The final answers emitted 17 Markdown citation occurrences, all matching canonical URLs of records actually supplied to the answer path. Claim verification accepted 15 complete source quotes and rejected one incomplete quotation; accepted quotations prove their text and citation identity, **not** that their conditions are met by the user's facts. Gemini's five benchmark generations produced very few accepted tax claims, and the remaining answers mostly abstained or showed source passages. The two dated standard-rated GST examples used reviewed local Section 16 evidence, performed deterministic cent-accurate calculations (SGD 80/1,080 for 2023 and SGD 90/1,090 for 2024), cited the recorded local canonical sources and avoided a provider call. They pass their applicable local-first dimensions.

The mixed customer-lunch request received a real Gemini candidate and retained a balanced SGD 200 expense/payment journal while withholding a GST claim and listing unresolved GST facts. In the captured candidate, valid accounting discussion and a cash/bank payment were mixed with conditional GST wording and an ambiguous payable account label. Replaying that **same real candidate** through the corrected post-processor preserved the operating-expense discussion and the SGD 200 debit/credit journal, removed the GST-dependent clause and the payable alternative, and made no provider call. An offline regression also injects an unconditional GST claim to verify sentence/field-level correction.

## Independent dimension assessment

P = `LIVE_PASS`; F = `LIVE_FAIL`; N = `NOT_EVALUATED`; S = `BLOCKED_BY_SOURCE`; B = `BLOCKED_BY_PROVIDER`. Columns: Cl classification, Tp topic routing, Sel precision of selected evidence, Ret required official retrieval, Gr final tax grounding, Ans requested substantive conclusion, Mf missing-fact handling, Dt effective-date handling, Calc arithmetic, Cit final citation correctness. `Sel=P` means no unnecessary or irrelevant record was admitted; `Ret=S` can still mean a required topic was unavailable. `Gr=P` includes safe abstention, **not** a substantive answer. `Cit=N` means no tax citation was emitted because no sourced substantive claim survived. Date and calculation are N where the question did not call for them. B is used only for answer generation interrupted by the provider; the fallback is assessed separately for grounding and citations.

| Reviewed case | Cl | Tp | Sel | Ret | Gr | Ans | Mf | Dt | Calc | Cit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GST customer/supplier meals | P | P | P | S | P | F | P | N | N | N |
| Passenger-car input GST | P | P | S | S | P | F | F | N | N | N |
| Overseas services | P | P | P | P | P | B | P | N | N | P |
| December 2022/January 2023 GST | P | P | P | N | P | F | P | P | N | P |
| Generic CIT expense | P | P | P | P | P | B | F | N | N | P |
| Immediate R&R | P | P | P | P | P | F | P | N | N | N |
| Section 14N YA 2024 | P | P | P | N | P | F | P | P | N | P |
| Section 14N YA 2026 | P | P | S | S | P | F | F | P | N | N |
| CIT passenger car/allowances | P | P | P | S | P | F | F | N | N | N |
| Loss carry-forward | P | P | S | S | P | F | F | N | N | N |
| WHT interest | P | P | P | S | P | B | P | N | N | P |
| WHT management fees | P | P | P | S | P | B | P | N | N | P |
| IR21 | P | P | S | S | P | F | P | N | N | N |
| Bonus reporting | P | P | P | S | P | F | P | N | N | N |
| GST 2023 | P | P | P | N | P | P | P | P | P | P |
| GST 2024 | P | P | P | N | P | P | P | P | P | P |
| Section 13W before 2026 | P | P | P | N | P | F | P | P | N | P |
| Section 13W from 2026 | F | F | S | S | P | F | P | P | N | N |
| Form C-S (Lite)/FTC YA 2026 | P | P | S | S | P | F | P | P | N | N |

The provider-blocked cases also have incomplete source or fact coverage, so their **overall benchmark outcome is not a pass**. Two GST-rate cases pass their applicable local path; the other 17 reviewed cases remain `LIVE_FAIL` or provider-blocked on answer generation, and the 19-case phase remains `LIVE_FAIL`. The remaining gaps require better official source-map/topic validation and independently verified historical-period content. The conservative exact-quote interface cannot validate arbitrary case applications, so a correct paragraph-level quote alone must not upgrade a case to `LIVE_PASS`.

After this capture, generic guards were added for service/customer/category facts, Section 13W holding/share/exclusion facts, Form C-S (Lite) eligibility, Section 14N commencement, loss type and utilization, vehicle ownership and generic expense period. These improve missing-fact prompts without hard-coding benchmark answers. The full offline suite, smoke suite, lint and build pass. A fresh full live benchmark against those last changes remains necessary before changing the phase verdict.
