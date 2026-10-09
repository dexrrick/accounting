# Live semantic evaluation: multi-authority workstreams

**Model understanding measured: YES**

Measurement status: COMPLETE. Model: gemini-3.5-flash-lite. Mode: LIVE_GEMINI_SEMANTIC_AND_LOCAL_AUTHORITY_WORKSTREAMS.

Unique cases: 2; logical case calls: 2; provider request attempts: 2; provider response attempts: 2; final valid interpretations: 1.
Provider attempt failures: 0; rate limited (429): 0; final provider-error cases: 0; final rate-limited cases: 0.
Provider request attempts by runtime: v22.23.1: 2.
Issue recall: 3/3 (100.0%); issue precision: 3/3 (100.0%); omission rate: 0/3 (0.0%).
Authority: 3/3 (100.0%); contextual authority: 3/3 (100.0%); domain: 3/3 (100.0%); population: 3/3 (100.0%); operation: 3/3 (100.0%).
Complete-question issue coverage: 1/2 (50.0%); final workstream-set accuracy: 1/1 (100.0%); valid interpretation rate: 1/2 (50.0%); invalid/timeout/fallback rate: 1/2 (50.0%).
Runtime routing/evidence-guard correctness: 2/2 (100.0%) (n=2); this does not score substantive answer correctness.
Semantic latency (ms): median 2425, p95 2425, max 2425; timeouts 0.

## Failure taxonomy

- MODEL_OMISSION: 0
- MODEL_FALSE_ISSUE: 0
- MODEL_WRONG_AUTHORITY: 0
- MODEL_WRONG_DOMAIN: 0
- MODEL_WRONG_POPULATION: 0
- MODEL_WRONG_OPERATION: 0
- MODEL_INVALID_SCHEMA: 1
- MODEL_TIMEOUT: 0
- RECONCILIATION_REJECTION: 0
- TAXONOMY_MAPPING_GAP: 1
- RUNTIME_ROUTING_FAILURE: 0

## Provider attempt outcomes

- INVALID_RESPONSE: 1
- VALID_INTERPRETATION: 1

## Per-call results

| Run | Case | Checkpoint | Attempts | Last provider status | Failure reason | Issue recall | Issue precision | Workstream set | Taxonomy |
|---|---|---|---:|---|---|---:|---:|---|---|
| expanded-1 | A-paraphrase-3 | FINALIZED | 1 | — | CONTRADICTORY_FIELDS | n/a | n/a | N/A | MODEL_INVALID_SCHEMA |
| expanded-1 | A-paraphrase-4 | FINALIZED | 1 | — | — | 3/3 (100.0%) | 3/3 (100.0%) | PASS | TAXONOMY_MAPPING_GAP |

## Repeated A–D workstream stability

Observed/planned valid outputs: 0/0; assessed cases: 0/0; stable: 0; changed: none.

## Per-call detail

### expanded-1 — A-paraphrase-3

Question: If a worker is paid SGD 6,000 monthly, explain the personal income tax relief linked to mandatory payroll CPF first, then state the employer and employee contribution amounts.

Checkpoint: FINALIZED; valid: false; final outcome: INVALID_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2425 ms.
Failure reason: CONTRADICTORY_FIELDS.
Workstreams: CPF/CPF_PAYROLL.
Attempt history: #1 INVALID_RESPONSE (CONTRADICTORY_FIELDS).
Failures: MODEL_INVALID_SCHEMA.

### expanded-1 — A-paraphrase-4

Question: With a monthly wage of SGD 6,000, what are both sides' CPF payroll contributions, and what tax relief does the worker get for the compulsory deduction?

Checkpoint: FINALIZED; valid: true; final outcome: PROVIDER_RESPONSE; provider category: none; HTTP status: n/a; attempts: 1; latency: 2280 ms.
Failure reason: none.
Workstreams: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Attempt history: #1 VALID_INTERPRETATION.
Failures: TAXONOMY_MAPPING_GAP.

## Tested source

Interpreter SHA-256: 2e8c6cac5e0e5a2bb802823f30cb6c2af35040300c7e93eff519e65467893505.
Initial evaluation runtime: v22.23.1.
Report-generation runtime: v22.23.1.
Provider request attempts by runtime: v22.23.1: 2.

## Limits

- This report measures calls to interpretSemanticQuestion(query, GEMINI_API_KEY) and uses only the production prompt, schema, validation, and timeout.
- The caller must load repository .env/.env.local values through Node --env-file options; the runner does not read environment files itself.
- Authority workstream evidence retrieval is local-only; this evaluation measures semantic interpretation, reconciliation, and planned/final scope, not source freshness or evidence sufficiency.
- Issue identity matching uses deterministic phrase anchors in the held-out contract. Ambiguous subject matches require review.
- Topic hints from the model are recorded separately and never supply deterministic mapped topic IDs.
