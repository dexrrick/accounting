/* Hand-labelled test oracle from the prospective contract; never imported by prototype.mjs. */
export const cases = [
  {
    id: '01', raw: 'Can I claim personal tax relief on my compulsory CPF contributions?',
    outcomes: [{ spanText: 'Can I claim personal tax relief on my compulsory CPF contributions', operation: 'ELIGIBLE', identity: 'cpf_relief', population: 'INDIVIDUAL', scope: 'SPECIFIC', facets: ['COMPULSORY'] }],
  },
  {
    id: '02', raw: 'How much personal tax relief can I claim for compulsory CPF contributions?',
    outcomes: [{ spanText: 'How much personal tax relief can I claim for compulsory CPF contributions', operation: 'CALCULATE', identity: 'cpf_relief', population: 'INDIVIDUAL', scope: 'SPECIFIC', facets: ['COMPULSORY'] }],
  },
  {
    id: '03', raw: 'For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?',
    facts: [{ kind: 'salary', spanText: 'For someone earning SGD 6,000 a month,' }],
    outcomes: [
      { spanText: 'what can they claim for personal tax relief on compulsory CPF', operation: 'ELIGIBLE', identity: 'cpf_relief', population: 'INDIVIDUAL', scope: 'SPECIFIC', facets: ['COMPULSORY'] },
      { spanText: 'what does the employer have to pay into CPF', operation: 'CALCULATE', identity: 'cpf_contributions', population: 'EMPLOYER', scope: 'SPECIFIC', facets: [] },
    ],
  },
  {
    id: '04', raw: 'What individual tax relief categories are available, plus explain CPF relief for employees?',
    outcomes: [
      { spanText: 'What individual tax relief categories are available', operation: 'EXPLAIN', identity: 'individual_tax_relief_overview', population: 'INDIVIDUAL', scope: 'OVERVIEW', facets: ['OVERVIEW'] },
      { spanText: 'explain CPF relief for employees', operation: 'EXPLAIN', identity: 'cpf_relief', population: 'EMPLOYEE', scope: 'SPECIFIC', facets: [] },
    ],
  },
  {
    id: '05', raw: 'I need an overview of individual tax relief categories. Can I claim CPF relief for employees?',
    outcomes: [
      { spanText: 'I need an overview of individual tax relief categories', operation: 'EXPLAIN', identity: 'individual_tax_relief_overview', population: 'INDIVIDUAL', scope: 'OVERVIEW', facets: ['OVERVIEW'] },
      { spanText: 'Can I claim CPF relief for employees', operation: 'ELIGIBLE', identity: 'cpf_relief', population: 'INDIVIDUAL', scope: 'SPECIFIC', facets: [] },
    ],
  },
  {
    id: '06', raw: 'Explain individual tax relief categories, including CPF relief for employees.',
    outcomes: [{ spanText: 'Explain individual tax relief categories, including CPF relief for employees', operation: 'EXPLAIN', identity: 'individual_tax_relief_overview', population: 'INDIVIDUAL', scope: 'OVERVIEW', facets: ['OVERVIEW', 'CPF_EXAMPLE'] }],
  },
  {
    id: '07', raw: 'Can I claim CPF relief for employees? I need an overview of individual tax relief categories.',
    outcomes: [
      { spanText: 'Can I claim CPF relief for employees', operation: 'ELIGIBLE', identity: 'cpf_relief', population: 'INDIVIDUAL', scope: 'SPECIFIC', facets: [] },
      { spanText: 'I need an overview of individual tax relief categories', operation: 'EXPLAIN', identity: 'individual_tax_relief_overview', population: 'INDIVIDUAL', scope: 'OVERVIEW', facets: ['OVERVIEW'] },
    ],
  },
  {
    id: '08', raw: 'Explain CPF relief for employees.',
    outcomes: [{ spanText: 'Explain CPF relief for employees', operation: 'EXPLAIN', identity: 'cpf_relief', population: 'EMPLOYEE', scope: 'SPECIFIC', facets: [] }],
  },
  {
    id: '09', raw: 'How much CPF must the employer contribute?',
    outcomes: [{ spanText: 'How much CPF must the employer contribute', operation: 'CALCULATE', identity: 'cpf_contributions', population: 'EMPLOYER', scope: 'SPECIFIC', facets: [] }],
  },
  {
    id: '10', raw: 'How much CPF do the employee and employer contribute?',
    outcomes: [
      { spanText: 'How much CPF do the employee and employer contribute', operation: 'CALCULATE', identity: 'cpf_contributions', population: 'EMPLOYEE', scope: 'SPECIFIC', facets: [] },
      { spanText: 'How much CPF do the employee and employer contribute', operation: 'CALCULATE', identity: 'cpf_contributions', population: 'EMPLOYER', scope: 'SPECIFIC', facets: [] },
    ],
  },
  {
    id: '11', raw: "Our Singapore company paid SGD 900 for the director's private holiday and recorded it as travel expense. What is its corporate income-tax treatment?",
    facts: [{ kind: 'private_expense', spanText: "Our Singapore company paid SGD 900 for the director's private holiday and recorded it as travel expense." }],
    outcomes: [{ spanText: 'What is its corporate income-tax treatment', operation: 'TREATMENT', identity: 'private_director_expense_tax_treatment', population: 'COMPANY', scope: 'SPECIFIC', facets: ['PRIVATE'] }],
  },
  {
    id: '12', raw: "Our Singapore company received a dividend from its Thai subsidiary in the current year. Explain the company's Singapore corporate income-tax treatment for this receipt.",
    facts: [{ kind: 'foreign_dividend', spanText: 'Our Singapore company received a dividend from its Thai subsidiary in the current year.' }],
    outcomes: [{ spanText: "Explain the company's Singapore corporate income-tax treatment for this receipt", operation: 'TREATMENT', identity: 'foreign_dividend_tax_treatment', population: 'COMPANY', scope: 'SPECIFIC', facets: ['FOREIGN', 'SINGAPORE'] }],
  },
  {
    id: '13', raw: 'How do Singapore tax rules determine whether a company is tax resident here?',
    outcomes: [{ spanText: 'How do Singapore tax rules determine whether a company is tax resident here', operation: 'EXPLAIN', identity: 'company_tax_residency', population: 'COMPANY', scope: 'SPECIFIC', facets: ['GENERAL', 'SINGAPORE'] }],
  },
  {
    id: '14', raw: 'What are the general Singapore withholding-tax rules when a company pays royalties to a non-resident company?',
    outcomes: [{ spanText: 'What are the general Singapore withholding-tax rules when a company pays royalties to a non-resident company', operation: 'EXPLAIN', identity: 'royalty_withholding_tax', population: 'COMPANY', scope: 'SPECIFIC', facets: ['GENERAL', 'ROYALTY', 'NONRESIDENT', 'SINGAPORE'] }],
  },
  {
    id: '15', raw: 'What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company?',
    outcomes: [{ spanText: 'What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company', operation: 'EXPLAIN', identity: 'gst_input_recovery', population: 'COMPANY', scope: 'SPECIFIC', facets: ['GENERAL', 'INPUT_RECOVERY', 'SINGAPORE'] }],
  },
  {
    id: '16', raw: 'Explain the accounting treatment of exploration and evaluation under SFRS(I) 6.',
    outcomes: [{ spanText: 'Explain the accounting treatment of exploration and evaluation under SFRS(I) 6', operation: 'EXPLAIN', identity: 'sfrsi6_exploration_evaluation', population: 'UNKNOWN', scope: 'SPECIFIC', facets: ['EXPLORATION', 'EVALUATION'] }],
  },
  {
    id: '17', raw: 'Can this person obtain an Employment Pass and is the company subject to an employment quota?',
    outcomes: [
      { spanText: 'Can this person obtain an Employment Pass', operation: 'ELIGIBLE', identity: 'employment_pass', population: 'INDIVIDUAL', scope: 'SPECIFIC', facets: ['ELIGIBILITY'] },
      { spanText: 'is the company subject to an employment quota', operation: 'ELIGIBLE', identity: 'employment_quota', population: 'COMPANY', scope: 'SPECIFIC', facets: ['QUOTA'] },
    ],
  },
  {
    id: '18', raw: 'When is the annual return due and must financial statements be filed?',
    outcomes: [
      { spanText: 'When is the annual return due', operation: 'FILING', identity: 'annual_return', population: 'COMPANY', scope: 'SPECIFIC', facets: ['DEADLINE'] },
      { spanText: 'must financial statements be filed', operation: 'FILING', identity: 'financial_statements', population: 'COMPANY', scope: 'SPECIFIC', facets: ['OBLIGATION'] },
    ],
  },
  {
    id: '19', raw: 'Does this fund manager need a CMS licence or qualify for an exemption?',
    outcomes: [{ spanText: 'Does this fund manager need a CMS licence or qualify for an exemption', operation: 'APPLICABILITY', identity: 'cms_licence_or_exemption', population: 'UNKNOWN', scope: 'ALTERNATIVE_DECISION', facets: ['CMS_LICENCE', 'EXEMPTION', 'DECISION_RELATION'] }],
  },
  {
    id: '20', raw: 'Should this investment be FVPL or FVOCI and how should subsequent changes be measured?',
    outcomes: [
      { spanText: 'Should this investment be FVPL or FVOCI', operation: 'CLASSIFY', identity: 'investment_fvpl_fvoci', population: 'UNKNOWN', scope: 'ALTERNATIVE_DECISION', facets: ['FVPL', 'FVOCI', 'DECISION_RELATION'] },
      { spanText: 'how should subsequent changes be measured', operation: 'MEASURE', identity: 'investment_subsequent_changes', population: 'UNKNOWN', scope: 'SPECIFIC', facets: ['SUBSEQUENT_MEASUREMENT'] },
    ],
  },
  {
    id: '21', raw: 'How should this expense be accounted for and is it tax deductible?',
    outcomes: [
      { spanText: 'How should this expense be accounted for', operation: 'TREATMENT', identity: 'expense_accounting', population: 'UNKNOWN', scope: 'SPECIFIC', facets: ['ACCOUNTING'] },
      { spanText: 'is it tax deductible', operation: 'ELIGIBLE', identity: 'expense_tax_deductibility', population: 'UNKNOWN', scope: 'SPECIFIC', facets: ['TAX_DEDUCTIBILITY'] },
    ],
  },
  {
    id: '22', raw: 'Explain how CPF employer contributions affect personal CPF tax relief.',
    outcomes: [{ spanText: 'Explain how CPF employer contributions affect personal CPF tax relief', operation: 'EXPLAIN', identity: 'employer_contributions_affect_personal_relief', population: 'INDIVIDUAL', scope: 'INTERACTION', facets: ['EMPLOYER_CONTRIBUTIONS_AFFECT_PERSONAL_RELIEF'], participants: ['EMPLOYER', 'INDIVIDUAL'] }],
  },
  {
    id: '23', raw: 'Explain the general GST input tax rule and explain the general royalty withholding tax rule.',
    outcomes: [
      { spanText: 'Explain the general GST input tax rule', operation: 'EXPLAIN', identity: 'gst_input_recovery', population: 'UNKNOWN', scope: 'SPECIFIC', facets: ['GENERAL', 'INPUT_RECOVERY'] },
      { spanText: 'explain the general royalty withholding tax rule', operation: 'EXPLAIN', identity: 'royalty_withholding_tax', population: 'UNKNOWN', scope: 'SPECIFIC', facets: ['GENERAL', 'ROYALTY'] },
    ],
  },
  {
    id: '24', raw: 'Explain the general royalty withholding tax rule plus explain the general GST input tax rule.',
    outcomes: [
      { spanText: 'Explain the general royalty withholding tax rule', operation: 'EXPLAIN', identity: 'royalty_withholding_tax', population: 'UNKNOWN', scope: 'SPECIFIC', facets: ['GENERAL', 'ROYALTY'] },
      { spanText: 'explain the general GST input tax rule', operation: 'EXPLAIN', identity: 'gst_input_recovery', population: 'UNKNOWN', scope: 'SPECIFIC', facets: ['GENERAL', 'INPUT_RECOVERY'] },
    ],
  },
  {
    id: '25', raw: 'Explain personal tax reliefs.',
    outcomes: [{ spanText: 'Explain personal tax reliefs', operation: 'EXPLAIN', identity: 'individual_tax_relief_overview', population: 'INDIVIDUAL', scope: 'OVERVIEW', facets: ['OVERVIEW'] }],
  },
  {
    id: '26', raw: 'Do not explain personal tax reliefs; explain CPF relief instead.',
    outcomes: [{ spanText: 'explain CPF relief', operation: 'EXPLAIN', identity: 'cpf_relief', population: 'UNKNOWN', scope: 'SPECIFIC', facets: [] }],
    state: 'UNCERTAIN',
  },
  {
    id: '27', raw: 'What about that and the other treatment?', outcomes: [], state: 'UNCERTAIN',
  },
  {
    id: '28', raw: 'Explain CPF relief for employees and assess the unfamiliar zorb levy.',
    outcomes: [{ spanText: 'Explain CPF relief for employees', operation: 'EXPLAIN', identity: 'cpf_relief', population: 'EMPLOYEE', scope: 'SPECIFIC', facets: [] }],
    state: 'UNCERTAIN',
  },
];

export const subjectTextByIdentity = {
  cpf_relief: 'personal tax relief on compulsory CPF contributions',
  individual_tax_relief_overview: 'individual tax relief categories',
  cpf_contributions: 'CPF contributions',
  private_director_expense_tax_treatment: 'private director expense tax treatment',
  foreign_dividend_tax_treatment: 'Thai subsidiary dividend',
  company_tax_residency: 'company tax residency',
  royalty_withholding_tax: 'royalty withholding tax',
  gst_input_recovery: 'GST input tax recovery',
  sfrsi6_exploration_evaluation: 'SFRS(I) 6 exploration and evaluation',
  employment_pass: 'Employment Pass',
  employment_quota: 'company employment quota',
  annual_return: 'company annual return',
  financial_statements: 'company financial statements',
  cms_licence_or_exemption: 'fund manager CMS licence or exemption',
  investment_fvpl_fvoci: 'investment FVPL or FVOCI classification',
  investment_subsequent_changes: 'investment subsequent changes',
  expense_accounting: 'expense accounting treatment',
  expense_tax_deductibility: 'expense tax deductibility',
  employer_contributions_affect_personal_relief: 'employer CPF contributions affecting personal CPF tax relief',
};
