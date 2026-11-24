import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { createAuthorityEvidencePresentation } from '../../src/utils/authorityEvidencePresentation.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';
import { ACRA_MOM_KNOWLEDGE_RULES_20261027B } from '../../src/retrieval/acraMomKnowledge20261027b.ts';
import { STATUTORY_WORKFLOW_RULES_20261029 } from '../../src/retrieval/statutoryWorkflows20261029.ts';
import { supportMomAcraMasExpansionRule } from '../../src/retrieval/momAcraMasExpansionRules.ts';
import { loadStatutoryKnowledgeSources } from '../../scripts/load_statutory_knowledge_sources.mjs';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';

const knowledgePages = await loadStatutoryKnowledgeSources(fileURLToPath(new URL('../fixtures/statutoryKnowledge20261027b', import.meta.url)));
const workflowPages = await loadStatutoryKnowledgeSources(fileURLToPath(new URL('../fixtures/statutoryWorkflows20261029', import.meta.url)));
const pages = new Map([...knowledgePages, ...workflowPages].map(page => [page.sourceUrl, {
  authority: page.authority, body: page.body, type: page.contentType
}]));
const acraSecretaryPage = knowledgePages.find(page => page.filename === 'acra-company-secretary.txt');
const momAnnualLeaveRule = ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'MOM_ANNUAL_LEAVE_ENTITLEMENT');
const cpfRefundRule = STATUTORY_WORKFLOW_RULES_20261029.find(rule => rule.id === 'CPF_CONTRIBUTION_REFUND_DEADLINES');
const masAppointmentRule = STATUTORY_WORKFLOW_RULES_20261029.find(rule => rule.id === 'MAS_LFMC_KEY_APPOINTMENTS');
assert.ok(acraSecretaryPage && momAnnualLeaveRule && cpfRefundRule && masAppointmentRule,
  'the four requested practical issues already have retained official source fixtures and source rules');
const foreignCompanySecretaryQuery = 'Our company was registered in Singapore as a foreign company four months ago and has one director. Can that director become company secretary, or may we leave the company secretary position empty until the first annual return?';
assert.equal(supportMomAcraMasExpansionRule({ authority: 'ACRA', topicId: 'acra_company-secretary',
  query: foreignCompanySecretaryQuery, subject: 'ACRA company secretary appointment and sole-director requirements',
  sourceText: acraSecretaryPage.body.toString('utf8'), officialUrl: acraSecretaryPage.sourceUrl }), false,
'the local-company secretary excerpt does not establish requirements for a foreign company');

const cases = [
  {
    id: 'novel-acra-secretary-company-facts', authority: 'ACRA', url: acraSecretaryPage.sourceUrl,
    query: 'Our Singapore private company was incorporated four months ago and has one director. Can that director also become the company secretary, or may we leave the secretary position empty until the first annual return?',
    expected: /appointed within six months of successful registration[\s\S]*sole director cannot also be the company secretary/i,
    forbidden: /annual return extends the six.month appointment period/i
  },
  {
    id: 'novel-cpf-discovery-overpayment', authority: 'CPF', url: cpfRefundRule.officialUrl,
    query: 'We discovered an ordinary CPF overpayment last week, but cannot yet locate the payment record. May we use the discovery date to set our refund deadline, and can we wait for CPF Board to refund us before returning the employee\'s share?',
    expected: /immediately and no later than one year from payment[\s\S]*PAYMENTS RECEIVED ON[\s\S]*return the employee share/i,
    forbidden: /one-year outer limit is \d{2}\/\d{2}\/\d{4}/i
  },
  {
    id: 'novel-mom-probation-unknown-balance', authority: 'MOM', url: momAnnualLeaveRule.officialUrl,
    query: 'Our Employment Act-covered employee is still on probation after five completed months. Their contract provides fourteen annual-leave days a year, and they took approved unpaid leave. Can we deny annual leave until confirmation, and can you determine the exact balance without knowing the unpaid-leave period or leave already used?',
    expected: /at least three months[\s\S]*even if (?:the employee is )?still on probation[\s\S]*approved unpaid leave/i,
    forbidden: /(?:exact|remaining) balance (?:is|of) \d+(?:\.\d+)? days/i
  },
  {
    id: 'novel-mas-lfmc-subsequent-notifications', authority: 'MAS', url: masAppointmentRule.officialUrl,
    query: 'At our LFMC, an existing director\'s residential address changes and the CEO resigns during the same week. Do both notifications have the same fourteen-day outer limit, and is changing the director\'s particulars treated as a fresh Form 11 appointment approval?',
    expected: /Form 11[\s\S]*row 17|row 17[\s\S]*Form 11/i,
    additionalExpected: /14.day time limit applies to item \(i\), resignation/i,
    forbidden: /14.days applies equally to the director.s address change and CEO resignation/i
  }
];

const modelEndpoint = /(?:generativelanguage\.googleapis\.com|api\.openai\.com|openai\.azure\.com|\/generateContent(?:\?|$)|\/chat\/completions(?:\?|$))/i;
const fetchAttempts = [];
const strictOfflineFetch = async input => {
  const url = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input);
  fetchAttempts.push(url);
  if (modelEndpoint.test(url)) throw new Error(`Unexpected provider/model request: ${url}`);
  const page = pages.get(url);
  if (page) return new Response(page.body, { headers: { 'content-type': page.type } });
  const provider = Object.values(OFFICIAL_SOURCE_DISCOVERY_PROVIDERS).find(candidate => candidate.sitemapUrls?.includes(url));
  if (provider) {
    const sitemap = [...pages].filter(([, item]) => item.authority === provider.authority)
      .map(([sourceUrl]) => `<url><loc>${sourceUrl.replaceAll('&', '&amp;')}</loc></url>`).join('');
    return new Response(`<urlset>${sitemap}</urlset>`, { headers: { 'content-type': 'application/xml' } });
  }
  return new Response('Not present in the retained offline statutory source set', { status: 404 });
};
const previousFetch = globalThis.fetch;
const results = [];
const canonicalUrl = value => {
  const url = new URL(value);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
};
try {
  globalThis.fetch = strictOfflineFetch;
  for (const sample of cases) {
    let workstreams;
    const response = await processAccountingQuery(sample.query, null, 'SFRS_I', undefined, undefined, [], undefined,
      { onAuthorityWorkstreams: value => { workstreams = value; } });
    assert.deepEqual(response.scenarioState.directGroups || [], [], `${sample.id}: advice does not create an accounting journal`);
    assert.ok(workstreams, `${sample.id}: standard processAccountingQuery reaches authority workstreams`);
    const presentation = createAuthorityEvidencePresentation(workstreams);
    const stream = presentation.workstreams.find(item => item.authority === sample.authority);
    assert.ok(stream, `${sample.id}: the source authority is represented`);
    assert.ok(stream.issues.some(issue => issue.evidenceStatus === 'VERIFIED' && issue.operation !== 'UNSUPPORTED'),
      `${sample.id}: a verified source-backed issue is retained`);
    assert.ok(stream.sources.some(source => canonicalUrl(source.officialUrl) === canonicalUrl(sample.url) &&
      source.claims.some(claim => claim.supportKind === 'EXACT_SOURCE_QUOTE' &&
        claim.fetchedSourceBinding?.canonicalUrl &&
        canonicalUrl(claim.fetchedSourceBinding.canonicalUrl) === canonicalUrl(sample.url) &&
        claim.issueIds.some(id => stream.issues.some(issue => issue.id === id)))),
    `${sample.id}: answer claims bind to exact issue quotes from the retained official source`);
    assert.match(response.messageText, new RegExp(`${sample.authority} rule explanation`, 'i'),
      `${sample.id}: the normal application path renders the source-backed explanation`);
    assert.match(response.messageText, sample.expected, `${sample.id}: the answer includes the requested material rule`);
    if (sample.additionalExpected) assert.match(response.messageText, sample.additionalExpected);
    if (sample.forbidden) assert.doesNotMatch(response.messageText, sample.forbidden,
      `${sample.id}: the answer does not infer unsupported case-specific conclusions`);
    results.push({ id: sample.id, scenarioType: response.scenarioState.scenarioType,
      queryIntent: response.scenarioState.queryIntent, officialUrl: sample.url });
  }

  const foreignCompanyResponse = await processAccountingQuery(foreignCompanySecretaryQuery, null, 'SFRS_I', undefined, undefined, [], undefined, {});
  assert.doesNotMatch(foreignCompanyResponse.messageText,
    /ACRA rule explanation:[\s\S]*?(?:appointed within six months of successful registration|sole director cannot also be the company secretary)/i,
    'the full application does not apply the local-company secretary rule to a foreign company');

  const mixedControls = [
    {
      id: 'annual-return-deadline-remains-separate',
      query: 'Our Singapore private company was incorporated four months ago and has one director. Can that director become company secretary, and separately what is the annual return filing deadline?',
      requiredTopics: ['acra_company-secretary', 'acra_annual-returns']
    },
    {
      id: 'explicit-cpf-rate-question-remains-separate',
      query: 'We discovered an ordinary CPF overpayment. What is the refund deadline, and what CPF contribution rate applies to ordinary wages?',
      requiredTopics: ['cpf-adjustments-refunds', 'cpf_contribution_rates']
    },
    {
      id: 'explicit-mas-licence-question-remains-separate',
      query: 'At our LFMC, an existing director\'s residential address changes and the CEO resigns during the same week. Do both notifications have the same fourteen-day outer limit, and is changing the director\'s particulars treated as a fresh Form 11 appointment approval? Separately, how do we renew the CMS licence?',
      requiredTopics: ['mas-lfmc-key-appointments', 'mas-cms-licence']
    }
  ];
  for (const control of mixedControls) {
    const { issuePlan } = reconcileQuestionUnderstanding(control.query, classifyQuestion(control.query),
      { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' });
    const mapped = new Set(issuePlan.issues.flatMap(issue => issue.mappedTopicIds));
    for (const topic of control.requiredTopics) assert.ok(mapped.has(topic),
      `${control.id}: explicit independent request remains separately mapped (${topic}); got ${JSON.stringify(issuePlan.issues.map(issue => issue.mappedTopicIds))}`);
  }

  const exactBalanceQuery = 'Our Employment Act-covered employee is still on probation after five completed months and took approved unpaid leave. Calculate the exact remaining annual leave balance now.';
  const exactBalanceResponse = await processAccountingQuery(exactBalanceQuery, null, 'SFRS_I', undefined, undefined, [], undefined, {});
  assert.doesNotMatch(exactBalanceResponse.messageText, /(?:exact|remaining) balance (?:is|of) \d+(?:\.\d+)? days/i,
    'a direct exact-balance calculation is not fabricated from incomplete leave records');
} finally {
  globalThis.fetch = previousFetch;
}

assert.ok(fetchAttempts.length > 0, 'whole-app regressions use the offline source fixture fetcher');
assert.equal(fetchAttempts.some(url => modelEndpoint.test(url)), false, 'whole-app regressions make no model requests');
assert.deepEqual(cases.filter(sample => !fetchAttempts.includes(sample.url)).map(sample => sample.id), [],
  `all four exact official source URLs were fetched from retained fixtures: ${JSON.stringify(results)}`);
console.log(`Four practical statutory cases passed whole-app source-bound regressions: ${JSON.stringify(results)}.`);
