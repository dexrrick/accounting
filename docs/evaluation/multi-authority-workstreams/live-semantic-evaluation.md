# Live semantic evaluation: multi-authority workstreams

**Model understanding measured: YES**

Measurement status: COMPLETE. Model: gemini-3.5-flash-lite. Mode: LIVE_GEMINI_SEMANTIC_AND_LOCAL_AUTHORITY_WORKSTREAMS.

Unique cases: 26; logical case calls: 34; provider request attempts: 54; provider response attempts: 36; final valid interpretations: 33.
Provider attempt failures: 18; rate limited (429): 0; final provider-error cases: 0; final rate-limited cases: 0.
Provider request attempts by runtime: v22.23.1: 34; v24.19.0: 20.
Issue recall: 66/77 (85.7%); issue precision: 66/74 (89.2%); omission rate: 11/77 (14.3%).
Authority: 64/66 (97.0%); contextual authority: 62/66 (93.9%); domain: 64/66 (97.0%); population: 60/66 (90.9%); operation: 49/66 (74.2%).
Final workstream-set accuracy: 25/33 (75.8%); valid interpretation rate: 33/34 (97.1%); invalid/timeout/fallback rate: 3/54 (5.6%).
Semantic latency (ms): median 2235, p95 2957, max 2985; timeouts 0.

## Failure taxonomy

- MODEL_OMISSION: 10
- MODEL_FALSE_ISSUE: 7
- MODEL_WRONG_AUTHORITY: 5
- MODEL_WRONG_DOMAIN: 2
- MODEL_WRONG_POPULATION: 5
- MODEL_WRONG_OPERATION: 13
- MODEL_INVALID_SCHEMA: 1
- MODEL_TIMEOUT: 0
- RECONCILIATION_REJECTION: 6
- TAXONOMY_MAPPING_GAP: 28
- RUNTIME_ROUTING_FAILURE: 0

## Provider attempt outcomes

- VALID_INTERPRETATION: 33
- INVALID_RESPONSE: 3
- PROVIDER_ERROR: 18

## Per-call results

| Run | Case | Attempts | Last provider status | Issue recall | Issue precision | Workstream set | Taxonomy |
|---|---|---:|---|---:|---:|---|---|
| originalABCD-1 | A-original | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | — |
| originalABCD-1 | B-original | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-1 | C-original | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-1 | D-original | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| originalABCD-2 | A-original | 2 | — | n/a | n/a | N/A | MODEL_INVALID_SCHEMA |
| originalABCD-2 | B-original | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-2 | C-original | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-2 | D-original | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| originalABCD-3 | A-original | 2 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | MODEL_WRONG_POPULATION, MODEL_WRONG_OPERATION, RECONCILIATION_REJECTION |
| originalABCD-3 | B-original | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-3 | C-original | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-3 | D-original | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | A-paraphrase-1 | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | FAIL | MODEL_WRONG_POPULATION, TAXONOMY_MAPPING_GAP, RECONCILIATION_REJECTION |
| expanded-1 | A-paraphrase-2 | 1 | — | 2/3 (66.7%) | 2/2 (100.0%) | PASS | MODEL_OMISSION, MODEL_WRONG_POPULATION, MODEL_WRONG_OPERATION, RECONCILIATION_REJECTION, TAXONOMY_MAPPING_GAP |
| expanded-1 | A-paraphrase-3 | 1 | — | 2/3 (66.7%) | 2/2 (100.0%) | FAIL | MODEL_OMISSION, MODEL_WRONG_POPULATION, RECONCILIATION_REJECTION |
| expanded-1 | A-paraphrase-4 | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | B-paraphrase-1 | 2 | — | 1/3 (33.3%) | 1/3 (33.3%) | FAIL | MODEL_OMISSION, MODEL_FALSE_ISSUE, MODEL_WRONG_AUTHORITY, MODEL_WRONG_DOMAIN, MODEL_WRONG_POPULATION, MODEL_WRONG_OPERATION, RECONCILIATION_REJECTION |
| expanded-1 | B-paraphrase-2 | 2 | — | 2/3 (66.7%) | 2/3 (66.7%) | PASS | MODEL_OMISSION, MODEL_FALSE_ISSUE, TAXONOMY_MAPPING_GAP |
| expanded-1 | B-paraphrase-3 | 2 | — | 2/3 (66.7%) | 2/3 (66.7%) | FAIL | MODEL_OMISSION, MODEL_FALSE_ISSUE, TAXONOMY_MAPPING_GAP |
| expanded-1 | B-paraphrase-4 | 2 | — | 2/3 (66.7%) | 2/3 (66.7%) | PASS | MODEL_OMISSION, MODEL_FALSE_ISSUE, TAXONOMY_MAPPING_GAP |
| expanded-1 | C-paraphrase-1 | 2 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | C-paraphrase-2 | 2 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | C-paraphrase-3 | 2 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | C-paraphrase-4 | 2 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | D-paraphrase-1 | 2 | — | 2/2 (100.0%) | 2/2 (100.0%) | FAIL | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | D-paraphrase-2 | 2 | — | 1/2 (50.0%) | 1/2 (50.0%) | PASS | MODEL_OMISSION, MODEL_FALSE_ISSUE, TAXONOMY_MAPPING_GAP |
| expanded-1 | D-paraphrase-3 | 2 | — | 1/2 (50.0%) | 1/2 (50.0%) | PASS | MODEL_OMISSION, MODEL_FALSE_ISSUE, TAXONOMY_MAPPING_GAP |
| expanded-1 | D-paraphrase-4 | 2 | — | 1/2 (50.0%) | 1/2 (50.0%) | PASS | MODEL_OMISSION, MODEL_FALSE_ISSUE, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-A-contextual-cpf | 2 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-B-cpf-expense | 2 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-C-employee-benefit | 2 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-D-workpass-and-salary-tax | 2 | — | 2/2 (100.0%) | 2/2 (100.0%) | FAIL | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-E-three-authorities | 2 | — | 3/3 (100.0%) | 3/3 (100.0%) | FAIL | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-F-accounting-and-tax | 2 | — | 1/2 (50.0%) | 1/1 (100.0%) | FAIL | MODEL_OMISSION, MODEL_WRONG_AUTHORITY, MODEL_WRONG_DOMAIN, RECONCILIATION_REJECTION |

## Repeated A–D workstream stability

Observed/planned valid outputs: 11/12; assessed cases: 3/4; stable: 3; changed: none.

Unassessed cases: A-original (2/3).

## Per-call detail

### originalABCD-1 — A-original

Question: An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2701 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: none.

### originalABCD-1 — B-original

Question: We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting obligations should we consider?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2178 ms.
Workstreams: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-1 — C-original

Question: Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2105 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-1 — D-original

Question: How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1960 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### originalABCD-2 — A-original

Question: An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?

Valid: false; final outcome: INVALID_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2336 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 INVALID_RESPONSE; #2 INVALID_RESPONSE.
Failures: MODEL_INVALID_SCHEMA.

### originalABCD-2 — B-original

Question: We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting obligations should we consider?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2498 ms.
Workstreams: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-2 — C-original

Question: Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1944 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-2 — D-original

Question: How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1704 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### originalABCD-3 — A-original

Question: An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2235 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 INVALID_RESPONSE; #2 VALID_INTERPRETATION.
Failures: MODEL_WRONG_POPULATION, MODEL_WRONG_OPERATION, RECONCILIATION_REJECTION.

### originalABCD-3 — B-original

Question: We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting obligations should we consider?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2124 ms.
Workstreams: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-3 — C-original

Question: Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1873 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-3 — D-original

Question: How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1743 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_AUTHORITY, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — A-paraphrase-1

Question: How much CPF should the employer and staff member contribute on a monthly salary of SGD 6,000, and how does the employee claim tax relief for mandatory CPF paid?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2146 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_POPULATION, TAXONOMY_MAPPING_GAP, RECONCILIATION_REJECTION.

### expanded-1 — A-paraphrase-2

Question: For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1792 ms.
Workstreams: IRAS/IRAS_INDIVIDUAL_TAX, CPF/CPF_PAYROLL.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_OMISSION, MODEL_WRONG_POPULATION, MODEL_WRONG_OPERATION, RECONCILIATION_REJECTION, TAXONOMY_MAPPING_GAP.

### expanded-1 — A-paraphrase-3

Question: If a worker is paid SGD 6,000 monthly, explain the personal income tax relief linked to mandatory payroll CPF first, then state the employer and employee contribution amounts.

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2039 ms.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS, CPF/CPF_PAYROLL.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_OMISSION, MODEL_WRONG_POPULATION, RECONCILIATION_REJECTION.

### expanded-1 — A-paraphrase-4

Question: With a monthly wage of SGD 6,000, what are both sides' CPF payroll contributions, and what tax relief does the worker get for the compulsory deduction?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2233 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — B-paraphrase-1

Question: We plan to bring a foreign staff member to Singapore on an Employment Pass. What must the company report for tax, what work-pass rules apply, and does payroll CPF apply?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2957 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_OMISSION, MODEL_FALSE_ISSUE, MODEL_WRONG_AUTHORITY, MODEL_WRONG_DOMAIN, MODEL_WRONG_POPULATION, MODEL_WRONG_OPERATION, RECONCILIATION_REJECTION.

### expanded-1 — B-paraphrase-2

Question: Before hiring an overseas worker here, what tax filings will we as employer need to consider, are CPF contributions due, and what employment authorization is needed?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2985 ms.
Workstreams: IRAS/IRAS_EMPLOYER_REPORTING, CPF/CPF_PAYROLL, MOM/MOM_EMPLOYMENT.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_OMISSION, MODEL_FALSE_ISSUE, TAXONOMY_MAPPING_GAP.

### expanded-1 — B-paraphrase-3

Question: For foreign staff in Singapore, can you cover employer tax reporting first, then the CPF position and the requirements for employing them?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2399 ms.
Workstreams: IRAS/IRAS_EMPLOYER_REPORTING, CPF/CPF_PAYROLL, MOM/MOM_EMPLOYMENT, IRAS/UNKNOWN.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_OMISSION, MODEL_FALSE_ISSUE, TAXONOMY_MAPPING_GAP.

### expanded-1 — B-paraphrase-4

Question: We hired someone from overseas. Explain the work-pass and employment obligations, whether CPF must be contributed, and the employer's reporting duties without assuming which authority handles them.

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2346 ms.
Workstreams: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_OMISSION, MODEL_FALSE_ISSUE, TAXONOMY_MAPPING_GAP.

### expanded-1 — C-paraphrase-1

Question: If the business pays for staff accommodation, can it deduct that cost and does the employee pay income tax on the benefit?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2241 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — C-paraphrase-2

Question: From the employer's perspective, how is a housing benefit for staff treated for company tax, and is it taxable employment income to the recipient?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2173 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — C-paraphrase-3

Question: Is the employee taxed on a housing allowance before considering whether the company may deduct what it paid?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 1902 ms.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — C-paraphrase-4

Question: Our firm gives an employee a housing benefit. How is it treated for the employee's tax and for the company's deduction?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2034 ms.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — D-paraphrase-1

Question: Is a business expense tax deductible in Singapore, and how should the same item appear in the financial statements under SFRS(I)?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2486 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, ACCOUNTING_STANDARDS/ACCOUNTING, ACRA/ACRA_CORPORATE.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — D-paraphrase-2

Question: Please explain the accounting treatment for an expense and whether the company can claim it against corporate taxable income.

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 1935 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_OMISSION, MODEL_FALSE_ISSUE, TAXONOMY_MAPPING_GAP.

### expanded-1 — D-paraphrase-3

Question: What is the SFRS(I) journal treatment for this cost, and separately can it be deducted for company income-tax purposes?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 1927 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_OMISSION, MODEL_FALSE_ISSUE, TAXONOMY_MAPPING_GAP.

### expanded-1 — D-paraphrase-4

Question: For financial reporting and Singapore company tax, how should a cost be recognised and is it deductible?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 1938 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_OMISSION, MODEL_FALSE_ISSUE, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-A-contextual-cpf

Question: Does mentioning CPF in a personal income tax relief question mean CPF Board determines the relief?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2853 ms.
Workstreams: IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-B-cpf-expense

Question: Our company pays CPF for employees. Is the CPF expense deductible for corporate income tax?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2056 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-C-employee-benefit

Question: The employer provides accommodation to staff. What tax does the employee pay on the benefit?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 1613 ms.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-D-workpass-and-salary-tax

Question: A foreign employee needs a work pass and the company needs to know whether his salary is taxable.

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2874 ms.
Workstreams: MOM/MOM_EMPLOYMENT, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-E-three-authorities

Question: How do CPF contributions, work-pass requirements and employee income-tax reporting interact for a foreign employee?

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2082 ms.
Workstreams: CPF/CPF_PAYROLL, MOM/MOM_EMPLOYMENT, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-F-accounting-and-tax

Question: A company records an employee benefit under SFRS(I) and wants to know whether it is tax deductible.

Valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 2; latency: 2036 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 PROVIDER_ERROR; #2 VALID_INTERPRETATION.
Failures: MODEL_OMISSION, MODEL_WRONG_AUTHORITY, MODEL_WRONG_DOMAIN, RECONCILIATION_REJECTION.

## Tested source

Commit: a03da5dad22212acbc8eabda9d91f17f0cf88f91.
Interpreter SHA-256: e27062764dcf61a0d12b3d310959ab5dc9ee68f647f20f300a693929d5555974.
Initial evaluation runtime: v22.23.1.
Report-generation runtime: v24.19.0.
Provider request attempts by runtime: v22.23.1: 34; v24.19.0: 20.
Prompt change: Generic compound-issue decomposition guidance: preserve distinct requested outcomes/populations, distinguish governing from contextual authorities, and use UNKNOWN for compound legacy top-level fields.

## Limits

- This report measures calls to interpretSemanticQuestion(query, GEMINI_API_KEY) and uses only the production prompt, schema, validation, and timeout.
- The caller must load repository .env/.env.local values through Node --env-file options; the runner does not read environment files itself.
- Authority workstream evidence retrieval is local-only; this evaluation measures semantic interpretation, reconciliation, and planned/final scope, not source freshness or evidence sufficiency.
- Issue identity matching uses deterministic phrase anchors in the held-out contract. Ambiguous subject matches require review.
- Topic hints from the model are recorded separately and never supply deterministic mapped topic IDs.
