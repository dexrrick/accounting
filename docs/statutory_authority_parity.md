# Singapore statutory authority parity

## Goal

The statutory assistant must use one governed mechanism for official-source discovery, retrieval, content extraction, evidence admission, citations, dates, and future updates. IRAS's current production design is the parity reference, **not** an exemption from shared controls. Functional parity is a prerequisite for broad live-answer accuracy testing; a passing sitemap test is not a live-answer acceptance result.

## Shared source contract

1. **Route:** decompose every user request into authority-owned issues and reviewed coverage topics; preserve original query and missing facts.
2. **Discover:** use per-authority approved HTTPS host configuration, official HTML/XML sitemaps, bounded robots.txt fallback, then restricted first-party site search. Never use sitemap titles, links or search snippets as answer evidence.
3. **Fetch:** independently fetch official pages through the controlled transport, checking final host, redirects, content type, page title, relevant *body* and exact topic scope.
4. **Extract:** produce `AuthoritativeSourceRecord` records, with actual source passages, source publisher, requested authority, canonical URL, hash, retrieval time, topic bindings, provenance and applicable dates. A fetched record is `LIVE_EXTERNAL / NEEDS_REVIEW / CANDIDATE`, not reviewed permanent knowledge.
5. **Admit:** apply authority/domain/topic and issue-subject isolation, date and completeness checks and a verified fetch trace before accepting a source passage; verify exact quotations before presenting claims.
6. **Version:** preserve version snapshots and support review, approval, activation and rollback through the existing `liveRegulatoryFeed` and `sourceVersioning` models. Query-time candidates must **not** be silently persisted or auto-promoted.
7. **Answer:** require sourced claims and disclose unresolved issues or dates; keep distinct authority workstreams separate in mixed questions.

## Status (14 October 2026)

| Scope | State on main prior to catch-up | Current catch-up scope |
| --- | --- | --- |
| IRAS | Full mapped/sitemap/domain search with governed evidence and answer gates | Preserve; do not regress |
| CPF | Employer/member sitemap discovery; workstream largely reviewed-local | Shared live evidence workstream with exact trace checks |
| ACRA | Separate open PR #12 for sitemap and corporate evidence | Do not duplicate/overwrite; merge and integrate after review |
| MOM | Official Employment Act update adapter and local rules; no answer sitemap provider | First-party sitemap, official page validation, bounded live workstream |
| MAS | Local regulatory rules, no official sitemap provider | First-party sitemap, official HTML validation, bounded live workstream |
| SSO / AGC | Statutory-law retrieval and exact-provision update adapter | Reuse as cross-authority legislation publisher; broader act navigation remains to be normalised |

### Intentional remaining gaps before broad live testing

- Finish ACRA PR #12 integration and end-to-end answer admission.
- Build consistent HTML + PDF/table extraction. MAS notices, circulars, regulatory forms and historical schedule tables may require document-specific extraction; do not treat a PDF URL or index entry as content.
- Unify regulatory-update scheduling and staged change review for MAS with the same contract used by IRAS, CPF, MOM, ACRA and AGC.
- Establish an end-to-end acceptance dataset for *every* authority covering discovery success, citation correctness, retrieved passage, statutory effective period, topic coverage and wrong-authority isolation.
- Validate current production Cloudflare source transport separately from deterministic offline tests. Do not merge solely on synthetic fixtures.
- Retain the open IRAS fresh-official-source production acceptance gate (Issue #9).

## Offline acceptance requirements

- Every configured provider produces only approved first-party HTTPS candidates, even if sitemaps include other approved Singapore authorities, external domains or insecure schemes.
- Official sitemap membership is metadata; the actual page must pass topic-specific fetched-body checks.
- A verified live page retains candidate provenance, correct authority and publisher, content hash and retrieval timestamp.
- An official page from a different authority, an empty/irrelevant body, an unbounded past-date request, or a source without a matching retrieval trace cannot verify the question.
- Local-only mode must not perform external fetches.
- Mixed-authority questions must preserve every original material issue and must not allow cross-authority claims.
- Existing IRAS and CPF regressions must remain green.

## Live acceptance phase (after parity)

Run the same question bank format and pass/fail criteria separately for IRAS, CPF, ACRA, MOM and MAS, plus compound cross-authority questions and AGC act citations. Record total requests, exact outcome coverage, source retrieval/citation pass rates, verified-vs-conditional-vs-insufficient statuses, timeouts, wrong-topic errors, version/date errors and provider failures. Do not report a single accuracy percentage until the representative benchmark and ground-truth review are complete.
