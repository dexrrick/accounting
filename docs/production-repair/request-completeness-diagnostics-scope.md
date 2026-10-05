# Request completeness diagnostics scope

This change adds exact-query representation diagnostics on top of the authority runtime at `c34025b`. Production changes are limited to these nine paths:

- `src/services/requestCompleteness.ts`
- `src/services/semanticQuestionUnderstanding.ts`
- `src/services/geminiService.ts`
- `src/services/groundingContextBuilder.ts`
- `src/services/authorityWorkstreams.ts`
- `src/services/irasEvidencePolicy.ts`
- `src/types/authorityEvidence.ts`
- `src/types/accounting.ts`
- `src/utils/authorityEvidencePresentation.ts`

The context inventories the original raw query before semantic interpretation, retains only validated observations, and records whether the interpretation represents the requested outcomes. It is threaded through whole-question authority responses, scoped retrieval, and standalone IRAS responses without replacing or narrowing the original inventory. A complete representation does not establish evidence sufficiency, factual truth, case application, or accounting treatment.

Coverage includes malformed, bare, and wrapped observations; forged, stale, mutated, cyclic, and prototype-bearing inputs; omitted or extra outcomes and scope mismatches; per-issue retrieval inventory preservation; one-call default interpretation and zero-call precomputed interpretation; exact-query presentation binding; whole-question authority and standalone IRAS response integration.

Review is limited to diagnostics and their runtime threading. Registry, provider, UI, retrieval policy, source research, historical evaluation, routing umbrella, and P1 experiment changes are excluded. Regression coverage is in `test_request_completeness_diagnostics.mjs` and the API-free extensions to `test_authority_evidence_presentation.mjs`, registered by `scripts/run_all_tests.mjs`.
# Final validation

Independent review accepted this main-based transplant, including preservation of the minimal V2/provider boundary and the runtime's corrected source-admission gates. Node 22.23.1 lint, complete production build, all 50 smoke suites (33.31 seconds), all 70 full suites (41.13 seconds), focused diagnostics/actual authority and standalone IRAS/IRAS pipeline/semantic/workstream regressions, and diff check passed. External transport was blocked except explicit synthetic mocks. Existing generated-file lint and build warnings remain. One intentionally blocked, unrelated accounting extractor in the direct-grounding test takes its existing deterministic fallback; this is separate from the asserted single semantic interpretation.

The optional second call remains outside production. A separately reviewed offline comparison of 25 synthetic controls accepted nine representation repairs, rejected nine candidates, and skipped seven follow-ups. Two genuinely omitted requests were restored; other accepted repairs concern mismatches, facets, duplicates or extra outcomes. First-only mode made 25 synthetic calls; conditional mode made 43, with no interpretation added by either final response renderer. Empty evidence controls remained insufficient. Live provider effectiveness, latency and cost are unmeasured, so these synthetic results do not justify production enablement.

Release order: routing/V2 prerequisite PR #3, authority/evidence prerequisite PR #4, then this diagnostic attachment. All target main for required CI; earlier prerequisites are included in the branch until merged. No merge is performed by this task. Latest-head CI remains required before this PR is ready for review.
