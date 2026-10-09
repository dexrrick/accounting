# Supervisor controlled-transport checkpoint — 06/10/2026

**REVIEWED CHECKPOINT; four-family cycle complete.** This cycle starts at `69928fc` on `codex/multi-authority-workstreams` and implements the recommended four synthetic transport families. V4 full-harness/live acceptance remains on HOLD. These tests establish bounded behavior of existing production gates; they do not certify current official IRAS content or complete tax advice.

## Scope and observations

The functional change is confined to `tests/regression/test_iras_first_targeted_acceptance_v4.mjs`. It reuses the strict API-free transport and calls actual `buildAuthorityWorkstreams`, asserting retrieval, admission, verified claims, requested-concept coverage and application status. Seventeen new synthetic payloads carry family/polarity/URL/byte-length/SHA256 metadata; twenty payload hashes are checked including the three earlier controls. No production, evaluator, contract question/outcome, protected artifact or scorer changed. No live source acquisition, provider call, acceptance reservation, suite registration, permanent freeze, push, merge or deployment occurred.

| Family | Positive rule / application / overall | Paired failure |
| --- | --- | --- |
| Foreign-dividend receipt | VERIFIED / UNRESOLVED / CONDITIONAL | Domestic/payer-side page is retrieved successfully but fails admission; no verified claim; INSUFFICIENT / UNRESOLVED. |
| Corporate residency | VERIFIED / NOT_REQUIRED / VERIFIED | Individual-residency page returns TOPIC_MISMATCH; no candidate or verified claim; INSUFFICIENT / NOT_REQUIRED. |
| Royalty withholding tax | VERIFIED / NOT_REQUIRED / VERIFIED | Interest-only and missing-recipient-scope pages are admitted but do not verify the requested royalty scope; zero claims; INSUFFICIENT / NOT_REQUIRED. |
| General GST input-tax recovery | VERIFIED / NOT_REQUIRED / VERIFIED | Blocked-input-tax material is admitted but does not verify general affirmative recovery; zero claims; INSUFFICIENT / NOT_REQUIRED. One secondary-page attempt also returns TOPIC_MISMATCH. |

All four positive issue lifecycles are true through covered. Synthetic source trust remains NEEDS_REVIEW; rule verification does not rewrite source trust or resolve missing case-specific facts. The WHT fixtures do not establish rates or treaty eligibility. The foreign and GST summaries retain condition/exemption caveats but do not purport to enumerate every statutory condition.

The exact initial foreign fixture, failed candidate patch and observed TOPIC_MISMATCH remain in `tests/evaluation/singapore/iras-v4-foreign-transport-diagnostic-2026-10-06/`. Its HTML hashes were rechecked against the saved diagnostic. The corrected fixture coherently includes the registered foreign-income topic, received dividends and exemption conditions; no production gate or expected outcome was weakened. `pre-reset-diagnostic-report.md` records the interim stopping preparation and is superseded by this resumed result.

## Validation and review

Supervisor captured the actual four-family outputs and seventeen new fixture hashes in `controlled-runtime-observations.json`. The focused V4 Node 22 regression passed with the external-network blocking preload, including the source-binding helper. Builder's final run also passed after the nonempty-quote assertion was added. Supervisor inspected that exact final guard; no fixture body or observed outcome changed afterward. Targeted oxlint passed on final code with only the existing unused `sha256` and `ROOT` warnings. Protected history passes all 389 fingerprint rows /221 paths. Diff whitespace checks pass for active code and documents. The preserved `candidate.patch` triggers two trailing-space notices on its blank unified-diff context lines; its diagnostic bytes are intentionally retained.

Independent reviewer approved the bounded checkpoint and suggested direct claim-to-fixture binding. The implemented helper requires actual nonempty verified claims, a returned source record for each claim, the supplied family's source URL, literal normalized quotation in both the synthetic response and extracted source text, and unchanged NEEDS_REVIEW trust. Runtime provenance is LIVE_EXTERNAL because the production transport path labels it that way; the transport itself is explicitly synthetic and makes no external request. Reviewer delta confirmed binding and required the nonempty-quote guard, which the builder implemented and the supervisor verified. No unresolved bounded-scope review finding remains.

No broad build/smoke/full rerun is warranted for the isolated, deliberately unregistered test addition. Prior production validation is historical; it does not confer full V4 acceptance approval.

## Continuation boundary

The user reset the allowance during the initial stopping preparation and explicitly authorized continuation. The assistant performed no reset. Refreshed capacity was 98% weekly /87% five-hour remaining; latest closing-work observation is 92% weekly /49% five-hour remaining. The user's 2% weekly floor still applies. This cycle closes at its completed reviewable boundary. Begin stopping preparation at 5% weekly remaining and check account-wide capacity before another substantial cycle.

Next: perform an independent full V4 harness gap review against the prospective matrix, addressing any missing qualification/negative-path controls before design freeze. A separately bound contemporaneous official corpus and a real guarded live runner remain future prerequisites. The runner must validate actual corpus bytes, committed production/evaluator/source/schema/prompt fingerprints, ancestry, budgets, expiry, strict transport lookup and one-use reservation. Existing metadata helpers and synthetic fixtures do not establish those guarantees. Do not consume acceptance based on this checkpoint.
