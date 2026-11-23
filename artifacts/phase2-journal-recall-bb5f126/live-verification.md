# Journal-recall live verification

**Journal-recall blocker CLOSED.** The targeted live verification passed. Overall Phase 2 remains **NO-GO** pending the other acceptance items.

23 November 2026, Singapore time. Verified the local and GitHub revision at bb5f12635350cbd08c6b3e502c32b4641cc6893a.

| Turn | Observed response | Gemini attempts |
| --- | --- | ---: |
| Hypothetical SGD 1,200 equipment purchase on credit | “Journal Not Prepared.” The response reported that a validated journal was unavailable and withheld an unsupported statutory conclusion. The journal table was empty. | 4 |
| “show the double entry” | “Journal Not Prepared” for the current request. The journal table stayed empty and did not show historical payroll. | 0 |
| “show last journal” | Retrieved the historical committed payroll journal. The displayed journal matched the saved fixture and balanced. | 0 |

The historical committed journal matched the saved fixture after every turn. The hypothetical equipment entry was never committed. No P1 or provider outage occurred.

Attempts 22–25 all returned HTTP 200 and Gemini finish reason STOP, with 6684 provider-reported input tokens and zero retries. The run reached the cumulative cap of 25. Only the synthetic equipment turn contacted Gemini. Both payroll recall turns ran locally.

No raw JSON appeared in chat. The earlier truncation condition did not recur. The separate P2 concern about historical committed groups already attached to an incomplete current request remains unverified because this replay starts the equipment turn with a fresh active scenario and retains payroll locally for recall.

The published evidence omits payroll figures and line items. The verification compared the displayed and retained journals against the complete local fixture.

No application code changes, merge, or deployment occurred.

[Recorded responses and journal checks](verification-results.json) · [Gemini attempt and usage log](gemini-attempts.jsonl)
