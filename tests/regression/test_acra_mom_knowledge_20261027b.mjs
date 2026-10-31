import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ACRA_MOM_KNOWLEDGE_RULES_20261027B,
  ACRA_MOM_KNOWLEDGE_SOURCE_CATALOG_20261027B,
  acraMomKnowledgePointers,
  getAcraMomKnowledgeEvidence,
  isAcraAuditExemptionContextRequest,
  hasAcraMomKnowledgeContradiction,
  selectAcraMomKnowledgeQuotes,
  supportAcraMomKnowledgeRule
} from '../../src/retrieval/acraMomKnowledge20261027b.ts';
import { hasPracticalExpansionContradiction, practicalExpansionPointers, supportPracticalExpansionRule } from '../../src/retrieval/practicalStatutoryExpansion.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import { loadStatutoryKnowledgeSources } from '../../scripts/load_statutory_knowledge_sources.mjs';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import { supportsAcraSmallCompanyAuditFacts } from '../../src/retrieval/momAcraMasCoverageRules.ts';
import { getAcraAnnualReturnDeadlineTablePassage, supportsAcraAnnualReturnDeadlineEvidence } from '../../src/retrieval/acraAnnualReturnFilingRule.ts';
import { defaultTargetDateResolver } from '../../src/retrieval/targetDateResolver.ts';
import { parseCompanyFyeDate } from '../../src/retrieval/companyFyeDate.ts';

const fixtureDir = new URL('../fixtures/statutoryKnowledge20261027b/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('acra-mom-source-manifest.json', fixtureDir), 'utf8'));
const fixtures = Object.fromEntries(manifest.sources.map(source => [source.fixture,
  readFileSync(new URL(source.fixture, fixtureDir), 'utf8')]));
const legacySalaryHtml = readFileSync(new URL('../statutoryCoverageSources/mom-final-salary.html', fixtureDir), 'utf8');

const newCompanyFinancialStatementQuestion = 'We formed a company with no operations. Can we omit financial statements from the annual return just because it is newly incorporated?';
const newCompanyFinancialStatementClassification = classifyQuestion(newCompanyFinancialStatementQuestion);
assert.equal(newCompanyFinancialStatementClassification.intent, 'STATUTORY_ADVISORY',
  'A new-company financial statement filing question is sent to statutory guidance.');
assert.equal(newCompanyFinancialStatementClassification.accountingAnalysisRequired, false,
  'The annual-return filing question is not mistaken for financial-statement accounting analysis.');
assert.ok(newCompanyFinancialStatementClassification.authorities.includes('ACRA'));
const negatedFinalPayCalculation = classifyQuestion(
  'Do not calculate final salary after resignation; only explain when the itemised payslip must be issued.');
assert.equal(negatedFinalPayCalculation.calculationRequired, false,
  'A negated final-salary calculation request stays negated through shared intent normalization.');
assert.equal(negatedFinalPayCalculation.journalEntryRequired, false,
  'A negated final-salary calculation does not create a journal obligation.');
for (const query of [
  'We bought goods for S$10,000 for our GST-registered business. Can we claim the input tax?',
  'We acquired an asset for S$10,000. Is it deductible for corporate income tax?'
]) {
  const classification = classifyQuestion(query);
  assert.equal(classification.intent, 'STATUTORY_ADVISORY',
    'Tax eligibility questions remain statutory advice even when they describe an acquisition.');
  assert.equal(classification.journalEntryRequired, false,
    'A tax claim question does not gain an unsolicited journal requirement from its transaction wording.');
  assert.equal(classification.calculationRequired, false,
    'A tax eligibility question does not become a transaction calculation merely because it contains an amount.');
}
const financialStatementAccountingClassification = classifyQuestion(
  'We need prepare financial statements for the annual return and record our lease under IFRS 16.');
assert.equal(financialStatementAccountingClassification.accountingAnalysisRequired, true,
  'A real accounting question mentioning an annual filing remains an accounting question.');
const newCompanyFinancialStatementPlan = reconcileQuestionUnderstanding(
  newCompanyFinancialStatementQuestion, newCompanyFinancialStatementClassification,
  { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }
).issuePlan;
const newCompanyFinancialStatementIssue = newCompanyFinancialStatementPlan.issues.find(issue =>
  issue.subject === 'ACRA financial statement preparation and filing exemptions');
assert.ok(newCompanyFinancialStatementIssue, 'The natural-language question maps to the existing ACRA source family.');
assert.equal(newCompanyFinancialStatementIssue.domain, 'ACRA_CORPORATE');
assert.deepEqual(newCompanyFinancialStatementIssue.mappedTopicIds, ['acra_financial_statements']);
assert.ok(newCompanyFinancialStatementIssue.contextualTopicIds?.includes('acra_annual-returns'),
  'The annual return is retained as context when no annual-return deadline or process is requested.');
const separateAnnualReturnQuestion = 'We are checking whether a new company can omit financial statements; separately, when must we file the annual return?';
const separateAnnualReturnPlan = reconcileQuestionUnderstanding(
  separateAnnualReturnQuestion, classifyQuestion(separateAnnualReturnQuestion),
  { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }
).issuePlan;
assert.ok(separateAnnualReturnPlan.issues.some(issue => issue.mappedTopicIds.includes('acra_annual-returns')),
  'A separate annual-return deadline request remains an independent mapped issue.');
assert.ok(!separateAnnualReturnPlan.issues.some(issue => issue.contextualTopicIds?.includes('acra_annual-returns')),
  'A separately phrased reverse-order annual-return deadline is not demoted to context.');
const separateAnnualReturnProcessQuestion = 'We formed a new company and need to know whether it must prepare financial statements. How do we file the annual return?';
const separateAnnualReturnProcessPlan = reconcileQuestionUnderstanding(
  separateAnnualReturnProcessQuestion, classifyQuestion(separateAnnualReturnProcessQuestion),
  { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }
).issuePlan;
assert.ok(separateAnnualReturnProcessPlan.issues.some(issue => issue.mappedTopicIds.includes('acra_annual-returns')),
  'A separate reverse-order annual-return filing process remains mapped.');

const financialStatementAndAgmQuestion = 'We formed a company with no operations. Can we omit financial statements just because it is newly incorporated? What AGM details must we declare in the annual return?';
const financialStatementAndAgmPlan = reconcileQuestionUnderstanding(
  financialStatementAndAgmQuestion, classifyQuestion(financialStatementAndAgmQuestion),
  { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }
).issuePlan;
assert.ok(financialStatementAndAgmPlan.issues.some(issue => issue.mappedTopicIds.includes('acra_agm')),
  'A separate AGM declaration request remains mapped alongside the financial-statement question.');
assert.ok(financialStatementAndAgmPlan.issues.some(issue => issue.mappedTopicIds.includes('acra_annual-returns')),
  'The annual-return part of a separate AGM declaration request remains mapped.');

const acra07MultipartQuestion = 'Our Singapore-incorporated company must file its statements and fits the category requiring a full set of financial statements in XBRL under the current ACRA taxonomy. We have two directors. Must we attach a PDF, and how many directors sign the directors statement?';
const acra07MultipartPlan = reconcileQuestionUnderstanding(
  acra07MultipartQuestion, classifyQuestion(acra07MultipartQuestion),
  { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }
).issuePlan;
assert.ok(acra07MultipartPlan.issues.some(issue => issue.mappedTopicIds.includes('acra_xbrl')),
  'The source-backed XBRL attachment question remains mapped in the director-signing multipart case.');
const imperativeSecondaryRequest = 'Can our company omit financial statements from the annual return just because it is newly incorporated? Also explain how to file it.';
const imperativeSecondaryPlan = reconcileQuestionUnderstanding(
  imperativeSecondaryRequest, classifyQuestion(imperativeSecondaryRequest),
  { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }
).issuePlan;
assert.ok(imperativeSecondaryPlan.issues.some(issue => issue.mappedTopicIds.includes('acra_financial_statements')),
  'An imperative second request keeps the full issue plan instead of activating the single-question rule.');
assert.ok(imperativeSecondaryPlan.issues.some(issue => issue.mappedTopicIds.includes('acra_annual-returns')),
  'The trailing filing-process request remains mapped after the first question mark.');

const cases = [
  {
    id: 'acra-officer-particulars', authority: 'ACRA', topicId: 'acra-annual-return-officer-particulars',
    query: 'From 20 October 2026, what officer particulars and CEO details must a company confirm when it files its annual returns?',
    subject: 'Annual returns officer particulars and CEO confirmation', source: 'acra-officer-particulars.txt',
    operation: 'FILING_REQUIREMENT', expected: ['20 October 2026', 'directors', 'chief executive officers', 'identification details', 'CEO role', 'companies limited by guarantee', 'member count']
  },
  {
    id: 'acra-annual-return-process', authority: 'ACRA', topicId: 'acra_annual-returns',
    query: 'How do I file a local company annual return in Bizfile and what should I check first?',
    subject: 'Annual return process and pre-filing checklist', source: 'acra-annual-return-steps.txt',
    operation: 'FILING_REQUIREMENT', expected: ['Corppass', 'registered office', 'officers', 'XBRL', 'AGM', 'overdue annual returns']
  },
  {
    id: 'acra-xbrl', authority: 'ACRA', topicId: 'acra_xbrl',
    query: 'Which XBRL template and financial statement attachments apply to smaller companies from 19 October 2026 onwards?',
    subject: 'XBRL filing template requirements by company type and size', source: 'acra-xbrl-requirements.txt',
    operation: 'FILING_REQUIREMENT', expected: ['Simplified XBRL', '$500,000', 'Full XBRL', 'section 201A', '19 October 2026', 'XBRL FSH']
  },
  {
    id: 'acra-financial-statement-exemption', authority: 'ACRA', topicId: 'acra_financial_statements',
    query: 'We formed a company with no operations. Can we omit financial statements from the annual return just because it is newly incorporated?',
    subject: 'ACRA financial statement preparation and filing exemptions', source: 'acra-xbrl-requirements.txt',
    operation: 'EXPLAIN_RULE', expected: ['All Singapore-incorporated companies must', 'unless exempted', 'section 201A', 'Solvent EPC']
  },
  {
    id: 'mom-annual-leave', authority: 'MOM', topicId: 'mom_annual_leave',
    query: 'How many days of statutory annual leave do Employment Act employees receive and how is leave prorated?',
    subject: 'Annual leave eligibility, minimum entitlement and pro-rating', source: 'mom-annual-leave.txt',
    operation: 'EXPLAIN_RULE', expected: ['3 months', '7 days', '14 days', 'completed months', 'one-half', 'unpaid leave', 'notice period']
  },
  {
    id: 'mom-sick-leave', authority: 'MOM', topicId: 'mom_sick_leave',
    query: 'What are the outpatient and hospitalisation leave limits and eligibility rules for an employee?',
    subject: 'Sick leave eligibility and annual entitlement by service period', source: 'mom-sick-leave.txt',
    operation: 'EXPLAIN_RULE', expected: ['3 months', '48 hours', '5 days', '15 days', '14 days', '60 days', 'includes']
  },
  {
    id: 'mom-public-holiday', authority: 'MOM', topicId: 'mom-public-holidays',
    query: 'What public holiday pay does an employee receive if required to work on the holiday?',
    subject: 'Public holiday entitlements, replacement days and pay for holiday work', source: 'mom-public-holidays.txt',
    operation: 'EXPLAIN_RULE', expected: ['11 paid public holidays', 'gross rate', 'basic rate', 'rest day', 'non-working day', 'without consent', 'approved unpaid leave', 'Part IV']
  },
  {
    id: 'mom-final-salary', authority: 'MOM', topicId: 'mom-salary-payment',
    query: 'When must employers pay final salary when employees resign, are dismissed, or their employment is terminated?',
    subject: 'Final salary deadlines for resignation, dismissal and employer termination', source: 'mom-final-salary.txt',
    operation: 'EXPLAIN_RULE', expected: ['last day of employment', 'within 7 days', '3 working days', 'tax clearance']
  }
];

const acraFilingCase = cases[3];
const acraFilingSource = manifest.sources.find(source => source.fixture === acraFilingCase.source);
const acraFilingIssue = {
  id: 'new-company-financial-statement-filing', subject: acraFilingCase.subject, population: 'Company',
  operation: 'EXPLAIN_RULE', evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: []
};
const acraFilingSourceRecord = {
  key: 'acra-financial-statement-requirements', title: acraFilingSource.pageTitle, publisher: 'ACRA',
  documentTitle: acraFilingSource.pageTitle, officialUrl: acraFilingSource.url,
  provenance: 'LIVE_EXTERNAL', validTo: undefined,
  claims: [{ text: fixtures[acraFilingCase.source], issueIds: [acraFilingIssue.id],
    supportKind: 'EXACT_SOURCE_QUOTE', provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: { recordId: 'record-acra-financial-statement-requirements',
      documentHash: createHash('sha256').update(fixtures[acraFilingCase.source]).digest('hex'),
      canonicalUrl: acraFilingSource.url, retrievedAt: '2026-10-27T00:00:00Z' } }]
};
const acraFilingStream = {
  authority: 'ACRA', domain: 'ACRA_CORPORATE', issues: [acraFilingIssue], sources: [acraFilingSourceRecord]
};
const acraFilingExplanation = getAcraMomKnowledgeEvidence(acraFilingCase.query, acraFilingStream, acraFilingIssue);
assert.ok(acraFilingExplanation, 'The matching ACRA source can answer the newly incorporated company filing question.');
assert.match(acraFilingExplanation.text, /newly incorporated or inactive status alone is not listed as an exemption/i);
assert.match(acraFilingExplanation.text, /all Companies Act section 201A conditions/i);
assert.equal(getAcraMomKnowledgeEvidence(acraFilingCase.query,
  { ...acraFilingStream, sources: [{ ...acraFilingSourceRecord, officialUrl: 'https://example.com' }] }, acraFilingIssue), undefined,
  'The ACRA filing rule cannot be rendered from an unrelated source URL.');

assert.equal(ACRA_MOM_KNOWLEDGE_RULES_20261027B.filter(rule => rule.authority === 'ACRA').length, 10);
assert.equal(ACRA_MOM_KNOWLEDGE_SOURCE_CATALOG_20261027B.filter(rule => rule.authority === 'ACRA').length, 10);
assert.equal(manifest.sources.length, 8, 'The new source package also includes the current ACRA secretary page for the existing secretary family.');

const acra31SourceRoot = new URL('../fixtures/statutoryKnowledge20261031/', import.meta.url);
const acra31Manifest = JSON.parse(readFileSync(new URL('source-manifest.json', acra31SourceRoot), 'utf8'));
const acra31Cases = [
  { id: 'agm-deadlines', authority: 'ACRA', topicId: 'acra_agm',
    query: 'Our private company FYE is 31 December 2025. What are the usual AGM deadlines if we are not exempt?',
    subject: 'ACRA AGM deadline and exemption requirements', fixture: 'acra-agm-native.html' },
  { id: 'annual-return-deadlines', authority: 'ACRA', topicId: 'acra_annual-returns',
    query: 'Our company FYE is 31 December 2025. When is the annual return due for a non-listed company?',
    subject: 'ACRA annual return filing deadline', fixture: 'acra-annual-return-deadlines-native.html' },
  { id: 'audit-exemption', authority: 'ACRA', topicId: 'acra_small_company',
    query: 'Our small private company meets two of the three small-company criteria this year and last year. Does it qualify for audit exemption?',
    subject: 'Small company audit exemption criteria', fixture: 'acra-audit-exemptions-native.html' },
  { id: 'fye-change', authority: 'ACRA', topicId: 'acra-entity-information-changes',
    query: 'Our FYE is 31 December and the AGM deadline has passed. Can we change FYE now to gain time before the annual return is filed?',
    subject: 'ACRA financial year end change restrictions and approval requirements', fixture: 'acra-fye-native.html' },
  { id: 'officer-update', authority: 'ACRA', topicId: 'acra-entity-information-changes',
    query: 'A director’s residential address changed. Can we leave the old address in Bizfile until next year’s annual return?',
    subject: 'ACRA company entity information update requirements', fixture: 'acra-updating-company-information-native.html' },
  { id: 'annual-return-eot', authority: 'ACRA', topicId: 'acra_annual-returns',
    query: 'We need up to two more months to file our annual return. Is an extension available?',
    subject: 'ACRA annual return extension of time requirements', fixture: 'acra-annual-return-extension-native.html' },
  { id: 'secretary-appointment', authority: 'ACRA', topicId: 'acra_company-secretary',
    query: 'We incorporated a Singapore private company on 15 March 2026 and have one resident director. By when must we appoint a company secretary, and may the sole director fill that role?',
    subject: 'ACRA company secretary appointment and sole-director requirements', fixture: 'acra-officers-native.html' },
  { id: 'xbrl-current', authority: 'ACRA', topicId: 'acra_xbrl',
    query: 'Our Singapore-incorporated company files a full set of financial statements in XBRL under the current ACRA taxonomy. Must we attach a PDF?',
    subject: 'ACRA XBRL financial statement filing requirements and exemptions', fixture: 'acra-xbrl-native.html' }
];
for (const row of acra31Cases) {
  const source = acra31Manifest.sources.find(item => item.fixture === row.fixture);
  assert.ok(source, `${row.id}: current native ACRA source is retained in the 31 October manifest`);
  const sourceText = readFileSync(new URL(row.fixture, acra31SourceRoot), 'utf8');
  assert.equal(createHash('sha256').update(sourceText).digest('hex'), source.fixtureSha256, `${row.id}: current source bytes match their digest`);
  const request = { ...row, sourceText, officialUrl: source.url };
  assert.equal(supportAcraMomKnowledgeRule(request), true, `${row.id}: the current first-party source proves the requested ACRA rule`);
  assert.ok(selectAcraMomKnowledgeQuotes(request).length > 0, `${row.id}: issue quotations are selected from the matching source`);
}

const acra31AuditRow = acra31Cases.find(row => row.id === 'audit-exemption');
const acra31AuditManifestSource = acra31Manifest.sources.find(item => item.fixture === acra31AuditRow.fixture);
const acra31AuditNativeText = readFileSync(new URL(acra31AuditRow.fixture, acra31SourceRoot), 'utf8');
const ACRA_AUDIT_CONTEXT_HEADING = 'If your company is newly incorporated (less than two years old)';
const ACRA_AUDIT_CONTEXT_ELIGIBILITY = 'You qualify for audit exemption if you meet the criteria in the current financial year.';
const ACRA_AUDIT_GROUP_CONTEXT_HEADING = 'If your company is part of a group';
const ACRA_AUDIT_GROUP_CRITERIA = 'Your entire group (including foreign entities) meets at least two of these quantitative criteria for the immediate past two consecutive financial years:';
const acra31AuditContextRequest = {
  authority: acra31AuditRow.authority, topicId: acra31AuditRow.topicId, query: acra31AuditRow.query,
  subject: acra31AuditRow.subject, officialUrl: acra31AuditManifestSource.url
};
assert.equal(isAcraAuditExemptionContextRequest(acra31AuditContextRequest), true,
  'Hidden audit markup filtering is enabled only for the exact current ACRA audit-rule request.');
assert.equal(defaultTargetDateResolver.resolveAuthorityEvidenceDate(acra31AuditRow.query).dateRole,
  'CURRENT_WORKFLOW_FACT',
  'The current-versus-prior audit figures are classified centrally as facts for the current audit test.');
for (const historicalAuditQuestion of [
  'Which audit exemption rules applied last year?',
  'Which audit exemption rule applied for FY 2014?',
  'Which audit exemption rule applied before 1 July 2015?',
  'Our small private company meets two audit exemption criteria this year and last year; we also filed an annual return on 31 July 2025. Does it qualify?'
]) {
  assert.notEqual(defaultTargetDateResolver.resolveAuthorityEvidenceDate(historicalAuditQuestion).dateRole,
    'CURRENT_WORKFLOW_FACT',
    `Historical or independently dated filing intent keeps its date scope: ${historicalAuditQuestion}`);
}
const acra31AuditValidation = defaultExternalSourceValidator.validateTopicContent(acra31AuditNativeText, {
  standardIdentifiers: ['Accounting and Corporate Regulatory Authority', 'ACRA'],
  expectedTitles: [acra31AuditManifestSource.title], topicTerms: ['audit exemption', 'small company'],
  requireSubstantiveBody: true, preferMainContent: true,
  acraAuditExemptionContextRequest: acra31AuditContextRequest
});
assert.equal(acra31AuditValidation.isValid, true,
  'The registered ACRA audit request validates the current native page through production extraction.');
const acra31AuditRetainedText = acra31AuditValidation.substantiveText ?? '';
for (const label of ['If your company is newly incorporated (less than two years old)',
  'If your company is part of a group', 'Maintaining your exemption status', 'Frequently asked questions (FAQs)']) {
  assert.ok(acra31AuditRetainedText.includes(label), `The exact audit proof boundary is retained: ${label}`);
}
assert.match(acra31AuditRetainedText, /You qualify for audit exemption if you meet the criteria in the current financial year\./i,
  'The newly-incorporated heading is retained only with its same-section current-year eligibility paragraph.');
assert.doesNotMatch(acra31AuditRetainedText, /Detailed exemption criteria/,
  'Other standalone audit headings remain excluded from the retained evidence.');
const acra31AuditRetainedRequest = { ...acra31AuditRow, sourceText: acra31AuditRetainedText,
  officialUrl: acra31AuditManifestSource.url };
assert.equal(supportAcraMomKnowledgeRule(acra31AuditRetainedRequest), true,
  'The retained ACRA source passes complete audit-family proof after bounded context preservation.');
assert.ok(selectAcraMomKnowledgeQuotes(acra31AuditRetainedRequest).some(quote =>
  quote.includes('If your company is newly incorporated (less than two years old)')),
  'The exact retained conditional heading is available to source quotation selection.');
assert.equal(supportsAcraSmallCompanyAuditFacts(acra31AuditRetainedText), true,
  'The existing strict company-and-group audit proof passes on the same retained source record.');

function replaceInAuditMain(source, target, replacement, afterText = '') {
  const main = /<main\b[^>]*>[\s\S]*?<\/main\s*>/i.exec(source);
  assert.ok(main, 'The native audit fixture contains its main content boundary.');
  const offset = afterText ? main[0].indexOf(afterText) : 0;
  const targetAt = main[0].indexOf(target, Math.max(0, offset));
  assert.ok(targetAt >= 0, `The audit source contains the mutation target: ${target}`);
  const changedMain = main[0].slice(0, targetAt) + replacement + main[0].slice(targetAt + target.length);
  return source.slice(0, main.index) + changedMain + source.slice(main.index + main[0].length);
}

function mutateAuditMain(source, mutate) {
  const main = /<main\b[^>]*>[\s\S]*?<\/main\s*>/i.exec(source);
  assert.ok(main, 'The native audit fixture contains its main content boundary.');
  return source.slice(0, main.index) + mutate(main[0]) + source.slice(main.index + main[0].length);
}

function mutateAuditThresholdParagraph(source, occurrence, mutateParagraph) {
  return mutateAuditMain(source, mainMarkup => {
    const paragraphs = [...mainMarkup.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)]
      .filter(paragraph => /50 employees or fewer/i.test(paragraph[0]));
    assert.equal(paragraphs.length, 2, 'The visible main contains separate company and group employee-threshold paragraphs.');
    const paragraph = paragraphs[occurrence];
    assert.ok(paragraph, `The requested employee-threshold paragraph exists: ${occurrence}`);
    const start = paragraph.index ?? 0;
    return mainMarkup.slice(0, start) + mutateParagraph(paragraph[0]) + mainMarkup.slice(start + paragraph[0].length);
  });
}

function wrapFirstAuditDetails(source, prefix, suffix) {
  const main = /<main\b[^>]*>[\s\S]*?<\/main\s*>/i.exec(source);
  assert.ok(main, 'The native audit fixture contains its main content boundary.');
  const details = /<details\b[^>]*>[\s\S]*?<\/details\s*>/i.exec(main[0]);
  assert.ok(details, 'The native audit fixture contains the conditional details section.');
  const wrappedMain = main[0].replace(details[0], `${prefix}${details[0]}${suffix}`);
  return source.slice(0, main.index) + wrappedMain + source.slice(main.index + main[0].length);
}

for (const [label, changedSource] of [
  ['company employee threshold', replaceInAuditMain(acra31AuditNativeText, '50 employees or fewer', '150 employees or fewer')],
  ['group employee threshold', replaceInAuditMain(acra31AuditNativeText, '50 employees or fewer', '150 employees or fewer', ACRA_AUDIT_GROUP_CONTEXT_HEADING)],
  ['group revenue threshold', replaceInAuditMain(acra31AuditNativeText, '$10 million or less', '$11 million or less', ACRA_AUDIT_GROUP_CONTEXT_HEADING)],
  ['private-company polarity', replaceInAuditMain(acra31AuditNativeText,
    'Your company is a <b>private company</b> in the financial year',
    'Your company is not a <b>private company</b> in the financial year')],
  ['group eligibility polarity', replaceInAuditMain(acra31AuditNativeText,
    ACRA_AUDIT_GROUP_CRITERIA, 'Your entire group (including foreign entities) does not meet at least two of these quantitative criteria for the immediate past two consecutive financial years:')]
]) {
  const checked = defaultExternalSourceValidator.validateTopicContent(changedSource, {
    standardIdentifiers: ['Accounting and Corporate Regulatory Authority', 'ACRA'],
    expectedTitles: [acra31AuditManifestSource.title], topicTerms: ['audit exemption', 'small company'],
    requireSubstantiveBody: true, preferMainContent: true,
    acraAuditExemptionContextRequest: acra31AuditContextRequest
  });
  assert.equal(checked.isValid, true, `${label}: extraction does not use a mutated number or polarity as a topic identity shortcut`);
  const changedRequest = { ...acra31AuditRow, sourceText: checked.substantiveText ?? '',
    officialUrl: acra31AuditManifestSource.url };
  assert.equal(supportsAcraSmallCompanyAuditFacts(changedSource), false,
    `${label}: the existing exact company/group source proof rejects the mutation in native context`);
  assert.equal(supportsAcraSmallCompanyAuditFacts(changedRequest.sourceText), false,
    `${label}: the existing exact company/group source proof rejects the mutation in retained text`);
  assert.equal(supportAcraMomKnowledgeRule(changedRequest), false,
    `${label}: the ACRA rule proof also rejects the mutated retained source`);
  assert.deepEqual(selectAcraMomKnowledgeQuotes(changedRequest), [],
    `${label}: a mutated audit source cannot provide rendered quotations`);
}

function assertHiddenAuditThresholdRejected(label, source, expectedVisibleThresholdCount) {
  const checked = defaultExternalSourceValidator.validateTopicContent(source, {
    standardIdentifiers: ['Accounting and Corporate Regulatory Authority', 'ACRA'],
    expectedTitles: [acra31AuditManifestSource.title], topicTerms: ['audit exemption', 'small company'],
    requireSubstantiveBody: true, preferMainContent: true,
    acraAuditExemptionContextRequest: acra31AuditContextRequest
  });
  const retainedText = checked.substantiveText ?? '';
  assert.equal((retainedText.match(/50 employees or fewer/gi) || []).length, expectedVisibleThresholdCount,
    `${label}: hidden employee-threshold text is removed before retained source extraction.`);
  assert.equal(supportsAcraSmallCompanyAuditFacts(retainedText), false,
    `${label}: hidden employee evidence cannot satisfy the quantitative audit proof.`);
}

assertHiddenAuditThresholdRejected('hidden inline threshold spans', mutateAuditMain(acra31AuditNativeText, mainMarkup =>
  mainMarkup.replaceAll('50 employees or fewer', '<span aria-hidden="true">50 employees or fewer</span>')), 0);
assertHiddenAuditThresholdRejected('hidden company threshold paragraph', mutateAuditThresholdParagraph(
  acra31AuditNativeText, 0, paragraph => paragraph.replace('<p', '<p aria-hidden="true"')), 1);
assertHiddenAuditThresholdRejected('hidden group threshold container', mutateAuditThresholdParagraph(
  acra31AuditNativeText, 1, paragraph => `<div aria-hidden="true">${paragraph}</div>`), 1);

const auditHeadingOnlyValidation = defaultExternalSourceValidator.validateTopicContent(
  '<html><head><title>Audit exemptions: Small company concept | Accounting and Corporate Regulatory Authority</title></head><body><main><h1>Audit exemptions: Small company concept</h1><details><summary>If your company is newly incorporated (less than two years old)</summary></details><p>You qualify for audit exemption if you meet the criteria in the current financial year.</p><p>Accounting and Corporate Regulatory Authority audit exemption information for Singapore private companies includes enough visible body words to pass ordinary topic identity validation.</p></main></body></html>',
  { standardIdentifiers: ['Accounting and Corporate Regulatory Authority', 'ACRA'],
    expectedTitles: ['Audit exemptions: Small company concept'], topicTerms: ['audit exemption'],
    requireSubstantiveBody: true, preferMainContent: true, acraAuditExemptionContextRequest: acra31AuditContextRequest }
);
assert.doesNotMatch(auditHeadingOnlyValidation.substantiveText ?? '', /If your company is newly incorporated/,
  'An unattached newly-incorporated heading is not admitted as source context.');

const hiddenAuditSource = replaceInAuditMain(acra31AuditNativeText,
  '<summary class="focus-visible:', '<summary aria-hidden="true" class="focus-visible:');
const hiddenAuditValidation = defaultExternalSourceValidator.validateTopicContent(hiddenAuditSource, {
  standardIdentifiers: ['Accounting and Corporate Regulatory Authority', 'ACRA'],
  expectedTitles: [acra31AuditManifestSource.title], topicTerms: ['audit exemption', 'small company'],
  requireSubstantiveBody: true, preferMainContent: true,
  acraAuditExemptionContextRequest: acra31AuditContextRequest
});
assert.doesNotMatch(hiddenAuditValidation.substantiveText ?? '', /If your company is newly incorporated/,
  'A hidden conditional heading cannot lend audit eligibility context.');
assert.equal(supportsAcraSmallCompanyAuditFacts(hiddenAuditValidation.substantiveText ?? ''), false,
'The strict audit source proof rejects a hidden required boundary.');

const linkedAuditSource = replaceInAuditMain(acra31AuditNativeText,
  `>${ACRA_AUDIT_CONTEXT_HEADING}<svg`, `><a href="#">${ACRA_AUDIT_CONTEXT_HEADING}</a><svg`);
const linkedAuditValidation = defaultExternalSourceValidator.validateTopicContent(linkedAuditSource, {
  standardIdentifiers: ['Accounting and Corporate Regulatory Authority', 'ACRA'],
  expectedTitles: [acra31AuditManifestSource.title], topicTerms: ['audit exemption', 'small company'],
  requireSubstantiveBody: true, preferMainContent: true,
  acraAuditExemptionContextRequest: acra31AuditContextRequest
});
assert.doesNotMatch(linkedAuditValidation.substantiveText ?? '', /If your company is newly incorporated/,
  'A linked heading cannot lend audit eligibility context.');

const cardAuditSource = replaceInAuditMain(acra31AuditNativeText,
  '<details class="group mt-7', '<details class="related-card group mt-7');
const cardAuditValidation = defaultExternalSourceValidator.validateTopicContent(cardAuditSource, {
  standardIdentifiers: ['Accounting and Corporate Regulatory Authority', 'ACRA'],
  expectedTitles: [acra31AuditManifestSource.title], topicTerms: ['audit exemption', 'small company'],
  requireSubstantiveBody: true, preferMainContent: true,
  acraAuditExemptionContextRequest: acra31AuditContextRequest
});
assert.doesNotMatch(cardAuditValidation.substantiveText ?? '', /If your company is newly incorporated/,
  'A card-contained heading cannot lend audit eligibility context.');

for (const [label, sourceWithOuterAncestor] of [
  ['hidden outer ancestor', wrapFirstAuditDetails(acra31AuditNativeText, '<div aria-hidden="true">', '</div>')],
  ['linked outer ancestor', wrapFirstAuditDetails(acra31AuditNativeText, '<a href="#">', '</a>')],
  ['card outer ancestor', wrapFirstAuditDetails(acra31AuditNativeText, '<div class="related-card">', '</div>')]
]) {
  const checked = defaultExternalSourceValidator.validateTopicContent(sourceWithOuterAncestor, {
    standardIdentifiers: ['Accounting and Corporate Regulatory Authority', 'ACRA'],
    expectedTitles: [acra31AuditManifestSource.title], topicTerms: ['audit exemption', 'small company'],
    requireSubstantiveBody: true, preferMainContent: true,
    acraAuditExemptionContextRequest: acra31AuditContextRequest
  });
  assert.doesNotMatch(checked.substantiveText ?? '', /If your company is newly incorporated/,
    `An unsafe ${label} cannot lend audit heading context.`);
}

const duplicateAuditHeadingSource = replaceInAuditMain(acra31AuditNativeText,
  `</summary>`, `</summary><details><summary>${ACRA_AUDIT_CONTEXT_HEADING}</summary><p>${ACRA_AUDIT_CONTEXT_ELIGIBILITY}</p></details>`);
const duplicateAuditHeadingValidation = defaultExternalSourceValidator.validateTopicContent(duplicateAuditHeadingSource, {
  standardIdentifiers: ['Accounting and Corporate Regulatory Authority', 'ACRA'],
  expectedTitles: [acra31AuditManifestSource.title], topicTerms: ['audit exemption', 'small company'],
  requireSubstantiveBody: true, preferMainContent: true,
  acraAuditExemptionContextRequest: acra31AuditContextRequest
});
assert.doesNotMatch(duplicateAuditHeadingValidation.substantiveText ?? '', /If your company is newly incorporated/,
  'Duplicate copies of a conditional heading fail closed.');

const acra31AnnualReturnRow = acra31Cases.find(row => row.id === 'annual-return-deadlines');
const acra31AnnualReturnManifestSource = acra31Manifest.sources.find(item => item.fixture === acra31AnnualReturnRow.fixture);
const acra31AnnualReturnNativeText = readFileSync(new URL(acra31AnnualReturnRow.fixture, acra31SourceRoot), 'utf8');
for (const annualReturnQuery of [
  acra31AnnualReturnRow.query,
  'Our private non-listed company FYE is 31 December 2025. It has share capital and maintains an overseas branch register. When is the annual return due?'
]) {
  const checked = defaultExternalSourceValidator.validateTopicContent(acra31AnnualReturnNativeText, {
    standardIdentifiers: ['Accounting and Corporate Regulatory Authority', 'ACRA'],
    expectedTitles: ['Deadline & requirements for annual returns'], topicTerms: ['annual return', 'non-listed'],
    requireSubstantiveBody: true, preferMainContent: true, requireAcraAnnualReturnDeadlineTable: true
  });
  assert.equal(checked.isValid, true, 'The native ACRA annual-return deadline page passes production extraction.');
  const annualReturnRequest = { ...acra31AnnualReturnRow, query: annualReturnQuery,
    sourceText: checked.substantiveText ?? '', officialUrl: acra31AnnualReturnManifestSource.url };
  assert.equal(supportAcraMomKnowledgeRule(annualReturnRequest), true,
    'The actual retained ACRA record proves each annual-return deadline row and qualifier.');
  const annualReturnQuotes = selectAcraMomKnowledgeQuotes(annualReturnRequest);
  assert.ok(annualReturnQuotes.length > 0, 'The retained annual-return deadline record supplies exact source quotations.');
  const annualReturnTablePassage = getAcraAnnualReturnDeadlineTablePassage(checked.substantiveText ?? '');
  assert.ok(annualReturnTablePassage, 'The native annual-return source has one structurally complete table passage.');
  assert.ok(annualReturnQuotes.includes(annualReturnTablePassage),
    'The exact complete deadline table passage, including its header, is retained in the selected source quotes.');
  assert.equal(supportsAcraAnnualReturnDeadlineEvidence(annualReturnQuotes.join('\n\n')), true,
    'The selected exact quote set retains same-source filing context and all company-category deadline rows.');
  assert.ok(/[•◦▪]/.test(annualReturnQuotes.join('\n')),
    'Canonical bullet normalization is confined to proof matching; selected source quotations retain their original markers.');
  for (const [label, alteredRecord] of [
    ['wrong listed branch deadline', checked.substantiveText.replace(
      'Listed companies with: A share capital; An overseas branch register; | Within six months after FYE',
      'Listed companies with: A share capital; An overseas branch register; | Within seven months after FYE')],
    ['wrong non-listed branch deadline', checked.substantiveText.replace(
      'Non-listed companies with: A share capital; An overseas branch register; | Within eight months after FYE',
      'Non-listed companies with: A share capital; An overseas branch register; | Within seven months after FYE')],
    ['branch qualifier owned by the wrong row', checked.substantiveText.replace(
      'Listed companies with: A share capital; An overseas branch register; | Within six months after FYE',
      'Non-listed companies with: A share capital; An overseas branch register; | Within six months after FYE')]
  ]) {
    assert.notEqual(alteredRecord, checked.substantiveText, `${label}: the mutation changes a retained deadline row.`);
    const alteredRequest = { ...annualReturnRequest, sourceText: alteredRecord };
    assert.equal(supportAcraMomKnowledgeRule(alteredRequest), false,
      `${label}: the complete row-specific ACRA proof rejects the mutation.`);
    assert.deepEqual(selectAcraMomKnowledgeQuotes(alteredRequest), [],
      `${label}: a wrong or misattributed row cannot supply quotations.`);
  }
}

function renderAcra31Rule(row, query = row.query, retainedSourceText) {
  const manifestSource = acra31Manifest.sources.find(item => item.fixture === row.fixture);
  const sourceText = retainedSourceText ?? readFileSync(new URL(row.fixture, acra31SourceRoot), 'utf8');
  const issueId = `acra31-${row.id}`;
  const issue = { id: issueId, subject: row.subject, population: 'Company', operation: 'EXPLAIN_RULE',
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: [] };
  const sourceRecord = { key: issueId, title: manifestSource.title, publisher: 'ACRA', documentTitle: manifestSource.title,
    officialUrl: manifestSource.url, provenance: 'LIVE_EXTERNAL', validTo: undefined,
    claims: [{ text: sourceText, issueIds: [issueId], supportKind: 'EXACT_SOURCE_QUOTE', provenance: 'LIVE_EXTERNAL',
      fetchedSourceBinding: { recordId: `record-${issueId}`, documentHash: manifestSource.fixtureSha256,
        canonicalUrl: manifestSource.url, retrievedAt: '2026-10-31T00:00:00Z' } }] };
  return getAcraMomKnowledgeEvidence(query, { authority: 'ACRA', domain: 'ACRA_CORPORATE', issues: [issue], sources: [sourceRecord] }, issue);
}

for (const auditQuestion of [
  'What tests make a Singapore private company a small company for audit exemption?',
  'How many small company criteria must be met to qualify for audit exemption?',
  'Do the audit exemption thresholds have to be met for one year or two?',
  'What financial and employee measures are used for the small company audit test?'
]) {
  assert.ok(renderAcra31Rule(acra31Cases.find(row => row.id === 'audit-exemption'), auditQuestion),
    `The current native audit source supports the general query: ${auditQuestion}`);
}
const currentAuditAnswer = renderAcra31Rule(acra31Cases.find(row => row.id === 'audit-exemption'));
assert.ok(currentAuditAnswer, 'The current two-financial-year wording receives source-backed conditional guidance.');
assert.match(currentAuditAnswer.text, /private company in the financial year/i);
assert.match(currentAuditAnswer.text, /immediate past two consecutive financial years/i);
assert.match(currentAuditAnswer.text, /separate consolidated small-group criteria/i,
  'Meeting the company size test alone does not establish group eligibility.');
assert.match(currentAuditAnswer.text, /revenue no more than S\$10 million.*assets no more than S\$10 million.*50 full-time employees/i);
for (const [label, alteredAuditSource] of [
  ['company employee threshold', replaceInAuditMain(acra31AuditNativeText, '50 employees or fewer', '150 employees or fewer')],
  ['group employee threshold', replaceInAuditMain(acra31AuditNativeText, '50 employees or fewer', '150 employees or fewer', ACRA_AUDIT_GROUP_CONTEXT_HEADING)],
  ['group revenue threshold', replaceInAuditMain(acra31AuditNativeText, '$10 million or less', '$11 million or less', ACRA_AUDIT_GROUP_CONTEXT_HEADING)]
]) {
  assert.equal(renderAcra31Rule(acra31AuditRow, acra31AuditRow.query, alteredAuditSource), undefined,
    `${label}: a claim-bound rendered answer cannot rely on incomplete retained audit criteria.`);
}

const acra31XbrlRow = acra31Cases.find(row => row.id === 'xbrl-current');
const acra31XbrlSource = acra31Manifest.sources.find(item => item.fixture === acra31XbrlRow.fixture);
const acra31XbrlNativeText = readFileSync(new URL(acra31XbrlRow.fixture, acra31SourceRoot), 'utf8');
const acra31XbrlValidation = defaultExternalSourceValidator.validateTopicContent(acra31XbrlNativeText, {
  standardIdentifiers: ['Accounting and Corporate Regulatory Authority', 'ACRA'],
  expectedTitles: [acra31XbrlSource.title],
  topicTerms: ['financial statements', 'simplified XBRL', 'solvent exempt private company'],
  requireSubstantiveBody: true,
  preferMainContent: true
});
assert.equal(acra31XbrlValidation.isValid, true,
  'The retained native ACRA XBRL page passes production topic validation.');
const acra31XbrlRetainedText = acra31XbrlValidation.substantiveText ?? '';
assert.match(acra31XbrlRetainedText, /XBRL filing requirements \(from 19 October 2026 onwards\)/i,
  'The rule-bearing p inside the native XBRL table retains the technical effective date.');
assert.match(acra31XbrlRetainedText, /Smaller and non-publicly accountable companies/i);
assert.match(acra31XbrlRetainedText, /Solvent EPCs which voluntarily choose to file/i);
assert.match(acra31XbrlRetainedText, /All other Singapore-incorporated companies/i);
assert.doesNotMatch(acra31XbrlRetainedText, /Types of XBRL templates/,
  'Standalone headings remain outside the extracted rule-bearing evidence.');
const standaloneHeadingOnly = defaultExternalSourceValidator.validateTopicContent(
  '<html><head><title>Financial statements filing requirements</title></head><body><main><h1>Financial statements filing requirements</h1><h2>Solvent exempt private companies do not need to file financial statements when eligible under ACRA rules.</h2></main></body></html>',
  { standardIdentifiers: ['ACRA'], expectedTitles: ['Financial statements filing requirements'],
    topicTerms: ['solvent exempt private companies'], requireSubstantiveBody: true }
);
assert.equal(standaloneHeadingOnly.isValid, false,
  'A standalone heading cannot substantiate a source when its body is empty.');
const retainedXbrlRequest = { ...acra31XbrlRow, sourceText: acra31XbrlRetainedText,
  officialUrl: acra31XbrlSource.url };
assert.equal(supportAcraMomKnowledgeRule(retainedXbrlRequest), true,
  'The extracted and retained ACRA source still proves the full XBRL rule.');
assert.ok(selectAcraMomKnowledgeQuotes(retainedXbrlRequest).length > 0,
  'Source quotations are selected from validated retained text.');
const retainedXbrlAnswer = renderAcra31Rule(acra31XbrlRow, acra31XbrlRow.query, acra31XbrlRetainedText);
assert.ok(retainedXbrlAnswer, 'Validated retained native source reaches the evidence presentation path.');

const acra31AgmAnswer = renderAcra31Rule(acra31Cases.find(row => row.id === 'agm-deadlines'));
assert.ok(acra31AgmAnswer);
assert.match(acra31AgmAnswer.text, /linked AGM extension-of-time page/i);
assert.doesNotMatch(acra31AgmAnswer.text, /60-day extension/i,
  'The AGM deadline page does not support borrowing the annual-return extension duration.');

const secretaryDateQuestion = 'We incorporated a Singapore private company on 15 March 2026 and have one resident director. By when must we appoint a company secretary, and may the sole director fill that role?';
const secretaryDateAnswer = renderAcra31Rule(acra31Cases.find(row => row.id === 'secretary-appointment'), secretaryDateQuestion);
assert.ok(secretaryDateAnswer, 'A current owned incorporation date supports the secretary appointment calculation.');
assert.match(secretaryDateAnswer.text, /six-month appointment deadline on 15\/09\/2026/,
  'The secretary deadline is calculated from the stated valid incorporation date.');
for (const invalidDate of ['31 February 2026', '29 February 2026']) {
  const invalidQuestion = `We incorporated a Singapore private company on ${invalidDate}. By when must we appoint a company secretary?`;
  assert.equal(renderAcra31Rule(acra31Cases.find(row => row.id === 'secretary-appointment'), invalidQuestion), undefined,
    `Invalid date ${invalidDate} is not normalized into a different registration date.`);
}
const disownedSecretaryDate = 'We have not incorporated our company; another company was registered on 15 March 2026. By when must we appoint our company secretary?';
assert.equal(renderAcra31Rule(acra31Cases.find(row => row.id === 'secretary-appointment'), disownedSecretaryDate), undefined,
  'An unrelated company registration date is not borrowed for the queried company.');

const currentArDeadlineQuestion = 'Our company FYE is 31/12/2025. When is the annual return due for a non-listed company?';
const currentArDeadlineAnswer = renderAcra31Rule(acra31Cases.find(row => row.id === 'annual-return-deadlines'), currentArDeadlineQuestion);
assert.ok(currentArDeadlineAnswer, 'A single company FYE and listing status support a current annual-return calculation.');
assert.match(currentArDeadlineAnswer.text, /general annual-return date is 31\/07\/2026/);
assert.match(currentArDeadlineAnswer.text, /additional month applies, making the date 31\/08\/2026/,
  'The branch-register date remains conditional when the relevant facts are not given.');
for (const [fyeQuery, expectedArDate] of [
  ['Our listed public company FYE is 31 December 2025. When is our annual return due?', '31/05/2026'],
  ['Our private company FYE is 2025-12-31. When is our annual return due?', '31/07/2026'],
  ['Our private company FYE was 31/12/2025. When is our annual return due?', '31/07/2026'],
  ['Our private company financial year end of 31 December 2025. When is our annual return due?', '31/07/2026'],
  ['Our private company FYE: 31 December 2025. When is our annual return due?', '31/07/2026'],
  ['Our private company year ended 31 December 2025. When is our annual return due?', '31/07/2026']
]) {
  const resolution = defaultTargetDateResolver.resolveAuthorityEvidenceDate(fyeQuery);
  assert.equal(resolution.dateRole, 'CURRENT_WORKFLOW_FACT', `The FYE remains a current workflow fact: ${fyeQuery}`);
  const answer = renderAcra31Rule(acra31AnnualReturnRow, fyeQuery);
  assert.ok(answer, `The ACRA deadline answer parses the owned FYE: ${fyeQuery}`);
  assert.match(answer.text, new RegExp(`general annual-return date is ${expectedArDate.replaceAll('/', '\\/')}`));
}
assert.equal(parseCompanyFyeDate('Our private company FYE is 31/02/2025.'), undefined,
  'An invalid calendar date is not normalized into a different FYE.');
assert.equal(parseCompanyFyeDate('Our private company FYE is 31/12/2025 and our FYE was 30/06/2026.'), undefined,
  'Multiple FYE dates fail closed as ambiguous.');
assert.equal(parseCompanyFyeDate('Another private company FYE is 31/12/2025.'), undefined,
  'A date owned by another company is not treated as this company’s FYE.');
for (const relationship of ['competitor', 'supplier', 'client', 'subsidiary']) {
  const query = `A ${relationship}'s private company FYE is 31/12/2025. When is our private company's annual return due?`;
  assert.equal(parseCompanyFyeDate(query), undefined,
    `An FYE attributed to the ${relationship} cannot supply our company's filing date.`);
}
assert.equal(parseCompanyFyeDate(
  "A competitor's listed company FYE is 31/12/2025. When is our private company's annual return due?"), undefined,
  "A listed company's FYE cannot supply the private company's annual-return date.");
assert.equal(defaultTargetDateResolver.resolveAuthorityEvidenceDate(
  'Historically, our private company FYE was 31/12/2025. When was the annual return due?').dateRole,
  undefined, 'Historical-law questions do not become current workflow facts.');
const isoFyeAgm = renderAcra31Rule(acra31Cases.find(row => row.id === 'agm-deadlines'),
  'Our private company FYE is 2025-12-31. When is our AGM due?');
assert.match(isoFyeAgm?.text ?? '', /AGM date is 30\/06\/2026/i,
  'A non-listed company AGM deadline uses the same strictly parsed ISO FYE.');
const listedAgm = renderAcra31Rule(acra31Cases.find(row => row.id === 'agm-deadlines'),
  'Our listed company FYE is 2025-12-31. When is our AGM due?');
assert.match(listedAgm?.text ?? '', /AGM date is 30\/04\/2026/i,
  'A listed company AGM deadline retains its four-month period.');
const listedAnnualReturn = renderAcra31Rule(acra31AnnualReturnRow,
  'Our listed company FYE is 2025-12-31. When is our annual return due?');
assert.match(listedAnnualReturn?.text ?? '', /general annual-return date is 31\/05\/2026/,
  'A listed company annual-return deadline retains its five-month period.');
const positiveBranchRegisterAnswer = renderAcra31Rule(acra31Cases.find(row => row.id === 'annual-return-deadlines'),
  'Our private company FYE is 31 December 2025. It has share capital and maintains an overseas branch register. What is its annual return deadline?');
assert.match(positiveBranchRegisterAnswer?.text ?? '', /annual-return date is 31\/08\/2026/,
  'The additional month applies when both affirmative facts belong to the queried company.');
const noBranchRegisterAnswer = renderAcra31Rule(acra31Cases.find(row => row.id === 'annual-return-deadlines'),
  'Our private company FYE is 31 December 2025. It has share capital and has no overseas branch register. What is its annual return deadline?');
assert.match(noBranchRegisterAnswer?.text ?? '', /annual-return date is 31\/07\/2026/);
assert.doesNotMatch(noBranchRegisterAnswer?.text ?? '', /annual-return date is 31\/08\/2026/,
  'An explicit absence of an overseas branch register defeats the additional month.');
const noShareCapitalAnswer = renderAcra31Rule(acra31Cases.find(row => row.id === 'annual-return-deadlines'),
  'Our private company FYE is 31 December 2025. It has no share capital and maintains an overseas branch register. What is its annual return deadline?');
assert.match(noShareCapitalAnswer?.text ?? '', /annual-return date is 31\/07\/2026/);
assert.doesNotMatch(noShareCapitalAnswer?.text ?? '', /annual-return date is 31\/08\/2026/,
  'An explicit absence of share capital defeats the additional month.');
const crossSentenceBranchFactsAnswer = renderAcra31Rule(acra31Cases.find(row => row.id === 'annual-return-deadlines'),
  'Our private company FYE is 31 December 2025. It has share capital. It maintains an overseas branch register. What is its annual return deadline?');
assert.doesNotMatch(crossSentenceBranchFactsAnswer?.text ?? '', /annual-return date is 31\/08\/2026/,
  'Share-capital and branch-register facts in separate sentences remain unresolved.');
const separateCompanyBranchFactsAnswer = renderAcra31Rule(acra31Cases.find(row => row.id === 'annual-return-deadlines'),
  'Our private company FYE is 31 December 2025. It has share capital and a different company maintains an overseas branch register. What is our annual return deadline?');
assert.doesNotMatch(separateCompanyBranchFactsAnswer?.text ?? '', /annual-return date is 31\/08\/2026/,
  'A branch-register fact about another company does not extend this company’s deadline.');
const unrelatedListedCompanyQuestion = 'Our private company FYE is 31 December 2025. Another listed company is in our group. What is our annual return deadline?';
assert.equal(renderAcra31Rule(acra31Cases.find(row => row.id === 'annual-return-deadlines'), unrelatedListedCompanyQuestion), undefined,
  'A listed-company fact from a separate party does not set the private company deadline.');

assert.equal(supportAcraMomKnowledgeRule({ ...acra31Cases[0], query: 'For a 2017 FYE, what AGM due dates applied?',
  sourceText: readFileSync(new URL('acra-agm-native.html', acra31SourceRoot), 'utf8'),
  officialUrl: acra31Manifest.sources.find(item => item.fixture === 'acra-agm-native.html').url }), false,
'AGM dates before the official 31 August 2018 boundary remain unsupported.');
assert.deepEqual(acraMomKnowledgePointers({ authority: 'ACRA', topicId: 'acra-entity-information-changes',
  query: 'Our company changed its registered office address in October 2026. Do we need to update it?',
  subject: 'ACRA company entity information update requirements' }), [],
'The new officer update family leaves registered-office address routing to the existing ACRA-specific source path.');

function fallbackIssuePlan(query) {
  return reconcileQuestionUnderstanding(query, classifyQuestion(query),
    { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' }).issuePlan;
}
const acraTwoDeadlinesPlan = fallbackIssuePlan('Our local private company FYE is 31 December 2025. What are the usual AGM and annual return deadlines?');
assert.ok(acraTwoDeadlinesPlan.issues.some(issue => issue.mappedTopicIds.length === 1 && issue.mappedTopicIds[0] === 'acra_agm'));
assert.ok(acraTwoDeadlinesPlan.issues.some(issue => issue.mappedTopicIds.length === 1 && issue.mappedTopicIds[0] === 'acra_annual-returns'));
const acra07MixedPlan = fallbackIssuePlan(acra07MultipartQuestion);
assert.ok(acra07MixedPlan.issues.some(issue => issue.mappedTopicIds.includes('acra_xbrl')));
assert.ok(acra07MixedPlan.issues.some(issue => issue.subject.includes('directors') && issue.mappedTopicIds.includes('acra_annual-returns')),
  'The PDF/template and directors’ statement signing requests remain separately mapped.');
const acra08DeclarationPlan = fallbackIssuePlan('Our private company dispensed with its AGM. What date and details must we still declare when filing the annual return?');
assert.ok(acra08DeclarationPlan.issues.some(issue => issue.contextualTopicIds?.includes('acra_agm')),
  'AGM declaration details stay contextual when the independent request is annual-return filing.');
assert.ok(!acra08DeclarationPlan.issues.some(issue => issue.mappedTopicIds.includes('acra_agm')),
  'An AGM declaration request does not turn annual-return filing into a separate AGM compliance issue.');
assert.ok(acra08DeclarationPlan.issues.some(issue => issue.mappedTopicIds.includes('acra_annual-returns')),
  'The AGM declaration request remains supported by the annual-return issue.');
const acra12ExtensionPlan = fallbackIssuePlan('We need up to two more months to file our annual return. Is an extension available, and does applying remove the need for the AGM?');
assert.ok(acra12ExtensionPlan.issues.some(issue => issue.subject === 'ACRA annual return extension of time requirements'));
assert.ok(acra12ExtensionPlan.issues.some(issue => issue.subject === 'ACRA AGM extension and continuing AGM requirements'));
const acra09FyeChangePlan = fallbackIssuePlan('Our FYE is 31 December and the AGM deadline has passed. Can we change FYE now to gain time before the annual return is filed?');
assert.ok(acra09FyeChangePlan.issues.some(issue => issue.subject === 'ACRA financial year end change restrictions and approval requirements'));
assert.ok(!acra09FyeChangePlan.issues.some(issue => issue.mappedTopicIds.includes('mom-work-passes-s-pass')),
  'A missed AGM deadline does not classify an S Pass question.');

for (const row of cases) {
  const sourceText = fixtures[row.source];
  const manifestSource = manifest.sources.find(source => source.fixture === row.source);
  assert.ok(manifestSource, `${row.id}: source fixture has an official-source record`);
  assert.match(manifestSource.url, /^https:\/\/(?:www\.)?(?:acra|mom)\.gov\.sg\//);
  assert.equal(createHash('sha256').update(sourceText).digest('hex'), manifestSource.fixtureSha256,
    `${row.id}: selected excerpt bytes match the retained fixture digest`);
  assert.equal(manifestSource.retrievedOnSingaporeDate, '27/10/2026', `${row.id}: retrieval date is recorded`);
  assert.ok(manifestSource.effectiveDateEvidence, `${row.id}: applicability evidence is recorded`);
  const input = { authority: row.authority, topicId: row.topicId, query: row.query, subject: row.subject,
    sourceText, officialUrl: manifestSource.url };
  assert.equal(supportAcraMomKnowledgeRule(input), true, `${row.id}: the complete official-source excerpt proves the rule`);
  assert.equal(hasAcraMomKnowledgeContradiction(input), false,
    `${row.id}: a correct official-source excerpt does not trigger the fallback contradiction veto`);
  const quotes = selectAcraMomKnowledgeQuotes(input);
  assert.ok(quotes.length >= 1, `${row.id}: selected rule passages support the answer`);
  if (row.id === 'mom-annual-leave') {
    const selectedText = quotes.join('\n').toLowerCase();
    const probationRow = sourceText.split(/\r?\n/).find(value => /^3 to 12 months\s*\|/i.test(value));
    assert.ok(probationRow, 'The retained source contains the 3-to-12-month probation row.');
    assert.ok(quotes.includes(probationRow), 'The selected quotes preserve the exact visible completed-months/probation row.');
    assert.ok(selectedText.includes('(number of completed months of service ÷ 12 months) × number of days of annual leave entitlement'),
      'Annual leave quotations retain the exact 12-month calculation formula.');
    assert.ok(selectedText.includes('if the fraction of a day is less than one-half, round it down.'),
      'Annual leave quotations retain the lower rounding rule.');
    assert.ok(selectedText.includes('if it is half or more, round it up to one day.'),
      'Annual leave quotations retain the half-up rounding rule.');
  }
  if (row.id === 'acra-annual-return-process') {
    assert.ok(quotes.some(quote => /Fees:\s*\$60\./.test(quote)), 'The selected annual-return process quotes retain the exact S$60 fee.');
  }
  assert.equal(supportAcraMomKnowledgeRule({ ...input, sourceText: quotes.join('\n') }), true,
    `${row.id}: the returned source quotes alone preserve every required rule premise`);
  assert.deepEqual(acraMomKnowledgePointers(input), [manifestSource.url]);
  assert.equal(supportAcraMomKnowledgeRule({ ...input, sourceText: '' }), false,
    `${row.id}: missing source evidence fails closed`);
  assert.equal(supportAcraMomKnowledgeRule({ ...input, officialUrl: 'https://example.com/not-official' }), false,
    `${row.id}: unrelated domain cannot prove an owned rule`);
  assert.deepEqual(selectAcraMomKnowledgeQuotes({ ...input, officialUrl: undefined }), [],
    `${row.id}: displayed quotations require exact official-source identity`);
  assert.ok(ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === row.id.toUpperCase().replaceAll('-', '_'))
    || ACRA_MOM_KNOWLEDGE_RULES_20261027B.some(rule => rule.topicIds.includes(row.topicId)),
  `${row.id}: the question is exposed through topic metadata`);
  const answer = ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(rule => rule.topicIds.includes(row.topicId));
  for (const expected of row.expected) assert.match(answer.rule + ' ' + answer.conditions.join(' ') + ' ' + answer.exceptions.join(' '),
    new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `${row.id}: rendered rule covers ${expected}`);
}

for (const [row, boundary] of [[cases[0], '20 October 2026'], [cases[2], '19 October 2026']]) {
  const source = manifest.sources.find(item => item.fixture === row.source);
  assert.equal(supportAcraMomKnowledgeRule({ ...row, query: `${row.query} (subject repeats ${boundary})`,
    sourceText: fixtures[row.source], officialUrl: source.url }), true,
  `${row.id}: a repeated identical commencement date remains valid`);
}

const secretaryFixture = fixtures['acra-company-secretary.txt'];
const secretarySource = manifest.sources.find(source => source.fixture === 'acra-company-secretary.txt');
assert.equal(secretarySource.topicIds[0], 'acra_company-secretary');
assert.equal(createHash('sha256').update(secretaryFixture).digest('hex'), secretarySource.fixtureSha256);
for (const phrase of ['within six months of successful registration', 'position cannot be empty for more than six months',
  'fine of up to $1,000', 'Be a real person (not a company)', 'Not be the same person as the sole director']) {
  assert.ok(secretaryFixture.includes(phrase), `The refreshed ACRA secretary source includes: ${phrase}`);
}
assert.match(secretarySource.url, /appointing-company-directors-other-key-officers\/$/);

assert.equal(supportAcraMomKnowledgeRule({ ...cases[0], sourceText: fixtures[cases[0].source], officialUrl: undefined }), true,
  'Source validation may be used before canonical-URL metadata is attached; rendering separately requires the canonical URL.');
for (const [row, oldQuery] of [
  [cases[0], 'What annual return officer particulars applied before 20 October 2026?'],
  [cases[1], 'How did a company file its annual return in 2025?'],
  [cases[2], 'Which XBRL requirements applied before 19 October 2026?'],
  [cases[3], 'What financial statement filing exemptions applied to new companies in 2025?'],
  [cases[4], 'What was the statutory annual leave entitlement in 2025?'],
  [cases[5], 'What sick leave entitlement applied in 2025?'],
  [cases[6], 'What public holiday pay rules applied in 2025?'],
  [cases[7], 'When must final salary be paid in 2025?']
]) {
  const sourceText = fixtures[row.source];
  const source = manifest.sources.find(item => item.fixture === row.source);
  assert.equal(supportAcraMomKnowledgeRule({ ...row, query: oldQuery, sourceText, officialUrl: source.url }), false,
    `${row.id}: the current source excerpt cannot establish an unsupported historical period`);
}

for (const [row, conflictingQuery] of [
  [cases[0], 'From 20 October 2026, what officer particulars must be confirmed on an annual return filed on 19 October 2026?'],
  [cases[2], 'Which XBRL rules apply from 19 October 2026 for financial statements filed on 18 October 2026?']
]) {
  const source = manifest.sources.find(item => item.fixture === row.source);
  assert.equal(supportAcraMomKnowledgeRule({ ...row, query: conflictingQuery, sourceText: fixtures[row.source], officialUrl: source.url }), false,
    `${row.id}: an additional conflicting filing date cannot inherit the rule's commencement boundary`);
}

const wrongFacts = [
  [cases[0], '20 October 2026', '20 October 2025'],
  [cases[0], 'will need to confirm', 'will not need to confirm'],
  [cases[1], 'At least two directors', 'one director'],
  [cases[1], 'Fees: $60.', 'Fees: $600.'],
  [cases[1], 'Fees: $60.', 'Fees: $60.50.'],
  [cases[2], 'Revenue for the current financial year does not exceed $500,000.', 'Revenue for the current financial year exceeds $500,000.'],
  [cases[2], 'Revenue for the current financial year does not exceed $500,000.', 'Revenue for the current financial year does not exceed $500,0000.'],
  [cases[2], 'Total assets for the current financial year do not exceed $500,000.', 'Total assets for the current financial year do not exceed $500,000.50.'],
  [cases[4], '1st | 7', '1st | 9'],
  [cases[4], '÷ 12 months', '÷ 10 months'],
  [cases[4], 'If it is half or more, round it up to one day.', 'If it is half or more, round it down to zero days.'],
  [cases[5], '3 | 13 May | 5 | 15', '3 | 13 May | 14 | 60'],
  [cases[5], '6 and thereafter | 13 August | 14 | 60', '6 and thereafter | 13 August | 14 | 600'],
  [cases[5], '6 and thereafter | 13 August | 14 | 60', '6 and thereafter | 13 August | 140 | 60'],
  [cases[6], '11 paid public holidays', '12 paid public holidays'],
  [cases[6], 'were not absent on the working day immediately before or after a holiday without consent or a reasonable excuse.', 'were absent on the working day immediately before or after a holiday with consent and a reasonable excuse.'],
  [cases[7], 'Employee resigns and serves the required notice period | On the last day of employment.', 'Employee resigns and serves the required notice period | Within 7 days of the last day of employment.'],
  [cases[7], 'Employee resigns and does not serve the notice period | Within 7 days of the last day of employment.', 'Employee resigns and does not serve the notice period | Within 5 days of the last day of employment.'],
  [cases[7], 'Dismissal on grounds of misconduct | On the last day of employment. If this is not possible, then within 3 working days from date of dismissal.', 'Dismissal on grounds of misconduct | On the last day of employment. If this is not possible, then within 5 working days from date of dismissal.'],
  [cases[7], 'Employer terminates the contract | On the last day of employment. If this is not possible, then within 3 working days from date of termination.', 'Employer terminates the contract | On the last day of employment. If this is not possible, then within 5 working days from date of termination.']
];
for (const [row, expected, incorrect] of wrongFacts) {
  const sourceText = fixtures[row.source].replaceAll(expected, incorrect);
  assert.notEqual(sourceText, fixtures[row.source], `${row.id}: the negative-control mutation changes the source text`);
  const source = manifest.sources.find(item => item.fixture === row.source);
  const input = { ...row, sourceText, officialUrl: source.url };
  assert.equal(supportAcraMomKnowledgeRule(input), false, `${row.id}: wrong changed numeric/date rule is rejected`);
  assert.deepEqual(selectAcraMomKnowledgeQuotes(input), [], `${row.id}: contradictory sources cannot supply rendered rule quotations`);
  assert.equal(hasAcraMomKnowledgeContradiction(input), true, `${row.id}: fallback veto recognizes explicit contradiction ${expected} -> ${incorrect}`);
  assert.equal(supportPracticalExpansionRule(input), false, `${row.id}: an explicit changed fact vetoes older broad statutory fallbacks`);
}

for (const [row, expected, incorrect] of [
  [cases[4], 'If it is half or more, round it up to one day.', ''],
  [cases[6], 'You are not entitled to holiday pay if the holiday falls on your approved unpaid leave.', '']
]) {
  const sourceText = fixtures[row.source].replace(expected, incorrect);
  assert.notEqual(sourceText, fixtures[row.source], `${row.id}: the incomplete-source mutation changes the source text`);
  const source = manifest.sources.find(item => item.fixture === row.source);
  const input = { ...row, sourceText, officialUrl: source.url };
  assert.equal(supportAcraMomKnowledgeRule(input), false, `${row.id}: incomplete source cannot prove every stated rule condition`);
  assert.deepEqual(selectAcraMomKnowledgeQuotes(input), [], `${row.id}: incomplete source yields no complete-family quotes`);
}

for (const row of cases) {
  const source = manifest.sources.find(item => item.fixture === row.source);
  assert.equal(supportAcraMomKnowledgeRule({ ...row, sourceText: fixtures[row.source], authority: 'IRAS', officialUrl: source.url }), undefined,
    `${row.id}: the module does not claim another authority’s issue`);
  assert.equal(supportAcraMomKnowledgeRule({ ...row, sourceText: fixtures[row.source], subject: 'Unrelated accounting disclosure', officialUrl: source.url }), undefined,
    `${row.id}: unrelated semantic issues remain outside the owned family`);
}

const employeeRule = ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'MOM_SICK_LEAVE_ENTITLEMENT');
const noFactsIssue = {
  id: 'general-sick-leave', subject: employeeRule.title, population: 'Employee', operation: 'EXPLAIN_RULE',
  evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: []
};
const source = manifest.sources.find(item => item.fixture === 'mom-sick-leave.txt');
const issueSource = {
  key: 'mom-sick-leave', title: source.pageTitle, publisher: 'MOM', documentTitle: source.pageTitle,
  officialUrl: source.url, provenance: 'LIVE_EXTERNAL', validTo: undefined,
  claims: [{ text: fixtures[source.fixture], issueIds: ['general-sick-leave'], supportKind: 'EXACT_SOURCE_QUOTE', provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: { recordId: 'record-mom-sick-leave', documentHash: 'b'.repeat(64), canonicalUrl: source.url, retrievedAt: '2026-10-27T00:00:00Z' } }]
};
const stream = {
  authority: 'MOM', domain: 'MOM_EMPLOYMENT', issues: [noFactsIssue], sources: [issueSource]
};
const explanation = getAcraMomKnowledgeEvidence(cases[5].query, stream, noFactsIssue);
assert.ok(explanation);
assert.match(explanation.text, /case-specific conclusion requires:.*Employment Act coverage/i);
assert.equal(getAcraMomKnowledgeEvidence('What sick-leave table applied in 2025?', stream, noFactsIssue), undefined,
  'The general explanation cannot present current entitlement as a historic answer.');
assert.equal(getAcraMomKnowledgeEvidence(cases[5].query, { ...stream, sources: [{ ...issueSource, officialUrl: 'https://example.com' }] }, noFactsIssue), undefined,
  'A general rendered explanation requires exact source identity and issue-bound source claims.');

const annualLeaveQuery = 'What is the minimum annual leave entitlement and how does it increase?';
const annualLeaveRule = ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'MOM_ANNUAL_LEAVE_ENTITLEMENT');
const annualLeaveSource = manifest.sources.find(item => item.fixture === 'mom-annual-leave.txt');
const annualLeaveSourceText = fixtures['mom-annual-leave.txt'];
const annualLeaveProofInput = {
  authority: 'MOM', topicId: 'mom_annual_leave', query: annualLeaveQuery,
  subject: 'Annual leave eligibility, minimum entitlement and pro-rating',
  sourceText: annualLeaveSourceText, officialUrl: annualLeaveSource.url
};
const probationQualification = 'This applies even if you’re still on probation.';
assert.ok(annualLeaveSourceText.includes(probationQualification));
const straightApostropheProbationInput = {
  ...annualLeaveProofInput,
  sourceText: annualLeaveSourceText.replace('you’re', "you're")
};
assert.equal(supportAcraMomKnowledgeRule(straightApostropheProbationInput), true,
  'The exact probation qualification remains provable if an extractor normalizes only the apostrophe glyph.');
const missingProbationQualification = {
  ...annualLeaveProofInput,
  sourceText: annualLeaveSourceText.replace(probationQualification, '')
};
assert.equal(supportAcraMomKnowledgeRule(missingProbationQualification), undefined,
  'A source with all prior premises but no probation qualification does not activate the expanded rule.');
assert.deepEqual(selectAcraMomKnowledgeQuotes(missingProbationQualification), [],
  'The expanded rule cannot display a complete quote set without the probation qualification.');
assert.notEqual(supportPracticalExpansionRule(missingProbationQualification), false,
  'With no contradiction, the pre-existing narrower fallback remains available.');

const reversedProbationCondition = {
  ...annualLeaveProofInput,
  sourceText: annualLeaveSourceText.replace(probationQualification,
    'Employees on probation are not entitled to annual leave.')
};
assert.equal(hasAcraMomKnowledgeContradiction(reversedProbationCondition), true,
  'An explicit source statement reversing the probation qualification is recognized as contradictory.');
assert.equal(supportPracticalExpansionRule(reversedProbationCondition), false,
  'An explicit reversed probation condition vetoes the older aggregate fallback.');

const appendedProbationContradiction = {
  ...annualLeaveProofInput,
  sourceText: `${annualLeaveSourceText}\nEmployees on probation are not entitled to annual leave.`
};
assert.equal(hasPracticalExpansionContradiction(appendedProbationContradiction), true,
  'A contradictory probation restriction appended to a valid full excerpt reaches the aggregate veto.');
assert.equal(supportPracticalExpansionRule(appendedProbationContradiction), false,
  'A valid full excerpt cannot override a same-source contradictory probation restriction.');
const annualLeaveIssue = {
  id: 'general-annual-leave-unknown-population',
  subject: 'Employment Act annual leave eligibility, entitlement, and proration',
  population: 'Not established', operation: 'CHECK_ELIGIBILITY', evidenceStatus: 'VERIFIED',
  applicationStatus: 'UNRESOLVED', claims: [], gaps: []
};
const annualLeaveIssueSource = {
  key: 'mom-annual-leave', title: annualLeaveSource.pageTitle, publisher: 'MOM',
  documentTitle: annualLeaveSource.pageTitle, officialUrl: annualLeaveSource.url,
  provenance: 'LIVE_EXTERNAL', validTo: undefined,
  claims: [{ text: fixtures['mom-annual-leave.txt'], issueIds: [annualLeaveIssue.id],
    supportKind: 'EXACT_SOURCE_QUOTE', provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: { recordId: 'record-mom-annual-leave',
      documentHash: createHash('sha256').update(fixtures['mom-annual-leave.txt']).digest('hex'),
      canonicalUrl: annualLeaveSource.url, retrievedAt: '2026-10-27T00:00:00Z' } }]
};
const annualLeaveStream = {
  authority: 'MOM', domain: 'MOM_EMPLOYMENT', issues: [annualLeaveIssue], sources: [annualLeaveIssueSource]
};
const annualLeaveExplanation = getAcraMomKnowledgeEvidence(annualLeaveQuery, annualLeaveStream, annualLeaveIssue);
assert.ok(annualLeaveExplanation, 'A verified conditional general rule can render when requester population is not established.');
assert.match(annualLeaveExplanation.text, /Employment Act-covered employee becomes entitled.*at least 3 months/i);
assert.equal(annualLeaveIssue.applicationStatus, 'UNRESOLVED',
  'A general rule explanation does not assert this unknown requester’s eligibility.');
assert.equal(getAcraMomKnowledgeEvidence(annualLeaveQuery,
  { ...annualLeaveStream, authority: 'CPF' }, annualLeaveIssue), undefined,
'The unknown-population general rule cannot render under the wrong authority.');
assert.equal(getAcraMomKnowledgeEvidence(annualLeaveQuery,
  { ...annualLeaveStream, domain: 'CPF_PAYROLL' }, annualLeaveIssue), undefined,
'The unknown-population general rule cannot render under the wrong domain.');
assert.equal(getAcraMomKnowledgeEvidence(annualLeaveQuery, annualLeaveStream,
  { ...annualLeaveIssue, population: 'Company' }), undefined,
'An established but incompatible population cannot use the conditional employee rule.');
for (const operation of ['CALCULATE', 'PREPARE_JOURNAL']) {
  assert.equal(getAcraMomKnowledgeEvidence(annualLeaveQuery, annualLeaveStream,
    { ...annualLeaveIssue, operation }), undefined,
  `An unknown-population ${operation} cannot use the conditional general-rule renderer.`);
}
assert.equal(getAcraMomKnowledgeEvidence(annualLeaveQuery, annualLeaveStream,
  { ...annualLeaveIssue, applicationStatus: 'VERIFIED' }), undefined,
'The general rule cannot promote an unresolved eligibility check to verified case application.');
assert.equal(annualLeaveRule?.authority, 'MOM');

const legacySalaryRequest = {
  authority: 'MOM', topicId: 'mom-salary-payment',
  query: 'What timing applies to final salary after dismissal for misconduct?',
  subject: 'Final salary deadline after dismissal for misconduct',
  officialUrl: 'https://www.mom.gov.sg/employment-practices/salary/paying-salary',
  sourceText: legacySalaryHtml
};
assert.equal(supportAcraMomKnowledgeRule(legacySalaryRequest), true,
  'The original HTML table preserves final salary label-to-deadline rows without an adapted delimiter.');
const legacySalaryQuotes = selectAcraMomKnowledgeQuotes(legacySalaryRequest);
const misconductRowQuote = legacySalaryQuotes.find(quote => /Dismissal on grounds of misconduct/i.test(quote));
assert.ok(misconductRowQuote);
assert.match(misconductRowQuote, /Dismissal on grounds of misconduct\s+On the last day of employment\.[\s\S]*?within 3 working days from date of dismissal/i,
  'The source-visible misconduct row binds both default and fallback deadlines to its own label.');
assert.doesNotMatch(misconductRowQuote, /Employer terminates the contract|resigns and serves/i);
assert.doesNotMatch(legacySalaryQuotes.join('\n'), /\|/,
  'Selected HTML-source quotations do not contain synthesized table delimiters.');
const changedLegacyDismissal = legacySalaryHtml.replace('within 3 working days from date of dismissal', 'within 5 working days from date of dismissal');
assert.equal(supportAcraMomKnowledgeRule({ ...legacySalaryRequest, sourceText: changedLegacyDismissal }), false);
assert.equal(hasAcraMomKnowledgeContradiction({ ...legacySalaryRequest, sourceText: changedLegacyDismissal }), true,
  'An altered deadline in the HTML table still vetoes fallback support.');
assert.deepEqual(selectAcraMomKnowledgeQuotes({ ...legacySalaryRequest, sourceText: changedLegacyDismissal }), []);

const finalSalaryPointerRequest = {
  authority: 'MOM', topicId: 'mom-salary-payment',
  query: 'When is final salary due after an employee resigns and serves notice?',
  subject: 'Final salary payment deadlines after resignation', sourceText: ''
};
assert.ok(practicalExpansionPointers(finalSalaryPointerRequest).some(pointer => pointer.url === legacySalaryRequest.officialUrl),
  'A final-salary query still selects its own paying-salary source pointer.');
const salaryDeductionPointerRequest = {
  authority: 'MOM', topicId: 'mom-salary-payment',
  query: 'Can an employer deduct a staff shortage from salary?',
  subject: 'Employment Act salary deduction grounds and limits', sourceText: ''
};
assert.ok(!practicalExpansionPointers(salaryDeductionPointerRequest).some(pointer => pointer.url === legacySalaryRequest.officialUrl),
  'The final-salary source pointer is not selected for a salary-deduction question merely because both use the broad salary topic.');

const graduatedSickLeaveApplicationCases = [
  {
    id: 'four-month sick leave',
    query: 'An employee covered by the Employment Act has completed four months of service, supplied the required medical certificate and informed us within twenty-four hours. Is the statutory entitlement already fourteen outpatient sick-leave days plus sixty hospitalisation days?',
    expected: [/8\/30 at 4 months/i],
    wrongFourMonthFullEntitlement: /(?:at|after) four months[^.\n]{0,100}(?:14|fourteen)[^.\n]{0,100}(?:60|sixty)|(?:14|fourteen) outpatient[^.\n]{0,100}(?:60|sixty) hospitalisation days[^.\n]{0,100}(?:at|after) four months/i
  },
  {
    id: 'five-month sick leave',
    query: 'An employee covered by the Employment Act has completed five months of service, supplied the required medical certificate and informed us within twenty-four hours. Is the statutory entitlement already fourteen outpatient sick-leave days plus sixty hospitalisation days?',
    expected: [/11\/45 at 5 months/i],
    wrongFiveMonthFullEntitlement: /(?:at|after) five months[^.\n]{0,100}(?:14|fourteen)[^.\n]{0,100}(?:60|sixty)|(?:14|fourteen) outpatient[^.\n]{0,100}(?:60|sixty) hospitalisation days[^.\n]{0,100}(?:at|after) five months/i
  }
];
for (const sample of graduatedSickLeaveApplicationCases) {
  const response = await processAccountingQuery(sample.query, null, 'SFRS_I', undefined, undefined, [], undefined, {});
  assert.equal(response.scenarioState.scenarioType, 'SINGAPORE_STATUTORY_ADVISORY',
    `${sample.id}: the complete question uses the normal statutory advisory path`);
  for (const expected of sample.expected) assert.match(response.messageText, expected,
    `${sample.id}: the rendered statutory schedule states the applicable outpatient and hospitalisation allowance`);
  assert.match(response.messageText, /eligible for paid annual leave after at least 3 months of service/i,
    `${sample.id}: the bundled rule gives the correct annual-leave eligibility threshold`);
  assert.match(response.messageText, /60-day maximum includes outpatient sick leave|hospitalisation days include.*outpatient/i,
    `${sample.id}: hospitalisation leave includes outpatient leave rather than adding a separate allowance`);
  assert.match(response.messageText, /leave already taken|after leave already taken/i,
    `${sample.id}: remaining leave depends on prior leave use`);
  assert.doesNotMatch(response.messageText,
    /Employees who have served for at least 12 months are entitled to statutory paid annual leave|Minimum 7 days after 1 year of service/i,
    `${sample.id}: the answer does not repeat the incorrect 12-month annual-leave eligibility claim`);
  assert.doesNotMatch(response.messageText, sample.wrongFourMonthFullEntitlement || sample.wrongFiveMonthFullEntitlement,
    `${sample.id}: the applicable graduated entitlement is not replaced by the full 14/60 schedule`);
}

const mockedPages = new Map();
for (const directory of ['tests/fixtures/statutoryKnowledge20261027b', 'tests/fixtures/statutoryKnowledge20261030',
  'tests/fixtures/statutoryWorkflows20261029', 'tests/fixtures/statutoryKnowledge20261031']) {
  for (const page of await loadStatutoryKnowledgeSources(directory)) {
    mockedPages.set(page.sourceUrl, { authority: page.authority, body: page.body, type: page.contentType });
  }
}
const savedFetch = globalThis.fetch;
const modelRequests = [];
globalThis.fetch = async input => {
  const url = typeof input?.url === 'string' ? input.url : String(input);
  if (/generativelanguage|api\.openai|generateContent|chat\/completions/i.test(url)) modelRequests.push(url);
  const page = mockedPages.get(url);
  if (page) return new Response(page.body, { headers: { 'content-type': page.type } });
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(candidate => candidate.sitemapUrls?.includes(url));
  if (provider) return new Response('<urlset>' + [...mockedPages].filter(([, source]) => source.authority === provider.authority)
    .map(([sourceUrl]) => `<url><loc>${sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('') + '</urlset>',
  { headers: { 'content-type': 'application/xml' } });
  return new Response('Unavailable in frozen fixture set', { status: 404 });
};
try {
  let acraWorkstreams;
  const response = await processAccountingQuery(newCompanyFinancialStatementQuestion, null, 'IFRS', undefined, undefined, [], undefined,
    { onAuthorityWorkstreams: value => { acraWorkstreams = value; } });
  assert.equal(response.scenarioState.scenarioType, 'AUTHORITY_ADVISORY',
    'The frozen acra-13 wording reaches the regular statutory query path.');
  assert.deepEqual(response.scenarioState.directGroups || [], [], 'The filing question does not create a journal.');
  assert.ok(acraWorkstreams, 'The filing question reaches governed ACRA source retrieval.');
  assert.match(response.messageText, /all Singapore-incorporated companies must prepare financial statements/i);
  assert.match(response.messageText, /newly incorporated or inactive status alone is not listed as an exemption/i);
  assert.match(response.messageText, /all Companies Act section 201A conditions/i);
  assert.doesNotMatch(response.messageText, /variable capital company|VCC/i,
    'The unspecified company is not silently treated as a VCC.');
  for (const query of [
    'We bought goods for S$10,000 for our GST-registered business. Can we claim the input tax?',
    'We acquired an asset for S$10,000. Is it deductible for corporate income tax?'
  ]) {
    const taxResponse = await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined, {});
    assert.equal(taxResponse.scenarioState.queryIntent, 'STATUTORY_ADVISORY',
      'Tax deduction and input-tax eligibility remain on the statutory advisory path.');
    assert.deepEqual(taxResponse.scenarioState.directGroups || [], [],
      'An ordinary tax eligibility question does not produce an unsolicited journal.');
  }
  for (const relationship of ['competitor', 'supplier', 'client', 'subsidiary']) {
    const query = `A ${relationship}'s private company FYE is 31/12/2025. When is our private company's annual return due?`;
    const unrelatedFyeResponse = await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined, {});
    assert.doesNotMatch(unrelatedFyeResponse.messageText,
      /For the stated FYE and company type, the general annual-return date is 31\/07\/2026/,
      `The ${relationship}'s FYE does not produce an individual filing deadline for our company.`);
  }
  const twoCompanyFyeResponse = await processAccountingQuery(
    'Our private company FYE is 31/12/2025 and our subsidiary private company FYE is 30/06/2025. When is our annual return due?',
    null, 'IFRS', undefined, undefined, [], undefined, {});
  assert.doesNotMatch(twoCompanyFyeResponse.messageText,
    /For the stated FYE and company type, the general annual-return date is \d{2}\/\d{2}\/2026/,
    'Multiple company FYE facts do not produce an individual annual-return date.');
  const mixedEntityTypeResponse = await processAccountingQuery(
    "A competitor's listed company FYE is 31/12/2025. When is our private company's annual return due?",
    null, 'IFRS', undefined, undefined, [], undefined, {});
  assert.doesNotMatch(mixedEntityTypeResponse.messageText,
    /For the stated FYE and company type, the general annual-return date is 31\/05\/2026/,
      "Another listed company's FYE and listing status cannot be attributed to our private company.");
  for (const query of [
    'Our company FYE is 31/12/2025. Acme is a private company. When is our annual return due?',
    'Our company FYE is 31/12/2025. Our partner operates a listed company. When is our annual return due?',
    'Our company FYE is 31/12/2025. Our company supplies Acme, which is a listed company. When is our annual return due?'
  ]) {
    const unrelatedCompanyTypeResponse = await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined, {});
    assert.doesNotMatch(unrelatedCompanyTypeResponse.messageText,
      /For the stated FYE and company type, the general annual-return date is \d{2}\/\d{2}\/2026/,
      'A named company or partner status cannot be borrowed as the FYE owner’s listing status.');
  }
  const genericCompanyTypeResponse = await processAccountingQuery(
    'Our company FYE is 31/12/2025. When is the annual return due for a non-listed company?',
    null, 'IFRS', undefined, undefined, [], undefined, {});
  assert.match(genericCompanyTypeResponse.messageText,
    /For the stated FYE and company type, the general annual-return date is 31\/07\/2026/,
    'A generic company type in the deadline question remains usable when there is no competing entity.');
  for (const query of [
    "Our private company FYE is 31/12/2025. When is Acme's annual return due?",
    'Our private company FYE is 31/12/2025. When is Acme’s AGM due?',
    'Our private company FYE is 31/12/2025. When is the annual return due for Acme?',
    'Our private company FYE is 31/12/2025. When must our supplier file the annual return?',
    'Our private company FYE is 31/12/2025. When must Acme hold its AGM?',
    'Our private company FYE is 31/12/2025. Acme is a private company. When is its annual return due?'
  ]) {
    const mismatchedTargetResponse = await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined, {});
    assert.doesNotMatch(mismatchedTargetResponse.messageText, /\b(?:31\/(?:05|07|08)|30\/(?:04|06))\/2026\b/,
      `An unrelated or ambiguous filing target cannot use our FYE to calculate a deadline: ${query}`);
  }
  let finalSalaryWorkstreams;
  const finalSalaryQuery = 'After an employee resigns, how much final salary do we owe, and when must we issue the itemised payslip?';
  const finalSalaryResponse = await processAccountingQuery(finalSalaryQuery, null, 'IFRS', undefined, undefined, [], undefined,
    { onAuthorityWorkstreams: value => { finalSalaryWorkstreams = value; } });
  assert.ok(finalSalaryWorkstreams, 'The incomplete salary calculation and independent payslip rule reach the evidence runtime.');
  assert.ok(finalSalaryWorkstreams.issuePlan.issues.some(issue => issue.operation === 'CALCULATE' &&
    issue.mappedTopicIds.length === 1 && issue.mappedTopicIds.includes('mom-salary-payment')));
  assert.ok(finalSalaryWorkstreams.issuePlan.issues.some(issue => issue.operation === 'EXPLAIN_RULE' &&
    issue.mappedTopicIds.length === 1 && issue.mappedTopicIds.includes('mom-itemised-payslips')));
  assert.equal(finalSalaryResponse.scenarioState.scenarioType, 'AUTHORITY_ADVISORY');
  const finalSalaryTextStart = finalSalaryResponse.messageText.indexOf('**Final salary amount calculation by termination reason**');
  const payslipTextStart = finalSalaryResponse.messageText.indexOf('**MOM itemised payslip issue and delivery requirements**');
  assert.ok(finalSalaryTextStart >= 0 && payslipTextStart > finalSalaryTextStart);
  const finalSalaryText = finalSalaryResponse.messageText.slice(finalSalaryTextStart, payslipTextStart);
  const payslipText = finalSalaryResponse.messageText.slice(payslipTextStart);
  assert.match(finalSalaryText, /Application unresolved/i,
    'The service does not invent a final-salary amount without its salary basis.');
  assert.doesNotMatch(finalSalaryText, /(?:S\$|SGD\s*\$?)\s*[\d,]+(?:\.\d+)?/i);
  assert.match(payslipText, /MOM rule explanation/i);
  assert.match(payslipText, /within three working days of payment/i,
    'The independent payslip timing rule is answerable alongside the unresolved calculation.');
  assert.match(payslipText, /\[Itemised pay slips\]\(https:\/\/www\.mom\.gov\.sg\/employment-practices\/salary\/itemised-payslips\)/i,
    'The payslip answer remains tied to its official evidence.');
  for (const query of [
    'How much final wages do we owe after resignation, and when must we issue the payslip?',
    'What amount of final salary do we owe after resignation, and when must we issue the payslip?',
    'Calculate the final pay after termination and explain payslip delivery.'
  ]) {
    let workstreams;
    const response = await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined,
      { onAuthorityWorkstreams: value => { workstreams = value; } });
    assert.ok(workstreams, `Final pay and payslip clauses reach the statutory evidence path: ${query}`);
    assert.ok(workstreams.issuePlan.issues.some(issue => issue.operation === 'CALCULATE' &&
      issue.mappedTopicIds.length === 1 && issue.mappedTopicIds[0] === 'mom-salary-payment'),
    `Final wages/salary/pay is classified as its own amount calculation: ${query}`);
    assert.ok(workstreams.issuePlan.issues.some(issue => issue.operation === 'EXPLAIN_RULE' &&
      issue.mappedTopicIds.length === 1 && issue.mappedTopicIds[0] === 'mom-itemised-payslips'),
    `The payslip obligation remains separate: ${query}`);
    assert.match(response.messageText, /Application unresolved/i,
      `No final salary amount is fabricated without sufficient facts: ${query}`);
    assert.match(response.messageText,
      /In the case of termination or dismissal, must give pay slip together with outstanding salary\./i,
      `The termination-specific payslip duty is quoted from the official source: ${query}`);
    assert.match(response.messageText,
      /If unable to give together, to be given within three working days of payment\./i,
      `The ordinary payslip timing remains separately available: ${query}`);
    assert.match(response.messageText,
      /\[Itemised pay slips\]\(https:\/\/www\.mom\.gov\.sg\/employment-practices\/salary\/itemised-payslips\)/i);
  }
  const departurePayslipCases = [
    {
      label: 'resignation with notice',
      query: 'An employee resigns and serves the required notice. When is the final salary due, and when must we issue the itemised payslip?',
      salaryRule: /Employee resigns and serves the required notice period[^\n]*last day of employment/i
    },
    {
      label: 'resignation without notice',
      query: 'An employee resigns without serving notice. When is the final salary due, and when must we issue the itemised payslip?',
      salaryRule: /Employee resigns and does not serve the notice period[^\n]*within 7 days of the last day of employment/i
    },
    {
      label: 'employer termination',
      query: 'The employer terminates the employee contract. When is the final salary due, and when must we issue the itemised payslip?',
      salaryRule: /Employer terminates the contract[^\n]*within 3 working days from date of termination/i
    },
    {
      label: 'misconduct dismissal',
      query: 'The employee is dismissed for misconduct. When is the final salary due, and when must we issue the itemised payslip?',
      salaryRule: /Dismissal on grounds of misconduct[^\n]*within 3 working days from date of dismissal/i
    }
  ];
  for (const sample of departurePayslipCases) {
    const response = await processAccountingQuery(sample.query, null, 'IFRS', undefined, undefined, [], undefined, {});
    assert.match(response.messageText, sample.salaryRule,
      `${sample.label}: the final-pay rule stays bound to the specified departure path.`);
    assert.match(response.messageText, /If unable to give together, to be given within three working days of payment\./i,
      `${sample.label}: the ordinary payslip timing is stated with its fallback condition.`);
    assert.match(response.messageText, /In the case of termination or dismissal, must give pay slip together with outstanding salary\./i,
      `${sample.label}: the termination and dismissal payslip rule stays explicitly qualified.`);
    assert.match(response.messageText,
      /\[Itemised pay slips\]\(https:\/\/www\.mom\.gov\.sg\/employment-practices\/salary\/itemised-payslips\)/i,
      `${sample.label}: the payslip guidance remains linked to the official MOM page.`);
  }
  const mixedSaleQuery = 'We sold goods for S$10,000. After an employee resigns, how much final salary do we owe and when must we issue the payslip?';
  const mixedSaleResponse = await processAccountingQuery(mixedSaleQuery, null, 'IFRS', undefined, undefined, [], undefined, {});
  assert.deepEqual(mixedSaleResponse.scenarioState.directGroups || [], [],
    'Sale proceeds cannot become a salary, CPF or other invented journal while both applications remain unresolved.');
  assert.equal(mixedSaleResponse.scenarioState.queryIntent, 'TRANSACTION',
    'The sale remains an accounting transaction in a multipart salary-and-payslip question.');
  assert.match(mixedSaleResponse.messageText, /S\$10,000|10000|sales transaction|sale proceeds|settlement/i,
    'The accounting sale obligation or its missing settlement facts remain visible beside MOM guidance.');
  assert.doesNotMatch(mixedSaleResponse.messageText, /final salary.{0,80}(?:S\$10,000|10000)/i,
    'The sale proceeds are not misattributed as final salary.');
  for (const query of [
    'Explain when we must issue a payslip and calculate the final salary after resignation. We sold goods for S$10,000.',
    'We sold goods for S$10,000. Explain when we must issue a payslip and calculate the final salary after resignation.'
  ]) {
    let workstreams;
    const response = await processAccountingQuery(query, null, 'IFRS', undefined, undefined, [], undefined,
      { onAuthorityWorkstreams: value => { workstreams = value; } });
    assert.ok(workstreams, 'A standalone explanatory opening does not discard the independent sales obligation.');
    assert.deepEqual(response.scenarioState.directGroups || [], [],
      'An unresolved mixed plan cannot expose a fabricated payroll journal in either clause order.');
    assert.equal(response.scenarioState.queryIntent, 'TRANSACTION',
      'The independent sale remains transaction intent regardless of clause order.');
    assert.ok(workstreams.issuePlan.issues.some(issue => issue.domain === 'ACCOUNTING' &&
      issue.operation === 'PREPARE_JOURNAL' && issue.status === 'UNRESOLVED'),
    'The unresolved sales journal obligation remains visible beside the bounded MOM answers.');
    assert.match(response.messageText, /S\$10,000|10000|sales transaction|sale proceeds|settlement/i,
      'The sale amount or its unresolved accounting obligation remains visible.');
    assert.doesNotMatch(response.messageText, /final salary.{0,80}(?:S\$10,000|10000)/i,
      'The sales proceeds are not attributed to final salary.');
  }
  let salaryRateWorkstreams;
  const salaryRateQuery = 'An employee earns S$5,000 per month. After resignation, calculate the final salary we owe, and how must we deliver the itemised payslip?';
  const salaryRateResponse = await processAccountingQuery(salaryRateQuery, null, 'IFRS', undefined, undefined, [], undefined,
    { onAuthorityWorkstreams: value => { salaryRateWorkstreams = value; } });
  assert.ok(salaryRateWorkstreams, 'A stated salary rate with missing separation facts still reaches the bounded evidence path.');
  assert.ok(salaryRateWorkstreams.issuePlan.issues.some(issue => issue.operation === 'CALCULATE' &&
    issue.mappedTopicIds.length === 1 && issue.mappedTopicIds.includes('mom-salary-payment')));
  assert.ok(salaryRateWorkstreams.issuePlan.issues.some(issue => issue.operation === 'EXPLAIN_RULE' &&
    issue.mappedTopicIds.length === 1 && issue.mappedTopicIds.includes('mom-itemised-payslips')));
  const salaryRateTextStart = salaryRateResponse.messageText.indexOf('**Final salary amount calculation by termination reason**');
  const salaryRatePayslipStart = salaryRateResponse.messageText.indexOf('**MOM itemised payslip issue and delivery requirements**');
  assert.ok(salaryRateTextStart >= 0 && salaryRatePayslipStart > salaryRateTextStart);
  assert.match(salaryRateResponse.messageText.slice(salaryRateTextStart, salaryRatePayslipStart), /Application unresolved/i,
    'A monthly salary rate alone does not produce a final-salary amount without separation and payroll-period facts.');
  assert.match(salaryRateResponse.messageText.slice(salaryRatePayslipStart), /MOM rule explanation/i);
  assert.match(salaryRateResponse.messageText.slice(salaryRatePayslipStart), /within three working days of payment/i);
  let uniformDeductionWorkstreams;
  const uniformDeductionQuery = 'After an employee resigns without notice, how much final salary do we owe, when must we issue the itemised payslip, and may we deduct S$400 for a uniform?';
  const uniformDeductionResponse = await processAccountingQuery(uniformDeductionQuery, null, 'IFRS', undefined, undefined, [], undefined,
    { onAuthorityWorkstreams: value => { uniformDeductionWorkstreams = value; } });
  assert.ok(uniformDeductionWorkstreams,
    'The mixed final-salary, payslip, and uniform-deduction request reaches per-issue statutory evidence.');
  assert.ok(uniformDeductionWorkstreams.issuePlan.issues.some(issue => issue.operation === 'CALCULATE' &&
    issue.mappedTopicIds.length === 1 && issue.mappedTopicIds.includes('mom-salary-payment')));
  assert.ok(uniformDeductionWorkstreams.issuePlan.issues.some(issue => issue.operation === 'EXPLAIN_RULE' &&
    issue.mappedTopicIds.length === 1 && issue.mappedTopicIds.includes('mom-itemised-payslips')));
  assert.ok(uniformDeductionWorkstreams.issuePlan.issues.some(issue => /salary deduction/i.test(issue.subject) &&
    issue.operation === 'EXPLAIN_RULE' && issue.mappedTopicIds.includes('mom-salary-payment')));
  assert.equal(uniformDeductionResponse.scenarioState.scenarioType, 'AUTHORITY_ADVISORY');
  assert.match(uniformDeductionResponse.messageText, /Application unresolved/i,
    'The final-salary amount remains unresolved instead of being invented.');
  assert.match(uniformDeductionResponse.messageText, /within three working days of payment/i,
    'The separately requested payslip rule remains available.');
  assert.match(uniformDeductionResponse.messageText,
    /MOM employer salary deduction authorization, purpose and limits/i,
    'The uniform deduction stays a distinct MOM issue even if its evidence does not fully answer the individual amount.');
  const solventEpcQuery = 'Does a solvent Singapore exempt private company have to file financial statements with ACRA, or may it choose to file them voluntarily?';
  const solventEpcResponse = await processAccountingQuery(solventEpcQuery, null, 'IFRS', undefined, undefined, [], undefined, {});
  assert.deepEqual(solventEpcResponse.scenarioState.directGroups || [], [], 'The filing question does not create a journal.');
  assert.match(solventEpcResponse.messageText, /solvent exempt private company may qualify not to file/i);
  assert.match(solventEpcResponse.messageText, /annual-return solvency declaration still applies/i,
    'The public response preserves the filing exception and continuing solvency declaration.');
  const simplifiedXbrlQuery = 'Our Singapore-incorporated company is smaller and non-publicly accountable and must file financial statements. Which XBRL template applies, and must we attach an authorised PDF?';
  const simplifiedXbrlResponse = await processAccountingQuery(simplifiedXbrlQuery, null, 'IFRS', undefined, undefined, [], undefined, {});
  assert.equal(simplifiedXbrlResponse.scenarioState.scenarioType, 'AUTHORITY_ADVISORY');
  assert.match(simplifiedXbrlResponse.messageText, /Simplified XBRL/i);
  assert.match(simplifiedXbrlResponse.messageText, /authorised PDF/i);
  assert.match(simplifiedXbrlResponse.messageText, /current-year revenue and assets not exceeding S\$500,000/i,
    'The public response retains both size tests and the remaining classification limits.');
  const frozen04AuditResponse = await processAccountingQuery(acra31AuditRow.query, null, 'IFRS', undefined, undefined, [], undefined, {});
  assert.equal(frozen04AuditResponse.scenarioState.scenarioType, 'AUTHORITY_ADVISORY',
    'Frozen04 reaches the regular public statutory query path.');
  assert.match(frozen04AuditResponse.messageText, /immediate past two consecutive financial years/i);
  assert.match(frozen04AuditResponse.messageText, /entire group/i);
  assert.match(frozen04AuditResponse.messageText, /10 million/i);
  assert.match(frozen04AuditResponse.messageText, /50 (?:full-time )?employees/i);
  assert.match(frozen04AuditResponse.messageText, /case-specific conclusion|relevant facts|application remains unresolved/i,
    'Frozen04 remains conditional because company and group eligibility facts are not fully established.');
  assert.equal(modelRequests.length, 0, 'The mocked application regression makes no model requests.');
} finally {
  globalThis.fetch = savedFetch;
}

console.log('ACRA/MOM statutory knowledge rules passed (7 complete source families, transition-date guards and numeric/polarity mutations).');
