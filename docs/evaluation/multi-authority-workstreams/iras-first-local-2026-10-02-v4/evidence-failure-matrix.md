# Evidence lifecycle matrix before changes — 02/10/2026

Baseline: `22f4ae5a4f1173dc89991d602fcf30a5129012ad`. Evidence: immutable `../iras-first-live-2026-10-02-v3/iras-mapped-source-diagnostic-v3.json` and supervisor report. All nine mapped URLs returned HTTP 200, without model calls or retained HTML.

Expected domains are canonical workstream/registry areas. Semantic `IRAS_INCOME_TAX` is broader than a map domain. `NR` means not recorded, never zero. V3 did not persist passage counts, candidate-claim counts or exact uncovered concept IDs.

| Case | Topic | Source map | Expected domain | Map domain | Fetch | Compatibility | Candidate/admission | Passages | Candidate claims | Verified claims (issue) | Uncovered | First observed failure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Private expense | iras-cit-deductibility | IRAS_CIT_EXPENSES_SOURCE_MAP | IRAS_CORPORATE_TAX | IRAS_CORPORATE_TAX | 200 | SUCCESS | 1/1 | NR | NR | 1 | sibling topic; concepts NR | Sibling compatibility below |
| Private expense | iras-cit-disallowed-expenses | IRAS_CIT_EXPENSES_SOURCE_MAP | IRAS_CORPORATE_TAX | IRAS_CORPORATE_TAX | 200 | TOPIC_MISMATCH | 0/0 | not reached | not reached | 1 across issue | disallowed topic; concepts NR | Page/excerpt compatibility before candidate construction |
| Foreign dividend | iras-foreign-sourced-income | IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP | IRAS_CORPORATE_TAX | IRAS_CORPORATE_TAX | 200 | SUCCESS | 1/1 | NR | NR | 0 | scoped topic/concepts; IDs NR | After admission, by claim verification/filtering; exact substage requires fixture trace |
| Corporate residency | iras-corporate-tax-residency | IRAS_CIT_RESIDENCY_SOURCE_MAP | IRAS_CORPORATE_TAX | IRAS_CORPORATE_TAX | 200 | TOPIC_MISMATCH | 0/0 | not reached | not reached | 0 | scoped topic/concepts; IDs NR | Page/excerpt compatibility before candidate construction |
| WHT royalty | iras-withholding-tax | IRAS_WHT_RATES_SOURCE_MAP; IRAS_WHT_SCOPE_SOURCE_MAP; IRAS_WHT_OVERVIEW_SOURCE_MAP | IRAS_CORPORATE_TAX | IRAS_CORPORATE_TAX | 200 | DOMAIN_MISMATCH | 0/0 per map | not reached | not reached | 1 local | scoped topic/concepts; IDs NR | URL-domain comparison before candidate construction |
| WHT royalty | iras-withholding-tax-interest-royalties | IRAS_WHT_RATES_SOURCE_MAP; IRAS_WHT_SCOPE_SOURCE_MAP | IRAS_CORPORATE_TAX | IRAS_CORPORATE_TAX | 200 | TOPIC_MISMATCH | 0/0 per map | not reached | not reached | 1 local | scoped topic/concepts; IDs NR | Page/excerpt compatibility before candidate construction |
| GST input tax | iras-gst-input-tax | IRAS_GST_INPUT_TAX_SOURCE_MAP; IRAS_GST_INVOICING_SOURCE_MAP | IRAS_GST | IRAS_GST | 200 | SUCCESS | 1/1 per map | NR | NR | 0 | scoped topic/concepts; IDs NR | After admission, by claim verification/filtering; exact substage requires fixture trace |

## Owning-layer code trace

- `groundingContextBuilder.ts` supplies topic vocabulary, independently validates substantive body content, compares URL-domain/population, selects an excerpt, then builds a live candidate. Contiguous normalized phrases are checked independently for each sibling even on a cached page. Map linkage alone is never substantive evidence.
- WHT URL-domain comparison requires query wording (`withholding tax` or `wht`) although topic/map already identifies WHT. Hyphenated subject wording is a candidate cause requiring fixture proof. Map domains are already corporate tax.
- `evidenceQualityGate.ts` checks association, authority/domain, provenance, dates, distinctive text and requested concepts before admission.
- `irasEvidencePolicy.ts` selects bounded complete passages, skips incomplete lists/headings, then verifies literal quotations. `authorityWorkstreams.ts` re-verifies supplied claims and requires topic/concept plus subject support for final coverage.
- Workstream subject support uses distinctive tokens. Case facts/wording differences can reject a general rule; fixtures must locate whether loss occurs here or earlier in passage selection.
- Final scope/concept/no-claim gaps are downstream symptoms, not permission to weaken earlier checks.
- Residency dimensions/specificity passed 6/6; literal subject anchors passed 1/6. Raw subjects were not retained, so prospective safe features are required before changing the matcher.

## Required next evidence

Fill unobserved stages with reproducible API-free synthetic fixtures, clearly separate from historical live results. Include negative controls for unrelated topics, wrong domains, official URLs without rule text and unrelated siblings. Do not persist fresh HTML or raw model/question content.

## Synthetic API-free stage trace before production edits — baseline v3

The authoritative synthetic run is `synthetic-stage-trace-baseline-v3.json`, captured against the baseline commit above before any production edits. It exercised `buildGroundedReasoningContext`, the existing LOCAL quote renderer, and final `buildAuthorityWorkstreams` validation through an injected `customFetch`; ambient network calls and model calls were both zero. These counts describe hand-authored fixture HTML only. They do not reconstruct V3 live HTML or its missing passage/claim counts.

Counts below are `fetched fixture paragraphs / candidate records / admitted records / renderer-selected claims / literal-verified claims / final issue claims`. `NR` means not applicable or unavailable. Every case had zero uncovered requested concept IDs; uncovered topic IDs are retained in the JSON trace.

| Synthetic probe | Counts | First local failing stage |
| --- | --- | --- |
| Private expense — deductibility topic | 1 / 1 / 1 / 1 / 1 / 1 | NONE |
| Private expense — disallowed-expenses topic | 1 / 0 / 0 / 0 / 0 / 0 | PAGE_OR_EXCERPT_COMPATIBILITY |
| Foreign dividend — conditional dividend rule | 1 / 1 / 1 / 1 / 1 / 1 | NONE |
| Foreign income only — no dividend wording (negative) | 1 / 1 / 1 / 1 / 1 / 0 | ISSUE_SUBJECT_CONCEPT_FILTER |
| Company residency — natural wording | 1 / 0 / 0 / 0 / 0 / 0 | PAGE_OR_EXCERPT_COMPATIBILITY |
| Company residency — exact `company tax residency` phrase | 1 / 1 / 1 / 1 / 1 / 0 | ISSUE_SUBJECT_CONCEPT_FILTER |
| WHT royalties — hyphenated query | 2 / 0 / 0 / 0 / 0 / 0 | URL_DOMAIN_QUERY_COMPATIBILITY |
| WHT royalties — spaced-query control | 2 / 2 / 2 / 2 / 2 / 2 | NONE |
| GST input tax — natural `recover input tax` wording | 2 / 0 / 0 / 0 / 0 / 0 | PAGE_OR_EXCERPT_COMPATIBILITY |
| GST input tax — exact `input tax claim` wording | 2 / 2 / 2 / 2 / 2 / 2 | NONE |
| Unrelated IRAS topic text at residency map | 1 / 0 / 0 / 0 / 0 / 0 | PAGE_OR_EXCERPT_COMPATIBILITY |
| Renovation sibling query with private-expense text | 1 / 0 / 0 / 0 / 0 / 0 | PAGE_OR_EXCERPT_COMPATIBILITY |
| Positively admitted foreign-dividend record relabelled `IRAS_GST` | NR / 1 / 1 / NR / NR / NR | EVIDENCE_ADMISSION (unexpectedly admitted) |
| Official source-map URL without rule text | NR / NR / 0 / NR / NR / NR | EVIDENCE_ADMISSION |
| CPF relief unchanged synthetic control | NR / 1 / 1 / 1 / 1 / 1 | NONE |

The wrong-domain row begins from the admitted foreign-dividend record, so its one eligible record is a reproduced admission-gate failure rather than a vacuous test. The foreign-income-only row is an intentional subject-negative: selection and literal quotation pass, while final issue support correctly rejects the missing dividend concept.

## Subsequent V4 observations and exact-contract local probes

The immutable V4 source measurement is in `../iras-first-live-2026-10-02-v4/`. It used eight actual mapped GETs, no model/search/discovery requests. The report normalized HTTP codes, so use its successful mapping results rather than claiming that every event recorded HTTP 200.

| Frozen case | Literal renderer accepted claims | Final issue claims | Rule status | Application | Remaining observation |
| --- | --- | --- | --- | --- | --- |
| Private expense | 3 | 1 | INSUFFICIENT | UNRESOLVED | Disallowed sibling still TOPIC_MISMATCH; scope/concept gap |
| Foreign dividend | 3 | 0 | INSUFFICIENT | UNRESOLVED | Loss after literal rendering; scope/concept gap |
| Corporate residency | 3 | 3 | VERIFIED | NOT_REQUIRED | No blocking gap |
| WHT royalty | 2 | 1 | INSUFFICIENT | NOT_REQUIRED | Royalty sibling still TOPIC_MISMATCH; scope/concept gap |
| GST input tax | 1 | 0 | INSUFFICIENT | NOT_REQUIRED | Loss after literal rendering; scope/concept gap |

The later API-free trace `foreign-gst-central-filter-diagnostic-v1.json` uses the **complete frozen semantic subjects**, unlike the shorter earlier fixture subjects. Its default local GST record passes admission and literal quotation verification, then yields zero final claims at the central subject/concept filter. Synthetic mapped GST rules retain two final claims but still leave the full semantic concept uncovered. The central GST branch uses distinctive phrase support instead of the shared concept matcher. Foreign dividend conditional synthetic prose already passes, while general foreign income without dividend wording correctly loses final support. Default local foreign retrieval finds no eligible record, a separate upstream state.

These probes establish current gate behaviour; they cannot reconstruct the missing words in V4 live quotations because those bodies were intentionally not retained. Literal quotation verification itself remains unchanged. The proposed next correction is bounded general-rule concept equivalence at the evidence/filter layer, with material additional meanings kept uncovered and application eligibility unresolved.
