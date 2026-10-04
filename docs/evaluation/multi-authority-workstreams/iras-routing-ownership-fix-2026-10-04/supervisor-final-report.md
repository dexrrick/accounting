# Supervisor stopping report — 04/10/2026

**HOLD.** Independent review rejected the candidate because it introduced false completeness for an omitted broader personal-relief request. The user explicitly required STOP on a new material production defect. No workaround was added. The candidate was preserved outside the active suite, and production source plus test registration were restored to the starting checkpoint. There is no completed, approved production fix to commit.

Starting SHA: `53cf1399a90981c5c537fe9935bb53f8d53860b9`. Branch: `codex/multi-authority-workstreams`. The documentation-only stopping checkpoint SHA is supplied in the final handoff; it is the commit containing this report. Production at that checkpoint is unchanged from the starting SHA.

## Original root cause

`resolveIssueTopicIds()` intersects subject-derived lexical topics with independently recognized raw-query topics. The valid subject `individual income tax relief for compulsory CPF` maps `iras-individual-cpf-relief` but not the routing-only `iras-individual-reliefs` umbrella. Inventory reconciliation then creates a false third UNASSIGNED_QUERY_TOPIC, despite the two intended material outcomes being represented. An equivalent subject happens to lexically match both topics and closes coverage.

The supervisor confirmed this before editing by executing the retained four-mock production replay, including both CPF_FIRST and UNKNOWN_MIXED envelopes. Every mock validates and matches the prospective subject/dimension scorer. The original defect remains unresolved in restored production.

## Candidate design and rejection

The builder implemented explicit `routingParentTopicIds` on specific individual-relief topics and internal reconciled-issue `routingTopicIds`. Inference required an actually mapped child, a routing-only parent present in independent inventory, compatible authority/domain and raw query-fragment co-occurrence. Generic parent scopes without a child were intended to prevent ownership; directly matched parent topics were removed from unrelated/narrow issue scope where needed. General-only issues retained direct umbrella mapping. The existing umbrella alias `SRS contribution relief` was also recognized on the SRS child for scoped matching.

This was a taxonomy relationship design rather than an exact CPF-subject patch, with inferred routing ownership excluded from evidence/source scope. However, its request-scope abstraction was insufficient. The helper reuses residual fragmentation, which is not a complete requested-outcome representation. Some independent requests remain in one fragment. The generic-scope predicate then incorrectly equates child presence with absence of a separate broad request.

Independent review confirmed, among other examples:

> I need an overview of individual tax relief categories. Can I claim CPF relief for employees?

A valid semantic plan containing only `CPF relief for employees` received the umbrella in `routingTopicIds`, `coverageEstablished=true` and `hasUnmappedResidual=false`. The omitted overview disappeared. The reviewer reproduced the same failure with a `plus explain` separator and an explicit categories request `including CPF relief for employees`.

Reviewer verdict: **REJECT / STOP — new material false-completeness defect in candidate**. The supervisor accepts it. Relationships and inspected evidence isolation appeared sound, but full review was stopped and no approval was granted. A stronger bounded requested-scope representation must be designed in subsequent authorized work; simply adding more separator regexes is not an approved solution here.

## Exact production scope

The rejected candidate temporarily changed:

- `src/services/semanticQuestionUnderstanding.ts` — derived umbrella ownership and unowned-parent filtering.
- `src/retrieval/queryTopicResolver.ts` — read-only raw query-scope helper.
- `src/standards/coverageRegistry.ts` — parent relationships and SRS alias.

It also added `tests/regression/test_routing_umbrella_ownership.mjs` and one registration in `scripts/run_all_tests.mjs`. All three production files and the runner were restored, and the new active test was removed after preserving its exact text. **Final committed production files changed: none.** No evidence admission, source retrieval, verification, application, statutory text, source-status or accounting calculation module changed at any point.

Preserved proposed changes: rejected-candidate.patch and rejected-candidate-regression.mjs.txt. They are diagnostics, not an approved patch to apply. The prospective four-input proof is retained as rejected-candidate-proof.json with its producer archived as rejected-candidate-proof.mjs.txt. Its production hashes identify the rejected candidate, not restored current source. The producer originally wrote prospective-proof.json; both archived files were renamed after rejection to avoid suggesting active validation.

## Regression coverage attempted

The focused candidate suite covered:

- All four exact retained raw mocks: both valid subjects, both root envelopes, two intended issues, separate employer CALCULATE, complete recognized inventory and no false residual.
- Generic relief alone; separately requested generic relief omitted/represented; canonical CPF subject unable to absorb a generic-only fragment.
- CPF plus cap, SRS, Parent Relief, WMCR, QCR and caregiver relief, each with the specific child omitted and separately represented.
- Specific-child relief plus an omitted general request; both directions of employer/IRAS omission.
- Unrelated same-authority specific topics, a generic scope mixed with unrelated recognized topics, unsupported request text, and no raw CPF support for provider subject hints.
- Actual localOnly workstream evidence remaining INSUFFICIENT for a routing-only topic.

These controls passed but did **not** cover the reviewer's broader-request boundaries. Passing them did not establish that independent material scope was preserved. The tests are archived rather than registered as a completed fix.

## API-free validation results

All candidate product checks used Node v22.23.2 with a preload blocking ambient fetch/external HTTP. In-memory transport fixtures remained available. The supervisor self-checked that external transport throws and explicit mock fetch succeeds, without any actual external request.

| Check | Result / limitation |
| --- | --- |
| Original retained four-mock diagnostic, before implementation | PASS; confirmed original false residual |
| Candidate focused routing regression | PASS, builder and smoke execution |
| Six relevant existing regressions | PASS: semantic question understanding, authority/relief contract, material issue decomposition, resolver coverage contract, CPF context/private enumeration, factual conjunction residual |
| New prospective four-input candidate proof | PASS; two intended issues for all four retained inputs; source hashes captured |
| `npm run lint` | PASS; existing warnings, no lint errors |
| `npm run build` | PASS; existing Vite warning |
| `npm run test:smoke` | **89/89 PASS**, 78.67 seconds; started before review STOP and completed before its result was collected |
| `npm test` / full suite | **NOT RUN**: independent review triggered mandatory STOP before full-suite start |
| Independent reviewer probes | **FAIL requirement**: three valid inputs hide omitted broad scope; actual probe exited 0 and observations retained |
| Post-rollback retained four-mock replay | PASS; restored production exactly reproduces original retained plans |
| Protected history | **389/389 PASS**, 221 distinct paths, before work, on candidate, and after rollback |
| Final production/runner diff against starting SHA | Empty; rejected candidate is absent from active production and suite |

The first lint/build launch did not reach repository checks because Windows rejected a drive-letter ESM preload URL. Switching the environment preload to `file:///D:/...` corrected that infrastructure issue; the subsequent actual lint/build commands passed. No production change was made for it.

Validation logs remain in ignored `.tmp/routing-ownership-{lint,build,smoke}.log`; the above results are saved here. No passing candidate validation is claimed as approval of current V4 or of the rejected fix.

## Integrity and stopping state

All consumed V1–V9 and targeted V3 artifacts remain unchanged. No rescore occurred. The retained V4 diagnostic JSON and producer are byte-identical:

- JSON SHA256: `636b5e3376f17a646a86c2dd3f062053c5687239298871942fd98426fff1bf48`.
- Producer SHA256: `b744ad4fa7c85d406a17cf0083260e67dbab8321ad37a737febfb58eae50fe1f`.

No V4 contract, harness, approval, permanent preregistration or consumption namespace was changed or activated. V4 documentation is unchanged because the condition for marking its blocker resolved did not pass. No final-profile run, merge, push or deployment occurred.

**Gemini/provider calls = 0. Live IRAS requests = 0.** Mock provider-function tests are API-free and use no external provider transport. There is no live acceptance reservation; temporary mock guard tests in the existing smoke suite are not acceptance consumption.

Only new files in this fix-attempt documentation directory are committed: design, network-blocking validation preload, candidate patch/test/proof snapshots, reviewer probe/observations, independent review and this stopping report. Production remains fail-closed at the original blocker.

**V4 status: HOLD**, not READY TO RESUME DESIGN. The original ownership defect remains; the proposed fix is independently rejected. No further implementation or acceptance work is authorized by this checkpoint.
