import type { AccountingScenarioState, AccountingStandard, MissingFieldInfo } from '../types/accounting';
import { getCoverageTopicById } from '../standards/coverageRegistry';
import { UNIFIED_SOURCE_REGISTRY } from '../standards/unifiedSourceModel';
import { defaultSourceFreshnessManager } from '../standards/sourceFreshnessManager';
import { hasVerifiedSourceUrlProvenance } from '../standards/approvedSourceRegistry';

export interface ConsolidationKnowledgeAnswer {
  messageText: string;
  scenarioState: AccountingScenarioState;
  clarifications?: MissingFieldInfo[];
  sourceMapFallbackTrace: {
    path: 'NOT_NEEDED';
    localRuleId: LocalTopic;
    sourceMapIds: string[];
    sourceMapRecordIds: string[];
    selectedRecordIds: string[];
    finalVerifiedUrls: string[];
    candidateOnly: false;
    attempts: [];
  };
}

type LocalTopic =
  | 'control'
  | 'significant-influence'
  | 'associate-to-subsidiary'
  | 'step-acquisition'
  | 'ownership-change'
  | 'loss-of-control'
  | 'goodwill';

interface LocalRule {
  title: string;
  standardIds: string[];
  explanation: string;
  completeExplanation?: string;
  requiredFacts: Array<{ key: string; name: string; why: string }>;
  topicId: string;
}

const LOCAL_RULES: Record<LocalTopic, LocalRule> = {
  control: {
    title: 'Control assessment',
    standardIds: ['SFRSI10_SOURCE_MAP'],
    topicId: 'sfrsi10-control',
    explanation: 'An ownership percentage by itself is not enough for this answer path to conclude whether an investor controls an investee. The assessment needs the rights over relevant activities, exposure or rights to variable returns, and the connection between those rights and the ability to affect returns. Where voting ownership is below a majority or rights are shared, the contractual and practical facts are especially important.',
    completeExplanation: 'Assuming the facts accurately establish substantive power over the relevant activities, exposure to variable returns, and the ability to use that power to affect those returns, they support a qualified conclusion that the investor controls the investee. Under SFRS(I) 10, a parent prepares consolidated financial statements, subject to the standard’s scope and any applicable exceptions. A percentage by itself does not establish control.',
    requiredFacts: [
      { key: 'decisionRights', name: 'Rights over relevant activities', why: 'Identify who can direct the activities that most affect the investee’s returns, including substantive voting, contractual, and potential voting rights.' },
      { key: 'returnsExposure', name: 'Exposure to variable returns', why: 'Describe the returns the investor is exposed to and how they vary with the investee’s performance.' },
      { key: 'linkPowerReturns', name: 'Ability to use rights to affect returns', why: 'Explain how the decision rights can affect the investor’s returns, and whether another party has decision-making authority.' },
      { key: 'otherRights', name: 'Other parties’ rights and arrangement terms', why: 'Other substantive rights, agency arrangements, or contractual terms may change who controls the investee.' }
    ]
  },
  'significant-influence': {
    title: 'Significant influence assessment',
    standardIds: ['SFRSI128_SOURCE_MAP'],
    topicId: 'sfrsi128-significant-influence',
    explanation: 'The stated ownership percentage alone does not settle whether significant influence exists. The IAS 28 overview describes a rebuttable presumption at 20% or more of voting power; evidence can rebut it. Below 20%, influence may still exist when the facts establish an ability to participate in financial and operating policy decisions.',
    completeExplanation: 'The stated facts establish the voting-power percentage and evidence relevant to participation or rebuttal. On those facts, apply the rebuttable significant-influence presumption: 20% or more of voting power presumptively indicates significant influence unless clearly rebutted; below 20% does not by itself preclude significant influence if the evidence supports it. If significant influence is established, SFRS(I) 1-28 routes the investment to the equity method, subject to applicable scope exceptions.',
    requiredFacts: [
      { key: 'votingRights', name: 'Voting rights and other interests', why: 'Give the voting rights held directly and indirectly, including substantive potential voting rights and any ownership changes during the period.' },
      { key: 'participationEvidence', name: 'Evidence of participation in policy decisions', why: 'Describe board representation, participation in policy making, material transactions, management interchange, and provision of essential technical information where relevant.' },
      { key: 'contraryEvidence', name: 'Evidence that may contradict influence', why: 'Explain any contractual restrictions or other facts that may prevent the investor from participating in policy decisions.' }
    ]
  },
  'associate-to-subsidiary': {
    title: 'Associate-to-subsidiary transition',
    standardIds: ['SFRSI128_SOURCE_MAP', 'SFRSI3_SOURCE_MAP', 'SFRSI10_SOURCE_MAP'],
    topicId: 'sfrsi-associate-to-subsidiary',
    explanation: 'This is a cross-standard event. The key unresolved question is when, if at all, control was obtained. The mapped route involves SFRS(I) 1-28 and SFRS(I) 10; SFRS(I) 3 is relevant if the acquired set is a business and the transaction is within its scope. The information supplied is not enough to determine a transition date, measurement, or gain/goodwill amount.',
    completeExplanation: 'The stated facts identify a transition from an associate relationship to control. The cross-standard route is SFRS(I) 1-28 for the former associate relationship, SFRS(I) 10 for the control and consolidation date, and SFRS(I) 3 if the acquired set is a business. This high-level route does not determine measurement or a gain/goodwill amount.',
    requiredFacts: [
      { key: 'controlDate', name: 'Date control was obtained', why: 'The accounting event and reporting cut-off depend on the date control actually passed, not merely the reporting date or transaction announcement date.' },
      { key: 'rightsAtDate', name: 'Rights and ownership immediately before and after the change', why: 'Voting, contractual, and other substantive rights are needed to assess whether control changed.' },
      { key: 'businessAndScope', name: 'Whether the acquired set is a business and the transaction is within SFRS(I) 3 scope', why: 'Business-combination accounting applies only if the acquired set and transaction meet the standard’s scope requirements, including the common-control exclusion.' },
      { key: 'previousInterest', name: 'Previously held interest and carrying amount', why: 'The prior associate interest may affect acquisition accounting; its terms and carrying amount are needed before measuring the transition.' },
      { key: 'considerationAssets', name: 'Consideration and acquisition-date identifiable assets and liabilities', why: 'These facts are needed before a goodwill or bargain-purchase amount can be determined.' }
    ]
  },
  'step-acquisition': {
    title: 'Step acquisition',
    standardIds: ['SFRSI3_SOURCE_MAP', 'SFRSI10_SOURCE_MAP'],
    topicId: 'sfrsi-step-acquisition',
    explanation: 'A step acquisition question involves SFRS(I) 10 and may involve SFRS(I) 3 if the acquired set and transaction are within its scope. This local rule does not calculate acquisition accounting or remeasurement amounts. First establish whether and when control was obtained, then provide the measurement inputs needed for the applicable transition accounting.',
    completeExplanation: 'The stated facts establish the control date and relevant acquisition inputs. The high-level route is SFRS(I) 3 acquisition accounting when a business is acquired and SFRS(I) 10 consolidation from the date control is obtained. This slice does not calculate the previous interest, goodwill, or other acquisition-date measurements.',
    requiredFacts: [
      { key: 'controlDate', name: 'Date control was obtained', why: 'The date determines when the control change is assessed and the relevant acquisition-date measurements.' },
      { key: 'businessAndScope', name: 'Whether the acquired set is a business and the transaction is within SFRS(I) 3 scope', why: 'A step acquisition is accounted for under SFRS(I) 3 only if the transaction meets that standard’s scope requirements.' },
      { key: 'previousInterest', name: 'Previously held interest and its measurement basis', why: 'The existing interest and its measurement information are needed to assess the transition accounting.' },
      { key: 'considerationNciAssets', name: 'Consideration, non-controlling interests, and identifiable net assets', why: 'The goodwill or bargain-purchase calculation cannot be made without these acquisition-date inputs.' }
    ]
  },
  'ownership-change': {
    title: 'Ownership change while retaining control',
    standardIds: ['SFRSI10_SOURCE_MAP'],
    topicId: 'sfrsi10-ownership-changes',
    explanation: 'Before classifying a partial disposal, establish whether control was retained throughout. This source map routes the question to SFRS(I) 10 but does not encode a disposal calculation.',
    completeExplanation: 'You state that control was retained. On that qualified fact, the investee remains within the consolidation relationship under SFRS(I) 10. This local rule does not calculate the effect of the ownership change or prepare an entry; detailed measurement requires the full standard text and transaction amounts.',
    requiredFacts: [
      { key: 'rightsBeforeAfter', name: 'Rights before and after the transaction', why: 'The resulting rights and decision-making arrangements determine whether control continued.' }
    ]
  },
  'loss-of-control': {
    title: 'Loss of control',
    standardIds: ['SFRSI10_SOURCE_MAP'],
    topicId: 'sfrsi-loss-of-control',
    explanation: 'A disposal percentage alone does not establish whether control was lost. The remaining rights and contractual arrangements determine the post-transaction relationship. This answer path does not calculate a disposal gain, retained investment, or subsequent measurement.',
    completeExplanation: 'The stated facts establish that control was lost. Under SFRS(I) 10, loss of control is the relevant consolidation event; this high-level rule does not calculate the disposal result or classify and measure any retained interest. Those conclusions require the full standard text and transaction-specific amounts.',
    requiredFacts: [
      { key: 'rightsAfter', name: 'Rights and decision-making power after disposal', why: 'The post-disposal rights determine whether control remains and whether another relationship needs assessment.' },
      { key: 'considerationRetained', name: 'Consideration and any retained interest', why: 'These facts are needed before measuring the effects of a disposal.' },
      { key: 'carryingAmounts', name: 'Carrying amounts of the subsidiary, non-controlling interests, and relevant reserves', why: 'The accounting effect cannot be measured without the relevant consolidated carrying amounts at the date of the event.' },
      { key: 'transactionDate', name: 'Date the rights changed', why: 'The date is required to identify the period and measurements affected.' }
    ]
  },
  goodwill: {
    title: 'Goodwill or bargain purchase',
    standardIds: ['SFRSI3_SOURCE_MAP'],
    topicId: 'sfrsi-goodwill-bargain-purchase',
    explanation: 'I cannot calculate goodwill or a bargain-purchase amount from the information supplied. The acquisition must first be identified as a business combination within SFRS(I) 3 scope, including confirmation that it is not a common-control combination, and the relevant acquisition-date inputs and measurement choices must be established.',
    completeExplanation: 'The stated facts provide the inputs identified for a goodwill or bargain-purchase assessment and indicate that SFRS(I) 3 applies. Goodwill is determined through the SFRS(I) 3 acquisition-method calculation; this answer path does not perform that detailed measurement. Verify the complete standard requirements and the acquisition-date amounts before recording a result.',
    requiredFacts: [
      { key: 'businessOrAssets', name: 'Whether the acquired set is a business', why: 'The business-combination accounting route depends on the nature of what was acquired.' },
      { key: 'businessCombinationScope', name: 'Whether the transaction is within SFRS(I) 3 scope, including common-control status', why: 'SFRS(I) 3 excludes common-control combinations; an applicable accounting route must be established before using its acquisition-method goodwill calculation.' },
      { key: 'acquisitionDate', name: 'Date control was obtained', why: 'The relevant amounts are measured by reference to the acquisition date.' },
      { key: 'consideration', name: 'Consideration transferred, including contingent amounts', why: 'The consideration component cannot be established without the transaction terms and measurement information.' },
      { key: 'nci', name: 'Non-controlling interest and measurement basis', why: 'The NCI amount and applicable measurement choice affect the calculation.' },
      { key: 'netAssets', name: 'Acquisition-date identifiable assets and liabilities', why: 'The identifiable net assets are necessary to determine whether goodwill or a bargain purchase may arise.' },
      { key: 'previouslyHeldInterest', name: 'Any previously held interest', why: 'A previously held interest can be relevant in a staged transaction.' }
    ]
  }
};

/** Selective local advisory rules; unsupported questions deliberately fall through. */
export function answerConsolidationKnowledgeQuery(
  query: string,
  standard: AccountingStandard
): ConsolidationKnowledgeAnswer | undefined {
  if (standard !== 'SFRS_I' || isJournalRequest(query)) return undefined;
  const selected = identifyLocalTopic(query);
  if (!selected) return undefined;
  if (selected === 'goodwill' && hasExplicitNonBusinessAcquisition(query)) return undefined;
  // Do not present an SFRS(I) 3 goodwill answer for a transaction expressly
  // described as a common-control combination. Let the mapped evidence path
  // resolve the applicable accounting policy instead.
  if (selected === 'goodwill' && hasExplicitCommonControlCombination(query)) return undefined;
  // This rule establishes the relationship only. Accounting effects need the
  // mapped official-source path because the local overview does not encode them.
  if (selected === 'ownership-change' && /\b(?:present|presentation|gain|loss|profit or loss|accounting treatment|accounted for|equity transaction|journal)\b/i.test(query)) return undefined;
  if (selected === 'loss-of-control' && /\b(?:how should|accounted for|accounting treatment|measure|remeasure|retained interest|disposal gain|disposal loss)\b/i.test(query)) return undefined;
  const baseRule = LOCAL_RULES[selected];
  const formerEquityAccountedInterest = hasAffirmativeFormerEquityAccountedInterest(query);
  let rule = baseRule;
  if (selected === 'step-acquisition' && formerEquityAccountedInterest) {
    rule = { ...baseRule, standardIds: ['SFRSI128_SOURCE_MAP', ...baseRule.standardIds] };
  } else if (selected === 'loss-of-control' && hasRetainedInfluenceOrJointVentureFacts(query)) {
    rule = { ...baseRule, standardIds: ['SFRSI10_SOURCE_MAP', 'SFRSI128_SOURCE_MAP'] };
  }
  const sources = rule.standardIds
    .map(id => UNIFIED_SOURCE_REGISTRY[id])
    .filter(record => record !== undefined && record.recordRole === 'SOURCE_MAP_POINTER' && record.groundingEligible === false &&
      record.lifecycleState === 'ACTIVE');
  // Local rule content remains usable when a source-map URL is unavailable.
  // URL verification controls links independently from local content status.
  if (sources.length !== rule.standardIds.length) return undefined;

  const outstandingFacts = rule.requiredFacts.filter(fact => !hasMaterialFact(fact.key, query));
  if (outstandingFacts.length === 0 &&
      (((selected === 'step-acquisition' || selected === 'associate-to-subsidiary') &&
        /\b(?:how (?:should|do|to).{0,30}account|accounting treatment|remeasur\w*|gain or loss|calculate goodwill|goodwill amount|journal)\b/i.test(query)) ||
       (selected === 'goodwill' && /\b(?:calculate|compute|how much|amount)\b/i.test(query)))) {
    return undefined;
  }
  const missingFields = outstandingFacts.map(fact => ({
    fieldKey: fact.key,
    fieldName: fact.name,
    prompt: `Please provide ${fact.name.toLowerCase()}.`,
    whyNeeded: fact.why
  }));
  const missingFacts = outstandingFacts.map(fact => fact.name);
  const explanation = missingFacts.length
    ? rule.explanation
    : buildCompleteExplanation(selected, rule, query);
  const informationNeeded = missingFacts.length ? `\n\n**Information still needed:** ${missingFacts.join('; ')}.` : '';
  const linkableSources = sources.filter(record =>
    hasVerifiedSourceUrlProvenance(record) &&
    defaultSourceFreshnessManager.evaluateSourceFreshness(record) === 'ACTIVE_CURRENT');
  const sourceNote = linkableSources.length
    ? 'The linked IFRS Foundation pages are official standard overviews. They identify the corresponding standards; they are not the full SFRS(I) standard text or paragraph-level evidence.'
    : 'The corresponding official overview URLs are not currently verified, so no source links are displayed.';
  const body = `${explanation}${informationNeeded}\n\n${sourceNote} No detailed calculation is made here.`;
  const citations = linkableSources.map(record => `[${record.documentTitle} — official overview URL verified ${record.urlVerifiedDate}](${record.officialSourceUrl})`);
  const sourcePointers = citations.length ? `\n\n### Official source-map pointers\n${citations.join('\n')}` : '';
  const scenarioState: AccountingScenarioState = {
    scenarioType: 'SFRSI_CONSOLIDATION_KNOWLEDGE',
    rawQuery: query,
    transactionTitle: `SFRS(I) ${rule.title} Advisory`,
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    directGroups: [],
    isComplete: missingFields.length === 0,
    missingFields,
    missingFacts,
    queryIntent: 'STATUTORY_ADVISORY',
    primaryDomain: 'ACCOUNTING_SFRS',
    accountingTreatmentSummary: body,
    uncertaintyDisclaimer: 'Source-map URLs are verified pointers only; retrieve and validate topic-specific official text before making paragraph-level claims.'
  };
  const topic = getCoverageTopicById(rule.topicId);
  const heading = topic?.actOrStandard || 'SFRS(I) consolidation and investments standards';
  return {
    messageText: `### ${heading} — ${rule.title}\n\n${body}${sourcePointers}`,
    scenarioState,
    clarifications: missingFields,
    sourceMapFallbackTrace: {
      path: 'NOT_NEEDED',
      localRuleId: selected,
      sourceMapIds: sources.map(record => record.id),
      sourceMapRecordIds: sources.map(record => record.id),
      selectedRecordIds: sources.map(record => record.id),
      finalVerifiedUrls: linkableSources.map(record => record.officialSourceUrl),
      candidateOnly: false,
      attempts: []
    }
  };
}

function identifyLocalTopic(query: string): LocalTopic | undefined {
  const q = query.toLowerCase();
  if (/\b(?:measurement period|provisional acquisition accounting|acquisition[- ]related costs?|contingent consideration|intragroup|intra-group|consolidation elimination|equity method losses|impairment of (?:an? )?associate|share of (?:profit|loss)|share of (?:profit|loss).{0,30}OCI)\b/.test(q)) return undefined;
  const hasExplicitStepAcquisition = /\b(?:step|staged) acquisition\b/.test(q) &&
    !/\b(?:not|no|never)\b.{0,20}\b(?:step|staged) acquisition\b/.test(q);
  const positiveAssociateTransition = hasPositiveEquityAccountedControlTransition(q);
  if (positiveAssociateTransition && !hasExplicitStepAcquisition) return 'associate-to-subsidiary';
  if (/\bassociate\b.{0,45}\b(?:becomes?|became|becoming|turns? into|converts? into)\s+(?:a\s+)?subsidiary\b/.test(q) &&
      !/\b(?:not|never|no longer)\b.{0,30}\b(?:becomes?|became|becoming|turns? into|converts? into)\s+(?:a\s+)?subsidiary\b/.test(q)) return 'associate-to-subsidiary';
  if (hasExplicitStepAcquisition) return 'step-acquisition';
  if (positiveAssociateTransition) return 'associate-to-subsidiary';
  if (/\bincremental acquisition\b.{0,35}\b(?:obtained|obtain|gained|gain)\s+control\b/.test(q)) return 'step-acquisition';
  if (/\b(?:goodwill|bargain purchase|negative goodwill)\b/.test(q) && /\b(?:calculate|calculation|amount|how much|missing facts|inputs|compute)\b/.test(q)) return 'goodwill';
  if (/\b(?:partial disposal|ownership change|ownership interest change|without loss of control|retaining control|retained control|control is retained)\b/.test(q) && /\b(?:\d+(?:\.\d+)?\s*%|percent|percentage|ownership|holding)\b/.test(q)) return 'ownership-change';
  if (/\b(?:loss of control|deconsolidat|disposal.{0,35}subsidiary|sell.{0,35}subsidiary)\b/.test(q)) return 'loss-of-control';
  const significantInfluenceQuestion = /\bsignificant influence\b|\b20\s*%\s+threshold\b|\b(?:below|above)\s+20\s*%(?!\w)|\b(?:below|above)\s+20\s+percent\b/i.test(q);
  if (significantInfluenceQuestion && /(?:\b\d+(?:\.\d+)?\s*%(?!\w)|\b(?:percent|percentage|voting power|ownership)\b)/i.test(q)) return 'significant-influence';
  if (/\b(?:control of an investee|control assessment|(?:do|does).{0,25}control|control.{0,25}investee|\d+(?:\.\d+)?\s*%|percent|de facto control|potential voting rights)/.test(q) && /\b(?:own|owns|ownership|holding|hold|voting rights|shareholder agreement|shareholding|stake|investee)\b/.test(q)) return 'control';
  return undefined;
}

function hasPositiveEquityAccountedControlTransition(query: string): boolean {
  const priorAssociateContext = /\b(?:equity[- ]accounted|(?:applied|applying|under|using)\s+(?:the\s+)?equity method|accounted for under (?:the\s+)?equity method|associate)\b/i.test(query);
  const positiveAdditionalAcquisition = /\b(?:acquir\w*|bought|purchas\w*)\b[\s\S]{0,90}\b(?:another|additional|further)\b[\s\S]{0,40}(?:\b\d+(?:\.\d+)?\s*%(?!\w)|\bshares?\b|\binterest\b|\bstake\b)/i.test(query);
  const positiveControl = /\b(?:obtain\w*|gain\w*|achiev\w*)\s+control\b/i.test(query);
  const negatedControl = /\b(?:no|not|never|without|cannot|can't|didn't|hasn't)\b[\s\S]{0,40}\b(?:obtain\w*|gain\w*|achiev\w*)\s+control\b/i.test(query);
  return priorAssociateContext && positiveAdditionalAcquisition && positiveControl && !negatedControl;
}

function hasMaterialFact(key: string, query: string): boolean {
  const q = query.toLowerCase();
  const protectiveOrDeniedPower = hasProtectiveOrDeniedPower(query);
  const percentage = /\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s+percent\b/i.test(q);
  const exactDate = /\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}\b|\b20\d{2}-\d{2}-\d{2}\b/i.test(q);
  const businessScopeEvidence = /\b(?:within (?:the )?(?:scope of )?SFRS\(I\)\s*3|not under common[- ]control|not a common[- ]control (?:combination|transaction)|unrelated[- ]part(?:y|ies)|independent[- ]part(?:y|ies))\b/i;
  const businessScopeMention = /\b(?:scope of SFRS\(I\)\s*3|SFRS\(I\)\s*3 scope|common[- ]control|unrelated[- ]part(?:y|ies)|independent[- ]part(?:y|ies))\b/i;
  switch (key) {
    case 'decisionRights': return !protectiveOrDeniedPower && /\b(?:power over relevant activities|right to direct relevant activities|rights? to direct|directs? the relevant activities|decision[- ]making rights)\b/i.test(q) &&
      !/\b(?:no|not|without|disputed|unclear)\b.{0,45}\b(?:power|right|rights|decision)\b/i.test(q) &&
      !/\b(?:another|other)\s+(?:shareholder|investor|party)\b.{0,45}\b(?:power|rights?|direct|decision)\b/i.test(q);
    case 'returnsExposure': return /\b(?:exposed to|exposure to|rights? to) variable returns\b/i.test(q) && !/\b(?:not|no|without|unclear)\b.{0,35}\b(?:exposure|exposed|rights?)\b/i.test(q);
    case 'linkPowerReturns': return !protectiveOrDeniedPower && /\b(?:can|able to|has the ability to) use.{0,35}(?:power|rights).{0,55}affect.{0,25}returns\b/i.test(q) && !/\b(?:cannot|can't|not able|unable to)\b.{0,65}\baffect.{0,25}returns\b/i.test(q);
    case 'otherRights': return /\b(?:no|neither)\s+(?:other|another)\s+(?:party|shareholder|investor)\b[\s\S]{0,50}\b(?:rights?|authority|decision)\b/i.test(q) ||
      /\b(?:another|other)\s+(?:shareholder|investor|party)\b[\s\S]{0,45}\b(?:has|holds|exercises|can direct|veto|appoints|rights?)\b/i.test(q) ||
      /\b(?:veto rights?|unilateral rights?|acts? as (?:an? )?(?:agent|principal)|is (?:an? )?(?:agent|principal)|rights of other shareholders)\b/i.test(q) ||
      /\bshareholder agreement\b[\s\S]{0,80}\b(?:provides? that|gives|grants|confers|permits|requires|contains|includes)\b[\s\S]{0,40}\b(?:right|veto|appoint|direct|decision|consent)\b/i.test(q);
    case 'votingRights': return getExplicitVotingPercentage(query) !== undefined;
    case 'participationEvidence': return /\b(?:board representation|board seat|participat\w*.{0,35}policy|policy[- ]making|management interchange|material transactions|essential technical information|participate in decisions)\b/i.test(q) &&
      !/\b(?:no|not|without|cannot|can't|do not|does not)\b.{0,35}\b(?:board|participat\w*|policy|management interchange|material transactions)\b/i.test(q);
    case 'contraryEvidence': return /\b(?:clearly demonstrated otherwise|rebut(?:ted|ting)?|no contrary evidence|no evidence to rebut|contrary evidence|no evidence of influence|cannot participate|do not participate|no board representation)\b/i.test(q);
    case 'controlDate': return exactDate;
    case 'rightsAtDate': return percentage && /\b(?:voting|rights?|ownership|holding|held|acquired|stake|agreement|board|equity[- ]accounted)\b/i.test(q);
    case 'previousInterest': return !isExplicitlyMissingFact(query, /\b(?:previously held|previous holding|prior interest|existing interest|carrying amount of (?:the )?(?:prior|previous|existing))\b/i) &&
      /\b(?:previously held|previous holding|prior interest|existing interest|carrying amount of (?:the )?(?:prior|previous|existing))\b/i.test(q) &&
      /\b(?:carrying amount|fair value|measurement|amount)\b/i.test(q);
    case 'considerationAssets': return !isExplicitlyMissingFact(query, /\bconsideration\b/i) &&
      !isExplicitlyMissingFact(query, /\b(?:identifiable net assets|identifiable assets|assets and liabilities)\b/i) &&
      /\bconsideration\b/i.test(q) && /\bfair value\b/i.test(q) && /\b(?:identifiable net assets|identifiable assets|assets and liabilities)\b/i.test(q);
    case 'considerationNciAssets': return !isExplicitlyMissingFact(query, /\bconsideration\b/i) &&
      !isExplicitlyMissingFact(query, /\b(?:nci|non[- ]controlling interests?)\b/i) &&
      !isExplicitlyMissingFact(query, /\b(?:identifiable net assets|fair value of (?:the )?assets)\b/i) &&
      /\bconsideration\b/i.test(q) && /\b(?:nci|non[- ]controlling interests?)\b/i.test(q) &&
      /\b(?:identifiable net assets|fair value of (?:the )?assets)\b/i.test(q);
    case 'businessOrAssets': return hasAffirmativeBusinessNature(query);
    case 'businessCombinationScope': return !hasExplicitCommonControlCombination(query) &&
      !isExplicitlyMissingFact(query, businessScopeMention) && !isInterrogativeFactMention(query, businessScopeMention) && businessScopeEvidence.test(q);
    case 'businessAndScope': return hasAffirmativeBusinessNature(query) &&
      !isExplicitlyMissingFact(query, businessScopeMention) && !isInterrogativeFactMention(query, businessScopeMention) && businessScopeEvidence.test(q) &&
      !/\b(?:under common control|common-control transaction|outside (?:the )?scope of SFRS\(I\)\s*3)\b/i.test(q);
    case 'acquisitionDate': return exactDate || /\b(?:on|at) the acquisition date\b/i.test(q);
    case 'consideration': return !isExplicitlyMissingFact(query, /\bconsideration(?: transferred)?\b/i) &&
      /\b(?:SGD|\$)\s*[\d,]+(?:\.\d{1,2})?|\bconsideration transferred of\s*[\d,]+/i.test(q);
    case 'nci': return !isExplicitlyMissingFact(query, /\b(?:nci|non[- ]controlling interests?)\b/i) &&
      /\b(?:nci|non[- ]controlling interests?)\b/i.test(q) && /\b(?:fair value|proportionate|measured|measure)\b/i.test(q);
    case 'netAssets': return !isExplicitlyMissingFact(query, /\b(?:identifiable assets|identifiable net assets|liabilities assumed)\b/i) &&
      /\b(?:fair value|measured at)\b/i.test(q) && /\b(?:identifiable assets|identifiable net assets|liabilities assumed)\b/i.test(q);
    case 'previouslyHeldInterest': return /\b(?:no previously held interest|no prior interest|first acquisition)\b/i.test(q) ||
      (!isExplicitlyMissingFact(query, /\b(?:previously held|previous holding|prior interest|existing interest)\b/i) &&
       /\b(?:previously held|previous holding|prior interest|existing interest|step acquisition)\b/i.test(q));
    case 'rightsBeforeAfter': return /\b(?:retaining control|control is retained|retained control|without loss of control|control continues)\b/i.test(q);
    case 'rightsAfter': return /\b(?:loss of control|control was lost|no longer controls|no longer control)\b/i.test(q) && /\b(?:retained interest|remaining stake|rights after|no retained interest|disposed of all)\b/i.test(q);
    case 'considerationRetained': return /\bconsideration\b/i.test(q) && /\b(?:retained interest|remaining stake|retained investment|no retained interest)\b/i.test(q);
    case 'carryingAmounts': return /\b(?:carrying amount|carrying value|consolidated balance|nci balance|reserves)\b/i.test(q);
    case 'transactionDate': return exactDate;
    default: return false;
  }
}

function buildCompleteExplanation(topic: LocalTopic, rule: LocalRule, query: string): string {
  if (topic === 'significant-influence') {
    const percentage = getExplicitVotingPercentage(query);
    if (percentage !== undefined && percentage >= 20) {
      return `The stated facts indicate ${percentage}% voting power and the relevant participation/rebuttal evidence. IAS 28's overview describes a rebuttable presumption of significant influence at 20% or more of voting power. On the stated facts, significant influence is indicated unless clearly rebutted; if it is established, SFRS(I) 1-28 uses the equity method, subject to applicable scope exceptions.`;
    }
    return rule.completeExplanation || rule.explanation;
  }
  if (topic === 'control' && (hasProtectiveOrDeniedPower(query) || /\b(?:other party has unilateral|another party has unilateral|does not have power|cannot direct|no exposure to variable returns)\b/i.test(query))) {
    return rule.explanation;
  }
  return rule.completeExplanation || rule.explanation;
}

function hasProtectiveOrDeniedPower(query: string): boolean {
  return /\b(?:protective\s+only|only\s+protective|merely\s+protective|protective[- ]only|non[- ]substantive\s+(?:decision[- ]making\s+)?rights?)\b/i.test(query) ||
    /\b(?:do not|does not|did not|don't|doesn't|cannot|can't|unable to)\b[\s\S]{0,60}\b(?:give|provide|confer|grant|vest|create|establish|have)\b[\s\S]{0,25}\b(?:power|right to direct|ability to direct)\b/i.test(query) ||
    /\b(?:no|lack(?:s|ing)?|without)\s+(?:(?:substantive|decision[- ]making)\s+)?power\b/i.test(query);
}

function isExplicitlyMissingFact(query: string, factPattern: RegExp): boolean {
  const omissionCue = /\b(?:not provided|not supplied|not given|missing|unknown|not known|not available|not specified|omitted|unclear|uncertain|undetermined|do not know|does not know|don't know|doesn't know|cannot confirm|can't confirm|not sure|not certain)\b/i;
  return query.split(/[.!?;]+/).some(sentence => {
    const facts = [...sentence.matchAll(new RegExp(factPattern.source, 'ig'))];
    const cues = [...sentence.matchAll(new RegExp(omissionCue.source, 'ig'))];
    return facts.some(fact => cues.some(cue => {
      if (fact.index === undefined || cue.index === undefined) return false;
      const factEnd = fact.index + fact[0].length;
      if (cue.index <= fact.index) {
        const relation = sentence.slice(cue.index + cue[0].length, fact.index);
        return relation.length <= 250 && !/\b(?:but|however|although)\b/i.test(relation);
      }
      const relation = sentence.slice(factEnd, cue.index);
      return relation.length <= 45 && !/[;!?]/.test(relation) && !/\b(?:but|however|although)\b/i.test(relation);
    }));
  });
}

function isInterrogativeFactMention(query: string, factPattern: RegExp): boolean {
  const questionSentences = query.match(/(?:^|[.!;])[^.!?;]*\?/g) || [];
  if (questionSentences.some(question => factPattern.test(question))) return true;
  const questionPattern = /[^?]*\?/g;
  return [...query.matchAll(questionPattern)].some(question => {
    const clauses = question[0].slice(0, -1).split(/[.!;,]/);
    return clauses.some(clause => /^\s*(?:does|do|did|is|are|was|were|has|have|had|whether|if|what|which|who|can|could|should|will|would|may|might|how)\b/i.test(clause) &&
      factPattern.test(clause));
  });
}

function isScopeUncertaintyClause(text: string): boolean {
  const scopeCue = /\b(?:common[- ]control|SFRS\(I\)\s*3\s+scope|scope of SFRS\(I\)\s*3)\b/i.exec(text);
  const uncertaintyCue = /\b(?:not provided|not supplied|not given|missing|unknown|not known|not available|not specified|omitted|unclear|uncertain|undetermined|do not know|does not know|don't know|doesn't know|cannot confirm|can't confirm|not sure|not certain|may|might|could|possibly|perhaps|maybe)\b/i.exec(text);
  return Boolean(scopeCue && uncertaintyCue && Math.abs(scopeCue.index - uncertaintyCue.index) <= 120);
}

function splitFactClauses(query: string): Array<{ text: string; delimiter: string }> {
  const parts = query.split(/([.!?;,\n]+|\b(?:but|however|although)\b)/i);
  const clauses: Array<{ text: string; delimiter: string }> = [];
  const append = (text: string, delimiter: string) => {
    if (text.trim()) clauses.push({ text: text.trim(), delimiter });
  };
  for (let index = 0; index < parts.length; index += 2) {
    const text = parts[index];
    const delimiter = parts[index + 1] || '';
    const andMatches = [...text.matchAll(/\band\b/gi)];
    let start = 0;
    let didSplit = false;
    for (const match of andMatches) {
      if (match.index === undefined) continue;
      const afterAnd = match.index + match[0].length;
      const nextConjunction = text.slice(afterAnd).search(/\band\b/i);
      const rightClause = text.slice(afterAnd, nextConjunction < 0 ? undefined : afterAnd + nextConjunction);
      if (!isScopeUncertaintyClause(rightClause)) continue;
      append(text.slice(start, match.index), 'and');
      start = afterAnd;
      didSplit = true;
    }
    if (didSplit) append(text.slice(start), delimiter);
    else append(text, delimiter);
  }
  return clauses;
}

function isInterrogativeFactClause(clause: { text: string; delimiter: string }): boolean {
  const text = clause.text.replace(/^\s*(?:but|however|although)\s+/i, '').trim();
  return clause.delimiter.includes('?') ||
    /^(?:does|do|did|is|are|was|were|has|have|had|whether|if|what|which|who|can|could|should|will|would|may|might|how)\b/i.test(text);
}

function hasAffirmativeBusinessNature(query: string): boolean {
  const affirmativePattern = /\b(?:the acquired set is (?:clearly )?a business|the set is a business|(?:the )?(?:acquired set|set|investee|acquiree|target) (?:meets|satisfies) (?:the )?definition of a business|the (?:acquired set|investee|acquiree|target) constitutes a business|the (?:investee|acquiree|target) is a business|(?:(?:we|the entity|the acquirer)\s+)?(?:have\s+)?acquired (?:a )?business|acquired control of (?:a )?business|(?:this|the transaction|the acquisition|we|the entity|the acquirer)\s+(?:(?:have|has)\s+)?(?:completed|entered into|is|was|constitutes|represents)\s+(?:a\s+)?business combination)\b/i;
  const omissionOrUncertainty = /\b(?:not provided|not supplied|not given|missing|unknown|not known|not available|not specified|omitted|unclear|uncertain|undetermined|do not know|does not know|don't know|doesn't know|cannot confirm|can't confirm|not sure|not certain|may|might|could|possibly|perhaps|maybe)\b/i;
  const deniedBusinessNature = /\b(?:not a business|isn't a business|is not a business|does not meet (?:the )?definition of a business|doesn't meet (?:the )?definition of a business|fails? to meet (?:the )?definition of a business)\b/i;
  const assetAcquisition = /\basset acquisition\b/i;
  const negatedAssetAcquisition = /\b(?:not|never|no|isn't|is not|wasn't|was not)\b[\s\S]{0,35}\basset acquisition\b/i;
  const isExplicitDenial = (clause: string) => deniedBusinessNature.test(clause) ||
    (assetAcquisition.test(clause) && !negatedAssetAcquisition.test(clause));
  const clauses = splitFactClauses(query);
  const affirmative = clauses.some(clause => affirmativePattern.test(clause.text) &&
    !omissionOrUncertainty.test(clause.text) &&
    !isExplicitDenial(clause.text) &&
    !isInterrogativeFactClause(clause));
  const explicitDenial = clauses.some(clause => isExplicitDenial(clause.text) &&
    !omissionOrUncertainty.test(clause.text) &&
    !isInterrogativeFactClause(clause));
  const uncertainNatureClassification = clauses.some(clause => {
    const hasStrongNatureReference = /\b(?:asset acquisition|definition of a business)\b/i.test(clause.text);
    const genericNatureReference = /\b(?:is|was|be|being)\s+(?:a\s+)?business\b/i.test(clause.text);
    const acquiredSubjectNatureReference = /\b(?:the\s+)?(?:acquired set|set|acquiree|target|investee)\s+(?:is|was)\s+(?:clearly\s+)?a business\b/i.test(clause.text);
    const interrogativeNatureReference = /^\s*(?:is|was)\s+(?:the\s+)?(?:acquired set|set|acquiree|target|investee)\s+(?:clearly\s+)?a business\b/i.test(clause.text);
    const anaphoricNatureQuestion = /^\s*(?:is|was)\s+(?:it|this|that)\s+(?:not\s+)?(?:clearly\s+)?a business\b(?!\s+combination\b)/i.test(clause.text);
    const hasNatureReference = hasStrongNatureReference || genericNatureReference || acquiredSubjectNatureReference || interrogativeNatureReference || anaphoricNatureQuestion;
    return hasNatureReference && (omissionOrUncertainty.test(clause.text) || isInterrogativeFactClause(clause));
  });
  return affirmative && !explicitDenial && !uncertainNatureClassification;
}

function hasExplicitNonBusinessAcquisition(query: string): boolean {
  const uncertainty = /\b(?:not provided|not supplied|not given|missing|unknown|not known|not available|not specified|omitted|unclear|uncertain|undetermined|do not know|does not know|don't know|doesn't know|cannot confirm|can't confirm|not sure|not certain|may|might|could|possibly|perhaps|maybe)\b/i;
  const assertedAssetAcquisition = /\basset acquisition\b/i;
  const negatedAssetAcquisition = /\b(?:not|never|no|isn't|is not|wasn't|was not)\b[\s\S]{0,35}\basset acquisition\b/i;
  const assertedNonBusiness = /\b(?:acquired set|set|transaction|acquisition|investee|acquiree|target|it|this)\s+(?:is|was)\s+not\s+(?:a\s+)?business\b|\bnot a business\b/i;
  return splitFactClauses(query).some(clause =>
    !uncertainty.test(clause.text) &&
    !isInterrogativeFactClause(clause) &&
    ((assertedAssetAcquisition.test(clause.text) && !negatedAssetAcquisition.test(clause.text)) ||
      assertedNonBusiness.test(clause.text))
  );
}

function hasAffirmativeFormerEquityAccountedInterest(query: string): boolean {
  const interestPattern = /\b(?:associate|equity[- ]accounted|equity method)\b/i;
  const explicitlyDenied = /\b(?:no|not|never|without|do not|don't|does not|doesn't|did not|didn't|cannot|can't)\b[\s\S]{0,45}\b(?:associate|equity[- ]accounted|equity method)\b/i.test(query) ||
    /\b(?:associate|equity[- ]accounted|equity method)\b[\s\S]{0,35}\b(?:not held|not hold|not have|does not exist|is not present)\b/i.test(query);
  return interestPattern.test(query) && !explicitlyDenied && !isExplicitlyMissingFact(query, interestPattern);
}

function hasExplicitCommonControlCombination(query: string): boolean {
  const positive = /\b(?:under common[- ]control|common[- ]control (?:business )?(?:combination|transaction))\b/i.test(query);
  const explicitlyDenied = /\b(?:not|never|no longer|isn't|is not|wasn't|was not)\b[\s\S]{0,35}\b(?:under common[- ]control|common[- ]control (?:business )?(?:combination|transaction))\b/i.test(query);
  const uncertain = splitFactClauses(query).some(clause => isScopeUncertaintyClause(clause.text) ||
    (isInterrogativeFactClause(clause) && /\b(?:common[- ]control|under common[- ]control)\b/i.test(clause.text)));
  return positive && !explicitlyDenied && !uncertain;
}

function hasRetainedInfluenceOrJointVentureFacts(query: string): boolean {
  const hasRetainedInterest = /\b(?:retain\w*|retained|still hold|continue to hold)\b[\s\S]{0,35}(?:\b\d+(?:\.\d+)?\s*%(?!\w)|\b(?:interest|investment|stake|shares?)\b)/i.test(query);
  const positiveInfluence = /\b(?:board representation|board seat|significant influence|participate\w*\s+in\s+(?:financial and operating\s+)?policy decisions?|equity[- ]accounted|equity method)\b/i.test(query) &&
    !/\b(?:no|not|without|cannot|can't|does not)\b[\s\S]{0,35}\b(?:board representation|board seat|significant influence|participate\w*\s+in\s+(?:financial and operating\s+)?policy decisions?|equity[- ]accounted|equity method)\b/i.test(query);
  const positiveJointVenture = /\b(?:joint venture|joint control|unanimous consent|rights to net assets)\b/i.test(query) &&
    !/\b(?:no|not|without|cannot|can't)\b[\s\S]{0,30}\b(?:joint venture|joint control|unanimous consent|rights to net assets)\b/i.test(query);
  return hasRetainedInterest && (positiveInfluence || positiveJointVenture);
}

function getExplicitVotingPercentage(query: string): number | undefined {
  const candidates: number[] = [];
  const add = (value: string) => {
    const percentage = Number(value);
    if (Number.isFinite(percentage) && percentage >= 0 && percentage <= 100) candidates.push(percentage);
  };
  for (const match of query.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:%|percent)\s+(?:of\s+)?(?:the\s+)?voting\s+(?:rights|power)\b/gi)) add(match[1]);
  for (const match of query.matchAll(/\bvoting\s+(?:rights|power)\s+(?:of\s+|are\s+|is\s+|at\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent)(?!\w)/gi)) add(match[1]);
  const distinct = [...new Set(candidates)];
  return distinct.length === 1 ? distinct[0] : undefined;
}

function isJournalRequest(query: string): boolean {
  return /\b(?:journal|double\s+entr(?:y|ies)|debits?\s+and\s+credits?|post\s+(?:this|the)|prepare\s+(?:an?\s+)?entry|record\s+(?:this|the)\s+transaction)\b/i.test(query);
}
