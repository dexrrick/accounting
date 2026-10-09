# Fresh Gemini rerun — 09/10/2026

All nine cases received HTTP 200 and structurally valid Gemini responses on their first attempt. There were **zero timeouts, zero HTTP errors and zero retries**. Five cases passed all diagnostic stages; four failed downstream checks. Mean response time was 1.95 seconds (range 1.55–2.24 seconds).

This is a live provider diagnostic with retained official-source replay, not canonical acceptance or a fresh official-source availability test. The source reference date remains 08/10/2026. There were nine physical Gemini requests and zero new source requests. Historical input hashes are unchanged, and no ambient network attempts were observed. The shortest recorded gap between case first requests was 15.253 seconds.

## Case outcomes

| Case | Result | Relevant finding |
| --- | --- | --- |
| CPF relief entitlement | Passed | Response and all stages passed. |
| CPF relief amount | Passed | Missing case facts remain unresolved as required. |
| CPF relief / employer contribution paraphrase | Passed | Previous CPF selection failure did not recur. Employer contribution evidence remains insufficient as expected. |
| Private holiday expense | Failed | Only `OVERALL_STATUS` failed; the requested issue has verified evidence, but generic concepts cause `UNROUTED_MATERIAL_CONCEPT`. |
| Foreign dividend received | Failed | Subject matching rejects the abbreviated label; generic corporate-income-tax concept also remains unrouted. The actual requested issue obtained verified evidence. |
| Corporate residency general rule | Passed | Response and all stages passed. |
| Royalty withholding tax | Failed | Subject guard rejects plural "non-resident companies"; source replay also attempted a URL outside the saved inventory. |
| GST input tax general rule | Failed | Subject label omits registration wording required by the scorer; the business-purchases concept also remains unrouted. The actual GST issue obtained verified evidence. |
| Unsupported SFRS(I) 6 topic | Passed | Correctly remains unsupported/unresolved; this is the expected negative-control behavior. |

All nine responses passed production schema/confidence validation. Six passed all five semantic acceptance gates. Three subject-scoring failures are marked `SCORING_UNRESOLVED`, with `modelError:false`; this does not prove that every model inference is correct, but it distinguishes unresolved scoring from an established material contradiction.

## Remaining causes and suggested repairs

1. **Subject labels carry too much of the scoring burden.** Foreign-dividend matching requires company/receipt direction in the subject string, although `population:COMPANY` and the supplied receipt fact are present elsewhere. GST matching requires registration in the label, although the question expressly identifies a GST-registered company. The withholding guard accepts singular company but rejects plural companies. Use bounded issue identity plus explicit structured scope and question-to-issue binding, accept equivalent singular/plural wording, and preserve negative controls for payment-versus-receipt, registered-versus-unregistered, and company-versus-individual cases. Do not infer missing facts.
2. **Generic concepts are treated as independent missing coverage.** Examples are "corporate income tax", "director benefits", and "business purchases". These can be descriptions or related context for an already mapped requested outcome. Bind supported descriptors to that issue, and require separate routing only for an independently requested material outcome. Retain the guard for genuinely unanswered issues.
3. **Withholding replay lacks the selected URL.** The attempted URL was `https://www.iras.gov.sg/taxes/withholding-tax/payments-to-non-resident-company`. The saved inventory includes the specific child payment page, overview and rates pages, but not this landing page. Investigate source selection and either use the appropriate captured specific source or create a new reviewed capture for a necessary landing page. Preserve the existing frozen capture and inventory checks. The reported source `PROVIDER_ERROR` here is a blocked replay lookup, not a Gemini API failure.

The present data points to strict text matching and concept routing, rather than a general lack of question information. Adding large source documents to the interpretation prompt is not supported by this run. Successful first attempts also mean this live run did not exercise retries; it confirms service availability at execution time, without proving which change caused recovery from the previous transient errors.

## Evidence and stopping point

- `summary.json`: fresh responses, stage verdicts, request timing, safe transport diagnostics and immutable-input hashes.
- `runner.partial.jsonl`: nine flushed per-case records; no cases remain pending.
- `consumed.json`: one-shot execution marker; do not relaunch into this directory.
- `failure-analysis.json`: API-free analysis of subject scoring, requested concepts, issue plans and source failures.
- Launcher preparation: four offline regressions passed, scoped lint passed with one unused test-seam parameter warning, and independent review found no remaining material issues after fixes.

The requested rerun is complete. No further provider calls or production changes were made to repair the four new failures. Those repairs are the next scoped implementation cycle.
