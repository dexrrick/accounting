# Singapore Knowledge Foundation Benchmark — 25 September 2026

The pre-change baseline was recalculated in a temporary detached `HEAD` worktree using the same 33 questions and reviewed authority, topic, and multi-authority labels as the post-change run. Explicit `expected.domainIds` labels were added to the fixture later; the pre-change classifier did not expose fine-grained domain routing, so that baseline dimension remains `NOT_EVALUATED`. The current fixture is [`gemini-seed.json`](../../tests/evaluation/singapore/gemini-seed.json) (SHA-256 `896be8815f59ec6bdd64306eea5ebe4efdb2dba12b8cde5ca5470b9788d1393d`). It contains 30 prompts transcribed from the supplied Gemini text, negative ambiguity controls, and two roadmap sentinels for the required 13O/13U multi-authority route.

These questions measure routing only. Gemini's factual wording is not treated as validated law or as an expected answer. A routing dimension passes only when its returned set exactly matches the reviewed fixture labels. Fine-grained domain labels are stored explicitly per case and are not inferred by the runner from the registry. Topic routing is an exact topic-ID-set comparison, not a count of validated legal concepts; canonical alias groups affect retrieval ranking only. The previous 32-case baseline measurement was superseded because the fixture and some labels were refined during implementation.

| Dimension | Pre-change baseline | Post-foundation |
| --- | ---: | ---: |
| Authority routing | 20/33 (60.6%) | 33/33 (100.0%) |
| Fine-grained domain routing | NOT_EVALUATED | 33/33 (100.0%) |
| Topic routing | 10/33 (30.3%) | 32/33 (97.0%) |
| Multi-authority handling | 33/33 (100.0%) | 33/33 (100.0%) |
| Source retrieval | NOT_EVALUATED | NOT_EVALUATED |
| Answer correctness | NOT_EVALUATED | NOT_EVALUATED |
| Calculation correctness | NOT_EVALUATED | NOT_EVALUATED |
| Citation correctness | NOT_EVALUATED | NOT_EVALUATED |
| Missing-fact behaviour | NOT_EVALUATED | NOT_EVALUATED |
| Effective-date correctness | NOT_EVALUATED | NOT_EVALUATED |

No reviewed source-record, answer, calculation, citation, missing-fact, or effective-date oracles are present, so those dimensions remain `NOT_EVALUATED`; routing scores do not establish that an answer or legal conclusion is correct.

One post-change topic-routing miss remains: `mom-work-passes-drc-levy` identifies the DRC topic but does not infer the specific foreign-worker levy topic from the generic word “levies.” The benchmark records that gap rather than broadening a generic levy keyword and risking unrelated matches.
