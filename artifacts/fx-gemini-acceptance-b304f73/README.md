# FX live acceptance on b304f73

**NO-GO for clean live acceptance. The acquisition fix passed. The missing-disposal-date reply led with unrelated statutory compliance language.**

GitHub’s application review branch and the clean local application checkout resolved to [`b304f73e28cdc2b93348b7dc4bae10d1235ccf51`](https://github.com/dexrrick/accounting/commit/b304f73e28cdc2b93348b7dc4bae10d1235ccf51). The harness used SFRS(I), the public `processAccountingQuery` service, the app’s failure checks and the existing journal commit and recall helpers. It captured the service reply and chat preview. Browser UI and hosted proxy behavior were outside this run.

This run dispatched **15 attempts** with at most **2 per turn** and **zero retries**. Including the two prior attempts, usage was **17 of 24**. Intentional cancellation counts as an attempt once fetch is called. [Prior acceptance](https://github.com/dexrrick/accounting/blob/33ff00bc23f93f12157c88fd54231915dbb43636/artifacts/fx-gemini-acceptance-e3d5efb/README.md)

## Acquisition gate

The exact original acquisition returned in 6105 ms. The existing commit helper accepted a deterministic journal dated 13/11/2025, debiting the FVTPL asset (1210) and crediting cash (1010) for SGD 1,300 each. The scenario and committed state retained the rate of SGD 1.30 per USD, with the recorded source `Acquisition rate provided by user`. All acquisition gates passed without a statutory fallback.

## Acceptance matrix

| Workflow | Result | Gemini attempts | Service time | Reply origin |
| --- | --- | ---: | ---: | --- |
| Dated acquisition | PASS | 2 | 6105 ms | Deterministic response |
| Dated acquisition and full disposal | PASS | 2 | 10423 ms | Deterministic response |
| Missing acquisition date | PASS | 2 | 10072 ms | Deterministic response |
| Missing disposal date | Journal safeguards passed · reply quality failed | 2 | 10376 ms | Application response, no Gemini answer generation |
| Mismatched acquisition quote date | PASS | 2 | 9776 ms | Deterministic response |
| Mismatched disposal quote date | PASS | 2 | 10582 ms | Deterministic response |
| Follow-up with matching disposal rate | PASS | 2 | 9794 ms | Deterministic response |
| Cancel an in-flight request and retain the committed journal | PASS | 1 | 4507 ms | No completed response |

## Finding for independent review

The missing-disposal-date response correctly withheld the journal, kept the prior committed journal and asked for the missing disposal date. Before the clarification, it rendered a “Statutory Compliance & Legal Authority” section claiming an unresolved 2025 legal applicability limitation and discussing issue-plan gaps. The request was for journal entries. The reply reported no application failure status and the automated state checks passed, so the harness continued. The reply-quality failure was identified in post-run review of the capture. No further calls were made.

The full disposal dated 15/12/2025 used SGD 1.31 per USD. It debited cash SGD 1,441 and credited the asset SGD 1,300, share gain SGD 131 and FX gain SGD 10.

Both missing-date cases and both mismatched quote-date cases withheld the current journal, requested the relevant clarification and retained the earlier committed journal. The matching-rate follow-up completed and committed both dated journal groups.

Cancellation aborted the in-flight Gemini transport, rejected the service request with `AbortError`, started no later provider stage and preserved both prior committed groups on recall.

## Provider attempts

| Attempt | Turn | Stage | HTTP | Outcome | Provider time |
| ---: | --- | --- | ---: | --- | ---: |
| 1 | valid-acquisition | semantic-interpretation | 200 | SUCCESS | 2085 ms |
| 2 | valid-acquisition | event-extraction | 200 | SUCCESS | 718 ms |
| 3 | valid-disposal | semantic-interpretation | 200 | SUCCESS | 2394 ms |
| 4 | valid-disposal | event-extraction | 200 | SUCCESS | 896 ms |
| 5 | missing-acquisition-date | semantic-interpretation | 200 | SUCCESS | 2150 ms |
| 6 | missing-acquisition-date | event-extraction | 200 | SUCCESS | 937 ms |
| 7 | missing-disposal-date | semantic-interpretation | 200 | SUCCESS | 2061 ms |
| 8 | missing-disposal-date | event-extraction | 200 | SUCCESS | 1098 ms |
| 9 | mismatched-acquisition-rate-date | semantic-interpretation | 200 | SUCCESS | 2071 ms |
| 10 | mismatched-acquisition-rate-date | event-extraction | 200 | SUCCESS | 717 ms |
| 11 | mismatched-disposal-rate-date | semantic-interpretation | 200 | SUCCESS | 2058 ms |
| 12 | mismatched-disposal-rate-date | event-extraction | 200 | SUCCESS | 1077 ms |
| 13 | follow-up | semantic-interpretation | 200 | SUCCESS | 1697 ms |
| 14 | follow-up | event-extraction | 200 | SUCCESS | 642 ms |
| 15 | cancel-in-flight | semantic-interpretation | — | INTENTIONAL_CALLER_ABORT | 93 ms |

Service time includes pacing and application processing. The capture includes exact synthetic prompts, application replies, journal lines and statuses. Offline zero-provider controls for the seven FX turns are recorded separately in the same capture. [Acceptance capture](capture.json)
