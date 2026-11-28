import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';

function plan(question) {
  return reconcileQuestionUnderstanding(question, classifyQuestion(question), {
    mode: 'DETERMINISTIC_FALLBACK',
    failure: 'NO_PROVIDER'
  }).issuePlan;
}

function refined(question, topicId, { domain, population, subject }) {
  const result = plan(question);
  const issue = result.issues.find(candidate => candidate.mappedTopicIds.includes(topicId));
  assert.ok(issue, `${topicId} remains attached to a fallback issue for: ${question}`);
  assert.equal(issue.domain, domain, `${topicId} keeps its governing domain`);
  assert.equal(issue.population, population, `${topicId} uses the population asked about: ${JSON.stringify(issue)}`);
  assert.equal(issue.operation, 'EXPLAIN_RULE', `${topicId} is an explanation request`);
  assert.match(issue.subject, subject, `${topicId} identifies the requested rule family`);
  assert.equal(result.coverageEstablished, false, 'fallback intent does not certify whole-question coverage');
  assert.equal(result.hasUnmappedResidual, true, 'fallback refinement preserves unresolved residuals');
  return { result, issue };
}

refined(
  'What are employer and employee CPF percentages in 2026 for a Singapore citizen aged over 60 to 65 earning more than S$750 per month?',
  'cpf_contribution_rates', { domain: 'CPF_PAYROLL', population: 'EMPLOYER', subject: /CPF contribution rates by age group/i }
);
refined(
  'Does the employee CPF percentage change on the exact date of a 60th birthday or from the following month?',
  'cpf_contribution_rates', { domain: 'CPF_PAYROLL', population: 'EMPLOYEE', subject: /CPF contribution rates by age group/i }
);
refined(
  'A worker became a permanent resident on 18 May 2025. When does the second PR contribution year begin?',
  'cpf-pr-contribution-rates', { domain: 'CPF_PAYROLL', population: 'EMPLOYEE', subject: /CPF permanent resident contribution year timing/i }
);
refined(
  'For CPF Additional Wages, can we keep our estimated annual ceiling unchanged in December if the employee’s actual Ordinary Wages turn out higher?',
  'cpf-additional-wages', { domain: 'CPF_PAYROLL', population: 'EMPLOYER', subject: /CPF additional wage ceiling and year-end recalculation/i }
);
refined(
  'What general salary-payment rule applies when the employer dismisses an Employment Act employee rather than the employee resigning?',
  'mom-salary-payment', { domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE', subject: /final salary payment deadlines by termination reason/i }
);
refined(
  'Do public holidays always entitle every Employment Act employee to a paid day off after an unauthorised absence immediately before the holiday?',
  'mom-public-holidays', { domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE', subject: /public holiday entitlement and pay/i }
);
refined(
  'Can a licensed investment manager use the MAS LFMC compliance toolkit as a complete checklist for the funds it manages, including duties outside the Securities and Futures Act?',
  'mas-lfmc', { domain: 'MAS_FUNDS', population: 'COMPANY', subject: /MAS LFMC toolkit scope and fund-level requirements/i }
);
const currentCeoConfirmation = refined(
  'Does the October 2026 annual-return change ask whether somebody actually performs the CEO role?',
  'acra-annual-return-officer-particulars', { domain: 'ACRA_CORPORATE', population: 'COMPANY', subject: /ACRA annual return officer particulars/i }
);
assert.ok(currentCeoConfirmation.issue.contextualTopicIds?.includes('acra_annual-returns'),
  'A current CEO-role confirmation question keeps the annual-return parent contextual.');
refined(
  'For ACRA financial-statement filing, is meeting the small-company size limits enough to use Simplified XBRL if the company is publicly accountable?',
  'acra_xbrl', { domain: 'ACRA_CORPORATE', population: 'COMPANY', subject: /ACRA XBRL financial statement filing/i }
);
refined(
  'Does a nil accounting profit automatically waive ECI filing?',
  'iras-cit-eci', { domain: 'IRAS_INCOME_TAX', population: 'COMPANY', subject: /ECI filing and waiver requirements/i }
);
const acraOfficerParticulars = refined(
  'In general, what officer particulars about directors and auditors does a company confirm on its annual return?',
  'acra-annual-return-officer-particulars', { domain: 'ACRA_CORPORATE', population: 'COMPANY', subject: /ACRA annual return officer particulars/i }
);
assert.ok(acraOfficerParticulars.issue.mappedTopicIds.includes('acra_annual-returns'),
  'The coordinated directors-and-auditors request keeps the annual-return parent mapped.');
assert.ok(!acraOfficerParticulars.issue.contextualTopicIds?.includes('acra_annual-returns'),
  'The annual-return parent is not demoted when the request coordinates multiple officer roles.');
refined(
  'In general, when must a Singapore company appoint a company secretary?',
  'acra_company-secretary', { domain: 'ACRA_CORPORATE', population: 'COMPANY', subject: /company secretary appointment/i }
);
refined(
  'For an Employment Act employee, how is annual leave prorated?',
  'mom_annual_leave', { domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE', subject: /annual leave.*proration/i }
);
refined(
  'For an Employment Act employee, what statutory sick leave entitlements apply?',
  'mom_sick_leave', { domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE', subject: /sick and hospitalisation leave.*entitlement/i }
);
refined(
  'Our GST-registered business paid for staff medical examinations required to renew work permits. Is that input tax deductible?',
  'iras-gst-blocked-input-tax', { domain: 'IRAS_GST', population: 'COMPANY', subject: /GST input tax on staff medical expenses/i }
);
const medicalWorkPassContext = plan(
  'For our GST-registered business, is input tax on staff medical examinations required to renew work permits deductible?'
);
assert.ok(medicalWorkPassContext.issues.some(issue => issue.contextualTopicIds?.includes('mom-work-passes-work-permit')),
  'Work-permit renewal is contextual to the medical GST question without a separate pass-rule request.');
const medicalPlusWorkPass = plan(
  'Our GST-registered business paid for staff medical examinations required to renew work permits. Is that input tax deductible, and what work permit must the employee obtain?'
);
assert.ok(medicalPlusWorkPass.issues.some(issue => issue.mappedTopicIds.includes('mom-work-passes-work-permit')),
  'An explicit separate work-permit question remains a requested sibling topic.');
const medicalPlusRenewalQuestion = plan(
  'Our GST-registered business paid for staff medical examinations required to renew work permits. Is that input tax deductible? Must our work permit be renewed before expiry?'
);
assert.ok(medicalPlusRenewalQuestion.issues.some(issue => issue.mappedTopicIds.includes('mom-work-passes-work-permit')),
  'A separate work-permit renewal question remains a requested topic across sentences.');
assert.ok(!medicalPlusRenewalQuestion.issues.some(issue => issue.contextualTopicIds?.includes('mom-work-passes-work-permit')),
  'A separately requested work-permit topic is not demoted to context.');
const medicalAndPermitRequirements = plan(
  'Please explain GST treatment of staff medical examinations for our business and work permit renewal requirements.'
);
assert.ok(medicalAndPermitRequirements.issues.some(issue => issue.mappedTopicIds.includes('mom-work-passes-work-permit')),
  'Work-permit requirements remain mapped when coordinated with the medical GST request by a noun phrase.');
assert.ok(!medicalAndPermitRequirements.issues.some(issue => issue.contextualTopicIds?.includes('mom-work-passes-work-permit')),
  'A coordinated work-permit noun phrase is not demoted to context.');
const medicalAndRenewalRequest = plan(
  'Our GST-registered business paid for staff medical examinations required to renew work permits. Is that input tax deductible, and must our work permit be renewed before expiry?'
);
assert.ok(medicalAndRenewalRequest.issues.some(issue => issue.mappedTopicIds.includes('mom-work-passes-work-permit')),
  'A coordinated work-permit renewal request remains mapped.');
assert.ok(!medicalAndRenewalRequest.issues.some(issue => issue.contextualTopicIds?.includes('mom-work-passes-work-permit')),
  'A coordinated work-permit request is not demoted to context.');
refined(
  'Our GST-registered business uses a motor car. Can we claim GST input tax on its purchase and running costs?',
  'iras-gst-motor-vehicles', { domain: 'IRAS_GST', population: 'COMPANY', subject: /GST input tax on business motor cars/i }
);
const whtServiceLocation = refined(
  'For service fees paid by our company to a non-resident, how is WHT apportioned when work is partly in Singapore and partly overseas?',
  'iras-withholding-tax', { domain: 'IRAS_INCOME_TAX', population: 'COMPANY', subject: /Withholding tax on non-resident service payments/i }
);
assert.ok(whtServiceLocation.result.issues.some(issue =>
  issue.mappedTopicIds.includes('iras-individual-overseas-employment') ||
  issue.mappedTopicIds.includes('iras-individual-foreign-employment-income')),
  'The coordinated Singapore/overseas wording keeps individual employment-tax topics mapped rather than demoting them.');
refined(
  'We paid a non-resident on 1 October 2026. When is WHT filing due?',
  'iras-withholding-tax', { domain: 'IRAS_INCOME_TAX', population: 'COMPANY', subject: /Withholding tax filing and payment deadline/i }
);
refined(
  'What financial returns must an LFMC file with MAS?',
  'mas-regulatory-reporting', { domain: 'MAS_FUNDS', population: 'COMPANY', subject: /LFMC financial returns and SFA reporting/i }
);
refined(
  'For a VCFM, when is its Form 25A annual declaration due?',
  'mas-regulatory-reporting', { domain: 'MAS_FUNDS', population: 'COMPANY', subject: /VCFM annual declaration and Form 25A/i }
);
refined(
  'What does MAS Notice SFA 04-N24 require from 1 January 2027 for CMS licence holders?',
  'mas-regulatory-reporting', { domain: 'MAS_FUNDS', population: 'COMPANY', subject: /SFA 04-N24 reporting of misconduct.*1 January 2027/i }
);
refined(
  'For monthly wages above S$50 but not more than S$500, is the employee CPF share nil while the employer share remains payable?',
  'cpf-contribution-computation', { domain: 'CPF_PAYROLL', population: 'EMPLOYER', subject: /CPF low-wage employer and employee contribution shares/i }
);

const awWithSeparateOwCeiling = plan(
  'For CPF Additional Wages, can we keep our estimated annual ceiling unchanged in December if the employee’s actual Ordinary Wages turn out higher, and what is the Ordinary Wage ceiling?'
);
assert.ok(awWithSeparateOwCeiling.issues.some(issue => issue.mappedTopicIds.includes('cpf-ordinary-wages')),
  'A separately asked Ordinary Wage ceiling remains mapped beside the AW recalculation rule.');
assert.ok(!awWithSeparateOwCeiling.issues.some(issue => issue.contextualTopicIds?.includes('cpf-ordinary-wages')),
  'An explicitly requested Ordinary Wage ceiling is not demoted to context.');
const awWithAdditionalOwRequest = plan(
  'For CPF Additional Wages, can we keep our estimated annual ceiling unchanged in December if the employee’s actual Ordinary Wages turn out higher? Also explain the Ordinary Wage ceiling.'
);
assert.ok(awWithAdditionalOwRequest.issues.some(issue => issue.mappedTopicIds.includes('cpf-ordinary-wages')),
  'A separate Ordinary Wage explanation remains mapped across sentences.');
assert.ok(!awWithAdditionalOwRequest.issues.some(issue => issue.contextualTopicIds?.includes('cpf-ordinary-wages')),
  'A separate Ordinary Wage explanation is not demoted to context.');
const awAndAdditionalOwRequest = plan(
  'For CPF Additional Wages, can we keep our estimated annual ceiling unchanged in December if the employee’s actual Ordinary Wages turn out higher, and explain the Ordinary Wage ceiling?'
);
assert.ok(awAndAdditionalOwRequest.issues.some(issue => issue.mappedTopicIds.includes('cpf-ordinary-wages')),
  'A coordinated Ordinary Wage explanation remains mapped.');
assert.ok(!awAndAdditionalOwRequest.issues.some(issue => issue.contextualTopicIds?.includes('cpf-ordinary-wages')),
  'A coordinated Ordinary Wage explanation is not demoted to context.');
const officerAndDeadline = plan(
  'From October 2026, what annual return officer particulars must we confirm, and what is the annual-return filing deadline?'
);
assert.ok(officerAndDeadline.issues.some(issue => issue.mappedTopicIds.includes('acra_annual-returns')),
  'A separately requested annual-return deadline remains mapped.');
const toolkitAndLicence = plan(
  'Can an LFMC use the toolkit as a complete checklist for the funds it manages, and what CMS licence must we obtain?'
);
assert.ok(toolkitAndLicence.issues.some(issue => issue.mappedTopicIds.includes('mas-cms-licence')),
  'A separately requested CMS licence outcome remains mapped beside toolkit scope.');

const unsupportedVcfmFinancialReturn = plan('What financial returns must a VCFM file with MAS?');
assert.ok(unsupportedVcfmFinancialReturn.issues.every(issue => issue.operation === 'OTHER'),
  'LFMC financial-return rules are not transferred to VCFMs without a source-backed VCFM reporting family.');

const unrelatedObligation = plan(
  'What WHT filing deadline applies? Also, which widget-registry reporting obligations apply?'
);
assert.equal(unrelatedObligation.coverageEstablished, false, 'an additional unrelated request never becomes covered by the WHT rule');
assert.equal(unrelatedObligation.hasUnmappedResidual, true, 'the unrelated widget request remains an unresolved residual');

const mixedAuthorities = plan(
  'What CPF contribution rates apply to an employee aged 61? Also, what deadline applies to final salary after the employer dismisses an employee? And should our widget-registry support renew?'
);
assert.ok(mixedAuthorities.issues.some(issue => issue.domain === 'CPF_PAYROLL' && issue.mappedTopicIds.includes('cpf_contribution_rates')),
  'the CPF rule issue is preserved in a mixed-authority fallback');
assert.ok(mixedAuthorities.issues.some(issue => issue.domain === 'MOM_EMPLOYMENT' && issue.mappedTopicIds.includes('mom-salary-payment')),
  'the MOM final-salary issue is retained as a separate issue');
assert.equal(mixedAuthorities.hasUnmappedResidual, true, 'unsupported mixed-query content remains an unresolved residual');
assert.equal(mixedAuthorities.coverageEstablished, false, 'multiple refined issues never establish whole-question coverage');

const historicalWht = plan('Which legal WHT rule was in force in 2025 for non-resident payments?');
assert.ok(historicalWht.issues.some(issue => issue.mappedTopicIds.includes('iras-withholding-tax') && issue.operation === 'OTHER'),
  'a historical legal-version request remains unrefined');

const payrollCalculation = plan('Calculate our employee CPF contribution for S$4,000 of monthly wages.');
assert.ok(payrollCalculation.issues.every(issue => issue.operation !== 'EXPLAIN_RULE'),
  'a requested individual payroll calculation never becomes a general-rule answer');

const separateImperatives = plan('Explain the GST treatment of staff medical examinations for our business. Explain work permit renewal requirements.');
assert.ok(separateImperatives.issues.some(issue => issue.domain === 'MOM_EMPLOYMENT' &&
  issue.mappedTopicIds.includes('mom-work-passes-work-permit')),
  'a second imperative sentence retains the requested work-permit issue');
assert.equal(separateImperatives.coverageEstablished, false);

console.log('Statutory fallback intent reconciliation regressions passed.');
