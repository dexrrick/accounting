# Live Gemini run after downstream repairs — 09/10/2026

The authorized fresh nine-case diagnostic is complete. All nine Gemini requests returned HTTP 200 on their first attempt. Six cases passed every diagnostic stage; three failed downstream checks. There were zero retries, timeouts or HTTP errors. Mean response time was 2.073 seconds; the shortest first-request gap was 15.251 seconds.

Model: `gemini-3.5-flash-lite`. Execution started at 09:39:30 Singapore time on 09/10/2026. The one-shot output directory is consumed; do not relaunch into it.

## Case outcomes

| Case | Diagnostic result | Finding |
| --- | --- | --- |
| CPF relief entitlement | Passed | All stages passed; unresolved application facts remain guarded. |
| CPF relief amount | Passed | All stages passed; missing case facts remain unresolved. |
| CPF relief / employer contribution paraphrase | Passed | Expected partial employer-contribution coverage remains insufficient. |
| Private holiday expense | Failed | Only overall status failed: the requested tax issue has verified evidence, but the related label `travel expense` is topicless and produces `UNROUTED_MATERIAL_CONCEPT`. |
| Foreign dividend received | Passed | All stages passed, including bounded receipt identity and concept coverage. |
| Corporate residency general rule | Failed | Only overall status failed: the residency rule has verified evidence, but the related label `corporate tax` is topicless and produces `UNROUTED_MATERIAL_CONCEPT`. |
| Royalty withholding tax | Passed | All stages passed; registered source selection and payment-recipient scope passed. |
| GST input tax general rule | Passed | All stages passed. |
| Unsupported SFRS(I) 6 topic | Failed | Subject matching remains unresolved. The subject omits `mineral`, and display spelling `SFRS(I)` normalizes differently from the expected `sfrsi` marker. Individual dimensions match. The application remains safely insufficient with no coverage topic, sources, claims or retrieval. |

All nine responses passed schema/confidence validation. The unsupported-topic scorer failure does not establish a model contradiction: its dimension and application-stage failures follow the missing identity match. Its safe unsupported outcome was preserved. The two generic-label failures concern concept ownership rather than provider availability or failure to verify the requested issue.

## Integrity and limits

- Nine physical provider requests; zero retries and zero new official-source requests.
- All capture inventory lookups were healthy; zero blocked ambient network attempts were recorded.
- Historical capture/activation/consumed-run inputs were unchanged according to the launcher hashes.
- All thirteen additional code and prior-artifact hashes matched the supervisor's before/after manifest at `../live-downstream-execution-manifest.json`.
- Independent outcome review confirmed that all nine journal rows exactly match the summary and consumed case IDs, request diagnostics, hash records, and outcome counts.

This was a live Gemini diagnostic with retained official-source replay dated 08/10/2026. It is not canonical acceptance or a fresh official-source availability test. No production repairs, additional provider probes, or source requests were performed after this run.

## Evidence and next repair scope

`summary.json` contains the retained responses, stage verdicts, provider attempt diagnostics and source observations. `runner.partial.jsonl` contains all nine flushed case records. `consumed.json` records one-shot consumption.

Remaining repair candidates are bounded ownership of the two related descriptors and equivalent SFRS(I) acronym matching for the unsupported-topic scorer. Any follow-up should use these retained responses and preserve independent-request, accounting-population, direction, coverage and source-integrity controls; the run must not be relabeled as a pass.
