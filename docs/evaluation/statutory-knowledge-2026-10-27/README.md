# Statutory knowledge development — 27–28/10/2026

Reviewed base: [83376b3ed21360ad528328ec24bacfdcb1ca4352](https://github.com/dexrrick/accounting/commit/83376b3ed21360ad528328ec24bacfdcb1ca4352). Review branch: `codex/statutory-knowledge-20261027`. No merge or deployment. Historical ACRA release acceptance remains separate.

This batch implements or expands 18 source-backed rule entries. Entries overlap existing knowledge; they are not 18 previously unknown families. The metadata records official authority, provisions, population, conditions, exceptions, required facts and applicability evidence.

| Authority | Expanded rule entries | Newly correct independent answers | Catalog topics outside fixed100 |
| --- | ---: | ---: | ---: |
| ACRA | 3 | 3 | 22 |
| IRAS | 5 | 4 | 104 |
| CPF | 5 | 2 | 11 |
| MAS | 1 | 2 | 13 |
| MOM | 4 | 2 | 23 |

ACRA covers the 20/10/2026 officer confirmations, filing procedure and XBRL classification. IRAS covers medical/motor-car input tax, practical ECI and non-resident-company WHT. CPF covers retained 2026 tables, rounding, OW/AW ceilings and PR-year selection, with a separate typed payroll calculator. MOM covers annual/sick leave, holiday pay and final salary. MAS adds expressly future SFA 04-N24 knowledge from 01/01/2027; existing LFMC/VCFM manager rules are preserved.

Independent answer review used two cohorts of 20 and 10 questions with explicit semantic fixtures. Original code and original sources: **4 correct / 2 partial / 24 unsupported**. Same base code with expanded sources: **6 / 1 / 23**. Final implementation and sources: **17 / 2 / 11**. Thirteen cases newly answer correctly compared with the actual reviewed base; eleven improve in the same-source comparison and two further MOM cases improve through source enrichment. No historical abstention is counted as a knowledge gain. These are case-level adjudications, not a general accuracy estimate. Some substantively correct general answers retain whole-question completeness flags.

Practical gains include auditor/officer confirmations, solvent-EPC exemption, both XBRL size tests, chauffeured-car GST, connected-person car recovery, zero-treaty WHT filing, cross-border service apportionment, CPF age-band rates and rounding, four-month sick leave and inclusive hospitalisation limits, LFMC quarterly timing and the future misconduct trigger.

All confirmed independent source/numerical findings were fixed and rechecked. Four further preservation questions initially scored 1 correct / 1 partial / 2 unsupported; after restoring the official probation qualification they score 2 correct / 2 unsupported. The two CPF failures are unchanged mapping gaps, not missing case facts. These post-review results are separate from the primary 30 score. The fixed100 corpus byte hash is unchanged; verified evidence paths move from 54 to 69 with no loss of baseline paths in either source set, and every prior natural30 general explanation is preserved. These counts are not independent correctness scores. The existing natural30 benchmark is separate from the two new-question cohorts. See the validation summary for checks actually run; no independent final correctness regrade of all 100 is claimed.

Source limitations remain explicit. Seven native responses/documents are retained (four IRAS HTML pages and three CPF/MAS PDFs); eleven captures are labelled visible-text/layout-adapted excerpts. A hash establishes packet integrity, not legal correctness or legal applicability. Current capture dates do not establish historical or future law. CPF arithmetic is verified as a typed API and is not connected to natural-language payroll fact extraction. QDC, current misconduct rules, some date/fact interpretation and CPF/MOM wording remain unsupported or partial; see the gap report.

Files: [coverage inventory](coverage-inventory.json), [gap assessment](coverage-gaps.json), [independent review](independent-review-summary.json), [local validation](validation-summary.json), [additional preservation review](preservation-review-summary.json). Full rendered answers, raw logs, exact file hashes, reviewed-base archive and review-target archive are supplied in the local independent review package identified in the task handoff; they are not implied to be hosted by GitHub.
