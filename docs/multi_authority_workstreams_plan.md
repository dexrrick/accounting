# Multi-authority workstreams implementation plan

Baseline: `main` at `67511a886402c2f3746e713e2e3227d5ec406828`.

## Current flow and constraint

`semanticQuestionUnderstanding` validates one primary domain and reconciles it with
`questionClassifier`. `groundingContextBuilder` retrieves local records, performs
IRAS mapped-source and official discovery, then passes eligible records through
`evidenceQualityGate`. `irasEvidencePolicy` verifies quoted claims and builds
`irasEvidencePresentation`; `ComplianceRationale` renders that projection. The
existing IRAS evidence gate, original-query checks, and legacy projection remain
authoritative during migration.

## Phases

1. Add a validated, optional list of material issues to semantic interpretation.
   Represent issue subject population, requested operation, governing and
   contextual authorities, mapped topics, and evidence requirement separately.
   Reconcile every model suggestion against the existing authority and coverage
   taxonomy. Keep the old single-domain schema valid for existing fixtures and
   safe no-provider fallback.
2. Group issues by governing authority and tax or regulatory domain into
   workstreams. Keep the issue plan as the retrieval selector and treat the old
   classification as a compatibility summary. Add a provider interface for local
   retrieval, source discovery, evidence admission, and presentation metadata.
   The IRAS adapter must call the current IRAS pipeline; other authorities start
   with bounded local coverage and return incomplete status where claim
   verification is unavailable. The non-IRAS branch of the current quality gate
   is not sufficient to prove coverage.
3. Track each issue from mapping through retrieval, admission, claim verification,
   and coverage. Aggregate status from *all* material issues and missing facts.
   A record may cover only an issue in its own authority and domain.
4. Add a whole-question presentation projection through scenario state, `App`,
   `InputHandlerPanel`, chat preview, and `ComplianceRationale`; bind freshness
   to the raw query. Keep `irasEvidencePresentation` as a legacy projection until
   existing IRAS evaluations show parity. Synthesis receives only verified
   claims grouped by workstream and names any remaining evidence gaps.
5. Evaluate held-out IRAS+CPF, MOM+CPF+IRAS, two-domain IRAS, and accounting+IRAS
   questions. Add contamination, stale-state, malformed/timeout/no-provider, and
   metadata-is-not-evidence regressions. Run focused checks, the existing semantic
   and IRAS suites, then required build/lint/full evaluations using Node 22.23.1.

## Acceptance rules

- No source-map pointer or search result is treated as evidence.
- No workstream is marked verified from another authority's source.
- Unmapped or unsupported material issues keep the whole answer incomplete.
- Evidence coverage and uncertainty about applying a rule to case facts remain
  separate; an uncovered issue cannot become merely conditional.
- The original user query remains in relevance and claim checks.
- Prior IRAS employee-benefit and multi-relief behavior remains unchanged.
- Evidence status is separate from model interpretation and deterministic mapping.
