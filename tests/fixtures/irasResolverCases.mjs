const irasIssue = ({ subject, population = 'COMPANY', operation = 'DETERMINE_TREATMENT', facts = true }) => ({
  subject,
  population,
  domain: 'IRAS_INCOME_TAX',
  authority: 'IRAS',
  operation,
  facts
});

const accountingIssue = ({ subject, operation = 'EXPLAIN_RULE', facts = false }) => ({
  subject,
  population: 'COMPANY',
  domain: 'ACCOUNTING',
  authority: 'ACCOUNTING_STANDARDS',
  operation,
  facts
});

const oneIssue = ({ id, family, query, issue, requiredTopicIds = [], forbiddenTopicIds = [], forbiddenCandidateTopicIds = [], noIrasRoute = false }) => ({
  id, family, query,
  issues: [issue],
  requiredTopicIds,
  forbiddenTopicIds,
  forbiddenCandidateTopicIds,
  noIrasRoute
});

export const irasResolverCases = [
  oneIssue({
    id: 'private-holiday-expense', family: 'corporate-expense',
    query: "Our Singapore company paid SGD 900 for the director's private holiday and recorded it as travel expense. What is its corporate income-tax treatment?",
    issue: irasIssue({ subject: "corporate income-tax treatment of director's private holiday travel expense" }),
    requiredTopicIds: ['iras-cit-deductibility'],
    forbiddenTopicIds: ['iras-foreign-sourced-income', 'iras-corporate-tax-residency']
  }),
  oneIssue({
    id: 'entertainment-expense-tax', family: 'corporate-expense',
    query: 'How is client entertainment expense treated for Singapore corporate income tax?',
    issue: irasIssue({ subject: 'corporate income-tax deductibility of client entertainment expense' }),
    requiredTopicIds: ['iras-cit-deductibility'],
    forbiddenTopicIds: ['iras-foreign-sourced-income']
  }),
  oneIssue({
    id: 'ordinary-business-expense-tax', family: 'corporate-expense',
    query: 'Can an ordinary business expense be deducted in computing Singapore corporate income tax?',
    issue: irasIssue({ subject: 'deductibility of an ordinary business expense for company income tax' }),
    requiredTopicIds: ['iras-cit-deductibility'],
    forbiddenTopicIds: ['iras-foreign-sourced-income']
  }),
  {
    id: 'accounting-expense-with-anaphoric-tax-question',
    family: 'linked-expense-tax-outcome',
    query: 'How should an expense be recorded under SFRS(I), and is it deductible for Singapore corporate income tax?',
    issues: [
      accountingIssue({ subject: 'accounting recognition of an expense under SFRS(I)', operation: 'EXPLAIN_RULE', facts: false }),
      irasIssue({ subject: 'deductibility of that expense for Singapore corporate income tax', operation: 'CHECK_ELIGIBILITY', facts: false })
    ],
    requiredTopicIds: ['iras-cit-deductibility'],
    forbiddenTopicIds: ['iras-foreign-sourced-income'],
    assertIssueIntersection: true
  },
  oneIssue({
    id: 'private-expense-accounting-context', family: 'negative-accounting-context',
    query: "How should our Singapore company record a director's private holiday expense in its financial statements?",
    issue: accountingIssue({ subject: "accounting recognition of director's private holiday expense", operation: 'PREPARE_JOURNAL', facts: true }),
    noIrasRoute: true
  }),
  oneIssue({
    id: 'private-holiday-gst-no-corporate-income-tax', family: 'negative-expense-tax-boundary',
    query: "Can our company recover GST input tax on a director's private holiday expense?",
    issue: { subject: "GST input-tax recovery by a company on a director's private holiday expense", population: 'COMPANY', domain: 'IRAS_GST', authority: 'IRAS', operation: 'CHECK_ELIGIBILITY', facts: true },
    requiredTopicIds: ['iras-gst-input-tax'],
    forbiddenTopicIds: ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'],
    forbiddenCandidateTopicIds: ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'],
    forbidCorporateTaxResidual: true
  }),
  {
    id: 'private-travel-entry-and-company-residency',
    family: 'negative-expense-tax-boundary',
    query: 'Prepare an accounting entry for the private travel expense and explain company tax residency.',
    issues: [
      accountingIssue({ subject: 'accounting entry for a private travel expense', operation: 'PREPARE_JOURNAL', facts: true }),
      irasIssue({ subject: 'company tax residency', operation: 'EXPLAIN_RULE', facts: false })
    ],
    requiredTopicIds: ['iras-corporate-tax-residency'],
    forbiddenTopicIds: ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'],
    forbiddenCandidateTopicIds: ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'],
    assertIssueIntersection: true
  },
  {
    id: 'private-expense-tax-treatment-of-separate-foreign-dividend',
    family: 'negative-expense-tax-boundary',
    query: 'Prepare an accounting entry for the private travel expense and explain the corporate tax treatment of a separate foreign dividend receipt.',
    issues: [
      accountingIssue({ subject: 'accounting entry for a private travel expense', operation: 'PREPARE_JOURNAL', facts: true }),
      irasIssue({ subject: 'corporate tax treatment of a separate foreign dividend receipt', operation: 'EXPLAIN_RULE', facts: false })
    ],
    requiredTopicIds: ['iras-foreign-sourced-income'],
    forbiddenTopicIds: ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'],
    forbiddenCandidateTopicIds: ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'],
    assertIssueIntersection: true
  },
  oneIssue({
    id: 'foreign-dividend-accounting-context', family: 'negative-accounting-context',
    query: 'How should a Singapore company account for dividends received from a Thai subsidiary under SFRS(I)?',
    issue: accountingIssue({ subject: 'accounting for foreign dividend income from a subsidiary', operation: 'EXPLAIN_RULE', facts: false }),
    noIrasRoute: true
  }),
  oneIssue({
    id: 'foreign-dividend-treatment', family: 'foreign-income',
    query: "Our Singapore company received a dividend from its Thai subsidiary in the current year. Explain the company's Singapore corporate income-tax treatment for this receipt.",
    issue: irasIssue({ subject: 'Singapore corporate tax treatment of dividend from overseas subsidiary' }),
    requiredTopicIds: ['iras-foreign-sourced-income'],
    forbiddenTopicIds: ['iras-foreign-tax-credit', 'iras-corporate-tax-residency', 'iras-section-13-exemptions']
  }),
  oneIssue({
    id: 'local-subsidiary-dividend-tax', family: 'foreign-income-boundary',
    query: 'What is the Singapore corporate income-tax treatment of a dividend received from our local subsidiary?',
    issue: irasIssue({ subject: 'Singapore corporate tax treatment of dividend received from a local subsidiary' }),
    forbiddenTopicIds: ['iras-foreign-sourced-income', 'iras-section-13-exemptions'],
    forbiddenCandidateTopicIds: ['iras-foreign-sourced-income', 'iras-section-13-exemptions']
  }),
  oneIssue({
    id: 'local-subsidiary-dividend-thai-shareholder', family: 'foreign-income-boundary',
    query: 'Our Singapore company received a dividend from its Singapore subsidiary. Its Thai shareholder asks about Singapore corporate income tax treatment of the receipt.',
    issue: irasIssue({ subject: 'Singapore corporate income-tax treatment of dividend received from Singapore subsidiary' }),
    forbiddenTopicIds: ['iras-foreign-sourced-income', 'iras-section-13-exemptions'],
    forbiddenCandidateTopicIds: ['iras-foreign-sourced-income', 'iras-section-13-exemptions']
  }),
  oneIssue({
    id: 'local-subsidiary-dividend-thai-shareholder-relative-clause', family: 'foreign-income-boundary',
    query: 'Our Singapore company received a dividend from its Singapore subsidiary, whose Thai shareholder asks about Singapore corporate income tax treatment of the receipt.',
    issue: irasIssue({ subject: 'Singapore corporate income-tax treatment of dividend received from Singapore subsidiary' }),
    forbiddenTopicIds: ['iras-foreign-sourced-income', 'iras-section-13-exemptions'],
    forbiddenCandidateTopicIds: ['iras-foreign-sourced-income', 'iras-section-13-exemptions']
  }),
  oneIssue({
    id: 'overseas-branch-rent-is-not-foreign-income', family: 'foreign-income-boundary',
    query: 'What is the corporate tax treatment of rent paid for an overseas branch?',
    issue: irasIssue({ subject: 'corporate tax treatment of rent paid for an overseas branch', operation: 'EXPLAIN_RULE', facts: false }),
    forbiddenTopicIds: ['iras-foreign-sourced-income', 'iras-section-13-exemptions'],
    forbiddenCandidateTopicIds: ['iras-foreign-sourced-income', 'iras-section-13-exemptions']
  }),
  oneIssue({
    id: 'foreign-branch-income', family: 'foreign-income',
    query: 'How is income earned by our Singapore company through a branch in Malaysia treated for Singapore corporate income tax?',
    issue: irasIssue({ subject: 'Singapore corporate tax treatment of foreign branch income' }),
    requiredTopicIds: ['iras-foreign-sourced-income'],
    forbiddenTopicIds: ['iras-foreign-tax-credit']
  }),
  oneIssue({
    id: 'foreign-service-income', family: 'foreign-income',
    query: 'What is the Singapore corporate tax treatment of service income earned overseas by our company?',
    issue: irasIssue({ subject: 'company tax treatment of overseas service income' }),
    requiredTopicIds: ['iras-foreign-sourced-income'],
    forbiddenTopicIds: ['iras-foreign-tax-credit']
  }),
  oneIssue({
    id: 'explicit-section-13-exemption-question', family: 'foreign-income',
    query: 'Can a Singapore company claim a Section 13 exemption for qualifying foreign-sourced dividend income?',
    issue: irasIssue({ subject: 'company eligibility for a Section 13 exemption on foreign-sourced dividend income', operation: 'CHECK_ELIGIBILITY', facts: false }),
    requiredTopicIds: ['iras-section-13-exemptions'],
    forbiddenTopicIds: ['iras-foreign-tax-credit']
  }),
  oneIssue({
    id: 'foreign-tax-credit-only', family: 'foreign-tax-credit',
    query: 'Can our Singapore company claim foreign tax credit for tax paid to another country?',
    issue: irasIssue({ subject: 'company claim for foreign tax credit' }),
    requiredTopicIds: ['iras-foreign-tax-credit'],
    forbiddenTopicIds: ['iras-foreign-sourced-income']
  }),
  oneIssue({
    id: 'overseas-receipt-accounting-only', family: 'negative-accounting-context',
    query: 'Our company received an overseas payment. How should we record the receipt in the accounts?',
    issue: accountingIssue({ subject: 'accounting for an overseas receipt', operation: 'PREPARE_JOURNAL', facts: true }),
    noIrasRoute: true
  }),
  oneIssue({
    id: 'company-residency-general', family: 'corporate-residency',
    query: 'How do Singapore tax rules determine whether a company is tax resident here?',
    issue: irasIssue({ subject: 'how Singapore determines company tax residence', operation: 'EXPLAIN_RULE', facts: false }),
    requiredTopicIds: ['iras-corporate-tax-residency'],
    forbiddenTopicIds: ['iras-individual-tax-residency']
  }),
  oneIssue({
    id: 'company-residency-applied', family: 'corporate-residency',
    query: 'Is our Singapore company tax resident for Singapore income-tax purposes?',
    issue: irasIssue({ subject: 'tax residency of our Singapore company', operation: 'CHECK_ELIGIBILITY', facts: true }),
    requiredTopicIds: ['iras-corporate-tax-residency'],
    forbiddenTopicIds: ['iras-individual-tax-residency']
  }),
  oneIssue({
    id: 'company-certificate-of-residence', family: 'corporate-residency',
    query: 'How can a Singapore company obtain a Certificate of Residence for tax purposes?',
    issue: irasIssue({ subject: 'company Certificate of Residence for tax purposes', operation: 'FILING_REQUIREMENT', facts: false }),
    requiredTopicIds: ['iras-corporate-tax-residency'],
    forbiddenTopicIds: ['iras-individual-certificate-of-residence']
  }),
  oneIssue({
    id: 'acra-resident-director', family: 'negative-authority-context',
    query: 'Under ACRA requirements, must a Singapore company have a resident director?',
    issue: { subject: 'ACRA local resident director requirement', population: 'COMPANY', domain: 'ACRA_CORPORATE', authority: 'ACRA', operation: 'CHECK_ELIGIBILITY', facts: true },
    requiredTopicIds: ['acra_directors'],
    forbiddenTopicIds: ['iras-corporate-tax-residency']
  }),
  oneIssue({
    id: 'target-relief-entitlement', family: 'personal-relief',
    query: 'Can I claim personal tax relief on my compulsory CPF contributions?',
    issue: irasIssue({ subject: 'individual personal tax relief for compulsory CPF contributions', population: 'INDIVIDUAL', operation: 'CHECK_ELIGIBILITY', facts: true }),
    requiredTopicIds: ['iras-individual-cpf-relief']
  }),
  oneIssue({
    id: 'target-relief-amount', family: 'personal-relief',
    query: 'How much personal tax relief can I claim for compulsory CPF contributions?',
    issue: irasIssue({ subject: 'numeric amount of individual tax relief for compulsory CPF contributions', population: 'INDIVIDUAL', operation: 'CALCULATE', facts: true }),
    requiredTopicIds: ['iras-individual-cpf-relief']
  }),
  {
    id: 'A-paraphrase-2',
    family: 'personal-relief',
    query: 'For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?',
    issues: [
      { subject: 'employer CPF contribution amount', population: 'EMPLOYER', domain: 'CPF_PAYROLL', authority: 'CPF', operation: 'CALCULATE', facts: true },
      irasIssue({ subject: 'individual personal tax relief claim for compulsory CPF contributions', population: 'INDIVIDUAL', operation: 'CHECK_ELIGIBILITY', facts: true })
    ],
    requiredTopicIds: ['iras-individual-cpf-relief'],
    forbiddenTopicIds: [],
    assertIssueIntersection: true
  },
  oneIssue({
    id: 'srs-contribution-relief', family: 'personal-relief',
    query: 'Can I claim Singapore personal income-tax relief for my SRS contributions?',
    issue: irasIssue({ subject: 'individual income-tax relief for SRS contributions', population: 'INDIVIDUAL', operation: 'CHECK_ELIGIBILITY', facts: true }),
    requiredTopicIds: ['iras-individual-srs-relief']
  }),
  oneIssue({
    id: 'parent-relief', family: 'personal-relief',
    query: 'What are the conditions for claiming parent relief in Singapore?',
    issue: irasIssue({ subject: 'eligibility conditions for Singapore parent tax relief', population: 'INDIVIDUAL', operation: 'EXPLAIN_RULE', facts: false }),
    requiredTopicIds: ['iras-individual-parent-relief']
  }),
  oneIssue({
    id: 'relief-cap-interaction', family: 'personal-relief',
    query: 'How does the overall personal income-tax relief cap interact with CPF and SRS relief?',
    issue: irasIssue({ subject: 'interaction of CPF and SRS personal relief with the overall relief cap', population: 'INDIVIDUAL', operation: 'EXPLAIN_INTERACTION', facts: false }),
    requiredTopicIds: ['iras-individual-relief-cap', 'iras-individual-cpf-relief', 'iras-individual-srs-relief']
  }),
  oneIssue({
    id: 'wht-royalty-general-rule', family: 'withholding-tax',
    query: 'What are the general Singapore withholding-tax rules when a company pays royalties to a non-resident company?',
    issue: irasIssue({ subject: 'general Singapore withholding-tax rules for company royalty payments to a non-resident company', operation: 'EXPLAIN_RULE', facts: false }),
    requiredTopicIds: ['iras-withholding-tax-interest-royalties'],
    forbiddenTopicIds: ['iras-foreign-sourced-income']
  }),
  oneIssue({
    id: 'gst-input-tax-general-rule', family: 'gst-input-tax',
    query: 'What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company?',
    issue: { subject: 'general GST input-tax recovery rules for business purchases by a GST-registered company', population: 'COMPANY', domain: 'IRAS_GST', authority: 'IRAS', operation: 'EXPLAIN_RULE', facts: false },
    requiredTopicIds: ['iras-gst-input-tax'],
    forbiddenTopicIds: ['iras-gst-blocked-input-tax']
  }),
  oneIssue({
    id: 'unsupported-sfrsi-6-exploration-evaluation', family: 'unsupported-accounting-control',
    query: 'Explain the general accounting rules for exploration and evaluation of mineral resources under SFRS(I) 6.',
    issue: accountingIssue({ subject: 'general SFRS(I) 6 accounting rules for exploration and evaluation expenditure', operation: 'EXPLAIN_RULE', facts: false }),
    noIrasRoute: true
  }),
  {
    id: 'mixed-accounting-and-foreign-dividend-tax',
    family: 'issue-intersection',
    query: 'How should we account for the foreign dividend, and is it subject to Singapore corporate income tax?',
    issues: [
      accountingIssue({ subject: 'accounting recognition of foreign dividend income', operation: 'EXPLAIN_RULE', facts: false }),
      irasIssue({ subject: 'Singapore corporate income-tax treatment of foreign dividend receipt' })
    ],
    requiredTopicIds: ['iras-foreign-sourced-income'],
    forbiddenTopicIds: [],
    assertIssueIntersection: true
  }
];
