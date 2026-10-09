# Live semantic evaluation: multi-authority workstreams

**Model understanding measured: YES**

Measurement status: COMPLETE. Model: gemini-3.5-flash-lite. Mode: LIVE_GEMINI_SEMANTIC_AND_LOCAL_AUTHORITY_WORKSTREAMS.

Unique cases: 12; logical case calls: 12; provider request attempts: 12; provider response attempts: 12; final valid interpretations: 10.
Provider attempt failures: 0; rate limited (429): 0; final provider-error cases: 0; final rate-limited cases: 0.
Provider request attempts by runtime: v22.23.1: 12.
Issue recall: 17/17 (100.0%); issue precision: 17/17 (100.0%); omission rate: 0/17 (0.0%).
Authority: 17/17 (100.0%); contextual authority: 17/17 (100.0%); domain: 17/17 (100.0%); population: 17/17 (100.0%); operation: 15/17 (88.2%).
Complete-question issue coverage: 10/12 (83.3%); final workstream-set accuracy: 10/10 (100.0%); valid interpretation rate: 10/12 (83.3%); invalid/timeout/fallback rate: 2/12 (16.7%).
Runtime routing/evidence-guard correctness: 12/12 (100.0%) (n=12); this does not score substantive answer correctness.
Semantic latency (ms): median 1778, p95 2232, max 2232; timeouts 0.

## Failure taxonomy

- MODEL_OMISSION: 0
- MODEL_FALSE_ISSUE: 0
- MODEL_WRONG_AUTHORITY: 0
- MODEL_WRONG_DOMAIN: 0
- MODEL_WRONG_POPULATION: 0
- MODEL_WRONG_OPERATION: 2
- MODEL_INVALID_SCHEMA: 2
- MODEL_TIMEOUT: 0
- RECONCILIATION_REJECTION: 0
- TAXONOMY_MAPPING_GAP: 9
- RUNTIME_ROUTING_FAILURE: 0

## Provider attempt outcomes

- VALID_INTERPRETATION: 10
- INVALID_RESPONSE: 2

## Per-call results

| Run | Case | Checkpoint | Attempts | Last provider status | Failure reason | Issue recall | Issue precision | Workstream set | Taxonomy |
|---|---|---|---:|---|---|---:|---:|---|---|
| expanded-1 | A-original | FINALIZED | 1 | — | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | — |
| expanded-1 | A-paraphrase-2 | FINALIZED | 1 | — | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | C-original | FINALIZED | 1 | — | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | C-paraphrase-3 | FINALIZED | 1 | — | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | C-paraphrase-4 | FINALIZED | 1 | — | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-C-employee-benefit | FINALIZED | 1 | — | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP |
| expanded-1 | adversarial-D-workpass-and-salary-tax | FINALIZED | 1 | — | — | 2/2 (100.0%) | 2/2 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | control-general-recognition | FINALIZED | 1 | — | SCHEMA_MISMATCH | n/a | n/a | N/A | MODEL_INVALID_SCHEMA |
| expanded-1 | control-general-comparison | FINALIZED | 1 | — | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | control-journal-entry | FINALIZED | 1 | — | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | control-employer-filing | FINALIZED | 1 | — | — | 1/1 (100.0%) | 1/1 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |
| expanded-1 | control-general-interaction | FINALIZED | 1 | — | SCHEMA_MISMATCH | n/a | n/a | N/A | MODEL_INVALID_SCHEMA |

## Repeated A–D workstream stability

Observed/planned valid outputs: 0/0; assessed cases: 0/0; stable: 0; changed: none.

## Per-call detail

### expanded-1 — A-original

Question: An employee earns SGD 6,000 per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect personal income tax relief?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2232 ms.
Failure reason: none.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: none.

### expanded-1 — A-paraphrase-2

Question: For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2035 ms.
Failure reason: none.
Workstreams: IRAS/IRAS_INDIVIDUAL_TAX, CPF/CPF_PAYROLL.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — C-original

Question: Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1823 ms.
Failure reason: none.
Workstreams: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — C-paraphrase-3

Question: Is the employee taxed on a housing allowance before considering whether the company may deduct what it paid?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1774 ms.
Failure reason: none.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — C-paraphrase-4

Question: Our firm gives an employee a housing benefit. How is it treated for the employee's tax and for the company's deduction?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1778 ms.
Failure reason: none.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS, IRAS/IRAS_CORPORATE_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-C-employee-benefit

Question: The employer provides accommodation to staff. What tax does the employee pay on the benefit?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1968 ms.
Failure reason: none.
Workstreams: IRAS/IRAS_EMPLOYMENT_BENEFITS.
Attempt history: #1 VALID_INTERPRETATION.
Failures: MODEL_WRONG_OPERATION, TAXONOMY_MAPPING_GAP.

### expanded-1 — adversarial-D-workpass-and-salary-tax

Question: A foreign employee needs a work pass and the company needs to know whether his salary is taxable.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1863 ms.
Failure reason: none.
Workstreams: MOM/MOM_EMPLOYMENT, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — control-general-recognition

Question: What are the general principles for recognizing intangible assets under IFRS?

Checkpoint: FINALIZED; valid: false; final outcome: INVALID_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1768 ms.
Failure reason: SCHEMA_MISMATCH.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING.
Attempt history: #1 INVALID_RESPONSE (SCHEMA_MISMATCH).
Failures: MODEL_INVALID_SCHEMA.

### expanded-1 — control-general-comparison

Question: Compare initial recognition and subsequent measurement of equipment under IFRS.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1637 ms.
Failure reason: none.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — control-journal-entry

Question: Prepare the journal entry for our company's purchase of office furniture for SGD 2,400 cash, excluding GST.

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1677 ms.
Failure reason: none.
Workstreams: ACCOUNTING_STANDARDS/ACCOUNTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — control-employer-filing

Question: Which income-tax payroll reports must our business file as an employer?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1548 ms.
Failure reason: none.
Workstreams: IRAS/IRAS_EMPLOYER_REPORTING.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

### expanded-1 — control-general-interaction

Question: Explain generally how recognition and measurement decisions relate in financial reporting under IFRS.

Checkpoint: FINALIZED; valid: false; final outcome: INVALID_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 1763 ms.
Failure reason: SCHEMA_MISMATCH.
Workstreams: none.
Attempt history: #1 INVALID_RESPONSE (SCHEMA_MISMATCH).
Failures: MODEL_INVALID_SCHEMA.

## Tested source

Interpreter SHA-256: 2e8c6cac5e0e5a2bb802823f30cb6c2af35040300c7e93eff519e65467893505.
Initial evaluation runtime: v22.23.1.
Report-generation runtime: v22.23.1.
Provider request attempts by runtime: v22.23.1: 12.

## Limits

- This report measures calls to interpretSemanticQuestion(query, GEMINI_API_KEY) and uses only the production prompt, schema, validation, and timeout.
- The caller must load repository .env/.env.local values through Node --env-file options; the runner does not read environment files itself.
- Authority workstream evidence retrieval is local-only; this evaluation measures semantic interpretation, reconciliation, and planned/final scope, not source freshness or evidence sufficiency.
- Issue identity matching uses deterministic phrase anchors in the held-out contract. Ambiguous subject matches require review.
- Topic hints from the model are recorded separately and never supply deterministic mapped topic IDs.
