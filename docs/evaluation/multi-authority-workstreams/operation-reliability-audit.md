# Operation and reliability follow-up audit

30/09/2026. Base branch `codex/multi-authority-workstreams`, commit `e67309a`; clean working tree before this follow-up. This audit precedes production changes. Historical corrected and frozen held-out reports and labels remain unchanged. Held-out observations are descriptive only and will not supply implementation examples, new regression questions, or live tuning cases.

## Confirmed operation failures

All 15 incorrectly labelled corrected matched issues and the one held-out matched issue selected EXPLAIN_RULE. Repeated rows are grouped below; the run IDs retain every observed failure. Expected alternatives are the existing frozen contracts, not new labels.

| Case and runs | Full question / requested intent | Selected → expected operation | Potential downstream effect | Owning correction |
|---|---|---|---|---|
| A-original, originalABCD-1; 2 issues | An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief? Separate employer and employee payable contributions; retain the separate relief explanation. | EXPLAIN_RULE → CALCULATE or CHECK_ELIGIBILITY for each contribution; an amount request favors CALCULATE | Source-only evidence can bypass case-fact application checks and calculation handling; scope is already correct | Generic prompt/schema guidance; no arbitrary deterministic operation replacement |
| C-original, originalABCD-1, -2, -3; 6 issues | Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee? Two particular taxpayers' outcomes. | EXPLAIN_RULE → CHECK_ELIGIBILITY or DETERMINE_TREATMENT for both | Case facts and applicability conditions can be omitted, affecting answer generation; corporate/employee scope is already correct | Generic prompt/schema guidance |
| A-paraphrase-2, expanded-1; 1 issue | For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF? Employer payable outcome; no employee contribution calculation requested. | EXPLAIN_RULE → CALCULATE or CHECK_ELIGIBILITY for employer contribution | Can suppress required case facts and payable calculation | Generic prompt/schema guidance; preserve two requested issues |
| C-paraphrase-3, expanded-1; 2 issues | Is the employee taxed on a housing allowance before considering whether the company may deduct what it paid? Two applied tax outcomes, despite sequencing language. | EXPLAIN_RULE → CHECK_ELIGIBILITY or DETERMINE_TREATMENT | Can omit facts for employee taxability and company deductibility; an extra model interaction is a separate decomposition fault | Generic prompt/schema guidance; sequencing alone is not another interaction outcome |
| C-paraphrase-4, expanded-1; 2 issues | Our firm gives an employee a housing benefit. How is it treated for the employee's tax and for the company's deduction? Separate case-specific treatments. | EXPLAIN_RULE → CHECK_ELIGIBILITY or DETERMINE_TREATMENT | Can turn an applied answer into unsupported general guidance or skip fact checks | Generic prompt/schema guidance |
| adversarial-C-employee-benefit, expanded-1; 1 issue | The employer provides accommodation to staff. What tax does the employee pay on the benefit? Determine the recipient's tax treatment; no explicit numerical tax amount is established. | EXPLAIN_RULE → CHECK_ELIGIBILITY or DETERMINE_TREATMENT | Can skip benefit/taxpayer facts; does not authorize inventing a tax calculation | Generic prompt/schema guidance; no benchmark change |
| adversarial-D-workpass-and-salary-tax, expanded-1; 1 issue | A foreign employee needs a work pass and the company needs to know whether his salary is taxable. Apply tax treatment to that employee's salary. | EXPLAIN_RULE → DETERMINE_TREATMENT or CHECK_ELIGIBILITY for salary | Can omit employee-specific facts; employer context must not turn this into company taxation | Generic prompt/schema guidance; work-pass scope ambiguity remains separately documented |
| heldout-different-populations, expanded-1; 1 issue | An employee in Singapore earns SGD 5,200 monthly. Calculate only the employer's CPF contribution and explain whether the employee can claim personal tax relief for compulsory CPF paid. Employer calculation and employee eligibility differ. | EXPLAIN_RULE → CHECK_ELIGIBILITY or DETERMINE_TREATMENT for relief; employer CALCULATE already correct | Eligibility facts can be omitted despite a correct calculation issue | Descriptive audit only; apply the general case-versus-rule principle without tuning to this held-out case |

The root impact is observable in `deriveEvidenceRequirement` and `applicationForIssue`: EXPLAIN_RULE normally requires authoritative sources only, whereas treatment/eligibility/calculation/journal operations require case facts. A correct authority workstream does not correct a wrong operation. The previously reported local guards preserve selected operations rather than establish they are correct.

## Approved implementation boundary

Refine operation guidance per material issue: conceptual rule → EXPLAIN_RULE; requested interaction → EXPLAIN_INTERACTION; applied treatment → DETERMINE_TREATMENT; entitlement/applicability decision → CHECK_ELIGIBILITY; numerical result → CALCULATE; entries → PREPARE_JOURNAL; explicit comparison → COMPARE; reporting/filing duties → FILING_REQUIREMENT. A verb such as explain does not convert a particular person's entitlement into a general rule. Party nouns, illustrative amounts and multiple authorities alone do not establish case-specific intent or interaction.

Keep semantic-first interpretation and strict validation. Prefer prompt/schema improvement; there is not yet sufficient general per-issue evidence to replace valid model operations deterministically. Do not modify routing, statutory coverage, source admission, evidence gates, frozen labels or accounting calculations. Ensure legacy flags remain consistent and case-specific facts are not weakened.

## Controlled reliability experiment design — fixed before calls

Use four corrected-fixture cases with prior invalid/timeout outcomes: A-paraphrase-3, A-paraphrase-4, D-original and D-paraphrase-1. Exclude held-out cases. Compare 8,000 ms and 15,000 ms, with two independent observations per arm/case (16 requests total). Alternate order by case and reverse it on the second observation to reduce systematic order effects. Keep model, prompt/source hash, temperature, sequential execution and request-start pacing of at least 15,250 ms identical. No retries. This is a modest descriptive sample, not a statistical causal guarantee.

Use the interpreter's existing injected structured-call dependency to override timeout in the experiment only. Run before production prompt changes so both arms use the historical prompt. Save new uniquely named JSON/Markdown with every outcome, latency, safe response-size/validation diagnostics, and semantic/dimension/routing comparisons; refuse to overwrite any existing artifacts. Do not persist credentials, raw prompts, raw invalid response text, arbitrary provider errors, or submitted user facts.

Invalid historical bodies were not retained and remain unreconstructable. New diagnostics should distinguish malformed JSON, schema rejection, clearly contradictory contract fields, size rejection and transport failure without claiming truncation from incomplete-looking text alone. Request/response sizes are measurements, not content logs. Production timeout remains 8 seconds until the supervisor weighs recovery against latency from this experiment.

## Controlled baseline results and timeout decision

The pre-change experiment completed 16/16 requests with identical prompt/system fingerprints within each case across arms. At 8 seconds: 5/8 valid, zero timeouts and three invalid responses, median 2,379 ms and maximum/p95 4,821 ms. At 15 seconds: 6/8 valid, zero timeouts and two invalid responses, median 2,347 ms and maximum/p95 4,760 ms. Four A-paraphrase-3 responses have objective contract contradictions; one A-paraphrase-4 response is malformed JSON. There is no evidence of response-size rejection or deadline-caused truncation in this experiment. Provider finish metadata and invalid text are not retained, so truncation cannot be proved or conclusively excluded.

Retain the 8-second production deadline. No experimental response exceeded eight seconds, so the one-response arm difference cannot demonstrate timeout recovery. The historical near-deadline distribution remains a concern under different provider conditions, but this bounded measurement does not justify a higher production latency cap. Independent review confirmed the methodology and this interpretation.

Baseline prompt lengths were 7,948–8,018 characters plus 259 system characters (all ASCII in these four cases). The transport uses JSON response MIME type rather than provider-enforced schema, selects the first candidate's first text part, and has no explicit output-token cap. Its abort timer covers fetch and response-body reading; the interpreter rejects text above 16,000 characters, malformed JSON, schema mismatch and contradictory flags. Historical invalid response sizes and finish reasons remain unavailable. Validated historical payloads are not exact raw response-size measurements.

Safe dimension signatures are order-sensitive and omit subjects and supplied facts. Different signatures can represent reordering or acceptable label alternatives. Missing/invalid repeats stay unassessed; matching hashes are not proof of identical meaning. Three D-paraphrase-1 observations have raw recall 1/2 despite both accounting/corporate dimensions and correct routing; with labels withheld, these cannot be confidently called omissions rather than the known phrase-matcher limitation.

## Final focused evaluation plan

After stable implementation and independent review, run `semantic-operation-followup.json` once: the seven corrected operation-failure cases plus five independent conceptual/comparison/journal/filing/interaction controls. Compare the seven-case results with the first valid historical response per case, fixed in `operation-followup-comparable-baseline.json`; report new controls separately. Keep frozen operation alternatives, but show actual contribution operations because CHECK_ELIGIBILITY can earn contract credit without requesting a numerical result.

Additionally run the two cases in `semantic-reliability-post-guidance.json` once to check whether general contract-consistency guidance addresses the observed contradictory/invalid outputs. They are corrected development cases, not held-out questions. This adds two final checks without repeating the 16-call deadline experiment or either full live suite. Both final probes use the unchanged 8-second production deadline, identical model and at least 15,250 ms start pacing, no retries and new output filenames. The small post-change sample and changed prompt do not establish a causal reliability improvement.

## Production results, review and final validation

The production changes are limited to `src/services/semanticQuestionUnderstanding.ts`: clearer generic operation guidance for each issue; explicit mixed-operation legacy projection rules; a complete, consistent journal-and-tax JSON example; and optional fixed-enum invalid-response diagnostics. The diagnostic helper runs only after the existing validator rejects a response. It does not admit additional payloads, replace valid operations, repair responses, or change the 8,000 ms deadline. The live evaluation runner carries safe reasons through pending checkpoints, finalized rows and individual attempt history, and strips unknown diagnostic strings on resume. No transport, authority-workstream, accounting calculation, statutory, source or retrieval rules changed.

Measured final prompts are 7,952–8,022 characters for the four inspected development cases: exactly four characters longer than their respective baselines. The system instruction remains 259 characters. Prompt/source hashes and sizes are in `operation-reliability-post-inspection.json`; this inspection used only an injected mock. Final interpreter SHA-256: `2e8c6cac5e0e5a2bb802823f30cb6c2af35040300c7e93eff519e65467893505`.

### Fixed seven-case comparison

The seven preselected corrected cases were each called once. Historical comparison rows were fixed before implementation and use the first valid historical call per case. Different prompt/time and a selected development sample prevent causal or population-wide inference.

| Measure | Historical selected rows | Follow-up selected rows |
|---|---:|---:|
| Valid interpretations | 7/7 | 7/7 |
| Matched-issue operation accuracy | 3/14 (21.4%) | 12/14 (85.7%) |
| Issue recall | 14/14 | 14/14 |
| Issue precision | 14/15 | 14/14 |
| Complete question issue coverage | 6/7 | 7/7 |
| Final workstream-set accuracy | 7/7 | 7/7 |

| Case | Historical operation score | Follow-up operation score | Actual follow-up operations in model order |
|---|---:|---:|---|
| A-original | 1/3 | 3/3 | CALCULATE, CALCULATE, EXPLAIN_INTERACTION |
| A-paraphrase-2 | 1/2 | 1/2 | CHECK_ELIGIBILITY for relief; EXPLAIN_RULE for employer contribution |
| C-original | 0/2 | 2/2 | CHECK_ELIGIBILITY, CHECK_ELIGIBILITY |
| C-paraphrase-3 | 0/2 | 2/2 | CHECK_ELIGIBILITY, CHECK_ELIGIBILITY |
| C-paraphrase-4 | 0/2 | 2/2 | DETERMINE_TREATMENT, CHECK_ELIGIBILITY |
| adversarial-C-employee-benefit | 0/1 | 0/1 | EXPLAIN_RULE |
| adversarial-D-workpass-and-salary-tax | 1/2 | 2/2 | CHECK_ELIGIBILITY, CHECK_ELIGIBILITY |

The original two contribution amounts selected CALCULATE, rather than merely receiving credit for the accepted CHECK_ELIGIBILITY alternative. The A-paraphrase-2 employer amount and adversarial accommodation-tax treatment still select EXPLAIN_RULE, retaining source-only evidence requirements. These are unresolved model errors; local guards do not correct them. C-paraphrase-3 no longer adds an unrequested interaction issue in this observation. Recall, precision and routing did not regress on the comparable seven cases or focused regressions; broader absence of regression is unproved.

### Controls and reliability checks

Of five independent controls, three validated: general comparison → COMPARE, requested journal → PREPARE_JOURNAL, employer filing → FILING_REQUIREMENT. All three matched operations and workstream sets are correct. General recognition and general interaction each returned INVALID_RESPONSE / SCHEMA_MISMATCH. They have no historical comparable control calls, so these failures are not established new regressions. They nevertheless prevent a claim that conceptual model behavior is reliable. Their invalid content was not retained and cannot identify the exact rejected field.

The two once-only reliability checks yielded A-paraphrase-3 INVALID_RESPONSE / CONTRADICTORY_FIELDS (2,425 ms), and A-paraphrase-4 valid (2,280 ms), with CALCULATE, CALCULATE, DETERMINE_TREATMENT and 3/3 matched operations. The first case's contradiction persists despite the consistent example and projection guidance. This small changed-prompt observation does not establish reliability improvement.

Across the final 12+2 checks: 14 requests, 14 provider responses, 11 valid interpretations, three invalid responses, zero retries, timeouts, provider failures or 429s; maximum latency 2,425 ms. The minimum request-start gap across both runs was 15,251 ms (under four starts per minute). RPM limiting is not evidenced as the cause of these observed failures; this does not exclude quota pressure under other concurrent traffic or historical conditions. The 12-case report scores 15/17 matched operations and 10/12 complete coverage; invalid responses are excluded from matched-issue denominators. Runtime guard/routing checks pass for all 14 calls and do not score substantive answer correctness.

Results are preserved in `semantic-operation-followup-live.{json,md}`, `semantic-reliability-post-guidance-live.{json,md}` and the derived `operation-reliability-comparison.json`. Historical corrected/held-out reports and frozen fixtures remain unchanged. Held-out results informed only the requested descriptive audit, not implementation examples, new regression questions, tuning or live probes.

### Independent review and validation

The builder implemented the scoped changes; the independent reviewer inspected implementation, diagnostics/privacy, multi-issue handling, regression sufficiency, experiment methodology and final outcome denominators. Two experiment-harness findings were fixed before calls: Set membership must not throw during invalid-payload diagnosis, and incomplete/invalid repeat observations must remain unassessed rather than be labelled stable. Supervisor review also required safe reason preservation on individual attempts and narrowed the diagnostic helper's type input. The final reviewer found no material implementation issues and agreed with retaining eight seconds and holding merge. Mocked tests establish contracts and guards, not model accuracy.

Focused Node 22.23.1 checks passed: semantic operations, semantic question understanding, material issue decomposition, authority workstreams, runner safety, and the reliability-experiment harness. Lint and TypeScript/production build passed; lint reports existing repository/ignored temporary-script warnings, and build reports existing large-chunk/deprecated-option warnings. Smoke passed 49/49 suites; the single final full suite passed 69/69. The shared semantic path justified full validation across accounting/statutory callers. `git diff --check` passed. No live integration suite is required for unchanged source admission/transport behavior.

### Merge recommendation and remaining work

**Hold merge to main.** The implementation is reviewed and the observed operation accuracy improved, but two selected operation errors, the persistent contradictory payload, and two unresolved conceptual schema failures remain. Strict fallback and evidence gates stay intact. This is a committed checkpoint for review and subsequent work, not an unqualified release-readiness claim. No merge or deployment is authorized or performed.

A future scoped reliability task should improve safe field-level contract diagnostics and investigate generic intent/contract consistency using independent development controls. Do not weaken the validator, replace operations from question keywords, broaden statutory coverage, silently relabel frozen cases, or retry these once-only reports to hide failures. Existing taxonomy coverage gaps, subject-matcher limitations, absent raw invalid/finish metadata, small samples and lack of end-to-end substantive-answer scoring remain explicit limitations.
