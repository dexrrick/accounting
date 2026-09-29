# Live semantic evaluation: multi-authority workstreams

**Model understanding measured: YES**

Measurement status: PARTIAL. Model: gemini-3.5-flash-lite. Mode: LIVE_GEMINI_SEMANTIC_AND_LOCAL_AUTHORITY_WORKSTREAMS_PARTIAL.

Unique cases: 26; attempted calls: 34; provider responses: 16; valid interpretations: 14; provider failures: 18.
Issue recall: 34/36 (94.4%); issue precision: 34/34 (100.0%); omission rate: 2/36 (5.6%).
Authority: 34/34 (100.0%); contextual authority: 31/34 (91.2%); domain: 34/34 (100.0%); population: 30/34 (88.2%); operation: 30/34 (88.2%).
Final workstream-set accuracy: 12/14 (85.7%); valid interpretation rate: 14/34 (41.2%); invalid/timeout/fallback rate: 20/34 (58.8%).
Semantic latency (ms): median 2105, p95 2701, max 2701; timeouts 0.

**Live measurement is partial: 16/34 provider responses; failures are reported separately.**

## Failure taxonomy

- MODEL_OMISSION: 2
- MODEL_FALSE_ISSUE: 0
- MODEL_WRONG_AUTHORITY: 3
- MODEL_WRONG_DOMAIN: 0
- MODEL_WRONG_POPULATION: 3
- MODEL_WRONG_OPERATION: 4
- MODEL_INVALID_SCHEMA: 2
- MODEL_TIMEOUT: 0
- RECONCILIATION_REJECTION: 3
- TAXONOMY_MAPPING_GAP: 12
- RUNTIME_ROUTING_FAILURE: 0

## Per-call results

| Run | Case | Issue recall | Issue precision | Workstream set | Taxonomy |
|---|---|---:|---:|---|---|
| originalABCD-1 | A-original | 3/3 (100.0%) | 3/3 (100.0%) | PASS | — |
| originalABCD-1 | B-original | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-1 | C-original | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-1 | D-original | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| originalABCD-2 | A-original | n/a | n/a | N/A | MODEL_INVALID_SCHEMA |
| originalABCD-2 | B-original | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-2 | C-original | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-2 | D-original | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| originalABCD-3 | A-original | n/a | n/a | N/A | MODEL_INVALID_SCHEMA |
| originalABCD-3 | B-original | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-3 | C-original | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-3 | D-original | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | A-paraphrase-1 | 3/3 (100.0%) | 3/3 (100.0%) | FAIL | MODEL_WRONG_POPULATION, TAXONOMY_MAPPING_GAP, RECONCILIATION_REJECTION |
| expanded-1 | A-paraphrase-2 | 2/3 (66.7%) | 2/2 (100.0%) | PASS | MODEL_OMISSION, MODEL_WRONG_POPULATION, MODEL_WRONG_OPERATION, RECONCILIATION_REJECTION, TAXONOMY_MAPPING_GAP |
| expanded-1 | A-paraphrase-3 | 2/3 (66.7%) | 2/2 (100.0%) | FAIL | MODEL_OMISSION, MODEL_WRONG_POPULATION, RECONCILIATION_REJECTION |
| expanded-1 | A-paraphrase-4 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | B-paraphrase-1 | n/a | n/a | N/A | — |
| expanded-1 | B-paraphrase-2 | n/a | n/a | N/A | — |
| expanded-1 | B-paraphrase-3 | n/a | n/a | N/A | — |
| expanded-1 | B-paraphrase-4 | n/a | n/a | N/A | — |
| expanded-1 | C-paraphrase-1 | n/a | n/a | N/A | — |
| expanded-1 | C-paraphrase-2 | n/a | n/a | N/A | — |
| expanded-1 | C-paraphrase-3 | n/a | n/a | N/A | — |
| expanded-1 | C-paraphrase-4 | n/a | n/a | N/A | — |
| expanded-1 | D-paraphrase-1 | n/a | n/a | N/A | — |
| expanded-1 | D-paraphrase-2 | n/a | n/a | N/A | — |
| expanded-1 | D-paraphrase-3 | n/a | n/a | N/A | — |
| expanded-1 | D-paraphrase-4 | n/a | n/a | N/A | — |
| expanded-1 | adversarial-A-contextual-cpf | n/a | n/a | N/A | — |
| expanded-1 | adversarial-B-cpf-expense | n/a | n/a | N/A | — |
| expanded-1 | adversarial-C-employee-benefit | n/a | n/a | N/A | — |
| expanded-1 | adversarial-D-workpass-and-salary-tax | n/a | n/a | N/A | — |
| expanded-1 | adversarial-E-three-authorities | n/a | n/a | N/A | — |
| expanded-1 | adversarial-F-accounting-and-tax | n/a | n/a | N/A | — |

## Repeated A–D workstream stability

Observed/planned valid outputs: 10/12; assessed cases: 3/4; stable: 3; changed: none.

Unassessed cases: A-original (1/3).

## Per-call detail

### originalABCD-1 — A-original

Question: An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?

Valid: true; failure: none; latency: 2701 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Failures: none.

### originalABCD-1 — B-original

Question: We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting obligations should we consider?

Valid: true; failure: none; latency: 2178 ms.
Workstreams: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-1 — C-original

Question: Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?

Valid: true; failure: none; latency: 2105 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-1 — D-original

Question: How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?

Valid: true; failure: none; latency: 1960 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Failures: MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### originalABCD-2 — A-original

Question: An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?

Valid: false; failure: INVALID_RESPONSE; latency: 2259 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Failures: MODEL_INVALID_SCHEMA.

### originalABCD-2 — B-original

Question: We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting obligations should we consider?

Valid: true; failure: none; latency: 2498 ms.
Workstreams: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-2 — C-original

Question: Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?

Valid: true; failure: none; latency: 1944 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-2 — D-original

Question: How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?

Valid: true; failure: none; latency: 1704 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Failures: MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### originalABCD-3 — A-original

Question: An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?

Valid: false; failure: INVALID_RESPONSE; latency: 2067 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Failures: MODEL_INVALID_SCHEMA.

### originalABCD-3 — B-original

Question: We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting obligations should we consider?

Valid: true; failure: none; latency: 2124 ms.
Workstreams: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-3 — C-original

Question: Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?

Valid: true; failure: none; latency: 1873 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-3 — D-original

Question: How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?

Valid: true; failure: none; latency: 1743 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Failures: MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — A-paraphrase-1

Question: How much CPF should the employer and staff member contribute on a monthly salary of SGD 6,000, and how does the employee claim tax relief for mandatory CPF paid?

Valid: true; failure: none; latency: 2146 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Failures: MODEL_WRONG_POPULATION, TAXONOMY_MAPPING_GAP, RECONCILIATION_REJECTION.

### expanded-1 — A-paraphrase-2

Question: For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?

Valid: true; failure: none; latency: 1792 ms.
Workstreams: IRAS/IRAS_INDIVIDUAL_TAX, CPF/CPF_PAYROLL.
Failures: MODEL_OMISSION, MODEL_WRONG_POPULATION, MODEL_WRONG_OPERATION, RECONCILIATION_REJECTION, TAXONOMY_MAPPING_GAP.

### expanded-1 — A-paraphrase-3

Question: If a worker is paid SGD 6,000 monthly, explain the personal income tax relief linked to mandatory payroll CPF first, then state the employer and employee contribution amounts.

Valid: true; failure: none; latency: 2039 ms.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS, CPF/CPF_PAYROLL.
Failures: MODEL_OMISSION, MODEL_WRONG_POPULATION, RECONCILIATION_REJECTION.

### expanded-1 — A-paraphrase-4

Question: With a monthly wage of SGD 6,000, what are both sides' CPF payroll contributions, and what tax relief does the worker get for the compulsory deduction?

Valid: true; failure: none; latency: 2233 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — B-paraphrase-1

Question: We plan to bring a foreign staff member to Singapore on an Employment Pass. What must the company report for tax, what work-pass rules apply, and does payroll CPF apply?

Valid: false; failure: PROVIDER_ERROR; latency: 267 ms.
Workstreams: MOM/MOM_EMPLOYMENT.
Failures: none.

### expanded-1 — B-paraphrase-2

Question: Before hiring an overseas worker here, what tax filings will we as employer need to consider, are CPF contributions due, and what employment authorization is needed?

Valid: false; failure: PROVIDER_ERROR; latency: 255 ms.
Workstreams: CPF/CPF_PAYROLL.
Failures: none.

### expanded-1 — B-paraphrase-3

Question: For foreign staff in Singapore, can you cover employer tax reporting first, then the CPF position and the requirements for employing them?

Valid: false; failure: PROVIDER_ERROR; latency: 256 ms.
Workstreams: IRAS/UNKNOWN.
Failures: none.

### expanded-1 — B-paraphrase-4

Question: We hired someone from overseas. Explain the work-pass and employment obligations, whether CPF must be contributed, and the employer's reporting duties without assuming which authority handles them.

Valid: false; failure: PROVIDER_ERROR; latency: 264 ms.
Workstreams: none.
Failures: none.

### expanded-1 — C-paraphrase-1

Question: If the business pays for staff accommodation, can it deduct that cost and does the employee pay income tax on the benefit?

Valid: false; failure: PROVIDER_ERROR; latency: 264 ms.
Workstreams: none.
Failures: none.

### expanded-1 — C-paraphrase-2

Question: From the employer's perspective, how is a housing benefit for staff treated for company tax, and is it taxable employment income to the recipient?

Valid: false; failure: PROVIDER_ERROR; latency: 275 ms.
Workstreams: none.
Failures: none.

### expanded-1 — C-paraphrase-3

Question: Is the employee taxed on a housing allowance before considering whether the company may deduct what it paid?

Valid: false; failure: PROVIDER_ERROR; latency: 270 ms.
Workstreams: none.
Failures: none.

### expanded-1 — C-paraphrase-4

Question: Our firm gives an employee a housing benefit. How is it treated for the employee's tax and for the company's deduction?

Valid: false; failure: PROVIDER_ERROR; latency: 261 ms.
Workstreams: none.
Failures: none.

### expanded-1 — D-paraphrase-1

Question: Is a business expense tax deductible in Singapore, and how should the same item appear in the financial statements under SFRS(I)?

Valid: false; failure: PROVIDER_ERROR; latency: 259 ms.
Workstreams: ACRA/ACRA_CORPORATE, IRAS/IRAS_CORPORATE_TAX.
Failures: none.

### expanded-1 — D-paraphrase-2

Question: Please explain the accounting treatment for an expense and whether the company can claim it against corporate taxable income.

Valid: false; failure: PROVIDER_ERROR; latency: 259 ms.
Workstreams: none.
Failures: none.

### expanded-1 — D-paraphrase-3

Question: What is the SFRS(I) journal treatment for this cost, and separately can it be deducted for company income-tax purposes?

Valid: false; failure: PROVIDER_ERROR; latency: 256 ms.
Workstreams: none.
Failures: none.

### expanded-1 — D-paraphrase-4

Question: For financial reporting and Singapore company tax, how should a cost be recognised and is it deductible?

Valid: false; failure: PROVIDER_ERROR; latency: 264 ms.
Workstreams: none.
Failures: none.

### expanded-1 — adversarial-A-contextual-cpf

Question: Does mentioning CPF in a personal income tax relief question mean CPF Board determines the relief?

Valid: false; failure: PROVIDER_ERROR; latency: 260 ms.
Workstreams: none.
Failures: none.

### expanded-1 — adversarial-B-cpf-expense

Question: Our company pays CPF for employees. Is the CPF expense deductible for corporate income tax?

Valid: false; failure: PROVIDER_ERROR; latency: 278 ms.
Workstreams: none.
Failures: none.

### expanded-1 — adversarial-C-employee-benefit

Question: The employer provides accommodation to staff. What tax does the employee pay on the benefit?

Valid: false; failure: PROVIDER_ERROR; latency: 253 ms.
Workstreams: none.
Failures: none.

### expanded-1 — adversarial-D-workpass-and-salary-tax

Question: A foreign employee needs a work pass and the company needs to know whether his salary is taxable.

Valid: false; failure: PROVIDER_ERROR; latency: 266 ms.
Workstreams: none.
Failures: none.

### expanded-1 — adversarial-E-three-authorities

Question: How do CPF contributions, work-pass requirements and employee income-tax reporting interact for a foreign employee?

Valid: false; failure: PROVIDER_ERROR; latency: 284 ms.
Workstreams: CPF/CPF_PAYROLL.
Failures: none.

### expanded-1 — adversarial-F-accounting-and-tax

Question: A company records an employee benefit under SFRS(I) and wants to know whether it is tax deductible.

Valid: false; failure: PROVIDER_ERROR; latency: 245 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX.
Failures: none.

## Limits

- This report measures calls to interpretSemanticQuestion(query, GEMINI_API_KEY) and uses only the production prompt, schema, validation, and timeout.
- The caller must load repository .env/.env.local values through Node --env-file options; the runner does not read environment files itself.
- Authority workstream evidence retrieval is local-only; this evaluation measures semantic interpretation, reconciliation, and planned/final scope, not source freshness or evidence sufficiency.
- Issue identity matching uses deterministic phrase anchors in the held-out contract. Ambiguous subject matches require review.
- Topic hints from the model are recorded separately and never supply deterministic mapped topic IDs.

## Tested source

- Base commit: a03da5dad22212acbc8eabda9d91f17f0cf88f91 (codex/multi-authority-workstreams).
- Runtime: Node.js v22.23.1.
- Semantic interpreter SHA-256: 4383b8bcad4d6e3296f8bee86c8d28746e6fbdab2c9eeed15767bb0765566fe6.
- Prompt change: generic compound-issue decomposition guidance; no held-out question text or regex rules were added.
