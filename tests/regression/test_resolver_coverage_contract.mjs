import assert from 'node:assert/strict';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { defaultQueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { getCoverageTopicsByIds } from '../../src/standards/coverageRegistry.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import { planAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';

const issue = (subject, domain, population, governingAuthority, contextualAuthorities = []) => ({
  subject,
  population,
  domain,
  governingAuthorities: [governingAuthority],
  contextualAuthorities,
  operation: 'EXPLAIN_RULE',
  mappedTopicIds: [],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE',
  confidence: 0.96
});

function reconcile(query, issues) {
  const authorities = [...new Set(issues.flatMap(item => item.governingAuthorities))];
  const domains = new Set(issues.map(item => item.domain));
  const populations = new Set(issues.map(item => item.population));
  const interpretation = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    authorityCandidates: authorities,
    contextualAuthorities: [],
    domain: domains.size === 1 ? issues[0].domain : 'UNKNOWN',
    population: populations.size === 1 ? issues[0].population : 'UNKNOWN',
    primarySubject: issues[0].subject,
    concepts: [{ concept: issues[0].subject, role: 'PRIMARY' }],
    requestedOperation: 'EXPLAIN_RULE',
    requiresUserSpecificFacts: false,
    factsExplicitlyProvided: [],
    confidence: 0.96,
    issues
  };
  const result = reconcileQuestionUnderstanding(query, classifyQuestion(query), {
    mode: 'SEMANTIC_INTERPRETATION',
    interpretation
  });
  return { result, interpretation };
}

function assertIssueMapped(row, expectedTopicIds) {
  const found = row.result.issuePlan.issues.find(candidate =>
    candidate.status === 'MAPPED' && candidate.subject === row.subject &&
    candidate.governingAuthorities.includes(row.authority));
  assert.ok(found, `${row.caseId}: expected mapped issue for ${row.subject}`);
  assert.ok(expectedTopicIds.some(id => found.mappedTopicIds.includes(id)),
    `${row.caseId}: ${row.subject} should map one of ${expectedTopicIds.join(', ')}, got ${found.mappedTopicIds.join(', ') || '(none)'}`);
  return found;
}

const checks = [];
const addCheck = (caseId, query, expectedTopics, issues, options = {}) => {
  checks.push({ caseId, query, expectedTopics, issues, ...options });
};

const personalRelief = subject => issue(subject, 'IRAS_INCOME_TAX', 'INDIVIDUAL', 'IRAS', ['CPF']);
const employerCpf = subject => issue(subject, 'CPF_PAYROLL', 'EMPLOYER', 'CPF');
const employeeCpf = subject => issue(subject, 'CPF_PAYROLL', 'EMPLOYEE', 'CPF');
const momPass = subject => issue(subject, 'MOM_EMPLOYMENT', 'EMPLOYER', 'MOM');
const corporateTax = subject => issue(subject, 'IRAS_INCOME_TAX', 'COMPANY', 'IRAS');
const acraCompliance = subject => issue(subject, 'ACRA_CORPORATE', 'COMPANY', 'ACRA');
const accounting = subject => issue(subject, 'ACCOUNTING', 'COMPANY', 'ACCOUNTING_STANDARDS');

const mixedCpfReliefQuery = 'For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?';
const reliefSubject = 'individual personal tax relief';
const employerSubject = 'employer payment and contribution into CPF';
addCheck('cpf-iras-mixed-frozen-case', mixedCpfReliefQuery, ['iras-individual-reliefs', 'cpf_contribution_rates'], [
  personalRelief(reliefSubject), employerCpf(employerSubject)
]);

addCheck('cpf-employer-payment-alone', 'How much must a Singapore employer pay into CPF for an employee?', ['cpf_contribution_rates'], [
  employerCpf('employer CPF contribution payment amount')
]);

addCheck('cpf-employee-contribution-alone', 'How much CPF should an employee contribute from monthly wages?', ['cpf_contribution_rates'], [
  employeeCpf('employee CPF contribution amount from wages')
]);

addCheck('cpf-personal-relief-alone', 'Can I claim personal tax relief on my compulsory CPF contributions?', ['iras-individual-reliefs'], [
  personalRelief('individual personal tax relief on compulsory CPF contributions')
]);

addCheck('cpf-employee-and-employer-amounts', 'What are the employee and employer CPF contribution amounts for this monthly wage?', ['cpf_contribution_rates'], [
  employeeCpf('employee CPF contribution amount'), employerCpf('employer CPF contribution amount')
]);

addCheck('cpf-contribution-and-corporate-tax-rate', 'How much must the employer contribute to CPF, and what is the corporate tax rate in Singapore?', ['cpf_contribution_rates', 'iras-cit-tax-rate'], [
  employerCpf('employer CPF contribution amount'), corporateTax('company corporate income tax rate')
]);

addCheck('cpf-background-does-not-route', 'The company pays CPF contributions as part of payroll; is employee salary expense tax deductible for corporate income tax?', ['iras-cit-deductibility'], [
  corporateTax('company tax treatment of employee salary expense tax deductibility')
], { disallowedWorkstreamAuthorities: ['CPF'] });

addCheck('mom-general-work-pass', 'What are the general work-pass requirements for a foreign employee in Singapore?', ['mom-work-passes-general'], [
  momPass('general work-pass requirements for a foreign employee')
]);

addCheck('mom-work-visa-pass-variant', 'What work visa/pass requirements apply to a foreign employee?', ['mom-work-passes-general'], [
  momPass('general work visa/pass requirements for a foreign employee')
]);

addCheck('mom-employment-pass-specific', 'What eligibility requirements apply to an Employment Pass?', ['mom-work-passes-employment-pass'], [
  momPass('Employment Pass eligibility requirements')
], { disallowedTopicIds: ['mom-work-passes-general'] });

addCheck('mom-s-pass-specific', 'What are the S Pass eligibility requirements?', ['mom-work-passes-s-pass'], [
  momPass('S Pass eligibility requirements')
], { disallowedTopicIds: ['mom-work-passes-general'] });

addCheck('mom-work-permit-specific', 'What are the requirements for a Work Permit?', ['mom-work-passes-work-permit'], [
  momPass('Work Permit requirements')
], { disallowedTopicIds: ['mom-work-passes-general'] });

addCheck('mom-background-does-not-route', 'A foreign employee works here; what CPF contributions must the employer make?', ['cpf_contribution_rates'], [
  employerCpf('employer CPF contribution obligation for a foreign employee')
], { disallowedWorkstreamAuthorities: ['MOM'], disallowedTopicIds: ['mom-work-passes-general'] });

addCheck('mom-cpf-compound', 'What are the general work-pass requirements for a foreign employee, and how much must the employer contribute to CPF?', ['mom-work-passes-general', 'cpf_contribution_rates'], [
  momPass('general work-pass requirements for a foreign employee'), employerCpf('employer CPF contribution amount')
]);

addCheck('acra-iras-compound', 'What is the ACRA annual return filing deadline and the company corporate tax filing deadline?', ['acra_annual-returns', 'iras-cit-filing-deadlines'], [
  acraCompliance('ACRA annual return filing deadline'), corporateTax('company corporate tax filing deadline')
]);

addCheck('accounting-tax-compound', 'How should an IFRS 16 lease liability be accounted for, and is the related lease expense tax deductible for a company?', ['sfrsi_leases', 'iras-cit-deductibility'], [
  accounting('accounting recognition and measurement of a lease liability under IFRS 16'), corporateTax('company tax deductibility of a lease expense')
]);

const failures = [];
let totalIssues = 0;
for (const row of checks) {
  const result = reconcile(row.query, row.issues);
  row.result = result.result;
  totalIssues += row.issues.length;
  const queryTopicIds = new Set(defaultQueryTopicResolver.decomposeQuery(row.query).topics.map(topic => topic.id));
  for (const topicId of row.expectedTopics) {
    if (!queryTopicIds.has(topicId)) failures.push(`${row.caseId}: raw query did not resolve ${topicId}`);
  }
  for (const expectedIssue of row.issues) {
    const candidate = row.result.issuePlan.issues.find(item => item.subject === expectedIssue.subject && item.governingAuthorities.includes(expectedIssue.governingAuthorities[0]));
    if (!candidate || candidate.status !== 'MAPPED' || !row.expectedTopics.some(topicId => candidate.mappedTopicIds.includes(topicId))) {
      failures.push(`${row.caseId}: requested issue did not map to expected coverage (${candidate?.unresolvedReason || candidate?.mappedTopicIds?.join(', ') || 'missing issue'})`);
    }
  }
  for (const topicId of row.disallowedTopicIds || []) {
    if (queryTopicIds.has(topicId)) failures.push(`${row.caseId}: unexpected specific/generic topic ${topicId}`);
  }
  const planned = planAuthorityWorkstreams(row.result.issuePlan);
  const requestedAuthorities = [...new Set(row.issues.map(item => item.governingAuthorities[0]))].sort();
  const plannedAuthorities = [...new Set(planned.map(workstream => workstream.authority))].sort();
  if (JSON.stringify(plannedAuthorities) !== JSON.stringify(requestedAuthorities)) {
    failures.push(`${row.caseId}: workstream set ${plannedAuthorities.join(', ') || '(none)'} differs from requested ${requestedAuthorities.join(', ')}`);
  }
  for (const authority of row.disallowedWorkstreamAuthorities || []) {
    if (planned.some(workstream => workstream.authority === authority)) failures.push(`${row.caseId}: contextual/background mention created ${authority} workstream`);
  }
  for (const expectedIssue of row.issues) {
    try {
      const mapped = assertIssueMapped({ ...row, subject: expectedIssue.subject, authority: expectedIssue.governingAuthorities[0] }, row.expectedTopics);
      const allowedDomain = expectedIssue.domain === 'ACCOUNTING' ? 'ACCOUNTING_' :
        expectedIssue.domain === 'CPF_PAYROLL' ? 'CPF_' :
          expectedIssue.domain === 'MOM_EMPLOYMENT' ? 'MOM_' :
            expectedIssue.domain === 'ACRA_CORPORATE' ? 'ACRA_' :
              expectedIssue.domain === 'IRAS_INCOME_TAX' && ['INDIVIDUAL', 'EMPLOYEE'].includes(expectedIssue.population)
                ? 'IRAS_INDIVIDUAL_TAX' : 'IRAS_CORPORATE_TAX';
      for (const topicId of mapped.mappedTopicIds) {
        const metadata = defaultQueryTopicResolver.resolveTopicIds([topicId])[0];
        if (metadata && !metadata.domainId.startsWith(allowedDomain)) failures.push(`${row.caseId}: ${expectedIssue.domain} issue leaked topic ${topicId} from ${metadata.domainId}`);
      }
    } catch (error) {
      failures.push(`${row.caseId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const genericMomCoverage = getCoverageTopicsByIds(['mom-work-passes-general'])[0];
assert.ok(genericMomCoverage, 'A generic MOM work-pass parent coverage topic is registered.');
assert.equal(genericMomCoverage.status, 'MISSING', 'Generic work-pass routing alone does not assert supported evidence coverage.');
assert.deepEqual(genericMomCoverage.sourceRecordIds, [], 'No source record is invented for the generic MOM parent.');
assert.equal(genericMomCoverage.actOrStandard, undefined, 'No statutory citation is invented for the generic MOM parent.');

if (failures.length > 0) {
  console.error(`Resolver coverage regressions failed: ${failures.length} assertions across ${checks.length} cases and ${totalIssues} requested issues.`);
  for (const failure of failures) console.error(`  - ${failure}`);
}
assert.deepEqual(failures, [], 'Resolver coverage and compound isolation regressions must pass.');
console.log(`Resolver coverage contract passed: ${checks.length} cases, ${totalIssues} requested issues.`);
