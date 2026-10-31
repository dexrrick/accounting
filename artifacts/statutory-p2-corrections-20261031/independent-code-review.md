# Independent P2 correction review

Reviewer: `/root/p2_review`, read-only reviewer agent. Supervisor saved this record from the reviewer's final messages; the reviewer did not modify files.

Target: final working implementation against starting head `2184ee0592076dd1891113a3ad74cb014eb439eb` on `codex/statutory-knowledge-expansion-20261030`.

Final result: **No remaining material findings in the requested scope.**

The review first found a duplicate import, missed non-timing payslip issuance/delivery requests, inconsistent calculation-verb recognition and inappropriate routing based solely on an absent salary rate. The builder corrected them. Supervisor application testing then found inferred IRAS routing suppressing the three-issue numeric deduction example; the builder corrected that bounded route and the reviewer inspected its final delta.

Independent deterministic probes passed for delivery, issuance, `calculate` wording, a stated salary rate with unresolved calculation facts, and the S$400 deduction scenario. These produce distinct salary `CALCULATE` and payslip `EXPLAIN_RULE` issues; the strict mixed-MOM route remains eligible despite inferred IRAS policy metadata. Tax analysis and images remain excluded. The final code also retains accounting/journal exclusions and limits the special route to the two or three specified MOM obligations.

ACRA ISO, `was`, colon and `year ended` workflow probes and invalid-date controls passed. Review identified no remaining material issue with the changed strict FYE parser or its ACRA call sites. Calendar validation, ambiguity and ownership checks, historical/date-window safeguards and branch-register rules remain in place.

Independent complete-answer review of the sole changed corpus answer, Frozen75 `acra-15`: **UNSUPPORTED before and after**. Generic unsupported excerpts were replaced with explicit evidence gaps; no listed-company deadline or date is established. This is no answer-quality gain and no loss of a previously correct answer.

Limitations: reviewer did not run broad validation, CI, live-model/browser or production checks. Final corpus capture, complete validation, integration and publication are supervisor responsibilities.
