# Request completeness redesign — bounded feasibility specification

Status: prospective design; not production approval or V4 preregistration.
Normative companion: `grammar-contract.md` supplies grammar, qualification, binding and uncertainty details. Its explicit refinements take precedence over abbreviated fixture labels below.
Starting checkpoint: `9f7682a6ba32fd3b39ea84bec8391d1e1421db4f`.
Branch: `codex/request-completeness-redesign`.

## Purpose and boundary

The current reconciliation confuses an independently requested answer with topic inventory. The rejected candidate also allowed a child topic to hide an omitted overview. This experiment separates requested outcomes, routing signals and context before any production change. All code belongs under `tests/evaluation/request-completeness/`; no provider, production module, schema, prompt, source, evidence gate, release harness or consumed artifact may be changed. No model or source requests are authorized.

The first milestone is a reviewer-approved contract and API-free prototype. It does not prove unrestricted natural-language interpretation or fix the production defect. A subsequent production task needs a reviewed adapter and its own regression validation.

## Independent inventory and bounded COMPLETE

The prototype must derive its inventory from the raw question using a declared, compositional request grammar. It must not receive expected outcomes, fixture IDs, model-owned outcomes, routing topics or evidence as inventory input. Matching entire fixture questions or returning their labels is prohibited. Hand-labelled fixture expectations are an independent test oracle, never runtime input.

The grammar recognizes a bounded set of request heads, subject aliases, populations and scope modifiers. These identify requests, not tax/accounting answers. It must consume the entire input except explicitly recognized background facts, connective tokens and whitespace. Unknown clauses, ambiguity, negated instructions, unsupported boundaries and unrecognized subject modifiers yield UNCERTAIN; partial recognized requests remain visible. No keyword co-occurrence or delimiter split alone may establish COMPLETE. Grammar tokens/productions must be documented separately from test expectations. Subject aliases must be bounded and must preserve foreign/domestic, employee/employer and general/specific distinctions. Confidence, topic union, issue count and cited evidence cannot establish request completeness.

An outcome has a stable local ID, literal request span(s), operation, subject identity, population, scope (`SPECIFIC`, `OVERVIEW`, `INTERACTION`, `ALTERNATIVE_DECISION`), mandatory facets and participants. Facts/context have their own spans. Span coordinates are half-open UTF-16 offsets into the exact raw query, without lossy normalization. A span locates a request; it does not prove representation. Overlapping spans are allowed for coordinated requests; malformed/out-of-range spans fail validation.

Semantic issues are synthetic normalized observations with distinct IDs, bounded subject text, operation, population, scope, facets and outcome bindings. The prototype validates subject text independently against bounded identities; a claimed ID or whole-question span cannot substitute for correct dimensions. This contract is prospective, not the current V2 provider wire schema.

Outcome-to-issue binding is many-to-many. A broad overview is not satisfied by one named example. A decision between alternatives requires both facets but can be one outcome/issue. An interaction requires the relation itself, not merely separate rules for its participants. Multiple issues may collectively cover a requested outcome's mandatory facets; every issue must have a justified binding. Duplicate issue IDs and semantically redundant issues fail precision. An issue cannot cover a different operation, population, scope or subject merely by claiming its outcome ID. Invented requests and facts promoted into issues fail precision.

COMPLETE requires: complete independent raw-input parse; valid semantic observations/bindings; every required outcome and facet represented; no material extra issue. INCOMPLETE requires a complete independent parse with a demonstrable omission, mismatch or extra issue. UNCERTAIN is mandatory when inventory completeness cannot independently be established, semantic output is absent/malformed, legacy fields are insufficient, or the raw request remains ambiguous. Diagnostics retain all findings; the primary stage is the earliest meaningful stage, not a generic evidence failure. Routing metadata changes must leave the result unchanged.

## Separation and future adapter

Request representation (`COMPLETE`, `INCOMPLETE`, `UNCERTAIN`) is independent of rule support, application and authority routing. An unsupported SFRS(I) 6 request can be fully understood and COMPLETE while support remains INSUFFICIENT. COMPLETE cannot set evidence VERIFIED or application VERIFIED. Existing production evidence admission, claim verification, requested-concept coverage and case-fact gates stay authoritative.

Future integration should initially add a small gate adapter, not rewrite workstreams. COMPLETE would only permit existing downstream checks; INCOMPLETE/UNCERTAIN block a supported overall result. Routing-parent annotations can guide retrieval, but can never create, satisfy or erase outcomes. Existing V2 lacks explicit request bindings and scope/facet fields. Compatibility must derive only independently justified fields; missing relationships/scope cannot inherit existing `coverageEstablished: true`. A future versioned schema may enrich the existing single semantic call; a second call or retry is not part of this design. Prompt/schema migration and any impact on existing supported scenarios must be reviewed before production implementation.

## Fixture expectations (supervisor oracle)

These are representation tests, not statutory answers. `explain`, `eligible`, `calculate`, `treatment`, `filing`, `classify`, `measure` and `interaction` describe requested operations. The prototype may use documented equivalents to current production enums. Omission mutations remove one required outcome/facet; misrepresentation mutations retain superficially plausible issue counts.

| ID | Raw question | Independent requested scope |
|---|---|---|
| 01 | Can I claim personal tax relief on my compulsory CPF contributions? | Individual CPF relief; eligible; specific |
| 02 | How much personal tax relief can I claim for compulsory CPF contributions? | Individual CPF relief; calculate; specific |
| 03 | For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF? | Individual CPF relief eligible + employer CPF calculate; salary is context |
| 04 | What individual tax relief categories are available, plus explain CPF relief for employees? | Individual relief overview + employee CPF relief explain |
| 05 | I need an overview of individual tax relief categories. Can I claim CPF relief for employees? | Individual relief overview + individual CPF relief eligible |
| 06 | Explain individual tax relief categories, including CPF relief for employees. | Individual relief overview with mandatory CPF example facet; child-only fails |
| 07 | Can I claim CPF relief for employees? I need an overview of individual tax relief categories. | Same outcomes as 05 in reversed order |
| 08 | Explain CPF relief for employees. | Employee CPF relief explain; no overview |
| 09 | How much CPF must the employer contribute? | Employer CPF calculate; no personal relief |
| 10 | How much CPF do the employee and employer contribute? | Employee CPF calculate + employer CPF calculate |
| 11 | Our Singapore company paid SGD 900 for the director's private holiday and recorded it as travel expense. What is its corporate income-tax treatment? | Company private expense tax treatment; factual conjunction is context |
| 12 | Our Singapore company received a dividend from its Thai subsidiary in the current year. Explain the company's Singapore corporate income-tax treatment for this receipt. | Company foreign dividend treatment; receipt facts are context |
| 13 | How do Singapore tax rules determine whether a company is tax resident here? | Company tax residency general rule explain |
| 14 | What are the general Singapore withholding-tax rules when a company pays royalties to a non-resident company? | Company nonresident royalty WHT explain; resident substitution fails |
| 15 | What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company? | Company general input recovery explain; blocked-only substitution fails |
| 16 | Explain the accounting treatment of exploration and evaluation under SFRS(I) 6. | Accounting exploration/evaluation explain; support unsupported, representation can COMPLETE |
| 17 | Can this person obtain an Employment Pass and is the company subject to an employment quota? | Individual pass eligibility + company quota applicability |
| 18 | When is the annual return due and must financial statements be filed? | Company annual return filing + company financial statement filing |
| 19 | Does this fund manager need a CMS licence or qualify for an exemption? | Fund manager applicability alternative decision; required licence and exemption facets |
| 20 | Should this investment be FVPL or FVOCI and how should subsequent changes be measured? | Investment classification alternative decision + subsequent measurement |
| 21 | How should this expense be accounted for and is it tax deductible? | Expense accounting treatment + tax deductibility eligibility; population UNKNOWN |
| 22 | Explain how CPF employer contributions affect personal CPF tax relief. | Interaction involving employer CPF and individual relief; separate rules alone fail |
| 23 | Explain the general GST input tax rule and explain the general royalty withholding tax rule. | GST recovery explain + royalty WHT explain; population UNKNOWN, no inferred nonresident qualifier |
| 24 | Explain the general royalty withholding tax rule plus explain the general GST input tax rule. | Same outcomes as 23 reordered with equivalent connector |
| 25 | Explain personal tax reliefs. | Individual relief overview; CPF-specific issue alone fails |
| 26 | Do not explain personal tax reliefs; explain CPF relief instead. | UNCERTAIN in bounded grammar; no guessed positive inventory |
| 27 | What about that and the other treatment? | UNCERTAIN unresolved reference |
| 28 | Explain CPF relief for employees and assess the unfamiliar zorb levy. | Retain recognized CPF request but UNCERTAIN unrecognized material request |

Minimum controls: correct observations for every fully parsed case; every outcome/facet omission; wrong operation/population/subject/scope; added/invented outcome; context promoted into request; invalid/whole-question binding spans; missing bindings; malformed/provider failure; legacy V2 without proposed fields; duplicate IDs/issues; separate participant rules used for interaction; alternatives collapsed; routing additions/removals/parent-child hints; unknown suffix; changed qualification; conjunctive facts; reorder and meaningful connector equivalence. Do not assume `including` preserves the meaning of `and`: case 06 is one broad outcome with a required example, unlike 04/05.

## Resource, integrity and decision gates

Pure MJS prototype and focused Node tests, no production imports or network APIs. A guard preload must reject fetch/http/https and unexpected transport; prototype must have no provider path or retries. Compare production, V4 draft, diagnostic proof and historical artifact Git objects to the starting checkpoint before/after. Verify all 389 frozen historical rows against original retained bytes and compare stored Git content separately, accounting explicitly for Git line-ending normalization. Never rewrite consumed material to make a check pass.

Review order: supervisor specification/oracle -> independent reviewer challenge -> revise -> builder evaluation-only prototype -> API-free tests -> independent reviewer code/counterexample review -> supervisor verification -> clean branch checkpoint. No lint/build/full suite is needed for unintegrated evaluation-only MJS unless review exposes an actual shared-code change. Stop at the reviewed milestone; production implementation needs a new concrete scope. A failed bounded feasibility test is design evidence, not permission to patch production or claim readiness.
