# Routing ownership revision — 05/10/2026

Starting checkpoint: `9f7682a6ba32fd3b39ea84bec8391d1e1421db4f`. User authorized continuation with a stopping checkpoint before 5% shared allowance remains. Initial allowance: 15% five-hour, 59% weekly remaining. Begin checkpoint preparation at 8% remaining; stop before 5%. No live acceptance is part of this implementation cycle.

## Supervisor implementation decision

The rejected candidate inferred ownership from co-occurrence inside residual fragments. Those fragments cannot prove requested scope. Replace that inference with positive, occurrence-based ownership of routing-only lexical mentions. Every occurrence of the parent keyword in the raw query must be accounted for; an unowned occurrence remains material. Use registry-declared parent/child relationships and narrow grammatical association patterns with no arbitrary-text wildcard or cross-sentence lookahead. The specific child must actually be mapped by production from the issue subject and independently recognized in the raw query. Match domain and governing authority. Provider topic hints do not establish ownership.

Examples of bounded associations include `personal tax relief on [my] compulsory CPF [contributions]`, `personal tax relief [can I claim] for compulsory CPF contributions`, and existing child-specific umbrella aliases such as `working mother child relief`. General category/overview/list requests remain broad, including when the child occurs in the same sentence after `including`, `plus explain`, or a second question. Treat broad-scope markers conservatively: do not infer parent ownership in their presence. Unknown associations remain unresolved; this is bounded support, not a universal English request parser.

Direct lexical mapping of a parent by a child subject must obey the same ownership check; otherwise canonical wording could bypass the guard. A separately represented broad issue (parent subject without specific child scope) can own the generic request. Derive internal `routingTopicIds` for owned parent mentions and exclude them from substantive `mappedTopicIds` on child issues. Evidence, retrieval, rule verification and application may use only existing substantive scope.

Builder owns only coverage metadata, a focused request-ownership helper, semantic reconciliation, focused regression and its runner registration. Preserve existing resolver and residual fragmentation. No accounting/statutory/source text, schema/prompt, frozen acceptance, historical artifact or V4 draft changes.

## Acceptance and stopping controls

- All four retained valid mixed-case mocks yield the two intended issues with no false residual, for both equivalent subjects and both root envelopes.
- All three retained reviewer probes remain incomplete when the broad request is omitted, with both narrow and canonical child subjects. Broad request represented separately is accountable.
- Repeated parent mentions, broad request before/after child, categories including a child, cap/SRS/Parent/WMCR/QCR/caregiver omissions, employer omission, unsupported requests, wrong authority/domain and raw-query mismatch remain fail-closed.
- Routing ownership does not expand substantive evidence topics or verify any rule.
- Independent review, focused regressions, lint, build, smoke and full validation are required for completion. Protected history remains byte-identical.

If implementation or review reveals an architectural defect, retain a truthful checkpoint instead of labeling the fix complete. V4 remains HOLD until the production correction is approved and verified; completing its acceptance design is a later task.
