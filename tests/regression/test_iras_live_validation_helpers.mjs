import assert from 'node:assert/strict';
import {
  classifyRetrieval,
  classifyTransportFailure,
  classifyFinalAnswerPath,
  extractClarificationRequests,
  extractMarkdownCitations,
  localEvidenceWasSuppliedToAnswerCall,
  providerStatus,
  safeText
} from '../../scripts/run_iras_live_validation.mjs';
import { collectCitations, normalizeUrl } from '../../scripts/verify_iras_live_citations.mjs';

const officialUrl = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax';
assert.deepEqual(
  extractMarkdownCitations(`[IRAS conditions](${officialUrl})`),
  [officialUrl],
  'Citation extraction preserves balanced parentheses in official IRAS paths.'
);
assert.equal(safeText('provider failed: test-secret-value', 'test-secret-value'), 'provider failed: [REDACTED]');

assert.deepEqual(
  classifyRetrieval({ sourceMapFallbackTrace: { attempts: [{ fetchStatus: 'SUCCESS' }] } }, [{ httpStatus: 200, status: 'HTTP_SUCCESS' }]),
  { retrievalStatus: 'NOT_EVALUATED', retrievalTransportStatus: 'SUCCESS' },
  'An HTTP success is transport evidence only; source relevance still needs review.'
);
assert.deepEqual(
  classifyRetrieval({ sourceMapFallbackTrace: { attempts: [{ fetchStatus: 'TOPIC_MISMATCH' }] } }, [{ httpStatus: 200, status: 'HTTP_SUCCESS' }]),
  { retrievalStatus: 'BLOCKED_BY_SOURCE', retrievalTransportStatus: 'SUCCESS' },
  'A successful response with topic validation failure is not treated as retrieved evidence.'
);
assert.deepEqual(
  classifyRetrieval(null, [{ status: 'NETWORK_ERROR' }]),
  { retrievalStatus: 'BLOCKED_BY_NETWORK', retrievalTransportStatus: 'BLOCKED_BY_NETWORK' }
);

assert.equal(classifyTransportFailure({ name: 'AbortError', message: 'The operation was aborted.' }), 'TIMEOUT');
assert.equal(providerStatus([], false), 'NOT_EVALUATED');
assert.equal(providerStatus([{ stage: 'semantic-extraction-or-other', httpStatus: 200, rawCandidateText: '{"events":[]}' }], false), 'NOT_EVALUATED',
  'A successful semantic extraction without an answer-generation call is not an answer pass or provider failure.');
assert.equal(providerStatus([{ stage: 'answer-generation', httpStatus: 429 }], false), 'BLOCKED_BY_PROVIDER');
assert.equal(providerStatus([{ stage: 'answer-generation', httpStatus: 0, transportError: 'The operation was aborted.', transportFailureKind: 'TIMEOUT' }], false), 'BLOCKED_BY_PROVIDER');
assert.equal(providerStatus([{ stage: 'answer-generation', httpStatus: 0, transportError: 'network unavailable', transportFailureKind: 'NETWORK_ERROR' }], false), 'BLOCKED_BY_NETWORK');
assert.equal(providerStatus([{ stage: 'answer-generation', httpStatus: 200, rawCandidateText: '{"answer":"ok"}', rawCandidateJsonValid: true }], false, '### Offline / Income Tax Act'), 'LIVE_PASS',
  'A static Offline heading alone is not evidence that the provider failed.');
assert.equal(providerStatus([{ stage: 'answer-generation', httpStatus: 200, rawCandidateText: '{bad json', rawCandidateJsonValid: false }], false, '> **Gemini API Call Notice**: Invalid JSON'), 'LIVE_FAIL',
  'A raw candidate followed by the production provider-error fallback is not a pass.');

const localRecord = { documentTitle: 'Local GST Evidence', sourceText: 'Validated local evidence text with sufficient length for exact prompt matching.' };
assert.equal(localEvidenceWasSuppliedToAnswerCall([localRecord], [{ stage: 'semantic-extraction-or-other', request: { systemInstruction: { parts: [{ text: localRecord.sourceText }] } } }]), false,
  'Semantic extraction alone does not mean local evidence was supplied to answer generation.');
assert.equal(localEvidenceWasSuppliedToAnswerCall([localRecord], [{ stage: 'answer-generation', request: { systemInstruction: { parts: [{ text: localRecord.sourceText }] } } }]), true,
  'Local evidence is marked supplied only when it appears in the actual answer-generation request.');
assert.deepEqual(extractClarificationRequests({ scenarioState: { missingFacts: ['not an actual request'], missingFields: [] }, clarifications: [] }), [],
  'Grounding missing facts are not mislabeled as questions actually requested from the user.');
assert.equal(classifyFinalAnswerPath({ messageText: 'Need one fact.', clarifications: [{ prompt: 'Please confirm.' }] }, [], 'NOT_EVALUATED'), 'DETERMINISTIC_CLARIFICATION');

assert.equal(normalizeUrl('https://www.iras.gov.sg/path-(topic)?provision=A%2FB#part-1'), 'https://www.iras.gov.sg/path-(topic)?provision=A%2FB',
  'Citation URL identity normalizes encoded parentheses and fragments while preserving query identity.');
const citationSet = collectCitations({
  finalResponse: {
    messageText: '[page](https://www.iras.gov.sg/path-(topic)?provision=A%2FB#one)',
    scenarioState: { directGroups: [{ citations: [{ officialSourceUrl: 'https://www.iras.gov.sg/path-%28topic%29?provision=A%2FB#two' }] }] }
  }
});
assert.equal(citationSet.length, 1, 'Equivalent encoded-parenthesis citation URLs are deduplicated within a case.');
assert.deepEqual(citationSet[0].methods, ['MARKDOWN', 'STRUCTURED_CITATION']);
assert.equal(normalizeUrl('https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=pr33-#pr33-'), 'https://sso.agc.gov.sg/Act/GSTA1993?ProvIds=pr33-',
  'Distinct statutory target query parameters remain part of citation identity.');

process.stdout.write('IRAS live validation helper tests passed.\n');
