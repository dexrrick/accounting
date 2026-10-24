# Authority evidence repair and durable receipt export — review handoff

Date: 24/10/2026 (Singapore)

Repository: `dexrrick/accounting`

Review branch: `codex/acra-main-reconciliation`

Implementation baseline: `630113b74f9ebcec7b3498644645b5ca61a0b73b`

Review the branch delta against that baseline. This work was developed on the earlier authority-review checkout; it has not been reconciled with newer main-branch changes. No main merge, application deployment, source activation, live model run, or PR-description rewrite was performed. Historical captures and pilots remain stopped.

## Application repairs

- Bind concepts to a uniquely supported issue/request clause, keeping legal publishers distinct from governing authorities. Cover the retained MOM response with root authorities MOM/SSO and separate Employment Act, Part IV, working-hours and overtime concepts. Unknown, competing and independent requests remain material.
- Normalize general-rule intent and tax-outcome routing per issue. IRAS cash-top-up tax relief stays distinct from CPF contribution obligations; mixed questions retain their issue-local rule intent. A named-company residency determination still requires facts.
- Handle bounded ACRA annual-return filing equivalents and population-neutral MAS CMS general-rule questions. MAS definition and licensing duty remain separate evidence obligations; no company fact is invented for UNKNOWN population.
- Add candidate admission diagnostics, including identity/hash, predicate results and first failure, without relaxing substantive admission checks.
- Select and verify supporting quotations for requested propositions: residency and incorporation, cash-top-up eligibility and complete limits, and motor-car restrictions and relevant exceptions. Exact contiguous passages, qualifications, grant exclusions and account limits are preserved. Introductory text, cross-references and unknown qualifiers cannot establish complete coverage.

Primary application files:

- `src/services/semanticQuestionUnderstanding.ts`
- `src/services/authorityWorkstreams.ts`
- `src/services/groundingContextBuilder.ts`
- `src/services/irasEvidencePolicy.ts`
- `src/retrieval/irasRuleConceptSupport.ts`
- `src/verification/claimEvidenceVerifier.ts`
- `src/types/authorityEvidence.ts`

Registered regressions cover retained interpretation replay, mixed-question isolation, ambiguous ownership, real application questions, incomplete evidence and unknown requested propositions. Current IRAS excerpts are labelled current reference fixtures, not reconstructions of missing historical HTTP bodies.

## Durable receipt export

- `scripts/verification_receipt_exporter.mjs`: immediate compressed receipt/diagnostic persistence, deduplicated body blobs, explicit body/hash scope, artifact verification and manifests with separate answer/capture/export states. Unavailable cases remain UNOBSERVED. Recovery rejects contradictory manifest summaries.
- `scripts/export_retained_verification_receipts.mjs`: offline import of existing receipts. Combined success/failure logging is bounded to 2 KiB per line and 32 KiB per run. Log exhaustion or backpressure cannot stop durable exports.
- `scripts/cloudflare_verification_receipt_sink.mjs`: fixed-origin authenticated R2 transport, storage preflight, immutable artifact upload/readback, dependency verification before manifest publication, manifest history and rollback, and fresh-instance read-only recovery. Verified remote state survives a failed local manifest write and finalization.
- `scripts/prepare_r2_verification_harness.mjs`: transforms the byte-pinned historical harness without executing it. It preserves the ten frozen questions and source guards, removes the unbounded log stream, awaits storage setup before application import, and awaits per-case export/finalization. Model calls are disabled unless explicitly enabled.
- `.gitattributes` preserves the exact bytes of `tests/fixtures/legacy_verification_harness_23637b.txt`, whose SHA-256 is checked by the preparer.

See `docs/verification_receipt_export.md` for interfaces and invocation details. The preparer is not part of normal application builds; no model postbuild hook was added.

## Validation and evidence boundaries

- Node 22.23.1; final lint PASS and full offline regression **148/148 PASS**.
- Independent application, exporter, harness and R2 reviews: no remaining material findings after fixes.
- Application frontend/Worker build and 125-suite smoke checks passed before the tooling-only additions; all 19 reviewed application-file hashes remained unchanged. The final 148-suite full run includes the smoke suites.
- Five historical saved receipts were exported and exactly reconstructed. Their original answer statuses were retained; the other five planned cases remained UNOBSERVED. All 18 historical source-response records lacking body payloads remained metadata-only. The trial produced 2,036 stdout bytes and zero stderr bytes.
- R2 tests use injected transport and cover upload/readback failures, ambiguous writes, corruption, interrupted runs and recovery after local files are removed. The actual prepared harness with real exporter modules was checked to stop at the live-call hold before storage or model dispatch.
- With explicit user approval, private R2 bucket `accounting-verification-receipts` was created in APAC. Managed public access is disabled and no custom domains are attached. A small JSON test object was uploaded and retrieved through the connected Cloudflare API. No application Worker deployment was changed.
- That API probe is distinct from acceptance of the Node R2 adapter with real runtime credentials. No receipt-store runtime token was provisioned or exposed by this task, and no credentialed Node-adapter run or fresh model verification was performed.

An external review of commit `37e314ecdbc1ca0de9a824f820935eddf90078a5` later confirmed four receipt-tooling issues: bucket-scoped R2 credentials cannot use the REST bearer-token contract; attempted exports could remain UNOBSERVED after an error; diagnostics retained verified quotations; and concurrent writers could replace the same manifest. The follow-up changes in this worktree address those findings with SigV4 credentials, explicit failed-export states, quotation hashes and lengths in diagnostics, and an atomic one-writer lock. Focused offline regressions pass. No runtime credentials were present, so real Cloudflare acceptance of the Node adapter remains untested.

Portable validation summary: `docs/evaluation/authority-review-2026-10-24/validation-summary.json`. Full local logs, checkpoints, raw historical exports and generated reference harnesses remain local and are not included in this publication.

## Remaining work and requested review

1. Review the application ownership/intent changes and the negative evidence boundaries; check that no unrelated sibling or unknown qualifier can inherit coverage.
2. Review receipt fidelity, manifest consistency, remote/local failure ordering, credential handling and post-process recovery. Passing exporter tests do not establish accounting-answer correctness or live authority parity.
3. Before any future authorized live run, freeze the reviewed application commit and regenerate the harness with that exact commit/tree hash. The locally prepared `630113b` harness is a historical reference, not the repaired application build.
4. Configure `ACCOUNTING_RECEIPT_STORE_ACCESS_KEY_ID` and `ACCOUNTING_RECEIPT_STORE_SECRET_ACCESS_KEY`, a unique run ID and an export directory in the isolated verification runtime. Do not enable model calls without explicit authorization.
5. Once authorized, verify the same seven standalone and three mixed questions and demonstrate post-build retrieval. Keep Node results, browser results, issue evidence, capture/export status and whole-question acceptance separate.

The precise historical causes of mixed CPF admission failure and MAS candidate rejection remain unknown because the original rejected candidates/body/trace payloads are unavailable. New diagnostics do not retroactively establish those causes. Whole-authority live parity remains unproven.
