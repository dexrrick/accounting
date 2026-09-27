# IRAS live validation — 27/09/2026

## Assessment and evaluated version

**Final working-tree remediation: LIVE_PASS for supported conditional answers, deterministic calculations and evidence-safe abstention.** This does not mean every question has enough facts for an unconditional tax conclusion.

The starting commit was `ec5acfafe078aade0066bfbc16559d65fd177efd` (`Index official sources and preserve list item boundaries`). Its initial focused live results were **LIVE_FAIL**: IR21 produced no admitted substantive claim, and bonus timing showed page headings and reporting-process text without its timing rules. The passing result applies to that commit **plus the four source/test files changed in this task**, not to the untouched commit. No commit or push was made.

The authoritative final capture is [iras-e2e-captures-final-v3.jsonl](iras-live-2026-09-27/iras-e2e-captures-final-v3.jsonl). It contains 19 benchmark questions and the mixed customer-meal journal question. The fixture oracle remains provisional; the assessment below is based on the actual captured output and source evidence. The prior [2026-09-27 baseline](iras-live-2026-09-27/iras-e2e-captures-complete.jsonl) and [historical assessment](iras_evidence_continuation_2026-09-27.md) were not modified.

## Environment and execution

Node **v22.23.1** passed `npm run preflight`. `D:\Accounting\.codex\.env` was absent. The user confirmed `C:\Users\Admin\.codex\.env`; it existed but contained a UTF-8 BOM, causing Node's environment-file parser to include an invisible leading character in the variable name. Initial checks therefore returned false for the ordinary `GEMINI_API_KEY` name.

The file was explicitly loaded with Node's `--env-file` option. A process-only preload normalized the BOM-prefixed variable name; the subsequent boolean presence check returned true. The credential file was not rewritten, and the credential value was never printed or saved in an artifact. The existing shell PATH was preserved with Node 22 prepended; no application dependency on the credential file or its PATH entry was introduced.

The successful command form was:

```powershell
node --env-file=C:/Users/Admin/.codex/.env --import "data:text/javascript,process.env.GEMINI_API_KEY=process.env.GEMINI_API_KEY||process.env[String.fromCharCode(65279)+'GEMINI_API_KEY']||''" --import tsx scripts/run_iras_live_validation.mjs --out=docs/evaluation/iras-live-2026-09-27/iras-e2e-captures-final-v3.jsonl
```

The runner used the production `processAccountingQuery` path, real official-source retrieval and Gemini `gemini-3.5-flash-lite`. Its transport-level `LIVE_PASS` and retrieval `NOT_EVALUATED` fields are not semantic verdicts. Final source admission, claims, answers and citations were inspected separately.

## Focused cases

| Case | Initial result on ec5acfa | Final result | Assessment |
| --- | --- | --- | --- |
| IR21 | Gemini succeeded, but its introduction plus one list item failed whole-passage verification; no substantive answer | Correct IR21 classification/topic and mapped official page; one complete general source paragraph admitted through the all-rejected-provider fallback; the incomplete provider claim remains rejected | **LIVE_PASS, conditional**. General timing and withholding wording is supported. Citizenship/status, cessation/departure details and exemptions remain unresolved. |
| Bonus timing | Gemini returned JSON with an empty `taxClaims` array; fallback stopped at `On this page:` and emitted headings/process text | Correct bonus and AIS topics; both mapped pages fetched and validated; four general bonus passages plus one reporting passage admitted through the empty-claims fallback | **LIVE_PASS, conditional**. Contractual, contingent, subsequently binding discretionary, and non-contractual timing remain distinct. No April/June tax-year conclusion is inferred. |

Both cases had no local evidence sufficient to answer and used `MAPPED_SOURCE`; sitemap discovery was not invoked. Candidate URLs and final fetched URLs matched the expected official IRAS pages, with successful title/content topic checks and verified URL provenance. Their evidence-quality status is `LIMITED` because material user facts remain missing, not because provider transport failed.

The captures retain the classification, topic IDs, routing trace, candidate/final URLs, extracted source paragraphs, evidence gate, raw Gemini candidate, provider status, accepted/rejected claims, final answer, citations and missing facts. The initial focused captures are [IR21](iras-live-2026-09-27/final-ir21.jsonl) and [bonus](iras-live-2026-09-27/final-bonus.jsonl); the corrected focused captures are [IR21 v2](iras-live-2026-09-27/final-ir21-v2.jsonl) and [bonus v2](iras-live-2026-09-27/final-bonus-v2.jsonl). The final full capture confirms the same behavior after the later verifier/local-evidence corrections.

Fallback quotes are exact complete source passages and are passed through the existing claim verifier. Dated examples, unrelated FAQs and incomplete list introductions are excluded. The advance-bonus paragraph attached to an example conclusion is omitted rather than detached or joined to a distant conditional paragraph. Missing terms, entitlement/payment dates and reporting year remain requested. Regression tests confirm that absent recognized passages and unknown colon introductions fail closed.

## Final benchmark observations

Counts below are from the final 20-case capture only. Citation counts are emitted Markdown-link occurrences, including repeated links, rather than unique URLs. Empty provider responses and valid JSON containing an empty claims array are different measures.

| Measure | Previous 27/09 baseline | Final v3 |
| --- | ---: | ---: |
| Distinct live cases | 20 | 20 |
| Gemini provider calls, all answer generation | 6 | 6 |
| HTTP/API or transport failures | 0 | 0 |
| Empty successful provider responses | 1 | 0 |
| Valid responses with empty `taxClaims` | 3 | 2 |
| Validated-local answer routes | 14 | 14 |
| Mapped-source routes | 5 | 5 |
| Sitemap-discovery routes | 0 | 0 |
| Successful official GETs | 7 | 7 |
| Failed official GETs | 0 | 0 |
| Accepted source claims/summaries | 28 | 38 |
| Rejected claims | 2 | 3 |
| Emitted verified citation occurrences | 15 / 15 | 25 / 25 |

The remaining route is the mixed meal journal, whose tax evidence is insufficient. Across all 20 cases, evidence gates returned two `LOCAL_SUFFICIENT`, 17 `LIMITED`, and one `INSUFFICIENT`. The two empty claims arrays were bonus timing and the mixed meal case; neither was an empty provider response.

All 38 final accepted claims passed an additional verifier check against their captured eligible records and date context. All 25 emitted links matched records with independent verified URL provenance. Three unsupported claims were prevented:

1. The IR21 introduction with an incomplete list.
2. The overseas-services restriction quoted without its immediately following `Exceptions:` block.
3. The 8% rate offered outside its effective period for the December 2022 scenario.

A sitemap hit is not counted as evidence. **This benchmark did not exercise live sitemap discovery.** Its discovery-only behavior remains regression-tested; these live results establish the local and mapped retrieval paths.

## Substantive comparison and preserved behavior

| Scenarios | Final assessment |
| --- | --- |
| Customer/supplier meals and passenger-car input GST | Conditional documentation/restriction passages supported; eligibility facts remain requested. |
| Overseas services | General Section 21(3) conditions supported; unsafe partial exception-bearing quotation rejected. No automatic zero-rating or out-of-scope treatment is inferred from an overseas label. Nature, customer location and qualifying category remain unresolved. |
| December 2022/January 2023 GST boundary | Reviewed 7% and time-of-supply evidence retained; out-of-period 8% claim rejected; no unconditional transition treatment without supply facts. |
| Generic CIT expense; renovation and dated Section 14N cases | Reviewed rule evidence retained, with expense nature, period, cap/election and other applicable facts requested. |
| CIT motor cars/capital allowances; loss carry-forward | Existing reviewed restrictions and eligibility conditions retained. |
| Withholding interest and management fees | Existing reviewed conditional guidance retained; residence, treaty, payment and performance facts remain unresolved. |
| IR21 and bonus timing | Previously failed substantive outputs now supported as described above. |
| Dated GST 2023 and 2024 | Exact 8% and 9% local source quotations retained; SGD 1,000 produces GST 80/90 and totals 1,080/1,090 respectively. |
| Section 13W before/from 2026; Form C-S (Lite)/FTC | Existing dated evidence and conditional deterministic conclusions retained. |
| Mixed customer-meal journal | SGD 200 debit and credit remain balanced; insufficient GST evidence triggers abstention and missing-fact requests. |

The final comparison found no material regression relative to the baseline. Conditional answers remain conditional. The earlier intermediate runs exposed example-selection pollution and local-rate quotation omissions; those were corrected and remain visible in their separate captures. Model sampling changes the number of relevant accepted quotations, so a higher claim count is not itself the pass criterion.

## Changes, review and validation

The builder changed only:

- `src/services/irasEvidencePolicy.ts`: navigation handling, bounded verified fallback after all provider claims are rejected, conservative general-passage selection for live IR21/bonus evidence, and preservation of reviewed local quotations including short rate text.
- `src/verification/claimEvidenceVerifier.ts`: recognize `Exception(s)` as attached qualifications and reject incomplete colon-ended/empty-label quotes. No new list-span acceptance was added.
- `tests/regression/test_iras_evidence_pipeline.mjs`: captured-shape fallback, example/FAQ exclusion, missing-anchor/unknown-colon failure, and exact local 8%/9% quotation checks.
- `tests/regression/test_iras_claim_evidence_verifier.mjs`: omitted exception block, bare label and rule-plus-label rejection; existing complete qualification spans remain positive controls.

The independent reviewer identified example-context and local-quotation issues during the remediation; these were corrected before the final capture. Its final review of the diff and final-v3 capture found no remaining material issue. Supervisor verification used Node 22: preflight, lint, build, focused IRAS regressions, smoke suite, full `npm test`, and `git diff --check` passed. Existing lint warnings and the Vite large-chunk warning remain non-fatal. No historical assessment, baseline capture, benchmark oracle, credential file, statutory rate or other-authority implementation was changed.

Nine new capture files preserve the whole task: six focused executions and three full 20-case runs, for **66 case executions and 24 Gemini calls**. Initial environment-loading failures made no provider calls and produced no capture. All nine captures passed a credential-shaped-text scan.

Final source file SHA-256 identifiers:

- `irasEvidencePolicy.ts`: `2D4BB19FEAE8B0EA3A04C19D5704A1BBC7CB93F7026C9A5AFA180B89A2854C40`
- `claimEvidenceVerifier.ts`: `0A4BDBD3FE13AC693234D0202315D1F5E4F7FEB373FB021BDBCFD1CC8F27E5C6`

IRAS is ready to serve as the reference implementation for the next multi-authority discovery phase, with the live-sitemap coverage limitation stated above. No MOM, CPF, MAS, ACRA or SSO expansion was started.
