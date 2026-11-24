# CPF safeguard repairs and IRAS WHT treaty expansion

## Goal and status

Address the three review findings against the earlier branch and expand one unsupported IRAS authority question: “How do tax treaties affect withholding tax on payments to non-residents?” Local implementation and focused validation are complete. Broad regression, preservation replay, CI and live acceptance for this exact implementation remain pending. This is a review checkpoint, not merge or release acceptance.

## Exact review target

- Repository: https://github.com/dexrrick/accounting
- Branch: `codex/statutory-knowledge-expansion-20261030`
- Implementation head: `57077378435a1f3388af7d0933ff9fec7c6ebad4`
- Base: `46261d8976d5e2ed6fadb9d735c438e651f99e12`
- Implementation comparison: https://github.com/dexrrick/accounting/compare/46261d8976d5e2ed6fadb9d735c438e651f99e12...57077378435a1f3388af7d0933ff9fec7c6ebad4
- This handoff and current logs are published in a subsequent evidence-only commit. Review code at the exact implementation SHA above; the final chat receipt identifies the published branch head.
- No PR was created as part of this publication. No merge or deployment was performed.

## Changes and acceptance cases

1. **Employee ownership:** `src/retrieval/cpfPayrollKnowledge20261027b.ts` tracks bare status-clause names and possessive payroll owners, including bounded lowercase possessive references. The prompt “Employee Alice became a Singapore PR on 15 March 2026. Bob remains a foreigner. Is CPF due on Bob's March Ordinary Wages?” must not borrow Alice's PR date or compute Bob's personal anniversaries/proration from it.
2. **Future payroll evidence:** `src/retrieval/targetDateResolver.ts` recognizes numeric/word offsets, business/working days and weeks, and associates relative payroll timing with preceding date anchors even with intervening prose. “A foreign employee became a Singapore PR on 15 March 2026. The first contribution year ends on 31 March 2027. His bonus becomes payable two days later. Does the bonus attract CPF?” must retain the 2027 evidence limitation. Controls distinguish an independent anniversary boundary from actual future payroll, and nearer current-payroll dates from ambiguous anchors.
3. **Reporting intent:** `src/services/semanticQuestionUnderstanding.ts` distinguishes passive predicates in relative descriptions from the outer reporting question. “Should the annual bonus that could potentially be reported as employment income attract CPF?” must not introduce an IRAS reporting request. “Should the annual bonus that may be included in employment income be reported as employment income, and does CPF apply?” must retain the reporting request. Tests exercise the application path.
4. **General WHT treaty effect:** `src/retrieval/irasMasKnowledge20261027b.ts` adds a conditional explanation from four retained passages on the existing IRAS non-resident-company payment scope page. `src/retrieval/irasRuleConceptSupport.ts` binds only the exact general concept, topic/domain scope and complete passage family. `src/standards/coverageRegistry.ts` adds the source/topic association and bidirectional treaty-effect question recognition. Semantic reconciliation admits fallback coverage only for a strict general question, exactly the two expected WHT topics, no unresolved fragments, and one matching mapped IRAS rule issue.

The exact WHT question now returns VERIFIED IRAS evidence through `processAccountingQuery(question, null, IFRS, undefined)` without a provider or injected semantic issue plan. The explanation says the applicable DTA and income category can affect treatment, with residence, service location and permanent-establishment facts relevant to the retained examples. It does not establish a universal exemption or a treaty-specific rate/outcome. Existing service-location and zero-rate filing answers remain covered. Named treaties (including lowercase names), Article 12 outcome assertions, rent, director fees, specific rates and case outcomes are negative controls; unsupported treaty conclusions remain unresolved. Source scope is non-resident company service/interest examples, not complete treaty text or all payee classes.

Tests changed:
- `tests/regression/test_statutory_cpf_expansion_20261101.mjs`
- `tests/regression/test_iras_mas_knowledge_20261027b.mjs`
- `tests/regression/test_iras_wht_filing_treaty_production.mjs`

## Verification actually performed

Fresh local Node 22.23.3 validation on the exact implementation contents passed:
- Environment preflight.
- Maintained lint (`src`, `scripts`, `tests`).
- TypeScript project build.
- IRAS/MAS source-backed suite (6/6).
- WHT production replay: six fixture-plan cases plus the exact general question through the natural no-provider application entry; tests assert zero network/model requests. Direct fallback negatives cover filing and specific treaty/payment scope.
- CPF regression: 18 actual application cases and date/source negative controls.
- Vite production build and Cloudflare static-asset worker build.
- Staged diff whitespace check with `core.whitespace=cr-at-eol` to accommodate existing Windows line endings.

The build emits existing extension/config-loader, chunk-size and deprecated build-option warnings. No new dependency, statutory rate or treaty text was introduced. `npm` was unavailable on this host, so validation used the repository's underlying Node commands; `validate.ps1` records them and exits on failure.

The earlier checkpoint's published reports show 350 unchanged answers / 213 prior-correct answers preserved, and earlier broad results. Those reports predate this implementation (including the new WHT route), so **they do not establish preservation or a broad-suite pass for this target**. Root lint previously failed on an unrelated local archived artifact; smoke/full had environment-dependent MAS diagnostic results. Current broad smoke/full, root lint and the 350-answer replay were not rerun for this target. See the earlier reports for their precise snapshots rather than inferring current results.

CI: the checked-in workflow runs on main/master pushes and PRs targeting main/master, not this feature-branch push. No CI dispatch or PR creation is included here; publication alone supplies no passing CI evidence. Live browser/model acceptance and production behavior are unverified.

Independent review during development covered the CPF repairs and an earlier WHT source/concept implementation. The latest WHT natural routing and fallback-coverage exception have not had a final independent review; this is a primary focus for the receiving reviewer.

## Review focus and remaining work

- Try alternative employee names, bare references and ownership ambiguity; dates must never transfer between people.
- Try relative offsets, intervening sentences and conflicting date anchors; the current-workflow exception must not verify future payroll applicability.
- Inspect nested passive grammar and preserve explicit reporting requests without creating unsolicited IRAS workstreams.
- Inspect the strict general-treaty predicate, complete-passage proof and semantic fallback exception. Try named treaties, rates, categories, extra requests, mixed authorities and specific applicability claims.
- Check the factual scope of every WHT sentence against the retained native IRAS passages, rather than treating a source URL as claim proof.
- Distinguish fixture-plan replay from the actual natural `processAccountingQuery` acceptance case. Negative fallback/source checks do not by themselves prove live model behavior.
- Before merging, rerun broad suites and the frozen-answer preservation capture, independently assess intentional WHT answer changes, and obtain CI evidence. Preserve existing source/evidence safeguards.

All nine code/test changes are in the implementation commit. The subsequent evidence commit contains this handoff, the validation script and logs. Unrelated local untracked artifacts, temporary corpora and runtime files remain local and are not part of this review. The previous raw 350-answer captures remain local; their comparison reports cannot be independently replayed from GitHub alone.

## Evidence

Current evidence directory (on the published branch): https://github.com/dexrrick/accounting/tree/codex/statutory-knowledge-expansion-20261030/artifacts/statutory-review-wht-expansion-20261102

- [Current check results](validation-results.json)
- [Validation commands](validate.ps1)
- [WHT production replay log](wht-production-regression.log)
- [IRAS/MAS source log](iras-mas-source-regression.log)
- [CPF application log](cpf-application-regression.log)
- [Maintained lint](maintained-lint.log), [TypeScript](typecheck.log), [Vite](vite-build.log), [Worker](worker-build.log)
- Earlier, non-current [preservation report](https://github.com/dexrrick/accounting/blob/46261d8976d5e2ed6fadb9d735c438e651f99e12/artifacts/statutory-review-three-safeguards-20261102/preservation-comparison.json) and [checkpoint summary](https://github.com/dexrrick/accounting/blob/46261d8976d5e2ed6fadb9d735c438e651f99e12/artifacts/statutory-review-three-safeguards-20261102/completion-summary.json).

## Ready-to-copy review prompt

Independently review the changes identified above in https://github.com/dexrrick/accounting, branch `codex/statutory-knowledge-expansion-20261030`, implementation commit `57077378435a1f3388af7d0933ff9fec7c6ebad4` against base `46261d8976d5e2ed6fadb9d735c438e651f99e12`, using your GitHub access. Confirm the exact commit you inspected. Use the handoff as context and verify its claims against the code, diff, tests, and available CI evidence. Report actionable findings with severity, file and line references, impact, and suggested fixes. State any access or verification limitations. Keep the review read-only.
