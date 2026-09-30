# Live semantic evaluation: multi-authority workstreams

**Model understanding measured: YES**

Measurement status: COMPLETE. Model: gemini-3.5-flash-lite. Mode: LIVE_GEMINI_SEMANTIC_AND_LOCAL_AUTHORITY_WORKSTREAMS.

Unique cases: 12; logical case calls: 20; provider request attempts: 20; provider response attempts: 20; final valid interpretations: 19.
Provider attempt failures: 0; rate limited (429): 0; final provider-error cases: 0; final rate-limited cases: 0.
Provider request attempts by runtime: v22.23.1: 20.
Issue recall: 23/23 (100.0%); issue precision: 23/23 (100.0%); omission rate: 0/23 (0.0%).
Authority: 23/23 (100.0%); contextual authority: 23/23 (100.0%); domain: 23/23 (100.0%); population: 23/23 (100.0%); operation: 22/23 (95.7%).
Complete-question issue coverage: 19/20 (95.0%); final workstream-set accuracy: 19/19 (100.0%); valid interpretation rate: 19/20 (95.0%); invalid/timeout/fallback rate: 1/20 (5.0%).
Runtime routing/evidence-guard correctness: 20/20 (100.0%) (n=20); this does not score substantive answer correctness.
Semantic latency (ms): median 2101, p95 2645, max 3412; timeouts 0.

## Failure taxonomy

- MODEL_OMISSION: 0
- MODEL_FALSE_ISSUE: 0
- MODEL_WRONG_AUTHORITY: 0
- MODEL_WRONG_DOMAIN: 0
- MODEL_WRONG_POPULATION: 0
- MODEL_WRONG_OPERATION: 1
- MODEL_INVALID_SCHEMA: 1
- MODEL_TIMEOUT: 0
- RECONCILIATION_REJECTION: 0
- TAXONOMY_MAPPING_GAP: 14
- RUNTIME_ROUTING_FAILURE: 0

## Provider attempt outcomes

- VALID_INTERPRETATION: 19
- INVALID_RESPONSE: 1

## Per-call results

| Run | Case | Checkpoint | Attempts | Last provider status | Issue recall | Issue precision | Workstream set | Taxonomy |
|---|---|---|---:|---|---:|---:|---|---|
| originalABCD-1 | heldout-explicit-dual | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-1 | heldout-accounting-background | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | — |
| originalABCD-1 | heldout-employee-personal-relief | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-1 | heldout-company-as-employer | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-2 | heldout-explicit-dual | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-2 | heldout-accounting-background | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | — |
| originalABCD-2 | heldout-employee-personal-relief | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-2 | heldout-company-as-employer | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-3 | heldout-explicit-dual | FINALIZED | 1 | — | n/a | n/a | N/A | MODEL_INVALID_SCHEMA |
| originalABCD-3 | heldout-accounting-background | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | — |
| originalABCD-3 | heldout-employee-personal-relief | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| originalABCD-3 | heldout-company-as-employer | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | heldout-recorded-benefit-context | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | heldout-employee-benefit | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | heldout-company-taxpayer | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | heldout-different-populations | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_OPERATION |
| expanded-1 | heldout-missing-taxonomy | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | heldout-context-authority | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | — |
| expanded-1 | heldout-salary-pass | FINALIZED | 1 | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | heldout-unidentified-reporter | FINALIZED | 1 | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |

## Repeated A–D workstream stability

Observed/planned valid outputs: 11/12; assessed cases: 3/4; stable: 3; changed: none.

Unassessed cases: heldout-explicit-dual (2/3).

## Per-call detail

### originalABCD-1 — heldout-explicit-dual

Question: Our Singapore company incurred staff welfare costs. Please prepare the journal entries under SFRS(I) and determine whether we may deduct those costs for corporate income tax.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2386 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-1 — heldout-accounting-background

Question: We are a Singapore company. The staff welfare expense has already been recognised in our SFRS(I) accounts. Can we deduct this expenditure for company income tax?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2134 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: none.

### originalABCD-1 — heldout-employee-personal-relief

Question: I am an employee in Singapore and paid compulsory CPF from my wages. Can I claim personal income tax relief for the amount I paid?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1977 ms.
Workstreams: IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-1 — heldout-company-as-employer

Question: Our Singapore company employed staff this year. What employment income must we report to IRAS in our role as employer?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1886 ms.
Workstreams: IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-2 — heldout-explicit-dual

Question: Our Singapore company incurred staff welfare costs. Please prepare the journal entries under SFRS(I) and determine whether we may deduct those costs for corporate income tax.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 3412 ms.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-2 — heldout-accounting-background

Question: We are a Singapore company. The staff welfare expense has already been recognised in our SFRS(I) accounts. Can we deduct this expenditure for company income tax?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1959 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: none.

### originalABCD-2 — heldout-employee-personal-relief

Question: I am an employee in Singapore and paid compulsory CPF from my wages. Can I claim personal income tax relief for the amount I paid?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1874 ms.
Workstreams: IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-2 — heldout-company-as-employer

Question: Our Singapore company employed staff this year. What employment income must we report to IRAS in our role as employer?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2210 ms.
Workstreams: IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-3 — heldout-explicit-dual

Question: Our Singapore company incurred staff welfare costs. Please prepare the journal entries under SFRS(I) and determine whether we may deduct those costs for corporate income tax.

Checkpoint: FINALIZED; valid: false; final outcome: INVALID_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2163 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 INVALID_RESPONSE.
Failures: MODEL_INVALID_SCHEMA.

### originalABCD-3 — heldout-accounting-background

Question: We are a Singapore company. The staff welfare expense has already been recognised in our SFRS(I) accounts. Can we deduct this expenditure for company income tax?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2264 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: none.

### originalABCD-3 — heldout-employee-personal-relief

Question: I am an employee in Singapore and paid compulsory CPF from my wages. Can I claim personal income tax relief for the amount I paid?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2126 ms.
Workstreams: IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### originalABCD-3 — heldout-company-as-employer

Question: Our Singapore company employed staff this year. What employment income must we report to IRAS in our role as employer?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2645 ms.
Workstreams: IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — heldout-recorded-benefit-context

Question: Our Singapore company has booked its staff accommodation benefit under IFRS. For corporate tax, may we deduct the cost?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2099 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — heldout-employee-benefit

Question: My Singapore employer paid for my accommodation this year. Is the housing benefit taxable to me as an employee?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1855 ms.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — heldout-company-taxpayer

Question: Our Singapore company paid staff remuneration. Can the company deduct this cost from its taxable income?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1987 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — heldout-different-populations

Question: An employee in Singapore earns SGD 5,200 monthly. Calculate only the employer's CPF contribution and explain whether the employee can claim personal tax relief for compulsory CPF paid.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2187 ms.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION.

### expanded-1 — heldout-missing-taxonomy

Question: Our Singapore company bought an aurora-token access charge. Is this specific charge deductible for corporate tax?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1949 ms.
Workstreams: IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — heldout-context-authority

Question: In general, what personal tax relief rules apply to compulsory CPF paid by employees? CPF Board manages contributions; I am asking about the tax relief rules.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1885 ms.
Workstreams: IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: none.

### expanded-1 — heldout-salary-pass

Question: We hired a foreign employee in Singapore. Explain the work-pass requirements and determine whether the employee's salary is taxable to that employee.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2101 ms.
Workstreams: MOM/MOM_EMPLOYMENT, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — heldout-unidentified-reporter

Question: In Singapore, what income-tax reporting is required in relation to a worker? The question does not identify who must make the report.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1828 ms.
Workstreams: IRAS/UNKNOWN.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

## Tested source

Interpreter SHA-256: 4a032381ca71bffb6fd6b7c93ce8f8ff57a21a549486b5483ded01e223d1e221.
Initial evaluation runtime: v22.23.1.
Report-generation runtime: v22.23.1.
Provider request attempts by runtime: v22.23.1: 20.

## Limits

- This report measures calls to interpretSemanticQuestion(query, GEMINI_API_KEY) and uses only the production prompt, schema, validation, and timeout.
- The caller must load repository .env/.env.local values through Node --env-file options; the runner does not read environment files itself.
- Authority workstream evidence retrieval is local-only; this evaluation measures semantic interpretation, reconciliation, and planned/final scope, not source freshness or evidence sufficiency.
- Issue identity matching uses deterministic phrase anchors in the held-out contract. Ambiguous subject matches require review.
- Topic hints from the model are recorded separately and never supply deterministic mapped topic IDs.
