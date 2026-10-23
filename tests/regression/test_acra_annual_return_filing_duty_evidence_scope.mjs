import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { supportsAcraAnnualReturnFilingRule } from '../../src/retrieval/acraAnnualReturnFilingRule.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';

const fixture = JSON.parse(await readFile(new URL('../fixtures/acra-company-guidance-2026-10-10.json', import.meta.url), 'utf8'))
  .find(page => page.name === 'annual');
assert.ok(fixture, 'The retained official ACRA annual-return page fixture is available.');

const title = 'Deadline & requirements for annual returns | Accounting and Corporate Regulatory Authority';
const query = 'Under ACRA guidance, must Singapore-incorporated companies file annual returns? Explain the general filing duty using official ACRA guidance. Do not calculate a deadline or create journal entries.';
const understanding = {
  mode: 'SEMANTIC_INTERPRETATION',
  assessmentStatus: 'PASSED',
  interpretation: {
    jurisdiction: ['Singapore'],
    authorityCandidates: ['ACRA'],
    contextualAuthorities: [],
    domain: 'ACRA_CORPORATE',
    population: 'COMPANY',
    primarySubject: 'annual return filing duty',
    concepts: [
      { concept: 'annual return filing duty', role: 'PRIMARY' },
      { concept: 'filing requirement', role: 'RELATED' }
    ],
    requestedOperation: 'EXPLAIN_RULE',
    requiresUserSpecificFacts: false,
    calculationRequested: false,
    factsExplicitlyProvided: [],
    confidence: 0.98,
    issues: [{
      subject: 'annual return filing duty',
      population: 'COMPANY',
      domain: 'ACRA_CORPORATE',
      governingAuthorities: ['ACRA'],
      contextualAuthorities: [],
      operation: 'EXPLAIN_RULE',
      mappedTopicIds: ['acra_annual-returns'],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 0.98
    }]
  }
};

assert.ok(validateSemanticQuestionInterpretation(understanding.interpretation, query));
const reconciled = reconcileQuestionUnderstanding(query, classifyQuestion(query), understanding);
const issue = reconciled.issuePlan.issues.find(item => item.governingAuthorities.includes('ACRA'));
assert.ok(issue);
assert.equal(issue.subject, 'annual return filing duty');
assert.equal(issue.operation, 'EXPLAIN_RULE');
assert.ok(issue.mappedTopicIds.includes('acra_annual-returns'));

const provider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS.ACRA;
const offlineRetriever = { retrieveSources: async () => [], getSourceById: () => undefined };
const response = body => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

async function run(pageHtml = fixture.html, {
  runQuery = query,
  issuePlan = reconciled.issuePlan,
  questionUnderstanding = understanding,
  providers
} = {}) {
  const calls = [];
  const customFetch = async url => {
    calls.push(url);
    if (provider.sitemapUrls.includes(url)) {
      return response(`<urlset><url><loc>${fixture.url}</loc></url></urlset>`);
    }
    if (url === fixture.url) return response(pageHtml);
    if (url.endsWith('/robots.txt')) return new Response('not found', { status: 404 });
    if (url.startsWith('https://html.duckduckgo.com/html/') || url.startsWith('https://r.jina.ai/')) {
      return new Response('not found', { status: 404 });
    }
    throw new Error(`Unexpected offline fetch: ${url}`);
  };

  const result = await buildAuthorityWorkstreams(runQuery, issuePlan, {
    questionUnderstanding,
    retriever: offlineRetriever,
    providers,
    referenceDate: '2026-10-14',
    groundingOptions: {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { customFetch, timeoutMs: 500, useCache: false }
    }
  });
  if (!providers?.ACRA) {
    assert.ok(calls.includes(fixture.url), 'Only the retained official ACRA fixture page supplies evidence.');
  }
  const acra = result.workstreams.find(stream => stream.authority === 'ACRA');
  assert.ok(acra);
  return { result, evidence: acra.issues.find(item => item.subject === issue.subject) };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('OFFLINE_FETCH_BLOCKED'); };
try {
  const { evidence } = await run();
  assert.equal(evidence.evidenceStatus, 'VERIFIED');
  assert.ok(evidence.verifiedClaims.length > 0);
  for (const claim of evidence.verifiedClaims) {
    const record = evidence.sources.find(item => item.id === claim.recordId);
    assert.ok(record);
    const sourceBlocks = record.sourceText.split(/\r?\n[\t ]*\r?\n+/).map(block => block.trim()).filter(Boolean);
    assert.ok(sourceBlocks.includes(claim.quote.trim()), 'A general-duty quote is one complete original source block.');
    assert.match(claim.quote, /\bcompanies?\b.{0,80}\b(?:must|shall|required to)\b.{0,50}\bfile\b.{0,40}\bannual returns?\b/i,
      'The retained quote directly supports the company annual-return filing duty.');
    assert.doesNotMatch(claim.quote, /\b(?:IRAS|Inland Revenue Authority|tax(?:es| return| returns| filing))\b/i,
      'An ACRA duty claim does not publish the adjacent IRAS tax obligation.');
    assert.doesNotMatch(claim.quote, /\b(?:deadlines?|due dates?|penalt(?:y|ies)|fines?|fees?|enforcement action)\b/i,
      'The general duty response does not expand into separate timing or penalty guidance.');
  }
  assert.equal(evidence.verifiedClaims.some(claim => /Deadline\s*&|Annual filing requirements|Annual return filing with ACRA/i.test(claim.quote)), false,
    'Headings and table labels are not promoted as duty claims.');

  const directParagraph = 'All companies registered in Singapore must file an annual return with ACRA each year.';
  assert.equal(supportsAcraAnnualReturnFilingRule(directParagraph), true,
    'An exact standalone operative paragraph supports the duty without a literal “filing” token.');
  assert.ok(evidence.verifiedClaims.some(claim => claim.quote.includes(directParagraph) &&
    /This applies as long as your company is listed as [“"]?live[”"]? with us\./i.test(claim.quote) &&
    !/\bfiling\b/i.test(claim.quote)),
  'The workstream retains the complete source paragraph and its live-company qualification without trimming it.');

  const directDutyHtml = 'All companies registered in Singapore <b>must file</b> an annual return with ACRA each year. This applies as long as your company is listed as “<b>live</b>” with us.';
  const replaceDirectDutyParagraphs = mixedGovernorParagraph => {
    let replaced = 0;
    const page = fixture.html.replaceAll(directDutyHtml, () => {
      replaced += 1;
      return mixedGovernorParagraph;
    });
    assert.equal(replaced, 1, 'The retained fixture has one clean direct-duty table paragraph.');
    return page;
  };
  const mixedGovernorParagraph = 'All companies registered in Singapore must file an annual return with ACRA each year. File your tax return with IRAS.';
  const mixedGovernorPage = replaceDirectDutyParagraphs(mixedGovernorParagraph);
  const mixedGovernor = await run(mixedGovernorPage);
  assert.equal(mixedGovernor.evidence.evidenceStatus, 'INSUFFICIENT',
    'An ACRA duty paragraph containing an IRAS tax-filing instruction is rejected whole.');
  assert.deepEqual(mixedGovernor.evidence.verifiedClaims, []);

  const splitIrasReferenceParagraph = 'All companies registered in Singapore must file an annual return with ACRA each year. You must file a tax return. Submit it to IRAS.';
  const splitIrasReference = await run(replaceDirectDutyParagraphs(splitIrasReferenceParagraph));
  assert.equal(splitIrasReference.evidence.evidenceStatus, 'INSUFFICIENT',
    'Tax filing and IRAS references split across sentences still reject the whole mixed paragraph.');
  assert.deepEqual(splitIrasReference.evidence.verifiedClaims, []);

  const providerSubstringQuote = 'All companies registered in Singapore must file an annual return with ACRA each year.';
  const cleanRecord = evidence.sources.find(record => record.sourceText.includes(providerSubstringQuote));
  assert.ok(cleanRecord, 'The retained official fixture supplies a verified clean-duty source paragraph.');
  const providerSubstringControl = await run(fixture.html, {
    providers: {
      ACRA: {
        authority: 'ACRA',
        async retrieve() {
          return {
            candidates: [cleanRecord],
            claims: [{ text: providerSubstringQuote, quote: providerSubstringQuote, recordId: cleanRecord.id }],
            evidenceQualityTrace: {
              selectedRecordIds: [cleanRecord.id],
              finalVerifiedUrls: [cleanRecord.officialSourceUrl],
              attempts: [{
                topicId: 'acra_annual-returns', fetchStatus: 'SUCCESS', titleMatched: true,
                contentMatched: true, finalUrl: cleanRecord.officialSourceUrl
              }]
            }
          };
        }
      }
    }
  });
  assert.equal(providerSubstringControl.evidence.lifecycle.admitted, true);
  assert.equal(providerSubstringControl.evidence.evidenceStatus, 'INSUFFICIENT',
    'A provider-supplied sentence substring cannot bypass the complete source-paragraph boundary.');
  assert.deepEqual(providerSubstringControl.evidence.verifiedClaims, []);

  const introOnlyPage = fixture.html.replace(/All companies in Singapore must file annual returns with ACRA on time to avoid penalties of up to \$600\. Deadlines depend on company type and financial year end \(FYE\)\./, 'Annual returns are online forms that provide updated information about Singapore companies and their officers.')
    .replace(/All companies registered in Singapore <b>must file<\/b> an annual return with ACRA each year\. This applies as long as your company is listed as “<b>live<\/b>” with us\./, 'Annual returns are online forms that provide updated information about registered Singapore companies and their officers.');
  const introOnly = await run(introOnlyPage);
  assert.equal(introOnly.evidence.evidenceStatus, 'INSUFFICIENT',
    'A topic-like introductory paragraph without an operative filing duty remains insufficient.');
  assert.deepEqual(introOnly.evidence.verifiedClaims, []);

  const mixedQuery = 'Under ACRA guidance, must Singapore-incorporated companies file annual returns? Explain the general filing duty using official ACRA guidance. Do not calculate a deadline or create journal entries. Separately, what corporate income tax filing requirements apply to Singapore companies?';
  const mixedUnderstanding = {
    mode: 'SEMANTIC_INTERPRETATION',
    assessmentStatus: 'PASSED',
    interpretation: {
      ...understanding.interpretation,
      authorityCandidates: ['ACRA', 'IRAS'],
      domain: 'UNKNOWN',
      primarySubject: 'annual return filing duty and corporate income tax filing requirements',
      concepts: [
        ...understanding.interpretation.concepts,
        { concept: 'corporate income tax filing requirements', role: 'RELATED' }
      ],
      issues: [
        ...understanding.interpretation.issues,
        {
          subject: 'corporate income tax filing requirements',
          population: 'COMPANY',
          domain: 'IRAS_INCOME_TAX',
          governingAuthorities: ['IRAS'],
          contextualAuthorities: [],
          operation: 'EXPLAIN_RULE',
          mappedTopicIds: ['iras-cit-returns'],
          evidenceRequirement: 'AUTHORITATIVE_SOURCE',
          confidence: 0.98
        }
      ]
    }
  };
  assert.ok(validateSemanticQuestionInterpretation(mixedUnderstanding.interpretation, mixedQuery));
  const mixedPlan = reconcileQuestionUnderstanding(mixedQuery, classifyQuestion(mixedQuery), mixedUnderstanding).issuePlan;
  const mixed = await run(fixture.html, {
    runQuery: mixedQuery,
    issuePlan: mixedPlan,
    questionUnderstanding: mixedUnderstanding,
    providers: { IRAS: { authority: 'IRAS', async retrieve() { return { candidates: [], claims: [] }; } } }
  });
  const mixedAcraIssue = mixed.result.workstreams.find(stream => stream.authority === 'ACRA')?.issues[0];
  const mixedIrasIssue = mixed.result.workstreams.find(stream => stream.authority === 'IRAS')?.issues[0];
  assert.equal(mixedAcraIssue?.evidenceStatus, 'VERIFIED',
    'The independently requested IRAS issue does not prevent the ACRA duty issue from using its own source block.');
  assert.equal(mixedIrasIssue?.evidenceStatus, 'INSUFFICIENT',
    'ACRA material does not satisfy the separately requested IRAS filing issue.');
  assert.equal(mixed.result.status, 'INSUFFICIENT');
  assert.ok(mixedAcraIssue.verifiedClaims.every(claim => !/\b(?:IRAS|tax(?:es| return| returns| filing))\b/i.test(claim.quote)));
} finally {
  globalThis.fetch = originalFetch;
}
