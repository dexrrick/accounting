# Independent full V4 harness gap review — 06/10/2026

Reviewer `/root/checkpoint_review` read the V4 evaluator/contract/regression and prospective design without rerunning passing checks or accessing APIs. Verdict: **HOLD; harness completeness gaps, no newly established production defect.**

| Family at `3431a22` | Actual local-only runtime | Controlled governed positive |
| --- | --- | --- |
| Relief entitlement | Yes | Yes, discovery |
| Relief amount | Yes | Missing |
| Mixed relief/employer CPF | Yes | Missing |
| Private expense | Yes | Yes, mapped |
| Foreign dividends, residency, royalty WHT, GST | Yes | Yes, paired failures |
| Unsupported SFRS(I) 6 | Yes | No-route control |

Findings:

1. Governed scorer controls around regression line 520 use synthetic observations; actual results are not connected to full `evaluateV4Stages`. The routing mock around line 113 assigns corporate routing to individual income-tax issues and checks ownership rather than `routing.passed`.
2. Evaluator around lines 483–494 accepts mixed CPF INSUFFICIENT by label without proving intended NEEDS_REVIEW rejection or zero unsupported claims. CPF insufficiency cannot excuse an IRAS gate failure.
3. Section 15 truncated-quotation rejection is not a page missing qualifications. Separate foreign payer/other-income and GST unregistered/private/output controls remain absent. Verified-claim-but-uncovered stage scoring is still synthetic.
4. Preflight validates declared metadata, while executable capture/replay/live verification of actual corpus, committed checkout/ancestry, budgets and transport remains absent. No live approval follows.

Recommendation selected by supervisor: complete amount/mixed governed controls with runtime-derived stages, real routing, expected CPF rejection and unresolved applications; prove IRAS failure or false CPF verification cannot hide behind overall INSUFFICIENT. Other findings remain subsequent prerequisites before full harness approval or freeze.
