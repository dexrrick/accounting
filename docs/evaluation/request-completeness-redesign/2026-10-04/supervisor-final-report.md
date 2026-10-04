# Request completeness redesign — supervisor checkpoint

Date: 04/10/2026. Branch: `codex/request-completeness-redesign`.
Starting SHA: `9f7682a6ba32fd3b39ea84bec8391d1e1421db4f`.
Stopping checkpoint: the commit containing this report; its exact SHA is reported in the completion message and available through `git rev-parse HEAD`.

## Decision and delivered scope

Preserve `codex/multi-authority-workstreams` at the starting SHA and continue the redesign on this separate branch. The approved work is retained; there was no restart from main. This checkpoint delivers stages1–3: supervisor specification, independently reviewed expectations and an API-free bounded feasibility prototype. Production reconciliation is not repaired by this milestone, and V4 remains on HOLD.

The prototype derives requested outcomes from its declared raw-question grammar, independently of synthetic semantic observations and routing metadata. It checks explicit bindings, subject identities, populations, operations, breadth, qualifications, directed relationships and required facets. Many-to-many bindings are supported; invalid bindings cannot credit coverage. Unknown material text produces UNCERTAIN. Complete independent inventory plus omission/misrepresentation produces INCOMPLETE. COMPLETE requires all requested scope and no unjustified issue.

The 28-case inventory in `specification.md` and test-only `oracle.mjs` covers IRAS, CPF, MOM, ACRA, MAS, accounting and mixed requests. Cases01–25 have independently labelled positive representations;26–28 remain UNCERTAIN. The original mixed relief/employer request and all three rejected overview examples are retained. CPF title/claimant compatibility, employee/employer contribution ownership, private/foreign context, general GST versus blocked-only scope, nonresident spelling, alternatives, interaction direction and unsupported accounting understanding are exercised without tax-answer assertions.

This proves bounded representation feasibility, not unrestricted English, production routing, evidence admission, current IRAS content or taxpayer application. The test grammar must not be copied wholesale into production and called general language support. Existing production authority/source/application gates and the prospective V4 scorer are unchanged.

## Verification

Supervisor executed the stable focused suite with Node 22.23.2 and the guard preload: **48 tests passed; zero failed, cancelled, skipped or todo**. The actual final TAP capture is `api-free-node22.txt`. The suite includes all 28 base cases, whole-outcome and facet omissions, invalid dimensions/spans, precision, contextual qualifications, many-to-many positives, legacy/malformed/provider-failure observations, routing independence, held-out compositions, limits and caller-mutation isolation. See `review-record.md` for independently found defects and their disposition.

Reproduce from the repository root: `node --import ./tests/evaluation/request-completeness/guard-preload.mjs ./tests/evaluation/request-completeness/prototype.test.mjs`.

Network protection uses rejecting public transport stubs plus global import/builtin guards. Guard self-checks deliberately exercise rejection before transport; the zero-actual-request field is a stub/static assertion, not independent OS network telemetry. The prototype has no imports or provider/network path. No Gemini/provider request, live IRAS retrieval, targeted acceptance, final profile, consumption reservation or preregistration was executed. No merge, push or deployment occurred. Provider allowance was not queried; the previous approximately 10% estimate is not a new measurement, and this work spent no provider allowance.

Lint/build/smoke/full suites were not rerun: only unintegrated evaluation MJS and documentation were added. Appropriate focused guarded validation passed. Production implementation would require the broader checks specified in `next-production-scope.md`.

## Protected integrity

All **389 frozen historical fingerprint rows (221 distinct paths)** match raw retained bytes in `D:/Accounting`. Stored Git content matches after separately accounted EOL normalization. 21 original files have historical CRLF-versus-Git normalization differences; all 221 paths in the fresh worktree differ from Git bytes through CRLF checkout conversion only. The direct historical byte checker therefore does not pass in this fresh checkout; this report does not claim it does. No historical file was rewritten to hide that difference.

Tracked/nonignored changes are confined to this dated documentation directory and `tests/evaluation/request-completeness/`. Production, schema, prompt, prospective scorer, V4 drafts, archived rejected-candidate proof and consumed artifacts have no Git-content changes from the starting checkpoint. Ignored files are outside the checker's scope. The original branch reference remains at the starting SHA.

## Files and continuation

Added documentation/verification artifacts: `specification.md`, `grammar-contract.md`, `review-record.md`, `next-production-scope.md`, `check-integrity.mjs`, this report, `validation-results.json`, `integrity-results.json` and `api-free-node22.txt`.
Added evaluation code: `prototype.mjs`, `oracle.mjs`, `prototype.test.mjs`, `guard-preload.mjs`, `guard-loader.mjs`.

Independent overall review: **APPROVED for the bounded, API-free feasibility milestone; no remaining material findings.** Reviewer independently observed 48/48 tests on Node 24.19.0 and rechecked the guard and counterexamples. Source hashes were stable. Full disposition and fingerprints are saved in `review-record.md` and `validation-results.json`.

Next proposal: narrowly design the production gate adapter and V2/versioned-schema compatibility, assess existing supported language, then independently review a production vertical slice. It requires separate authorization and does not activate a live acceptance. V4 design resumes only after production reconciliation passes its own checks and independent review.
