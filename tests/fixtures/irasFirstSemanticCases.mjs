export const irasFirstSemanticCases = [
  {
    id: 'personal-relief-application',
    question: 'Can I claim personal tax relief on my compulsory CPF contributions?',
    operation: 'CHECK_ELIGIBILITY', facts: true, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'generic-employee-class-eligibility',
    question: 'Can an employee claim CPF relief?',
    operation: 'CHECK_ELIGIBILITY', facts: false, domain: 'IRAS_INCOME_TAX', population: 'EMPLOYEE', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'general-relief-conditions',
    question: 'What are the conditions for CPF relief?',
    operation: 'CHECK_ELIGIBILITY', facts: false, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'company-specific-eligibility',
    question: 'Does my company qualify for this deduction?',
    operation: 'CHECK_ELIGIBILITY', facts: true, domain: 'IRAS_INCOME_TAX', population: 'COMPANY', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'general-who-qualifies',
    question: 'Who qualifies for this relief?',
    operation: 'CHECK_ELIGIBILITY', facts: false, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'specific-payment-treatment',
    question: 'Is this payment taxable?',
    operation: 'DETERMINE_TREATMENT', facts: true, domain: 'IRAS_INCOME_TAX', population: 'UNKNOWN', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'general-payment-tax-rules',
    question: 'How are such payments generally taxed?',
    operation: 'EXPLAIN_RULE', facts: false, domain: 'IRAS_INCOME_TAX', population: 'UNKNOWN', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'specific-company-deduction',
    question: 'Is this expense deductible for my company?',
    operation: 'DETERMINE_TREATMENT', facts: true, domain: 'IRAS_INCOME_TAX', population: 'COMPANY', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'general-deductibility-rules',
    question: 'What are the general rules for deductibility?',
    operation: 'EXPLAIN_RULE', facts: false, domain: 'IRAS_INCOME_TAX', population: 'COMPANY', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'explicit-calculation',
    question: 'How much tax must I pay on this income?',
    operation: 'CALCULATE', facts: true, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'general-rate-explanation',
    question: 'Explain the general CPF contribution rates.',
    operation: 'EXPLAIN_RULE', facts: false, domain: 'CPF_PAYROLL', population: 'EMPLOYER', authority: 'CPF',
    expected: 'ACCEPT'
  },
  {
    id: 'illustrative-amount-is-not-application',
    question: 'At a salary of SGD 6,000, explain generally how CPF contributions are calculated.',
    operation: 'EXPLAIN_RULE', facts: false, domain: 'CPF_PAYROLL', population: 'EMPLOYER', authority: 'CPF',
    expected: 'ACCEPT'
  },
  {
    id: 'case-specific-journal',
    question: 'Prepare a journal entry for this equipment purchase.',
    operation: 'PREPARE_JOURNAL', facts: true, domain: 'ACCOUNTING', population: 'COMPANY', authority: 'ACCOUNTING_STANDARDS',
    expected: 'ACCEPT'
  },
  {
    id: 'general-accounting-rule',
    question: 'Explain the general accounting rules for investment measurement.',
    operation: 'EXPLAIN_RULE', facts: false, domain: 'ACCOUNTING', population: 'COMPANY', authority: 'ACCOUNTING_STANDARDS',
    expected: 'ACCEPT'
  },
  {
    id: 'general-filing-rule',
    question: 'What are the general filing requirements for corporate income tax returns?',
    operation: 'FILING_REQUIREMENT', facts: false, domain: 'IRAS_INCOME_TAX', population: 'COMPANY', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'company-filing-application',
    question: 'Does my company need to file Form C-S?',
    operation: 'FILING_REQUIREMENT', facts: true, domain: 'IRAS_INCOME_TAX', population: 'COMPANY', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'general-comparison',
    question: 'Compare cost and fair value as general measurement bases under accounting standards.',
    operation: 'COMPARE', facts: false, domain: 'ACCOUNTING', population: 'COMPANY', authority: 'ACCOUNTING_STANDARDS',
    expected: 'ACCEPT'
  },
  {
    id: 'company-specific-comparison',
    question: 'Which tax treatment should my company apply to this expense?',
    operation: 'COMPARE', facts: true, domain: 'IRAS_INCOME_TAX', population: 'COMPANY', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'general-rule-interaction',
    question: 'How do the general personal tax relief caps interact?',
    operation: 'EXPLAIN_INTERACTION', facts: false, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'claim-interaction',
    question: 'How do the limits interact for my personal tax relief claim?',
    operation: 'EXPLAIN_INTERACTION', facts: true, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'general-other',
    question: 'Give a general overview of Singapore tax administration.',
    operation: 'OTHER', facts: false, domain: 'IRAS_OTHER', population: 'UNKNOWN', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'case-specific-other',
    question: 'Could this payment be subject to tax?',
    operation: 'OTHER', facts: true, domain: 'IRAS_INCOME_TAX', population: 'UNKNOWN', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'named-entity-eligibility',
    question: 'Does Northstar Pte Ltd qualify for the deduction under this scheme?',
    operation: 'CHECK_ELIGIBILITY', facts: true, domain: 'IRAS_INCOME_TAX', population: 'COMPANY', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'unrecognized-eligibility-wording',
    question: 'Could the resulting position make relief available under this provision?',
    operation: 'CHECK_ELIGIBILITY', facts: true, domain: 'IRAS_INCOME_TAX', population: 'UNKNOWN', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'ambiguous-compound-eligibility',
    question: 'Can I claim personal relief? Can an employee claim CPF relief under the same rule?',
    operation: 'CHECK_ELIGIBILITY', facts: true, domain: 'IRAS_INCOME_TAX', population: 'UNKNOWN', authority: 'IRAS',
    subject: 'CPF relief eligibility', expected: 'ACCEPT'
  },
  {
    id: 'interaction-audience-is-not-claimant',
    question: 'Can you explain to me how CPF and SRS relief caps generally interact?',
    operation: 'EXPLAIN_INTERACTION', facts: false, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'comparison-audience-is-not-claimant',
    question: 'Could you compare the general eligibility conditions for CPF relief, for me?',
    operation: 'COMPARE', facts: false, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'eligibility-audience-is-not-claimant',
    question: 'Can you explain to me who qualifies for CPF relief?',
    operation: 'CHECK_ELIGIBILITY', facts: false, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'personal-claim-with-qualification-comma',
    question: 'Can you tell me if I can claim CPF relief, if I am a Singapore permanent resident?',
    operation: 'CHECK_ELIGIBILITY', facts: true, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'specific-contributions-interaction',
    question: 'How do CPF and SRS relief caps interact for my contributions?',
    operation: 'EXPLAIN_INTERACTION', facts: true, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'specific-compulsory-contributions-interaction',
    question: 'How do CPF and SRS relief caps interact for my compulsory CPF contributions?',
    operation: 'EXPLAIN_INTERACTION', facts: true, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'specific-voluntary-contributions-interaction',
    question: 'How do CPF and SRS relief caps interact for my voluntary CPF contributions?',
    operation: 'EXPLAIN_INTERACTION', facts: true, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'specific-annual-contributions-interaction',
    question: 'How do CPF and SRS relief caps interact for my annual CPF contributions?',
    operation: 'EXPLAIN_INTERACTION', facts: true, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'specific-ordinary-contributions-interaction',
    question: 'How do CPF and SRS relief caps interact for my ordinary CPF contributions?',
    operation: 'EXPLAIN_INTERACTION', facts: true, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  },
  {
    id: 'ambiguous-owned-reference-interaction',
    question: 'How do CPF and SRS relief caps generally interact for my situation?',
    operation: 'EXPLAIN_INTERACTION', facts: true, domain: 'IRAS_INCOME_TAX', population: 'INDIVIDUAL', authority: 'IRAS',
    expected: 'ACCEPT'
  }
];
