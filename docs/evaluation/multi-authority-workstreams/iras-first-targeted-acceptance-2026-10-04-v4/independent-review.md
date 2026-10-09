# Independent classification review — 04/10/2026

Reviewer: custom `reviewer` agent `/root/v4_classification_review`; read-only, independent of the builder. Scope: classify the unexpected mixed-case residual using production code and retained supervisor proof. This is **not approval of the incomplete V4 contract/harness**.

## Verdict

**HOLD — NEW PRODUCTION DEFECT FOUND.** A newly exposed existing production ownership/paraphrase defect, not merely a fixture correction. The supervisor accepts this classification and stops under the user's instruction.

The reviewer independently executed the prospective V2 scorer on all four retained mocks. Both intended subjects matched and all five dimensions passed for both `CPF_FIRST` and `UNKNOWN_MIXED` roots. The subject `individual income tax relief for compulsory CPF` represents the requested personal relief, with the correct authority, contextual authority, population, domain and operation.

Production `resolveIssueTopicIds` maps that subject to the concrete CPF-relief topic but misses the lexical umbrella. `reconcileSemanticIssuePlan` then creates a third unresolved `UNASSIGNED_QUERY_TOPIC`, `iras-individual-reliefs`. The equivalent subject `individual personal tax relief claim for compulsory CPF contributions` closes coverage under both root envelopes. The umbrella is explicitly `routingOnly` in the coverage registry; the question does not request an independent general-relief issue.

Suppressing this residual only in acceptance would conceal production's `ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL` and resulting `INSUFFICIENT` gate. The affected owning layer is semantic issue/topic inventory reconciliation, including subject-only lexical intersection and unconditional residual creation. Resolver projection does not preserve the routing-only distinction.

Future investigation should establish bounded umbrella ownership in production while preserving genuinely independent requests and missing substantive topics. Blanket omission of routing-only residuals is not approved. No production fix is part of this task, and completed October 4 fixes are not reopened.

## Limits

The draft regression also has an incomplete root envelope (first issue only, no concepts). That limitation does not explain away the independently reproduced defect: the retained diagnostic uses a complete joint primary subject and both concepts. All four mocks pass production validation. This is synthetic API-free semantic input, not retained Gemini output, so no model error is inferred.

The reviewer did not modify files, invoke a provider or fetch sources. Full nine-case harness review, evidence fixture validation, resource-guard approval and permanent preregistration remain outstanding. Expected substantive local evidence gaps remain separate legitimate capability limitations.

Proof: `routing-classification-proof.json`; read-only reproduction: `node --import tsx docs/evaluation/multi-authority-workstreams/iras-first-targeted-acceptance-2026-10-04-v4/routing-classification-proof.mjs`.
