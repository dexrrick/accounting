import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { createAuthorityEvidencePresentation } from '../../src/utils/authorityEvidencePresentation.ts';
import { renderAuthorityEvidenceResponseText } from '../../src/services/authorityEvidenceResponse.ts';
import { MAS_VCFM_TOOLKIT_URL, supportMomAcraMasExpansionRule } from '../../src/retrieval/momAcraMasExpansionRules.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { selectIrasCpfExpansionQuotes } from '../../src/retrieval/irasCpfExpansionRules.ts';

// Unfamiliar questions use explicit offline semantic fixtures. They exercise the
// production routing/retrieval/verification/render path, not model interpretation.
const fixtureRoot = new URL('../fixtures/statutoryExpansionSources/', import.meta.url);
const examples = [
  { id: 'input-tax', authority: 'IRAS', domain: 'IRAS_GST', population: 'COMPANY', topic: 'iras-gst-input-tax',
    query: 'Which conditions govern a GST-registered business claiming input tax on business purchases?',
    subject: 'General GST input tax claim conditions', file: 'iras-gst-input-tax-page.html',
    title: 'Conditions for Claiming Input Tax',
    url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax',
    answer: /reasonable steps.*Missing Trader Fraud/i },
  { id: 'eci', authority: 'IRAS', domain: 'IRAS_INCOME_TAX', population: 'COMPANY', topic: 'iras-cit-eci',
    query: 'Explain the ECI filing waiver and how nil ECI is determined for a company.',
    subject: 'General ECI filing and waiver requirements', file: 'iras-eci-filing-page.html', title: 'Estimated Chargeable Income (ECI) Filing',
    url: 'https://www.iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-(eci)-filing',
    answer: /both annual revenue.*5 million.*nil ECI/i },
  { id: 'wage-components', authority: 'CPF', domain: 'CPF_PAYROLL', population: 'EMPLOYER', topic: 'cpf-bonus-backpay',
    query: 'For CPF, how are annual bonuses and meal allowances classified compared with reimbursement of office stationery?',
    subject: 'CPF classification of annual bonuses and wage components', file: 'cpf-wage-classification.txt', title: 'What constitutes wages for CPF contributions',
    url: 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions',
    answer: /Ordinary Wages.*14th.*Additional Wages/i },
  { id: 'deductions', authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYER', topic: 'mom-salary-payment',
    query: 'What limits apply to salary deductions for loss or damage under the Employment Act?',
    subject: 'Employment Act salary deduction grounds and limits', file: 'mom-salary-deductions-native.html', title: 'Salary deductions',
    url: 'https://www.mom.gov.sg/employment-practices/salary/salary-deductions',
    answer: /salary deductions are limited to authorised reasons[\s\S]*damage or loss after an inquiry establishes the employee.s direct fault[\s\S]*opportunity to explain[\s\S]*25% of one month.s salary in a lump sum[\s\S]*50% cap per salary period/i },
  { id: 'secretary', authority: 'ACRA', domain: 'ACRA_CORPORATE', population: 'COMPANY', topic: 'acra_company-secretary',
    query: 'Can the sole director serve as company secretary, and what residence and vacancy rules apply?',
    subject: 'Company secretary appointment and eligibility requirements', file: 'acra-company-secretary-native.html',
    title: 'Choosing company directors & other key officers',
    url: 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/',
    answer: /sole director.*secretary|secretary.*sole director/i },
  { id: 'vcfm-declaration', authority: 'MAS', domain: 'MAS_FUNDS', population: 'COMPANY', topic: 'mas-regulatory-reporting',
    query: 'What annual declarations must a VCFM file with MAS after financial year end?',
    subject: 'VCFM annual declaration filing requirements', file: 'mas-vcfm-toolkit.pdf',
    title: 'Compliance Toolkit for Venture Capital Fund Managers', url: MAS_VCFM_TOOLKIT_URL,
    answer: /Form 25A.*1 month|one month.*Form 25A/i },
  { id: 'vcfm-nil-misconduct', authority: 'MAS', domain: 'MAS_FUNDS', population: 'COMPANY', topic: 'mas-regulatory-reporting',
    query: 'When must a VCFM submit a nil return of misconduct if it reported no misconduct in the preceding calendar year?',
    subject: 'VCFM nil return of misconduct filing requirements', file: '../statutoryKnowledge20261030/mas-misconduct-faq-native.pdf',
    title: 'FAQs on Misconduct Reporting Notices under the FAA, IA and SFA',
    url: 'https://www.mas.gov.sg/-/media/mas/regulations-and-financial-stability/regulations-guidance-and-licensing/financial-advisers/faq/faqs-on-misconduct-reporting-notices-under-the-faa-ia-and-sfa.pdf',
    answer: /not required to submit[\s\S]*2026[\s\S]*2027[\s\S]*do not require nil declarations/i }
];
const nilExample = examples.find(example => example.id === 'vcfm-nil-misconduct');
examples.push(
  { ...nilExample, id: 'vcfm-nil-historical-date', shouldExplain: false,
    query: 'As of 2025, when must a VCFM submit a nil return if it reported no misconduct in the preceding calendar year?' },
  { ...nilExample, id: 'vcfm-nil-historical-rule', shouldExplain: false,
    query: 'What were the VCFM nil return requirements if it reported no misconduct in the preceding calendar year?' }
);
const emptyLocal = { retrieveSources: async () => [], getSourceById: () => undefined };
const outcomes = [];
const failures = [];
for (const example of examples) {
  try {
  const interpretation = validateSemanticQuestionInterpretation({
    jurisdiction: ['Singapore'], authorityCandidates: [example.authority], contextualAuthorities: [],
    domain: example.domain, population: example.population, primarySubject: example.subject,
    concepts: [{ concept: example.subject, role: 'PRIMARY' }], requestedOperation: 'EXPLAIN_RULE',
    requiresUserSpecificFacts: false, calculationRequested: false, factsExplicitlyProvided: [], confidence: 0.98,
    issues: [{ subject: example.subject, population: example.population, domain: example.domain,
      governingAuthorities: [example.authority], contextualAuthorities: [], operation: 'EXPLAIN_RULE',
      mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.98 }]
  }, example.query);
  assert.ok(interpretation, `${example.id}: valid explicit offline semantic fixture`);
  const understanding = { mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED', interpretation };
  const { issuePlan } = reconcileQuestionUnderstanding(example.query, classifyQuestion(example.query), understanding);
  assert.ok(issuePlan.issues.some(issue => issue.mappedTopicIds.includes(example.topic)),
    `${example.id}: original wording maps the existing topic: ${JSON.stringify(issuePlan.issues)}`);
  const raw = readFileSync(new URL(example.file, fixtureRoot));
  const pdf = example.file.endsWith('.pdf');
  const nativeBody = example.file.endsWith('.html') ? raw.toString('utf8')
    : `<p>${raw.toString('utf8').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('\n', '<br>')}</p>`;
  // Native section fragments retain their markup; only surrounding identity
  // metadata is supplied when the captured excerpt omits the page header.
  const html = pdf || /<html\b/i.test(nativeBody) ? raw
    : `<html><head><title>${example.authority} | ${example.title}</title></head><body><main><h1>${example.authority} | ${example.title}</h1>${nativeBody}</main></body></html>`;
  const fetches = [];
  const customFetch = async value => {
    const url = String(value);
    fetches.push(url);
    if (url === example.url) return new Response(html, { headers: { 'content-type': pdf ? 'application/pdf' : 'text/html; charset=utf-8' } });
    if (OFFICIAL_SOURCE_DISCOVERY_PROVIDERS[example.authority].sitemapUrls.includes(url)) {
      return new Response(`<urlset><url><loc>${example.url.replaceAll('&', '&amp;')}</loc></url></urlset>`,
        { headers: { 'content-type': 'application/xml' } });
    }
    return new Response('Not available in offline fixture', { status: 404 });
  };
  const result = await buildAuthorityWorkstreams(example.query, issuePlan, {
    retriever: emptyLocal, referenceDate: '2026-10-26', questionUnderstanding: understanding,
    groundingOptions: { webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { customFetch, timeoutMs: 3000, useCache: false } }
  });
  const presentation = createAuthorityEvidencePresentation(result);
  const answer = renderAuthorityEvidenceResponseText(presentation, false);
  const stream = presentation.workstreams.find(item => item.authority === example.authority);
  const outcome = { id: example.id, question: example.query, expectedExplanation: example.shouldExplain !== false, evidenceStatus: stream?.evidenceStatus,
    answer, fetches, result };
  outcomes.push(outcome);
  // Optional local evidence output also preserves failed cases for diagnosis.
  if (process.env.STATUTORY_EXPANSION_REPORT) writeFileSync(process.env.STATUTORY_EXPANSION_REPORT,
    JSON.stringify({ scope: 'OFFLINE_PRODUCTION_PATH_EXPLICIT_SEMANTIC_FIXTURES', outcomes }, null, 2));
  const diagnostics = result.workstreams.flatMap(item => item.issues).map(issue => ({
    gaps: issue.gaps.map(gap => gap.code), attempts: issue.admissionDiagnostics?.retrievalEvidenceQualityTrace?.attempts
  }));
  if (example.shouldExplain === false) {
    assert.doesNotMatch(answer, /MAS rule explanation/, `${example.id}: current guidance cannot establish a historical rule`);
    assert.equal(stream?.evidenceStatus, 'INSUFFICIENT');
    assert.equal(fetches.includes(example.url), false, 'Historical scope cannot fetch the current toolkit as historical proof');
    continue;
  }
  assert.match(answer, new RegExp(`${example.authority} rule explanation`), `${example.id}: usable explanation: ${JSON.stringify(diagnostics)}`);
  assert.match(answer, example.answer, `${example.id}: substantive rule conditions are rendered`);
  assert.ok(stream.sources.some(source => source.officialUrl === example.url), `${example.id}: citation is bound to supplied official document`);
  if (example.id === 'deductions') {
    const issue = result.workstreams.find(item => item.authority === example.authority).issues[0];
    const registeredRecord = issue.sources.find(record => record.tags?.includes(example.topic));
    const scopedRecord = issue.sources.find(record => record.id.startsWith('LIVE_TOPIC_iras-authority-query-issue-mom-'));
    assert.ok(registeredRecord && scopedRecord, 'Registered and issue-scoped MOM excerpts remain distinct admitted records.');
    assert.notEqual(registeredRecord.id, scopedRecord.id);
    assert.equal(registeredRecord.canonicalSourceUrl, example.url);
    assert.equal(scopedRecord.canonicalSourceUrl, example.url);
    assert.equal(registeredRecord.documentHash, scopedRecord.documentHash,
      'The separate scopes remain bound to the same fetched document revision.');
    const supportRequest = { authority: example.authority, topicId: example.topic, query: example.query,
      subject: example.subject, officialUrl: example.url };
    assert.equal(supportMomAcraMasExpansionRule({ ...supportRequest, sourceText: registeredRecord.sourceText }), true,
      'The registered MOM excerpt retains its complete rule proof.');
    assert.equal(supportMomAcraMasExpansionRule({ ...supportRequest, sourceText: scopedRecord.sourceText }), true,
      'The issue-scoped excerpt retains all rule proof after punctuation-independent list selection.');
    const issueScopedWithoutOpportunity = scopedRecord.sourceText
      .split(/\r?\n\s*\r?\n/)
      .filter(block => !/\bopportunity to explain\b/i.test(block))
      .join('\n\n');
    assert.notEqual(issueScopedWithoutOpportunity, scopedRecord.sourceText,
      'The insufficient-evidence control removes a source block containing a required condition.');
    assert.equal(supportMomAcraMasExpansionRule({ ...supportRequest, sourceText: issueScopedWithoutOpportunity }), false,
      'The issue-scoped excerpt becomes insufficient when its opportunity-to-explain condition is removed.');
    assert.equal(fetches.filter(url => url === example.url).length, 1,
      'Both topic scopes reuse one successful page fetch.');
    assert.ok(scopedRecord.tags?.some(tag => tag.startsWith('iras-authority-query-issue-mom-')));
    assert.ok(issue.verifiedClaims.length > 0 && issue.verifiedClaims.every(claim =>
      [registeredRecord.id, scopedRecord.id].includes(claim.recordId)),
    'Each verified MOM claim stays bound to one admitted record identity.');
    const presentedSource = stream.sources.find(source => source.officialUrl === example.url);
    const exactClaims = presentedSource?.claims.filter(claim => claim.supportKind === 'EXACT_SOURCE_QUOTE') || [];
    const recordsById = new Map(issue.sources.map(record => [record.id, record]));
    assert.ok(exactClaims.length > 0 && exactClaims.every(claim => {
      const binding = claim.fetchedSourceBinding;
      const record = binding && recordsById.get(binding.recordId);
      return Boolean(record && binding.documentHash === record.documentHash &&
        binding.canonicalUrl === record.canonicalSourceUrl && record.canonicalSourceUrl === example.url);
    }), 'Every exact MOM quote presentation retains its own record, hash and canonical URL binding.');
    const registeredContext = issue.admittedDocumentContexts?.find(context => context.recordId === registeredRecord.id);
    const scopedContext = issue.admittedDocumentContexts?.find(context => context.recordId === scopedRecord.id);
    assert.ok(registeredContext && scopedContext, 'Each fetched record keeps its own admitted document context.');
    assert.equal(registeredContext.documentHash, registeredRecord.documentHash);
    assert.equal(registeredContext.canonicalUrl, registeredRecord.canonicalSourceUrl);
    assert.equal(scopedContext.documentHash, scopedRecord.documentHash);
    assert.equal(scopedContext.canonicalUrl, scopedRecord.canonicalSourceUrl);
  }
  if (pdf) assert.ok(result.workstreams.flatMap(item => item.issues).flatMap(issue => issue.sources || [])
    .some(source => source.sourceLocator?.sourceType === 'PDF') ||
    result.workstreams.some(item => item.sources?.some(source => source.sourceLocator?.sourceType === 'PDF')),
  'MAS source retains its PDF provenance');
  } catch (error) {
    failures.push(`${example.id}: ${error.message}`);
  }
}
assert.deepEqual(failures, [], 'All unfamiliar statutory scenarios must complete the production evidence path');
const generalInputConditions = selectIrasCpfExpansionQuotes({ authority: 'IRAS', topicId: 'iras-gst-input-tax',
  query: examples[0].query, subject: examples[0].subject, officialUrl: examples[0].url,
  sourceText: readFileSync(new URL(examples[0].file, fixtureRoot), 'utf8') }).join('\n\n');
for (const detail of ['staff medical insurance', 'private household purchases']) {
  const label = `GST input tax recovery for ${detail}`;
  assert.notEqual(supportGeneralIrasRuleConcept({ sourceText: generalInputConditions, domainId: 'IRAS_GST',
    topicIds: ['iras-gst-input-tax'], subject: 'general conditions for claiming input tax', population: 'COMPANY',
    concepts: [{ id: 'specific-input-tax-treatment', label, terms: [label] }] }), true,
  'The full general checklist does not establish detailed treatment for a distinct requested concept');
}
console.log(`Statutory expansion production-path regressions passed (${outcomes.filter(item => item.expectedExplanation).length} unfamiliar positive scenarios, ${outcomes.filter(item => !item.expectedExplanation).length} historical controls; no live model or source calls).`);
