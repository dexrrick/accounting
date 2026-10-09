# Independent production review — 04/10/2026

Reviewer: custom `reviewer` agent `/root/routing_ownership_reviewer`, independent of the builder. Read-only review of the candidate production diff and regressions; no provider/source transport. Review stopped upon finding the material defect, as the user required.

## Verdict: REJECT / STOP

**[P2] Omitted generic relief requests can be reported as fully covered.** The candidate `getQueryScopeFragments()` can merge independent requests, and `isIndependentGenericParentScope()` assumes that any fragment containing a registered child has no generic parent request.

Confirmed with a valid semantic plan containing only `CPF relief for employees` for:

> I need an overview of individual tax relief categories. Can I claim CPF relief for employees?

The candidate assigns `routingTopicIds: ['iras-individual-reliefs']`, `coverageEstablished: true` and `hasUnmappedResidual: false`, hiding the omitted overview. The query-scope helper returns the entire query as a single scope. The reviewer also reproduced false completeness for a `plus explain` separator and an explicit categories request `including CPF relief for employees`.

This violates the mandatory independent-request fail-closed requirement. Child presence alone cannot establish that no broader request exists. Registered parent/child relationships are useful, but bounded request ownership is not established by fragment topic co-occurrence.

The new focused regression passed but missed these combined/unsupported-boundary controls. Registry relationships and evidence isolation appeared sound in the code inspected before STOP. Remaining review was not completed; no production fix approval was granted.

## Retained evidence and supervisor decision

The exact already-executed probe is archived in reviewer-probe.mjs.txt, with selected observed output fields in reviewer-proof.json. These are synthetic API-free inputs and actual reviewer observations, not reconstructed historical model output. Probe exit code was 0, Node v22.23.2, ambient networking blocked. No files were changed by the reviewer and no checks followed STOP.

The supervisor accepts the finding, stops the proposed fix and restores starting production after preserving candidate patch/test/proof snapshots. No additional boundary regex, phrase patch or other workaround was layered into production. The original false-residual defect remains unresolved, so V4 remains HOLD.
