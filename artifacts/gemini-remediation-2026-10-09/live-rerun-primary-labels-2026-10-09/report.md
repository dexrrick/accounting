# Live diagnostic after primary-label repairs — 09/10/2026

Nine case records completed: six diagnostic passes and three failures, with twelve provider dispatch attempts. This run is not a clean availability or acceptance result. Two connection attempts were blocked by the strict network guard; historical protected inputs remained unchanged.

- CPF/employer paraphrase: HTTP 503 followed by an 8-second retry timeout. No semantic response exists. Assessment is NOT_ASSESSED; false semantic-stage booleans must not be interpreted as invalid JSON or model contradiction.
- Royalty withholding: V4_PACING_GAP_NOT_MET prevented dispatch. No semantic response exists. Assessment is NOT_ASSESSED. The request-budget guard sleeps once for a fractional remaining interval and can wake just before its minimum; this is a harness scheduling problem, not missing accounting evidence.
- GST input tax: HTTP 503 recovered to HTTP 200 on retry. JSON and structured dimensions validate, but subject “general GST input tax claim rules” omits business-purchase wording required by the matcher/ownership guard. Original question and related concepts explicitly supply business purchases. Semantic identity/routing observation failures require bounded question-to-issue reconciliation, retaining primary evidence requirements.

Other cases passed, including safe missing-fact and unsupported-topic outcomes. Raw responses, request diagnostics and stage verdicts remain in summary.json and runner.partial.jsonl. There are seven retained responses and two unavailable cases; unavailable cases must never be counted as passing offline response replays.

Source captures remain referenced to 08/10/2026. No fresh official-source requests were made. This consumed directory is immutable; never relaunch into it or relabel the historical six-pass result after repairs. Network guard policy, provider attempt caps and source-integrity controls must remain enforced.
