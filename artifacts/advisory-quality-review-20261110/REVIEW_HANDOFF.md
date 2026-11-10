> Publication scope: code and this handoff only. Captured responses, source traces, validation reports/logs and the prepared evidence manifest remain local while exact-payload publication approval is pending. Local results below are reported results, not GitHub CI evidence.

# Advisory routing and evidence synthesis review handoff

## Goal and status

Review the changes addressing the accepted eight-question diagnostic: negated journal directives should not force journal routing; requested authorities and advisory issues should survive planning; supported rules should survive claim-level evidence checks without weakening provenance, numerical or applicability controls.

**Implementation checkpoint; acceptance incomplete.** Routing and evidence-path regressions pass. The latest complete eight-case assessment is **2 PASS / 4 PARTIAL / 2 FAIL**, combining captures from different source revisions. These are qualitative review judgments, not automatic accuracy measurements. Final-revision answer quality remains unverified: two generation attempts returned HTTP 503 UNAVAILABLE/high demand. No merge, deployment, source activation or production-readiness approval is claimed.

## Exact review target

- Repository: https://github.com/dexrrick/accounting
- Branch: `codex/project-charter-simplification-20261103`
- Implementation commit: `7e4f80ddf0b0fc30ad930c6ba385cd58a8ba3fb2`
- Base commit: `bef2cffbadbc8f4d7264a73b20f97b83dbecda78`
- [Implementation diff](https://github.com/dexrrick/accounting/compare/bef2cffbadbc8f4d7264a73b20f97b83dbecda78...7e4f80ddf0b0fc30ad930c6ba385cd58a8ba3fb2)
- Source-only pre-commit patch SHA-256: `abaada4c5d376233ac16e236abadfea60ee221c94ba54cb59b999df2b527c08e` (a diff hash, not a commit).
- No pull request was created. A subsequent documentation commit publishes this handoff with identical implementation files. The publication commit SHA is supplied in the chat handoff.

The selected implementation consists of 31 tracked files under `src`, `tests` and `scripts`. Unrelated local artifacts and environment files are excluded. Prepared local evidence is listed in publication-manifest.json (`local-only: publication-manifest.json`); its original/published hashes distinguish sanitized artifacts from original local captures. JSON operator paths are replaced with placeholders. The diagnostic scripts retain their Windows operator paths and require adaptation on another machine.

## Changes and purpose

1. **Advisory routing:** `journalRequestIntent.ts`, `aiFirstAdvisory.ts`, and `geminiService.ts` preserve the negative-journal boundary. Both original accounting explanation questions and positive journal controls remain covered.
2. **Issue preservation:** `semanticQuestionUnderstanding.ts`, `authorityWorkstreams.ts`, and `authorityEvidenceRouting.ts` improve multi-issue/authority planning and conservatively retain a narrowly malformed UNKNOWN-domain child as unresolved. They do not grant an unknown issue a statutory conclusion.
3. **Official evidence selection:** `groundingContextBuilder.ts`, `practicalStatutoryExpansion.ts`, and `cpfMasPracticalRules.ts` reuse bounded, same-authority discovery with data-only official pointers. The MOM Paying salary page can be independently admitted for the practical-payroll issue. Metadata and candidate URLs are not proof. MAS's compatible User-Agent is server-side and MAS-host-specific.
4. **Complete evidence context:** `externalSourceValidator.ts`, `evidenceTextBoundaries.ts`, `claimEvidenceVerifier.ts`, and related types retain complete original body context with document/date bindings. Context is restrictive only; it cannot supply positive support absent from a cited admitted excerpt. Qualification-loss and incomplete-list controls remain fail-closed. Cache content types and separate topic records are preserved.
5. **Claim construction and verification:** `evidenceGroundedSynthesis.ts` checks individual numerical assertions within one cited admitted passage, retaining value/unit/role/sign/timing constraints. Oversized generation packets share identical binding metadata while retaining original passage IDs, issue IDs and exact quotes inline. The 15,000-token cap, original-packet validation and byte-identical small-prompt path remain intact. No new mandatory generation/repair stage was added.
6. **Presentation and replay:** `authorityEvidencePresentation.ts` and `irasEvidencePolicy.ts` remove redundant contained quotations only within the same bound scope. Replay corrections use the retained native CPF PDF, its actual extraction and two explicitly modeled 404 discovery misses; unknown URLs still fail. The MAS negative fixture no longer contains another valid exemption source. Fixed question wording is preserved.

The evidence runner is an operator artifact, not a production stage. It enforces request reservation and 5.1-second pacing serially, rejects calls over the cap, and labels retained-understanding experiments separately from fresh application runs.

## Verification actually performed

- Fresh final-revision full regression pass: **189/189 suites PASS**, 295.23 seconds, with external fetches blocked and no real model requests.
- Final source revision: maintained lint, TypeScript build, Vite build and worker build passed. Lint has warnings.
- Final focused synthesis regression passed, including lossless reconstruction, inline issue/binding agreement, unchanged small-prompt hash, cross-scope rejection and oversized-question zero-dispatch controls. Source-discovery regression passed with the original practical-payroll frame and wrong-page rejection.
- Actual production dummy replay of the retained 114-passage MOM packet: **9,816 estimated tokens**, including the actual system prompt, below the unchanged 15,000 cap; zero real provider/network calls.
- Independent local reviews found no material issues after the corrections. The runner's concurrent-cap race was reproduced and fixed; a local no-network check admitted exactly two of three concurrent reservations and preserved 5.1-second spacing.
- A historical smoke run had 165 passes and one compact-fixture assertion failure while the fixture was being corrected. The corrected focused test passed; the original failed log is retained. The fresh final full-suite pass above supersedes that historical failure for the current code.
- Live, headless application captures are separate evidence. No browser, deployed application or production acceptance was performed. CI status must be checked against the exact pushed commit; no CI pass is inferred from local checks.

Canonical local commands use Node 22.23.3. Windows runs inherited a retained `userinfo-shim.cjs`; offline checks also loaded an external-fetch guard. Initial `uv_os_get_passwd ENOMEM` and compiler incremental-file EPERM failures occurred before successful retries with the required environment/permissions. These are not product passes.

## Live findings and request ledger

The ten retained local captures comprise the latest completed response for each fixed question plus the two final provider-failed MOM attempts. The case manifest (`local-only: latest-acceptance-summary.json`) identifies each capture's actual source diff hash. They are not a fresh eight-case sample at one revision.

| Case | Last completed assessment | Remaining concern |
|---|---|---|
| Accounting accrual | PASS | Useful timing/liability explanation with capitalization caveat. |
| Accounting asset register | PASS | Register, ledger and reconciliation explained. |
| IRAS private car | PARTIAL | Central restriction appears; exception qualifications/application wording remain incomplete. |
| CPF employer responsibility | PARTIAL | Remittance responsibility appears; requested payroll facts/checklist remains incomplete. |
| MOM salary/overtime | FAIL | Own-issue source now admitted, but generated claims mixed issue references and were rejected. Final inline issue-ID correction lacks a successful live answer capture. |
| ACRA sole director/secretary | PARTIAL | Core rules appear; supported application is withheld and generic unresolved wording conflicts with the answer. |
| MAS fund management | PARTIAL | Conditional licensing/exemption guidance appears, followed by a contradictory unresolved-facts notice. |
| Mixed first employee | FAIL | MOM duties appear; CPF duties/comparison/facts coverage remains incomplete. |

The last completed MOM replay (`local-only: mom-inline-retest/mom-salary-overtime.json`) made two HTTP-200 model requests and 16 source requests, then rendered governed fallback excerpts because both generated claims mixed issue scopes. Offline reproduction (`local-only: mom-inline-retest/offline-diagnosis.json`) confirms no support-verification call occurred: no generated claim survived deterministic checks.

After the reviewed inline-issue correction, a retained-understanding attempt (`local-only: mom-cached-plan-retest/mom-salary-overtime.json`) received 503 at generation. After more than 120 seconds of backoff and explicit user approval of 87 total requests, the fresh attempt (`local-only: mom-final-retest/mom-salary-overtime.json`) received understanding HTTP 200 and generation HTTP 503. No 429 occurred in these three attempts. Earlier retained batches did include a 429 and separate 503 failures.

**86/87 real Gemini HTTP requests used; one remains approved.** Do not run additional live calls as part of this read-only review. The supplied dashboard limits were 15 RPM, 250,000 TPM and 500 RPD; its seven-day peak display does not establish the current remaining daily quota. Latest attempts preserved zero direct, projected and committed journal groups. This does not establish complete statutory correctness or faithful qualifications.

## Review focus

- Reproduce negated-journal routing through `processAccountingQuery`, including positive/mixed journal controls.
- Check preservation of both authorities and independently answerable non-calculation issues; investigate false global unmapped-concept gaps rather than removing genuine missing-fact/date/employee/entity safeguards.
- Check numerical segmentation against negation, units, role, sign, timing and reversed-rule controls. Do not permit pooling unrelated passages or borrowing another issue's application evidence.
- Check original HTML/body completeness, attached exceptions, document hash/URL/date binding, cache behavior and restrictive-only context semantics.
- Check data-only source pointers and bounded selection against the charter. No new statutory keyword exceptions or mandatory model-review layers should be introduced.
- Check lossless prompt compaction, evidence ID ownership and final answer construction. The latest live failures make citation scope, useful issue coverage and contradictory stock limitations priority concerns.
- Inspect test/fixture corrections for disguised benchmark changes or weakened assertions. The full original eight questions must remain fixed.

## Evidence

- Publication manifest and hashes (`local-only: publication-manifest.json`)
- Eight-case manifest and grades (`local-only: latest-acceptance-summary.json`), exact questions (`local-only: cases.json`)
- Current local full-suite result (`local-only: review-publication/validation/full-result.json`), full log (`local-only: review-publication/validation/full.log`)
- Final lint/build results (`local-only: mom-final-retest/validation/supervisor-checks.json`)
- Focused test/type/profile report (`local-only: mom-inline-retest/validation/builder-issue-inline-checks.json`), actual final packet profile (`local-only: mom-inline-retest/issue-inline-offline-diagnosis.json`)
- Live summary (`local-only: mom-final-retest/live-report.json`) and individual captures linked above
- [Original accepted diagnostic at the base commit](https://github.com/dexrrick/accounting/tree/bef2cffbadbc8f4d7264a73b20f97b83dbecda78/artifacts/answer-quality-20261108)

The local working tree contains unrelated untracked artifacts not published here. They are outside this review target. No implementation file selected for this handoff remains local-only once the push is verified.

## Ready-to-copy review prompt

Independently review the changes identified above using your GitHub access. Review repository https://github.com/dexrrick/accounting, branch `codex/project-charter-simplification-20261103`, implementation commit `7e4f80ddf0b0fc30ad930c6ba385cd58a8ba3fb2` against base `bef2cffbadbc8f4d7264a73b20f97b83dbecda78`. Confirm the exact commit you inspected. Use the handoff as context and verify its claims against the code, diff, tests, and available CI evidence. Report actionable findings with severity, file and line references, impact, and suggested fixes. State any access or verification limitations. Keep the review read-only.
