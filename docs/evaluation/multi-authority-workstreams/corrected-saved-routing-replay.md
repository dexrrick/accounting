# Live semantic evaluation: multi-authority workstreams

**Model understanding measured: NOT MEASURED**

Measurement status: RESCORED. Model: gemini-3.5-flash-lite. Mode: SAVED_RESPONSE_DETERMINISTIC_REPLAY.

**Saved-response rescore; no provider call was made.** Source report: docs\evaluation\multi-authority-workstreams\live-semantic-evaluation.json; source measurement: COMPLETE.
Saved logical case rows: 34; preserved provider request attempts: 54; preserved provider response attempts: 36.
Issue recall: 74/75 (98.7%); issue precision: 74/74 (100.0%); complete-question issue coverage: 32/34 (94.1%); saved downstream workstream routing: 33/33 (100.0%).
Runtime routing/evidence-guard correctness: 33/33 (100.0%) (n=33); this does not score substantive answer correctness.

**Deterministic replay uses saved validated interpretations. It is not a new model measurement or raw-provider replay.**

## Rescored calls

| Run | Case | Attempts | Issue recall | Issue precision | Complete issues | Workstream set |
|---|---|---:|---:|---:|---|---|
| originalABCD-1 | A-original | 1 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| originalABCD-1 | B-original | 1 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| originalABCD-1 | C-original | 1 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| originalABCD-1 | D-original | 1 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| originalABCD-2 | A-original | 2 | n/a | n/a | N/A | N/A |
| originalABCD-2 | B-original | 1 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| originalABCD-2 | C-original | 1 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| originalABCD-2 | D-original | 1 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| originalABCD-3 | A-original | 2 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| originalABCD-3 | B-original | 1 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| originalABCD-3 | C-original | 1 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| originalABCD-3 | D-original | 1 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| expanded-1 | A-paraphrase-1 | 1 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| expanded-1 | A-paraphrase-2 | 1 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| expanded-1 | A-paraphrase-3 | 1 | 2/3 (66.7%) | 2/2 (100.0%) | FAIL | PASS |
| expanded-1 | A-paraphrase-4 | 1 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| expanded-1 | B-paraphrase-1 | 2 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| expanded-1 | B-paraphrase-2 | 2 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| expanded-1 | B-paraphrase-3 | 2 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| expanded-1 | B-paraphrase-4 | 2 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| expanded-1 | C-paraphrase-1 | 2 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| expanded-1 | C-paraphrase-2 | 2 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| expanded-1 | C-paraphrase-3 | 2 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| expanded-1 | C-paraphrase-4 | 2 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| expanded-1 | D-paraphrase-1 | 2 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| expanded-1 | D-paraphrase-2 | 2 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| expanded-1 | D-paraphrase-3 | 2 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| expanded-1 | D-paraphrase-4 | 2 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| expanded-1 | adversarial-A-contextual-cpf | 2 | 1/1 (100.0%) | 1/1 (100.0%) | PASS | PASS |
| expanded-1 | adversarial-B-cpf-expense | 2 | 1/1 (100.0%) | 1/1 (100.0%) | PASS | PASS |
| expanded-1 | adversarial-C-employee-benefit | 2 | 1/1 (100.0%) | 1/1 (100.0%) | PASS | PASS |
| expanded-1 | adversarial-D-workpass-and-salary-tax | 2 | 2/2 (100.0%) | 2/2 (100.0%) | PASS | PASS |
| expanded-1 | adversarial-E-three-authorities | 2 | 3/3 (100.0%) | 3/3 (100.0%) | PASS | PASS |
| expanded-1 | adversarial-F-accounting-and-tax | 2 | 1/1 (100.0%) | 1/1 (100.0%) | PASS | PASS |

## Limits

- This is a rescore of saved validated interpretations; raw model response bodies and schema failures are not reconstructed.
- The source report did not persist the full validated JSON for every row; missing fields were reconstructed from saved top-level labels and issue records, so this is not a raw-model replay.
- The optional deterministic replay reruns current reconciliation and local-only routing against saved interpretations; its outputs are separate from original saved workstreams.
- Workstream and evidence status measure routing and evidence guards only; they do not establish that an accounting or tax answer is substantively correct.
