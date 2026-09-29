# Singapore multi-authority workstreams held-out oracle

Mode: ORACLE_ROUTING_WITH_LIVE_SOURCE_RETRIEVAL. Model understanding measured: no.
Cases: 1. Overall statuses: VERIFIED 0, CONDITIONAL 0, INSUFFICIENT 1.

## A-cpf-and-personal-income-tax-relief

Question: An employee earns [amount] per month. What CPF contributions must the employer and employee make, and how do the employee's compulsory CPF contributions affect
Status: INSUFFICIENT (INSUFFICIENT; application UNRESOLVED).
Planned: CPF/CPF_PAYROLL, IRAS/IRAS_INDIVIDUAL_TAX.
Retrieved: CPF/CPF_PAYROLL INSUFFICIENT, IRAS/IRAS_INDIVIDUAL_TAX VERIFIED.
Rendered sections: CPF Board — CPF contributions; IRAS — Individual income tax.
Raw query retained: true. Live evidence measured: true.

## Limits

- Oracle issue plans measure deterministic reconciliation and retrieval, not live-model understanding.
- Only IRAS live discovery is implemented; the other authority adapters use reviewed local evidence. No live model call was made.
- A topic intentionally left unmapped by the independent taxonomy remains uncovered even when its oracle meaning is clear.
