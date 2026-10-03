# GST public selection V3 — consumed, failed inspection

HOLD MERGE. Reviewed harness commit `56629bb`; preregistration commit `61b25ed`; envelope SHA256 `72e124b3455d88db65acbdd45fc042db9a0617c39f6c57a650526edc28415331`. This version is permanently consumed and must never be rerun or overwritten.

One invocation of the live-source command terminated with process exit 1 and the fixed output `{"status":"FAILED","code":"PAGE_CHARACTER_LIMIT"}`. The consumed marker records reservation at `2026-10-03T07:43:08.992Z`, before transport by reviewed code. No diagnostic report was created. No raw HTML, cleaned excerpts or private/model payload from this invocation were saved.

Independent failed-state audit found no material integrity findings. Envelope and plan-file hashes agree with the marker. All 237 fingerprints match disk: 31 current and 206 historical, including all 197 frozen V8 historical entries. This verifies artifact integrity only; there is no saved transport snapshot to audit.

The preregistered transport allows only the canonical GST input-tax page, at most two actual GETs including one same-path IRAS peer-host redirect, ten-second fetch timeout and zero retries. Other mapped adapters are closed synthetic 503s. The failure occurred in page inspection before context/render/workstream execution. The snapshot was not persisted, so exact actual GET count, HTTP statuses, redirect/cache counts and response lengths are **unavailable**. Do not turn the configured bounds into measured counters or assume HTTP 200.

The harness applies the same 200,000-character limit to raw HTML and cleaned visible text. Both failure paths produce the same code. This differs from the reused public V1 selector's cleaned-page bound and prevents identifying the exact stage from this output. The absence of a permanent failure report is a telemetry defect in this diagnostic, not proof of an accounting-rule or claim-verifier defect. The supervisor missed this distinction in preregistration review.

Future work must use a separate prospective version. First prove the raw/clean distinction API-free with large synthetic HTML and bounded clean prose; define separate bounded limits without weakening cleaned-unit, source-membership, privacy or literal safeguards; ensure early failures persist a safe transport snapshot and explicit failure stage. Independently review before preregistration or any new GET. Do not change consumed V3 to recover data or reconstruct discarded response wording.

Current validated production remains `68cac9c1d3cf96c9cf99bb51d80cd4854a36f350`. Audited V8 has four VERIFIED rule-evidence families; GST remains INSUFFICIENT. V3 supplies no new retained-opening or selection result. Targeted acceptance and the final profile remain NOT RUN. All prior source captures, public excerpts and profiles are preserved.
