# Phase 2 overall review and resumption checklist

**Status: NO-GO. Gemini paused.** Frozen application commit `4c782e53a6fcb3fdc9c0b9b517c59174f43e328f` on `codex/phase2-invoice-review-7b88385`. This checklist prepares a future acceptance run. Start it only after explicit authorization. No application changes, resets, merge or deployment are in scope.

## Review target

Review the application at `4c782e53a6fcb3fdc9c0b9b517c59174f43e328f` against `37f9d16b19a5877660e301fde2f4fdf06d5978ba`, including the complete five-commit diff and the evidence below. The application SHA is the acceptance target. This branch adds only this checklist. [Frozen application](https://github.com/dexrrick/accounting/commit/4c782e53a6fcb3fdc9c0b9b517c59174f43e328f) · [Application diff](https://github.com/dexrrick/accounting/compare/37f9d16b19a5877660e301fde2f4fdf06d5978ba...4c782e53a6fcb3fdc9c0b9b517c59174f43e328f)

- The frozen commit's focused invoice regression passed. It exercises the incompatible classification, newly stated cash payment, and subsequent compatible classification without proposing Trade Payables. The frozen statutory fixture replay also passed. [Invoice regressions](https://github.com/dexrrick/accounting/blob/4c782e53a6fcb3fdc9c0b9b517c59174f43e328f/tests/regression/test_vision_attachments.mjs) · [Statutory fixture regressions](https://github.com/dexrrick/accounting/blob/4c782e53a6fcb3fdc9c0b9b517c59174f43e328f/tests/regression/test_evidence_grounded_synthesis_pipeline.mjs)
- The 167 smoke suites, lint, and build passed on the preceding application revision `392d992`. The final one-line application change at `4c782e5` received focused offline verification.
- The live invoice run on `4c782e5` used three of 24 requests. Interpretation returned HTTP 200. Transaction understanding and its single delayed retry returned HTTP 503. The application showed an offline fallback with no journal. The first turn is ungraded and the four subsequent turns were never reached.
- The saved CPF FAQ had no usable article body. The IRAS date replay on `4c782e5` returned `HISTORICAL_SCOPE_UNVERIFIED` for the dated equipment purchase. The scripted MOM replay preserved both salary and overtime issues using the captured official sources. These are offline observations. The new raw captures and local logs remain in the workspace. [Previously published evidence](https://github.com/dexrrick/accounting/blob/93bf4afae66a928e9b2b36cf69f443de3d19e0a8/artifacts/phase2-live-acceptance-2b129dc/acceptance-report.md)

## Before the first request

- [ ] Verify that the GitHub branch points to the full frozen SHA and that local HEAD matches. Confirm the checkout is clean, including untracked files. Save both results.
- [ ] Check the shared five-hour and weekly Codex allowances against the project reserve and the user's 1% weekly floor. Check the shared Gemini ledger and coordinate with any other caller that uses the same quota.
- [ ] Use the existing metered Gemini harness and a fresh capture directory for each newly authorized batch. Preserve prior captures and the original attempt ledger. Use the recorded `gemini-3.5-flash-lite` model and the sequence in this checklist. The first pending invoice turn doubles as the provider availability check. [Earlier published execution plan](https://github.com/dexrrick/accounting/blob/93bf4afae66a928e9b2b36cf69f443de3d19e0a8/artifacts/phase2-live-acceptance-2b129dc/execution-plan.json)
- [ ] Cap each batch at **24 provider requests**, including **one delayed retry** in the entire batch for transient HTTP 503. Retain the harness's six-request turn cap and 5.1-second minimum pacing and retry delay. Stop on a material P1, persistent unavailability, quota exhaustion, or the applicable usage reserve. An interrupted batch stays stopped until renewed authorization.

## Invoice batch

Use the three clarification turns in sequence. Start separate conversations for the two digit-free requests. Use only the existing synthetic fixtures.

| Check | Turn and setup | Pass criteria |
| --- | --- | --- |
| [ ] | **`invoice-conflict-parent`**. Attach `invoice-simple.png`. “Please prepare the journal for this invoice. Classify it as a fixed asset, Office Equipment.” | The explicit classification conflicts with the invoice expense evidence. Ask for classification and display no journal. The previous turn was provider-interrupted and is ungraded. |
| [ ] | **`invoice-conflict-paid`**. Reply “Classify this as inventory for resale. It was paid in cash.” | Continue asking for account classification. Retain the explicit paid status against the same image and the S$500 image-derived total. Display no journal. The local clarification path uses zero provider requests. |
| [ ] | **`invoice-conflict-resolved`**. Reply “Classify this as Maintenance Expense.” | Resolve classification while preserving the existing cash-payment fact and S$500 image total. Withhold the contradictory Trade Payables proposal. The local clarification path uses zero provider requests. |
| [ ] | **`invoice-simple`**. Attach `invoice-simple.png`. “Please prepare the journal for this invoice.” | Use the verified S$500 image amount. Show a balanced, conditional, uncommitted proposal with a S$500 Maintenance Expense debit and S$500 Trade Payables credit qualified by the assumed unpaid status. Retain image provenance. |
| [ ] | **`invoice-with-gst`**. Attach `invoice-with-gst.png`. “Please prepare the journal for this invoice.” | Reconcile S$500 subtotal plus S$45 GST to S$545. Ask for missing recoverability information and withhold unsupported input GST and any journal that depends on it. |

The last four turns were never reached. [Non-GST fixture](https://github.com/dexrrick/accounting/blob/93bf4afae66a928e9b2b36cf69f443de3d19e0a8/artifacts/phase2-live-acceptance-2b129dc/invoice-simple.png) · [GST fixture](https://github.com/dexrrick/accounting/blob/93bf4afae66a928e9b2b36cf69f443de3d19e0a8/artifacts/phase2-live-acceptance-2b129dc/invoice-with-gst.png)

Preserve the earlier accepted invoice correction and ambiguity safeguards at their tested revisions.  · [Prior acceptance evidence](https://github.com/dexrrick/accounting/blob/93bf4afae66a928e9b2b36cf69f443de3d19e0a8/artifacts/phase2-live-acceptance-2b129dc/acceptance-report.md)

## Statutory batches

Use separate batches for CPF, IRAS and MOM. Where a follow-up needs a parent, preserve the original sequence and either use its verified captured state or replay it as setup. Apply the cap and stop rules to setup calls too.

| Check | Pending live criterion |
| --- | --- |
| [ ] **CPF resignation `embedded-resignation`** | Display an admitted CPF Board citation that supports the distinction between wages through the last day and employer compensation in lieu of notice. Support the pre-offset wage basis when the employee owes compensation and an offset is taken. Withhold a resignation journal while material facts are missing and preserve the prior payroll journal. The saved FAQ was an article shell and the alternate PDF did not cover all of these points. |
| [ ] **CPF payroll `payroll-parent` → `salary-correction`** | Render CPF Board citations for the age-band rate and Ordinary Wage ceiling applicable to the employee and payroll period. Preserve the accepted journals and explain why moving from S$10,000 to S$72,000 monthly salary leaves CPF payable at S$2,720 in this case. |
| [ ] **IRAS dated acquisition `complete-independent`** | Preserve the balanced S$1,200 equipment and Trade Payables journal. Render authority that supports capital allowance treatment for the applicable date and identify only material facts still needed. The offline date replay found no reviewed validity window. If the evidence remains unavailable, record the applicability gap and leave the live criterion open. |
| [ ] **IRAS second machine `second-purchase`** | Keep the S$100,000 purchase separate from the S$80,000 machine. Render verified IRAS authority for the qualifying business-use rule and state any remaining eligibility or write-off facts. |
| [ ] **IRAS disposal and replacement `conditional-purchase`** | Explain separately the old machine's potential balancing allowance or charge if capital allowances were previously claimed and the new machine's eligibility. Cite support for each and identify missing inputs before calculating a balancing amount. The last attempt was provider-interrupted and remains ungraded. |
| [ ] **MOM `mom-parent` → `mom-follow-up`** | Establish the covered comparison with official citations for the seven-day ordinary-salary and 14-day overtime deadlines. On the follow-up, retain and cite the ordinary-salary deadline for an employee still covered by the Employment Act, explain that the Part 4 overtime deadline does not apply, cite the employment-contract qualification and leave unknown contract terms unresolved. Both turns stay journal-free. Carry forward the prior covered comparison and use the parent turn for context as needed. |

[CPF resignation capture](https://github.com/dexrrick/accounting/blob/93bf4afae66a928e9b2b36cf69f443de3d19e0a8/artifacts/phase2-live-acceptance-2b129dc/priority/captures.json) · [CPF payroll capture](https://github.com/dexrrick/accounting/blob/93bf4afae66a928e9b2b36cf69f443de3d19e0a8/artifacts/phase2-live-acceptance-2b129dc/payroll/captures.json) · [Earlier published IRAS capture](https://github.com/dexrrick/accounting/blob/93bf4afae66a928e9b2b36cf69f443de3d19e0a8/artifacts/phase2-live-acceptance-2b129dc/iras/captures.json) · [MOM capture](https://github.com/dexrrick/accounting/blob/93bf4afae66a928e9b2b36cf69f443de3d19e0a8/artifacts/phase2-live-acceptance-2b129dc/mom/captures.json)

## Carry forward and close out

- [ ] Carry forward the accepted on-credit and cash equipment results, current/last journal recall, resignation journal safeguards, payroll journal and correction, and invoice correction safeguards. Keep share reset recorded as an offline pass. Retain prior MOM covered-deadline evidence while grading the outstanding follow-up. [Prior acceptance](https://github.com/dexrrick/accounting/blob/93bf4afae66a928e9b2b36cf69f443de3d19e0a8/artifacts/phase2-live-acceptance-2b129dc/acceptance-report.md) · [Cash retest](https://github.com/dexrrick/accounting/blob/93bf4afae66a928e9b2b36cf69f443de3d19e0a8/artifacts/phase2-live-acceptance-2b129dc/cash-final/captures.json)
- [ ] For each new turn, save the prompt, actual response, expected result, visible citations, journal state, reproduction path and provider attempt count. Record the stop reason. Distinguish application failures, provider interruptions and untested turns. A fallback after HTTP 503 carries no new live acceptance grade.
- [ ] Verify HEAD and checkout cleanliness again. Keep the recommendation **NO-GO** while a required live criterion remains open. Report GO only after the affected workflows pass and acceptance evidence supports it. Merge and deployment require separate approval.

## Independent review request

Confirm the application SHA you inspected. Review journal integrity and settlement continuity, statutory citation and applicability safeguards, and whether the evidence supports each acceptance status. Report actionable findings with severity, file and line references, impact, and suggested fixes. Flag evidence you could not verify. Keep the review read-only.
