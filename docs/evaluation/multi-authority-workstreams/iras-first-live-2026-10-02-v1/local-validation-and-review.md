# Frozen local validation and independent review

Date: 02/10/2026. Branch: `codex/multi-authority-workstreams`.

Reviewed implementation commit: `c8f6466556c257f5c2ca3786df4dfe3490cb337d`. Baseline evidence commit: `d194d2bc7121b2c9a1deec562f77eafdfb98cd90`. Earlier structured-output implementation: `35118fb00e2f1fe35e053e950bba9e4b5d2fbd7a`.

## Local validation

All checks used Node.js **22.23.1**. Source and evaluation configuration were frozen before final validation and live capture.

| Check | Result |
| --- | --- |
| Semantic intent, V2/legacy wire and provider contracts | PASS |
| Case-specific facts: 35 operation families and mixed issues | PASS |
| Authority/relief, workstreams, resolver coverage | PASS; resolver 16 cases / 22 requested issues |
| Evidence and privacy diagnostics | PASS |
| IRAS release-gate and fixed-profile runner safety | PASS |
| `npm run lint` | PASS; existing ignored scratch-file warnings |
| `npm run build` | PASS; existing large-chunk and deprecated inlineDynamicImports warnings |
| `npm run test:smoke` | PASS; 63 suites, 43.16 seconds |
| `npm test` | PASS; 83 suites, 125.33 seconds |
| `git diff --check` | PASS |
| Protected historical artifact hashes | PASS; 110 unchanged files |

Initial local runs exposed stale mocks with false case flags on applied operations and a removed liability-intent prompt sentence. Those were repaired before these final passing checks. Invalid-response and contradictory-field negative assertions remain active. No live capture preceded the final checks.

## Independent reviewer verdict

APPROVED: no remaining material findings. The reviewer independently reran the release-gate and runner-safety regressions with Node.js 22.23.1, reviewed the latest final-VERIFIED support predicate and saved-target checker, and approved the restored compact prompt and coherent applied mocks.

| Phase 8 question | Reviewer answer |
| --- | --- |
| Is the case-facts flag internally coherent? | Yes: mandatory case operations, generic eligibility, conceptual guidance, and uncertain cues remain distinct. |
| Is the rule generic? | Yes: requested outcomes, claimant/transaction context, and issue alignment work across paraphrases. |
| Are material IRAS failures caught? | Yes within this contract: nine negative controls plus guard, scope, evidence, route-ownership and false-verification failures fail closed. |
| Can unsupported non-IRAS issues pass when misrouted to IRAS? | No: canonical routes and runtime ownership reject that outcome. |
| Are unsupported issues visible? | Yes: both explicit unsupported shells and permitted no-shell outcomes retain diagnostics and gaps. |
| Is evidence verification unchanged? | Yes: production admission, retrieval and verification are unchanged; evaluation checks are stricter. |
| Are historical observations preserved? | Yes: 110-file hash protection; normalization affects only the new manifest representation. |
| Are benchmark changes independently justified? | Yes: explicitly named IFRS permits contextual IFRS Foundation; unspecified investment population permits COMPANY or UNKNOWN without claiming coverage. |
| Was unrelated knowledge expansion avoided? | Yes: no CPF/MOM/ACRA/MAS/accounting knowledge expansion. |

This approval concerns source and API-free regressions. Fresh live outcomes require their own assessment. A reviewer turn first stopped at a usage limit; a later successful resumed review supplied the approval above. No reset or credits were consumed by this task.

## Live safeguards

The account reported ordinary usage allowed immediately before capture, with 98% primary and 63% weekly usage remaining; both exceed the existing 7% floor. The fixed targeted profile has nine cases. Gemini `gemini-3.5-flash-lite`, existing key, temperature 0, timeout 8,000 ms, one request per case, no retries, and minimum 15,250 ms between starts are required. The versioned final profile has twelve cases and cannot run unless the targeted prerequisite passes. No model, source, gate, fixture, or benchmark tuning is permitted after observation in this cycle. No merge or deployment is authorized.
