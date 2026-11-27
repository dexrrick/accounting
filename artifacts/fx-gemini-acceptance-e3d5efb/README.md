# FX and cancellation Gemini acceptance

**NO-GO for live acceptance. Dispatch is pending confirmation that other callers on the shared Gemini project are coordinated.**

GitHub branch `codex/review-fx-request-deadline-20261126` and the tracked-clean local worktree resolved to [`e3d5efb2ce918568b2dfbede7219e0be85a90fe6`](https://github.com/dexrrick/accounting/commit/e3d5efb2ce918568b2dfbede7219e0be85a90fe6). The test profile was SFRS(I) with `gemini-3.5-flash-lite` for live dispatch.

Gemini attempts were **0 of 24**. There are no live responses or live provider timings in this checkpoint. A local quota ledger covers instrumented calls on this machine. Project-wide caller usage was unavailable.

The harness called `processAccountingQuery` at the frozen revision and used the application’s journal state and recall helpers. It captured the service response and the chat preview. It exercised the service cancellation signal. The browser Stop button, hosted proxy and deployment were outside this live capture. The checked-in offline deadline suite also exercised the proxy with scripted transport.

| Workflow | Offline control | Live result | Gemini attempts | Service response time | Reply origin |
| --- | --- | --- | ---: | ---: | --- |
| Dated acquisition | PASS | Unrun | 0 | — | — |
| Dated acquisition and full disposal | PASS | Unrun | 0 | — | — |
| Missing acquisition date | PASS | Unrun | 0 | — | — |
| Missing disposal date | PASS | Unrun | 0 | — | — |
| Acquisition quote dated one day later | PASS | Unrun | 0 | — | — |
| Disposal quote dated one day later | PASS | Unrun | 0 | — | — |
| Follow-up with the matching disposal rate | PASS | Unrun | 0 | — | — |
| Cancel an in-flight request and recall the committed journal | Scripted abort regression | Unrun | 0 | — | — |

## Journal checks

- Acquisition on 13/11/2025 at SGD 1.30 per USD. USD 1,000 translated to SGD 1,300. Debit financial asset at FVTPL and credit cash.
- Full disposal on 15/12/2025 at SGD 1.31 per USD. USD 1,100 translated to SGD 1,441. Debit cash SGD 1,441. Credit the SGD 1,300 carrying amount and recognise total gains of SGD 141. The application breaks down the gain into SGD 131 of share appreciation and SGD 10 of FX movement.
- Missing or mismatched facts were checked for a targeted clarification, an empty current journal and preservation of the seeded committed journal. The follow-up was checked against both dated journals, including all account codes and amounts.

Translation basis and transaction date. [IAS 21, paragraphs 20–22](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2024/issued/part-a/ias-21-the-effects-of-changes-in-foreign-exchange-rates.pdf?bypass=on)

## Offline findings

- The checked-in FX missing-fact integrity and whole-request deadline/proxy regressions passed. All seven planned FX controls returned the expected deterministic responses and state.
- The harness’s scripted Gemini HTTP 503 control recorded one simulated dispatch and zero retries. It stopped before a second turn. This check used a fake credential and a separate quota ledger.
- An additional prompt phrased the complete disposal as “We sold all 300 shares” in a separate sentence and supplied an inline rate of 1.31. The app withheld the journal and asked for the spot rate. A separate mismatched-date wording probe safely withheld the journal but asked for the rate without explaining the date mismatch. Both are recorded as zero-provider-call observations.

The JSON contains the exact prompts and application replies, journal groups, timing, and provider attempt results where available. [Evidence capture](capture.json)
