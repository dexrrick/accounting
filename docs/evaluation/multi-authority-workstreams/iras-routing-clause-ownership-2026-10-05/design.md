# Supervisor clause-ownership design — 05/10/2026

Starting SHA: `e94817a`, branch `codex/multi-authority-workstreams`. Production equals the approved prior implementation; two routing-ownership candidates are rejected diagnostics. The user authorized continuation. Preserve a stopping checkpoint above 5% remaining in either shared allowance window; prepare to stop at 10%. Initial reading: 100% remaining in both windows.

## Problem and owning layer

Reconciliation demands a separate owner for the routing-only individual-reliefs umbrella even when the request is specifically for CPF relief. Subject lexical wording changes whether that false residual appears. Previous fixes proved only topic co-occurrence or ownership of the umbrella's lexical mentions. Both can hide independent broader requests. Fix semantic reconciliation and routing metadata; do not modify accounting, sources, statutory content, provider schema/prompt or evidence gates.

## Positive whole-query proof

Introduce a bounded, deterministic request-scope helper. It returns a full consumption proof for the raw query, or an unknown/incomplete result. The proof is an ordered partition of request/factual-context spans plus supported separators; no text is silently dropped. Each request atom carries its topic requirement, operation and relevant population. There is no arbitrary-text wildcard, search-ahead to a topic, generic "ignore the suffix" rule or widening-word blacklist.

Support finite grammatical forms for individual relief requests and the separate CPF employer question in the retained mocks. Request wrappers include explain/rule requests, eligibility questions, amount questions and the existing "what can they claim for" form. Their entire objects must match bounded registry-declared specific-relief noun phrases. Specific forms include personal/individual tax relief on/for compulsory CPF contributions and related named relief topics, including existing exact aliases. Amount syntax such as "How much personal tax relief can I claim for compulsory CPF contributions?" must consume both the verb phrase and object.

An optional salary-context lead-in must be completely matched by a finite factual grammar (e.g. subject + earns/earning + currency amount + monthly period); do not skip arbitrary text before the first question. A punctuation/conjunction boundary is useful only if all resulting spans match supported grammars. Unsupported connectors and suffixes (`together with other available reliefs`, `covering ... too`, `including ...`) remain unconsumed and block inferred routing ownership. Unknown wording stays conservatively incomplete.

Evaluate ownership against the complete semantic plan, after deriving substantive topic mapping from actual issue subjects and independent raw inventory. Each supported request atom must have a compatible mapped issue for its topic, governing authority/domain, population and requested operation. Distinct requested operations cannot be satisfied by one issue with the wrong operation. A peer employer calculation must have a separately represented CPF employer issue. Model topic hints cannot establish ownership. A broad relief atom requires a separate generic relief issue; a specific CPF issue cannot own it.

Only a complete proof may assign a routing-only parent to a related specific child. Declare those relationships in the existing coverage registry. Record derived parent IDs as internal `routingTopicIds`, distinct from substantive `mappedTopicIds`. A child issue whose subject lexically matches the parent must not bypass the same proof. Detect child-specific subject scope independently of whether the raw query contains that child; invented child subjects cannot own a generic parent. A generic parent-only issue retains the existing direct mapping path and can represent a separately requested broad outcome.

Do not broaden the existing residual parser or turn this bounded helper into a general natural-language parser. Unknown mixed requests may retain a false residual until explicitly supported; omission safety takes priority. Without a routing parent in independent inventory, keep current reconciliation behavior. Generic-only plans retain baseline behavior outside the new proof guarantee.

For a plan with any related child-specific subject and a routing parent in raw inventory, incomplete query consumption or any incompatible/unowned request atom MUST force `hasUnmappedResidual=true` and `coverageEstablished=false`, even if a generic sibling maps the parent directly. Vetoing only inferred routing IDs is insufficient. Scope detection uses subject topics before intersection with raw inventory. Record a bounded proof failure in the reconciled plan for diagnosis, using an internal optional field rather than changing the provider wire schema. `OTHER` and `EXPLAIN_RULE` cannot satisfy CHECK_ELIGIBILITY or CALCULATE atoms. Match requested operations explicitly; do not use wildcard operation equivalence.

Span indices refer to the original query, and ordered spans/separators must cover it exactly (including declared whitespace), without unexplained gaps or overlaps. Unsupported lead-ins, connectors, multi-role asks and interactions may remain incomplete. Do not claim that generic-only or no-parent baseline behavior now has a full-query completeness guarantee.

## Acceptance and delegation

Independently review this design before builder implementation. Builder owns a focused scope helper, reconciliation integration, registry routing relationships, focused regression and one test-runner registration. Supervisor owns architecture, compatibility decisions and final verification. Independent production review follows implementation.

- Both retained subject paraphrases and both root envelopes produce exactly two issues, with IRAS eligibility and separate CPF employer CALCULATE, no false umbrella residual.
- Preserve all three first rejected probes and both later suffix probes, with narrow/canonical subjects; omitted broad requests stay incomplete. Separately represented broad requests remain accountable.
- Test unknown leading/trailing text, unsupported connectors, repeated mentions, multiple sentences, recognized but omitted relief topics/cap/employer, missing or mismatched operations/populations, topic hints without raw support and wrong authority/domain.
- Test grammar generalization across amounts/pronouns and named relief families, not an exact whole-scenario string.
- Actual workstream evidence scope remains substantive-only; inferred parent ownership cannot verify a rule or application.
- Preserve frozen diagnostics/artifacts. Before/after protected history: 389 rows /221 distinct paths. Required completion checks: focused/adjacent regressions, lint, build, smoke and full suite under Node22 with external transport blocked.

V4 acceptance remains HOLD during this cycle. No live provider/source capture, acceptance consumption, final profile, push, merge or deployment is included. If the design or implementation is rejected, retain a truthful diagnostic checkpoint and restore production.
