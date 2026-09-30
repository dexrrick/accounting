# Live semantic evaluation: multi-authority workstreams

**Model understanding measured: YES**

Measurement status: PARTIAL. Model: gemini-3.5-flash-lite. Mode: LIVE_GEMINI_SEMANTIC_AND_LOCAL_AUTHORITY_WORKSTREAMS_PARTIAL.

Unique cases: 26; logical case calls: 42; provider request attempts: 42; provider response attempts: 33; final valid interpretations: 30.
Provider attempt failures: 0; rate limited (429): 0; final provider-error cases: 0; final rate-limited cases: 0.
Provider request attempts by runtime: v22.23.1: 42.
Issue recall: 70/71 (98.6%); issue precision: 70/72 (97.2%); omission rate: 1/71 (1.4%).
Authority: 70/70 (100.0%); contextual authority: 70/70 (100.0%); domain: 70/70 (100.0%); population: 69/70 (98.6%); operation: 55/70 (78.6%).
Complete-question issue coverage: 28/42 (66.7%); final workstream-set accuracy: 30/30 (100.0%); valid interpretation rate: 30/42 (71.4%); invalid/timeout/fallback rate: 12/42 (28.6%).
Runtime routing/evidence-guard correctness: 42/42 (100.0%) (n=42); this does not score substantive answer correctness.
Semantic latency (ms): median 2644, p95 7545, max 7694; timeouts 9.

**Live measurement is partial: 33/42 logical case calls have a provider response; request-attempt failures are reported separately.**

## Failure taxonomy

- MODEL_OMISSION: 1
- MODEL_FALSE_ISSUE: 2
- MODEL_WRONG_AUTHORITY: 0
- MODEL_WRONG_DOMAIN: 0
- MODEL_WRONG_POPULATION: 1
- MODEL_WRONG_OPERATION: 9
- MODEL_INVALID_SCHEMA: 3
- MODEL_TIMEOUT: 9
- RECONCILIATION_REJECTION: 1
- TAXONOMY_MAPPING_GAP: 27
- RUNTIME_ROUTING_FAILURE: 0

## Provider attempt outcomes

- VALID_INTERPRETATION: 30
- TIMEOUT: 9
- INVALID_RESPONSE: 3

## Per-call results

| Run | Case | Checkpoint | Attempts | Last provider status | Issue recall | Issue precision | Workstream set | Taxonomy |
|---|---|---|---:|---|---:|---:|---|---|
| originalABCD-1 | A-original | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| originalABCD-1 | A-paraphrase-1 | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-1 | A-paraphrase-3 | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_TIMEOUT |
| originalABCD-1 | B-original | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-1 | B-paraphrase-1 | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_TIMEOUT |
| originalABCD-1 | C-original | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| originalABCD-1 | D-original | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_TIMEOUT |
| originalABCD-1 | D-paraphrase-1 | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_TIMEOUT |
| originalABCD-2 | A-original | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_TIMEOUT |
| originalABCD-2 | A-paraphrase-1 | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-2 | A-paraphrase-3 | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_INVALID_SCHEMA |
| originalABCD-2 | B-original | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-2 | B-paraphrase-1 | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-2 | C-original | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| originalABCD-2 | D-original | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-2 | D-paraphrase-1 | FINALIZED | 1 | — | 1/2 (50.0%) | 1/2 (50.0%) | PASS | MODEL_OMISSION, MODEL_FALSE_ISSUE |
| originalABCD-3 | A-original | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | — |
| originalABCD-3 | A-paraphrase-1 | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-3 | A-paraphrase-3 | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_INVALID_SCHEMA |
| originalABCD-3 | B-original | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-3 | B-paraphrase-1 | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-3 | C-original | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| originalABCD-3 | D-original | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-3 | D-paraphrase-1 | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_TIMEOUT |
| expanded-1 | A-paraphrase-2 | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | A-paraphrase-4 | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_INVALID_SCHEMA |
| expanded-1 | B-paraphrase-2 | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | B-paraphrase-3 | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | B-paraphrase-4 | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | C-paraphrase-1 | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | C-paraphrase-2 | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_TIMEOUT |
| expanded-1 | C-paraphrase-3 | FINALIZED | 1 | — | 2/2 (100.0%) | 2/3 (66.7%) | PASS | MODEL_FALSE_ISSUE, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | C-paraphrase-4 | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | D-paraphrase-2 | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | D-paraphrase-3 | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_TIMEOUT |
| expanded-1 | D-paraphrase-4 | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-A-contextual-cpf | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-B-cpf-expense | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_TIMEOUT |
| expanded-1 | adversarial-C-employee-benefit | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-D-workpass-and-salary-tax | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-E-three-authorities | FINALIZED | 1 | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | MODEL_WRONG_POPULATION, TAXONOMY_MAPPING_GAP, RECONCILIATION_REJECTION |
| expanded-1 | adversarial-F-accounting-and-tax | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | — |

## Repeated A–D workstream stability

Observed/planned valid outputs: 16/24; assessed cases: 3/8; stable: 3; changed: none.

Unassessed cases: A-original (2/3), A-paraphrase-3 (0/3), B-paraphrase-1 (2/3), D-original (2/3), D-paraphrase-1 (1/3).

## Per-call detail

### originalABCD-1 — A-original

Question: An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 6670 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### originalABCD-1 — A-paraphrase-1

Question: How much CPF should the employer and staff member contribute on a monthly salary of SGD 6,000, and how does the employee claim tax relief for mandatory CPF paid?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 4396 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-1 — A-paraphrase-3

Question: If a worker is paid SGD 6,000 monthly, explain the personal income tax relief linked to mandatory payroll CPF first, then state the employer and employee contribution amounts.

Checkpoint: FINALIZED; valid: false; final outcome: TIMEOUT; provider category: none; HTTP status: n/a; attempts: 1; latency: 8005 ms.
Workstreams: CPF/CPF_PAYROLL.
Attempt history: #1 TIMEOUT.
Failures: MODEL_TIMEOUT.

### originalABCD-1 — B-original

Question: We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting obligations should we consider?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 5113 ms.
Workstreams: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-1 — B-paraphrase-1

Question: We plan to bring a foreign staff member to Singapore on an Employment Pass. What must the company report for tax, what work-pass rules apply, and does payroll CPF apply?

Checkpoint: FINALIZED; valid: false; final outcome: TIMEOUT; provider category: none; HTTP status: n/a; attempts: 1; latency: 8007 ms.
Workstreams: MOM/MOM_EMPLOYMENT.
Attempt history: #1 TIMEOUT.
Failures: MODEL_TIMEOUT.

### originalABCD-1 — C-original

Question: Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 6237 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### originalABCD-1 — D-original

Question: How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?

Checkpoint: FINALIZED; valid: false; final outcome: TIMEOUT; provider category: none; HTTP status: n/a; attempts: 1; latency: 8010 ms.
Workstreams: none.
Attempt history: #1 TIMEOUT.
Failures: MODEL_TIMEOUT.

### originalABCD-1 — D-paraphrase-1

Question: Is a business expense tax deductible in Singapore, and how should the same item appear in the financial statements under SFRS(I)?

Checkpoint: FINALIZED; valid: false; final outcome: TIMEOUT; provider category: none; HTTP status: n/a; attempts: 1; latency: 8017 ms.
Workstreams: ACRA/ACRA_CORPORATE, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 TIMEOUT.
Failures: MODEL_TIMEOUT.

### originalABCD-2 — A-original

Question: An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?

Checkpoint: FINALIZED; valid: false; final outcome: TIMEOUT; provider category: none; HTTP status: n/a; attempts: 1; latency: 8010 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 TIMEOUT.
Failures: MODEL_TIMEOUT.

### originalABCD-2 — A-paraphrase-1

Question: How much CPF should the employer and staff member contribute on a monthly salary of SGD 6,000, and how does the employee claim tax relief for mandatory CPF paid?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 6273 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-2 — A-paraphrase-3

Question: If a worker is paid SGD 6,000 monthly, explain the personal income tax relief linked to mandatory payroll CPF first, then state the employer and employee contribution amounts.

Checkpoint: FINALIZED; valid: false; final outcome: INVALID_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2377 ms.
Workstreams: CPF/CPF_PAYROLL.
Attempt history: #1 INVALID_RESPONSE.
Failures: MODEL_INVALID_SCHEMA.

### originalABCD-2 — B-original

Question: We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting obligations should we consider?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2644 ms.
Workstreams: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-2 — B-paraphrase-1

Question: We plan to bring a foreign staff member to Singapore on an Employment Pass. What must the company report for tax, what work-pass rules apply, and does payroll CPF apply?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2308 ms.
Workstreams: IRAS/IRAS_EMPLOYER_REPORTING, MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-2 — C-original

Question: Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2204 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### originalABCD-2 — D-original

Question: How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2114 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-2 — D-paraphrase-1

Question: Is a business expense tax deductible in Singapore, and how should the same item appear in the financial statements under SFRS(I)?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2226 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, ACCOUNTING_STANDARDS/ACCOUNTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_OMISSION, MODEL_FALSE_ISSUE.

### originalABCD-3 — A-original

Question: An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2444 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: none.

### originalABCD-3 — A-paraphrase-1

Question: How much CPF should the employer and staff member contribute on a monthly salary of SGD 6,000, and how does the employee claim tax relief for mandatory CPF paid?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2270 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-3 — A-paraphrase-3

Question: If a worker is paid SGD 6,000 monthly, explain the personal income tax relief linked to mandatory payroll CPF first, then state the employer and employee contribution amounts.

Checkpoint: FINALIZED; valid: false; final outcome: INVALID_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2588 ms.
Workstreams: CPF/CPF_PAYROLL.
Attempt history: #1 INVALID_RESPONSE.
Failures: MODEL_INVALID_SCHEMA.

### originalABCD-3 — B-original

Question: We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting obligations should we consider?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2212 ms.
Workstreams: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-3 — B-paraphrase-1

Question: We plan to bring a foreign staff member to Singapore on an Employment Pass. What must the company report for tax, what work-pass rules apply, and does payroll CPF apply?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2859 ms.
Workstreams: IRAS/IRAS_EMPLOYER_REPORTING, MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-3 — C-original

Question: Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2209 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### originalABCD-3 — D-original

Question: How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2315 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-3 — D-paraphrase-1

Question: Is a business expense tax deductible in Singapore, and how should the same item appear in the financial statements under SFRS(I)?

Checkpoint: FINALIZED; valid: false; final outcome: TIMEOUT; provider category: none; HTTP status: n/a; attempts: 1; latency: 8001 ms.
Workstreams: ACRA/ACRA_CORPORATE, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 TIMEOUT.
Failures: MODEL_TIMEOUT.

### expanded-1 — A-paraphrase-2

Question: For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 4300 ms.
Workstreams: IRAS/IRAS_INDIVIDUAL_TAX, CPF/CPF_PAYROLL.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — A-paraphrase-4

Question: With a monthly wage of SGD 6,000, what are both sides' CPF payroll contributions, and what tax relief does the worker get for the compulsory deduction?

Checkpoint: FINALIZED; valid: false; final outcome: INVALID_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 7694 ms.
Workstreams: none.
Attempt history: #1 INVALID_RESPONSE.
Failures: MODEL_INVALID_SCHEMA.

### expanded-1 — B-paraphrase-2

Question: Before hiring an overseas worker here, what tax filings will we as employer need to consider, are CPF contributions due, and what employment authorization is needed?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 6916 ms.
Workstreams: IRAS/IRAS_EMPLOYER_REPORTING, CPF/CPF_PAYROLL, MOM/MOM_EMPLOYMENT.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — B-paraphrase-3

Question: For foreign staff in Singapore, can you cover employer tax reporting first, then the CPF position and the requirements for employing them?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 7250 ms.
Workstreams: IRAS/IRAS_EMPLOYER_REPORTING, CPF/CPF_PAYROLL, MOM/MOM_EMPLOYMENT.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — B-paraphrase-4

Question: We hired someone from overseas. Explain the work-pass and employment obligations, whether CPF must be contributed, and the employer's reporting duties without assuming which authority handles them.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 7545 ms.
Workstreams: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — C-paraphrase-1

Question: If the business pays for staff accommodation, can it deduct that cost and does the employee pay income tax on the benefit?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 6917 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — C-paraphrase-2

Question: From the employer's perspective, how is a housing benefit for staff treated for company tax, and is it taxable employment income to the recipient?

Checkpoint: FINALIZED; valid: false; final outcome: TIMEOUT; provider category: none; HTTP status: n/a; attempts: 1; latency: 8002 ms.
Workstreams: none.
Attempt history: #1 TIMEOUT.
Failures: MODEL_TIMEOUT.

### expanded-1 — C-paraphrase-3

Question: Is the employee taxed on a housing allowance before considering whether the company may deduct what it paid?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 6691 ms.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_FALSE_ISSUE, MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — C-paraphrase-4

Question: Our firm gives an employee a housing benefit. How is it treated for the employee's tax and for the company's deduction?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 4607 ms.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — D-paraphrase-2

Question: Please explain the accounting treatment for an expense and whether the company can claim it against corporate taxable income.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2243 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — D-paraphrase-3

Question: What is the SFRS(I) journal treatment for this cost, and separately can it be deducted for company income-tax purposes?

Checkpoint: FINALIZED; valid: false; final outcome: TIMEOUT; provider category: none; HTTP status: n/a; attempts: 1; latency: 8013 ms.
Workstreams: none.
Attempt history: #1 TIMEOUT.
Failures: MODEL_TIMEOUT.

### expanded-1 — D-paraphrase-4

Question: For financial reporting and Singapore company tax, how should a cost be recognised and is it deductible?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2150 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-A-contextual-cpf

Question: Does mentioning CPF in a personal income tax relief question mean CPF Board determines the relief?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 7381 ms.
Workstreams: IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-B-cpf-expense

Question: Our company pays CPF for employees. Is the CPF expense deductible for corporate income tax?

Checkpoint: FINALIZED; valid: false; final outcome: TIMEOUT; provider category: none; HTTP status: n/a; attempts: 1; latency: 8003 ms.
Workstreams: none.
Attempt history: #1 TIMEOUT.
Failures: MODEL_TIMEOUT.

### expanded-1 — adversarial-C-employee-benefit

Question: The employer provides accommodation to staff. What tax does the employee pay on the benefit?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1773 ms.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-D-workpass-and-salary-tax

Question: A foreign employee needs a work pass and the company needs to know whether his salary is taxable.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 5155 ms.
Workstreams: MOM/MOM_EMPLOYMENT, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-E-three-authorities

Question: How do CPF contributions, work-pass requirements and employee income-tax reporting interact for a foreign employee?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2422 ms.
Workstreams: CPF/CPF_PAYROLL, MOM/MOM_EMPLOYMENT, IRAS/UNKNOWN.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_POPULATION, TAXONOMY_MAPPING_GAP, RECONCILIATION_REJECTION.

### expanded-1 — adversarial-F-accounting-and-tax

Question: A company records an employee benefit under SFRS(I) and wants to know whether it is tax deductible.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2000 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: none.

## Tested source

Interpreter SHA-256: 4a032381ca71bffb6fd6b7c93ce8f8ff57a21a549486b5483ded01e223d1e221.
Initial evaluation runtime: v22.23.1.
Report-generation runtime: v22.23.1.
Provider request attempts by runtime: v22.23.1: 42.

## Limits

- This report measures calls to interpretSemanticQuestion(query, GEMINI_API_KEY) and uses only the production prompt, schema, validation, and timeout.
- The caller must load repository .env/.env.local values through Node --env-file options; the runner does not read environment files itself.
- Authority workstream evidence retrieval is local-only; this evaluation measures semantic interpretation, reconciliation, and planned/final scope, not source freshness or evidence sufficiency.
- Issue identity matching uses deterministic phrase anchors in the held-out contract. Ambiguous subject matches require review.
- Topic hints from the model are recorded separately and never supply deterministic mapped topic IDs.
