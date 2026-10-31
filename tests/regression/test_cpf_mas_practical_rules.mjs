import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { defaultQueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { OFFICIAL_SOURCE_DISCOVERY_PROVIDERS } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';
import { createAuthorityEvidencePresentation } from '../../src/utils/authorityEvidencePresentation.ts';
import { renderAuthorityEvidenceResponseText } from '../../src/services/authorityEvidenceResponse.ts';
import {
  getCpfMasPracticalRuleEvidence,
  isCpfMasPracticalRuleComponentQuote,
  provesCpfMasPracticalRuleSource
} from '../../src/retrieval/cpfMasPracticalRules.ts';
import { verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';

const cpfUrl = 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions';
const masUrl = 'https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing';
const cpfTitle = 'CPF Board | What constitutes wages for CPF contributions';
const masTitle = 'Fund Management Licensing | Monetary Authority of Singapore';
const cpfBody = 'Wages which are not classified as Ordinary Wages will be Additional Wages for the month. For example, annual performance bonus.';

const lfmcCmsTopics = defaultQueryTopicResolver.decomposeQuery('Does an LFMC need a CMS licence?').topics.map(topic => topic.id);
assert.ok(lfmcCmsTopics.includes('mas-lfmc'), 'LFMC-only CMS licensing wording routes to the existing LFMC topic');
assert.ok(!lfmcCmsTopics.includes('mas-cms-licence'), 'the generic CMS topic is deduplicated when the same clause explicitly scopes LFMC');
const compoundCmsTopics = defaultQueryTopicResolver.decomposeQuery(
  'Does an LFMC need a CMS licence? Separately, when is a CMS licence required for another regulated activity?'
).topics.map(topic => topic.id);
assert.ok(compoundCmsTopics.includes('mas-lfmc') && compoundCmsTopics.includes('mas-cms-licence'),
  'a separately asked CMS licensing question is retained alongside the LFMC issue');
assert.ok(defaultQueryTopicResolver.decomposeQuery('When is a CMS licence required?').topics
  .some(topic => topic.id === 'mas-cms-licence'), 'a bare CMS query retains its generic topic routing');
const distinctActivityCmsTopics = defaultQueryTopicResolver.decomposeQuery(
  'Does an LFMC need a separate CMS licence for dealing in securities?'
).topics.map(topic => topic.id);
assert.ok(distinctActivityCmsTopics.includes('mas-lfmc') && distinctActivityCmsTopics.includes('mas-cms-licence'),
  'a distinct securities-dealing licence question retains its separate CMS topic');
assert.ok(defaultQueryTopicResolver.decomposeQuery(
  'Does an LFMC need a separate CMS licence to deal in securities?'
).topics.some(topic => topic.id === 'mas-cms-licence'), 'the singular verb form also keeps a separate activity in CMS scope.');

const cpfNativeAwCardPage = `<html><head><title>${cpfTitle}</title></head><body><main>
<h1>What constitutes wages for CPF contributions</h1>
<p>Understand how wage payments are classified as Ordinary Wages or Additional Wages.</p>
<h2>Additional Wages (AW)</h2>
<div class="container responsivegrid"><div class="aem-Grid aem-Grid--8">
<div class="action-card carousel panelcontainer"><div class="teaser cmp-action-card"><div class="cmp-teaser cmp-action-card--transparent">
<div class="cmp-teaser__content"><div class="action-card-header headline-5">What are Additional Wages?</div>
<div class="cmp-teaser__description" data-external-icon="true"><p>Wages which are not classified as Ordinary Wages will be Additional Wages for the month.</p><p>For example, annual performance bonus.</p></div>
</div></div></div></div></div></div></main></body></html>`;
const masGeneralRule = 'If your company wishes to conduct fund management activities regulated under the Securities and Futures Act 2001 (SFA), it must apply to be a licensed fund management company (LFMC) that holds a Capital Markets Services (CMS) licence.';
const masExemption = 'If your company is able to operate under an existing class exemption, it does not require a licence.';

const samples = [
  {
    authority: 'CPF', topicId: 'cpf-additional-wages', domain: 'CPF_PAYROLL', population: 'EMPLOYER',
    subject: 'Additional Wages classification', query: 'Under CPF Board guidance, what are Additional Wages?',
    url: cpfUrl, title: cpfTitle, sourcePublisher: 'Central Provident Fund Board (CPF Board)',
    page: `<html><head><title>${cpfTitle}</title></head><body><main><h1>What constitutes wages for CPF contributions</h1><h2>Additional Wages (AW)</h2><p>${cpfBody}</p></main></body></html>`,
    expected: /CPF classifies wages that are not Ordinary Wages as Additional Wages for that month\./
  },
  {
    authority: 'MAS', topicId: 'mas-lfmc', domain: 'MAS_FUNDS', population: 'COMPANY',
    subject: 'Licensed Fund Management Company (LFMC) licensing',
    query: 'Does an LFMC need a CMS licence?',
    url: masUrl, title: masTitle, sourcePublisher: 'Monetary Authority of Singapore (MAS)',
    page: `<html><head><title>${masTitle}</title></head><body><main><h1>Fund Management Licensing</h1><p>${masGeneralRule}</p><p>${masExemption}</p></main></body></html>`,
    expected: /regulated under the Securities and Futures Act 2001 must apply to be a licensed fund management company holding a Capital Markets Services licence[\s\S]*existing class exemption does not require a licence/i
  }
];

const htmlResponse = text => new Response(text, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const noLocalSources = { retrieveSources: async () => [], getSourceById: () => undefined };

function semanticInterpretationFor(sample) {
  return {
    mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED',
    interpretation: {
      jurisdiction: ['Singapore'], authorityCandidates: [sample.authority], contextualAuthorities: [],
      domain: sample.domain, population: sample.population, primarySubject: sample.subject,
      concepts: [{ concept: sample.subject, role: 'PRIMARY' }], requestedOperation: 'EXPLAIN_RULE',
      requiresUserSpecificFacts: false, calculationRequested: false, factsExplicitlyProvided: [], confidence: 0.98,
      issues: [{
        subject: sample.subject, population: sample.population, domain: sample.domain,
        governingAuthorities: [sample.authority], contextualAuthorities: [], operation: 'EXPLAIN_RULE',
        mappedTopicIds: [sample.topicId], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.98
      }]
    }
  };
}

async function evaluate(sample, { page = sample.page, query = sample.query, topicId = sample.topicId,
  expectedVerified = true, expectedExplanation = true } = {}) {
  const provider = OFFICIAL_SOURCE_DISCOVERY_PROVIDERS[sample.authority];
  const understanding = semanticInterpretationFor({ ...sample, topicId });
  assert.ok(validateSemanticQuestionInterpretation(understanding.interpretation, query));
  const classification = classifyQuestion(query);
  const reconciled = reconcileQuestionUnderstanding(query, classification, understanding);
  const issuePlan = reconciled.issuePlan;
  const issue = issuePlan.issues.find(candidate => candidate.governingAuthorities.includes(sample.authority));
  assert.ok(issue, `${sample.authority} issue survives semantic reconciliation`);
  assert.equal(issue.operation, 'EXPLAIN_RULE');
  assert.ok(issue.mappedTopicIds.includes(topicId), `${sample.authority} maps the existing topic ${topicId}; got ${issue.mappedTopicIds.join(', ')}`);

  const fetchCalls = [];
  const fetchOfficial = async url => {
    fetchCalls.push(url);
    if (provider.sitemapUrls.includes(url)) {
      return htmlResponse(`<urlset><url><loc>${sample.url}</loc></url></urlset>`);
    }
    if (url === sample.url) return htmlResponse(page);
    if (url.endsWith('/robots.txt')) return new Response('not found', { status: 404 });
    if (url.startsWith('https://html.duckduckgo.com/') || url.startsWith('https://r.jina.ai/')) return new Response('not found', { status: 404 });
    throw new Error(`Unexpected official source request: ${url}`);
  };
  const result = await buildAuthorityWorkstreams(query, issuePlan, {
    retriever: noLocalSources, referenceDate: '2026-10-14', questionUnderstanding: understanding,
    groundingOptions: {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { customFetch: fetchOfficial, timeoutMs: 500, useCache: false }
    }
  });
  const stream = result.workstreams.find(item => item.authority === sample.authority);
  assert.ok(stream, `${sample.authority} workstream was retrieved`);
  const issueResult = stream.issues.find(item => item.issueId === issue.id);
  if (!expectedVerified) {
    assert.notEqual(issueResult?.evidenceStatus, 'VERIFIED', 'A contradictory full official page cannot pass discovery evidence checks.');
    assert.equal(getCpfMasPracticalRuleEvidence(query, createAuthorityEvidencePresentation(result).workstreams.find(item => item.authority === sample.authority),
      createAuthorityEvidencePresentation(result).workstreams.find(item => item.authority === sample.authority).issues[0]), undefined);
    return { result, issueResult };
  }
  assert.equal(issueResult?.evidenceStatus, 'VERIFIED', JSON.stringify(issueResult));
  const record = issueResult.sources.find(source => source.officialSourceUrl === sample.url);
  assert.ok(record, 'Fetched official source is admitted to the requested issue');
  assert.equal(record.provenance, 'LIVE_EXTERNAL');
  assert.equal(record.lifecycleState, 'CANDIDATE');
  assert.equal(record.sourceStatus, 'NEEDS_REVIEW');
  assert.ok(fetchCalls.includes(sample.url), 'The page is fetched independently after sitemap discovery');
  assert.ok(issueResult.retrievalTrace.attempts.some(attempt => attempt.topicId === sample.topicId && attempt.fetchStatus === 'SUCCESS'),
    'Discovery trace records successful fetched-page validation for the requested topic');
  assert.ok(record.tags.includes(sample.topicId), 'The admitted page remains bound to its requested coverage topic');
  for (const claim of issueResult.verifiedClaims) assert.ok(record.sourceText.includes(claim.quote), 'Claim is an exact source quote');
  const presentation = createAuthorityEvidencePresentation(result);
  const presentedStream = presentation.workstreams.find(item => item.authority === sample.authority);
  const presentedIssue = presentedStream.issues.find(item => item.id === issue.id);
  const explanation = getCpfMasPracticalRuleEvidence(query, presentedStream, presentedIssue);
  if (expectedExplanation) {
    assert.ok(explanation, `${sample.authority} rule uses verified quotes bound to the issue`);
    assert.equal(explanation.officialUrl, sample.url);
    assert.equal(explanation.authority, sample.authority);
    assert.match(explanation.text, sample.expected);
  } else {
    assert.equal(explanation, undefined, 'The answer helper declines while the required issue-bound quotation is missing.');
  }
  return { result, presentation, presentedStream, presentedIssue, explanation, record };
}

const cpf = await evaluate(samples[0]);
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'MAS', topicId: 'mas-lfmc', subject: 'Licensed Fund Management Company', query: samples[1].query, sourceText: samples[1].page }), true,
  'The full MAS fixture demonstrates both the licensing rule and its class-exemption qualification.');
const mas = await evaluate(samples[1]);
const masExemptionClaimCheck = verifyEvidenceClaims([{
  kind: 'RULE', text: masExemption, quote: masExemption, recordId: mas.record.id
}], [mas.record], {
  missingFacts: [], targetDate: undefined, referenceDate: '2026-10-14', expectedAuthority: 'MAS', expectedDomain: 'MAS_FUNDS'
});
assert.equal(mas.record.domain, 'MAS_FUNDS');
assert.equal(mas.record.sourceText.includes(masExemption), true,
  'The fetched official record retains the class-exemption qualification.');
assert.equal(masExemptionClaimCheck.accepted.some(claim => claim.quote === masExemption), true,
  'The source-exact class-exemption quotation passes independent claim verification.');
assert.equal(masExemptionClaimCheck.rejected.length, 0);
assert.equal(mas.result.workstreams.find(stream => stream.authority === 'MAS').issues[0].verifiedClaims.some(claim => claim.quote === masExemption), true,
  'The exact class-exemption quote remains bound to the MAS issue.');
const cpfResponse = renderAuthorityEvidenceResponseText(cpf.presentation, false);
  assert.match(cpfResponse, /CPF rule explanation:\*\* CPF classifies wages that are not Ordinary Wages as Additional Wages for that month/i);
assert.ok(cpfResponse.includes(cpfUrl), 'The CPF explanation cites the official fetched source.');
const masResponse = renderAuthorityEvidenceResponseText(mas.presentation, false);
assert.match(masResponse, /MAS rule explanation:\*\* A company conducting fund management activities regulated under the Securities and Futures Act 2001 must apply[\s\S]*existing class exemption does not require a licence\./i,
  'The MAS response explains the licensing duty together with its official class-exemption qualification.');
assert.ok(masResponse.includes(masUrl), 'The MAS explanation cites the official fetched source.');
assert.match(masResponse, /Verified official source excerpt/);
const masClaimsFromSeparatePages = structuredClone(mas.presentedStream);
const masSamePageClaims = masClaimsFromSeparatePages.sources[0].claims;
masClaimsFromSeparatePages.sources[0].claims = masSamePageClaims.filter(claim => !claim.text.toLowerCase().includes('class exemption'));
masClaimsFromSeparatePages.sources.push({
  ...masClaimsFromSeparatePages.sources[0],
  key: 'separate-page', title: 'Different MAS page',
  claims: masSamePageClaims.filter(claim => claim.text.toLowerCase().includes('class exemption'))
});
assert.equal(getCpfMasPracticalRuleEvidence(samples[1].query, masClaimsFromSeparatePages, masClaimsFromSeparatePages.issues[0]), undefined,
  'The MAS answer does not combine the duty and exemption claims across sources.');
const masClaimsFromSeparateRevisions = structuredClone(mas.presentedStream);
const masRevisionSource = masClaimsFromSeparateRevisions.sources[0];
const masRevisionExemptionClaim = masRevisionSource.claims.find(claim => claim.text.toLowerCase().includes('class exemption'));
const masFetchedBinding = masRevisionExemptionClaim?.fetchedSourceBinding;
assert.ok(masFetchedBinding, 'The MAS exemption quote retains its fetched-source revision binding.');
assert.equal(masFetchedBinding.recordId, mas.record.id);
assert.equal(masFetchedBinding.documentHash, (mas.record.documentHash || mas.record.contentHash).toLowerCase());
assert.equal(masFetchedBinding.canonicalUrl, mas.record.canonicalSourceUrl);
assert.equal(masFetchedBinding.retrievedAt, mas.record.retrievedAt);
masRevisionExemptionClaim.fetchedSourceBinding = {
  ...masFetchedBinding,
  documentHash: 'a'.repeat(64)
};
assert.equal(getCpfMasPracticalRuleEvidence(samples[1].query, masClaimsFromSeparateRevisions, masClaimsFromSeparateRevisions.issues[0]), undefined,
  'The MAS answer does not combine mandatory and exemption quotes from different document revisions sharing one URL.');
const cpfContradictoryPage = samples[0].page.replace('</main>', '<p>Wages not classified as Ordinary Wages are not Additional Wages.</p></main>');
const cpfContradictionRun = await evaluate(samples[0], { page: cpfContradictoryPage, expectedVerified: false });
assert.ok(cpfContradictionRun.issueResult.retrievalTrace.attempts.some(attempt => attempt.topicId === samples[0].topicId &&
  attempt.fetchStatus === 'TOPIC_MISMATCH'),
  'The full-page contradiction is rejected before claims are selected or presented.');
const cpfNativeAwCardRun = await evaluate(samples[0], { page: cpfNativeAwCardPage });
const cpfNativeAwCardResponse = renderAuthorityEvidenceResponseText(cpfNativeAwCardRun.presentation, false);
assert.match(cpfNativeAwCardResponse, /CPF rule explanation:\*\* CPF classifies wages that are not Ordinary Wages as Additional Wages for that month/i,
  'The fetched native Additional Wages action card supports the official definition response.');
assert.ok(cpfNativeAwCardResponse.includes(cpfUrl), 'The native-card response cites the official CPF page.');

assert.equal(provesCpfMasPracticalRuleSource({ authority: 'CPF', topicId: 'cpf-additional-wages', subject: 'CPF Treatment of Additional Wages', query: samples[0].query, sourceText: cpfBody }), true);
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'CPF', topicId: 'cpf-additional-wages', subject: 'CPF Treatment of Additional Wages', query: samples[0].query, sourceText: 'Wages which are not classified as Ordinary Wages.' }), false,
  'A page with only the category name and no classification result does not pass the full-page proof.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'CPF', topicId: 'cpf-additional-wages', subject: 'CPF Treatment of Additional Wages', query: samples[0].query, sourceText: `${cpfBody} Wages not classified as Ordinary Wages are not Additional Wages.` }), false,
  'Contradictory full-page wording blocks the CPF rule.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'CPF', topicId: 'cpf-additional-wages', subject: 'CPF Treatment of Additional Wages', query: samples[0].query, sourceText: 'No wages which are not classified as Ordinary Wages will be Additional Wages for the month.' }), false,
  'A sentence-level negative polarity before wages blocks the apparently affirmative substring.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'CPF', topicId: 'cpf-ordinary-wages', subject: 'Ordinary Wages', query: samples[0].query, sourceText: cpfBody }), undefined,
  'The Additional Wages proof does not claim other topics.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'CPF', topicId: 'cpf-additional-wages', subject: 'Additional Wages', query: 'How much CPF should I pay on my $2,000 bonus?', sourceText: cpfBody }), undefined,
  'A personal amount calculation stays outside the general definition.');

assert.equal(provesCpfMasPracticalRuleSource({ authority: 'MAS', topicId: 'mas-lfmc', subject: 'Licensed Fund Management Company', query: samples[1].query, sourceText: `${masGeneralRule} ${masExemption}` }), true);
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'MAS', topicId: 'mas-lfmc', subject: 'Licensed Fund Management Company (LFMC)', query: 'Does an LFMC need a CMS licence?', sourceText: `${masGeneralRule} ${masExemption}` }), true,
  'LFMC and CMS wording reaches the complete licensing rule without requiring the phrase fund management.');
assert.equal(provesCpfMasPracticalRuleSource({
  authority: 'MAS', topicId: 'mas-lfmc', subject: 'LFMC separate CMS licence for dealing in securities',
  query: 'Does an LFMC need a separate CMS licence for dealing in securities?', sourceText: `${masGeneralRule} ${masExemption}`
}), undefined, 'general LFMC evidence does not answer a distinct securities-dealing licence question.');
assert.equal(provesCpfMasPracticalRuleSource({
  authority: 'MAS', topicId: 'mas-lfmc', subject: 'LFMC separate CMS licence to deal in securities',
  query: 'Does an LFMC need a separate CMS licence to deal in securities?', sourceText: `${masGeneralRule} ${masExemption}`
}), undefined, 'the singular “deal in securities” phrasing stays outside general LFMC proof.');
assert.equal(provesCpfMasPracticalRuleSource({
  authority: 'MAS', topicId: 'mas-lfmc', subject: 'Licensed Fund Management Company',
  query: 'Does an LFMC need a CMS licence? Separately, does it need a separate CMS licence for dealing in securities?',
  sourceText: `${masGeneralRule} ${masExemption}`
}), true, 'a distinct activity in another clause does not suppress the independently asked general LFMC rule.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'MAS', topicId: 'mas-lfmc', subject: 'CMS licence', query: 'Is a CMS licence required?', sourceText: `${masGeneralRule} ${masExemption}` }), undefined,
  'An unqualified CMS question remains too ambiguous to bind to fund management evidence.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'MAS', topicId: 'mas-lfmc', subject: 'Licensed Fund Management Company (LFMC)', query: 'When is a CMS licence required?', sourceText: `${masGeneralRule} ${masExemption}` }), undefined,
  'LFMC context inferred from a mapped subject does not turn a bare CMS question into an explicit fund-management request.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'MAS', topicId: 'mas-lfmc', subject: 'Licensed Fund Management Company', query: 'Does a VCFM need a CMS licence?', sourceText: `${masGeneralRule} ${masExemption}` }), undefined,
  'The LFMC proof does not answer a VCFM-specific request.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'MAS', topicId: 'mas-lfmc', subject: 'Licensed Fund Management Company', query: samples[1].query, sourceText: masGeneralRule }), false,
  'The MAS general rule cannot be explained without the official class-exemption qualification.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'MAS', topicId: 'mas-lfmc', subject: 'Licensed Fund Management Company', query: samples[1].query, sourceText: `${masGeneralRule} ${masExemption} Even if a class exemption applies, the company must hold a licence.` }), false,
  'Contradictory class-exemption wording blocks the MAS rule.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'MAS', topicId: 'mas-lfmc', subject: 'Licensed Fund Management Company', query: samples[1].query, sourceText: `${masGeneralRule.replace('must apply to be', 'must apply not to be')} ${masExemption}` }), false,
  'A negated licensing duty does not pass merely because the page also has the valid exemption paragraph.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'MAS', topicId: 'mas-lfmc', subject: 'Licensed Fund Management Company', query: samples[1].query, sourceText: `${masGeneralRule} ${masExemption} Companies conducting regulated fund management activities do not need a CMS licence.` }), false,
  'A contradictory general no-licence statement blocks the MAS rule even when the class exemption is valid.');
const masComponentInput = {
  authority: 'MAS', topicId: 'mas-lfmc', subject: samples[1].subject,
  query: samples[1].query, sourceText: samples[1].page
};
assert.equal(isCpfMasPracticalRuleComponentQuote(masComponentInput, masExemption), true,
  'Only the exact class-exemption sentence is admitted as a MAS rule component.');
assert.equal(isCpfMasPracticalRuleComponentQuote({ ...masComponentInput, sourceText: masExemption }, masExemption), false,
  'The exception quote is insufficient without the same page proving the general licensing duty.');
assert.equal(isCpfMasPracticalRuleComponentQuote(masComponentInput, `${masExemption} The company may not need other approvals.`), false,
  'A larger paraphrased quote is not admitted as the exact exception component.');
assert.equal(isCpfMasPracticalRuleComponentQuote({ ...masComponentInput, topicId: 'cpf-additional-wages' }, masExemption), false,
  'The MAS component rule does not qualify a different topic.');
assert.equal(provesCpfMasPracticalRuleSource({ authority: 'MAS', topicId: 'mas-lfmc', subject: 'Licensed Fund Management Company', query: 'Does my company qualify for an LFMC licence exemption?', sourceText: `${masGeneralRule} ${masExemption}` }), undefined,
  'Entity-specific exemption eligibility remains unresolved.');

function cloneCandidateStream(stream) {
  return structuredClone(stream);
}

const cpfWithUnrelatedIncompleteIssue = cloneCandidateStream(cpf.presentedStream);
cpfWithUnrelatedIncompleteIssue.evidenceStatus = 'INSUFFICIENT';
cpfWithUnrelatedIncompleteIssue.applicationStatus = 'UNRESOLVED';
const unrelatedIncompleteIssue = {
  ...cpfWithUnrelatedIncompleteIssue.issues[0],
  id: 'unrelated-corporate-filing-issue',
  subject: 'Unrelated corporate filing question',
  evidenceStatus: 'INSUFFICIENT',
  applicationStatus: 'UNRESOLVED',
  claims: [],
  gaps: ['No mapped authoritative source.']
};
cpfWithUnrelatedIncompleteIssue.issues.push(unrelatedIncompleteIssue);
assert.ok(getCpfMasPracticalRuleEvidence(samples[0].query, cpfWithUnrelatedIncompleteIssue, cpfWithUnrelatedIncompleteIssue.issues[0]),
  'An unrelated incomplete issue does not block this issue’s verified rule answer.');
assert.equal(getCpfMasPracticalRuleEvidence(samples[0].query, cpfWithUnrelatedIncompleteIssue, unrelatedIncompleteIssue), undefined,
  'A request cannot use evidence owned by a different issue subject.');
const wrongAuthority = cloneCandidateStream(cpf.presentedStream);
wrongAuthority.authority = 'MOM';
assert.equal(getCpfMasPracticalRuleEvidence(samples[0].query, wrongAuthority, wrongAuthority.issues[0]), undefined);
const wrongSource = cloneCandidateStream(mas.presentedStream);
wrongSource.sources[0].officialUrl = cpfUrl;
assert.equal(getCpfMasPracticalRuleEvidence(samples[1].query, wrongSource, wrongSource.issues[0]), undefined);
const incompleteMasClaims = cloneCandidateStream(mas.presentedStream);
incompleteMasClaims.sources[0].claims = incompleteMasClaims.sources[0].claims.filter(claim => !claim.text.toLowerCase().includes('class exemption'));
assert.equal(getCpfMasPracticalRuleEvidence(samples[1].query, incompleteMasClaims, incompleteMasClaims.issues[0]), undefined);
const historicalQuery = 'Under MAS guidance, what licensing rule applied in 2023 for fund management?';
assert.equal(getCpfMasPracticalRuleEvidence(historicalQuery, mas.presentedStream, mas.presentedIssue), undefined);

const cpfBaseAndBonusQuery = 'In October 2026, one employee has S$8,700 of Ordinary Wages and a separate annual bonus. Is the CPF-able monthly OW base S$8,700, and does capping OW also prove that none of the bonus attracts CPF?';
const cpfBaseAndBonusClassification = classifyQuestion(cpfBaseAndBonusQuery);
assert.equal(cpfBaseAndBonusClassification.intent, 'STATUTORY_ADVISORY',
  'An OW base/ceiling applicability question remains statutory guidance even when it includes a wage amount.');
assert.equal(cpfBaseAndBonusClassification.calculationRequired, false,
  'A provided OW amount does not request contribution arithmetic.');
assert.equal(cpfBaseAndBonusClassification.journalEntryRequired, false,
  'A base/ceiling question does not request payroll journal entries.');
assert.ok(cpfBaseAndBonusClassification.authorities.includes('CPF'),
  'The base and bonus applicability question remains routed to CPF Board.');

const frozenCpf02Classification = classifyQuestion(
  'An employee has S$9,200 monthly OW in 2026. What OW base is subject to CPF before applying the employee\'s rate?'
);
assert.equal(frozenCpf02Classification.journalEntryRequired, false,
  'The previously correct Frozen75 CPF-02 OW-base question remains advisory.');

const contributionJournalControl = classifyQuestion(
  'Calculate the employer and employee CPF contribution amounts and prepare balanced payroll journal entries for a 40-year-old Singapore citizen with October 2026 Ordinary Wages of S$8,700.'
);
assert.equal(contributionJournalControl.intent, 'TRANSACTION',
  'An explicit CPF contribution calculation remains transactional.');
assert.equal(contributionJournalControl.calculationRequired, true,
  'An explicit CPF contribution amount request still requires calculation.');
assert.equal(contributionJournalControl.journalEntryRequired, true,
  'An explicit payroll journal request still routes to journal preparation.');

const previousFetch = globalThis.fetch;
const modelEndpoint = /(?:generativelanguage\.googleapis\.com|api\.openai\.com|openai\.azure\.com|\/generateContent(?:\?|$)|\/chat\/completions(?:\?|$))/i;
try {
  globalThis.fetch = async input => {
    const url = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input);
    if (modelEndpoint.test(url)) throw new Error(`Unexpected model request: ${url}`);
    return new Response('No source in focused offline classifier regression.', { status: 404 });
  };
  const cpfBaseAndBonusResponse = await processAccountingQuery(cpfBaseAndBonusQuery, null, 'SFRS_I');
  assert.equal(cpfBaseAndBonusResponse.scenarioState.scenarioType, 'AUTHORITY_ADVISORY',
    'The full application handles OW base and bonus-ceiling applicability as statutory advice.');
  assert.deepEqual(cpfBaseAndBonusResponse.scenarioState.directGroups || [], [],
    'The full application does not create a contribution journal for an applicability question.');
  assert.doesNotMatch(cpfBaseAndBonusResponse.messageText,
    /Statutory Payroll & CPF Assessment|termination pay|net salary|employer contribution payable\s*[:=]/i,
    'The advisory response does not fall through to a fabricated payroll calculation.');
} finally {
  globalThis.fetch = previousFetch;
}

console.log('CPF Additional Wages and MAS fund-management licensing offline regressions passed.');
