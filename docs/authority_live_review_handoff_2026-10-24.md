# Receipt repair and live authority verification: review handoff

Date: 24/10/2026 (Singapore). Repository: `dexrrick/accounting`. Review branch: `codex/acra-main-reconciliation`.

The four receipt-tooling findings against `37e314e` were repaired and published as `d8480e4`. Real Cloudflare Node authentication, export and recovery then passed. The subsequent ten-case Node live run exported and independently recovered every receipt, but answer-evidence coverage remains incomplete: three cases report VERIFIED, one RETRIEVED_SUFFICIENT, two LIMITED and four INSUFFICIENT. Main merge, production deployment, source activation, browser acceptance and whole-authority parity remain held or unestablished.

## Exact revisions

| Purpose | Commit / comparison |
| --- | --- |
| Earlier implementation baseline | `630113b74f9ebcec7b3498644645b5ca61a0b73b` |
| Authority application repair reviewed externally | [`37e314ecdbc1ca0de9a824f820935eddf90078a5`](https://github.com/dexrrick/accounting/commit/37e314ecdbc1ca0de9a824f820935eddf90078a5) |
| Receipt follow-up repair | [`d8480e44d9234f07658edd9743a54774d8d24eae`](https://github.com/dexrrick/accounting/commit/d8480e44d9234f07658edd9743a54774d8d24eae) |
| Focused receipt repair diff | [37e314e to d8480e4](https://github.com/dexrrick/accounting/compare/37e314ecdbc1ca0de9a824f820935eddf90078a5...d8480e44d9234f07658edd9743a54774d8d24eae) |
| Actual storage-only verification | [`97815550d95a71fe83ad9cfb40c691e90bae6841`](https://github.com/dexrrick/accounting/commit/97815550d95a71fe83ad9cfb40c691e90bae6841), branch `codex/receipt-storage-runtime-20261024` |
| Actual ten-case live verification | [`66f36889f060d46878cfa73a85e9e6e5d661cfb0`](https://github.com/dexrrick/accounting/commit/66f36889f060d46878cfa73a85e9e6e5d661cfb0), branch `codex/authority-receipt-live-20261024` |

Both verification commits have `d8480e4` as their sole parent and change only `package.json` and `.verify-final-build-live.mjs`. The live harness checks the parent and tracked application-tree digest (`71bdffdaa5d3b01d382f6f46854ca9034c67288e8621475869e3cfa60d56316e`). No application-source repair was made after `d8480e4` for this run. This handoff publication adds documentation and evidence only.

## What changed

The earlier application repair addressed issue-local intent and authority ownership, bounded ACRA filing-duty equivalents, MAS general-rule scope, source-admission diagnostics, and IRAS supporting-quotation qualifications. See the [earlier application handoff](authority_review_handoff_2026-10-24.md) and the [baseline-to-application-repair diff](https://github.com/dexrrick/accounting/compare/630113b74f9ebcec7b3498644645b5ca61a0b73b...37e314ecdbc1ca0de9a824f820935eddf90078a5). Its source-admission and whole-question coverage negatives were preserved.

The external receipt review led to these changes in `d8480e4`:

- `scripts/cloudflare_verification_receipt_sink.mjs`: S3-compatible R2 SigV4 authentication with bucket-scoped Access Key ID / Secret Access Key; no REST bearer-token or Admin-token fallback. Preflight atomically reserves a permanent, single-use writer lock. Interrupted or ambiguous writer ownership requires a new run ID.
- `scripts/prepare_r2_verification_harness.mjs`: attempted export failures are recorded when persistence permits; later questions stop; finalization is attempted; unavailable failure-status persistence remains explicit in the terminal diagnostic.
- `scripts/verification_receipt_exporter.mjs`: verified remote EXPORTED state survives a local mirror failure. Compact diagnostics replace full `quote` strings with hashes and lengths while full receipts retain exact quotations.
- Existing regression suites exercise signing, simultaneous writers, failed exports, preserved remote state, generated failure-handler behavior, private quotation exclusion and exact receipt reconstruction.

Bucket-scoped credentials were created and stored directly as masked Cloudflare build secrets. No credential values were added to GitHub. The live gate is set only in the isolated verification child process; it was not added to persistent build variables. The existing non-production trigger uploads a Worker version and excludes `main`; production's active deployment was checked unchanged.

## Runtime and recovery evidence

The storage-only Cloudflare build `bcd6efe7-1ccf-4ba6-802f-56f38e5a6853` passed actual Node SigV4 upload/readback, manifest publication, removal of the local copy, and exact reconstruction using a fresh sink. It made no model or official-source calls.

The live build `67801bd8-5729-49a0-b1ab-abc3f95bbe82` succeeded with run ID `live-d8480e44-20261024-01`. It processed the same seven standalone and three mixed questions, with 13 model requests and 93 source requests. All ten receipts were EXPORTED. All 93 source-response bodies were retained with COMPLETE capture status. Ten full model-response bodies were retained; three additional model replies have metadata only because the existing harness retains the full body of only the first model reply per case. No missing body was manufactured.

The Cloudflare connector's text decoding cannot faithfully return gzip bytes. The isolated live harness therefore also writes private JSON/base64 copies of the original compressed artifacts, checks their readback, and publishes a hash-bound portable index. Original receipts and manifests remain unchanged. After the build, all 69 original artifacts (2,336,904 compressed bytes) were independently downloaded through those copies, checked against their original hashes and lengths, and reconstructed with `readVerificationReceiptExport`.

- Original manifest SHA-256: `2f436a4bedb578d051f0cd0eaacda46a8ab53b4489c1f24128fb1685c35b04e1`.
- Portable index SHA-256: `0500744b6a489c826b8dcd0c4366ab520d7ef437de2b54a302a35c19054c4e84`.
- The portable-copy tail exists in the isolated verification harness. It is not a new production application feature or part of the reusable preparer's output.

## Observed answer results

These are bounded Node results for this exact run, separate from export success.

| Case | Answer status |
| --- | --- |
| ACRA | VERIFIED |
| CPF | VERIFIED |
| MOM | VERIFIED |
| MAS | INSUFFICIENT |
| IRAS residency | RETRIEVED_SUFFICIENT |
| IRAS cash-top-up relief | LIMITED |
| IRAS motor-car GST | LIMITED |
| Mixed ACRA / CPF | INSUFFICIENT |
| Mixed MOM / MAS | INSUFFICIENT |
| Mixed three IRAS questions | INSUFFICIENT |

Fresh, hash-checked diagnostics establish two specific current failure paths:

1. MAS local candidates failed `LOCAL_SOURCE_NOT_VERIFIED`. The fetched CMS licence and guideline pages returned Maintenance content and `TOPIC_MISMATCH`; no MAS evidence was admitted or verified.
2. In mixed ACRA/CPF, CPF was admitted, verified and covered. ACRA selected a late-filing penalties page but produced no verified annual-return filing-duty claim. The current mixed-case failure is an ACRA quotation gap, not CPF admission. Semantic ownership remained separated.

These findings apply only to the new run. The causes of older missing CPF/MAS traces remain unknown. The topic-admission diagnostic loop still stops after the first admitted topic; that known diagnostic limitation does not itself bypass downstream coverage checks.

## Published evidence and verification limits

Start with [results-summary.json](evaluation/authority-live-2026-10-24/results-summary.json), [validation-summary.json](evaluation/authority-live-2026-10-24/validation-summary.json), [questions.json](evaluation/authority-live-2026-10-24/questions.json), and [runtime-capture-summary.json](evaluation/authority-live-2026-10-24/runtime-capture-summary.json). The [original manifest](evaluation/authority-live-2026-10-24/manifest.json) records all artifact hashes and export states. [evidence-file-index.json](evaluation/authority-live-2026-10-24/evidence-file-index.json) hashes the published JSON files and links each diagnostic to its original compressed artifact.

Individual diagnostics are exact decompressions of the verified originals. Begin with [MAS](evaluation/authority-live-2026-10-24/diagnostics/mas.json), [mixed ACRA/CPF](evaluation/authority-live-2026-10-24/diagnostics/mixed-acra-cpf.json), [IRAS relief](evaluation/authority-live-2026-10-24/diagnostics/iras-relief.json), [IRAS GST](evaluation/authority-live-2026-10-24/diagnostics/iras-gst.json), and [mixed IRAS](evaluation/authority-live-2026-10-24/diagnostics/mixed-iras-three.json); all ten are published separately.

Full raw source/model bodies and reconstructed full receipts remain in private R2 and local storage. They are not included in this GitHub handoff. GitHub-only review can assess the implementation, retained diagnostic claims, provenance metadata and hash records; it cannot independently recheck every exact source quotation against those private bodies.

Local Node 22.23.3 lint, typecheck and frontend/Worker build passed. The receipt follow-up full run passed 147/148 suites; its only failure was a new test stub double-encoding a receipt. That test-only issue was corrected and the harness suite passed on targeted rerun. All three focused receipt suites passed. The full suite was not repeated after the test-only correction. Independent implementation and isolated-harness reviews found no remaining material issues. Cloudflare used Node 22.23.4. No new GitHub Actions result is claimed by this publication.

## Focus for the next reviewer

Review read-only and report actionable findings with exact file/line references:

1. Check the receipt repair diff for credential scope/signing, writer ownership, manifest publication/rollback, remote/local failure ordering, and quotation minimization.
2. Check the isolated live harness and portable-copy tail against the frozen application identity; verify that storage/export success is never promoted to answer correctness or whole-authority parity.
3. Inspect the fresh MAS, mixed ACRA/CPF and IRAS diagnostics. Recommend the smallest upstream retrieval, interpretation or quotation repair supported by retained evidence. Do not weaken admission, fabricate source text, or treat Maintenance/HTTP 200 as authoritative evidence.
4. Keep Node evidence, browser acceptance, whole-question coverage and release approval separate. No browser recheck was run; no main merge, production deployment, source activation or PR-description rewrite is authorized by this report.
