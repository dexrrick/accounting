import assert from 'node:assert/strict';
import { buildGroundedReasoningContext, postProcessAIResponse } from '../../src/services/groundingContextBuilder.ts';
import { isMalformedAIJsonFallback, repairAndParseAIJson } from '../../src/utils/jsonRepair.ts';

const query = 'For Singapore corporate income tax, is incorporation in Singapore alone enough to make a company tax resident? Explain the general control-and-management test using IRAS guidance. Do not calculate tax or create journal entries.';

// Reproduces the malformed taxClaims shape captured in the development live
// result: quote marks inside strings are unescaped and claim fields run together.
const malformedProviderJson = `{
  "taxClaims": [
    { "text": "The residency status of a company may change from year to year." "quote": "The residency status of a company may change from year to year.", "kind": "RULE" },
    { "text": "'Control and management' is defined as the making of decisions on strategic matters." "quote": "'Control and management' is defined as the making of decisions on strategic matters.", "kind": "RULE" }
  ]
}`;

const groundedContext = await buildGroundedReasoningContext(query, null, {
  retrieveSources: async () => [],
  getSourceById: () => undefined,
  findSourcesByStandardOrAct: () => []
}, undefined, {
  discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
  officialDomainSearchAdapter: {
    searchOfficialDomainCandidates: async () => [],
    getLastSearchTrace: () => []
  }
});

const parsedMalformed = repairAndParseAIJson(malformedProviderJson);
assert.match(parsedMalformed.messageText, /taxClaims/, 'The legacy extractor still returns malformed structured input for non-policy callers.');
const malformedResponse = postProcessAIResponse(parsedMalformed, null, query, groundedContext);
assert.doesNotMatch(malformedResponse.messageText, /taxClaims|The residency status of a company may change|Control and management/i,
  'Malformed provider text and salvaged tax claims must not leak into the IRAS response.');
assert.ok(!malformedResponse.claimVerification.accepted.some(claim =>
  /The residency status of a company may change|Control and management/i.test(claim.text)),
  'Malformed provider claims must not be accepted as evidence.');

const prefixedTruncatedProviderJson = `Provider output follows:\n{"taxClaims":[{"text":"UNSAFE IRAS PROVIDER TEXT MUST NOT LEAK","quote":"UNSAFE IRAS PROVIDER TEXT MUST NOT LEAK","kind":"RULE"}`;
const parsedPrefixedTruncated = repairAndParseAIJson(prefixedTruncatedProviderJson);
assert.equal(isMalformedAIJsonFallback(parsedPrefixedTruncated), true,
  'prefixed, truncated schema JSON is identified as an unsafe structured fallback');
const prefixedTruncatedResponse = postProcessAIResponse(parsedPrefixedTruncated, null, query, groundedContext);
assert.doesNotMatch(prefixedTruncatedResponse.messageText, /UNSAFE IRAS PROVIDER TEXT MUST NOT LEAK|taxClaims/i,
  'raw content from prefixed, truncated provider JSON is never rendered into an IRAS response');

const prefixedTruncatedLeadingStatusJson = `Provider output follows:\n{"status":"partial","metadata":{"authority":"IRAS"},"taxClaims":[{"text":"UNSAFE LEADING-STATUS IRAS TEXT MUST NOT LEAK"}`;
const parsedLeadingStatusJson = repairAndParseAIJson(prefixedTruncatedLeadingStatusJson);
assert.equal(isMalformedAIJsonFallback(parsedLeadingStatusJson), true,
  'truncated JSON-like objects are marked even when the first key is provider metadata');
const leadingStatusResponse = postProcessAIResponse(parsedLeadingStatusJson, null, query, groundedContext);
assert.doesNotMatch(leadingStatusResponse.messageText, /UNSAFE LEADING-STATUS IRAS TEXT MUST NOT LEAK|taxClaims/i,
  'provider content stays out of the response when malformed JSON starts with a non-schema key');

const validJson = repairAndParseAIJson(JSON.stringify({ messageText: 'Safe structured answer.', taxClaims: [] }));
assert.equal(validJson.messageText, 'Safe structured answer.', 'Valid JSON keeps its existing message text behavior.');

const ordinaryProse = repairAndParseAIJson('Safe prose answer without a JSON object.');
assert.equal(ordinaryProse.messageText, 'Safe prose answer without a JSON object.',
  'The legacy plain-prose fallback remains available.');

console.log('Malformed IRAS provider output regression passed.');
