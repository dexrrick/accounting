# CPF integration and ACRA discovery — 10 October 2026

CPF safeguards are merged. ACRA discovery is implemented and independently approved for pull-request review. **ACRA merge and production deployment remain on HOLD pending canonical acceptance.**

## Commits and branch

| Change | Commit |
|---|---|
| Existing CPF sitemap PR #11 merge | `38cf1198fc567e13c463c7deffd1cf6be75f027e` |
| PR #10 integration of updated main and combined regression | `47eedc5244242c1052e62baafe6a5197a2d50249` |
| CPF safeguards PR #10 merge | `40d6b63d81fd72dd096e6018d9c4ce097e838690` |
| ACRA implementation | `9424662b28a1de02769c50503b006e3ccd26fcb8` |

ACRA branch: `codex/acra-official-source-discovery`, created from updated main at `40d6b63`. Git merged the CPF branches cleanly without a textual conflict. Both implementations were retained and an integration regression proves exact-query completeness, candidate-only CPF evidence and IRAS isolation.

[CPF main CI](https://github.com/dexrrick/accounting/actions/runs/38002887631) passed. ACRA PR CI is separate from the completed local checks below.

## Official discovery and implementation

Fresh requests returned HTTP 200 for [ACRA robots.txt](https://www.acra.gov.sg/robots.txt), its declared [sitemap.xml](https://www.acra.gov.sg/sitemap.xml), and all six representative articles below. The captured XML contained 963 URLs. Current official navigation indexes at [/manage/companies/](https://www.acra.gov.sg/manage/companies/) and [/manage/companies/legal-requirements-common-offences/](https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/) were also inspected. No guessed sitemap URL was configured.

| Area | Representative article | Captured-page validation |
|---|---|---|
| Annual returns | [Deadline and requirements](https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-annual-returns-companies/deadline-requirements/) | PASS |
| Financial statements | [Financial reporting duties for directors](https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/preparing-financial-statements/financial-reporting-duties-for-directors/) | PASS |
| XBRL | [Filing requirements and exemptions](https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-financial-statements-in-xbrl-format/requirements-exemptions/) | PASS |
| Audit exemptions | [Small company concept](https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/preparing-financial-statements/audit-exemptions/) | PASS |
| Company compliance | [Directors' duties and obligations](https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/directors-duties/) | PASS |
| Corporate filings | [Return of allotment of shares](https://www.acra.gov.sg/manage/companies/shares/allotment-of-shares/) | PASS |

Discovery reuses bounded sitemap, robots and restricted official-domain search fallbacks. Corporate ACRA candidates require HTTPS and exact root/www ACRA hosts, local-company routes, relevant titles and substantive body text. Foreign-company, VCC, other entity and accounting-standard routes cannot satisfy local-company scope. Existing four initial-candidate and bounded one-hop limits remain.

An ACRA-only extraction option reads Isomer's substantive main instead of its preceding government-banner article. It excludes semantic breadcrumbs, icon-adjacent/current-page labels, navigation and related-page cards while retaining inline-linked instructions and substantive ordered lists. Topic metadata prefers the observed allotment wording within the existing cap. Current discovery cannot establish unverified explicit or relative historical periods.

Accounting-standard discovery retains ASC/IFRS hosts; IRAS and CPF behavior remains covered by regression tests. Index entries and search results are metadata only. Separately validated pages remain `LIVE_EXTERNAL / CANDIDATE / DISCOVERED_EVIDENCE`; discovery does not establish a verified accounting answer.

Files: three production modules (`officialSitemapDiscovery.ts`, `externalSourceValidator.ts`, `groundingContextBuilder.ts`), test registration, one current provider-list expectation, a new ACRA regression and a new attributed capture fixture. No existing protected evaluation input was edited.

## Validation and independent review

| Check | CPF integration | ACRA final implementation |
|---|---:|---:|
| Lint | PASS | PASS |
| TypeScript/production build | PASS | PASS |
| Registered smoke suites | 98/98 | 99/99 |
| Registered full suites | 118/118 | 119/119 |
| Independent review | No material findings | Approved; no remaining material findings |
| Full 963-URL sitemap plus complete captured HTML replay | N/A | 6/6 accepted candidates |
| Existing protected file hashes | Unchanged | 426/426 unchanged |

Runtime: Node 22.23.3. Full suites include every smoke suite. External fetch/HTTP calls were blocked during regression execution; a temporary external preload used Node's tsx loader instead of the CLI because sandbox IPC sockets were unavailable. Registered tests and protected inputs were not altered for this workaround. Generated untracked compatibility fixtures were cleaned between suite invocations after an initial temporary-file collision. **Zero live Gemini calls were made.** Existing lint and build warnings remain; checks exited successfully.

Independent review reproduced and closed breadcrumb evidence admission and full-index share-allotment ranking gaps. Review also verified all six original capture SHA256 values, exact main-section text preservation and retained semantic attributes. The full-sitemap replay used freshly downloaded XML/HTML through the actual resolver with offline capture transport; it is discovery acceptance, not a production browser/proxy or model acceptance run.

## Remaining defects and deployment readiness

- No remaining material ACRA implementation finding or failing registered suite.
- Existing provisional IRAS case `cit-form-cs-lite-foreign-tax-credit-ya2026` reports a non-gating missing `IRAS_CIT_FOREIGN_TAX_CREDIT_SOURCE_MAP`. It remains `PENDING_REVIEW`; the same observation was reproduced on baseline main `40d6b63`, so it is not introduced by ACRA.
- Existing CPF/ACRA governed workstreams admit reviewed local evidence only. Newly discovered live pages cannot automatically verify these workstreams; this admission policy was preserved.
- [Issue #9](https://github.com/dexrrick/accounting/issues/9) remains open for fresh official-source retrieval through the supported production path, canonical acceptance and production latency assessment. General semantic claim entailment is not established by these discovery checks.
- ACRA is ready for PR review. Canonical production acceptance was not run; ACRA must remain unmerged and undeployed until it passes. No production deployment was performed.
