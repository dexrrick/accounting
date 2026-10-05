# CPF routing prerequisite: selected main-based scope

Prepared on 05/10/2026 against `origin/main` `67511a886402c2f3746e713e2e3227d5ec406828`. Source checkpoint for selected code is `c252309`, whose routing repair `8e2d619` passed independent review and local lint/build/89 smoke/109 full suites. Those results do not substitute for reviewing and testing this extracted main-based diff.

The documented defect belongs to the V2 per-issue reconciliation layer, which main does not yet contain. This prerequisite selects that contract and conservative routing ownership before authority-runtime and completeness-diagnostic PRs. It is not a whole-branch import.

Selected production paths:

- `semanticQuestionUnderstanding.ts`: explicit V2 schema/validator and issue contract, original one-call interpretation, per-issue reconciliation, independent raw taxonomy accounting, specific CPF ownership and separately typed routing-only parents. Preserve legacy observation reads. Unrelated employer/GST classification refinements remain separate where they can be decoupled safely.
- `rawRequestInventory.ts`: bounded, independent CPF raw grammar and subject descriptors from the reviewed repair; unsupported text fails closed.
- `queryTopicResolver.ts`: factual/request conjunction protection needed to preserve independent raw routing scope.
- `coverageRegistry.ts`: CPF and individual-CPF routing patterns, routing-only umbrella and explicit registered child/parent metadata. Exclude unrelated statutory/source-map/paragraph-hint, GST, corporate-tax, other-relief and MOM topic changes.
- `aiTransport.ts`: only the existing Gemini schema parameter plumbing/wire shape needed by V2. Preserve the original no-schema request shape; exclude provider diagnostic callbacks/error-body handling/telemetry.

Tests use API-free transport and a minimal retained-mock fixture with explicit provenance. Authority runtime, evidence admission/rule-support changes, UI, diagnostics integration, optional second calls and historical evaluation artifacts are excluded. No accounting arithmetic, statutory rate or authoritative source text is changed.

The resulting ten-path extraction passed independent static review. The review identified and resolved a confidence inconsistency: root confidence below 0.72 now takes the existing conservative taxonomy fallback, including a child-only regression where no umbrella residual could mask the issue. High-confidence omission controls still retain their residuals.

Local validation under Node 22.23.1 passed: focused V2/routing/legacy semantic/resolver regressions, `npm run lint`, `npm run build`, all 44 smoke suites (17.36 seconds), all 64 full suites (26.50 seconds), and `git diff --check`. Existing generated-file lint and bundle-size/deprecation warnings remain. Regression runs disabled external fetch/HTTP/HTTPS transport, while permitted synthetic mocks supplied the provider responses. No live integration test was run. The earlier approval-review capacity failure is resolved; these are fresh executed checks of this actual main-based diff.

Latest-commit main-target CI remains a release gate. This document approves neither a merge nor the later authority-runtime/diagnostics prerequisite. Those changes require their own selected diff, review and validation.
