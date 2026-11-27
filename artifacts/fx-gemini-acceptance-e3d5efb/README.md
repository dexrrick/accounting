# FX and cancellation Gemini acceptance

**NO-GO for live acceptance. A journal-only acquisition returned an unrelated statutory-evidence fallback and did not commit its correctly calculated journal.**

GitHub branch `codex/review-fx-request-deadline-20261126` and the tracked-clean local worktree resolved to [`e3d5efb2ce918568b2dfbede7219e0be85a90fe6`](https://github.com/dexrrick/accounting/commit/e3d5efb2ce918568b2dfbede7219e0be85a90fe6). The test profile was SFRS(I) with `gemini-3.5-flash-lite` for live dispatch.

The shared-project coordination was confirmed before dispatch. The batch used **2 of 24** Gemini attempts, with a highest per-turn count of **2 of 4** and **zero retries**.

The harness called `processAccountingQuery` at the frozen revision and captured the service reply and chat preview. It applied the app’s commit guard to the captured response. Browser rendering, the Stop button, the hosted proxy and deployment were outside the live capture. The checked-in offline deadline suite exercised the service cancellation signal and proxy with scripted transport.

| Workflow | Offline control | Live result | Gemini attempts | Service response time | Reply origin |
| --- | --- | --- | ---: | ---: | --- |
| Dated acquisition | PASS | FAIL · stopped | 2 | 6207 ms | Deterministic fallback |
| Dated acquisition and full disposal | PASS | Unrun | 0 | — | — |
| Missing acquisition date | PASS | Unrun | 0 | — | — |
| Missing disposal date | PASS | Unrun | 0 | — | — |
| Acquisition quote dated one day later | PASS | Unrun | 0 | — | — |
| Disposal quote dated one day later | PASS | Unrun | 0 | — | — |
| Follow-up with the matching disposal rate | PASS | Unrun | 0 | — | — |
| Cancel an in-flight request and recall the committed journal | Scripted abort regression | Unrun | 0 | — | — |

## Live stop and review focus

| Attempt | Provider stage | HTTP | Provider response time |
| ---: | --- | ---: | ---: |
| 1 | semantic-interpretation | 200 | 2080 ms |
| 2 | event-extraction | 200 | 885 ms |

Both calls completed with Gemini finish reason `STOP`. The app made no answer-generation call. It returned `AI_GROUNDED_SYNTHESIS_FALLBACK` with `advisoryFailureStatus = OTHER`. The harness stopped at that first application failure signal under its conservative stop rule and recorded `APPLICATION_REPORTED_PROVIDER_FAILURE`. The transport record contains no upstream HTTP or transport failure.

The exact application reply is reproduced below.

```text
### Statutory evidence unresolved

The available evidence did not support a verified answer to the statutory question.

The deterministic journal remains available in the Double Entry Journal tab.
```

The response retained a balanced SGD 1,300 acquisition journal candidate, dated 13/11/2025 at 1.30, with a debit to the FVTPL asset and a credit to cash. The app’s failure branch bypasses the journal commit and displays the failure message. There was no prior journal on this first turn. The service capture does not establish what the browser showed.

Review the acquisition’s transition from the deterministic journal to the statutory fallback and the subsequent commit gate. [Synthesis decision](https://github.com/dexrrick/accounting/blob/e3d5efb2ce918568b2dfbede7219e0be85a90fe6/src/services/geminiService.ts#L600-L621) · [App commit gate](https://github.com/dexrrick/accounting/blob/e3d5efb2ce918568b2dfbede7219e0be85a90fe6/src/App.tsx#L173-L207)

The seven remaining live turns were unrun, including live cancellation and preservation. Their offline controls are recorded below.

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
