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

### Shared document extraction checkpoint

The shared retrieval branch adds a bounded `extractExternalDocument` candidate API for official HTML, plain-text and PDF documents. It retains the publisher from the final approved host separately from the governing authority, hashes the exact response bytes, records the extracted section/page locator and retrieval/version metadata, and leaves every result `CANDIDATE / NEEDS_REVIEW / LIVE_EXTERNAL` with grounding disabled. `lastVerifiedDate` stays absent until an independent review verifies the candidate. It does not register or activate new material.

HTML evidence requires a unique structural section or element with substantive paragraph/list content or a coherent data table; headings, navigation and link-only blocks are rejected. PDF evidence is parsed from embedded text with a locally bundled pdf.js worker; page count, body size, parser time and extracted text are bounded. Layout-based cell separation is retained when repeated rows align, while ambiguous tables and mixed image-only pages remain partial and ungroundable. Encrypted, malformed, scanned-only or oversized PDFs fail closed. Historical dates are recorded only when an applicability interval is stated in the extracted passage, and a requested date must fall inside that interval.

SSO retrieval uses the repository's Act-to-authority identity mapping, exact registered Act URL, and a requested section locator. Exact numeric subsections reuse the existing SSO parser only behind section/Act guards; a structural fallback handles explicit Act section IDs, including alphanumeric section numbers without a subsection. This is a bounded retrieval path, not full SSO navigation parity. The offline regression covers synthetic HTML, legislation and a generated binary PDF; no broad live accuracy acceptance has been run.

### MAS regulatory lifecycle slice (15 October 2026)

`MASDocumentUpdateAdapter` accepts an explicit list of monitored MAS document/provision definitions with stable record IDs and shared `OfficialDocumentExtractionRequest` expectations. Register it explicitly with `LiveRegulatoryFeedService.registerAdapter`; no production document catalog, additional sitemap implementation, or automatic MAS schedule is enabled. Existing discovery candidates can supply a document URL only after a monitor's identity, topic and structural extraction expectations have been supplied. Index metadata never becomes document evidence.

The adapter retrieves actual bounded HTML/PDF bytes and stages content-addressed update packages. Verification replays the shared extractor against the exact raw bytes, MIME type, final URL and bound request, preserving document/provision hashes, locators, applicability dates, publisher and retrieval metadata. Only exact, unambiguous extracts can proceed. Explicit `approveUpdatePackage(packageId, reviewer, reason)` approval follows verification and precedes MAS activation; recording a review note alone does not approve a package. The shared admission gate below controls whether an approved active version can ground an answer.

Version history and rollback are exercised with offline HTML and generated binary PDF fixtures, including first activation and predecessor restoration. These fixtures establish lifecycle behavior, not live MAS accuracy or authority functional parity. Review and activation state remain in memory under the existing lifecycle architecture. Production monitor configuration, review UI, persistence and coordinated authority acceptance remain follow-up work.

### Shared approved-document admission and citations

Extracted document versions use the existing source ledger to retain a package-bound human approval receipt. Shared admission checks the exact active version, immutable ledger snapshot, retrieval/publisher provenance, document/provision hashes, locator and applicable date. Newly activated records are visible to already constructed registry-backed retrievers. Staged, rejected, superseded or altered document versions remain ineligible; rollback changes eligibility through the active version pointer. Existing curated and query-time source paths retain their separate safeguards.

Verified document quotations and citations carry a binding containing record ID, active version ID, document hash, provision hash and source locator. Quotation verification retains the existing whole-span and attached-qualification rules. Structural citation verification continues to distinguish an agency guideline from a primary statutory provision. An undated document with no source-supported effective interval is usable only on its captured day; publication dates are not silently treated as effective dates.

Two targeted MAS sources were inspected on 15 October 2026: Fund Management Licensing and circular IID 04/2025. Their official byte endpoints returned HTTP 200 Maintenance HTML, including the PDF endpoint. Exact compressed response fixtures and provenance/review notes are retained under `tests/fixtures/mas-reviewed/`; their offline tests verify rejection and absence of registry activation. Cached web-reader text was inspected only to identify the intended documents and was not substituted for exact source bytes. **Positive real-MAS document admission remains unverified** until genuine document bytes are available. The synthetic admission regressions and these negative real-response cases do not establish authority parity or broad live accuracy.

Validation on Node 22.23.1: focused admission/citation, lifecycle and reviewed-response tests passed; the final `npm test` run passed all 124 offline regression suites. `npm run lint` and `npm run build` passed with existing repository warnings. Independent re-review cleared the material findings, including managed-to-legacy downgrade attempts, historical citation lookup, Singapore date boundaries and baseline eligibility during staging/rollback.

### Intentional remaining gaps before broad live testing

- Finish ACRA PR #12 integration and end-to-end answer admission.
- Validate the shared extraction API against reviewed official MAS notices, circulars, forms and historical schedule tables; ambiguous layouts intentionally remain ungroundable until their structure can be retained safely.
- Complete production MAS monitor registration and review integration before considering automatic regulatory-update scheduling. The opt-in content lifecycle above does not enable background MAS checks.
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
