# IRAS evidence hardening: final continuation — 26/09/2026

**Overall status: LIVE_FAIL.** All 19 IRAS benchmark questions and the mixed customer-meal journal question were rerun through the production pipeline. Real Gemini requests and controlled IRAS retrieval were made where each case's path required them. The [sanitized 20-case capture](iras-live-2026-09-26/iras-e2e-captures-complete.jsonl) is the final run. It contains the classification, selected records, source-map attempts, actual fetches, provider attempts, final answer, citations, missing facts, dates, calculations and journal lines for each case. The fixture's provisional oracle and earlier reports remain separate; a safe abstention is not scored as a substantive answer.

## Implementation and independent review

- Reviewed local IRAS editorial summaries retain `VERIFIED` content status only with explicit review metadata. Their content status, nonverbatim type and separately verified URL relationship are preserved through the unified registry. They render as **reviewed local editorial summaries**, never as verbatim IRAS block quotes. A mapped URL is labeled as related guidance and is omitted if its own provenance is unverified.
- Topic-to-record bindings now cover the dated Section 14N and 13W versions, losses, withholding tax, Form C-S and GST registration. The mapped motor-vehicle, IR21 and bonus pages use their specific official IRAS paths. A mapped pointer remains a route to evidence, not evidence itself. The final live run recorded eight successful mapped fetches, one `TOPIC_MISMATCH` and one `HISTORICAL_SCOPE_UNVERIFIED`; no HTTP success was counted as claim support without topic validation.
- The evidence gate and claim verifier surface exact rejection codes, including date-scope, unreviewed local content, unverified URL, incomplete quote and unresolved Section 14N basis-period cases. Disconnected live-page sentence windows now remain separate fragments, so a fabricated quote across them is rejected.
- The Section 13W resolver uses a stated disposal date/year rather than an acquisition date/year, and leaves an unbound YA unresolved. Section 14N classification, retrieval and gate admission share a basis-period guard; a stated 31 December 2024 FYE supports YA 2025 selection, while an unexplained 2024 cost date does not. Tax-only Section 13W queries no longer acquire incidental accounting/ACRA topics.
- Deterministic application conclusions now cover the conditional YA 2026 Form C-S (Lite) foreign-tax-credit exclusion and the relevant dated Section 13W regime, only when the corresponding local record was admitted. Other missing eligibility facts remain visible. The live harness permits one retry only after a genuine transient Gemini failure and records every attempt; this run needed no retries.

The independent reviewer checked source content, mapped IRAS URLs, retrieval behavior and the final fixes. Findings on a supplied 14N FYE, editorial-summary quotation, year-only 13W disposal routing and disconnected live excerpts were addressed and retested. Its last narrow re-review found no remaining material date-routing issue. The reviewer could not run Node/tsx locally because its sandbox returned `uv_os_get_passwd ENOMEM`; the supervisor ran the focused and full checks below.

## Final live observations

The capture has 20 cases: nine successful Gemini answer generations, eleven deliberate paths without an answer-generation call, zero provider blocks and zero retries. The final gates admitted 31 records (23 local and eight live) and returned two `LOCAL_SUFFICIENT`, 17 `LIMITED` and one `INSUFFICIENT`. Ten mapped source attempts produced eight `SUCCESS`, one `TOPIC_MISMATCH` (generic input-tax guidance did not substantiate customer meals) and one `HISTORICAL_SCOPE_UNVERIFIED` (a current generic expense page could not prove a YA 2024 rule). The 12 emitted Markdown URLs each matched an admitted record with separately verified URL provenance. These counts measure evidence admission and transport, not complete answers.

The two fully specified, standard-rated GST examples calculated SGD 80 on SGD 1,000 for 2023 and SGD 90 for 2024, with invoice totals of SGD 1,080 and SGD 1,090. The mixed customer-meal response retained a balanced SGD 200 expense/payment journal and withheld the unresolved GST claim. The Form C-S (Lite) case now gives a conditional Form C route when the company claims a foreign tax credit; Section 13W from 2026 now gives a conditional dated-regime conclusion. Those application conclusions do not prove all other eligibility conditions.

### Ten-dimension case assessment

This is the supervisor's assessment against each fixture's provisional oracle, not an automatic test result. `P` = supported pass; `L` = safe but incomplete/partly relevant; `F` = requested result absent or incorrect; `S` = required source blocked; `N` = not applicable or no live fetch needed. Columns are classification (Cl), topic routing (Tp), selected-evidence precision (Sel), required retrieval (Ret), final grounding (Gr), substantive answer (Ans), missing-fact handling (Mf), effective-date handling (Dt), calculation/journal (Calc), and citation completeness/correctness (Cit). `Gr=P` can mean a safe abstention. `Cit=L` includes correctly suppressed unverified links where a useful authoritative citation is still unavailable.

| Case | Cl | Tp | Sel | Ret | Gr | Ans | Mf | Dt | Calc | Cit |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Customer/supplier meals | P | P | L | S | P | F | P | N | N | L |
| Passenger-car input GST | P | P | P | P | P | F | P | N | N | N |
| Overseas services | P | P | P | P | P | L | P | N | N | P |
| December 2022/January 2023 GST | P | P | P | N | P | L | P | P | N | L |
| Generic CIT expense | P | P | P | P | P | F | P | N | N | N |
| Immediate renovation deduction | P | P | P | P | P | L | P | N | N | P |
| Section 14N YA 2024 | P | P | L | S | P | L | P | P | N | P |
| Section 14N YA 2026 | P | P | P | N | P | L | P | P | N | P |
| CIT passenger car/allowances | P | P | P | N | P | L | P | N | N | L |
| Loss carry-forward | P | P | P | N | P | L | P | N | N | P |
| WHT interest | P | P | L | N | P | L | P | N | N | P |
| WHT management fees | P | P | L | N | P | L | P | N | N | P |
| IR21 | P | P | P | P | P | F | P | N | N | N |
| Bonus reporting | P | P | P | P | P | F | P | N | N | N |
| GST 2023 | P | P | P | N | P | P | P | P | P | L |
| GST 2024 | P | P | P | N | P | P | P | P | P | L |
| Section 13W before 2026 | P | P | P | N | P | L | P | P | N | L |
| Section 13W from 2026 | P | P | P | N | P | L | P | P | N | L |
| Form C-S (Lite)/FTC YA 2026 | P | P | P | N | P | P | P | P | N | P |
| Mixed customer-meal journal + GST | L | L | P | N | P | L | P | N | P | N |

The main remaining answer gaps are customer-meal input GST, the passenger-car restriction, generic deductibility, IR21 and bonus timing: the fetched evidence or generated claim did not yield a fully verified conditional answer. Other rows marked `L` present relevant rules and facts still needed but do not complete the requested application. Section 13W's PDF URL is deliberately not linked without independent PDF URL provenance. The historical GST rate records are used for arithmetic but their unverified public URLs are not exposed. The overall 19-case phase therefore stays **LIVE_FAIL** despite the passing arithmetic and Form C-S application cases.

## Validation and limits

Focused IRAS source-map, date, evidence-gate, claim, application, routing and statutory-engine regressions passed. `oxlint`, `tsc -b`, Vite build, smoke suite, full suite and `git diff --check` passed using the available bundled Node **v24.19.0** runtime. Vite and lint emitted non-fatal warnings. `scripts/preflight.mjs` rejected that runtime because this repository requires Node **22.x**. A Node 22 executable was not available on this host, so the checks cannot be represented as passing the repository's Node 22 preflight. The live benchmark itself completed with the bundled runtime.

No CPF, MOM, ACRA or MAS source content was expanded for this IRAS task. No commit or push was made.
