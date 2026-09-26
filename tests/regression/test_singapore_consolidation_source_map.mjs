import assert from 'node:assert/strict';
import { SINGAPORE_COVERAGE_REGISTRY, getCoverageTopicById } from '../../src/standards/coverageRegistry.ts';
import { buildUnifiedSourceRegistry, UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { answerConsolidationKnowledgeQuery } from '../../src/services/consolidationKnowledgeService.ts';
import { processAccountingQuery, renderStructuredOfflineResponse } from '../../src/services/geminiService.ts';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { isStatutoryInquiry } from '../../src/engine/scenarioParser.ts';

const allowedUrls = new Set([
  'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-10-consolidated-financial-statements/',
  'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-3-business-combinations/',
  'https://www.ifrs.org/issued-standards/list-of-standards/ias-28-investments-in-associates-and-joint-ventures/',
  'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-11-joint-arrangements/',
  'https://www.acra.gov.sg/regulations/accounting-standards-financial-reporting-surveillance/accounting-standards/'
]);

const standardTopicIds = [
  'sfrsi10-control', 'sfrsi10-power', 'sfrsi10-variable-returns', 'sfrsi10-ability-to-affect-returns',
  'sfrsi10-de-facto-control', 'sfrsi10-potential-voting-rights', 'sfrsi10-acquisition-control-date',
  'sfrsi10-consolidation', 'sfrsi10-nci', 'sfrsi10-ownership-changes', 'sfrsi10-loss-of-control',
  'sfrsi10-intragroup-eliminations',
  'sfrsi3-business-combination', 'sfrsi3-acquisition-method', 'sfrsi3-acquirer', 'sfrsi3-acquisition-date',
  'sfrsi3-consideration', 'sfrsi3-identifiable-net-assets', 'sfrsi3-nci', 'sfrsi3-goodwill',
  'sfrsi3-bargain-purchase', 'sfrsi3-acquisition-costs', 'sfrsi3-contingent-consideration',
  'sfrsi3-step-acquisition', 'sfrsi3-measurement-period',
  'sfrsi128-significant-influence', 'sfrsi128-20-percent-presumption', 'sfrsi128-equity-method',
  'sfrsi128-share-of-profit-oci', 'sfrsi128-distributions', 'sfrsi128-losses', 'sfrsi128-impairment',
  'sfrsi128-disposal', 'sfrsi128-cessation-influence', 'sfrsi128-to-subsidiary',
  'sfrsi11-joint-control', 'sfrsi11-unanimous-consent', 'sfrsi11-joint-operation', 'sfrsi11-joint-venture',
  'sfrsi11-rights-to-assets', 'sfrsi11-obligations-for-liabilities', 'sfrsi11-rights-to-net-assets',
  'sfrsi11-accounting-treatment'
];
const crossStandardIds = [
  'sfrsi-associate-to-subsidiary', 'sfrsi-step-acquisition', 'sfrsi-loss-of-control',
  'sfrsi-goodwill-bargain-purchase', 'sfrsi-joint-arrangement-classification'
];

for (const id of [...standardTopicIds, ...crossStandardIds]) {
  const topic = getCoverageTopicById(id);
  assert.ok(topic, `source-map topic ${id} exists`);
  assert.equal(topic.status, 'PARTIAL', `${id} is routed but not treated as a validated full-standard pack`);
  assert.equal(topic.lifecycleState, 'ACTIVE', `${id} can route to its manually checked URL`);
  assert.equal(topic.lastVerifiedDate, '2026-09-25');
  assert.ok(topic.canonicalSourceId && topic.sourceRecordIds.includes(topic.canonicalSourceId), `${id} has a canonical source ID`);
  assert.ok(allowedUrls.has(topic.canonicalSourceUrl), `${id} uses an allowlisted, supervisor-verified URL`);
  assert.equal(topic.paragraphHints?.length, 0, `${id} does not invent paragraph hints`);
  assert.ok(topic.sectionHints?.length, `${id} has retrieval hints`);
}

assert.equal(new Set(SINGAPORE_COVERAGE_REGISTRY.map(topic => topic.id)).size, SINGAPORE_COVERAGE_REGISTRY.length,
  'Source-map additions keep topic IDs unique.');

for (const id of ['SFRSI10_SOURCE_MAP', 'SFRSI3_SOURCE_MAP', 'SFRSI128_SOURCE_MAP', 'SFRSI11_SOURCE_MAP', 'SFRSI_FRAMEWORK_ACRA']) {
  const record = UNIFIED_SOURCE_REGISTRY[id];
  assert.ok(record, `${id} is in the unified source registry`);
  assert.equal(record.recordRole, 'SOURCE_MAP_POINTER');
  assert.equal(record.groundingEligible, false, 'A source-map pointer is never grounding evidence');
  assert.equal(record.sourceStatus, 'NEEDS_REVIEW', 'URL verification does not validate standard content');
  assert.equal(record.urlVerificationStatus, 'VERIFIED', 'URL identity verification is explicit');
  assert.equal(record.urlVerifiedDate, '2026-09-25');
  assert.equal(record.sourceText, '', 'Pointers contain no implied official text');
  assert.equal(record.extractionStatus, 'PARTIAL');
  assert.equal(record.lifecycleState, 'ACTIVE', 'An existing mapped URL may route retrieval');
  assert.ok(allowedUrls.has(record.officialSourceUrl));
  assert.ok(record.sourceMapTopicIds?.length);
}

const withoutCanonicalUrl = UNIFIED_SOURCE_REGISTRY.IAS1_EXPENSE_RECOGNITION;
assert.equal(withoutCanonicalUrl.officialSourceUrl, '', 'A standards record without a verified URL remains uncited');
assert.equal(withoutCanonicalUrl.canonicalSourceUrl, undefined, 'No fallback official URL is synthesized');

const controlQuestion = 'Our fund owns 48% of an investee. Other shareholders are dispersed, but voting rights are disputed and a shareholder agreement gives another party veto rights. Do we control it under SFRS(I) 10?';
const controlAnswer = answerConsolidationKnowledgeQuery(controlQuestion, 'SFRS_I');
assert.ok(controlAnswer, 'A control question enters the reviewed missing-facts path');
assert.equal(controlAnswer.scenarioState.isComplete, false);
assert.ok(controlAnswer.scenarioState.missingFacts?.includes('Rights over relevant activities'));
assert.match(controlAnswer.messageText, /not enough.*conclude|not enough for this answer path to conclude/i,
  'A 48% holding and contradictory rights must not force a control conclusion');
const controlLinks = [...controlAnswer.messageText.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(match => match[1]);
assert.ok(controlLinks.length > 0);
for (const url of controlLinks) assert.ok(allowedUrls.has(url), 'Local citation comes from a stored verified pointer URL');

const powerHeldByAnotherParty = answerConsolidationKnowledgeQuery(
  'We own 48% of the investee. Another shareholder has the rights to direct relevant activities. We are exposed to variable returns and can use rights to affect returns. A shareholder agreement sets the terms. Do we control it?',
  'SFRS_I'
);
assert.ok(powerHeldByAnotherParty);
assert.equal(powerHeldByAnotherParty.scenarioState.isComplete, false,
  'Rights attributed to another shareholder cannot establish the investor’s power.');
assert.doesNotMatch(powerHeldByAnotherParty.messageText, /they support a qualified conclusion that the investor controls/i);

const protectiveRightsOnly = answerConsolidationKnowledgeQuery(
  'We have decision-making rights over relevant activities, but those rights are protective only and do not give us power to direct those activities. We are exposed to variable returns and claim we can affect returns. No other party has rights. Do we control the investee?',
  'SFRS_I'
);
assert.ok(protectiveRightsOnly);
assert.equal(protectiveRightsOnly.scenarioState.isComplete, false,
  'Protective-only rights and a claim of returns influence do not establish substantive power.');
assert.ok(protectiveRightsOnly.scenarioState.missingFacts?.includes('Rights over relevant activities'));
assert.ok(protectiveRightsOnly.scenarioState.missingFacts?.includes('Ability to use rights to affect returns'));
assert.doesNotMatch(protectiveRightsOnly.messageText, /they support a qualified conclusion that the investor controls/i);

const agreementWithoutTerms = answerConsolidationKnowledgeQuery(
  'We own 60%. We have substantive rights to direct relevant activities, are exposed to variable returns, and can use those rights to affect returns. A shareholder agreement governs the relationship, but its terms are not provided. Do we control?',
  'SFRS_I'
);
assert.ok(agreementWithoutTerms);
assert.equal(agreementWithoutTerms.scenarioState.isComplete, false,
  'A bare reference to a shareholder agreement does not establish what rights it grants.');
assert.ok(agreementWithoutTerms.scenarioState.missingFacts?.includes('Other parties’ rights and arrangement terms'));

const associateTransition = answerConsolidationKnowledgeQuery(
  'An associate became a subsidiary in October. How should the step acquisition be handled and what is goodwill?',
  'SFRS_I'
);
assert.ok(associateTransition);
assert.ok(associateTransition.messageText.includes('SFRS(I) 1-28'));
assert.ok(associateTransition.messageText.includes('SFRS(I) 3'));
assert.ok(associateTransition.messageText.includes('SFRS(I) 10'));
assert.ok(associateTransition.scenarioState.missingFacts?.includes('Date control was obtained'));
assert.doesNotMatch(associateTransition.messageText, /goodwill\s*(?:is|of)\s*(?:SGD|\$|\d)/i,
  'The local advisory does not manufacture a goodwill amount.');
assert.equal(answerConsolidationKnowledgeQuery(
  'On 1 October 2025 we acquired a business from unrelated parties within SFRS(I) 3 scope. Consideration transferred SGD 1,000,000 including a contingent amount. NCI is measured at fair value SGD 200,000. Fair value of identifiable net assets is SGD 900,000. No previously held interest. Calculate goodwill.',
  'SFRS_I'
), undefined, 'A full-input goodwill calculation must fall through when the local rule has no validated measurement engine.');

const inverseOrderTransitionMissingFacts = answerConsolidationKnowledgeQuery(
  'We held 30% of an investee and applied the equity method. On 1 October 2025 we acquired another 35% and obtained control. The acquired set is a business. We do not know whether this was a common-control or unrelated-party transaction. The fair value of the previously held interest is not provided; the consideration and fair value of identifiable net assets are unknown. How should we account?',
  'SFRS_I'
);
assert.ok(inverseOrderTransitionMissingFacts);
assert.equal(inverseOrderTransitionMissingFacts.sourceMapFallbackTrace.localRuleId, 'associate-to-subsidiary');
for (const missingFact of [
  'Whether the acquired set is a business and the transaction is within SFRS(I) 3 scope',
  'Previously held interest and carrying amount',
  'Consideration and acquisition-date identifiable assets and liabilities'
]) {
  assert.ok(inverseOrderTransitionMissingFacts.scenarioState.missingFacts?.includes(missingFact),
    `Transition fact remains missing when the query says it is unknown or not provided: ${missingFact}`);
}

const interrogativeTransitionEligibility = answerConsolidationKnowledgeQuery(
  'We held 30% of an investee and applied the equity method. We acquired another 35% and obtained control. Is the acquired set a business? Does the transaction fall within SFRS(I) 3 scope? How should we account?',
  'SFRS_I'
);
assert.ok(interrogativeTransitionEligibility);
assert.ok(interrogativeTransitionEligibility.scenarioState.missingFacts?.includes('Whether the acquired set is a business and the transaction is within SFRS(I) 3 scope'),
  'Interrogative business-nature and scope wording remains unresolved for an associate-to-subsidiary transition.');

assert.equal(answerConsolidationKnowledgeQuery('Classify our contractual joint arrangement as a joint operation or joint venture.', 'SFRS_I'), undefined,
  'Detailed joint-operation classification falls through to verified source retrieval.');
const jointTopicIds = classifyQuestion('Classify our contractual joint arrangement as a joint operation or joint venture.').topicIds;
assert.ok(jointTopicIds.includes('sfrsi11-joint-operation') && jointTopicIds.includes('sfrsi11-joint-venture'),
  'The joint-arrangement source map routes both alternatives for the unsupported local detail.');
assert.equal(answerConsolidationKnowledgeQuery('Under SFRS(I) 10, prepare a consolidation journal entry.', 'SFRS_I'), undefined,
  'The local advisory does not intercept journals.');
assert.equal(answerConsolidationKnowledgeQuery('Under SFRS(I) 9, classify a bond held solely to collect with SPPI cash flows.', 'SFRS_I'), undefined,
  'The consolidation pack cannot preempt the validated SFRS(I) 9 local knowledge pack.');
assert.equal(answerConsolidationKnowledgeQuery('How do I file an IRAS GST return?', 'SFRS_I'), undefined,
  'Unrelated topics do not get an invented accounting source URL.');

const percentageOnlyInfluence = answerConsolidationKnowledgeQuery(
  'We own 25% of the shares in an investee. Do we have significant influence?',
  'SFRS_I'
);
assert.ok(percentageOnlyInfluence);
assert.ok(percentageOnlyInfluence.scenarioState.missingFacts?.includes('Voting rights and other interests'),
  'An ownership percentage is not silently treated as voting power.');
assert.ok(percentageOnlyInfluence.scenarioState.missingFacts?.includes('Evidence of participation in policy decisions'));

const differentOwnershipAndVotingPower = answerConsolidationKnowledgeQuery(
  'We hold 30% of shares but only 10% voting rights, have a board seat and participate in policy decisions, with no contrary evidence. Does significant influence exist?',
  'SFRS_I'
);
assert.ok(differentOwnershipAndVotingPower);
assert.doesNotMatch(differentOwnershipAndVotingPower.messageText, /30% voting power/i,
  'Share ownership must not be restated as voting power.');
assert.match(differentOwnershipAndVotingPower.messageText, /below 20% does not by itself preclude significant influence/i);

const rebuttedInfluence = answerConsolidationKnowledgeQuery(
  'We hold 25% voting power, but have no board representation and do not participate in policy decisions. It is clearly demonstrated that we cannot participate. Is significant influence established?',
  'SFRS_I'
);
assert.ok(rebuttedInfluence);
assert.equal(rebuttedInfluence.scenarioState.isComplete, false,
  'Negated participation must not count as affirmative evidence of influence.');
assert.doesNotMatch(rebuttedInfluence.messageText, /On the stated facts, significant influence is indicated/i);

const belowTwenty = answerConsolidationKnowledgeQuery(
  'We hold 18% voting power, have a board seat and participate in policy decisions, with no contrary evidence. Does significant influence exist?',
  'SFRS_I'
);
assert.ok(belowTwenty);
assert.equal(belowTwenty.scenarioState.isComplete, true, 'Provided voting and influence facts are not redundantly requested.');
assert.match(belowTwenty.messageText, /below 20% does not by itself preclude significant influence/i);

const retainedControlDisposal = answerConsolidationKnowledgeQuery(
  'Our holding decreased from 80% to 65%, and control is retained. Does the investee remain in the consolidation relationship?',
  'SFRS_I'
);
assert.ok(retainedControlDisposal);
assert.equal(retainedControlDisposal.scenarioState.isComplete, true, 'Explicit retained control is not requested again.');
assert.match(retainedControlDisposal.messageText, /remains within the consolidation relationship/i);
assert.equal(answerConsolidationKnowledgeQuery(
  'Our group sells 15 percentage points, retaining 65% and control. Is a gain or loss recognised in profit or loss?',
  'SFRS_I'
), undefined, 'Accounting effects beyond the local rule must use mapped official retrieval.');

const equityAccountedStep = 'We held 30%, equity-accounted; acquired another 35% and obtained control. What standards apply?';
const stepRoute = answerConsolidationKnowledgeQuery(equityAccountedStep, 'SFRS_I');
assert.ok(stepRoute, 'An equity-accounted holding that obtains control routes across standards without literal associate wording.');
assert.equal(stepRoute.sourceMapFallbackTrace.localRuleId, 'associate-to-subsidiary');
assert.deepEqual(stepRoute.sourceMapFallbackTrace.sourceMapIds.sort(), ['SFRSI10_SOURCE_MAP', 'SFRSI128_SOURCE_MAP', 'SFRSI3_SOURCE_MAP'],
  'A positive equity-accounted acquisition that obtains control uses all relevant standard overview pointers.');
assert.ok(stepRoute.messageText.includes('SFRS(I) 1-28'));
assert.ok(stepRoute.messageText.includes('SFRS(I) 3'));
assert.ok(stepRoute.messageText.includes('SFRS(I) 10'));
assert.ok(classifyQuestion(equityAccountedStep).topicIds.includes('sfrsi-associate-to-subsidiary'),
  'Question classification recognizes the cross-standard equity-accounted transition.');
const formerAssociateStepAcquisition = 'An equity-accounted associate acquired additional shares and obtained control in a step acquisition. What standards apply?';
const formerAssociateStepRoute = answerConsolidationKnowledgeQuery(formerAssociateStepAcquisition, 'SFRS_I');
assert.equal(formerAssociateStepRoute?.sourceMapFallbackTrace.localRuleId, 'step-acquisition');
assert.deepEqual(formerAssociateStepRoute?.sourceMapFallbackTrace.sourceMapIds.sort(), ['SFRSI10_SOURCE_MAP', 'SFRSI128_SOURCE_MAP', 'SFRSI3_SOURCE_MAP'],
  'An explicit step acquisition involving a former equity-accounted associate includes the IAS 28 source-map pointer.');
const stepWithoutFormerAssociate = answerConsolidationKnowledgeQuery(
  'This is a step acquisition: we acquired a business and obtained control, but we do not hold an associate or equity-accounted interest. What standards apply?',
  'SFRS_I'
);
assert.ok(stepWithoutFormerAssociate);
assert.deepEqual(stepWithoutFormerAssociate.sourceMapFallbackTrace.sourceMapIds.sort(), ['SFRSI10_SOURCE_MAP', 'SFRSI3_SOURCE_MAP'],
  'A negated former associate/equity-method relationship does not add IAS 28 to generic step-acquisition routing.');

const appliedEquityMethodAcquisition = 'We held 30% of an investee and applied the equity method. On 1 October we acquired another 35% and obtained control. The investee meets the definition of a business. How should we account for the investment from that date and at year end?';
const appliedEquityRoute = answerConsolidationKnowledgeQuery(appliedEquityMethodAcquisition, 'SFRS_I');
assert.equal(appliedEquityRoute?.sourceMapFallbackTrace.localRuleId, 'associate-to-subsidiary',
  'Applied-equity-method wording plus additional shares and obtained control selects the transition rule before generic control.');
assert.deepEqual(appliedEquityRoute?.sourceMapFallbackTrace.sourceMapIds.sort(), ['SFRSI10_SOURCE_MAP', 'SFRSI128_SOURCE_MAP', 'SFRSI3_SOURCE_MAP']);
assert.ok(appliedEquityRoute?.scenarioState.missingFacts?.length,
  'The local transition rule identifies missing measurement facts rather than asserting a full accounting result.');

const aboveTwentyWithoutInfluence = 'We own 25% of an investee, but have no board representation, do not participate in policy decisions, have no material transactions or management interchange, and cannot obtain the information needed to influence it. Is the 20% threshold conclusive?';
const influenceRoute = answerConsolidationKnowledgeQuery(aboveTwentyWithoutInfluence, 'SFRS_I');
assert.equal(influenceRoute?.sourceMapFallbackTrace.localRuleId, 'significant-influence',
  'A 25% question about the 20% influence presumption does not fall into generic control.');
assert.deepEqual(influenceRoute?.sourceMapFallbackTrace.sourceMapIds, ['SFRSI128_SOURCE_MAP']);
assert.ok(influenceRoute?.scenarioState.missingFacts?.length,
  'Missing voting-right and influence evidence prevents a forced significant-influence conclusion.');

const goodwillMissingFacts = 'We acquired control of a business. How much goodwill should we recognise? We have not provided the consideration transferred, fair value of any previously held interest, acquisition-date identifiable net assets, or how non-controlling interests are measured.';
const goodwillRoute = answerConsolidationKnowledgeQuery(goodwillMissingFacts, 'SFRS_I');
assert.equal(goodwillRoute?.sourceMapFallbackTrace.localRuleId, 'goodwill',
  'Mentioning a previously held interest as a missing input does not turn a goodwill query into a step acquisition.');
assert.deepEqual(goodwillRoute?.sourceMapFallbackTrace.sourceMapIds, ['SFRSI3_SOURCE_MAP']);
assert.ok(classifyQuestion(goodwillMissingFacts).topicIds.includes('sfrsi3-step-acquisition'),
  'A missing previously-held-interest fact can route to the relevant IFRS 3 topic without asserting a step acquisition occurred.');
assert.ok(goodwillRoute?.scenarioState.missingFacts?.length);
assert.ok(goodwillRoute?.scenarioState.missingFacts?.includes('Whether the transaction is within SFRS(I) 3 scope, including common-control status'));
assert.ok(goodwillRoute?.scenarioState.missingFacts?.includes('Any previously held interest'));
assert.ok(goodwillRoute?.scenarioState.missingFacts?.includes('Acquisition-date identifiable assets and liabilities'));
assert.ok(goodwillRoute?.scenarioState.missingFacts?.includes('Non-controlling interest and measurement basis'));
assert.doesNotMatch(goodwillRoute?.messageText || '', /goodwill\s*(?:is|of)\s*(?:SGD|\$|\d)/i);

const questionedGoodwillEligibility = answerConsolidationKnowledgeQuery(
  'We do not know whether the acquired set is a business. Does the transaction fall within SFRS(I) 3 scope? How much goodwill should we recognise?',
  'SFRS_I'
);
assert.ok(questionedGoodwillEligibility);
assert.ok(questionedGoodwillEligibility.scenarioState.missingFacts?.includes('Whether the acquired set is a business'));
assert.ok(questionedGoodwillEligibility.scenarioState.missingFacts?.includes('Whether the transaction is within SFRS(I) 3 scope, including common-control status'),
  'Uncertain business nature and interrogative scope wording remain unresolved goodwill facts.');

const inverseOrderGoodwillMissingFacts = answerConsolidationKnowledgeQuery(
  'We acquired control of a business on 1 October 2025. Consideration transferred was SGD 1,000,000. Fair value of identifiable net assets is not provided. NCI measurement basis is unknown. It is unknown whether the transaction is within SFRS(I) 3 scope. The fair value of any previously held interest is not provided. How much goodwill should we recognise?',
  'SFRS_I'
);
assert.ok(inverseOrderGoodwillMissingFacts);
for (const missingFact of [
  'Acquisition-date identifiable assets and liabilities',
  'Non-controlling interest and measurement basis',
  'Whether the transaction is within SFRS(I) 3 scope, including common-control status',
  'Any previously held interest'
]) {
  assert.ok(inverseOrderGoodwillMissingFacts.scenarioState.missingFacts?.includes(missingFact),
    `A fact followed by an omission cue must remain missing: ${missingFact}`);
}

const uncertainRelatedPartyScope = answerConsolidationKnowledgeQuery(
  'We acquired control of a business on 1 October 2025. Consideration transferred was SGD 1,000,000. NCI was measured at fair value. Identifiable net assets were measured at fair value. We do not know whether this was a common-control or unrelated-party transaction. How much goodwill should we recognise?',
  'SFRS_I'
);
assert.ok(uncertainRelatedPartyScope);
assert.ok(uncertainRelatedPartyScope.scenarioState.missingFacts?.includes('Whether the transaction is within SFRS(I) 3 scope, including common-control status'),
  'Uncertainty about common control or unrelated parties cannot satisfy the SFRS(I) 3 scope fact.');

assert.equal(answerConsolidationKnowledgeQuery(
  'We acquired control of a business under common control on 1 January 2026. Consideration transferred was SGD 1,000,000. NCI was measured at fair value of SGD 100,000. Fair value of identifiable net assets was SGD 800,000. There was no previously held interest. How much goodwill should we recognise?',
  'SFRS_I'
), undefined, 'An explicit common-control combination must not receive the local SFRS(I) 3 goodwill route, even when acquisition inputs are stated.');

const passiveLossOfControl = answerConsolidationKnowledgeQuery(
  'We sold shares in a subsidiary and there was a loss of control, retaining 5% as a passive investment. What relationship remains?',
  'SFRS_I'
);
assert.ok(passiveLossOfControl);
assert.deepEqual(passiveLossOfControl.sourceMapFallbackTrace.sourceMapIds, ['SFRSI10_SOURCE_MAP'],
  'A small passive retained investment routes to SFRS(I) 10 unless significant influence or joint venture facts are stated.');
assert.ok(passiveLossOfControl.scenarioState.missingFacts?.includes('Rights and decision-making power after disposal'));

const lossWithSignificantInfluence = answerConsolidationKnowledgeQuery(
  'We sold our subsidiary and there was a loss of control; we still hold 30% and have board representation and participate in policy decisions. What relationship remains?',
  'SFRS_I'
);
assert.ok(lossWithSignificantInfluence);
assert.deepEqual(lossWithSignificantInfluence.sourceMapFallbackTrace.sourceMapIds.sort(), ['SFRSI10_SOURCE_MAP', 'SFRSI128_SOURCE_MAP'],
  'The IAS 28 source pointer is included when retained ownership facts indicate significant influence.');

const negatedAcquisition = 'We have a business combination and an equity method investment, but no additional shares were acquired. Which rules apply?';
const negatedTopics = classifyQuestion(negatedAcquisition).topicIds;
for (const transitionTopic of ['sfrsi3-step-acquisition', 'sfrsi128-to-subsidiary', 'sfrsi-associate-to-subsidiary']) {
  assert.ok(!negatedTopics.includes(transitionTopic), `Negated additional-share wording must not route to ${transitionTopic}.`);
}
assert.equal(answerConsolidationKnowledgeQuery(negatedAcquisition, 'SFRS_I'), undefined,
  'No affirmative acquisition-to-control event means the local step/transition answer is not selected.');

const laterPeriodNci = 'How are non-controlling interests measured after a subsidiary has already been consolidated for several years?';
const laterPeriodNciTopics = classifyQuestion(laterPeriodNci).topicIds;
assert.ok(laterPeriodNciTopics.includes('sfrsi10-nci'));
assert.ok(!laterPeriodNciTopics.includes('sfrsi3-nci'),
  'SFRS(I) 3 acquisition-date NCI routing requires acquisition context; later-period SFRS(I) 10 NCI does not.');

const acquisitionDateQuestion = 'We signed an acquisition agreement in September, obtained the required approvals and the ability to direct relevant activities on 15 November, and have a 31 December year end. From which date should the investee be consolidated, and which acquisition-date measurements are relevant?';
assert.equal(isStatutoryInquiry(acquisitionDateQuestion), false,
  'The letters “pte” inside September are not the Pte. Ltd. acronym and must not trigger statutory tax routing.');
const acquisitionDateResponse = await processAccountingQuery(acquisitionDateQuestion, null, 'SFRS_I');
assert.notEqual(acquisitionDateResponse.scenarioState.scenarioType, 'SINGAPORE_STATUTORY_ADVISORY',
  'An acquisition-date accounting question must not become an IRAS Section 14Q answer.');
assert.deepEqual(acquisitionDateResponse.sourceMapFallbackTrace?.sourceMapIds?.sort(), ['SFRSI10_SOURCE_MAP', 'SFRSI3_SOURCE_MAP'],
  'The offline acquisition-date response exposes the actual SFRS(I) 10 / SFRS(I) 3 source-map route.');

const lossOfControlRetainedInfluence = 'We own 80% of a subsidiary and sell enough shares to lose control, retaining 30% with board representation and participation in policy decisions. How should the loss of control and retained interest be accounted for?';
const lossOfControlResponse = await processAccountingQuery(lossOfControlRetainedInfluence, null, 'SFRS_I');
assert.deepEqual(lossOfControlResponse.sourceMapFallbackTrace?.sourceMapIds?.sort(), ['SFRSI10_SOURCE_MAP', 'SFRSI128_SOURCE_MAP'],
  'Loss of control with significant influence routes to SFRS(I) 10 and 1-28, without adding IFRS 3 step-acquisition material from generic word overlap.');

const fallbackTrace = {
  path: 'MAPPED_SOURCE', sourceMapIds: ['SFRSI11_SOURCE_MAP'], selectedRecordIds: [], finalVerifiedUrls: [],
  candidateOnly: false, attempts: []
};
const unrecognizedState = {
  scenarioType: 'UNRECOGNIZED', rawQuery: 'test query', transactionTitle: 'Test query',
  functionalCurrency: 'SGD', transactionCurrency: 'SGD', directGroups: [], isComplete: false
};
const renderedWithTrace = renderStructuredOfflineResponse(unrecognizedState, 'SFRS_I', null, { sourceMapFallbackTrace: fallbackTrace });
assert.strictEqual(renderedWithTrace.sourceMapFallbackTrace, fallbackTrace,
  'Offline rendering carries through the existing source-map trace without treating it as grounding evidence.');
const renderedWithoutContext = renderStructuredOfflineResponse(unrecognizedState, 'SFRS_I');
assert.equal(renderedWithoutContext.sourceMapFallbackTrace, undefined,
  'Offline rendering does not fabricate a source-map trace when no grounded context exists.');

const original = UNIFIED_SOURCE_REGISTRY.SFRSI10_SOURCE_MAP;
try {
  UNIFIED_SOURCE_REGISTRY.SFRSI10_SOURCE_MAP = { ...original, urlVerificationStatus: 'CANDIDATE' };
  assert.equal(answerConsolidationKnowledgeQuery(controlQuestion, 'SFRS_I'), undefined,
    'If a mapped URL loses verified status, local citations fail closed.');
  UNIFIED_SOURCE_REGISTRY.SFRSI10_SOURCE_MAP = { ...original, lifecycleState: 'STAGED' };
  assert.equal(answerConsolidationKnowledgeQuery(controlQuestion, 'SFRS_I'), undefined,
    'Staged source-map pointers cannot support a local citation.');
  UNIFIED_SOURCE_REGISTRY.SFRSI10_SOURCE_MAP = { ...original, lastVerifiedDate: '2020-01-01' };
  assert.equal(answerConsolidationKnowledgeQuery(controlQuestion, 'SFRS_I'), undefined,
    'An overdue source-map pointer cannot support a local citation.');
} finally {
  UNIFIED_SOURCE_REGISTRY.SFRSI10_SOURCE_MAP = original;
}

const routed = await processAccountingQuery(controlQuestion, null, 'SFRS_I');
assert.equal(routed.scenarioState.scenarioType, 'SFRSI_CONSOLIDATION_KNOWLEDGE',
  'The selective local answer path runs before generic transaction parsing.');
assert.equal(routed.scenarioState.isComplete, false);
assert.equal(routed.sourceMapFallbackTrace?.path, 'NOT_NEEDED');
assert.equal(routed.sourceMapFallbackTrace?.localRuleId, 'control');
assert.deepEqual(routed.sourceMapFallbackTrace?.sourceMapIds, ['SFRSI10_SOURCE_MAP']);
assert.equal(routed.scenarioState.directGroups?.length, 0);

const existingSfrsi9 = await processAccountingQuery(
  'Under SFRS(I) 9, a bond is held solely to collect and its contractual cash flows satisfy SPPI. How is it measured?',
  null,
  'SFRS_I'
);
assert.match(existingSfrsi9.messageText, /SFRS\(I\) 9/);
assert.notEqual(existingSfrsi9.scenarioState.scenarioType, 'SFRSI_CONSOLIDATION_KNOWLEDGE',
  'The existing SFRS(I) 9 answer path remains first.');

// Rebuild is deterministic and must keep pointers role-marked and URL scoped.
buildUnifiedSourceRegistry('2026-09-25');
assert.equal(UNIFIED_SOURCE_REGISTRY.SFRSI10_SOURCE_MAP.groundingEligible, false);
assert.ok(allowedUrls.has(UNIFIED_SOURCE_REGISTRY.SFRSI10_SOURCE_MAP.officialSourceUrl));

console.log('PASS | Singapore consolidation source map and conservative local-answer path');
