import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { defaultAdvancedSourceRetriever } from '../../src/retrieval/advancedSourceRetriever.ts';
import { supportGeneralIrasRuleConcept } from '../../src/retrieval/irasRuleConceptSupport.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS } from '../../src/standards/coverageRegistry.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../src/services/irasEvidencePolicy.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding, validateSemanticQuestionInterpretation } from '../../src/services/semanticQuestionUnderstanding.ts';
import { irasResolverCases } from '../fixtures/irasResolverCases.mjs';

const REFERENCE_DATE = '2026-10-02';
const SYNTHETIC_COMPOSITION = 'SYNTHETIC_COMPOSITION_NOT_ORIGINAL_PAGE_OR_BLOCK_ADJACENCY';
const normalize = value => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const readJson = async relativePath => JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
const [foreignReport, gstReport] = await Promise.all([
  readJson('../../docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v2/iras-public-rule-excerpts-report-v2.json'),
  readJson('../../docs/evaluation/multi-authority-workstreams/iras-public-excerpts-2026-10-03-v1/iras-public-rule-excerpts-report-v1.json')
]);

const excerpt = (report, mapId, blockIndex) => {
  const result = report.results.find(row => row.mapId === mapId);
  const value = result?.excerpts.find(row => row.blockIndex === blockIndex);
  assert.ok(value && !value.truncated, `Saved public excerpt ${mapId}:${blockIndex} is intact.`);
  return value;
};
const foreignExcerpt = excerpt(foreignReport, 'IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP', 10);
const foreignParts = foreignExcerpt.text.split(/\r?\n\s*\r?\n/);
assert.equal(foreignParts.length, 2);
const gstExcerpt = excerpt(gstReport, 'IRAS_GST_INPUT_TAX_SOURCE_MAP', 7);
const gstRule = gstExcerpt.text.replace(/^•\s*\r?\n\s*\r?\n/, '').trim();
assert.match(gstExcerpt.text, /^•\s*\r?\n\s*\r?\n/,
  'The saved GST excerpt retains the disclosed standalone leading bullet removal.');

const cases = [
  {
    id: 'foreign-dividend-treatment', mapId: 'IRAS_CIT_FOREIGN_INCOME_SOURCE_MAP',
    topicId: 'iras-foreign-sourced-income',
    rule: foreignParts[1], incomplete: foreignParts[1].split(/(?<=[.!?])\s+/).slice(0, 2).join(' '),
    distractors: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map(label =>
      `Synthetic selection-only metadata ${label}: Singapore company, current year, Thai subsidiary, received, foreign dividend receipt, corporate income tax treatment, foreign-sourced income and exemption. This is query-topic metadata only; no tax outcome is stated.`),
    evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED'
  },
  {
    id: 'gst-input-tax-general-rule', mapId: 'IRAS_GST_INPUT_TAX_SOURCE_MAP',
    topicId: 'iras-gst-input-tax',
    rule: gstRule, incomplete: gstRule.slice(0, gstRule.indexOf('. ') + 1),
    distractors: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map(label =>
      `Synthetic selection-only metadata ${label}: Singapore, GST-registered company, general GST rules, claiming input tax, business purchases, tax invoices and claim requirements. This is query-topic metadata only; no entitlement or tax outcome is stated.`),
    evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED'
  }
];

function understandingFor(testCase) {
  const frozenIssue = testCase.issues[0];
  const interpretation = {
    schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: ['IRAS'], contextualAuthorities: [],
    domain: frozenIssue.domain, population: frozenIssue.population, primarySubject: frozenIssue.subject,
    concepts: [{ concept: frozenIssue.subject, role: 'PRIMARY' }], requestedOperation: frozenIssue.operation,
    factsExplicitlyProvided: [], confidence: 0.96,
    issues: [{
      subject: frozenIssue.subject, population: frozenIssue.population, domain: frozenIssue.domain,
      governingAuthorities: ['IRAS'], contextualAuthorities: [], operation: frozenIssue.operation,
      mappedTopicIds: [], evidenceRequirement: 'AUTHORITATIVE_SOURCE', confidence: 0.96
    }]
  };
  assert.ok(validateSemanticQuestionInterpretation(interpretation, testCase.query));
  const questionUnderstanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  const classification = classifyQuestion(testCase.query);
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classification, questionUnderstanding);
  const issue = reconciled.issuePlan.issues[0];
  const topicIds = [...new Set([...(issue.mappedTopicIds || []), ...testCase.requiredTopicIds])];
  const requestedConcepts = getRequestedQuestionConcepts(testCase.query, questionUnderstanding);
  assert.ok(topicIds.includes(testCase.topicId) && requestedConcepts.some(concept => concept.topicIds.includes(testCase.topicId)));
  return { questionUnderstanding, classification: reconciled.classification, reconciled, issue, topicIds, requestedConcepts };
}

function ruleSupport(sourceText, sourceMap, issue, topicIds, concepts) {
  return concepts.map(concept => supportGeneralIrasRuleConcept({
    sourceText, domainId: sourceMap.domainId, topicIds, subject: issue.subject,
    population: issue.population, concepts: [concept]
  }));
}

const closedKnownMaps = new Map(['IRAS_GST_INVOICING_SOURCE_MAP'].map(id => {
  const definition = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === id);
  assert.ok(definition, `Closed source map ${id} is registered.`);
  return [definition.canonicalSourceUrl, id];
}));
const closed = { ambient: 0, selectedMappedGet: 0, closedKnownMappedGet: 0, unexpectedMappedGet: 0, discovery: 0, search: 0 };
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => {
  closed.ambient += 1;
  throw new Error('AMBIENT_NETWORK_DISABLED');
};

try {
  for (const sourceCase of cases) {
    const testCase = irasResolverCases.find(item => item.id === sourceCase.id);
    assert.ok(testCase?.issues.length === 1);
    const { questionUnderstanding, reconciled, issue, topicIds, requestedConcepts } = understandingFor({
      ...testCase, topicId: sourceCase.topicId
    });
    const sourceMap = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === sourceCase.mapId);
    assert.ok(sourceMap?.topicIds.includes(sourceCase.topicId));
    const sourceRuleSupport = ruleSupport(sourceCase.rule, sourceMap, issue, topicIds, requestedConcepts);
    assert.ok(sourceRuleSupport.includes(true), `${sourceCase.id}: the intact saved rule is helper-supported.`);
    assert.equal(ruleSupport(sourceCase.incomplete, sourceMap, issue, topicIds, requestedConcepts).includes(true), false,
      `${sourceCase.id}: the incomplete rule control remains unsupported.`);

    if (sourceCase.id === 'foreign-dividend-treatment') {
      assert.equal(ruleSupport(`${sourceCase.rule} Foreign dividends are expressly excluded from this general rule.`,
        sourceMap, issue, topicIds, requestedConcepts).includes(true), false,
      'An express exclusion cannot become positive general-rule support.');
      assert.equal(supportGeneralIrasRuleConcept({
        sourceText: sourceCase.rule, domainId: 'IRAS_GST', topicIds: [sourceCase.topicId],
        subject: issue.subject, population: issue.population, concepts: requestedConcepts
      }), undefined, 'A rule family outside the canonical source domain remains inactive.');
      const materialSpecific = [{ ...requestedConcepts[0], label: issue.subject, terms: ['treaty relief'] }];
      assert.equal(ruleSupport(sourceCase.rule, sourceMap, issue, topicIds, materialSpecific)[0], undefined,
        'A material-specific treaty question does not use the general-rule equivalence path.');
    }

    const composition = [
      ...sourceCase.distractors.slice(0, 3), sourceCase.rule, ...sourceCase.distractors.slice(3)
    ].join('\n\n');
    const selectedRuleText = sourceCase.id === 'foreign-dividend-treatment'
      ? `Tax Reliefs on Foreign Income\n\n${composition}`
      : composition;
    const selectedMapUrl = sourceMap.canonicalSourceUrl;
    const body = sourceCase.id === 'foreign-dividend-treatment'
      ? `<section><h2>Tax Reliefs on Foreign Income</h2>${[...sourceCase.distractors.slice(0, 3), sourceCase.rule, ...sourceCase.distractors.slice(3)].map(text => `<p>${escapeHtml(text)}</p>`).join('')}</section>`
      : [...sourceCase.distractors.slice(0, 3), sourceCase.rule, ...sourceCase.distractors.slice(3)].map(text => `<p>${escapeHtml(text)}</p>`).join('');
    assert.equal(SYNTHETIC_COMPOSITION, 'SYNTHETIC_COMPOSITION_NOT_ORIGINAL_PAGE_OR_BLOCK_ADJACENCY');
    assert.ok(normalize(selectedRuleText).includes(normalize(sourceCase.rule)));

    const customFetch = async (urlValue, init = {}) => {
      const url = String(urlValue);
      if (url === selectedMapUrl && (init.method || 'GET').toUpperCase() === 'GET') {
        closed.selectedMappedGet += 1;
        return new Response(`<html><head><title>${escapeHtml(sourceMap.pageTitle)} | IRAS</title></head><body><main><h1>${escapeHtml(sourceMap.pageTitle)} | IRAS</h1>${body}</main></body></html>`, {
          status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
      if (closedKnownMaps.has(url) && (init.method || 'GET').toUpperCase() === 'GET') {
        closed.closedKnownMappedGet += 1;
        return new Response(null, { status: 503 });
      }
      closed.unexpectedMappedGet += 1;
      return new Response(null, { status: 503 });
    };
    const discoveryAdapter = {
      async discoverOfficialSourceCandidates() { closed.discovery += 1; return []; },
      getLastFetchTrace() { return []; }
    };
    const officialDomainSearchAdapter = {
      async searchOfficialDomainCandidates() { closed.search += 1; return []; },
      getLastSearchTrace() { return []; }
    };
    const groundingOptions = {
      discoveryAdapter, officialDomainSearchAdapter,
      fetchOptions: { customFetch, timeoutMs: 5_000, useCache: false },
      authorityLevelDiscovery: false, localOnly: false, referenceDate: REFERENCE_DATE, questionUnderstanding,
      evidenceScope: {
        authority: 'IRAS', domain: issue.domain, topicIds, requestedConcepts,
        context: {
          domainId: sourceMap.domainId, population: issue.population, primarySubject: issue.subject,
          concepts: [issue.subject], requestedOperation: issue.operation
        }
      }
    };
    const grounded = await buildGroundedReasoningContext(testCase.query, null,
      defaultAdvancedSourceRetriever, undefined, groundingOptions);
    const mapRecords = (grounded.evidenceQuality?.eligibleRecords || []).filter(record => record.canonicalSourceUrl === selectedMapUrl);
    const topicMapRecords = mapRecords.filter(record => record.tags?.includes(sourceCase.topicId));
    assert.ok(topicMapRecords.length > 0, `${sourceCase.id}: the mapped record has the expected registered topic tag.`);
    assert.ok(mapRecords.length > 0 && mapRecords.some(record => normalize(record.sourceText).includes(normalize(sourceCase.rule))),
      `${sourceCase.id}: source admission preserves the intact public rule text.`);
    assert.ok(ruleSupport(topicMapRecords[0].sourceText, sourceMap, issue, topicIds, requestedConcepts).includes(true),
      `${sourceCase.id}: the same requested concept is supported by the complete record text.`);

    // The topic association is intentionally carried outside `tags` here. It
    // models the other accepted registry/source-map association fields without
    // loosening the central pipeline's actual mapped-page record metadata.
    const associatedWithoutTags = {
      ...grounded,
      evidenceQuality: {
        ...grounded.evidenceQuality,
        eligibleRecords: grounded.evidenceQuality.eligibleRecords.map(record => record.canonicalSourceUrl === selectedMapUrl &&
          record.tags?.includes(sourceCase.topicId)
          ? { ...record, tags: [], sourceMapTopicIds: [sourceCase.topicId] }
          : record)
      }
    };
    const render = () => renderIrasEvidenceResponse({}, associatedWithoutTags, testCase.query, null, 'SFRS_I', 'LOCAL');
    const firstRender = render();
    const secondRender = render();
    const accepted = firstRender.claimVerification?.accepted || [];
    const acceptedFromMap = accepted.filter(claim => mapRecords.some(record => record.id === claim.recordId));
    assert.ok(acceptedFromMap.some(claim => normalize(claim.quote).includes(normalize(sourceCase.rule))),
      `${sourceCase.id}: helper-supported text is selected through its non-tag topic association.`);
    assert.ok(acceptedFromMap.length <= 3, `${sourceCase.id}: the per-source quote cap remains intact.`);
    assert.ok(accepted.length <= 8, `${sourceCase.id}: the total quote bound remains intact.`);
    assert.deepEqual(
      (secondRender.claimVerification?.accepted || []).map(claim => [claim.recordId, normalize(claim.quote)]),
      accepted.map(claim => [claim.recordId, normalize(claim.quote)]),
      `${sourceCase.id}: support priority preserves stable output order.`
    );
    assert.ok(acceptedFromMap.every(claim => normalize(claim.quote).length <= 3_200));

    const renderWithMappedRecordChange = change => {
      const variantContext = {
        ...grounded,
        evidenceQuality: {
          ...grounded.evidenceQuality,
          eligibleRecords: grounded.evidenceQuality.eligibleRecords.map(record => record.canonicalSourceUrl === selectedMapUrl &&
            record.tags?.includes(sourceCase.topicId) ? change(record) : record)
        }
      };
      return renderIrasEvidenceResponse({}, variantContext, testCase.query, null, 'SFRS_I', 'LOCAL');
    };
    if (sourceCase.id === 'foreign-dividend-treatment') {
      const separateExclusionText = `${topicMapRecords[0].sourceText}\n\nForeign-sourced dividends are expressly excluded from this general rule.`;
      assert.equal(ruleSupport(separateExclusionText, sourceMap, issue, topicIds, requestedConcepts).includes(true), false,
        'A separate paragraph excluding dividends prevents full-record general-rule support.');
      const excludedRecordRender = renderWithMappedRecordChange(record => ({ ...record, sourceText: separateExclusionText }));
      assert.equal((excludedRecordRender.claimVerification?.accepted || []).some(claim =>
        topicMapRecords.some(record => record.id === claim.recordId) && normalize(claim.quote).includes(normalize(sourceCase.rule))), false,
      'A rule paragraph followed elsewhere in the admitted source by a dividend exclusion receives no selection priority.');
    }

    const wrongTopicContext = {
      ...grounded,
      evidenceQuality: {
        ...grounded.evidenceQuality,
        eligibleRecords: grounded.evidenceQuality.eligibleRecords.map(record => record.canonicalSourceUrl === selectedMapUrl &&
          record.tags?.includes(sourceCase.topicId)
          ? { ...record, tags: ['iras-gst-registration'], sourceMapTopicIds: [], relatedTopicIds: [] }
          : record)
      }
    };
    const wrongTopicRender = renderIrasEvidenceResponse({}, wrongTopicContext, testCase.query, null, 'SFRS_I', 'LOCAL');
    assert.equal((wrongTopicRender.claimVerification?.accepted || []).some(claim =>
      topicMapRecords.some(record => record.id === claim.recordId) && normalize(claim.quote).includes(normalize(sourceCase.rule))), false,
    `${sourceCase.id}: a record associated only with a wrong topic receives no helper priority.`);

    const wrongLegacyDomain = sourceCase.id === 'foreign-dividend-treatment' ? 'IRAS_GST' : 'IRAS_TAX';
    for (const [field, value] of [['domain', wrongLegacyDomain], ['authority', 'ACRA']]) {
      const wrongMetadataRender = renderWithMappedRecordChange(record => ({ ...record, [field]: value }));
      assert.equal((wrongMetadataRender.claimVerification?.accepted || []).some(claim =>
        topicMapRecords.some(record => record.id === claim.recordId) && normalize(claim.quote).includes(normalize(sourceCase.rule))), false,
      `${sourceCase.id}: wrong ${field} metadata cannot activate requested-rule selection priority.`);
    }

    const workstreams = await buildAuthorityWorkstreams(testCase.query, reconciled.issuePlan, {
      retriever: defaultAdvancedSourceRetriever, questionUnderstanding, referenceDate: REFERENCE_DATE, groundingOptions
    });
    const finalIssue = workstreams.workstreams.flatMap(stream => stream.issues).find(item => item.issueId === issue.id);
    assert.ok(finalIssue, `${sourceCase.id}: central workstream retains the frozen issue.`);
    assert.equal(finalIssue.evidenceStatus, sourceCase.evidenceStatus);
    assert.equal(finalIssue.applicationStatus, sourceCase.applicationStatus);
    assert.ok(finalIssue.verifiedClaims?.some(claim => normalize(claim.quote).includes(normalize(sourceCase.rule))),
      `${sourceCase.id}: central verified claims retain the complete saved rule.`);
  }
} finally {
  globalThis.fetch = previousFetch;
}

assert.equal(closed.ambient, 0, 'Ambient network is blocked.');
assert.equal(closed.unexpectedMappedGet, 0, 'Only selected maps and the enumerated closed GST map can be requested.');
assert.equal(closed.discovery, 0, 'Source discovery remains closed.');
assert.equal(closed.search, 0, 'Official-domain search remains closed.');
assert.ok(closed.selectedMappedGet > 0, 'The frozen mapped source uses the injected transport.');
process.stdout.write('IRAS requested-rule quote priority regression passed.\n');
