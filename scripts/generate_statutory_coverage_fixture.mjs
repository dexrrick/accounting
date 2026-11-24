import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const official = (path) => `https://www.${path}`;
const specs = [
  { authority: 'IRAS', family: 'input-tax', topicId: 'iras-gst-input-tax', operation: 'CHECK_ELIGIBILITY', url: official('iras.gov.sg/taxes/goods-services-tax-%28gst%29/claiming-gst-%28input-tax%29/conditions-for-claiming-input-tax'), officialUrlAliases: [official('iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax')],
    facts: [['gst registered', 'registered for gst'], ['supplied to you', 'supplied to it', 'imported by you', 'imported by it'], ['purpose of your business', 'business purpose', 'business purposes'], ['tax invoice', 'import permit'], ['taxable supplies', 'standard-rated supplies', 'zero-rated supplies']],
    questions: ['When can a Singapore business recover input GST on purchases?', 'What conditions must a GST-registered business satisfy before claiming GST input tax?', 'Can a GST-registered company claim input tax on business purchases, and what records are needed?', 'Explain when a business may recover GST input tax on purchases used to make taxable supplies.', 'What checks should accounts perform before posting an input GST claim?'] },
  { authority: 'IRAS', family: 'gst-filing', topicId: 'iras-gst-filing-deadlines', operation: 'FILING_REQUIREMENT', url: official('iras.gov.sg/taxes/goods-services-tax-%28gst%29/filing-gst/gst-filing-due-dates-and-requests-for-extension'), officialUrlAliases: [official('iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/gst-filing-due-dates-and-requests-for-extension')],
    facts: [['one month', '1 month'], ['end of the accounting period', 'accounting period ends'], ['nil return', 'nil returns'], ['file every return', 'submit the return']],
    questions: ['When is a Singapore GST return due after each quarter?', 'What is the GST filing deadline for an F5 return?', 'Must we file a nil GST return if there was no activity this quarter?', 'What is the normal GST filing deadline and can a business seek an extension?', 'When is the GST return due after an accounting period ends?'] },
  { authority: 'IRAS', family: 'eci', topicId: 'iras-cit-eci', operation: 'EXPLAIN_RULE', url: official('iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-%28eci%29-filing'), officialUrlAliases: [official('iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-(eci)-filing')],
    facts: [['three months', '3 months'], ['financial year end', 'financial year-end', 'fye'], ['annual revenue of $5 million or below', 'revenue is $5 million or below', 'revenue does not exceed $5 million'], ['eci is nil', 'nil eci', 'estimated chargeable income is nil']],
    questions: ['When should a company file its Estimated Chargeable Income?', 'What is the ECI filing deadline after financial year end?', 'Is there a general waiver from filing ECI and what conditions apply?', 'Do we file ECI if our company had no taxable profit?', 'By when must a Singapore company submit its ECI?'] },
  { authority: 'IRAS', family: 'withholding-tax', topicId: 'iras-withholding-tax', operation: 'CHECK_ELIGIBILITY', url: official('iras.gov.sg/taxes/withholding-tax/basics-of-withholding-tax/types-of-payment-and-withholding-tax-rates'), officialUrlAliases: [official('iras.gov.sg/taxes/withholding-tax/payments-to-non-resident-company/payments-that-are-subject-to-withholding-tax')],
    facts: [['non-resident', 'nonresident'], ['type of payment', 'payment type'], ['withholding tax', 'wht'], ['treaty', 'double taxation agreement', 'dta']],
    questions: ['Does Singapore withholding tax apply to a payment made overseas?', 'We are paying a foreign consultant; how do we determine whether WHT is due?', 'What facts decide if a payment to a non-resident attracts withholding tax?', 'How do tax treaties affect withholding tax on payments to non-residents?', 'What WHT checks should finance make before paying a non-resident company for services?'] },

  { authority: 'CPF', family: 'additional-wages-definition', topicId: 'cpf-additional-wages', operation: 'EXPLAIN_RULE', url: official('cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions'),
    facts: [['not classified as ordinary wages', 'not ordinary wages'], ['additional wages', 'aw'], ['for the month', 'that month'], ['annual performance bonus', 'performance bonus']],
    questions: ['What does CPF mean by Additional Wages?', 'How can payroll distinguish AW from Ordinary Wages?', 'What kind of wage payment is an Additional Wage for CPF?', 'Is an annual performance bonus treated as AW or OW?', 'Explain how CPF classifies wages that are not Ordinary Wages.'] },
  { authority: 'CPF', family: 'cpf-due-date', topicId: 'cpf-contribution-due-dates', operation: 'FILING_REQUIREMENT', url: official('cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay'), officialUrlAliases: [official('cpf.gov.sg/service/article/when-is-the-due-date-for-cpf-contributions')],
    facts: [['end of the month', 'month end'], ['14th of the following month', '14th day of the following month', '14th of next month']],
    questions: ['When must employers pay the CPF contributions for a month?', 'What is the CPF contribution remittance deadline?', 'We paid salary in September; when are the CPF contributions due?', 'By which date should the employer settle monthly CPF?', 'What is the monthly deadline for CPF payment to the Board?'] },
  { authority: 'CPF', family: 'cpf-rate-factors', topicId: 'cpf_contribution_rates', operation: 'EXPLAIN_RULE', url: official('cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay'),
    facts: [['citizenship', 'citizen or permanent resident', 'permanent resident status'], ['age', 'age group'], ['wage amount', 'wages'], ['applicable year', 'year of contribution', 'year']],
    questions: ['What information determines the CPF contribution rate for an employee?', 'Which factors change the employer and employee CPF percentages?', 'Why do two employees with different ages or PR status have different CPF rates?', 'What details does payroll need before applying a CPF contribution rate?', 'How do I check which CPF rate schedule applies to an employee?'] },
  { authority: 'CPF', family: 'cpf-aw-ceiling', topicId: 'cpf-additional-wage-ceiling', operation: 'EXPLAIN_RULE', url: official('cpf.gov.sg/service/article/what-is-the-additional-wage-aw-ceiling'), officialUrlAliases: [official('cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions')],
    facts: [['$102,000', '102,000'], ['ordinary wages subject to cpf', 'ow subject to cpf'], ['calendar year', 'year']],
    questions: ['How is the CPF Additional Wage ceiling for bonuses worked out?', 'What formula determines how much AW can attract CPF?', 'How do OW payments affect the Additional Wage limit?', 'Explain the CPF Additional Wage ceiling for an employee who receives a bonus.', 'How is the remaining CPF ceiling for additional wages determined?'] },
  { authority: 'CPF', family: 'cpf-bonus-classification', topicId: 'cpf-bonus-backpay', operation: 'EXPLAIN_RULE', url: official('cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions'),
    facts: [['annual performance bonus', 'bonus'], ['additional wages', 'aw'], ['subject to applicable additional wage ceiling', 'additional wage ceiling']],
    questions: ['Does an annual bonus attract CPF contributions?', 'How should payroll classify a performance bonus under CPF?', 'Is an annual wage supplement ordinary or additional wages?', 'Does a bonus count as AW for CPF ceiling purposes?', 'What CPF wage category normally includes a one-off annual bonus?'] },

  { authority: 'MOM', family: 'salary-timing', topicId: 'mom-salary-payment', operation: 'EXPLAIN_RULE', url: official('mom.gov.sg/employment-practices/salary/paying-salary'),
    facts: [['at least once a month', 'once a month'], ['within 7 days', '7 days'], ['overtime', 'within 14 days', '14 days']],
    questions: ['How often must an employer pay salary under the Employment Act?', 'What is the usual deadline for monthly salary after the salary period?', 'When is overtime pay due after the salary period ends?', 'Our payroll pays monthly; what is the statutory salary payment timing?', 'Does MOM allow overtime to be paid with a later payroll run?'] },
  { authority: 'MOM', family: 'final-salary', topicId: 'mom-salary-payment', operation: 'EXPLAIN_RULE', url: official('mom.gov.sg/employment-practices/salary/paying-salary'),
    facts: [['last day of employment', 'last day'], ['within 7 days', '7 days'], ['within 3 working days', '3 working days'], ['resignation', 'dismissal', 'termination']],
    questions: ['When is final salary due if an employee serves the full notice period?', 'How soon must salary be paid after a resignation without notice?', 'What timing applies to final salary after dismissal for misconduct?', 'Does employer termination change when the last salary is paid?', 'What must payroll consider when calculating an employee final pay date?'] },
  { authority: 'MOM', family: 'annual-leave', topicId: 'mom_annual_leave', operation: 'CHECK_ELIGIBILITY', url: official('mom.gov.sg/employment-practices/leave/annual-leave/eligibility-and-entitlement'),
    facts: [['at least 3 months', 'three months'], ['7 days', 'seven days'], ['14 days', 'fourteen days'], ['year of service', 'each year of service', 'completed years of service']],
    questions: ['When does statutory paid annual leave begin under the Employment Act?', 'What is the minimum annual leave entitlement and how does it increase?', 'How many days of annual leave does an eligible employee receive after eight years?', 'Does an employee need to serve a minimum period before annual leave applies?', 'Explain the statutory annual leave progression for covered employees.'] },
  { authority: 'MOM', family: 'salary-deductions', topicId: 'mom-salary-payment', operation: 'CHECK_ELIGIBILITY', url: official('mom.gov.sg/employment-practices/salary/salary-deductions'),
    facts: [['reason for the deduction', 'type of deduction', 'deduction category'], ['authorized', 'authorised', 'allowed by law'], ['salary period', 'final salary', 'termination']],
    questions: ['Can an employer deduct a staff shortage from salary?', 'What kinds of salary deductions are permitted by MOM?', 'Our employee damaged a company item; what can payroll deduct?', 'What facts determine whether a salary deduction is lawful?', 'Are the usual deduction limits different for final salary?'] },
  { authority: 'MOM', family: 'overtime-eligibility', topicId: 'mom_overtime', operation: 'CHECK_ELIGIBILITY', url: official('mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days/overtime'),
    facts: [['part iv', 'part 4'], ['workman', 'manual worker'], ['non-workman', 'non-manual worker'], ['basic monthly salary', 'basic salary']],
    questions: ['Which employees are covered by Part IV overtime rules?', 'Does every employee in Singapore have a statutory overtime entitlement?', 'How does MOM decide whether a worker qualifies for overtime pay?', 'Are managers and executives covered by Part IV hours and overtime limits?', 'What employee and salary details determine Part IV overtime coverage?'] },

  { authority: 'ACRA', family: 'agm-deadlines', topicId: 'acra_agm', operation: 'FILING_REQUIREMENT', url: official('acra.gov.sg/manage/companies/legal-requirements-common-offences/holding-annual-general-meetings'), officialUrlAliases: [official('acra.gov.sg/manage/companies/legal-requirements-common-offences/holding-annual-general-meetings/due-dates-requirements/')],
    facts: [['four months', '4 months'], ['six months', '6 months'], ['financial year end', 'financial year-end', 'fye']],
    questions: ['How long after FYE must a company hold its AGM?', 'What is the AGM deadline for listed and non-listed companies?', 'When should directors schedule the annual general meeting?', 'Does a Singapore company AGM deadline depend on whether it is listed?', 'How do I work out when the next AGM is due?'] },
  { authority: 'ACRA', family: 'annual-returns', topicId: 'acra_annual-returns', operation: 'FILING_REQUIREMENT', url: official('acra.gov.sg/manage/companies/filing-and-business-updates/annual-returns'), officialUrlAliases: [official('acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-annual-returns-companies/deadline-requirements/')],
    facts: [['annual return', 'ar'], ['file with acra', 'file an annual return', 'submit annual return'], ['financial year end', 'financial year-end', 'fye'], ['listed company', 'non-listed company', 'unlisted company']],
    questions: ['How does a Singapore private company file its annual return with ACRA?', 'When is a Singapore private company’s annual return due after its financial year end?', 'Does a dormant Singapore private company still file its annual return if it had no transactions?', 'Does the annual return deadline differ for a listed and non-listed Singapore company?', 'What company details should be checked before filing the AR?'] },
  { authority: 'ACRA', family: 'audit-exemption', topicId: 'acra_small_company', operation: 'CHECK_ELIGIBILITY', url: official('acra.gov.sg/manage/companies/legal-requirements-common-offences/preparing-financial-statements/audit-exemptions'), officialUrlAliases: [official('acra.gov.sg/manage/companies/legal-requirements-common-offences/preparing-financial-statements/audit-exemptions/')],
    facts: [['private company', 'private'], ['two of the three', 'at least 2 of 3', 'two criteria'], ['$10 million', '10 million'], ['50 employees', '50 or fewer employees'], ['two consecutive financial years', 'immediate past two consecutive financial years']],
    questions: ['What tests make a Singapore private company a small company for audit exemption?', 'How many small company criteria must be met to qualify for audit exemption?', 'Do the audit exemption thresholds have to be met for one year or two?', 'What financial and employee measures are used for the small company audit test?', 'Does being audit exempt mean financial statements do not need to be prepared?'] },
  { authority: 'ACRA', family: 'annual-return-officer-particulars', topicId: 'acra-annual-return-officer-particulars', operation: 'FILING_REQUIREMENT', url: official('acra.gov.sg/news-events/news-announcements/commencement-of-key-changes-under-the-corporate-and-accounting-laws--amendment--act-2025-on-20-october-2026'), officialUrlAliases: [official('acra.gov.sg/news-events/news-announcements/commencement-of-key-changes-under-the-corporate-and-accounting-laws--amendment--act-2025-on-20-october-2026/')],
    facts: [['20 october 2026', '20/10/2026'], ['confirm', 'confirmation'], ['latest particulars', 'particulars are accurate'], ['directors', 'secretaries', 'auditors', 'ceo']],
    questions: ['From 20 October 2026, what officer particulars must a local company confirm when it files its annual return?', 'Does the 20 October 2026 change require a local company to check officer details when filing its annual return?', 'Which officers’ latest particulars must a local company confirm when it files its annual return from October 2026?', 'What officer information should be checked when a local company files its annual return under the October 2026 change?', 'Does a local company confirm that director and secretary particulars are accurate when filing its annual return from 20 October 2026?'] },
  { authority: 'ACRA', family: 'secretary-appointment', topicId: 'acra_company-secretary', operation: 'FILING_REQUIREMENT', url: official('acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers'), officialUrlAliases: [official('acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/')],
    facts: [['within 6 months', 'within six months'], ['incorporation', 'incorporated'], ['ordinarily resident', 'resident in singapore'], ['sole director', 'only director']],
    questions: ['By when must a new local company appoint its company secretary?', 'What are the basic company secretary appointment requirements?', 'Can the sole director also act as the company secretary?', 'Must the company secretary ordinarily reside in Singapore?', 'What is the statutory deadline to fill a secretary vacancy?'] },

  { authority: 'MAS', family: 'fund-management-licence', topicId: 'mas-lfmc', operation: 'EXPLAIN_RULE', url: official('mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing'),
    facts: [['fund management activities', 'fund management'], ['securities and futures act 2001', 'sfa'], ['licensed fund management company', 'lfmc'], ['capital markets services licence', 'cms licence'], ['existing class exemption', 'class exemption']],
    questions: ['Does an LFMC need a CMS licence?', 'If our firm manages funds, when is an MAS licence generally required?', 'Does conducting regulated fund management require an LFMC licence?', 'What is the general licensing rule for fund management under the SFA?', 'Can a company conduct regulated fund management without a CMS licence?'] },
  { authority: 'MAS', family: 'vcfm', topicId: 'mas-vcfm', operation: 'CHECK_ELIGIBILITY', url: official('mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing'),
    facts: [['venture capital funds', 'venture capital fund'], ['simplified', 'simplified regime'], ['eligibility', 'eligible', 'criteria']],
    questions: ['What is MAS’s VCFM regime for venture capital fund managers?', 'Can a firm that manages VC funds use a simplified licensing path?', 'How does an MAS venture capital fund manager differ from an LFMC?', 'What facts determine whether a manager can use the VCFM regime?', 'Is the VCFM route automatically available to every private fund manager?'] },
  { authority: 'MAS', family: 'class-exemptions', topicId: 'mas-fund-management-exemptions', operation: 'CHECK_ELIGIBILITY', url: official('mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing'),
    facts: [['existing class exemption', 'class exemption'], ['does not require a licence', 'does not require a license', 'no licence'], ['eligible', 'able to operate'], ['related corporations', 'related family members', 'accredited and institutional investors']],
    questions: ['Are there class exemptions from the fund management licensing requirement?', 'When can a fund manager operate without an MAS licence?', 'Does managing money for a related corporation automatically exempt a firm?', 'What are examples of fund management activities that may be class exempt?', 'How should a firm check if an existing class exemption applies?'] },
  { authority: 'MAS', family: 'qdc-reporting', topicId: 'mas-quarterly-fund-data-collection', operation: 'FILING_REQUIREMENT', url: official('mas.gov.sg/regulation/capital-markets'),
    clarification: [['regulated entity type', 'fund manager type'], ['reporting obligation', 'qdc obligation', 'applicable return'], ['reporting period', 'reporting frequency', 'period']],
    questions: ['What QDC return does our fund need to submit to MAS?', 'How often is a quarterly fund data collection return due?', 'Are all MAS regulated fund managers included in QDC reporting?', 'Which form should a VCFM submit through MAS-Tx?', 'Does the fund data return differ by manager and fund type?'] },
  { authority: 'MAS', family: 'regulatory-notifications', topicId: 'mas-regulatory-reporting', operation: 'FILING_REQUIREMENT', url: official('mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities'),
    clarification: [['regulated entity type', 'licence type'], ['report or notification', 'filing type', 'change'], ['applicable notice', 'applicable requirement', 'due date']],
    questions: ['Which regulatory returns must our MAS fund manager file?', 'When should a licensed fund manager notify MAS about a material change?', 'What filings are due for an LFMC each year?', 'Does an MAS reporting requirement depend on the licence and fund type?', 'What details do you need to identify the correct fund manager return deadline?'] }
];

for (const spec of specs) {
  if (spec.authority !== 'IRAS') spec.questions.pop();
}

// Each paraphrase has its own required fact groups. These indexes narrow the
// family facts to what that particular question asks for; they are checklist
// inputs, not a substantive correctness decision.
const factIndexesByFamily = {
  'input-tax': [[0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 2, 4], [0, 1, 2, 3, 4]],
  'gst-filing': [[0, 1, 3], [0, 1, 3], [2, 3], [0, 1, 3], [0, 1, 3]],
  eci: [[0, 1], [0, 1], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1]],
  'withholding-tax': [[0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 3], [0, 1, 2, 3]],
  'additional-wages-definition': [[1], [0, 1, 2], [1, 3], [1, 3]],
  'cpf-due-date': [[0, 1], [0, 1], [0, 1], [0, 1]],
  'cpf-rate-factors': [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]],
  'cpf-aw-ceiling': [[0, 1, 2], [0, 1, 2], [1, 2], [0, 1, 2]],
  'cpf-bonus-classification': [[0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2]],
  'salary-timing': [[0, 1], [1], [2], [0, 1]],
  'final-salary': [[0, 3], [1, 3], [0, 3], [0, 3]],
  'annual-leave': [[0, 1], [1, 2, 3], [2, 3], [0, 1]],
  'salary-deductions': [[0, 1], [0, 1], [0, 1], [0, 1]],
  'overtime-eligibility': [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]],
  'agm-deadlines': [[0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2]],
  'annual-returns': [[0, 1], [0, 1, 2, 3], [0, 1], [0, 2, 3]],
  'audit-exemption': [[0, 1, 2, 3, 4], [0, 1, 4], [4], [2, 3, 4]],
  'annual-return-officer-particulars': [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]],
  'secretary-appointment': [[0, 1], [0, 1, 2, 3], [3], [2]],
  'fund-management-licence': [[0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4]],
  vcfm: [[0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2]],
  'class-exemptions': [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]],
  'qdc-reporting': [[0, 1], [0, 2], [0, 1], [0, 1, 2]],
  'regulatory-notifications': [[0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2]]
};

const caseOverrides = {
  'iras-eci-04': {
    question: 'Our company had no accounting profit this year. Can it skip ECI, or what facts determine whether the filing waiver applies?',
    expected: { disposition: 'CLARIFY', missingFactGroups: [
      { anyOf: ['annual revenue', 'revenue for the financial year'] },
      { anyOf: ['estimated chargeable income', 'eci amount', 'whether eci is nil'] }
    ] },
    clarificationExpected: true
  },
  'cpf-cpf-rate-factors-02': {
    question: 'For an employee paid during 2024, what facts determine the applicable CPF contribution rate schedule?',
    expected: { disposition: 'ANSWER', requiredFactGroups: [
      { anyOf: ['citizenship', 'citizen or permanent resident', 'permanent resident status'] },
      { anyOf: ['age', 'age group'] },
      { anyOf: ['wage amount', 'wages'] },
      { anyOf: ['2024 contribution schedule', '2024 rate schedule', 'rate schedule applicable in 2024'] }
    ] },
    temporal: { targetDate: '2024-01-01', status: 'REQUIRES_HISTORICAL_OFFICIAL_RATE_SOURCE' }
  },
  'cpf-cpf-rate-factors-04': {
    question: 'Our employee earns S$4,000 a month. Can you calculate the CPF contributions, and what other payroll facts do you need?',
    operation: 'CALCULATE',
    expected: { disposition: 'CLARIFY', missingFactGroups: [
      { anyOf: ['employee age', 'age of the employee'] },
      { anyOf: ['citizenship or permanent resident status', 'citizen or pr status', 'permanent resident status'] },
      { anyOf: ['contribution month or year', 'applicable contribution year', 'contribution year', 'date the wages were earned'] },
      { anyOf: ['ordinary and additional wages', 'wage type and amount', 'ordinary wages and additional wages', 'ordinary versus additional wage breakdown'] }
    ] },
    calculation: { status: 'REQUIRES_INDEPENDENT_CALCULATION_REVIEW', requiredInputs: ['age', 'citizenship or permanent-resident status', 'contribution period', 'ordinary-wage and additional-wage breakdown'] },
    clarificationExpected: true
  },
  'cpf-additional-wages-definition-02': { requiredTopicIds: ['cpf-ordinary-wages', 'cpf-additional-wages'] },
  'cpf-additional-wages-definition-03': { requiredTopicIds: ['cpf-additional-wages'] },
  'cpf-additional-wages-definition-04': { requiredTopicIds: ['cpf-additional-wages', 'cpf-bonus-backpay'] },
  'cpf-cpf-bonus-classification-01': { requiredTopicIds: ['cpf-additional-wages', 'cpf-bonus-backpay'] },
  'cpf-cpf-bonus-classification-02': { requiredTopicIds: ['cpf-additional-wages', 'cpf-bonus-backpay'] },
  'cpf-cpf-bonus-classification-03': { requiredTopicIds: ['cpf-additional-wages'] },
  'cpf-cpf-bonus-classification-04': { requiredTopicIds: ['cpf-additional-wages', 'cpf-additional-wage-ceiling'] },
  'mom-annual-leave-04': {
    question: 'For an eligible employee in the 2018 leave year, what statutory annual leave rule applied?',
    expected: { disposition: 'CLARIFY', missingFactGroups: [
      { anyOf: ['official MOM guidance in force in 2018', 'dated official source for 2018', 'historical official guidance'] }
    ] },
    temporal: { targetDate: '2018-01-01', status: 'REQUIRES_HISTORICAL_OFFICIAL_SOURCE' },
    clarificationExpected: true,
    clarificationAssessmentIsHeuristic: true
  },
  'acra-agm-deadlines-02': {
    question: 'What is the AGM deadline for listed and non-listed Singapore companies?',
    expected: { disposition: 'ANSWER', requiredFactGroups: [
      { anyOf: ['four months', '4 months'] },
      { anyOf: ['six months', '6 months'] },
      { anyOf: ['financial year end', 'financial year-end', 'fye'] },
      { anyOf: ['listed company', 'listed companies'] },
      { anyOf: ['non-listed company', 'unlisted company', 'other companies'] }
    ] }
  },
  'acra-agm-deadlines-04': {
    question: 'What information do you need to work out our company’s next AGM deadline?',
    expected: { disposition: 'CLARIFY', missingFactGroups: [
      { anyOf: ['financial year end date', 'fye date'] },
      { anyOf: ['whether the company is listed', 'listed or non-listed status', 'listing status'] }
    ] },
    clarificationExpected: true
  },
  'mas-qdc-reporting-04': {
    question: 'Which QDC return should a VCFM submit through MAS-Tx?',
    requiredTopicIds: ['mas-quarterly-fund-data-collection', 'mas-vcfm'],
    expected: { disposition: 'CLARIFY', missingFactGroups: [
      { anyOf: ['applicable QDC obligation', 'MAS notice that applies to this VCFM', 'fund reporting requirement'] },
      { anyOf: ['reporting period', 'reporting frequency'] }
    ] },
    clarificationExpected: true,
    clarificationAssessmentIsHeuristic: true
  },
  'acra-annual-return-officer-particulars-01': {
    temporal: { targetDate: '2026-10-21', effectiveDate: '2026-10-20', status: 'REQUIRES_SOURCE_VALIDITY_FROM_COMMENCEMENT' }
  },
  'acra-annual-return-officer-particulars-02': {
    temporal: { targetDate: '2026-10-21', effectiveDate: '2026-10-20', status: 'REQUIRES_SOURCE_VALIDITY_FROM_COMMENCEMENT' }
  },
  'acra-annual-return-officer-particulars-03': {
    temporal: { targetDate: '2026-10-21', effectiveDate: '2026-10-20', status: 'REQUIRES_SOURCE_VALIDITY_FROM_COMMENCEMENT' }
  },
  'acra-annual-return-officer-particulars-04': {
    temporal: { targetDate: '2026-10-21', effectiveDate: '2026-10-20', status: 'REQUIRES_SOURCE_VALIDITY_FROM_COMMENCEMENT' }
  },
  'acra-secretary-appointment-03': {
    expected: { disposition: 'ANSWER', requiredFactGroups: [
      { anyOf: ['sole director', 'only director'] },
      { anyOf: ['company secretary'], polarity: 'NEGATIVE' }
    ] }
  }
};

const questionsByAuthority = Object.fromEntries(['IRAS', 'CPF', 'MOM', 'ACRA', 'MAS'].map(authority => [authority, 0]));
const cases = [];
for (const spec of specs) {
  if (![4, 5].includes(spec.questions.length)) throw new Error(`${spec.authority}/${spec.family} must have four or five reviewed paraphrases`);
  for (const [index, question] of spec.questions.entries()) {
    const id = `${spec.authority.toLowerCase()}-${spec.family}-${String(index + 1).padStart(2, '0')}`;
    const selectedFactIndexes = factIndexesByFamily[spec.family]?.[index] ?? spec.facts?.map((_, factIndex) => factIndex);
    const testCase = {
      id,
      authority: spec.authority,
      family: spec.family,
      question,
      operation: spec.operation,
      requiredTopicIds: [spec.topicId],
      expected: spec.facts ? { disposition: 'ANSWER', requiredFactGroups: selectedFactIndexes.map(factIndex => ({ anyOf: spec.facts[factIndex] })) }
        : { disposition: 'CLARIFY', missingFactGroups: (selectedFactIndexes ?? spec.clarification.map((_, factIndex) => factIndex)).map(factIndex => ({ anyOf: spec.clarification[factIndex] })) },
      officialSources: [spec.url, ...(spec.officialUrlAliases ?? [])],
      temporal: { status: 'REQUIRES_CURRENT_OFFICIAL_SOURCE_AND_DATE_SCOPE' },
      calculation: { status: spec.operation === 'CALCULATE' ? 'NOT_SCORED_WITHOUT_CASE_FACTS' : 'NOT_APPLICABLE' },
      sourceBasis: 'Official first-party authority page; routing labels are not answer acceptance.',
      scope: spec.family,
      clarificationExpected: Boolean(spec.clarification),
      ...(spec.clarification ? { clarificationAssessmentIsHeuristic: true } : {}),
      uniqueOrdinal: ++questionsByAuthority[spec.authority]
    };
    const override = caseOverrides[id];
    if (override) Object.assign(testCase, override);
    cases.push(testCase);
  }
}
if (Object.values(questionsByAuthority).some(count => count !== 20) || cases.length !== 100) throw new Error('Benchmark requires exactly 20 questions for each of five authorities.');
const output = path.join(root, 'tests', 'evaluation', 'statutory_coverage_wave_2026-10-25.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({ generatedFrom: 'scripts/generate_statutory_coverage_fixture.mjs', preparedAt: '2026-10-25', referenceDate: '2026-10-25', scope: 'Practical question coverage benchmark; answer quality requires real captured responses and independent legal review.', authorityCounts: questionsByAuthority, cases }, null, 2)}\n`);
console.log(`Wrote ${cases.length} questions: ${JSON.stringify(questionsByAuthority)}`);
