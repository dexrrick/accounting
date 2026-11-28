import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import {
  hasSpecificIrasWhtTreatyScope,
  isGeneralIrasWhtTreatyEffectQuestion
} from '../../src/retrieval/irasMasKnowledge20261027b.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = mkdtempSync(path.join(tmpdir(), 'iras-wht-filing-production-'));
try {
  const generalTreatyQuestion = 'How do tax treaties affect withholding tax on payments to non-residents?';
  const generalTreatyQuestions = [
    ['general treaty effect', generalTreatyQuestion],
    ['general scope qualifier', 'In general, how does a tax treaty affect withholding tax for non-resident payments?'],
    ['general purpose without jurisdiction', 'How do tax treaties for non-resident payments affect withholding tax?'],
    ['general non-resident company', 'How do tax treaties with a non-resident company affect withholding tax?']
  ];
  const genericTreatySubject = 'Effect of a tax treaty on withholding-tax applicability';
  const specificTreatyQuestions = [
    ['specific Article 12', 'How do tax treaties affect withholding tax on payments to non-residents under Article 12?'],
    ['named treaty with en dash', 'How does the Singapore–Australia DTA affect withholding tax on payments to non-residents?'],
    ['identify applicable treaties', 'Which tax treaties affect withholding tax on payments to non-residents?'],
    ['compare treaty effects', 'How do tax treaties compare in their effect on withholding tax on payments to non-residents?'],
    ['differentiate treaty effects', 'How do tax treaties differ in their effect on withholding tax on payments to non-residents?'],
    ['curly possessive treaty name', 'How does Australia’s tax treaty affect withholding tax on payments to non-residents?'],
    ['ASCII possessive treaty name', "How does Australia's tax treaty affect withholding tax on payments to non-residents?"],
    ['slash separated treaty name', 'How does the Singapore/Australia DTA affect withholding tax on payments to non-residents?'],
    ['plural tax treaties with country', 'How do tax treaties with Australia affect withholding tax on payments to non-residents?'],
    ['Hong Kong treaty scope', 'How do tax treaties with Hong Kong companies affect withholding tax on payments to non-residents?'],
    ['Australian company treaty scope', 'How do tax treaties with Australian companies affect withholding tax on payments to non-residents?'],
    ['singular Australian company treaty scope', 'How do tax treaties with an Australian company affect withholding tax on payments to non-residents?'],
    ['lowercase Australian company treaty scope', 'How do tax treaties with australian companies affect withholding tax on payments to non-residents?'],
    ['plural tax treaties between countries', 'How do tax treaties between the United Kingdom and Australia affect withholding tax on payments to non-residents?'],
    ['plural tax treaties for country', 'How do tax treaties for Australia affect withholding tax on payments to non-residents?'],
    ['lowercase treaty jurisdiction', 'How do tax treaties with australia affect withholding tax on payments to non-residents?'],
    ['accented treaty jurisdiction', 'How do tax treaties with Côte d’Ivoire affect withholding tax on payments to non-residents?']
  ];
  const rulesOnlyIssuePlan = question => reconcileQuestionUnderstanding(question, classifyQuestion(question), {
    mode: 'DETERMINISTIC_FALLBACK'
  }).issuePlan;
  for (const [id, question] of generalTreatyQuestions) {
    assert.equal(hasSpecificIrasWhtTreatyScope(question), false, `${id} does not name a jurisdiction or other specific scope`);
    assert.equal(isGeneralIrasWhtTreatyEffectQuestion(question), true, `${id} remains a general treaty-effect question`);
    const plan = rulesOnlyIssuePlan(question);
    assert.equal(plan.coverageEstablished, true, `${id} is reconciled as a complete bounded rule issue`);
    assert.equal(plan.hasUnmappedResidual, false, `${id} does not leave an unresolved residual`);
    assert.equal(plan.issues.length, 1);
    assert.equal(plan.issues[0].subject, genericTreatySubject);
  }
  assert.equal(isGeneralIrasWhtTreatyEffectQuestion(
    'What effect do tax treaties have on withholding tax on payments to non-residents?'), true,
  'a general effect paraphrase remains in scope');
  for (const [id, question] of [
    ['double taxation treaty phrase', 'How do double taxation treaties with Australia affect withholding tax?'],
    ['double tax treaty phrase', 'How do double tax treaties with Australia affect withholding tax?'],
    ['plural DTA with country', 'How do DTAs for Australia affect withholding tax?'],
    ['plural double tax agreement with country', 'How do double taxation agreements with Australia affect withholding tax?'],
    ['Hong Kong alias', 'How do tax treaties with Hong Kong affect withholding tax?'],
    ['Turkey alias', 'How do tax treaties with Turkey affect withholding tax?'],
    ['Czech Republic alias', 'How do tax treaties with the Czech Republic affect withholding tax?'],
    ['Macao alias', 'How do tax treaties with Macao affect withholding tax?'],
    ['Macau alias', 'How do tax treaties with Macau affect withholding tax?'],
    ['Australian recipient qualifier', 'How do tax treaties with Australian companies affect withholding tax?'],
    ['singular Australian company qualifier', 'How do tax treaties with an Australian company affect withholding tax?'],
    ['lowercase Australian recipient qualifier', 'How do tax treaties with australian companies affect withholding tax?']
  ]) {
    assert.equal(hasSpecificIrasWhtTreatyScope(question), true, `${id} has constrained treaty scope detection`);
    assert.equal(isGeneralIrasWhtTreatyEffectQuestion(question), false,
      `${id} is not misclassified as a fully covered general treaty question`);
  }
  for (const [id, question] of specificTreatyQuestions) {
    assert.equal(hasSpecificIrasWhtTreatyScope(question), true, `${id} retains its specific request scope`);
    assert.equal(isGeneralIrasWhtTreatyEffectQuestion(question), false,
      `${id} is not classified as a generally supported treaty-effect question`);
    const plan = rulesOnlyIssuePlan(question);
    assert.equal(plan.coverageEstablished, false, `${id} does not inherit complete-question coverage`);
    assert.equal(plan.hasUnmappedResidual, true, `${id} retains an unresolved request residual`);
    assert.equal(plan.issues.some(issue => issue.subject === genericTreatySubject), false,
      `${id} is not reduced to the general treaty-effect issue`);
    assert.ok(JSON.stringify(plan.issues).includes(question.replace(/[?]$/, '')),
      `${id} remains visible in the unresolved issue mapping`);
  }
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
  const independentFilingQuestion = 'In general, how does a tax treaty affect withholding tax for non-resident payments, and when is the WHT filing due?';
  const independentFilingPlan = rulesOnlyIssuePlan(independentFilingQuestion);
  assert.equal(independentFilingPlan.coverageEstablished, false,
    'general treaty coverage does not establish completeness for an added filing obligation');
  assert.equal(independentFilingPlan.hasUnmappedResidual, true,
    'the additional filing question remains an unresolved request residual');

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
  writeFileSync(applicationCorpusPath, JSON.stringify({ cases: [
    ...generalTreatyQuestions.map(([id, question]) => ({
      id: `wht-${id.replaceAll(' ', '-')}-process-accounting-query`, question
    })),
    ...specificTreatyQuestions.map(([id, question]) => ({ id: `wht-${id}-process-accounting-query`, question }))
  ] }, null, 2));
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
  assert.equal(applicationReport.outcomes.length, generalTreatyQuestions.length + specificTreatyQuestions.length);
  const byApplicationId = id => applicationReport.outcomes.find(row => row.id === id);
  for (const [id, question] of generalTreatyQuestions) {
    const applicationOutcome = byApplicationId(`wht-${id.replaceAll(' ', '-')}-process-accounting-query`);
    assert.equal(applicationOutcome.question, question, `${id} reaches the normal application entry with its original wording`);
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
  }

  for (const [id, question] of specificTreatyQuestions) {
    const outcome = byApplicationId(`wht-${id}-process-accounting-query`);
    assert.ok(outcome, `${id} reaches the normal application entry`);
    assert.equal(outcome.question, question, `${id} is retained verbatim as the requested scope`);
    assert.ok(outcome.authorityWorkstreams?.issuePlan, `${id} reaches the scoped evidence runtime`);
    assert.equal(outcome.authorityWorkstreams.issuePlan.coverageEstablished, false,
      `${id} does not establish complete application coverage`);
    assert.equal(outcome.authorityWorkstreams.issuePlan.hasUnmappedResidual, true,
      `${id} reports the unsupported portion as an unresolved residual`);
    assert.ok(outcome.authorityWorkstreams.issuePlan.issues.some(issue => issue.subject === question && issue.status === 'UNRESOLVED'),
      `${id} preserves its complete request as an unresolved issue`);
    const irasStatus = outcome.evidenceStatuses.find(stream => stream.authority === 'IRAS');
    assert.ok(irasStatus, `${id} retains an IRAS evidence status`);
    assert.notEqual(irasStatus?.evidenceStatus, 'VERIFIED',
      `${id} cannot receive verified treaty-specific conclusions from generic passages`);
    assert.match(outcome.answer, /incomplete|unresolved|not verified|evidence gap/i,
      `${id} explicitly reports the missing treaty-specific evidence`);
    assert.ok(outcome.answer.includes(question), `${id} keeps the requested treaty scope in the user-facing gap`);
    assert.doesNotMatch(outcome.answer, /DTA can change withholding-tax treatment for covered income/i,
      `${id} does not substitute the generic treaty-effect explanation`);
  }

  console.log('WHT treaty-effect, zero-rate filing, service-location and specific-outcome production replays passed.');
} finally {
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
  rmSync(temporary, { recursive: true, force: true });
}
