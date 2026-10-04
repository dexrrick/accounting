# Independent review record

Reviewer: custom `reviewer` agent `/root/completeness_design_review`, separate from the builder. This record is saved by the supervisor from the review messages.

## Design challenge

Initial verdict: REVISE before prototype implementation. Findings: undeclared grammar; ambiguous mixed-case operation; deadline/obligation and alternative/interaction distinctions; context-linked private/foreign qualifications; underspecified many-to-many binding; span and uncertainty precedence. The reviewer assessed all 28 cases and requested unknown prefix/infix/qualifier controls and unseen positive compositions.

Supervisor response: added normative `grammar-contract.md`, binding-level descriptors, directed relationship and decision facets, contextual qualification rules, independent raw parse boundaries, empty-versus-invalid binding semantics, partial-inventory retention, uncertainty precedence and additional controls. Case03 explicitly uses the retained eligibility expectation within the bounded language; its natural-language ambiguity remains documented.

Second verdict: **APPROVED for bounded, API-free prototype implementation.** No remaining material design findings. Approval does not cover production or V4. Runtime independence, transport blocking, artifact integrity and final code/counterexample review remained required at this point.

Integrity-checker/proposed-scope review: no material defect for the stated tracked/nonignored Git scope. Supervisor applied the reviewer's two wording clarifications: scope excludes ignored files, and proposed production work requires separate user authorization. The reviewer read the code; counts are supervisor-executed observations, not reviewer-reproduced results.

Population/qualification refinement: reviewer confirmed UNKNOWN for21/23/24 and no inferred NONRESIDENT for23/24. UNKNOWN is exact, not a wildcard. Supervisor's first implementation inspection additionally distinguished payer population from nonresident counterparty in14, subject from actor in19/20, and explicit compulsory wording from unqualified CPF wording in05/07. Builder was instructed to correct these before final tests and review.

## Initial implementation challenge

Read-only guarded synthetic probes found: trailing `and`/`plus` falsely accepted COMPLETE; missing token boundaries; nonstring raw input threw; short aliases shadowed longer ones; boundary recovery failed to retain later recognizable requests; zero-width spans passed; invalid bindings still credited facets; explicit actor/qualifier text could contradict typed fields; shared nested outcome objects allowed caller mutation to contaminate later parses. The first implementation also could not complete zero-additional-facet outcomes. Supervisor clarified core binding independently of extra facets and required only compatible bindings to credit coverage. These are evaluation-prototype defects, not newly observed production defects.

The builder received the findings for focused fixes/regressions. Reviewer paused additional probes pending a stable tests-ready snapshot. Final approval is not implied by this initial review record.

First stable snapshot: supervisor Node22 and reviewer Node24 each observed 44/44 tests passing. Reviewer confirmed the earlier fixes but found remaining concatenated-word acceptance, incomplete company-actor alias constraints, and transport-guard gaps (parent-scoped imports, additional public transports, WebSocket and `process.getBuiltinModule`). Guard probes inspected exposed paths without making connections. These findings were returned to the builder; passing the existing suite alone was insufficient for approval.

## Final verdict

**APPROVE the bounded, API-free feasibility milestone. No remaining material findings.** Reviewer independently ran the final 48/48 suite on Node 24.19.0 and rechecked prior failures plus interaction, negative-routing and unknown-example controls. Public transport imports are blocked outside the evaluation directory; all 30 Resolver prototype query paths and direct ChildProcess spawn reject before execution. Final hashes remained stable through review and are saved in `validation-results.json`.

Supervisor separately ran the final suite on Node 22.23.2: 48/48 passed. Its actual TAP output is retained in `api-free-node22.txt`; historical/scope results are retained in `integrity-results.json`. The guard's zero-request field is a stub/static assertion, not universal OS telemetry. Reviewer used rejection probes without establishing connections or invoking providers/sources/child processes.

Approval covers the declared grammar and synthetic observation contract. It does not approve unrestricted English, actual provider-output quality, production compatibility or V4. The documented bounded interpretation of case03 remains a limitation. Reviewer made no repository edits.

## Scope of the milestone

No model, source, production, prompt, schema or release-contract changes. The prototype's deliberately bounded grammar must not be advertised as general natural-language completeness. A later production proposal must assess existing supported language, schema compatibility and the usability cost of conservative UNCERTAIN results before implementing an adapter. Successful synthetic representation tests cannot verify authoritative rules or taxpayer-specific application.
