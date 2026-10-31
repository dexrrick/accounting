import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { isAcraCompanySourceUrlCompatible } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../src/services/groundingContextBuilder.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';
import { renderIrasEvidenceResponse } from '../../src/services/irasEvidencePolicy.ts';
import { createAuthorityEvidencePresentation } from '../../src/utils/authorityEvidencePresentation.ts';
import { renderAuthorityEvidenceResponseText } from '../../src/services/authorityEvidenceResponse.ts';
import { completeIrasEciFilingDeadlineQuote, verifyEvidenceClaims } from '../../src/verification/claimEvidenceVerifier.ts';
import {
  getIrasAcraPracticalRuleEvidence,
  provesIrasAcraPracticalRuleSource,
  supportIrasAcraPracticalRuleSource
} from '../../src/retrieval/irasAcraPracticalRules.ts';

const samples = [
  {
    authority: 'IRAS', topicId: 'iras-cit-eci', domain: 'IRAS_INCOME_TAX', population: 'COMPANY',
    subject: 'ECI filing deadline',
    query: 'In general, when must a company file its ECI?',
    runtimeQuery: 'Under IRAS guidance, in general, explain the ECI filing deadline after a financial year ends.',
    url: 'https://www.iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-(eci)-filing',
    title: 'Estimated Chargeable Income (ECI) Filing | IRAS',
    paragraph: 'Your company has to file ECI within 3 months from the end of your financial year unless:',
    exceptions: [
      'Your company qualifies for the ECI filing waiver; or',
      'Your company is specifically not required to file ECI.'
    ],
    completeQuote: 'Your company has to file ECI within 3 months from the end of your financial year unless:\n\n• Your company qualifies for the ECI filing waiver; or\n\n• Your company is specifically not required to file ECI.',
    definition: "ECI is an estimate of your company's taxable profits (after deducting tax-allowable expenses) for a Year of Assessment (YA).",
    publisher: 'Inland Revenue Authority of Singapore (IRAS)'
  },
  {
    authority: 'ACRA', topicId: 'acra_company-secretary', domain: 'ACRA_CORPORATE', population: 'COMPANY',
    subject: 'company secretary appointment deadline',
    query: 'In general, when must a local company appoint a company secretary?',
    runtimeQuery: 'Under ACRA guidance, in general, when must a local company appoint a company secretary?',
    url: 'https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/',
    title: 'Step 4.3: Choosing company directors & other key officers | Accounting and Corporate Regulatory Authority',
    paragraph: 'Every company must have at least one company director and one company secretary. A secretary must be appointed within six months of successful registration. The position cannot be empty for more than six months.',
    publisher: 'ACRA'
  }
];

const acraCompanySecretaryUrl = samples.find(sample => sample.authority === 'ACRA').url;
assert.equal(isAcraCompanySourceUrlCompatible('ACRA_COMPANIES', acraCompanySecretaryUrl), true,
  'The verified local-company secretary article route is an eligible ACRA company source.');
assert.equal(isAcraCompanySourceUrlCompatible('ACRA_COMPANIES',
  'https://www.acra.gov.sg/manage/companies/foreign-company/register/'), false,
'Foreign-company guidance remains outside the local-company topic.');
assert.equal(isAcraCompanySourceUrlCompatible('ACRA_COMPANIES',
  'https://www.acra.gov.sg/manage/companies/variable-capital-company/register/'), false,
'Variable-capital-company guidance remains outside the local-company topic.');

const html = (sample, tail = '') => `<html><head><title>${sample.title}</title></head><body><main><h1>${sample.title}</h1>${sample.definition ? `<p>${sample.definition}</p>` : ''}${sample.exceptions
  ? `<p>${sample.paragraph}</p><ol>${sample.exceptions.map(item => `<li>${item}</li>`).join('')}</ol>`
  : `<p>${sample.paragraph}</p>`}${tail}</main></body></html>`;
const response = body => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const offlineRetriever = { retrieveSources: async () => [], getSourceById: () => undefined };
const unrelatedIrasBodyTail = `<p>${'General services are available to taxpayers and businesses in Singapore. '.repeat(120)}</p>`;
const pageBodies = new Map(samples.map(sample => [sample.url,
  html(sample, sample.authority === 'IRAS' ? unrelatedIrasBodyTail : '')]));
const customFetch = async url => {
  if (url === 'https://www.iras.gov.sg/sitemap') return response(`<urlset><url><loc>${samples[0].url}</loc></url></urlset>`);
  if (url === 'https://www.acra.gov.sg/sitemap.xml') return response(`<urlset><url><loc>${samples[1].url}</loc></url></urlset>`);
  const sample = samples.find(item => item.url === url);
  if (sample) return response(pageBodies.get(url));
  if (url.endsWith('/robots.txt')) return new Response('not found', { status: 404 });
  if (url.startsWith('https://html.duckduckgo.com/html/')) return response('<html><body></body></html>');
  if (url.startsWith('https://r.jina.ai/')) return new Response('not found', { status: 404 });
  throw new Error(`Unexpected offline fetch: ${url}`);
};

for (const sample of samples) {
  const sourceQuote = sample.completeQuote || sample.paragraph;
  assert.equal(provesIrasAcraPracticalRuleSource(sample.runtimeQuery, sample.authority, sample.topicId, sourceQuote), true,
    `${sample.authority} complete official source passage establishes the bounded rule.`);
  assert.equal(supportIrasAcraPracticalRuleSource(sample.runtimeQuery, sample.authority, sample.topicId,
    sample.subject, sourceQuote), true,
  `${sample.authority} natural timing subject is supported by complete official wording.`);
  assert.equal(supportIrasAcraPracticalRuleSource(sample.runtimeQuery, sample.authority, sample.topicId,
    `${sample.subject} penalty duties`, sourceQuote), false,
  `${sample.authority} subject scope rejects penalties and duties.`);
  assert.equal(supportIrasAcraPracticalRuleSource('In general, what is the deadline?', sample.authority,
    sample.topicId, sample.subject, sourceQuote), undefined,
  `${sample.authority} topic metadata cannot supply a missing target in the query.`);
  assert.equal(provesIrasAcraPracticalRuleSource(sample.runtimeQuery, sample.authority, sample.topicId, 'An official page without the requested deadline.'), false,
    `${sample.authority} supported request fails closed when rule evidence is incomplete.`);
  assert.equal(provesIrasAcraPracticalRuleSource(sample.runtimeQuery, sample.authority, 'unrelated-topic', sourceQuote), undefined,
    'An unrelated topic stays outside the rule helper.');
}

for (const sample of samples) {

  const interpretation = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'], authorityCandidates: [sample.authority], contextualAuthorities: [],
    domain: sample.domain, population: sample.population, primarySubject: sample.subject,
    concepts: [{ concept: sample.subject, role: 'PRIMARY' }],
    requestedOperation: 'EXPLAIN_RULE', factsExplicitlyProvided: [], confidence: 0.98,
    issues: [{
      subject: sample.subject, population: sample.population, domain: sample.domain,
      governingAuthorities: [sample.authority], contextualAuthorities: [], operation: 'EXPLAIN_RULE',
      mappedTopicIds: [sample.topicId], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.98
    }]
  };
  assert.ok(validateSemanticQuestionInterpretation(interpretation, sample.runtimeQuery),
    `${sample.authority} offline semantic oracle satisfies the current contract.`);
  const reconciled = reconcileQuestionUnderstanding(sample.runtimeQuery, classifyQuestion(sample.runtimeQuery), {
    mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED', interpretation
  });
  const issue = reconciled.issuePlan.issues.find(item => item.governingAuthorities.includes(sample.authority));
  assert.ok(issue, `${sample.authority} issue survives classification and semantic reconciliation.`);
  assert.equal(issue.status, 'MAPPED');
  assert.ok(issue.mappedTopicIds.includes(sample.topicId));

  const fetched = [];
  const result = await buildAuthorityWorkstreams(sample.runtimeQuery, reconciled.issuePlan, {
    questionUnderstanding: reconciled.understanding,
    retriever: offlineRetriever,
    referenceDate: '2026-10-14',
    groundingOptions: {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { customFetch: async url => { fetched.push(url); return customFetch(url); }, useCache: false, timeoutMs: 500 }
    }
  });
  const evidence = result.workstreams.find(item => item.authority === sample.authority);
  assert.ok(evidence, `${sample.authority} official evidence workstream is assembled.`);
  if (sample.authority === 'ACRA') {
    assert.ok(fetched.includes('https://www.acra.gov.sg/sitemap.xml') ||
      evidence.issues[0].sources.some(source => source.officialSourceUrl === sample.url),
    'ACRA evidence comes from the official sitemap or an independently fetched known official pointer.');
  }
  assert.ok(fetched.includes(sample.url), `${sample.authority} official discovery fetches the topic page: ${JSON.stringify(fetched)}`);
  assert.ok(evidence.issues[0].retrievalTrace.attempts.some(attempt => attempt.topicId === sample.topicId && attempt.fetchStatus === 'SUCCESS'),
    'The source trace binds the fetched official page to the requested topic.');
  assert.equal(evidence.issues[0].evidenceStatus, 'VERIFIED', JSON.stringify({
    status: evidence.issues[0].evidenceStatus,
    applicationStatus: evidence.issues[0].applicationStatus,
    gaps: evidence.issues[0].gaps,
    verifiedClaimCount: evidence.issues[0].verifiedClaims.length,
    attempts: evidence.issues[0].retrievalTrace.attempts.map(attempt => ({
      topicId: attempt.topicId, fetchStatus: attempt.fetchStatus, error: attempt.error
    })),
    candidateAdmissions: evidence.issues[0].admissionDiagnostics?.candidates?.map(candidate => ({
      admitted: candidate.admitted, firstFailedPredicate: candidate.firstFailedPredicate,
      predicates: candidate.predicates
    })),
    reconciledIssues: reconciled.issuePlan.issues.map(item => ({
      subject: item.subject, domain: item.domain, population: item.population,
      operation: item.operation, mappedTopicIds: item.mappedTopicIds, concepts: item.requestedConcepts
    }))
  }));
  assert.ok(evidence.issues[0].verifiedClaims.some(claim => claim.supportKind === 'EXACT_SOURCE_QUOTE'),
    'The issue retains an independently verified exact source quote.');
  const record = evidence.issues[0].sources.find(item => item.id === evidence.issues[0].verifiedClaims[0].recordId);
  assert.ok(record);
  assert.equal(record.authority, sample.authority);
  assert.equal(record.officialSourceUrl, sample.url);
  assert.equal(record.sourcePublisher, sample.publisher);
  if (sample.authority === 'IRAS') {
    assert.equal(completeIrasEciFilingDeadlineQuote(record.sourceText), sample.completeQuote,
      'The fetched page preserves the exact ECI introduction and both ordered exceptions in one bounded quote.');
    assert.ok(pageBodies.get(sample.url).length > 5_000,
      'The fetched ECI HTML is long enough to require preferred-passage selection.');
    assert.ok(evidence.issues[0].verifiedClaims.some(claim => claim.quote === sample.completeQuote),
      'The real pipeline selects and admits the exact complete ECI list from the long page.');
    const incomplete = verifyEvidenceClaims([{
      kind: 'RULE', text: sample.paragraph, quote: sample.paragraph, recordId: record.id
    }], [record], { missingFacts: [] });
    assert.equal(incomplete.accepted.length, 0);
    assert.equal(incomplete.rejected[0]?.reason, 'QUOTE_OMITS_ATTACHED_QUALIFICATION',
      'The ECI deadline introduction alone is rejected as omitting the two exceptions.');
    const inlineQuote = 'Your company has to file ECI within 3 months from the end of your financial year unless: (1) your company qualifies for the ECI filing waiver; or (2) your company is specifically not required to file ECI.';
    const inlineRecord = { ...record, sourceText: inlineQuote };
    const inlineVerification = verifyEvidenceClaims([{
      kind: 'RULE', text: inlineQuote, quote: inlineQuote, recordId: record.id
    }], [inlineRecord], { missingFacts: [] });
    assert.equal(inlineVerification.accepted.length, 1,
      'An existing inline source paragraph with both qualifications retains ordinary exact-span verification.');
    const disjointFaq = 'The ECI filing service is available online through IRAS digital services.';
    const disjointRecord = { ...record, sourceText: `${sample.completeQuote}\n\n${disjointFaq}` };
    const disjointVerification = verifyEvidenceClaims([{
      kind: 'RULE', text: disjointFaq, quote: disjointFaq, recordId: record.id
    }], [disjointRecord], { missingFacts: [] });
    assert.equal(disjointVerification.accepted.length, 1,
      'A separate complete ECI filing FAQ paragraph is not captured by the strict exception-list gate.');
    const attachedQualificationRecord = {
      ...record, sourceText: `${sample.completeQuote}\n\nHowever, this page also describes separate ECI services.`
    };
    const omittedAttachedQualification = verifyEvidenceClaims([{
      kind: 'RULE', text: sample.completeQuote, quote: sample.completeQuote, recordId: record.id
    }], [attachedQualificationRecord], { missingFacts: [] });
    assert.equal(omittedAttachedQualification.accepted.length, 0,
      'A following attached However qualification prevents selection of the shorter ECI list passage.');
    const policyContext = await buildGroundedReasoningContext(sample.runtimeQuery, null, offlineRetriever, undefined, {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { customFetch, useCache: false, timeoutMs: 500 },
      referenceDate: '2026-10-14', questionUnderstanding: reconciled.understanding
    });
    const policyResponse = renderIrasEvidenceResponse({}, policyContext, sample.runtimeQuery, null, 'SFRS_I', 'LOCAL');
    assert.ok(policyResponse.claimVerification.accepted.some(claim => claim.recordId === record.id &&
      claim.quote === sample.completeQuote),
    `IRAS source-only policy fallback emits the complete ordered ECI list through normal quote verification: ${JSON.stringify({
      classificationTopicIds: policyContext.classification.topicIds,
      quality: policyContext.evidenceQuality?.status,
      eligibleRecordIds: policyContext.evidenceQuality?.eligibleRecords.map(item => item.id),
      answerPath: policyResponse.answerPath,
      accepted: policyResponse.claimVerification.accepted.map(claim => ({ recordId: claim.recordId, quote: claim.quote })),
      rejected: policyResponse.claimVerification.rejected.map(claim => ({ reason: claim.reason, text: claim.text }))
    })}`);
  }
  assert.ok(evidence.issues[0].verifiedClaims.every(claim => record.sourceText.includes(claim.quote)),
    'Verified excerpts remain exact quotations from the fetched source.');

  const presentation = createAuthorityEvidencePresentation(result);
  const presentedStream = presentation.workstreams.find(item => item.authority === sample.authority);
  const presentedIssue = presentedStream.issues[0];
  const presentedClaims = presentedStream.sources.flatMap(source => source.claims)
    .filter(claim => claim.issueIds.includes(presentedIssue.id));
  assert.ok(presentedClaims.some(claim => claim.fetchedSourceBinding?.recordId === record.id),
    'The actual rendered claim carries its real fetched-source binding.');
  for (const claim of presentedClaims) {
    assert.equal(claim.fetchedSourceBinding?.documentHash, record.documentHash || record.contentHash);
    assert.equal(claim.fetchedSourceBinding?.canonicalUrl, record.canonicalSourceUrl);
    assert.equal(claim.fetchedSourceBinding?.retrievedAt, record.retrievedAt);
  }
  const rule = getIrasAcraPracticalRuleEvidence(sample.runtimeQuery, presentedStream, presentedIssue);
  assert.ok(rule, `${sample.authority} verified claim supports a practical explanation: ${JSON.stringify({
    issue: presentedIssue,
    sources: presentedStream.sources.map(source => ({
      url: source.officialUrl, provenance: source.provenance,
      claims: source.claims.map(claim => ({
        text: claim.text, issueIds: claim.issueIds, supportKind: claim.supportKind,
        binding: claim.fetchedSourceBinding, formalBinding: claim.sourceBinding
      }))
    }))
  })}`);
  assert.equal(rule.authority, sample.authority);
  assert.equal(rule.officialUrl, sample.url);
  const rendered = renderAuthorityEvidenceResponseText(presentation, false);
  assert.ok(rendered.includes(rule.text), `${sample.authority} response presents the claim-backed practical rule.`);
  assert.ok(rendered.includes(sample.url), `${sample.authority} practical explanation retains the official citation.`);
  if (presentedIssue.applicationStatus === 'UNRESOLVED') {
    assert.equal(presentedIssue.operation, 'EXPLAIN_RULE');
    assert.match(sample.runtimeQuery, /\bin general\b/i);
    assert.ok(rendered.includes(presentedIssue.applicationReason),
      'The existing unresolved application reason remains visible with the general rule.');
    assert.ok(rendered.includes('not whether a particular person or company meets the applicable requirements'),
      'The general rule does not imply case-specific applicability.');
  }
  assert.notEqual(presentation.status, 'VERIFIED',
    'Verifying one mapped issue must not be reported as complete whole-question coverage.');
  assert.ok(record.sourceText.includes(presentedStream.sources[0].claims.find(claim => claim.issueIds.includes(presentedIssue.id)).text));

  const deny = (mutation, query = sample.runtimeQuery) => {
    const candidate = structuredClone(presentation);
    candidate.query = query;
    const stream = candidate.workstreams.find(item => item.authority === sample.authority);
    const candidateIssue = stream.issues[0];
    mutation(stream, candidateIssue);
    assert.equal(getIrasAcraPracticalRuleEvidence(query, stream, candidateIssue), undefined);
  };
  if (presentedIssue.applicationStatus === 'UNRESOLVED') {
    deny(() => {}, sample.runtimeQuery.replace(/\bin general,?\s*/i, ''));
  }
  if (sample.authority === 'IRAS') {
    deny((_stream, item) => { item.applicationStatus = 'UNRESOLVED'; });
  }
  deny(stream => { stream.authority = sample.authority === 'IRAS' ? 'ACRA' : 'IRAS'; });
  deny((_stream, item) => { item.operation = 'DETERMINE_TREATMENT'; });
  deny(stream => { stream.sources.forEach(source => { source.officialUrl = 'https://example.com/rule'; }); });
  deny(stream => { stream.sources.forEach(source => source.claims.forEach(claim => {
    claim.text = 'The deadline differs from the official rule.';
  })); });
  deny(() => {}, `${sample.runtimeQuery} for my company in 2023`);
  deny(() => {}, 'In general, what is the deadline?');
  if (sample.authority === 'IRAS') {
    deny((_stream, item) => { item.subject = 'personal income tax deadline'; });
    deny((_stream, item) => { item.subject = 'ECI penalties deadline'; });
    deny(stream => { stream.sources.forEach(source => source.claims.forEach(claim => {
      claim.fetchedSourceBinding = undefined;
    })); });
  } else {
    deny((_stream, item) => { item.subject = 'director appointment deadline'; });
    deny((_stream, item) => { item.subject = 'company secretary duties'; });
  }

  // A full source contradiction must stop at discovery before claim extraction can
  // select a short positive excerpt and hide the conflicting premise.
  const contradictory = sample.authority === 'IRAS'
    ? html(sample, `<p>Do not file ECI within 3 months from the end of the financial year.</p>${unrelatedIrasBodyTail}`)
    : html(sample, '<p>A company secretary must not be appointed within six months of successful registration.</p>');
  pageBodies.set(sample.url, contradictory);
  const rejected = await buildAuthorityWorkstreams(sample.runtimeQuery, reconciled.issuePlan, {
    questionUnderstanding: reconciled.understanding,
    retriever: offlineRetriever,
    referenceDate: '2026-10-14',
    groundingOptions: {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { customFetch, useCache: false, timeoutMs: 500 }
    }
  });
  const rejectedIssue = rejected.workstreams.find(item => item.authority === sample.authority).issues[0];
  assert.equal(rejectedIssue.evidenceStatus, 'INSUFFICIENT',
    'A source that contradicts the full requested rule is rejected before a supporting excerpt can be admitted.');
  assert.deepEqual(rejectedIssue.verifiedClaims, []);
  pageBodies.set(sample.url, html(sample, sample.authority === 'IRAS' ? unrelatedIrasBodyTail : ''));
}

const eciSample = samples[0];
assert.equal(completeIrasEciFilingDeadlineQuote(eciSample.paragraph), undefined,
  'The ECI deadline introduction alone is not a complete bounded quote.');
assert.equal(completeIrasEciFilingDeadlineQuote(`${eciSample.paragraph}\n\n• ${eciSample.exceptions[0]}`), undefined,
  'One ECI exception does not establish the complete list.');
assert.equal(completeIrasEciFilingDeadlineQuote(`${eciSample.completeQuote}\n\n• Another company-specific ECI exception.`), undefined,
  'An extra attached ECI list item makes the quote incomplete.');
assert.equal(completeIrasEciFilingDeadlineQuote(eciSample.completeQuote.replace(
  'Your company qualifies for the ECI filing waiver; or', 'Your company does not qualify for the ECI filing waiver; or')),
undefined, 'A negated ECI waiver condition is rejected.');
assert.equal(completeIrasEciFilingDeadlineQuote([
  eciSample.paragraph, `• ${eciSample.exceptions[1]}`, `• ${eciSample.exceptions[0]}`
].join('\n\n')), undefined, 'Reordered ECI exceptions do not establish the source list.');
assert.equal(provesIrasAcraPracticalRuleSource(eciSample.runtimeQuery, 'IRAS', eciSample.topicId,
  `${eciSample.completeQuote} Do not file ECI within three months from the end of the financial year.`),
false, 'The ECI rule is not established when the full page contradicts the deadline.');
assert.equal(provesIrasAcraPracticalRuleSource(samples[1].runtimeQuery, 'ACRA', samples[1].topicId,
  samples[1].paragraph.replace('within six months', 'within three months')),
false, 'A conflicting company-secretary appointment period is rejected.');
assert.equal(provesIrasAcraPracticalRuleSource(samples[0].runtimeQuery, 'IRAS', samples[0].topicId,
  `${samples[0].paragraph} Do not file ECI within three months from the end of the financial year.`),
false, 'A negative ECI deadline premise is rejected even when the same page also states the positive rule.');
assert.equal(provesIrasAcraPracticalRuleSource(samples[1].runtimeQuery, 'ACRA', samples[1].topicId,
  `${samples[1].paragraph} A company secretary must be appointed within three months of successful registration.`),
false, 'A spelled-out conflicting ACRA appointment period is rejected.');
assert.equal(provesIrasAcraPracticalRuleSource(samples[1].runtimeQuery, 'ACRA', samples[1].topicId,
  `${samples[1].paragraph} A company secretary must not be appointed within six months of successful registration.`),
false, 'A negative ACRA appointment premise is rejected even when the same page also states the positive rule.');
assert.equal(provesIrasAcraPracticalRuleSource(samples[1].runtimeQuery, 'ACRA', samples[1].topicId,
  samples[1].paragraph.replace('must be appointed', 'should be appointed')),
false, 'A merely recommended ACRA appointment period does not prove a statutory duty.');
assert.equal(provesIrasAcraPracticalRuleSource(samples[1].runtimeQuery, 'ACRA', samples[1].topicId,
  `${samples[1].paragraph} Every company must have no company secretary.`),
false, 'A negative company-secretary duty premise contradicts the general requirement.');
console.log('IRAS ECI and ACRA secretary discovery, admission, citation and bounded explanations: passed.');
