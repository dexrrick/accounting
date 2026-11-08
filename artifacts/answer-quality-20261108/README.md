# Live answer-quality assessment — 8 November 2026

The tested application commit is [2a282cef56a42e99b7f057de22e863258fddb972](https://github.com/dexrrick/accounting/commit/2a282cef56a42e99b7f057de22e863258fddb972), on `codex/project-charter-simplification-20261103`. This directory publishes assessment artifacts only; it does not implement the recommended fixes.

The eight original cases produced seven failures and one partial answer on **core usefulness**. None fully answered its request. All preserved the no-journal boundary. This is a small, deliberately selected sample, not an estimated production failure rate.

## Start here

- [Assessment and prioritized findings](assessment.json)
- [Readable report](report.html) — download/open locally to render the HTML; GitHub shows its source
- [Questions](cases.json) and [independent official-source rubric](rubric.json)
- [Capture index](capture-summary.json) and [raw-capture SHA-256 manifest](capture-manifest.json)
- [No-network routing diagnostic](routing-diagnostic.json)

## Captures

| Case | Core usefulness | Raw evidence |
|---|---|---|
| Accrual versus cash | Fail | [Capture](answers/accounting-accrual.json) |
| Asset register versus ledger | Fail | [Capture](answers/accounting-asset-register.json) |
| IRAS private car | Fail after successful retry | [Successful capture](answers/iras-private-car-retry1.json); [initial HTTP503](answers/iras-private-car.json) |
| CPF employer responsibility | Fail | [Capture](answers/cpf-employer-responsibility.json) |
| MOM salary versus overtime | Fail | [Capture](answers/mom-salary-overtime.json) |
| ACRA sole director and secretary | Partial | [Capture](answers/acra-sole-director-secretary.json) |
| MAS portfolio management | Fail | [Capture](answers/mas-fund-management-startup.json) |
| Mixed CPF/MOM first employee | Fail | [Capture](answers/mixed-first-employee.json) |

The additional [paired accrual control](answers/accounting-accrual-control.json) removes the negative journal directive. It delivers useful core advice in one model call, with wording/citation caveats recorded in the assessment. It is excluded from the original eight-case score.

## Scope and limits

Real `processAccountingQuery`, Gemini `gemini-3.5-flash-lite`, and native source fetches were used. There were 21 model requests over ten attempts, including the initial transient HTTP503 and one successful later retry. The scripts enforce a 40-request overall budget, per-case limits, provider fail-fast behavior and a 150-second case timeout. Those boundaries do not measure normal automatic provider recovery.

The displayed answers, grounding traces, workstreams, candidate text where captured, network metadata and available usage metadata are retained. Request headers and environment values are not stored. The capture expected JSON, so raw streaming generation/usage is missing for the accrual and MAS cases; their final displayed answers remain available. Token totals are partial, not a billing total.

This was headless testing of the local source checkout. Browser UI, deployed Worker transport, CI and release/production acceptance were not performed. Source activation and deployment remain on hold.

## Review and reproduction

Review the source at the tested commit and compare each claim with the final displayed answer, model candidate and admitted evidence in its capture. Distinguish a safe refusal from a useful complete answer. Precise causes of most passage/coverage omissions remain unassigned; the negative-journal eligibility mismatch has a direct-function diagnostic and paired live control.

`run-live.mjs`, `run-remaining.ps1` and `routing-diagnostic.mjs` are the executed Windows harness snapshots and retain the original `D:/Accounting` / workspace paths. The capture index alone was normalized to relative links for publication; the ten raw answer files are byte-identical to the local captures. Their Git attributes preserve bytes.

No live calls are needed to inspect the saved evidence or regenerate the report with `node build-report.cjs`. Re-running the live harness requires Node22, this checkout's tsx dependency, local path adjustments and a configured GEMINI_API_KEY environment value; it makes real provider and source requests. Do not commit credential files.
