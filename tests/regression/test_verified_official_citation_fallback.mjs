import assert from 'node:assert/strict';
import { ControlledWebRetriever } from '../../src/retrieval/controlledWebRetriever.ts';
import { SourceCache } from '../../src/retrieval/sourceCache.ts';
import { defaultSourceRetriever } from '../../src/retrieval/sourceRetriever.ts';
import { resolveMappedOfficialSourceFallback } from '../../src/services/groundingContextBuilder.ts';
import { CitationVerifier, defaultCitationVerifier } from '../../src/verification/citationVerifier.ts';
import { buildSsoUrl, getSafeOfficialUrl, sanitizeStatutoryLinks } from '../../src/utils/statutoryLinkResolver.ts';
import { querySingaporeStatutes, SINGAPORE_STATUTORY_REPOSITORY } from '../../src/standards/singaporeStatutesKnowledge.ts';
import { hasVerifiedSourceUrlProvenance, isVerifiedLegacyStandardUrl } from '../../src/standards/approvedSourceRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { defaultExternalSourceValidator } from '../../src/retrieval/externalSourceValidator.ts';
import { OfficialSitemapDiscoveryAdapter } from '../../src/retrieval/officialSitemapDiscovery.ts';
import { assembleDeterministicResponse } from '../../src/engine/responseAssembler.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS } from '../../src/standards/coverageRegistry.ts';
import { evaluateEvidenceQuality } from '../../src/retrieval/evidenceQualityGate.ts';

const ifrs10Url = 'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-10-consolidated-financial-statements/';
const ifrs5Url = 'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-5-non-current-assets-held-for-sale-and-discontinued-operations/';
const ifrs10Html = `<!doctype html><html><head><title>IFRS 10 Consolidated Financial Statements</title></head>
  <body><main><h1>IFRS 10 Consolidated Financial Statements</h1>
  <p>IFRS 10 establishes principles for presenting and preparing consolidated financial statements when an entity controls one or more other entities.</p>
  <p>It defines the principle of control and establishes control as the basis for consolidation.</p>
  <p>It sets out how to apply the principle of control to identify whether an investor controls an investee and must consolidate the investee.</p>
  </main></body></html>`;
const ifrs5Html = `<!doctype html><html><head><title>IFRS 5 Non-current Assets Held for Sale and Discontinued Operations</title></head>
  <body><main><h1>IFRS 5 Non-current Assets Held for Sale and Discontinued Operations</h1>
  <p>IFRS 5 requires a non-current asset or disposal group to be classified as held for sale when its carrying amount will be recovered principally through a sale transaction rather than continuing use.</p>
  <p>Assets held for sale are measured and presented separately, and depreciation ceases.</p>
  </main></body></html>`;
const genericAcraHtml = '<html><head><title>Accounting Standards — Singapore framework overview</title></head><main><p>SFRS(I) 10 includes consolidation and control of an investee; an investor controls an investee when the control principle applies.</p></main></html>';
const htmlResponse = (body, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' }
});
const topicExpectation = {
  standardIdentifiers: ['IFRS 10'],
  expectedTitles: ['IFRS 10 Consolidated Financial Statements'],
  topicTerms: ['control', 'investee'],
  minimumTopicTermMatches: 1
};

async function run() {
  // A plausible authority hostname does not make an invented URL a safe link.
  const unavailable = new ControlledWebRetriever(undefined, new SourceCache());
  const fabricatedAuthorityUrls = [
    'https://www.iras.gov.sg/taxes/fabricated-section-9999',
    'https://www.mom.gov.sg/fabricated/employment-section-9999',
    'https://www.acra.gov.sg/fabricated/corporate-section-9999',
    'https://www.mas.gov.sg/fabricated/regulatory-section-9999'
  ];
  for (const fabricatedUrl of fabricatedAuthorityUrls) {
    const missingPage = await unavailable.fetchOfficialSource(fabricatedUrl, {
      useCache: false,
      customFetch: async () => new Response('missing', { status: 404 })
    });
    assert.equal(missingPage.status, 'HTTP_ERROR', `Fabricated official URL must fail: ${fabricatedUrl}`);
    assert.equal(missingPage.content, undefined);
    assert.equal(getSafeOfficialUrl(fabricatedUrl), '');
    assert.equal(sanitizeStatutoryLinks(`[fabricated source](${fabricatedUrl})`), 'fabricated source');
  }
  const inventedIrasUrl = fabricatedAuthorityUrls[0];
  assert.equal(buildSsoUrl('Income Tax Act 1947', '9999'), '');
  assert.equal(sanitizeStatutoryLinks(`Source URL: ${inventedIrasUrl}`), 'Source URL: ');

  // Exact MAS FAQ URL verification is separate from review of its curated content.
  const masFaq = SINGAPORE_STATUTORY_REPOSITORY.MAS_SFO_LICENSING_EXEMPTION_2026;
  const masFaqRecord = defaultSourceRetriever.getSourceById('MAS_SFO_LICENSING_EXEMPTION_2026');
  assert.equal(masFaqRecord.sourceStatus, 'NEEDS_REVIEW');
  assert.equal(masFaqRecord.urlVerificationStatus, 'VERIFIED');
  assert.equal(getSafeOfficialUrl(masFaq.canonicalUrl, masFaq.actTitle, masFaq.sectionOrSchedule, 'MAS'), masFaq.canonicalUrl);

  const originalTestUrlRecord = UNIFIED_SOURCE_REGISTRY.TEST_VERIFIED_PARENTHESES_URL;
  const verifiedParenthesesUrl = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-input-tax';
  try {
    UNIFIED_SOURCE_REGISTRY.TEST_VERIFIED_PARENTHESES_URL = {
      ...masFaqRecord,
      id: 'TEST_VERIFIED_PARENTHESES_URL',
      authority: 'IRAS',
      authorityName: 'Inland Revenue Authority of Singapore',
      officialSourceUrl: verifiedParenthesesUrl,
      canonicalSourceUrl: verifiedParenthesesUrl,
      standardOrActCode: 'TEST URL',
      paragraphOrSection: 'Test URL',
      urlVerificationStatus: 'VERIFIED'
    };
    const encodedParenthesesLink = sanitizeStatutoryLinks(`[verified IRAS page](${verifiedParenthesesUrl})`);
    assert.equal(encodedParenthesesLink, `[verified IRAS page](${verifiedParenthesesUrl.replace('(', '%28').replace(')', '%29')})`);
    assert.equal(sanitizeStatutoryLinks(encodedParenthesesLink), encodedParenthesesLink,
      'A verified URL with literal parentheses remains trusted after Markdown-safe encoding and a second sanitize pass.');
  } finally {
    if (originalTestUrlRecord) UNIFIED_SOURCE_REGISTRY.TEST_VERIFIED_PARENTHESES_URL = originalTestUrlRecord;
    else delete UNIFIED_SOURCE_REGISTRY.TEST_VERIFIED_PARENTHESES_URL;
  }

  const masCanonicalUrl = masFaqRecord.canonicalSourceUrl;
  const masParsedUrl = new URL(masFaq.canonicalUrl);
  const masExplicitDefaultPortUrl = `${masParsedUrl.protocol}//${masParsedUrl.hostname}:443${masParsedUrl.pathname}${masParsedUrl.search}${masParsedUrl.hash}`;
  assert.equal(hasVerifiedSourceUrlProvenance(masFaqRecord), true,
    'An explicitly verified URL remains trusted when it matches its canonical snapshot.');
  const mutatedVerifiedUrlRecords = [
    { ...masFaqRecord, officialSourceUrl: `${masFaq.canonicalUrl}/different-path` },
    { ...masFaqRecord, officialSourceUrl: masFaq.canonicalUrl.replace('https://', 'http://') },
    { ...masFaqRecord, officialSourceUrl: masFaq.canonicalUrl.replace('https://', 'https://user@') },
    { ...masFaqRecord, officialSourceUrl: masExplicitDefaultPortUrl }
  ];
  for (const record of mutatedVerifiedUrlRecords) {
    assert.equal(record.urlVerificationStatus, 'VERIFIED', 'The mutation deliberately leaves the stale VERIFIED marker in place.');
    assert.equal(record.canonicalSourceUrl, masCanonicalUrl, 'The checked canonical snapshot remains unchanged.');
    assert.equal(hasVerifiedSourceUrlProvenance(record), false,
      `The shared URL provenance gate rejects changed or insecure URLs: ${record.officialSourceUrl}`);
  }
  const originalMutatedMasUrlRecord = UNIFIED_SOURCE_REGISTRY.TEST_MUTATED_VERIFIED_MAS_URL;
  try {
    UNIFIED_SOURCE_REGISTRY.TEST_MUTATED_VERIFIED_MAS_URL = {
      ...mutatedVerifiedUrlRecords[0],
      id: 'TEST_MUTATED_VERIFIED_MAS_URL'
    };
    const changedSameHostUrl = mutatedVerifiedUrlRecords[0].officialSourceUrl;
    assert.equal(getSafeOfficialUrl(changedSameHostUrl), '',
      'The registered-link resolver rejects a changed path on the same approved host while the prior VERIFIED marker remains.');
    assert.equal(sanitizeStatutoryLinks(`[changed MAS page](${changedSameHostUrl})`), 'changed MAS page',
      'Sanitization cannot expose a same-host URL mutation.');
  } finally {
    if (originalMutatedMasUrlRecord) UNIFIED_SOURCE_REGISTRY.TEST_MUTATED_VERIFIED_MAS_URL = originalMutatedMasUrlRecord;
    else delete UNIFIED_SOURCE_REGISTRY.TEST_MUTATED_VERIFIED_MAS_URL;
  }

  // Genuine IFRS Foundation IFRS 10 wording qualifies for the mapped control topic.
  const officialControlPage = defaultExternalSourceValidator.validateTopicContent(ifrs10Html, topicExpectation);
  assert.equal(officialControlPage.isValid, true);
  assert.match(officialControlPage.substantiveText, /investor controls an investee/i);

  // Official-domain redirects are followed, but a generic destination is not evidence for IFRS 10 control.
  const genericHomepage = '<html><head><title>IFRS Accounting Standards</title></head><main><p>IFRS 10 and control are topics covered by international standards.</p></main></html>';
  const unrelatedRedirect = await new ControlledWebRetriever(undefined, new SourceCache()).fetchOfficialSource(ifrs10Url, {
    useCache: false,
    topicValidation: topicExpectation,
    customFetch: async url => url === ifrs10Url
      ? new Response(null, { status: 302, headers: { location: 'https://www.ifrs.org/issued-standards/list-of-standards/' } })
      : htmlResponse(genericHomepage)
  });
  assert.equal(unrelatedRedirect.status, 'TOPIC_MISMATCH');
  assert.equal(unrelatedRedirect.finalUrl, 'https://www.ifrs.org/issued-standards/list-of-standards/');
  assert.equal(unrelatedRedirect.topicMatched, false);

  const genericPage = await new ControlledWebRetriever(undefined, new SourceCache()).fetchOfficialSource(
    'https://www.ifrs.org/issued-standards/list-of-standards/',
    { useCache: false, topicValidation: topicExpectation, customFetch: async () => htmlResponse(genericHomepage) }
  );
  assert.equal(genericPage.status, 'TOPIC_MISMATCH');

  // Redirect aliases resolve to and retain the final URL after topic validation.
  const aliasUrl = `${ifrs10Url}?source=legacy-alias`;
  const redirectedSuccess = await new ControlledWebRetriever(undefined, new SourceCache()).fetchOfficialSource(aliasUrl, {
    useCache: false,
    topicValidation: topicExpectation,
    customFetch: async url => url === aliasUrl
      ? new Response(null, { status: 301, headers: { location: ifrs10Url } })
      : htmlResponse(ifrs10Html)
  });
  assert.equal(redirectedSuccess.status, 'SUCCESS');
  assert.equal(redirectedSuccess.finalUrl, ifrs10Url);
  assert.equal(redirectedSuccess.sourceUrl, ifrs10Url);
  assert.equal(redirectedSuccess.topicMatched, true);

  // Verified stored URLs are preferred over model-supplied strings; citations require exact registered URLs.
  const section14 = SINGAPORE_STATUTORY_REPOSITORY.ITA_SEC14_GENERAL_DEDUCTION;
  assert.equal(getSafeOfficialUrl(inventedIrasUrl, 'Income Tax Act 1947', 'Section 14(1)', 'IRAS'), '',
    'A sourceStatus-VERIFIED statute record cannot authorize its URL without URL-specific provenance');
  const validStoredCitation = {
    standard: 'Income Tax Act 1947',
    paragraph: 'Section 14(1)',
    authority: 'IRAS',
    officialSourceUrl: section14.canonicalUrl
  };
  assert.equal(defaultCitationVerifier.verifyCitation(validStoredCitation, 'IRAS').status, 'NON_CANONICAL_URL',
    'A sourceStatus-VERIFIED rule with no URL provenance does not produce a clickable citation');
  const alteredCitation = { ...validStoredCitation, officialSourceUrl: `${section14.canonicalUrl}unverified-fragment` };
  assert.equal(defaultCitationVerifier.verifyCitation(alteredCitation, 'IRAS').status, 'NON_CANONICAL_URL');

  const section14Record = defaultSourceRetriever.getSourceById('ITA_SEC14_GENERAL_DEDUCTION');
  assert.equal(section14Record.sourceStatus, 'VERIFIED');
  assert.notEqual(section14Record.urlVerificationStatus, 'VERIFIED');
  const staleBrokenUrl = 'https://www.iras.gov.sg/taxes/income-tax/stale-section-14';
  const staleRuleRecord = { ...section14Record, officialSourceUrl: staleBrokenUrl };
  const staleUrlVerifier = new CitationVerifier({
    getSourceById: id => id === staleRuleRecord.id ? staleRuleRecord : undefined,
    findSourcesByStandardOrAct: () => [staleRuleRecord],
    retrieveSources: async () => []
  });
  assert.equal(staleUrlVerifier.verifyCitation({ ...validStoredCitation, officialSourceUrl: staleBrokenUrl }, 'IRAS').status, 'NON_CANONICAL_URL',
    'Validated local statutory content remains separate from the stale public URL');
  assert.equal(getSafeOfficialUrl(staleBrokenUrl), '');
  assert.equal(sanitizeStatutoryLinks(`[stale source](${staleBrokenUrl})`), 'stale source',
    'A stale deep link is not exposed in rendered answer text.');
  assert.ok(querySingaporeStatutes('Section 14 wholly and exclusively business expenses').some(rule => rule.id === section14.id),
    'Local statutory knowledge remains queryable when its public URL cannot be verified');

  const verifiedSnapshotUrl = 'https://www.iras.gov.sg/taxes/income-tax/verified-section-14';
  for (const mutatedUrl of [
    'https://www.iras.gov.sg/taxes/income-tax/changed-section-14',
    verifiedSnapshotUrl.replace('https://', 'http://'),
    verifiedSnapshotUrl.replace('https://', 'https://user@'),
    verifiedSnapshotUrl.replace('https://www.iras.gov.sg', 'https://www.iras.gov.sg:443')
  ]) {
    const mutatedVerifiedRecord = {
      ...section14Record,
      officialSourceUrl: mutatedUrl,
      canonicalSourceUrl: verifiedSnapshotUrl,
      urlVerificationStatus: 'VERIFIED'
    };
    const mutatedVerifier = new CitationVerifier({
      getSourceById: id => id === mutatedVerifiedRecord.id ? mutatedVerifiedRecord : undefined,
      findSourcesByStandardOrAct: () => [mutatedVerifiedRecord],
      retrieveSources: async () => []
    });
    const mutatedCitation = { ...validStoredCitation, officialSourceUrl: mutatedUrl };
    assert.equal(mutatedVerifier.verifyCitation(mutatedCitation, 'IRAS').status, 'NON_CANONICAL_URL',
      `Citation verification rejects stale, HTTP, or credential-bearing URL identity: ${mutatedUrl}`);
  }

  const ifrs9Url = 'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/';
  assert.equal(isVerifiedLegacyStandardUrl(ifrs9Url, 'SFRS(I) 9'), true);
  assert.equal(isVerifiedLegacyStandardUrl(ifrs9Url, 'SFRS(I) 10'), false,
    'The legacy compatibility URL applies only to its declared standard identity.');
  assert.equal(getSafeOfficialUrl(ifrs9Url), ifrs9Url, 'The narrow legacy allowlist keeps the existing SFRS(I) 9 URL usable');
  for (const modifiedLegacyUrl of [
    `${ifrs9Url}?redirect=elsewhere`,
    `${ifrs9Url}#modified`,
    ifrs9Url.replace(/\/$/, ''),
    ifrs9Url.replace('/ifrs-9-financial', '/IFRS-9-financial'),
    ifrs9Url.replace('https://www.ifrs.org', 'http://www.ifrs.org'),
    ifrs9Url.replace('https://www.ifrs.org', 'https://user@www.ifrs.org'),
    ifrs9Url.replace('https://www.ifrs.org', 'https://www.ifrs.org:443')
  ]) {
    assert.equal(isVerifiedLegacyStandardUrl(modifiedLegacyUrl, 'SFRS(I) 9'), false,
      `Modified legacy allowlist URL must fail exact URL provenance: ${modifiedLegacyUrl}`);
    assert.equal(getSafeOfficialUrl(modifiedLegacyUrl), '');
  }
  const ifrs9Record = defaultSourceRetriever.findSourcesByStandardOrAct('SFRS(I) 9')
    .find(record => record.officialSourceUrl === ifrs9Url);
  assert.ok(ifrs9Record, 'The verified local SFRS(I) 9 source remains in the source registry');
  assert.equal(defaultCitationVerifier.verifyCitation({
    standard: ifrs9Record.standardOrActCode,
    paragraph: ifrs9Record.paragraphOrSection,
    authority: ifrs9Record.authority,
    officialSourceUrl: ifrs9Url
  }).isValid, true, 'The exact explicitly grandfathered SFRS(I) 9 URL remains usable');

  // Mapped retrieval uses an explicit pointer, fetches its topic, and keeps evidence CANDIDATE-only.
  const mappedRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const mapped = await resolveMappedOfficialSourceFallback(
    ['sfrsi10-control'],
    'Does the investor have control of the investee?',
    defaultSourceRetriever,
    {
      webRetriever: mappedRetriever,
      fetchOptions: {
        useCache: false,
        customFetch: async url => url.startsWith('https://www.ifrs.org/') ? htmlResponse(ifrs10Html) : htmlResponse(genericAcraHtml)
      }
    }
  );
  assert.equal(mapped.trace.path, 'MAPPED_SOURCE');
  assert.ok(mapped.trace.sourceMapIds.includes('SFRSI10_SOURCE_MAP'));
  assert.ok(mapped.records.length >= 1);
  const candidate = mapped.records.find(record => record.tags.includes('sfrsi10-control'));
  assert.ok(candidate, 'Control topic should have its own topic-matched candidate');
  assert.equal(candidate.lifecycleState, 'CANDIDATE');
  assert.equal(candidate.sourceStatus, 'NEEDS_REVIEW');
  assert.equal(candidate.provenance, 'LIVE_EXTERNAL');
  assert.equal(candidate.officialSourceUrl, ifrs10Url);
  assert.equal(candidate.canonicalSourceUrl, ifrs10Url, 'The candidate snapshots its validated final URL.');
  assert.equal(candidate.authority, 'ACRA', 'Singapore accounting authority remains separate from the page publisher');
  assert.equal(candidate.sourcePublisher, 'IFRS Foundation', 'IFRS-hosted source is attributed to its actual publisher');
  assert.equal(candidate.authorityName, 'IFRS Foundation');
  assert.equal(mapped.trace.sourceMapIds.includes('SFRSI_FRAMEWORK_ACRA'), false, 'Generic ACRA framework pointer cannot be used for narrow control coverage');
  assert.equal(mapped.records.some(record => record.officialSourceUrl.includes('acra.gov.sg')), false);
  assert.equal(defaultSourceRetriever.getSourceById(candidate.id), undefined, 'Live candidate must not be promoted into the registry');
  assert.equal(mapped.trace.candidateOnly, true);
  assert.deepEqual(mapped.trace.finalVerifiedUrls, [ifrs10Url]);
  assert.equal(mapped.trace.attempts[0].titleMatched, true);
  assert.equal(mapped.trace.attempts[0].contentMatched, true);

  const liveCitation = {
    standard: candidate.standardOrActCode,
    paragraph: candidate.paragraphOrSection,
    authority: 'ACRA',
    officialSourceUrl: candidate.officialSourceUrl
  };
  assert.equal(defaultCitationVerifier.verifyCitation(liveCitation, 'ACRA').isValid, false, 'Live evidence cannot be verified outside its answer scope');
  const liveVerification = defaultCitationVerifier.verifyCitation(liveCitation, 'ACRA', [candidate]);
  assert.equal(liveVerification.status, 'SOURCE_NEEDS_REVIEW');
  assert.equal(liveVerification.isValid, true);
  assert.equal(liveVerification.matchedRecord.sourcePublisher, 'IFRS Foundation');
  assert.equal(getSafeOfficialUrl(candidate.officialSourceUrl, candidate.standardOrActCode, candidate.paragraphOrSection, 'ACRA', [candidate]), ifrs10Url);

  const mutatedLiveCandidate = {
    ...candidate,
    officialSourceUrl: 'https://www.ifrs.org/issued-standards/list-of-standards/changed-ifrs-10/',
    canonicalSourceUrl: candidate.canonicalSourceUrl
  };
  const mutatedLiveCitation = { ...liveCitation, officialSourceUrl: mutatedLiveCandidate.officialSourceUrl };
  assert.equal(getSafeOfficialUrl(mutatedLiveCandidate.officialSourceUrl, mutatedLiveCandidate.standardOrActCode,
    mutatedLiveCandidate.paragraphOrSection, 'ACRA', [mutatedLiveCandidate]), '',
  'The live resolver rejects a same-approved-host URL mutation but retains the validated final URL for the unmodified candidate.');
  assert.equal(defaultCitationVerifier.verifyCitation(mutatedLiveCitation, 'ACRA', [mutatedLiveCandidate]).isValid, false,
    'Live citation validation rejects changed URL identity without bypassing lifecycle or answer-scope qualification.');

  const citationContext = {
    classification: { intent: 'STATUTORY_ADVISORY', primaryDomain: 'ACCOUNTING', taxAnalysisRequired: false, authorities: ['ACRA'], topicIds: [] },
    userFacts: [], missingFacts: [], assumptions: [],
    primaryEvidence: [], officialGuidance: [], curatedSummaries: [candidate], applicationRules: [], currentInformationRequired: false
  };
  const assembled = assembleDeterministicResponse({
    directAnswer: 'Control is assessed from the investor’s power, exposure to variable returns and ability to affect those returns.',
    citations: [liveCitation],
    statuteReferences: [],
    keyRules: [],
    caveats: []
  }, 'How does IFRS 10 define control?', null, citationContext, null, 'SFRS_I');
  assert.match(assembled.messageText, /\(IFRS Foundation; Singapore framework authority: ACRA \/ ASC\)/, 'Rendered source distinguishes the IFRS Foundation page publisher from Singapore framework authority');

  // When a mapped pointer is unavailable, discovery is restricted to approved hosts and the fetched page remains CANDIDATE.
  const noPointerRetriever = {
    getSourceById: () => undefined,
    findSourcesByStandardOrAct: () => [],
    retrieveSources: async () => []
  };
  let discoveryCalls = [];
  const discoveryFetch = async url => {
    discoveryCalls.push(url);
    if (url.endsWith('/robots.txt')) return new Response(`User-agent: *\nSitemap: https://www.ifrs.org/sitemap.xml`, { status: 200, headers: { 'content-type': 'text/plain' } });
    if (url.endsWith('/sitemap.xml')) return htmlResponse('<sitemapindex><sitemap><loc>https://www.ifrs.org/sitemaps/issued-standards.xml</loc></sitemap></sitemapindex>', 200);
    if (url.endsWith('/sitemaps/issued-standards.xml')) return htmlResponse(`<urlset><url><loc>${ifrs10Url}</loc></url></urlset>`, 200);
    if (url === ifrs10Url) return htmlResponse(ifrs10Html);
    return new Response('not found', { status: 404 });
  };
  const discovered = await resolveMappedOfficialSourceFallback(
    ['sfrsi10-control'],
    'Does the investor have control of the investee?',
    noPointerRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { useCache: false, customFetch: discoveryFetch }
    }
  );
  assert.equal(discovered.trace.path, 'DISCOVERED_SOURCE');
  assert.ok(discoveryCalls.includes('https://www.ifrs.org/robots.txt'), 'Production fallback discovers only through approved first-party robots/sitemap metadata');
  assert.ok(discoveryCalls.includes('https://www.ifrs.org/sitemap.xml'));
  assert.ok(discoveryCalls.includes('https://www.ifrs.org/sitemaps/issued-standards.xml'));
  assert.ok(discoveryCalls.includes(ifrs10Url));
  assert.ok(discovered.records.length >= 1);
  assert.ok(discovered.records.every(record => record.lifecycleState === 'CANDIDATE'));

  // A legacy topic with standard identity but no mapped URL uses the same
  // restricted discovery route. The URL is supplied by the official sitemap,
  // and the successful fetch is recorded as CANDIDATE evidence only.
  const ifrs5DiscoveryCalls = [];
  const ifrs5DiscoveryFetch = async url => {
    ifrs5DiscoveryCalls.push(url);
    if (url.endsWith('/robots.txt')) return new Response(`User-agent: *\nSitemap: https://www.ifrs.org/sitemap.xml`, { status: 200, headers: { 'content-type': 'text/plain' } });
    if (url.endsWith('/sitemap.xml')) return htmlResponse('<sitemapindex><sitemap><loc>https://www.ifrs.org/sitemaps/issued-standards.xml</loc></sitemap></sitemapindex>', 200);
    if (url.endsWith('/sitemaps/issued-standards.xml')) return htmlResponse(`<urlset><url><loc>${ifrs5Url}</loc></url></urlset>`, 200);
    if (url === ifrs5Url) return htmlResponse(ifrs5Html);
    return new Response('not found', { status: 404 });
  };
  const heldForSaleDiscovery = await resolveMappedOfficialSourceFallback(
    ['sfrsi_held-for-sale'],
    'When is a non-current asset classified as held for sale?',
    noPointerRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { useCache: false, customFetch: ifrs5DiscoveryFetch }
    }
  );
  assert.equal(heldForSaleDiscovery.trace.path, 'DISCOVERED_SOURCE');
  assert.deepEqual(heldForSaleDiscovery.trace.sourceMapIds, [], 'The legacy topic has no mapped URL and is discovered through the approved sitemap');
  assert.ok(ifrs5DiscoveryCalls.includes('https://www.ifrs.org/robots.txt'));
  assert.ok(ifrs5DiscoveryCalls.includes(ifrs5Url));
  const heldForSaleCandidate = heldForSaleDiscovery.records.find(record => record.tags.includes('sfrsi_held-for-sale'));
  assert.ok(heldForSaleCandidate, 'IFRS 5 discovery should produce topic-matched candidate evidence');
  assert.equal(heldForSaleCandidate.lifecycleState, 'CANDIDATE');
  assert.equal(heldForSaleCandidate.standardOrActCode, 'SFRS(I) 5');
  assert.equal(heldForSaleCandidate.documentTitle, 'IFRS 5 Non-current Assets Held for Sale and Discontinued Operations');
  assert.equal(heldForSaleCandidate.officialSourceUrl, ifrs5Url);
  assert.equal(heldForSaleCandidate.sourcePublisher, 'IFRS Foundation');

  const invalidIfs5Html = '<html><head><title>IFRS Accounting Standards</title></head><main><p>Overview of financial reporting standards.</p></main></html>';
  const invalidIfs5Candidate = await resolveMappedOfficialSourceFallback(
    ['sfrsi_held-for-sale'],
    'When is a non-current asset classified as held for sale?',
    noPointerRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: {
        useCache: false,
        customFetch: async url => {
          if (url.endsWith('/robots.txt')) return new Response(`User-agent: *\nSitemap: https://www.ifrs.org/sitemap.xml`, { status: 200, headers: { 'content-type': 'text/plain' } });
          if (url.endsWith('/sitemap.xml')) return htmlResponse('<sitemapindex><sitemap><loc>https://www.ifrs.org/sitemaps/issued-standards.xml</loc></sitemap></sitemapindex>', 200);
          if (url.endsWith('/sitemaps/issued-standards.xml')) return htmlResponse(`<urlset><url><loc>${ifrs5Url}</loc></url></urlset>`, 200);
          if (url === ifrs5Url) return htmlResponse(invalidIfs5Html);
          return new Response('not found', { status: 404 });
        }
      }
    }
  );
  assert.equal(invalidIfs5Candidate.records.length, 0, 'An official but unrelated/generic page cannot become IFRS 5 evidence');
  assert.equal(invalidIfs5Candidate.trace.path, 'NO_VERIFIED_MAP');
  assert.equal(invalidIfs5Candidate.trace.attempts[0].fetchStatus, 'TOPIC_MISMATCH');

  // Redirecting a mapped IFRS source to another approved publisher changes
  // attribution to the final page while retaining the Singapore authority.
  const acraRedirectUrl = 'https://www.acra.gov.sg/accounting-standards/ifrs-10';
  const redirectAttribution = await resolveMappedOfficialSourceFallback(
    ['sfrsi10-control'],
    'Does the investor have control of the investee?',
    defaultSourceRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: {
        useCache: false,
        customFetch: async url => url === ifrs10Url
          ? new Response(null, { status: 302, headers: { location: acraRedirectUrl } })
          : url === acraRedirectUrl
            ? htmlResponse(ifrs10Html)
            : htmlResponse(genericAcraHtml)
      }
    }
  );
  const redirectedCandidate = redirectAttribution.records.find(record => record.tags.includes('sfrsi10-control'));
  assert.ok(redirectedCandidate, 'Approved-domain redirect should retain fetched topic evidence');
  assert.equal(redirectedCandidate.authority, 'ACRA', 'Singapore framework authority remains unchanged');
  assert.equal(redirectedCandidate.officialSourceUrl, acraRedirectUrl);
  assert.equal(redirectedCandidate.authorityName, 'ACRA', 'Publisher-facing authority name follows the final approved page host');
  assert.equal(redirectedCandidate.sourcePublisher, 'ACRA', 'Citation attribution follows the final approved page host');

  const unavailableDiscovery = await resolveMappedOfficialSourceFallback(
    ['sfrsi10-control'],
    'Does the investor have control of the investee?',
    noPointerRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: { useCache: false, customFetch: async () => new Response('unavailable', { status: 503 }) }
    }
  );
  assert.equal(unavailableDiscovery.records.length, 0);
  assert.equal(unavailableDiscovery.trace.path, 'NO_VERIFIED_MAP');

  // IRAS's published HTML sitemap is discovery metadata only. A listed URL
  // becomes evidence only after its own page is fetched and topic-validated.
  const ir21ReplacementUrl = 'https://www.iras.gov.sg/taxes/individual-income-tax/employers/tax-clearance-for-employees';
  const ir21SitemapUrl = 'https://www.iras.gov.sg/sitemap';
  const ir21PageTitle = 'IRAS | Tax Clearance for Employees';
  const ir21PageHtml = `<html><head><title>${ir21PageTitle}</title></head><body><main>
    <h1>Tax Clearance for Employees</h1>
    <p>Generally, when your non-Singapore Citizen employee ceases employment with you in Singapore, goes on an overseas posting or plans to leave Singapore for more than three months, you must notify IRAS at least one month in advance and withhold all monies due to the employee.</p>
    <h2>When to File the Form IR21</h2>
    <p>If tax clearance is required for your employee, you must file the Form IR21 at least one month before the employee ceases to work for you in Singapore.</p>
  </main></body></html>`;
  const ir21SitemapHtml = `<html><body><main>
    <a href="${ir21ReplacementUrl}">Tax Clearance for Employees</a>
    <a href="https://example.com/tax-clearance-for-employees">Tax Clearance for Employees</a>
    <a href="/sitemap">Sitemap</a>
    <a href="/taxes/goods-services-tax/gst-filing">GST Filing</a>
  </main></body></html>`;
  const ir21Map = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_IR21_SOURCE_MAP');
  assert.ok(ir21Map);
  const ir21NoMapCalls = [];
  const ir21NoMapFetch = async url => {
    ir21NoMapCalls.push(url);
    if (url === ir21SitemapUrl) return htmlResponse(ir21SitemapHtml);
    if (url === ir21ReplacementUrl) return htmlResponse(ir21PageHtml);
    return new Response('not found', { status: 404 });
  };
  const ir21NoMapWeb = new ControlledWebRetriever(undefined, new SourceCache());
  const ir21NoMapAdapter = new OfficialSitemapDiscoveryAdapter(ir21NoMapWeb, { timeoutMs: 100, customFetch: ir21NoMapFetch });
  const ir21DiscoveredWithoutMap = await resolveMappedOfficialSourceFallback(
    ['iras-employer-ir21'],
    'When do we need to file IR21?',
    noPointerRetriever,
    {
      webRetriever: ir21NoMapWeb,
      discoveryAdapter: ir21NoMapAdapter,
      fetchOptions: { useCache: false, customFetch: ir21NoMapFetch }
    }
  );
  assert.equal(ir21DiscoveredWithoutMap.trace.path, 'DISCOVERED_SOURCE');
  assert.deepEqual(ir21DiscoveredWithoutMap.trace.sourceMapIds, [], 'The sitemap can discover an IRAS page when no source-map pointer is available.');
  assert.equal(ir21NoMapCalls[0], ir21SitemapUrl, 'The published IRAS /sitemap page is the first discovery request.');
  assert.ok(!ir21NoMapCalls.includes('https://www.iras.gov.sg/robots.txt'));
  assert.equal(ir21DiscoveredWithoutMap.records[0].officialSourceUrl, ir21ReplacementUrl);
  assert.equal(ir21DiscoveredWithoutMap.records[0].lifecycleState, 'CANDIDATE');
  const indexEntry = ir21NoMapAdapter.getIndexedCandidates().find(entry => entry.canonicalUrl === ir21ReplacementUrl);
  assert.equal(indexEntry.authority, 'IRAS');
  assert.equal(indexEntry.pageTitle, 'Tax Clearance for Employees');
  assert.ok(indexEntry.hierarchy.length > 0);
  assert.match(indexEntry.normalizedPath, /tax-clearance-for-employees/);
  assert.ok(indexEntry.topicHints.includes('clearance'));
  assert.equal(Object.hasOwn(indexEntry, 'sourceText'), false, 'The discovery index stores URL metadata, never tax-page content.');
  assert.equal(Object.hasOwn(indexEntry, 'sourceMapIds'), false, 'Query routing does not imply a candidate-specific source-map relationship.');
  assert.ok(!ir21NoMapAdapter.getIndexedCandidates().some(entry => entry.canonicalUrl.startsWith('https://example.com/')),
    'Off-domain sitemap links are discarded before candidate ranking.');

  const cachedDiscoveryCalls = [];
  const cachedDiscoveryFetch = async url => {
    cachedDiscoveryCalls.push(url);
    if (url === ir21SitemapUrl) return htmlResponse(ir21SitemapHtml);
    if (url === ir21ReplacementUrl) return htmlResponse(ir21PageHtml);
    return new Response('not found', { status: 404 });
  };
  const sharedWebRetriever = new ControlledWebRetriever(undefined, new SourceCache());
  const cachedDiscoveryOptions = {
    webRetriever: sharedWebRetriever,
    fetchOptions: { useCache: false, customFetch: cachedDiscoveryFetch }
  };
  await resolveMappedOfficialSourceFallback(['iras-employer-ir21'], 'When do we need to file IR21?', noPointerRetriever, cachedDiscoveryOptions);
  await resolveMappedOfficialSourceFallback(['iras-employer-ir21'], 'When do we need to file IR21?', noPointerRetriever, cachedDiscoveryOptions);
  assert.equal(cachedDiscoveryCalls.filter(url => url === ir21SitemapUrl).length, 1,
    'The default adapter retains sitemap index/cache metadata across requests for the same web retriever.');

  const sitemapOnly = await resolveMappedOfficialSourceFallback(
    ['iras-employer-ir21'], 'When do we need to file IR21?', noPointerRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: {
        useCache: false,
        customFetch: async url => url === ir21SitemapUrl ? htmlResponse(ir21SitemapHtml) : new Response('not found', { status: 404 })
      }
    }
  );
  assert.equal(sitemapOnly.records.length, 0, 'Sitemap membership without a fetched substantive page creates no evidence record.');
  assert.equal(sitemapOnly.trace.attempts.find(attempt => attempt.fetchStatus === 'HTTP_ERROR')?.fetchStatus, 'HTTP_ERROR');
  const sitemapOnlyQuality = evaluateEvidenceQuality({
    query: 'When do we need to file IR21?', topicIds: ['iras-employer-ir21'], records: [], missingFacts: [],
    sourceMapFallbackTrace: sitemapOnly.trace
  });
  assert.equal(sitemapOnlyQuality.status, 'INSUFFICIENT', 'An index URL alone cannot support an IRAS claim.');

  const ir21TopicMismatch = await resolveMappedOfficialSourceFallback(
    ['iras-employer-ir21'], 'When do we need to file IR21?', noPointerRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: {
        useCache: false,
        customFetch: async url => url === ir21SitemapUrl
          ? htmlResponse(ir21SitemapHtml)
          : url === ir21ReplacementUrl
            ? htmlResponse('<html><head><title>Tax Clearance for Employees</title></head><main><h1>Tax Clearance for Employees</h1><p>General employer information and tax services.</p></main></html>')
            : new Response('not found', { status: 404 })
      }
    }
  );
  assert.equal(ir21TopicMismatch.records.length, 0, 'A relevant sitemap label cannot make an unrelated fetched page evidence.');
  assert.ok(ir21TopicMismatch.trace.attempts.some(attempt => attempt.fetchStatus === 'TOPIC_MISMATCH'));

  const ir21RedirectRejected = await resolveMappedOfficialSourceFallback(
    ['iras-employer-ir21'], 'When do we need to file IR21?', noPointerRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: {
        useCache: false,
        customFetch: async url => url === ir21SitemapUrl
          ? htmlResponse(ir21SitemapHtml)
          : url === ir21ReplacementUrl
            ? new Response(null, { status: 302, headers: { location: 'https://example.com/tax-clearance-for-employees' } })
            : new Response('not found', { status: 404 })
      }
    }
  );
  assert.equal(ir21RedirectRejected.records.length, 0, 'A candidate is rejected if its final redirect leaves the approved domain.');
  assert.ok(ir21RedirectRejected.trace.attempts.some(attempt => attempt.fetchStatus === 'REDIRECT_REJECTED'));

  const staleMapDiscovery = await resolveMappedOfficialSourceFallback(
    ['iras-employer-ir21'], 'When do we need to file IR21?', defaultSourceRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: {
        useCache: false,
        customFetch: async url => url === ir21Map.canonicalSourceUrl
          ? new Response('stale mapped route', { status: 404 })
          : url === ir21SitemapUrl
            ? htmlResponse(ir21SitemapHtml)
            : url === ir21ReplacementUrl
              ? htmlResponse(ir21PageHtml)
              : new Response('not found', { status: 404 })
      }
    }
  );
  assert.equal(staleMapDiscovery.trace.path, 'DISCOVERED_SOURCE', 'Sitemap lookup can resolve a stale mapped IRAS route after the mapped fetch fails.');
  assert.ok(staleMapDiscovery.trace.sourceMapIds.includes(ir21Map.id), 'The existing source-map attempt remains in the routing trace.');
  assert.ok(staleMapDiscovery.trace.attempts.some(attempt => attempt.sourceMapId === ir21Map.id && attempt.fetchStatus === 'HTTP_ERROR'));

  // Previously equity-accounted associate becomes a subsidiary after a further purchase.
  // The explicit transition relation selects SFRS(I) 1-28, 10 and 3 source maps.
  const transitionQuery = 'Held 30%, equity-accounted; acquired another 35% and obtained control.';
  const transition = await resolveMappedOfficialSourceFallback(
    ['sfrsi10-control', 'sfrsi128-equity-method'],
    transitionQuery,
    defaultSourceRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      fetchOptions: {
        useCache: false,
        customFetch: async url => {
          const title = url.includes('/ias-28-')
            ? 'IAS 28 Investments in Associates and Joint Ventures'
            : url.includes('/ifrs-3-')
              ? 'IFRS 3 Business Combinations'
              : 'IFRS 10 Consolidated Financial Statements';
          const body = url.includes('/ias-28-')
            ? 'IAS 28 describes the equity method for an associate. An associate becomes a subsidiary when the investor obtains control.'
            : url.includes('/ifrs-3-')
              ? 'IFRS 3 addresses a business combination achieved in stages when an associate becomes a subsidiary.'
              : 'IFRS 10 establishes control as the basis for consolidation when an associate becomes a subsidiary.';
          return htmlResponse(`<html><head><title>${title}</title></head><main><h1>${title}</h1><p>${body}</p></main></html>`);
        }
      }
    }
  );
  assert.ok(transition.trace.sourceMapIds.includes('SFRSI128_SOURCE_MAP'));
  assert.ok(transition.trace.sourceMapIds.includes('SFRSI10_SOURCE_MAP'));
  assert.ok(transition.trace.sourceMapIds.includes('SFRSI3_SOURCE_MAP'));
  assert.ok(transition.trace.attempts.some(attempt => attempt.sourceMapId === 'SFRSI128_SOURCE_MAP'));
  assert.ok(transition.trace.attempts.some(attempt => attempt.sourceMapId === 'SFRSI10_SOURCE_MAP'));
  assert.ok(transition.trace.attempts.some(attempt => attempt.sourceMapId === 'SFRSI3_SOURCE_MAP'));
  for (const [standardCode, expectedPath] of [
    ['SFRS(I) 1-28', '/ias-28-'],
    ['SFRS(I) 10', '/ifrs-10-'],
    ['SFRS(I) 3', '/ifrs-3-']
  ]) {
    const fetchedCandidate = transition.records.find(record => record.standardOrActCode === standardCode && record.lifecycleState === 'CANDIDATE');
    assert.ok(fetchedCandidate, `Cross-standard transition should have fetched candidate evidence for ${standardCode}`);
    assert.ok(fetchedCandidate.officialSourceUrl.includes(expectedPath));
    assert.equal(fetchedCandidate.sourcePublisher, 'IFRS Foundation');
  }

  const rejectedDiscovery = await resolveMappedOfficialSourceFallback(
    ['sfrsi10-control'],
    'Does the investor have control of the investee?',
    noPointerRetriever,
    {
      webRetriever: new ControlledWebRetriever(undefined, new SourceCache()),
      discoveryAdapter: { discoverOfficialSourceCandidates: async () => ['https://example.com/not-official'] }
    }
  );
  assert.equal(rejectedDiscovery.records.length, 0);
  assert.equal(rejectedDiscovery.trace.attempts[0].fetchStatus, 'UNAUTHORIZED_DOMAIN_ACCESS');

  console.log('PASS | Verified official URL, redirect, topic validation, mapped fallback, discovery, and candidate lifecycle');
}

run().catch(error => {
  console.error('VERIFIED OFFICIAL CITATION FALLBACK FAILED');
  console.error(error);
  process.exit(1);
});
