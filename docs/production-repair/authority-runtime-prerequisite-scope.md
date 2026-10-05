# Authority runtime prerequisite scope

This change extracts the whole-question authority evidence runtime from immutable snapshot `c252309` onto current `main`-based semantic issue planning. The production change is limited to these 12 paths:

- `src/types/authorityEvidence.ts`
- `src/services/authorityWorkstreams.ts`
- `src/utils/authorityEvidenceRouting.ts`
- `src/utils/authorityEvidencePresentation.ts`
- `src/services/authorityEvidenceResponse.ts`
- `src/services/geminiService.ts`
- `src/services/groundingContextBuilder.ts`
- `src/services/irasEvidencePolicy.ts`
- `src/types/accounting.ts`
- `src/retrieval/evidenceQualityGate.ts`
- `src/retrieval/externalSourceValidator.ts`
- `src/retrieval/irasRuleConceptSupport.ts`

The runtime consumes the existing semantic issue plan, coverage registry, retrieval provider, and AI transport on `main`. It plans one workstream per validated authority/domain, scopes retrieval and evidence admission to each issue, verifies claims against admitted records, and presents verified claims beside explicit evidence and application gaps.

The IRAS rule-family checks, source-term equivalence, live concept-gap retention, and quote prioritization are enabled only for explicit issue-scoped evidence requests. Ordinary IRAS assessments keep the existing generic matching and live-source retention path. Scoped IRAS admission requires every local candidate to match its exact reviewed registry payload and the topic's authority and source domain. The scoped-term fallback still requires all normalized terms and only handles the reviewed royalty/expense singular/plural forms.

This extraction excludes registry, source-map, provider, semantic resolver, AI transport, and UI production changes. It also excludes the later diagnostic/P1 work, historical evaluation artifacts, source research, and broad evaluation fixtures from `c252309`. Review should focus on issue routing boundaries, per-issue source isolation and claim coverage, scoped IRAS admission, deterministic response projection, and compatibility with current `main` APIs.

API-free regression coverage is registered in `scripts/run_all_tests.mjs` for workstream evidence isolation, whole-question presentation/routing, scoped IRAS concept coverage, and opt-in topic-term matching.

Independent review accepted the corrected scope and admission gates. Scoped local records must match every approved registry payload field apart from recalculated freshness, and must belong to the issue's topic authority/domain; this applies to built-in and custom IRAS providers before claim verification. Tests reject altered registry payloads, arbitrary local records, wrong authorities/domains, and unsupported rule text. Generic main callers do not activate the scoped gates without explicit issue scope.

Node 22.23.1 validation passed: lint, complete production build, 49 smoke suites (21.32 seconds), 69 full suites (53.51 seconds), the five new focused suites, adjacent IRAS quality/source-map regressions, and diff check. External fetch/HTTP/HTTPS was disabled except explicit synthetic mocks; no live integration run was performed. Existing generated-file lint and bundle/deprecation warnings remain. Latest-commit main-target CI is required before this prerequisite is ready for review. No completeness diagnostics or optional second call is included.
