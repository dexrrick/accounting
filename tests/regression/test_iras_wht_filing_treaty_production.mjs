import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = mkdtempSync(path.join(tmpdir(), 'iras-wht-filing-production-'));
try {
  const generalTreatyQuestion = 'How do tax treaties affect withholding tax on payments to non-residents?';
  const genericTreatySubject = 'Effect of a tax treaty on withholding-tax applicability';
  const rulesOnlyIssuePlan = question => reconcileQuestionUnderstanding(question, classifyQuestion(question), {
    mode: 'DETERMINISTIC_FALLBACK'
  }).issuePlan;
  const genericFallbackPlan = rulesOnlyIssuePlan(generalTreatyQuestion);
  assert.equal(genericFallbackPlan.coverageEstablished, true,
    'the exact general treaty-effect question is reconciled as a complete bounded rule issue');
  assert.equal(genericFallbackPlan.hasUnmappedResidual, false);
  assert.equal(genericFallbackPlan.issues.length, 1);
  assert.equal(genericFallbackPlan.issues[0].subject, genericTreatySubject);
  for (const [id, question] of [
    ['zero-rate filing', 'If a treaty reduces withholding tax to zero, can we omit the WHT filing?'],
    ['named-treaty rent', 'Does the Singapore-Australia DTA exempt rent payments to non-residents from withholding tax?'],
    ['named-treaty director fees', 'Does the Singapore-Australia DTA exempt director fees paid to non-residents from withholding tax?'],
    ['lowercase named treaty', 'How does the singapore-australia dta affect withholding tax on payments to non-residents?']
  ]) {
    const plan = rulesOnlyIssuePlan(question);
    assert.equal(plan.issues.some(issue => issue.subject === genericTreatySubject), false,
      `${id} cannot enter the general treaty-effect fallback`);
    assert.equal(plan.coverageEstablished, false,
      `${id} cannot inherit complete-question coverage from the general fallback`);
  }

  const corpusPath = path.join(temporary, 'cases.json');
  const outputPath = path.join(temporary, 'answers.json');
  writeFileSync(corpusPath, JSON.stringify({ cases: [
    {
      id: 'wht-zero-treaty-filing', authority: 'IRAS', domain: 'IRAS_INCOME_TAX',
      question: 'If a treaty reduces withholding tax to zero, can we omit the WHT filing?',
      subject: 'Withholding tax filing requirement when treaty rate is zero',
      expectedScope: 'GENERAL_RULE',
      expected: ['Filing remains required despite zero rate under DTA/ARI; distinguish payment amount from filing duty'],
      forbidden: ['Zero WHT automatically removes filing duty']
    },
    {
      id: 'wht-general-treaty-effect', authority: 'IRAS', domain: 'IRAS_INCOME_TAX',
      question: 'How do tax treaties affect withholding tax on payments to non-residents?',
      subject: 'Effect of a tax treaty on withholding-tax applicability',
      expectedScope: 'GENERAL_RULE',
      expected: ['The applicable treaty and payment category affect the result; recipient residence and permanent-establishment facts may matter; no universal exemption'],
      forbidden: ['Every payment is exempt', 'A specific treaty rate without the recipient jurisdiction and payment type']
    },
    {
      id: 'wht-service-location-control', authority: 'IRAS', domain: 'IRAS_INCOME_TAX',
      question: 'Does withholding tax apply to service fees paid to a non-resident company when work is performed in Singapore, and what if the services are supplied electronically from overseas?',
      subject: 'Withholding tax applicability for non-resident services by work location',
      expectedScope: 'GENERAL_RULE',
      expected: ['Singapore work can attract WHT; services supplied electronically from overseas are treated differently'],
      forbidden: ['A treaty result or rate for an unspecified payee residence and payment category']
    },
    {
      id: 'wht-specific-rent-treaty-control', authority: 'IRAS', domain: 'IRAS_INCOME_TAX',
      question: 'Does the Singapore-Australia DTA exempt rent payments to non-residents from withholding tax?',
      subject: 'Singapore-Australia DTA applicability to rent payments',
      expectedScope: 'GENERAL_RULE',
      expected: ['The rent-specific result under the named treaty remains unresolved without treaty-specific evidence'],
      forbidden: ['Rent payments are exempt under the Singapore-Australia DTA']
    },
    {
      id: 'wht-specific-director-fee-treaty-control', authority: 'IRAS', domain: 'IRAS_INCOME_TAX',
      question: 'Does the Singapore-Australia DTA exempt director fees paid to non-residents from withholding tax?',
      subject: 'Singapore-Australia DTA applicability to director fees',
      expectedScope: 'GENERAL_RULE',
      expected: ['The director-fee-specific result under the named treaty remains unresolved without treaty-specific evidence'],
      forbidden: ['Director fees are exempt under the Singapore-Australia DTA']
    },
    {
      id: 'wht-lowercase-named-treaty-control', authority: 'IRAS', domain: 'IRAS_INCOME_TAX',
      question: 'How does the singapore-australia dta affect withholding tax on payments to non-residents?',
      subject: 'Effect of a tax treaty on withholding-tax applicability',
      expectedScope: 'GENERAL_RULE',
      expected: ['A named treaty-specific conclusion remains unresolved without treaty-specific evidence'],
      forbidden: ['A treaty-specific outcome from generic passages']
    }
  ] }, null, 2));

  execFileSync(process.execPath, [
    path.join(root, 'node_modules/tsx/dist/cli.mjs'),
    path.join(root, 'scripts/evaluate_statutory_natural_20261027.mjs'),
    `--corpus=${corpusPath}`,
    `--source-manifests=${path.join(root, 'tests/fixtures/statutoryKnowledge20261027b')}`,
    `--out=${outputPath}`
  ], { cwd: root, stdio: 'pipe', timeout: 90_000 });

  const report = JSON.parse(readFileSync(outputPath, 'utf8'));
  assert.equal(report.outcomes.length, 6);
  assert.equal(report.networkRequests, 0);
  assert.equal(report.modelRequests, 0);
  const byId = id => report.outcomes.find(row => row.id === id);
  const issueFor = row => row.result.workstreams.flatMap(stream => stream.issues)
    .find(issue => issue.subject === row.subject);
  const treaty = byId('wht-zero-treaty-filing');
  const treatyIssue = issueFor(treaty);
  assert.equal(treaty.evidenceStatuses.find(stream => stream.authority === 'IRAS').evidenceStatus, 'VERIFIED',
    JSON.stringify(treatyIssue.gaps));
  assert.match(treaty.answer, /IRAS rule explanation:[\s\S]*WHT still must be filed when a DTA or ARI makes the rate zero/i);
  const dueUrl = 'https://www.iras.gov.sg/taxes/withholding-tax/withholding-tax-filing/withholding-tax-filing-and-payment-due-date';
  const dueSource = treatyIssue.sources.find(source => source.canonicalSourceUrl === dueUrl);
  assert.ok(dueSource, 'the filing conclusion cites the native IRAS due-date page');
  const dueClaims = treatyIssue.verifiedClaims.filter(claim => claim.recordId === dueSource.id);
  assert.equal(dueClaims.length, 6, 'all six source-backed WHT filing passages remain in one verified source group');
  assert.ok(dueClaims.some(claim => /WHT must be filed even if.*DTA.*ARI/i.test(claim.quote)));
  assert.ok(dueClaims.some(claim => /director's fees approved in arrears[\s\S]*director's fees approved in advance/i.test(claim.quote)));

  const treatyEffect = byId('wht-general-treaty-effect');
  const treatyEffectIssue = issueFor(treatyEffect);
  assert.equal(treatyEffect.evidenceStatuses.find(stream => stream.authority === 'IRAS').evidenceStatus, 'VERIFIED',
    JSON.stringify(treatyEffectIssue.gaps));
  assert.match(treatyEffect.answer, /DTA can change withholding-tax treatment for covered income[\s\S]*does not establish a blanket exemption/i);
  assert.match(treatyEffect.answer, /recipient’s tax residence[\s\S]*payment or income category[\s\S]*applicable treaty article/i);
  assert.match(treatyEffect.answer, /does not establish a treaty-specific rate or outcome for an unspecified payment/i);
  assert.doesNotMatch(treatyEffect.answer, /every payment.{0,40}exempt|all non-resident payments.{0,40}(?:0%|17%)/i);
  const servicesUrl = 'https://www.iras.gov.sg/taxes/withholding-tax/payments-to-non-resident-company/payments-that-are-subject-to-withholding-tax';
  const servicesSource = treatyEffectIssue.sources.find(source => source.canonicalSourceUrl === servicesUrl);
  assert.ok(servicesSource, 'the general treaty explanation cites the captured IRAS WHT payment scope page');
  const treatyClaims = treatyEffectIssue.verifiedClaims.filter(claim => claim.recordId === servicesSource.id);
  assert.equal(treatyClaims.length, 4, 'the general treaty explanation is backed by all four required treaty-effect passages');
  assert.ok(treatyClaims.some(claim => /provisions under the DTA apply/i.test(claim.quote)));
  assert.ok(treatyClaims.some(claim => /separate Article on Technical Services/i.test(claim.quote)));
  assert.ok(treatyClaims.some(claim => /may be reduced if relief is available under an applicable tax treaty/i.test(claim.quote)));

  const serviceControl = byId('wht-service-location-control');
  const serviceIssue = issueFor(serviceControl);
  assert.equal(serviceControl.evidenceStatuses.find(stream => stream.authority === 'IRAS').evidenceStatus, 'VERIFIED');
  assert.match(serviceControl.answer, /WHT applies to specified service and management fees paid to a non-resident company[\s\S]*work done in Singapore[\s\S]*supplied electronically from overseas/i);
  const serviceSource = serviceIssue.sources.find(source => source.canonicalSourceUrl === servicesUrl);
  assert.ok(serviceSource, 'service-specific control cites the captured IRAS payment scope page');
  const serviceClaims = serviceIssue.verifiedClaims.filter(claim => claim.recordId === serviceSource.id);
  assert.ok(serviceClaims.length >= 7, 'the service-specific applicability control retains the complete service source family');
  assert.ok(serviceClaims.some(claim => /services via electronic means from overseas/i.test(claim.quote)));

  for (const id of [
    'wht-specific-rent-treaty-control',
    'wht-specific-director-fee-treaty-control',
    'wht-lowercase-named-treaty-control'
  ]) {
    const specificOutcome = byId(id);
    assert.ok(specificOutcome, `${id} completes the full-application replay`);
    const irasStatus = specificOutcome.evidenceStatuses.find(stream => stream.authority === 'IRAS');
    assert.ok(irasStatus, `${id} has an IRAS evidence status`);
    assert.notEqual(irasStatus.evidenceStatus, 'VERIFIED', `${id} is not answered from generic treaty passages`);
    assert.match(specificOutcome.answer, /unresolved|incomplete|not verified/i,
      `${id} explicitly leaves the unsupported treaty outcome unresolved`);
    assert.doesNotMatch(specificOutcome.answer, /DTA can change withholding-tax treatment for covered income/i,
      `${id} does not reuse the general treaty-effect answer`);
  }

  const applicationCorpusPath = path.join(temporary, 'application-cases.json');
  const applicationOutputPath = path.join(temporary, 'application-answers.json');
  writeFileSync(applicationCorpusPath, JSON.stringify({ cases: [{
    id: 'wht-general-treaty-effect-process-accounting-query',
      question: generalTreatyQuestion
  }] }, null, 2));
  execFileSync(process.execPath, [
    path.join(root, 'node_modules/tsx/dist/cli.mjs'),
    path.join(root, 'scripts/evaluate_statutory_natural_20261027.mjs'),
    `--corpus=${applicationCorpusPath}`,
    `--source-manifests=${path.join(root, 'tests/fixtures/statutoryKnowledge20261027b')}`,
    `--out=${applicationOutputPath}`,
    '--entry=application', '--understanding=rules-only'
  ], { cwd: root, stdio: 'pipe', timeout: 90_000 });

  const applicationReport = JSON.parse(readFileSync(applicationOutputPath, 'utf8'));
  assert.equal(applicationReport.scope, 'APPLICATION_ENTRY_NATURAL_QUESTIONS_OFFLINE_NO_PROVIDER');
  assert.equal(applicationReport.entryRoute, 'processAccountingQuery(question, null, IFRS, undefined)');
  assert.equal(applicationReport.networkRequests, 0);
  assert.equal(applicationReport.modelRequests, 0);
  assert.deepEqual(applicationReport.blockedModelEndpoints, []);
  assert.equal(applicationReport.outcomes.length, 1);
  const applicationOutcome = applicationReport.outcomes[0];
  assert.equal(applicationOutcome.entryRoute, 'processAccountingQuery');
  const applicationIrasStatus = applicationOutcome.evidenceStatuses.find(stream => stream.authority === 'IRAS');
  assert.ok(applicationIrasStatus, `the normal application path presents the IRAS workstream: ${JSON.stringify(applicationOutcome)}`);
  assert.equal(applicationIrasStatus.evidenceStatus, 'VERIFIED', JSON.stringify({
    presentation: applicationOutcome.authorityEvidencePresentation,
    issuePlan: applicationOutcome.authorityWorkstreams?.issuePlan,
    workstreams: applicationOutcome.authorityWorkstreams?.workstreams?.map(stream => ({
      id: stream.id, evidenceStatus: stream.evidenceStatus, gaps: stream.gaps,
      issues: stream.issues.map(issue => ({ subject: issue.subject, gaps: issue.gaps }))
    }))
  }));
  assert.match(applicationOutcome.answer, /DTA can change withholding-tax treatment for covered income[\s\S]*does not establish a blanket exemption/i);
  assert.match(applicationOutcome.answer, /does not establish a treaty-specific rate or outcome for an unspecified payment/i);

  console.log('WHT treaty-effect, zero-rate filing, service-location and specific-outcome production replays passed.');
} finally {
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
  rmSync(temporary, { recursive: true, force: true });
}
