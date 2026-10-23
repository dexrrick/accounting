import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { supportMasCmsRule } from '../../src/retrieval/masCmsRuleSupport.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';

const request = {
  authority: 'MAS',
  topicId: 'mas-cms-licence',
  subject: 'Capital Markets Services Licence and general requirement',
  originalQuery: 'Under MAS guidance, what is a Capital Markets Services Licence and when is it generally required? Explain the general licensing requirement using official MAS guidance. Do not assess a particular business or create journal entries.'
};

// Verbatim operative body from the locally retained MAS CMS page observation.
const cmsDutyParagraph = 'If your company wishes to conduct regulated activities under the SFA, it must hold a CMS licence. Individuals conducting regulated activities on behalf of CMS licensees or exempt CMS entities (such as banks) need to be appointed as representatives.';
const actualPageFragment = `<html><body>
  <nav><p>Apply for a Capital Markets Services licence and view our application guide.</p></nav>
  <main>
    <h2>Who needs to apply?</h2>
    <p>${cmsDutyParagraph}<br /><br />These regulated activities are:</p>
    <ul><li>Dealing in capital markets products</li><li>Advising on corporate finance</li><li>Fund management</li></ul>
    <p>A capital markets product is a security, unit in a collective investment scheme, or derivative contract.</p>
    <table><tr><th>Minimum base capital</th><th>Example</th></tr><tr><td>$250,000</td><td>$1,000,000</td></tr></table>
    <p>Refer to the licensing guidelines for additional information.</p>
  </main>
</body></html>`;

assert.equal(supportMasCmsRule({ ...request, sourceText: actualPageFragment }), true,
  'The actual operative company CMS licence rule is recognized despite adjacent definitions, examples, and links.');
assert.equal(supportMasCmsRule({ ...request, sourceText: cmsDutyParagraph }), true,
  'The complete operative paragraph supports the general rule with the representative qualification intact.');

const notRuleSources = [
  'A Capital Markets Services licence is a licence for firms that provide services involving capital markets products.',
  '<nav><p><a href="/apply">If your company wishes to conduct regulated activities under the SFA, it must hold a CMS licence.</a></p></nav>',
  '<main><h2>If your company wishes to conduct regulated activities under the SFA, it must hold a CMS licence</h2></main>',
  '<table><tr><th>Minimum base capital</th><th>Example</th></tr><tr><td>$250,000</td><td>$1,000,000</td></tr></table>',
  '<main><p>For capital requirements, consult the licensing guidelines. Check the application page for fees.</p></main>',
  '<main><p>Entities providing digital payment token services must be licensed under the Payment Services Act.</p></main>',
  '<main><p>If your company wishes to conduct regulated activities under the SFA, it does not need to hold a CMS licence.</p></main>',
  '<main><p>If your company conducts regulated activities under the SFA, it must obtain legal advice on whether a CMS licence is required.</p></main>',
  '<main><p>If your company conducts regulated activities under the SFA, it must hold a meeting to discuss whether a CMS licence is required.</p></main>',
  '<main><p>If your company wishes to conduct regulated activities under the SFA, it must hold a CMS licence, but it is not required to hold a CMS licence.</p></main>',
  '<main><p>If your company wishes to conduct regulated activities under the SFA, it must hold no CMS licence.</p></main>'
];
for (const sourceText of notRuleSources) {
  assert.equal(supportMasCmsRule({ ...request, sourceText }), false,
    `Non-operative or contradictory CMS material must not support the general rule: ${sourceText}`);
}

assert.equal(supportMasCmsRule({ ...request, authority: 'ACRA', sourceText: cmsDutyParagraph }), undefined,
  'Another governing authority is outside the bounded MAS support profile.');
assert.equal(supportMasCmsRule({ ...request, topicId: 'mas-fund-management', sourceText: cmsDutyParagraph }), undefined,
  'Another MAS topic is outside the bounded CMS licence profile.');
assert.equal(supportMasCmsRule({
  ...request,
  subject: 'fund manager admission criteria',
  originalQuery: 'Under MAS guidance, what are fund manager admission criteria for a CMS licence?',
  sourceText: cmsDutyParagraph
}), undefined, 'Fund manager admission criteria remain outside this general CMS rule profile.');
assert.equal(supportMasCmsRule({
  ...request,
  subject: 'financial adviser licence requirement',
  originalQuery: 'Under MAS guidance, what is a financial adviser licence and when is it required?',
  sourceText: cmsDutyParagraph
}), undefined, 'Financial adviser licensing remains a separate regime.');
assert.equal(supportMasCmsRule({
  ...request,
  subject: 'digital payment token licence requirement',
  originalQuery: 'Under MAS guidance, what is a digital payment token licence and when is it required?',
  sourceText: cmsDutyParagraph
}), undefined, 'Digital payment token licensing remains a separate regime.');
assert.equal(supportMasCmsRule({
  ...request,
  subject: 'CMS licence fees and capital requirements',
  originalQuery: 'When is a CMS licence generally required, and what fees or capital requirements apply?',
  sourceText: cmsDutyParagraph
}), undefined, 'Fee and capital requirement asks are outside the bounded general rule support.');

const cmsQuery = 'Under MAS guidance, what is a Capital Markets Services Licence and when is it generally required? Explain the general licensing requirement using official MAS guidance. Do not assess a particular business or create journal entries.';
const cmsIssue = {
  id: 'mas-cms-general-rule',
  subject: 'Capital Markets Services Licence definition and general requirement',
  population: 'COMPANY',
  domain: 'MAS_FUNDS',
  governingAuthorities: ['MAS'],
  contextualAuthorities: [],
  operation: 'EXPLAIN_RULE',
  mappedTopicIds: ['mas-cms-licence'],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE',
  confidence: 0.98,
  status: 'MAPPED'
};
const cmsIssuePlan = {
  source: 'SEMANTIC_ISSUES', issues: [cmsIssue], coverageEstablished: true, hasUnmappedResidual: false
};
const cmsUnderstanding = concepts => ({
  mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED',
  interpretation: {
    jurisdiction: ['Singapore'], authorityCandidates: ['MAS'], contextualAuthorities: [],
    domain: 'MAS_FUNDS', population: 'COMPANY',
    primarySubject: 'Capital Markets Services Licence definition and general requirement',
    concepts: concepts.map(concept => ({ concept, role: 'RELATED' })),
    requestedOperation: 'EXPLAIN_RULE', requiresUserSpecificFacts: false, calculationRequested: false,
    factsExplicitlyProvided: [], confidence: 0.98
  }
});
const cmsRecordId = 'TEST_CAPTURED_MAS_CMS_GENERAL_RULE';
const cmsUrl = 'https://www.mas.gov.sg/regulation/capital-markets-services/capital-markets-services-licence';
const cmsSourceBody = [
  cmsDutyParagraph,
  'These regulated activities are: Dealing in capital markets products; advising on corporate finance; fund management.',
  'A capital markets product is a security, unit in a collective investment scheme, or derivative contract.',
  'Minimum base capital is described in the licensing requirements table. Refer to the licensing guidelines for additional information.'
].join('\n\n');
const cmsLiveRecord = sourceText => ({
  id: cmsRecordId,
  authority: 'MAS', authorityName: 'Monetary Authority of Singapore', sourceAuthority: 'MAS',
  sourcePublisher: 'Monetary Authority of Singapore (MAS)',
  legalOrStandardInstrument: 'Securities and Futures Act 2001',
  documentTitle: 'Capital Markets Services Licence | Monetary Authority of Singapore',
  standardOrActCode: 'MAS_CMS_LICENSE_PAGE', paragraphOrSection: 'Who needs to apply?',
  sourceText, principleSummary: 'Captured official CMS licence guidance.',
  officialSourceUrl: cmsUrl, canonicalSourceUrl: cmsUrl, domain: 'MAS_FUNDS', jurisdiction: 'Singapore',
  tags: ['mas-cms-licence'], relatedTopicIds: ['mas-cms-licence'], sourceMapTopicIds: [], retrievalHints: [],
  sourceStatus: 'NEEDS_REVIEW', sourceType: 'OFFICIAL_GUIDANCE', evidenceTier: 'OFFICIAL_GUIDANCE',
  isVerbatimText: false, provenance: 'LIVE_EXTERNAL', lifecycleState: 'CANDIDATE',
  extractionStatus: 'PARTIAL', verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
  urlVerificationStatus: 'VERIFIED', documentHash: createHash('sha256').update(actualPageFragment).digest('hex'),
  retrievedAt: '2026-10-23T00:00:00.000Z', recordRole: 'EVIDENCE', groundingEligible: true
});
const cmsFetchTrace = {
  path: 'DISCOVERED_SOURCE', sourceMapIds: [], selectedRecordIds: [cmsRecordId],
  finalVerifiedUrls: [cmsUrl], candidateOnly: true,
  attempts: [{ topicId: 'mas-cms-licence', fetchStatus: 'SUCCESS', finalUrl: cmsUrl,
    pageTitle: 'Capital Markets Services Licence | Monetary Authority of Singapore', titleMatched: true, contentMatched: true }]
};
async function runCmsWorkstream(sourceText, conceptLabels = ['licensing requirement']) {
  const record = cmsLiveRecord(sourceText);
  return buildAuthorityWorkstreams(cmsQuery, cmsIssuePlan, {
    referenceDate: '2026-10-23', questionUnderstanding: cmsUnderstanding(conceptLabels),
    providers: { MAS: { authority: 'MAS', async retrieve() {
      return { candidates: [record], claims: [{ text: cmsDutyParagraph, quote: cmsDutyParagraph, recordId: cmsRecordId }], evidenceQualityTrace: cmsFetchTrace };
    } } }
  });
}

const actualCmsWorkstream = await runCmsWorkstream(cmsSourceBody);
const actualCmsIssue = actualCmsWorkstream.workstreams.find(item => item.authority === 'MAS').issues[0];
assert.equal(actualCmsIssue.evidenceStatus, 'VERIFIED', 'The actual operative CMS/SFA duty supports the general issue despite the acronym/long-subject mismatch.');
assert.ok(actualCmsIssue.verifiedClaims.some(claim => claim.quote === cmsDutyParagraph), 'The verified claim preserves the full operative duty paragraph.');
assert.equal(actualCmsIssue.verifiedClaims.some(claim => /IRAS|tax return|income tax/i.test(claim.quote)), false,
  'The CMS rule response does not publish the unrelated tax passage.');

const nonoperativeCmsWorkstream = await runCmsWorkstream([
  'A Capital Markets Services licence is a licence for firms that provide services involving capital markets products.',
  'Minimum base capital is described in the licensing requirements table.',
  'Refer to the licensing guidelines for additional information.'
].join('\n\n'));
const nonoperativeCmsIssue = nonoperativeCmsWorkstream.workstreams.find(item => item.authority === 'MAS').issues[0];
assert.equal(nonoperativeCmsIssue.evidenceStatus, 'INSUFFICIENT', 'Definitions, capital pointers, and guidelines links cannot substitute for the operative CMS/SFA duty.');
assert.equal(nonoperativeCmsIssue.sources.length, 0);

const extraCmsConceptWorkstream = await runCmsWorkstream(cmsSourceBody, [
  'licensing requirement', 'Capital Markets Services Licence definition'
]);
const extraCmsConceptIssue = extraCmsConceptWorkstream.workstreams.find(item => item.authority === 'MAS').issues[0];
assert.equal(extraCmsConceptIssue.evidenceStatus, 'INSUFFICIENT', 'The duty paragraph does not establish the separate licence-definition concept.');
assert.equal(extraCmsConceptIssue.lifecycle.covered, false);
assert.ok(extraCmsConceptIssue.gaps.some(gap => gap.code === 'ISSUE_CONCEPT_UNCOVERED' && gap.reason.includes('definition')),
  'The unsupported definition concept remains an explicit coverage gap.');

console.log('MAS CMS general rule support regressions passed.');
