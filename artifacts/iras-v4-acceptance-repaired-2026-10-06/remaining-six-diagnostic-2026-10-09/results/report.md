# Remaining six Gemini cases — 09/10/2026

All six remaining cases were run without stopping after a case failure: **5 failed, 1 passed, 0 not run**. Each case made one approved Gemini request. There were no retries, probes, or new official-source requests.

| Case | Result | Failure reason |
| --- | --- | --- |
| Private expense treatment | Failed | Replay request outside the approved inventory |
| Foreign dividend receipt treatment | Failed | Replay request outside the approved inventory |
| Corporate residency general rule | Failed | Gemini provider timeout at the configured 8-second deadline |
| Withholding tax on royalties | Failed | Replay request outside the approved inventory |
| GST input tax general rule | Failed | Replay request outside the approved inventory |
| Unsupported SFRS(I) 6 exploration and evaluation | Passed | — |

The four inventory failures have code `V4_REPLAY_REQUEST_OUTSIDE_APPROVED_INVENTORY`; the timeout has code `V4_PROVIDER_TIMEOUT`. Exact blocked URLs and retained responses are in `summary.json` and `remaining-six.partial.jsonl`.

| Scope | Passed | Failed | Not run |
| --- | ---: | ---: | ---: |
| Original three-case attempt | 2 | 1 | 6 |
| Remaining six-case diagnostic | 1 | 5 | 0 |
| Combined observations across the two runs | **3** | **6** | **0** |

The combined count covers all nine case IDs across two runs. This is a diagnostic continuation; canonical nine-case acceptance remains unproven. The original consumed attempt and its retained evidence are unchanged.

Independent outcome review confirmed the journal, per-case call counts, summary, gate bindings, and consumption status. Zero extra requests are supported by the reviewed guards and retained artifacts; the artifacts are not independent network telemetry.

The launcher passed 10 targeted offline tests and syntax checks before execution. Scoped lint exited zero with one warning concerning error propagation during network-guard cleanup. No production accounting code was changed.
