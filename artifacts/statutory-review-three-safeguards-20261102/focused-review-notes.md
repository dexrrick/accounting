# Focused regression notes — 2026-11-02

## Before the fixes

- **Employee ownership:** the previous `namedEmployeeReferences()` allowlist accepted compact IDs, single-letter labels and uppercase IDs. It did not accept mixed-case names such as `Alice` and `Bob`; this was confirmed by tracing the matcher. No separate baseline full-application capture for this prompt was retained.
- **Reporting intent:** the direct semantic-plan probe for “Should the annual bonus that was earned in 2025 be reported as employment income, and does CPF apply to this bonus?” returned only `CPF_PAYROLL`; the IRAS request was absent.
- **Relative future date:** the new application regression failed before the resolver change. For “...the first contribution year ends on 31 March 2027. His bonus becomes payable the following day...”, `supportCpfPayrollKnowledgeRule()` returned `true` where the test expected `false`.

## Focused checks after the fixes

Passed with Node 22.23.3 and the repository's offline fetch guard:

- `tsc -b`
- `tests/regression/test_cpf_payroll_knowledge_20261027b.mjs`
- `tests/regression/test_statutory_multipart_issue_refinements_20261030.mjs`
- `tests/regression/test_statutory_cpf_expansion_20261101.mjs` — 18 actual application cases and date/source controls
- `git -c core.whitespace=cr-at-eol diff --check`

The application regressions cover Alice's PR date being withheld from Bob, Alice's own date remaining usable with Bob also present, the following day/one day later/following month safeguards, explicit IRAS reporting after comma-delimited and restrictive relative clauses, and descriptive relative-clause negatives (including “should be reported” and “will be included”). Existing `has`/`is` wording controls also pass.

No live source or model acceptance was performed.

## Follow-up: relative-clause timing wording

The independent reviewer identified that a numeric-year gate would miss “paid yesterday” and “paid recently”. The reporting predicate is now restored after any nonempty relative clause only when the main request begins with a modal directly governing the bonus and the resumed passive predicate is bare `be reported/included`. Modal and `to be` predicates inside the relative clause remain descriptive. Application and semantic controls cover yesterday/recently positives and “that is to be reported” as a negative. The TypeScript build and both affected regression suites passed after this refinement.

## Follow-up: natural names and fragmented dates

Added full-application controls for lowercase `alice`/`bob`, mixed-case `Alice`/`bob`, and distinct `Alice Lee`/`Alice Tan`; personal PR dates are withheld from the other employee, while same-owner lowercase and full-name questions retain their date. The existing `has`/`is` guard now also covers `turns`, `payroll`, and compact E-1/E1 aliasing. Date controls cover “due and payable the following day” split by `and` and “The next day, his bonus becomes payable” split by comma; both remain unverified with a 2027 applicability limitation. A separate yearful March 2026 wage fact with “the following day” retains the independent 2027 anniversary boundary. Final focused checks passed: TypeScript build, CPF payroll suite, and 18-case CPF application expansion suite.

The final reviewer then found all-uppercase multi-token names colliding with compact-ID normalization. The ownership helper now preserves all-uppercase multi-token names when a following status predicate or possessive establishes the identity. Full-application negatives for `ALICE LEE` versus `ALICE TAN` and a same-owner `ALICE LEE` positive pass. Final reruns of `tsc -b`, the CPF payroll regression, and the CPF application expansion regression passed.

Supervisor integration then found the mixed-case `ALICE Lee` form falling through to compact-ID parsing. Natural-name matching now runs before compact-ID normalization, with compact IDs handled as fallback. Added cross-owner and same-owner `ALICE Lee` application checks; final tsc, CPF payroll and CPF expansion suites pass.
