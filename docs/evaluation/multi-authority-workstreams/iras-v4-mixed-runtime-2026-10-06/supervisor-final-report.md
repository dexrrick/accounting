# Supervisor amount/mixed checkpoint — 06/10/2026

**Bounded implementation reviewed; full V4 remains HOLD.** Started clean `3431a22` on `codex/multi-authority-workstreams`. The full-harness review identified concrete completeness gaps; this cycle closes the missing governed amount/mixed controls and tightens expected CPF rejection scoring. No new production defect was established.

Only the V4 evaluator MJS, V4 regression MJS and this report directory change. Machine contract/questions/outcomes, production/source policy and protected historical artifacts remain unchanged. No live source/provider call, acceptance reservation, suite registration, permanent freeze, push, merge or deployment occurred.

## Observed behavior

| Controlled run | Rule/application/overall | Stage result |
| --- | --- | --- |
| CPF relief amount | IRAS VERIFIED / UNRESOLVED / CONDITIONAL | Actual routing/local/governed/application/full-stage checks pass. No user-specific relief amount is fabricated. |
| Mixed relief/employer contribution | IRAS VERIFIED; CPF INSUFFICIENT; both applications UNRESOLVED; overall INSUFFICIENT | All prospective stages pass because IRAS succeeds independently and the explicitly expected CPF rejection is proved. |
| Mixed mapped-page failure | IRAS and CPF INSUFFICIENT; applications UNRESOLVED; overall INSUFFICIENT | GOVERNED_RETRIEVAL is the earliest failure; the allowed overall label cannot hide the IRAS gap. |

The CPF retriever actually supplies five candidates. Three related reviewed records pass basic record eligibility; CPF_RATES_BY_AGE_2026 and CPF_SDL_SKILLS_DEVELOPMENT_LEVY are NEEDS_REVIEW and fail LOCAL_SOURCE_NOT_VERIFIED. The actual CPF issue admits none and returns zero sources/verified claims with CANDIDATE_REJECTED and NO_ADMITTED_EVIDENCE. The evaluator now requires the contribution-topic's registered rate record, so an unrelated SDL rejection cannot substitute. Mutations of actual observations reject wrong/missing flags, source/status/reason, unsupported admission/verification and absent rate evidence.

The amount/mixed adapter uniquely maps semantic owners to planned/actual issues, scores actual workstream routing, uses the existing nine-case observed local capability, and derives governed/application observations from runtime. Existing routing mocks now distinguish individual income-tax routing and assert supported routing verdicts.

Returned IRAS sources are the verified admitted subset. An unchanged through-call observer retains actual fetch-validation output; a labelled unique single-topic correlation binds source URL and actual title/content flags to the sanitized successful attempt. Missing or ambiguous proof fails closed. Quality replay uses that derived subset trace, which is neither original raw grounding metadata nor the complete initial admission inventory. Initial adapter failures exposed those observability limits, not a failed production amount rule. Scope and observation corrections preserve production gates and expectations.

The mixed failure requests exactly the mapped page (404), sitemap (200 empty) and robots (200). Every requested URL has an explicit synthetic response; no missing-fixture exception supplies the intended failure. Positive relief bytes reuse the earlier hash-bound synthetic fixture. New failure payloads have observed response hashes/provenance. Synthetic results establish architecture behavior, not current official content or complete statutory conditions.

## Validation and stopping boundary

Independent implementation review approves the bounded change; see `implementation-review.md`. Final focused Node 22 regression, targeted lint, scope/whitespace and protected-history results are recorded below when complete. Broad production build/smoke/full reruns are unnecessary for this isolated unregistered evaluator/test change.

Supervisor final capture passes the focused regression with the external-network blocking preload and saves the amount/mixed observations plus three failure-response hashes in `controlled-runtime-observations.json`. Targeted oxlint passes with only the existing unused `sha256` and `ROOT` warnings. Protected history passes all 389 rows /221 paths; scope and diff whitespace checks pass. Supervisor verifies the response hashes bind to supplied bytes. A final test-only strengthening keeps the forged CPF verification row labelled INSUFFICIENT, exercising the original label-masking failure directly; its final execution is recorded at closure. No production/evaluator implementation change follows review.

Closure: the builder's focused Node 22 regression passes after that last assertion strengthening. The supervisor inspects the exact mutation and unchanged INSUFFICIENT assertion, and final whitespace/scope checks pass. The saved runtime observations remain applicable: the last edit changes only a mutation assertion, not fixture bytes, adapter behavior or real run outputs. No functional edit follows the final passing test.

The full-stage output is evaluated in this API-free development context. Its default INTEGRITY=true is not a contemporaneous corpus/committed-checkout/live-preflight proof. The separately executed protected-history check is real, while full runner integrity remains a future requirement.

User requested a stopping point before five-hour remaining capacity reaches 5%, alongside the existing 2% weekly floor. Begin stopping preparation at 10% five-hour or 5% weekly. Initial remaining allowance was 41% /91%; implementation-review observation was 17% /87%. This cycle closes at the reviewed boundary rather than beginning another substantial task.

Final capture observation: 13% five-hour /86% weekly remaining. Checkpoint closing work begins at this point, preserving capacity above both user floors. The assistant consumes no reset and starts no further implementation family.

## Next step

Complete missing qualification/negative controls: a page missing private-expense qualifications, separate foreign payer/other-income and GST unregistered/private/output cases, and an actual verified-claim-but-uncovered runtime path. Connect remaining governed cases to full runtime stage scoring with appropriate trace observability rather than generalizing the bounded single-topic correlation silently. Then obtain full independent harness review before design freeze.

A separately bound contemporaneous official corpus and guarded capture/replay/live runner remain later prerequisites. Declared metadata helper checks do not prove actual corpus bytes, committed checkout/ancestry, budgets, expiry, strict response lookup or one-use execution integrity. No live acceptance approval follows from this checkpoint.
