import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../../../src/classification/questionClassifier.ts';
import { defaultSourceRetriever } from '../../../../src/retrieval/sourceRetriever.ts';
import { supportGeneralIrasRuleConcept } from '../../../../src/retrieval/irasRuleConceptSupport.ts';
import { matchesRequestedQuestionConcept } from '../../../../src/retrieval/evidenceQualityGate.ts';
import { buildAuthorityWorkstreams, planAuthorityWorkstreams } from '../../../../src/services/authorityWorkstreams.ts';
import { buildGroundedReasoningContext } from '../../../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse } from '../../../../src/services/irasEvidencePolicy.ts';
import {
  getRequestedQuestionConcepts,
  reconcileQuestionUnderstanding,
  validateSemanticQuestionInterpretation
} from '../../../../src/services/semanticQuestionUnderstanding.ts';
import { getCoverageTopicsByIds } from '../../../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../../../src/standards/unifiedSourceModel.ts';
import { findRecordEligibilityRejection, verifyEvidenceClaims } from '../../../../src/verification/claimEvidenceVerifier.ts';

const OUTPUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lifecycle-proof.json');
const REFERENCE_DATE = '2026-10-03';

const cases = [
  {
    id: 'private-expense-treatment',
    query: "Our Singapore company paid SGD 900 for the director's private holiday and recorded it as travel expense. What is its corporate income-tax treatment?",
    root: {
      domain: 'IRAS_INCOME_TAX', population: 'COMPANY', authorityCandidates: ['IRAS'], contextualAuthorities: [],
      primarySubject: 'corporate income-tax treatment of private expense', requestedOperation: 'DETERMINE_TREATMENT',
      concepts: [
        { concept: 'private or domestic expense', role: 'PRIMARY' },
        { concept: 'corporate income-tax deductibility', role: 'RELATED' }
      ],
      factsExplicitlyProvided: ['company expense', "director's private holiday", 'expense amount']
    },
    issues: [
      {
        subject: "corporate income-tax treatment and deductibility of director's private holiday expense",
        population: 'COMPANY', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], contextualAuthorities: [],
        operation: 'DETERMINE_TREATMENT', mappedTopicIds: []
      }
    ],
    expectedTopics: ['iras-cit-disallowed-expenses', 'iras-cit-deductibility']
  },
  {
    id: 'gst-input-tax-general-rule',
    query: 'What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company?',
    root: {
      domain: 'IRAS_GST', population: 'COMPANY', authorityCandidates: ['IRAS'], contextualAuthorities: [],
      primarySubject: 'general GST input-tax recovery rules for business purchases', requestedOperation: 'EXPLAIN_RULE',
      concepts: [
        { concept: 'general input tax recovery conditions', role: 'PRIMARY' },
        { concept: 'business purchases by a GST-registered company', role: 'RELATED' }
      ],
      factsExplicitlyProvided: []
    },
    issues: [
      {
        subject: 'general GST input-tax recovery rules for business purchases by a GST-registered company',
        population: 'COMPANY', domain: 'IRAS_GST', governingAuthorities: ['IRAS'], contextualAuthorities: [],
        operation: 'EXPLAIN_RULE', mappedTopicIds: []
      }
    ],
    expectedTopics: ['iras-gst-input-tax']
  },
  {
    id: 'A-paraphrase-2-cpf-issue',
    query: 'For someone earning SGD 6,000 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?',
    root: {
      domain: 'UNKNOWN', population: 'UNKNOWN', authorityCandidates: ['UNKNOWN'], contextualAuthorities: [],
      primarySubject: 'employer CPF contribution amount and individual personal tax relief for compulsory CPF contributions',
      requestedOperation: 'OTHER',
      concepts: [
        { concept: 'employer CPF contribution amount', role: 'PRIMARY' },
        { concept: 'personal tax relief on compulsory CPF contributions', role: 'RELATED' }
      ],
      factsExplicitlyProvided: ['monthly earnings', 'employer CPF contribution', 'compulsory CPF contributions']
    },
    issues: [
      {
        subject: 'employer CPF contribution amount', population: 'EMPLOYER', domain: 'CPF_PAYROLL',
        governingAuthorities: ['CPF'], contextualAuthorities: [], operation: 'CALCULATE', mappedTopicIds: []
      },
      {
        subject: 'individual personal tax relief claim for compulsory CPF contributions', population: 'INDIVIDUAL',
        domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], contextualAuthorities: ['CPF'],
        operation: 'CHECK_ELIGIBILITY', mappedTopicIds: []
      }
    ],
    expectedTopicsByAuthority: { CPF: ['cpf_contribution_rates'], IRAS: ['iras-individual-cpf-relief', 'iras-individual-reliefs'] }
  }
];

function makeUnderstanding(testCase) {
  const wire = {
    schemaVersion: 2,
    jurisdiction: ['Singapore'],
    ...testCase.root,
    issues: testCase.issues.map(issue => ({
      ...issue,
      evidenceRequirement: issue.operation === 'EXPLAIN_RULE' || issue.operation === 'OTHER'
        ? 'AUTHORITATIVE_SOURCE' : 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
      confidence: 0.99
    })),
    confidence: 0.99
  };
  const interpretation = validateSemanticQuestionInterpretation(wire, testCase.query);
  assert.ok(interpretation, `${testCase.id}: semantic mock rejected by production validator`);
  return { mode: 'SEMANTIC_INTERPRETATION', interpretation };
}

function summarizeRecord(record) {
  return {
    id: record.id,
    title: record.documentTitle,
    authority: record.authority,
    domain: record.domain,
    sourceType: record.sourceType,
    evidenceTier: record.evidenceTier,
    sourceStatus: record.sourceStatus,
    verificationMethod: record.verificationMethod,
    provenance: record.provenance,
    lifecycleState: record.lifecycleState,
    isVerbatimText: record.isVerbatimText,
    effectiveDate: record.effectiveDate,
    validFrom: record.validFrom,
    validTo: record.validTo,
    lastVerifiedDate: record.lastVerifiedDate,
    reviewAuditCycleDays: record.reviewAuditCycleDays,
    officialSourceUrl: record.officialSourceUrl,
    canonicalSourceUrl: record.canonicalSourceUrl,
    topicBindings: [...new Set([
      ...(record.tags || []), ...(record.relatedTopicIds || []),
      ...(record.sourceMapTopicIds || []), ...(record.retrievalHints || [])
    ])],
    sourceText: record.sourceText
  };
}

const GENERIC_SUPPORT_WORDS = new Set([
  'about', 'account', 'accounts', 'applicable', 'application', 'authority', 'based', 'business', 'businesses',
  'case', 'company', 'companies', 'condition', 'conditions', 'contribution', 'contributions', 'corporate',
  'determined', 'employee', 'employees', 'employer', 'employers', 'employment', 'entity', 'entities', 'for',
  'from', 'general', 'guidance', 'how', 'income', 'individual', 'information', 'issue', 'law', 'legal', 'local',
  'must', 'official', 'organization', 'person', 'persons', 'relevant', 'requirement', 'requirements', 'rule',
  'rules', 'singapore', 'source', 'standard', 'standards', 'subject', 'support', 'tax', 'taxes', 'that', 'the',
  'their', 'this', 'treatment', 'under', 'when', 'whether', 'which', 'with', 'work', 'worker', 'workers'
]);
function normalizeEvidenceText(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalizeEvidenceWord(value) {
  if (value.endsWith('ies') && value.length > 4) return `${value.slice(0, -3)}y`;
  if (/(?:sses|shes|ches|xes|zes)$/.test(value) && value.length > 4) return value.slice(0, -2);
  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 4) return value.slice(0, -1);
  if (value.endsWith('ing') && value.length > 6) return value.slice(0, -3);
  return value;
}
function distinctiveTerms(value) {
  return [...new Set(normalizeEvidenceText(value).split(' ')
    .filter(word => word.length >= 4 && !GENERIC_SUPPORT_WORDS.has(word) && !GENERIC_SUPPORT_WORDS.has(normalizeEvidenceWord(word)))
    .map(normalizeEvidenceWord))];
}
function textSupportsPhrase(text, phrase) {
  const terms = distinctiveTerms(phrase);
  if (terms.length === 0) return false;
  const normalized = new Set(normalizeEvidenceText(text).split(' ').map(normalizeEvidenceWord));
  const matches = terms.filter(term => normalized.has(term)).length;
  return matches >= Math.min(2, Math.ceil(terms.length * 0.6));
}
function textSupportsTopic(text, topic) {
  const sourceFacingHints = topic.domainId.startsWith('IRAS_') ? [...(topic.paragraphHints || []), ...(topic.sectionHints || [])] : [];
  return [topic.title, ...(topic.aliases || []), ...topic.keywords, ...sourceFacingHints]
    .some(phrase => textSupportsPhrase(text, phrase));
}

function makeTrackingRetriever(calls) {
  return {
    async retrieveSources(query) {
      const records = await defaultSourceRetriever.retrieveSources(query);
      calls.push({
        query: query.query,
        semanticQuery: query.semanticQuery,
        domain: query.domain,
        authorities: query.authorities,
        topicIds: query.topicIds,
        requestedConcepts: query.requestedConcepts,
        recordIds: records.map(record => record.id),
        records: records.map(summarizeRecord)
      });
      return records;
    },
    getSourceById(id) { return defaultSourceRetriever.getSourceById(id); },
    findSourcesByStandardOrAct(code, section) { return defaultSourceRetriever.findSourcesByStandardOrAct(code, section); }
  };
}

function issueConcepts(query, understanding, issue, topicIds, authority) {
  const genericWords = new Set([
    'about', 'account', 'accounts', 'applicable', 'application', 'authority', 'based', 'business', 'businesses',
    'case', 'company', 'companies', 'condition', 'conditions', 'contribution', 'contributions', 'corporate',
    'determined', 'employee', 'employees', 'employer', 'employers', 'employment', 'entity', 'entities', 'for',
    'from', 'general', 'guidance', 'how', 'income', 'individual', 'information', 'issue', 'law', 'legal', 'local',
    'must', 'official', 'organization', 'person', 'persons', 'relevant', 'requirement', 'requirements', 'rule',
    'rules', 'singapore', 'source', 'standard', 'standards', 'subject', 'support', 'tax', 'taxes', 'that', 'the',
    'their', 'this', 'treatment', 'under', 'when', 'whether', 'which', 'with', 'work', 'worker', 'workers'
  ]);
  const normalize = value => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
  const normalizeWord = value => value.endsWith('ies') && value.length > 4 ? `${value.slice(0, -3)}y`
    : /(?:sses|shes|ches|xes|zes)$/.test(value) && value.length > 4 ? value.slice(0, -2)
      : value.endsWith('s') && !value.endsWith('ss') && value.length > 4 ? value.slice(0, -1)
        : value.endsWith('ing') && value.length > 6 ? value.slice(0, -3) : value;
  const distinctive = value => [...new Set(normalize(value).split(' ')
    .filter(word => word.length >= 4 && !genericWords.has(word) && !genericWords.has(normalizeWord(word)))
    .map(normalizeWord))];
  const topicSet = new Set(topicIds);
  const topiclessBelongs = concept => {
    if (authority !== 'IRAS' || issue.domain !== 'IRAS_INCOME_TAX') return false;
    if (concept.id === 'relief_claim_prioritization') return issue.population === 'INDIVIDUAL' || issue.population === 'EMPLOYEE' ||
      issue.mappedTopicIds.some(id => id.startsWith('iras-individual-'));
    const issueText = `${issue.subject} ${issue.mappedTopicIds.join(' ')}`;
    const uniqueTerms = [...new Set([...concept.terms, concept.label].flatMap(distinctive))];
    const normalizedIssue = new Set(normalize(issueText).split(' ').map(normalizeWord));
    return uniqueTerms.length > 0 && uniqueTerms.filter(term => normalizedIssue.has(term)).length >= Math.min(2, uniqueTerms.length);
  };
  return getRequestedQuestionConcepts(query, understanding).filter(concept =>
    concept.topicIds.some(topicId => topicSet.has(topicId)) || concept.topicIds.length === 0 && topiclessBelongs(concept)
  );
}

function exactIssuePlan(testCase, understanding) {
  const reconciled = reconcileQuestionUnderstanding(testCase.query, classifyQuestion(testCase.query), understanding);
  const planned = planAuthorityWorkstreams(reconciled.issuePlan);
  return { reconciled, planned };
}

async function diagnose(testCase) {
  const understanding = makeUnderstanding(testCase);
  const { reconciled, planned } = exactIssuePlan(testCase, understanding);
  const queryCalls = [];
  const retriever = makeTrackingRetriever(queryCalls);
  const workstreams = await buildAuthorityWorkstreams(testCase.query, reconciled.issuePlan, {
    localOnly: true,
    referenceDate: REFERENCE_DATE,
    questionUnderstanding: understanding,
    retriever
  });

  const expectedByAuthority = testCase.expectedTopicsByAuthority || { IRAS: testCase.expectedTopics };
  const issueTraces = [];
  for (const workstream of workstreams.workstreams) {
    for (const issueResult of workstream.issues) {
      const issue = reconciled.issuePlan.issues.find(row => row.id === issueResult.issueId);
      const topicIds = issue.mappedTopicIds.filter(topicId => {
        const topic = getCoverageTopicsByIds([topicId])[0];
        return Boolean(topic && topic.authorities.includes(workstream.authority));
      });
      const topics = getCoverageTopicsByIds(topicIds);
      const concepts = issueConcepts(testCase.query, understanding, issue, topicIds, workstream.authority);
      let rendererTrace;

      if (workstream.authority === 'IRAS' && issueResult.lifecycle.retrievalAttempted && topicIds.length > 0) {
        const scope = {
          authority: 'IRAS', domain: workstream.domain, topicIds, requestedConcepts: concepts,
          context: {
            domainId: topics[0].domainId, population: issue.population, primarySubject: issue.subject,
            concepts: [issue.subject], requestedOperation: issue.operation
          }
        };
        const context = await buildGroundedReasoningContext(testCase.query, null, retriever, undefined, {
          localOnly: true, referenceDate: REFERENCE_DATE, questionUnderstanding: understanding, evidenceScope: scope
        });
        const rendered = renderIrasEvidenceResponse({}, context, testCase.query, null, 'SFRS_I', 'LOCAL');
        const quality = context.evidenceQuality;
        const accepted = rendered.claimVerification.accepted;
        const literal = verifyEvidenceClaims(accepted.map(claim => ({
          kind: 'RULE', text: claim.text, quote: claim.quote, recordId: claim.recordId,
          ...(claim.canonicalUrl ? { citationUrl: claim.canonicalUrl } : {})
        })), quality.eligibleRecords, { missingFacts: [], targetDate: quality.targetDate });
        rendererTrace = {
          qualityEligibleIds: quality.eligibleRecords.map(record => record.id),
          qualityRejected: quality.rejectedRecords,
          rendererAnswerPath: rendered.answerPath,
          rendererAcceptedClaims: accepted.map(claim => ({
            recordId: claim.recordId, text: claim.text, quote: claim.quote, canonicalUrl: claim.canonicalUrl
          })),
          secondLiteralVerification: {
            accepted: literal.accepted.map(claim => ({ recordId: claim.recordId, quote: claim.quote })),
            rejected: literal.rejected.map(item => ({ recordId: item.recordId, reasons: item.reasons }))
          },
          issueSpecificQuality: {
          candidateIdsFromRetriever: [...new Set(queryCalls.filter(call => call.authorities?.includes('IRAS') &&
            (call.topicIds || []).some(topicId => topicIds.includes(topicId))).flatMap(call => call.recordIds))],
          eligibleIds: quality.eligibleRecords.map(record => record.id),
            coveredTopicIds: quality.coveredTopicIds,
            uncoveredTopicIds: quality.uncoveredTopicIds,
            uncoveredConcepts: quality.uncoveredConcepts
          }
        };
      }

      const postfilterTrace = (rendererTrace?.secondLiteralVerification.accepted || []).map(claim => {
        const record = UNIFIED_SOURCE_REGISTRY[claim.recordId];
        const topicResults = topics.map(topic => {
          const associatedTopicIds = [...new Set([...issue.mappedTopicIds, topic.id, ...concepts.flatMap(concept => concept.topicIds)])];
          const ruleSupport = supportGeneralIrasRuleConcept({
            sourceText: claim.quote, domainId: topic.domainId, topicIds: associatedTopicIds,
            subject: issue.subject, population: issue.population, concepts
          });
          return {
            topicId: topic.id,
            topicBoundToRecord: Boolean(record && ([...(record.tags || []), ...(record.relatedTopicIds || []),
              ...(record.sourceMapTopicIds || []), ...(record.retrievalHints || [])].includes(topic.id) || topic.sourceRecordIds.includes(claim.recordId))),
            ruleSupport,
            supportsIssueSubject: ruleSupport !== undefined ? ruleSupport : textSupportsPhrase(claim.quote, issue.subject),
            textSupportsTopic: textSupportsTopic(claim.quote, topic)
          };
        });
        const conceptResults = concepts.map(concept => {
          const ruleSupport = supportGeneralIrasRuleConcept({
            sourceText: claim.quote, domainId: topics[0]?.domainId || '',
            topicIds: [...new Set([...issue.mappedTopicIds, ...concepts.flatMap(item => item.topicIds)])],
            subject: issue.subject, population: issue.population, concepts: [concept]
          });
          return {
            id: concept.id, label: concept.label, ruleSupport,
            supportsConcept: ruleSupport !== undefined ? ruleSupport : issue.domain === 'IRAS_INCOME_TAX'
              ? matchesRequestedQuestionConcept(claim.quote, concept)
              : [concept.label, ...concept.terms].some(term => textSupportsPhrase(claim.quote, term)) && textSupportsPhrase(claim.quote, issue.subject)
          };
        });
        return {
          recordId: claim.recordId,
          quote: claim.quote,
          topicResults,
          conceptResults,
          finalTopicOrConceptSupport: topicResults.some(result => result.topicBoundToRecord && result.textSupportsTopic && result.supportsIssueSubject) ||
            conceptResults.some(result => result.supportsConcept),
          finalVerifiedClaimIds: issueResult.verifiedClaims.map(item => item.recordId),
          finalIssueLifecycle: issueResult.lifecycle,
          finalGaps: issueResult.gaps.map(gap => ({ stage: gap.stage, code: gap.code, reason: gap.reason }))
        };
      });

      const cpfCandidateRecords = workstream.authority === 'CPF'
        ? queryCalls.flatMap(call => call.records).filter(record => workstream.authority === record.authority)
        : [];
      issueTraces.push({
        issueId: issueResult.issueId,
        subject: issueResult.subject,
        authority: workstream.authority,
        domain: workstream.domain,
        topicIds,
        requestedConcepts: concepts,
        finalLifecycle: issueResult.lifecycle,
        finalEvidenceStatus: issueResult.evidenceStatus,
        finalCandidateCount: workstream.authority === 'IRAS'
          ? rendererTrace?.issueSpecificQuality.candidateIdsFromRetriever.length || 0
          : new Set(queryCalls.filter(call => call.authorities?.includes(workstream.authority) &&
            (call.topicIds || []).some(topicId => topicIds.includes(topicId))).flatMap(call => call.recordIds)).size,
        finalAdmittedRecordIds: issueResult.sources.map(source => source.id),
        finalVerifiedClaims: issueResult.verifiedClaims.map(claim => ({ recordId: claim.recordId, quote: claim.quote })),
        finalGaps: issueResult.gaps.map(gap => ({ stage: gap.stage, code: gap.code, reason: gap.reason })),
        rendererTrace,
        postfilterTrace,
        localCandidateRejections: cpfCandidateRecords.map(record => {
          const local = UNIFIED_SOURCE_REGISTRY[record.id];
          return {
            id: record.id, sourceStatus: record.sourceStatus, verificationMethod: record.verificationMethod,
            sourceType: record.sourceType, evidenceTier: record.evidenceTier,
            lifecycleState: record.lifecycleState, provenance: record.provenance,
            lastVerifiedDate: record.lastVerifiedDate, reviewAuditCycleDays: record.reviewAuditCycleDays,
            sourceText: record.sourceText,
            eligibilityRejection: findRecordEligibilityRejection(local, undefined, REFERENCE_DATE)
          };
        })
      });
    }
  }

  const plannedTopics = reconciled.issuePlan.issues.map(issue => ({
    subject: issue.subject, authority: issue.governingAuthorities[0], domain: issue.domain,
    population: issue.population, operation: issue.operation, status: issue.status,
    topicIds: issue.mappedTopicIds, evidenceRequirement: issue.evidenceRequirement
  }));
  const expectedTopicIds = Object.values(expectedByAuthority).flat();
  assert.deepEqual(
    [...new Set(plannedTopics.flatMap(issue => issue.topicIds))].sort(),
    [...new Set(expectedTopicIds)].sort(),
    `${testCase.id}: reconstructed semantic plan did not reproduce known topic mapping`
  );
  return {
    caseId: testCase.id,
    query: testCase.query,
    semanticMock: {
      provenance: 'API-free V2 semantic interpretation mock; raw captured provider labels/claims are unavailable in acceptance-v3.json',
      mode: understanding.mode,
      rootDimensions: {
        domain: understanding.interpretation.domain,
        population: understanding.interpretation.population,
        authorityCandidates: understanding.interpretation.authorityCandidates,
        contextualAuthorities: understanding.interpretation.contextualAuthorities,
        requestedOperation: understanding.interpretation.requestedOperation,
        primarySubject: understanding.interpretation.primarySubject,
        explicitConcepts: understanding.interpretation.concepts
      },
      validatedByProductionValidator: true
    },
    issuePlan: {
      source: reconciled.issuePlan.source,
      coverageEstablished: reconciled.issuePlan.coverageEstablished,
      hasUnmappedResidual: reconciled.issuePlan.hasUnmappedResidual,
      issues: plannedTopics
    },
    retrievalCalls: queryCalls,
    issueTraces
  };
}

async function provePrivateEnumerativeGate() {
  const testCase = {
    id: 'private-expense-treatment-isolated-sec15',
    query: cases[0].query,
    root: {
      domain: 'IRAS_INCOME_TAX', population: 'COMPANY', authorityCandidates: ['IRAS'], contextualAuthorities: [],
      primarySubject: 'corporate income-tax treatment of private expense', requestedOperation: 'DETERMINE_TREATMENT',
      concepts: [{ concept: 'private expense', role: 'PRIMARY' }],
      factsExplicitlyProvided: ['company expense', "director's private holiday", 'expense amount']
    },
    issues: [{
      subject: 'corporate income-tax treatment of company expense for director\'s private holiday',
      population: 'COMPANY', domain: 'IRAS_INCOME_TAX', governingAuthorities: ['IRAS'], contextualAuthorities: [],
      operation: 'DETERMINE_TREATMENT', mappedTopicIds: []
    }]
  };
  const understanding = makeUnderstanding(testCase);
  const issue = {
    ...understanding.interpretation.issues[0],
    id: 'private-expense-reviewed-section15-proof',
    mappedTopicIds: ['iras-cit-deductibility', 'iras-cit-disallowed-expenses'],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
    status: 'MAPPED'
  };
  const issuePlan = {
    source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false, issues: [issue]
  };
  const reviewedRecord = UNIFIED_SOURCE_REGISTRY.ITA_SEC15_PROHIBITED_DEDUCTIONS;
  const calls = [];
  const retriever = {
    async retrieveSources(request) {
      const records = request.authorities?.includes('IRAS') &&
        (request.topicIds || []).some(topicId => issue.mappedTopicIds.includes(topicId)) ? [reviewedRecord] : [];
      calls.push({
        topicIds: request.topicIds,
        authorities: request.authorities,
        returnedIds: records.map(record => record.id)
      });
      return records;
    },
    getSourceById(id) { return defaultSourceRetriever.getSourceById(id); },
    findSourcesByStandardOrAct(code, section) { return defaultSourceRetriever.findSourcesByStandardOrAct(code, section); }
  };
  const result = await buildAuthorityWorkstreams(testCase.query, issuePlan, {
    localOnly: true, referenceDate: REFERENCE_DATE, questionUnderstanding: understanding, retriever
  });
  const issueResult = result.workstreams.flatMap(workstream => workstream.issues)
    .find(item => item.issueId === issue.id);
  assert.ok(issueResult, 'isolated private issue must reach default IRAS provider');

  const topics = getCoverageTopicsByIds(issue.mappedTopicIds);
  const concepts = issueConcepts(testCase.query, understanding, issue, issue.mappedTopicIds, 'IRAS');
  const scope = {
    authority: 'IRAS', domain: 'IRAS_CORPORATE_TAX', topicIds: issue.mappedTopicIds,
    requestedConcepts: concepts,
    context: {
      domainId: 'IRAS_CORPORATE_TAX', population: issue.population, primarySubject: issue.subject,
      concepts: [issue.subject], requestedOperation: issue.operation
    }
  };
  const context = await buildGroundedReasoningContext(testCase.query, null, retriever, undefined, {
    localOnly: true, referenceDate: REFERENCE_DATE, questionUnderstanding: understanding, evidenceScope: scope
  });
  const rendered = renderIrasEvidenceResponse({}, context, testCase.query, null, 'SFRS_I', 'LOCAL');
  const accepted = rendered.claimVerification.accepted;
  const literal = verifyEvidenceClaims(accepted.map(claim => ({
    kind: 'RULE', text: claim.text, quote: claim.quote, recordId: claim.recordId,
    ...(claim.canonicalUrl ? { citationUrl: claim.canonicalUrl } : {})
  })), context.evidenceQuality.eligibleRecords, {
    missingFacts: [], targetDate: context.evidenceQuality.targetDate
  });
  const exactQuote = reviewedRecord.sourceText;
  const ruleSupport = supportGeneralIrasRuleConcept({
    sourceText: exactQuote,
    domainId: 'IRAS_CORPORATE_TAX',
    topicIds: issue.mappedTopicIds,
    subject: issue.subject,
    population: issue.population,
    concepts
  });
  return {
    purpose: 'Isolate the literal reviewed Section 15 record that frozen aggregate counters cannot identify; preserve the captured expected issue subject and both expected IRAS topic IDs.',
    query: testCase.query,
    issue: {
      subject: issue.subject,
      authority: 'IRAS',
      domain: issue.domain,
      population: issue.population,
      operation: issue.operation,
      topicIds: issue.mappedTopicIds,
      requestedConcepts: concepts
    },
    source: summarizeRecord(reviewedRecord),
    localOnly: true,
    calls,
    contextEligibleIds: context.evidenceQuality.eligibleRecords.map(record => record.id),
    rendererAcceptedClaims: accepted.map(claim => ({ recordId: claim.recordId, text: claim.text, quote: claim.quote })),
    literalVerification: {
      accepted: literal.accepted.map(claim => ({ recordId: claim.recordId, quote: claim.quote })),
      rejected: literal.rejected.map(item => ({ recordId: item.recordId, reasons: item.reasons }))
    },
    finalPostfilter: {
      supportGeneralIrasRuleConcept: ruleSupport,
      supportsIssueSubject: ruleSupport === false ? false : 'not short-circuited by family matcher',
      productionDefaultWorkstreamVerifiedClaimIds: issueResult.verifiedClaims.map(claim => claim.recordId),
      lifecycle: issueResult.lifecycle,
      gaps: issueResult.gaps.map(gap => ({ stage: gap.stage, code: gap.code, reason: gap.reason }))
    }
  };
}

await mkdir(path.dirname(OUTPUT), { recursive: true });
const proof = {
  profile: 'iras-first-contract-resolution-lifecycle-proof-2026-10-04',
  runtime: process.version,
  evidenceMode: 'localOnly',
  providerCalls: 0,
  networkFetches: 0,
  source: 'Production semantic validator, issue planner, default workstream providers, GroundedReasoningContext builder, IRAS local renderer, evidence verifier, and defaultSourceRetriever over the checked-in source registry.',
  cases: []
};
for (const testCase of cases) proof.cases.push(await diagnose(testCase));
proof.isolatedPrivateSection15 = await provePrivateEnumerativeGate();
proof.startingSha = '8366db0c1b8b0307e21e7f2d732edc3eab8e26f2';
proof.capturedReferenceDate = REFERENCE_DATE;
await writeFile(OUTPUT, JSON.stringify(proof, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify({ output: OUTPUT, cases: proof.cases.map(item => ({
  caseId: item.caseId,
  issuePlan: item.issuePlan.issues.map(issue => ({ subject: issue.subject, authority: issue.authority, topics: issue.topicIds })),
  issues: item.issueTraces.map(issue => ({
    subject: issue.subject, authority: issue.authority, lifecycle: issue.finalLifecycle,
    candidates: issue.finalCandidateCount, admitted: issue.finalAdmittedRecordIds,
    verified: issue.finalVerifiedClaims.length, gaps: issue.finalGaps.map(gap => gap.code),
    localCandidateRejections: issue.localCandidateRejections.map(record => ({ id: record.id, reason: record.eligibilityRejection }))
  }))
})), isolatedPrivateSection15: {
  acceptedByRenderer: proof.isolatedPrivateSection15.rendererAcceptedClaims.length,
  literalVerified: proof.isolatedPrivateSection15.literalVerification.accepted.length,
  familySupport: proof.isolatedPrivateSection15.finalPostfilter.supportGeneralIrasRuleConcept,
  finalVerifiedClaimIds: proof.isolatedPrivateSection15.finalPostfilter.productionDefaultWorkstreamVerifiedClaimIds,
  lifecycle: proof.isolatedPrivateSection15.finalPostfilter.lifecycle,
  gaps: proof.isolatedPrivateSection15.finalPostfilter.gaps.map(gap => gap.code)
} }, null, 2));
