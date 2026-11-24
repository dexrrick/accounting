# Phase 2 headless acceptance harness

This harness is pinned to `d1f9be1f46c780acfb01591f0f527e87cbd133a9`. It uses the original eight cases and supplemental MOM follow-up copied unchanged from the offline preparation packet. The MOM follow-up requires a successful same-revision parent capture. No captures or credentials are included.

Run the offline behavioral check from this directory with Node 22:

```powershell
& 'D:\Accounting\.tmp\canonical-node22\node.exe' --test '.\offline-behavior.test.mjs'
```

The live wrapper has no authorization by default. Only after separate authorization, provide `GEMINI_API_KEY` in the process environment and invoke `.\run-acceptance.ps1 -AuthorizeLive`. It does not load credential files. Pass `-ExpectedHead <40-character-commit>` when the clean source checkout is intentionally pinned to another reviewed revision; otherwise the saved expected head is required.

The wrapper allows at most 24 model attempts total and 4 per case, with no automatic retries or budget top-up. This ceiling may not cover all nine cases. It reserves each case's cap before launch, refuses an existing ledger or capture, and leaves a crashed reservation consumed for inspection. Provider, pacing, cap, application, or capture failures stop the batch; continue only after review and separate authorization. Successful captures remain answer-review pending. The wrapper waits 65 seconds between cases; the runner retains 5,100 ms minimum model-request spacing and its existing 150-second case timeout.