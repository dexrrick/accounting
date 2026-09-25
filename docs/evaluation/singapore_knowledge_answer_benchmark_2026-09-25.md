# Reviewed Singapore knowledge benchmark — 25 September 2026

The [11-case fixture](../../tests/evaluation/singapore/reviewed-knowledge.json) tests the offline `processAccountingQuery` answer path, including conclusions, citations, applicable calculations, missing facts and effective dates. Seven cases cover the first SFRS(I) 9 pack. Four sentinels cover historical GST, CPF wages, MOM annual leave and ACRA audit exemption. Each case records its expected conclusion and official source URLs; an independent reviewer checked the ground truth and challenged the oracles before they were marked `INDEPENDENTLY_VERIFIED`. The separate [33-case baseline](singapore_knowledge_baseline_2026-09-25.md) continues to measure routing.

Run the benchmark with:

```powershell
node --import tsx tests/evaluation/singapore/run.mjs --fixture=tests/evaluation/singapore/reviewed-knowledge.json
```

The runner with no `--fixture` continues to run the routing fixture. Its reviewed-answer mode compares the actual offline answer and scenario state with explicit per-claim assertions. It checks cited source URLs and paragraph identifiers, structured journal balance where applicable, numeric amounts, missing facts and date-specific claims. An unreviewed or malformed oracle is `NOT_EVALUATED` or fails rather than earning a pass. Adversarial tests cover wrong amounts, wrong or substring-matched citations, and contradictory conclusions.

Candidate source retrieval is called separately from the answer function. Its score checks reviewed source-record recall, plus allow/forbid precision where specified. **The benchmark does not establish that the answer consumed those candidate records**; answer grounding against retrieved records is `NOT_EVALUATED`. The current fixture does not re-score routing or multi-authority handling. The 11 cases establish a first benchmark foundation, not exhaustive domain coverage.

## Current result

The saved [case-level report](singapore_knowledge_answer_report_2026-09-25.json) records the following results:

| Dimension | Passed/evaluated |
| --- | ---: |
| Candidate source selection | 10/11 |
| Substantive answer | 9/11 |
| Calculation | 3/4 |
| Citation support | 7/11 |
| Missing-fact behaviour | 2/3 |
| Effective-date handling | 2/3 |

All seven SFRS(I) 9 cases pass candidate-source selection, substantive answer and citation checks, along with every applicable calculation, missing-fact and date check. A targeted authority-and-domain eligibility rule removed an irrelevant ACRA VCC candidate from the hold-to-collect case. The historical GST source-selection case and the other-domain answer, citation, calculation, date and missing-fact gaps remain visible. These failures block any claim of general Singapore knowledge readiness.

## Source and scope controls

The fixture uses first-party [ACRA accounting-standard guidance](https://www.acra.gov.sg/regulations/accounting-standards-financial-reporting-surveillance/accounting-standards/), [ACRA's classification-amendment announcement](https://www.acra.gov.sg/news-events/news-announcements/833/), [IFRS Foundation's IFRS 9 page](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/), [IRAS historical GST rates](https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/basics-of-gst/current-gst-rates), [CPF's ordinary-wage ceiling guidance](https://www.cpf.gov.sg/service/article/what-is-the-ordinary-wage-ow-ceiling-mbr), [MOM's annual-leave guidance](https://www.mom.gov.sg/employment-practices/leave/annual-leave/eligibility-and-entitlement) and [ACRA's audit-exemption guidance](https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/preparing-financial-statements/audit-exemptions/). Exact URLs, paragraphs and claim-level evidence are in the fixture. IFRS Foundation material supports the corresponding IFRS 9 principle; ACRA identifies the Singapore SFRS(I) framework and local amendment date. The standards records remain curated summaries, not purported verbatim standard text. Direct access to the ASC-hosted standards PDF was restricted during this review, so no claim of direct verification against that PDF is made.

The SFRS(I) 9 implementation is intentionally limited to the reviewed rule slices: debt classification using business model and SPPI facts, initial measurement outside FVTPL and the trade-receivable exception, the 2024 amendment's mandatory date, eligible equity FVOCI disposal treatment, and the general 12-month ECL horizon for an explicitly non-POCI asset without a significant increase in credit risk. It asks for missing classification or ECL measurement facts and does not construct an unsupported journal. Other IFRS 9 topics and more general phrasing still need reviewed cases before the pack can be called comprehensive. Later roadmap phases cover bulk packs, broader retrieval, systematic answer grounding and regulatory monitoring.
