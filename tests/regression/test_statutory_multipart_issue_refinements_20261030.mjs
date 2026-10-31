import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import { shouldUseAuthorityEvidenceRuntime } from '../../src/utils/authorityEvidenceRouting.ts';
import {
  IRAS_MAS_KNOWLEDGE_RULES_20261027B,
  getIrasMasKnowledgeEvidence,
  selectIrasMasKnowledgeQuotes,
  supportIrasMasKnowledgeRule
} from '../../src/retrieval/irasMasKnowledge20261027b.ts';

const fallback = { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' };
const planFor = query => reconcileQuestionUnderstanding(query, classifyQuestion(query), fallback);

const irasQuery = 'Our GST-registered company needs to know whether input tax can be claimed for staff medical check-up expenses and a commercial delivery van used to deliver goods. What conditions and exceptions apply?';
const irasPlan = planFor(irasQuery);
const medicalIssue = irasPlan.issuePlan.issues.find(issue => /staff medical expenses/i.test(issue.subject));
const vanIssue = irasPlan.issuePlan.issues.find(issue => /delivery van/i.test(issue.subject));
assert.ok(medicalIssue && vanIssue, 'the medical and delivery-van questions produce separate issues');
assert.notEqual(medicalIssue.id, vanIssue.id);
assert.equal(medicalIssue.domain, 'IRAS_GST');
assert.equal(vanIssue.domain, 'IRAS_GST');
assert.equal(irasPlan.issuePlan.coverageEstablished, false, 'splitting evidence issues does not establish whole-query coverage');
const explicitIrasRoute = (issuePlan, classification = irasPlan.classification) => shouldUseAuthorityEvidenceRuntime({
  issuePlan, classification, explicitIrasEvidenceRequest: true, hasImages: false
});
assert.equal(explicitIrasRoute(irasPlan.issuePlan), true,
  'independently mapped IRAS medical and van issues reach the existing per-issue evidence runtime');
const wrongMappedDomainPlan = structuredClone(irasPlan.issuePlan);
wrongMappedDomainPlan.issues.find(issue => /delivery van/i.test(issue.subject)).mappedTopicIds = ['iras-individual-tax-relief'];
assert.equal(explicitIrasRoute(wrongMappedDomainPlan), false,
  'a multipart IRAS plan fails closed if any mapped issue topic is outside its governed GST/classified domain');
assert.equal(explicitIrasRoute(irasPlan.issuePlan, { ...irasPlan.classification, authorities: ['MOM'] }), false,
  'the multipart IRAS evidence route still requires classifier authority agreement');
const nonAdvisoryIrasPlan = structuredClone(irasPlan.issuePlan);
nonAdvisoryIrasPlan.issues.find(issue => /delivery van/i.test(issue.subject)).operation = 'CALCULATE';
assert.equal(explicitIrasRoute(nonAdvisoryIrasPlan), false,
  'the multipart evidence route rejects calculation issues instead of broadening its advisory guard');

const irasSourceManifest = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/statutoryKnowledge20261027b/iras-mas-source-manifest.json', import.meta.url)), 'utf8'));
const irasSourceRecord = irasSourceManifest.sources.find(source => source.fixture === 'iras-mas-input-tax-native.html');
assert.ok(irasSourceRecord, 'the native IRAS Conditions page response has a source manifest entry');
const irasNativeBytes = readFileSync(fileURLToPath(new URL(`../fixtures/statutoryKnowledge20261027b/${irasSourceRecord.fixture}`, import.meta.url)));
assert.equal(createHash('sha256').update(irasNativeBytes).digest('hex'), irasSourceRecord.sha256,
  'the native IRAS page bytes match their retained digest');
const irasNativeText = irasNativeBytes.toString('utf8');
const medicalRule = IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'IRAS_GST_STAFF_MEDICAL_INPUT_TAX');
const motorRule = IRAS_MAS_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'IRAS_GST_MOTOR_CAR_INPUT_TAX');
assert.ok(medicalRule && motorRule);
assert.equal(motorRule.officialUrl, irasSourceRecord.url,
  'motor-vehicle proof stays bound to the exact Conditions page URL actually captured');
assert.equal(motorRule.title, irasSourceRecord.title, 'the source title is not relabelled as a fetched vehicle page');
assert.equal(motorRule.sourceSection, 'Motor Vehicles Expenses accordion — Other motor vehicles row');
assert.match(motorRule.sourcePassage, /van.*conditions for claiming input tax are met/i);

const makeGstRequest = (subject, rule) => ({ authority: 'IRAS', topicId: rule.topicIds[0], query: irasQuery,
  subject, sourceText: irasNativeText, officialUrl: rule.officialUrl });
const medicalRequest = makeGstRequest(medicalIssue.subject, medicalRule);
const vanRequest = makeGstRequest(vanIssue.subject, motorRule);
assert.equal(supportIrasMasKnowledgeRule(medicalRequest), true, 'staff medical evidence remains independently provable');
assert.equal(supportIrasMasKnowledgeRule(vanRequest), true, 'the exact embedded van row and ordinary conditions prove the van issue');
const vanQuotes = selectIrasMasKnowledgeQuotes(vanRequest);
assert.ok(vanQuotes.some(quote => /input tax claims are allowed on motor vehicles/i.test(quote) && /lorry, van, motorcycle/i.test(quote) && /conditions for claiming input tax/i.test(quote)),
  'the selected IRAS quote itself establishes the non-car van premise and ordinary conditions');
assert.equal(supportIrasMasKnowledgeRule({ ...vanRequest, officialUrl: `${motorRule.officialUrl}?revision=other` }), false,
  'a noncanonical source revision fails closed');
assert.equal(supportIrasMasKnowledgeRule({ ...vanRequest, sourceText: '' }), false,
  'a missing or truncated vehicle passage cannot prove the van issue');
assert.notEqual(supportIrasMasKnowledgeRule({ ...medicalRequest, subject: 'GST input tax on staff medical expenses and delivery van' }), true,
  'a combined subject cannot claim the individual medical proof');

const binding = { recordId: 'iras-input-tax-page', documentHash: irasSourceRecord.sha256,
  canonicalUrl: irasSourceRecord.url, retrievedAt: '2026-10-27T00:00:00.000Z' };
const presentedIssue = issue => ({ id: issue.id, subject: issue.subject, population: 'Company',
  operation: 'EXPLAIN_RULE', evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED' });
const motorProofQuotes = selectIrasMasKnowledgeQuotes({ authority: 'IRAS', topicId: motorRule.topicIds[0],
  query: 'How does input tax work for a business motor car?', subject: 'GST input tax on motor cars and vehicle exceptions',
  sourceText: irasNativeText, officialUrl: motorRule.officialUrl });
const presentedSource = issue => ({ key: binding.recordId, title: irasSourceRecord.title,
  publisher: 'Inland Revenue Authority of Singapore', documentTitle: irasSourceRecord.title,
  officialUrl: irasSourceRecord.url, provenance: 'LIVE_EXTERNAL',
  claims: motorProofQuotes.map(text => ({ text, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [issue.id], provenance: 'LIVE_EXTERNAL',
      fetchedSourceBinding: { ...binding } })) });
const vanPresentedIssue = presentedIssue(vanIssue);
const vanStream = { id: 'IRAS:IRAS_GST', authority: 'IRAS', domain: 'IRAS_GST', evidenceStatus: 'VERIFIED',
  issues: [vanPresentedIssue], sources: [presentedSource(vanIssue)] };
assert.match(getIrasMasKnowledgeEvidence(irasQuery, vanStream, vanPresentedIssue)?.text || /$^/, /other motor vehicles such as delivery vans/i,
  'the application renderer binds the vehicle answer to the van issue and exact native source');
const swappedIssueSource = structuredClone(vanStream.sources[0]);
swappedIssueSource.claims.forEach(claim => { claim.issueIds = ['unrelated-medical-issue']; });
assert.equal(getIrasMasKnowledgeEvidence(irasQuery, { ...vanStream, sources: [swappedIssueSource] }, vanPresentedIssue), undefined,
  'vehicle passages assigned to a different issue cannot render the van answer');

const cpfQuery = 'What employer CPF contribution is payable on an employee salary of S$5,000, and when should we request a refund of last month’s overpayment?';
const cpf = planFor(cpfQuery);
const cpfCalculationIssue = cpf.issuePlan.issues.find(issue => issue.domain === 'CPF_PAYROLL' && issue.operation === 'CALCULATE');
const cpfRefundIssue = cpf.issuePlan.issues.find(issue => issue.mappedTopicIds.includes('cpf-adjustments-refunds') && issue.operation === 'EXPLAIN_RULE');
assert.ok(cpfCalculationIssue, 'a payable CPF amount remains a separate calculation issue');
assert.ok(cpfRefundIssue, 'the employer refund procedure remains a separate advisory issue');
assert.equal(cpfRefundIssue.population, 'EMPLOYER');
assert.notEqual(cpfCalculationIssue.id, cpfRefundIssue.id, 'calculation and refund evidence cannot share one issue binding');
assert.ok(cpf.classification.missingFacts.some(fact => /age band/.test(fact)) &&
  cpf.classification.missingFacts.some(fact => /Ordinary Wages or Additional Wages/.test(fact)),
  'missing CPF calculation facts are retained instead of deriving an amount from salary alone');
assert.equal(cpf.issuePlan.coverageEstablished, false);
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: cpf.issuePlan, classification: cpf.classification,
  explicitIrasEvidenceRequest: false, hasImages: false }), true,
  'the bounded CPF calculation-plus-refund plan presents calculation gaps and the separately mapped refund rule');
const cpfWithoutRefund = structuredClone(cpf.issuePlan);
cpfWithoutRefund.issues = cpfWithoutRefund.issues.filter(issue => !issue.mappedTopicIds.includes('cpf-adjustments-refunds'));
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: cpfWithoutRefund, classification: cpf.classification,
  explicitIrasEvidenceRequest: false, hasImages: false }), false,
  'a lone CPF calculation cannot enter the mixed refund evidence route');
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: cpf.issuePlan,
  classification: { ...cpf.classification, missingFacts: [] }, explicitIrasEvidenceRequest: false, hasImages: false }), false,
  'fully specified CPF amounts remain on the existing calculation path');
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: cpf.issuePlan,
  classification: { ...cpf.classification, journalEntryRequired: true }, explicitIrasEvidenceRequest: false, hasImages: false }), false,
  'payroll journal requests remain outside the mixed CPF evidence route');
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: cpf.issuePlan, classification: cpf.classification,
  explicitIrasEvidenceRequest: false, hasImages: true }), false,
  'image requests remain outside the mixed CPF evidence route');
const ambiguousCpfRefund = planFor('The bonus repayment due date was 15 September 2026, or 20 September 2026; the agreement is unclear. PAYMENTS RECEIVED ON 1 October 2025. What is the CPF refund deadline?').issuePlan;
assert.ok(ambiguousCpfRefund.issues.some(issue => issue.mappedTopicIds.includes('cpf-adjustments-refunds') &&
  issue.operation === 'EXPLAIN_RULE'),
  'an ambiguous date alternative remains a refund advisory without being converted to a calculation');
assert.ok(!ambiguousCpfRefund.issues.some(issue => issue.operation === 'CALCULATE'),
  'ambiguous repayment dates are not promoted into a date calculation');
assert.equal(ambiguousCpfRefund.coverageEstablished, false);

const masQuery = 'We are a VCFM. What does Form 25A require, when must we submit it, and when is a nil misconduct return due if there was no report last year? Is the toolkit complete for all funds we manage?';
const masPlan = planFor(masQuery).issuePlan;
assert.ok(masPlan.issues.some(issue => /Form 25A/.test(issue.subject)));
assert.ok(masPlan.issues.some(issue => /nil misconduct return/i.test(issue.subject)));
assert.ok(masPlan.issues.some(issue => /toolkit scope and fund-level requirements/i.test(issue.subject)));
assert.equal(masPlan.coverageEstablished, false, 'annual declaration, nil-return and toolkit-scope splits remain incomplete as a whole');
const qdcPlan = planFor('Which exact QDC form must our VCFM file, which funds and mandates are in scope, and what is the filing deadline?').issuePlan;
assert.equal(qdcPlan.coverageEstablished, false, 'the explicit QDC evidence gap remains open');
assert.ok(qdcPlan.issues.some(issue => issue.mappedTopicIds.includes('mas-quarterly-fund-data-collection')),
  'the existing QDC request remains visible as a mapped topic, with evidence still unestablished');
const formsPlusQdcPlan = planFor('Our VCFM needs a Form 23A change-in-particulars notification and a Form 7 cessation notification. What exact QDC form must we file as well?').issuePlan;
assert.ok(formsPlusQdcPlan.issues.some(issue => issue.mappedTopicIds.includes('mas-quarterly-fund-data-collection')),
  'splitting Form 23A and Form 7 does not drop a third independent QDC request');
assert.equal(formsPlusQdcPlan.coverageEstablished, false);

const donation = planFor('Our company made an approved donation to an IPC. What is its corporate income tax treatment?').issuePlan.issues;
assert.ok(donation.some(issue => issue.subject === 'Corporate income tax treatment of approved donations' && issue.population === 'COMPANY'));

const officeUpdateQuery = 'Our local company changed its registered office. Where must the registered office be accessible during business hours, and what ACRA notification deadline applies to the change?';
const officeUpdatePlan = planFor(officeUpdateQuery).issuePlan;
assert.ok(officeUpdatePlan.issues.some(issue => issue.subject === 'ACRA local-company registered office location, access, records and notices' && issue.mappedTopicIds.includes('acra_registered-office')));
assert.ok(officeUpdatePlan.issues.some(issue => issue.subject === 'ACRA company entity information update requirements' && issue.mappedTopicIds.includes('acra-entity-information-changes')),
  'the physical-office request does not demote the separate ACRA update duty');
assert.equal(officeUpdatePlan.issues.some(issue => issue.mappedTopicIds.includes('iras-company-record-retention')), false,
  'registered-office records and notices do not leak into IRAS tax-record retention');
for (const query of [
  'We are an overseas-incorporated company registered in Singapore as a foreign company. We changed our registered office twenty days ago. A colleague says every ACRA entity has only fourteen days. Are we already late?',
  'Our company changed its registered office address on 12 October 2026. By when must we notify ACRA?',
  'We are an overseas-incorporated company registered in Singapore as a foreign company. Our registered office changed 20 days ago, and our entity email changed forty days ago. Are we late with both updates?',
  'We are an overseas-incorporated company registered in Singapore as a foreign company. Our registered office changed 20 days ago. The company email was updated 40 days ago. Are both changes still within the notification period?',
  'We are an overseas-incorporated company registered in Singapore as a foreign company. Our registered office changed 20 days ago. Our entity email was also updated, but I do not know when. Are both updates late?'
]) {
  const plan = planFor(query).issuePlan;
  assert.ok(plan.issues.some(issue => issue.mappedTopicIds.includes('acra-entity-information-changes')),
    'registered-office change deadlines retain their ACRA entity-update mapping');
  assert.ok(!plan.issues.some(issue => issue.mappedTopicIds.includes('acra_registered-office')),
    'change-only questions do not request separate office location/access rules');
}

const salaryDeduction = planFor('Can we deduct S$400 from an employee salary for a uniform, recruitment fee, and employment levy?').issuePlan.issues;
assert.ok(salaryDeduction.some(issue => issue.subject === 'MOM employer salary deduction authorization, purpose and limits' && issue.population === 'EMPLOYER'));
const salaryFrequency = planFor('Can an employer pay salary every two months?').issuePlan.issues;
assert.ok(salaryFrequency.some(issue => issue.subject === 'MOM salary payment frequency and statutory deadline' && issue.population === 'EMPLOYER'));
const twoMonthlySalaryDue = planFor('Our payroll vendor says CPF contributions for June are due on 14 July. What is the contribution due date and what is the 14th?').issuePlan.issues;
assert.ok(twoMonthlySalaryDue.some(issue => issue.domain === 'CPF_PAYROLL' &&
  issue.operation === 'FILING_REQUIREMENT' && issue.population === 'EMPLOYER' &&
  issue.mappedTopicIds.includes('cpf-contribution-due-dates') &&
  !issue.mappedTopicIds.includes('cpf_contribution_rates')),
  'CPF contribution due-date questions remain separate from age-rate selection.');

const fourMonthSickLeave = planFor('A covered employee has four completed months of service and a medical certificate for hospitalisation. How much paid sick leave can they have?').issuePlan.issues;
assert.ok(fourMonthSickLeave.some(issue => issue.domain === 'MOM_EMPLOYMENT' &&
  issue.population === 'EMPLOYEE' && issue.mappedTopicIds.includes('mom_sick_leave')),
  'A stated completed service period maps to the employee leave entitlement without losing its party.');

const dismissalAndPayslip = planFor('We dismissed an employee for misconduct, but payroll cannot release final salary on that day. How soon must we pay, and when is a payslip due?').issuePlan.issues;
assert.ok(dismissalAndPayslip.some(issue => /final salary payment deadlines/i.test(issue.subject) &&
  issue.operation === 'FILING_REQUIREMENT' && issue.mappedTopicIds.includes('mom-salary-payment')) &&
  dismissalAndPayslip.some(issue => /itemised payslip issue and delivery/i.test(issue.subject) &&
    issue.operation === 'EXPLAIN_RULE' && issue.mappedTopicIds.includes('mom-itemised-payslips')),
  'Final-pay and payslip obligations retain distinct evidence issues in one request.');
const dismissalFinalSalaryAmount = planFor('We dismissed an employee for misconduct. How much final salary must we pay, and when is a payslip due?').issuePlan.issues;
assert.ok(dismissalFinalSalaryAmount.some(issue => issue.operation === 'CALCULATE' &&
  issue.mappedTopicIds.length === 1 && issue.mappedTopicIds.includes('mom-salary-payment')),
  'A final-salary amount request keeps only the salary topic in its CALCULATE issue.');
assert.ok(dismissalFinalSalaryAmount.some(issue => /itemised payslip issue and delivery/i.test(issue.subject) &&
  issue.operation === 'EXPLAIN_RULE' && issue.mappedTopicIds.includes('mom-itemised-payslips')) &&
  !dismissalFinalSalaryAmount.some(issue => /Final salary payment deadlines by termination reason/i.test(issue.subject)),
  'A separately requested payslip deadline is mapped without turning a salary amount request into a final-pay timing answer.');
for (const query of [
  'How much final wages do we owe after resignation, and when must we issue the payslip?',
  'What amount of final salary do we owe after resignation, and when must we issue the payslip?',
  'Calculate the final pay after termination and explain payslip delivery.',
  'After an employee resigns, how much final salary do we owe, and when must we issue the itemised payslip?',
  'After an employee resigns, how much final salary do we owe, and how must we deliver the itemised payslip?',
  'After an employee resigns, how much final salary do we owe, and must we issue an itemised payslip?',
  'An employee resigned after giving notice. How much final salary do we owe, and when must we issue the itemised payslip?',
  'An employee resigned without notice. How much final salary do we owe, and when must we issue the itemised payslip?',
  'We terminated an employee. How much final salary do we owe, and when must we issue the itemised payslip?',
  'We dismissed an employee for misconduct. How much final salary do we owe, and when must we issue the itemised payslip?'
]) {
  const result = planFor(query);
  const issues = result.issuePlan.issues;
  assert.ok(issues.some(issue => issue.operation === 'CALCULATE' &&
    issue.mappedTopicIds.length === 1 && issue.mappedTopicIds.includes('mom-salary-payment')),
    `Only final salary is assigned CALCULATE: ${query}`);
  assert.ok(issues.some(issue => /itemised payslip issue and delivery/i.test(issue.subject) &&
    issue.operation === 'EXPLAIN_RULE' && issue.mappedTopicIds.length === 1 &&
    issue.mappedTopicIds.includes('mom-itemised-payslips')),
    `Payslip timing remains an independently answerable rule: ${query}`);
  assert.ok(result.classification.missingFacts.includes(
    'Contractual salary rate for final salary calculation'));
  assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: result.issuePlan,
    classification: result.classification, explicitIrasEvidenceRequest: false, hasImages: false }), true,
  `The evidence path presents the payslip duty even when salary calculation facts are absent: ${query}`);
  assert.equal(result.classification.journalEntryRequired, false,
    'A statutory final-salary amount request alone does not request a journal entry.');
}
const calculatedSalaryWithPayslip = planFor(
  'After an employee resigns, calculate the final salary we owe and when must we issue the itemised payslip?');
assert.ok(calculatedSalaryWithPayslip.issuePlan.issues.some(issue => issue.operation === 'CALCULATE' &&
  issue.mappedTopicIds.length === 1 && issue.mappedTopicIds.includes('mom-salary-payment')),
  'Calculate wording keeps the final-salary issue as a calculation.');
assert.ok(calculatedSalaryWithPayslip.issuePlan.issues.some(issue => issue.operation === 'EXPLAIN_RULE' &&
  issue.mappedTopicIds.length === 1 && issue.mappedTopicIds.includes('mom-itemised-payslips')),
  'Calculate wording still separates an independently requested payslip rule.');
const salaryWithPayslipContext = planFor(
  'After an employee resigns, how much final salary do we owe? The itemised payslip was issued yesterday.').issuePlan.issues;
assert.ok(!salaryWithPayslipContext.some(issue => issue.mappedTopicIds.includes('mom-itemised-payslips')),
  'A past payslip mention does not become a separately requested obligation.');
const missingSalaryFactsWithPayslip = planFor(
  'After an employee resigns, how much final salary do we owe, and when must we issue the itemised payslip?');
assert.equal(missingSalaryFactsWithPayslip.classification.calculationRequired, true,
  'The amount request remains a calculation despite unspecified payroll facts.');
assert.ok(missingSalaryFactsWithPayslip.classification.missingFacts.includes(
  'Contractual salary rate for final salary calculation'));
assert.ok(missingSalaryFactsWithPayslip.issuePlan.issues.some(issue =>
  issue.operation === 'EXPLAIN_RULE' && issue.mappedTopicIds.includes('mom-itemised-payslips')),
  'Missing salary calculation facts do not suppress the separately answerable payslip rule.');
const salaryOnlyCalculation = planFor('How much final salary do we owe after resignation?');
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: salaryOnlyCalculation.issuePlan,
  classification: salaryOnlyCalculation.classification, explicitIrasEvidenceRequest: false, hasImages: false }), false,
  'A lone final-salary calculation keeps its existing transaction path.');
const specifiedSalaryWithPayslip = planFor(
  'An employee earns S$5,000 per month. After resignation, how much final salary do we owe and when must we issue the itemised payslip?');
assert.ok(!specifiedSalaryWithPayslip.classification.missingFacts.includes(
  'Contractual salary rate for final salary calculation'),
  'An explicitly stated salary rate does not receive the missing-salary-rate fact.');
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: specifiedSalaryWithPayslip.issuePlan,
  classification: specifiedSalaryWithPayslip.classification, explicitIrasEvidenceRequest: false, hasImages: false }), true,
  'The evidence path can surface the payslip rule while the salary amount remains case-specific.');
const journalWithMixedMOM = planFor(
  'After an employee resigns, how much final salary do we owe, when must we issue the payslip, and prepare the payroll journal entry.');
assert.equal(journalWithMixedMOM.classification.journalEntryRequired, true);
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: journalWithMixedMOM.issuePlan,
  classification: journalWithMixedMOM.classification, explicitIrasEvidenceRequest: false, hasImages: false }), false,
  'An explicit journal request stays outside the statutory evidence route.');
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: missingSalaryFactsWithPayslip.issuePlan,
  classification: missingSalaryFactsWithPayslip.classification, explicitIrasEvidenceRequest: false, hasImages: true }), false,
  'Image requests stay outside the bounded final-salary evidence route.');
const saleAndFinalSalary = planFor(
  'We sold goods for S$10,000. After an employee resigns, how much final salary do we owe and when must we issue the payslip?');
assert.equal(saleAndFinalSalary.classification.journalEntryRequired, true,
  'The independent sale retains its journal requirement beside the statutory calculation.');
const saleJournalIssue = saleAndFinalSalary.issuePlan.issues.find(issue =>
  issue.domain === 'ACCOUNTING' && issue.operation === 'PREPARE_JOURNAL');
assert.ok(saleJournalIssue, 'The accounting obligation remains in the plan that reaches the answer renderer.');
assert.equal(saleJournalIssue.status, 'UNRESOLVED', 'An incomplete sale does not manufacture a journal.');
assert.deepEqual(saleJournalIssue.mappedTopicIds, [], 'The accounting gap does not invent a source mapping.');
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: saleAndFinalSalary.issuePlan,
  classification: saleAndFinalSalary.classification, explicitIrasEvidenceRequest: false, hasImages: false }), true,
  'The payslip rule is resolved beside the retained accounting gap.');
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: saleAndFinalSalary.issuePlan,
  classification: saleAndFinalSalary.classification, explicitIrasEvidenceRequest: false, hasImages: true }), false,
  'The mixed accounting gap cannot admit an image request to the bounded MOM route.');
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: saleAndFinalSalary.issuePlan,
  classification: { ...saleAndFinalSalary.classification, taxAnalysisRequired: true },
  explicitIrasEvidenceRequest: true, hasImages: false }), false,
  'An actual tax-analysis obligation cannot be bypassed by the mixed MOM route.');
const salePlanWithoutJournal = structuredClone(saleAndFinalSalary.issuePlan);
salePlanWithoutJournal.issues = salePlanWithoutJournal.issues.filter(issue => issue.id !== saleJournalIssue.id);
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: salePlanWithoutJournal,
  classification: saleAndFinalSalary.classification, explicitIrasEvidenceRequest: false, hasImages: false }), false,
  'Classification alone cannot route the sale through a plan that discarded its accounting obligation.');
const deductionWithMixedMOM = planFor(
  'After an employee resigns, how much final salary do we owe, when must we issue the itemised payslip, and can we deduct S$400 for a uniform?');
assert.ok(deductionWithMixedMOM.issuePlan.issues.some(issue => /salary deduction/i.test(issue.subject) &&
  issue.operation === 'EXPLAIN_RULE' && issue.population === 'EMPLOYER'),
  'A S$400 deduction request remains a separate MOM rule issue.');
assert.ok(deductionWithMixedMOM.classification.missingFacts.includes(
  'Contractual salary rate for final salary calculation'),
  'An unrelated deduction amount does not satisfy the final-salary basis.');
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: deductionWithMixedMOM.issuePlan,
  classification: deductionWithMixedMOM.classification, explicitIrasEvidenceRequest: false, hasImages: false }), true,
  'The bounded evidence path still presents the payslip rule beside the salary calculation and deduction issue.');
const mixedMomMarkedForIrasByClassifier = shouldUseAuthorityEvidenceRuntime({
  issuePlan: deductionWithMixedMOM.issuePlan,
  classification: { ...deductionWithMixedMOM.classification, taxAnalysisRequired: true },
  explicitIrasEvidenceRequest: true,
  hasImages: false
});
assert.equal(mixedMomMarkedForIrasByClassifier, false,
  'The bounded MOM route rejects an explicit IRAS tax-analysis request even if the planned issues are all MOM.');
const explicitIrasTaxQuery = planFor(
  'After an employee resigns without notice, how much final salary do we owe, when must we issue the itemised payslip, and what tax must we withhold from the final pay for IRAS?');
assert.equal(explicitIrasTaxQuery.classification.taxAnalysisRequired, true,
  'The negative control is recognized as an explicit tax-analysis request.');
assert.equal(shouldUseAuthorityEvidenceRuntime({ issuePlan: explicitIrasTaxQuery.issuePlan,
  classification: explicitIrasTaxQuery.classification, explicitIrasEvidenceRequest: true, hasImages: false }), false,
  'An explicit IRAS tax question does not enter the bounded MOM-only evidence route.');
const salaryDeductionWithMixedMOM = planFor(
  'After an employee resigns, how much final salary do we owe, when must we issue the payslip, and can we deduct a uniform cost?').issuePlan.issues;
assert.ok(salaryDeductionWithMixedMOM.some(issue => /salary deduction/i.test(issue.subject) &&
  issue.operation === 'EXPLAIN_RULE' && issue.mappedTopicIds.includes('mom-salary-payment')),
  'A separate salary deduction rule survives a final-salary calculation and payslip obligation.');
const dismissalAndUniformDeduction = planFor('We dismissed an employee for misconduct. When is final salary due, when must we give a payslip, and can we deduct a uniform cost?').issuePlan.issues;
assert.ok(dismissalAndUniformDeduction.some(issue => /salary deduction/i.test(issue.subject) &&
  issue.mappedTopicIds.includes('mom-salary-payment')),
  'A requested salary deduction issue survives the independent final-pay and payslip timing clauses.');
assert.ok(dismissalAndUniformDeduction.some(issue => /Final salary payment deadlines by termination reason/i.test(issue.subject) &&
  issue.operation === 'FILING_REQUIREMENT') &&
  dismissalAndUniformDeduction.some(issue => /itemised payslip issue and delivery/i.test(issue.subject) &&
    issue.operation === 'EXPLAIN_RULE'),
  'Explicit final-pay and payslip timing requests are appended while retaining the independent deduction issue.');
const payslipRetention = planFor('For current employees and a former employee, how long must we keep itemised payslip records, and may we keep them electronically?').issuePlan.issues;
assert.ok(payslipRetention.some(issue => /itemised payslip content, delivery format and retention/i.test(issue.subject) && issue.population === 'EMPLOYER'));

const cpfRectification = planFor('We incorrectly declared an employee’s wages for the contribution month. How can the employer correct the CPF record and request a refund or adjustment?').issuePlan.issues;
assert.ok(cpfRectification.some(issue => issue.subject === 'CPF contribution wage-record rectifications and refund or adjustment options' &&
  issue.population === 'EMPLOYER' && issue.mappedTopicIds.includes('cpf-record-rectifications')));
const cpfAwCeiling = planFor('For CPF Additional Wages, can we keep our estimated annual ceiling unchanged in December if the employee’s actual Ordinary Wages turn out higher?').issuePlan.issues;
assert.ok(cpfAwCeiling.some(issue => issue.subject === 'CPF additional wage ceiling and year-end recalculation' &&
  issue.mappedTopicIds.some(topicId => ['cpf-additional-wages', 'cpf-additional-wage-ceiling'].includes(topicId))),
  'actual Ordinary Wages in an Additional Wage ceiling question still route to the year-end recalculation rule');
assert.ok(!cpfAwCeiling.some(issue => issue.mappedTopicIds.includes('cpf-record-rectifications')),
  'a ceiling recalculation is not mistaken for a wage-record correction');

const vcfmForms = planFor('Our VCFM appointed a director and changed a shareholder. What Form 23A notice is required? We also stopped a regulated activity; what Form 7 notice and customer-obligation certification apply?').issuePlan.issues;
assert.ok(vcfmForms.some(issue => issue.subject === 'VCFM Form 23A change-in-particulars notification' &&
  issue.mappedTopicIds.includes('mas-vcfm-change-notifications')));
assert.ok(vcfmForms.some(issue => issue.subject === 'VCFM Form 7 cessation and noncommencement notification' &&
  issue.mappedTopicIds.includes('mas-vcfm-business-cessation')));
assert.deepEqual(vcfmForms.find(issue => issue.subject === 'VCFM Form 23A change-in-particulars notification')?.mappedTopicIds,
  ['mas-vcfm-change-notifications'], 'the Form 23A source-backed issue owns only its mapped notification topic');
assert.deepEqual(vcfmForms.find(issue => issue.subject === 'VCFM Form 7 cessation and noncommencement notification')?.mappedTopicIds,
  ['mas-vcfm-business-cessation'], 'the Form 7 source-backed issue owns only its mapped notification topic');
assert.ok(!vcfmForms.some(issue => issue.subject === 'Venture Capital Fund Manager' &&
  issue.mappedTopicIds.includes('mas-vcfm')),
  'the named Form requests do not retain a duplicate generic VCFM context gap');

console.log('Statutory multipart issue refinements and exact IRAS source binding checks passed.');
