# Acceptance for f651e2a

**NO-GO.** The offline gate passed, but the live run stopped on Gemini HTTP 503 during transaction-fact extraction for the equity investment. The run made three attempts and zero retries. Equity had two successful upstream responses and did not produce a validated journal. No product correctness verdict was reached on the live cases.

The application checkout and tracked source matched [f651e2a91ee8a1344997e5bfa954b2a7f9c094bc](https://github.com/dexrrick/accounting/commit/f651e2a91ee8a1344997e5bfa954b2a7f9c094bc). The run used `gemini-3.5-flash-lite` with caps of 16 attempts overall and four per turn. It stopped on the first provider error. The local shared project guard used the configured 15 requests/minute, 250,000 input tokens/minute and 500 requests/Pacific day limits. This is local ledger enforcement, and its records cannot establish project-wide usage from other clients. [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)

## Offline evidence

- Six focused workflow cases passed. They cover same-transaction carry-forward, unsolicited claim removal with journal preservation, an accounting-only journal paraphrase, and a deterministic journal retained after statutory synthesis rejects a claim.
- All 190 regression suites passed. Lint and build passed with warnings.
- See [offline workflow results](offline-results.json), [offline workflow log](offline-workflow.log), and the [full regression summary](offline-suite-summary.txt).

## Live evidence

| Turn | Attempts | Result |
| --- | ---: | --- |
| SGD 500,000 equity investment | 3 | Stopped on HTTP 503. The final response was the unsupported-transaction offline fallback with no journal. |
| SGD 200,000 intercompany loan | 0 | Unrun. |
| Same-transaction loan journal follow-up | 0 | Unrun. |
| GST registration at SGD 1.2 million taxable turnover | 0 | Unrun. |

The live run did not establish journal accuracy, authority labels, proposal isolation, clarifications, or statutory evidence completeness. For the planned GST test, the benchmark was IRAS guidance on retrospective and prospective registration and their qualifications. [IRAS GST registration](https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/gst-registration-deregistration/do-i-need-to-register-for-gst)

See the [frozen prompts and limits](run-plan.json), [per-attempt log](attempts.jsonl), and [captured live response](live-results.json). The evidence-only branch leaves the implementation commit as its parent.
