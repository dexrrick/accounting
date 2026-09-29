# Singapore multi-authority workstreams held-out oracle

Mode: ORACLE_ROUTING_WITH_LOCAL_REVIEWED_SOURCES. Model understanding measured: no.
Cases: 4. Overall statuses: VERIFIED 0, CONDITIONAL 0, INSUFFICIENT 4.

## A-cpf-and-personal-income-tax-relief

Question: An employee earns [amount] per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect
Status: INSUFFICIENT (INSUFFICIENT; application UNRESOLVED).
Planned: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Retrieved: CPF/CPF_PAYROLL INSUFFICIENT, IRAS/IRAS_INDIVIDUAL_TAX INSUFFICIENT.
Rendered sections: CPF Board — CPF contributions; IRAS — Individual income tax.
Raw query retained: true. Live evidence measured: false.

## B-mom-cpf-and-iras-employer-reporting

Question: We hired a foreign employee in Singapore. What employment/work-pass requirements apply, whether CPF contributions are required, and what employer tax reporting
Status: INSUFFICIENT (INSUFFICIENT; application UNRESOLVED).
Planned: MOM/MOM_EMPLOYMENT, CPF/CPF_PAYROLL, IRAS/IRAS_EMPLOYER_REPORTING.
Retrieved: MOM/MOM_EMPLOYMENT INSUFFICIENT, CPF/CPF_PAYROLL INSUFFICIENT, IRAS/IRAS_EMPLOYER_REPORTING INSUFFICIENT.
Rendered sections: Ministry of Manpower — Employment requirements; CPF Board — CPF contributions; IRAS — Employer reporting.
Raw query retained: true. Live evidence measured: false.

## C-iras-corporate-and-employee-tax-domains

Question: Our company pays an employee's housing allowance. Is it deductible to the company and is it taxable to the employee?
Status: INSUFFICIENT (INSUFFICIENT; application UNRESOLVED).
Planned: IRAS/IRAS_CORPORATE_TAX, IRAS/IRAS_EMPLOYMENT_BENEFITS.
Retrieved: IRAS/IRAS_CORPORATE_TAX INSUFFICIENT, IRAS/IRAS_EMPLOYMENT_BENEFITS INSUFFICIENT.
Rendered sections: IRAS — Corporate income tax; IRAS — Employment income and benefits.
Raw query retained: true. Live evidence measured: false.

## D-accounting-standards-and-iras-corporate-tax

Question: How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?
Status: INSUFFICIENT (INSUFFICIENT; application UNRESOLVED).
Planned: ACCOUNTING_STANDARDS/ACCOUNTING, IRAS/IRAS_CORPORATE_TAX.
Retrieved: ACCOUNTING_STANDARDS/ACCOUNTING INSUFFICIENT, IRAS/IRAS_CORPORATE_TAX INSUFFICIENT.
Rendered sections: Singapore accounting standards — Accounting treatment; IRAS — Corporate income tax.
Raw query retained: true. Live evidence measured: false.

## Limits

- Oracle issue plans measure deterministic reconciliation and retrieval, not live-model understanding.
- The local run uses reviewed local records and disables source discovery; it does not measure live-source availability.
- A topic intentionally left unmapped by the independent taxonomy remains uncovered even when its oracle meaning is clear.
