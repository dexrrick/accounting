# Singapore source map phase: existing flow and source checks

This records the architecture inspected before the consolidation and investment source-map changes on 25 September 2026. The attached implementation plan supplied phase requirements; it is not a source of accounting rules.

## Existing answer flow

1. `processAccountingQuery` calls the reviewed `answerSfrsi9KnowledgeQuery` before transaction parsing for supported SFRS(I) 9 questions. Those answers use the local standards repository and do not require live retrieval.
2. Other questions pass through deterministic transaction parsing and, when an AI provider is available, `buildGroundedReasoningContext`. That function uses `classifyQuestion`, `QueryTopicResolver` and the coverage registry to create retrieval hints.
3. `AdvancedSourceRetriever` combines the local source retriever, chunking, vector search and deterministic reranking. `CompositeSourceRetriever` keeps staged live-update candidates separate from the local active registry. The unified source model carries provenance, status, effective period, freshness, hashes and lifecycle fields.
4. The grounding builder sorts selected records by evidence tier and supplies facts, missing facts, assumptions and retrieved text to the provider. The response assembler and citation verifier check returned citations against source records. Existing citation verification is structural; it does not itself prove claim support or live reachability.
5. The reviewed Singapore benchmark runs offline and separately scores routing, retrieval, answer, citation, missing facts and effective-date dimensions. Candidate retrieval is not proof that the answer used the candidate.

## Verified source-map starting points

The [ACRA accounting standards guide](https://www.acra.gov.sg/regulations/accounting-standards-financial-reporting-surveillance/accounting-standards/) identifies the Singapore standards framework and links its 2026 annual volume. Its linked annual-volume portal returned HTTP 403 from this environment, so it cannot be used here as fetched topic evidence. These four official IFRS Foundation topic pages were opened successfully and their titles and summaries matched the mapped standards:

| Singapore topic | Reachable corresponding official page |
| --- | --- |
| SFRS(I) 10 | [IFRS 10 Consolidated Financial Statements](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-10-consolidated-financial-statements/) |
| SFRS(I) 3 | [IFRS 3 Business Combinations](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-3-business-combinations/) |
| SFRS(I) 1-28 | [IAS 28 Investments in Associates and Joint Ventures](https://www.ifrs.org/issued-standards/list-of-standards/ias-28-investments-in-associates-and-joint-ventures/) |
| SFRS(I) 11 | [IFRS 11 Joint Arrangements](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-11-joint-arrangements/) |

The public topic pages are official summaries, not the full SFRS(I) text. The IFRS Foundation PDF results checked for detailed paragraphs redirected to an authentication service when opened. A paragraph-level conclusion therefore requires separately accessible, verified evidence or an independently reviewed local rule. The source map must never turn a pointer or search result into answer-grounding evidence by itself.

## Implemented source-map boundary

The existing coverage registry now carries source-map metadata for SFRS(I) 10, SFRS(I) 3, SFRS(I) 1-28 and SFRS(I) 11. Its 43 standard subtopics and five cross-standard routes carry aliases, section hints, relationships and canonical source IDs. The unified source registry holds the four IFRS Foundation page pointers and the ACRA framework pointer. These URL-verified pointers have no standard text and are never grounding evidence by themselves.

The reviewed SFRS(I) 9 pack remains the first local answer path. Selective local consolidation and investment rules follow it for high-level control, significant-influence, transition, disposal and goodwill questions. Those rules identify material missing facts and avoid detailed measurements when the necessary evidence or amounts are absent. Other partial-coverage questions use mapped official-source retrieval. A fetched page must pass redirect, final-host, title and topic-content checks before a bounded relevant excerpt enters the current answer context. This live evidence remains `CANDIDATE` / `NEEDS_REVIEW`; the registry does not automatically promote it.

When no mapped source works, discovery reads only approved first-party robots and sitemap locations, considers a bounded set of candidates, and applies the same live validation. The existing held-for-sale topic supplies only IFRS 5 identity hints for this fallback; it has no fabricated canonical URL. Unavailable official endpoints or unrelated pages fail closed. The browser's access to official sites, including CORS restrictions, remains an environmental limit; deterministic tests inject controlled responses to exercise the full validation path.

Citation output uses only exact registered verified URLs or the validated final URL of evidence fetched for the current answer. The IFRS Foundation is recorded as the publisher of its pages; ACRA / ASC remains the Singapore framework authority. An official overview or framework page does not establish a specific paragraph or subtopic by itself.
