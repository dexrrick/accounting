import type { AccountingScenarioState, AccountingStandard, MissingFieldInfo } from '../types/accounting';
import { STANDARDS_REPOSITORY } from '../standards/standardsKnowledge';

export interface Sfrsi9KnowledgeAnswer {
  messageText: string;
  scenarioState: AccountingScenarioState;
  clarifications?: MissingFieldInfo[];
}

type AnswerTopic = 'debt-amortised-cost' | 'debt-fvoci' | 'debt-missing-facts' | 'initial-measurement' | 'amendment-effective-date' | 'equity-fvoci' | 'ecl';

/**
 * Offline, source-cited SFRS(I) 9 answers for rule slices in the reviewed
 * knowledge pack. Unrecognised questions deliberately use the regular path.
 */
export function answerSfrsi9KnowledgeQuery(
  query: string,
  standard: AccountingStandard
): Sfrsi9KnowledgeAnswer | undefined {
  if (standard !== 'SFRS_I' || !/\b(?:SFRS\s*\(\s*I\s*\)|IFRS)\s*9\b/i.test(query)) return undefined;
  if (/\b(?:journal|double\s+entry|debits?\s+and\s+credits?|post\s+(?:this|the)|prepare\s+(?:an?\s+)?entry|record\s+(?:this|the)\s+transaction)\b/i.test(query)) return undefined;

  const topic = identifyTopic(query);
  if (!topic || !hasRequiredFacts(topic, query)) return undefined;
  return buildAnswer(topic, query);
}

function identifyTopic(query: string): AnswerTopic | undefined {
  if (/(?:amendments?|amendment).{0,100}(?:effective|mandatory)|(?:effective|mandatory).{0,100}amendments?/i.test(query) &&
      /2024/.test(query) && /(?:period|reporting period).{0,70}(?:beginning|starts?|commencing).{0,35}(?:1 January 2025|January 1,? 2025)/i.test(query)) {
    return 'amendment-effective-date';
  }
  if (/\b(?:expected credit loss|expected credit losses|ecl|loss allowance|significant increase in credit risk)\b/i.test(query)) return 'ecl';
  if (/\b(?:equity investment|equity instrument|shares? in another company)\b/i.test(query) &&
      /\b(?:oci|fvoci|recycl|reclassif|irrevocabl|election)\b/i.test(query)) return 'equity-fvoci';
  if (/\b(?:initial carrying amount|initial measurement|initial recognition)\b/i.test(query) &&
      /\b(?:bond|investment|financial asset|financial instrument)\b/i.test(query)) return 'initial-measurement';
  const equityInstrument = /\b(?:equity investment|equity instrument|shares? in another company)\b/i.test(query);
  const debtInstrument = /\b(?:bond|debt investment|debt instrument|loan)\b/i.test(query);
  if (equityInstrument) return undefined;

  const qualifiedCashFlows = assertionCues(query, /\b(?:solely\s+(?:are\s+)?payments? of principal and interest|only\s+payments? of principal and interest)\b/gi);
  const sppiMention = assertionCues(query, /\bSPPI\b/gi);
  const affirmativeSppi = /\b(?:meet|meets|met|satisfy|satisfies|satisfied|pass|passes|passed|fulfil|fulfils|fulfilled)\b.{0,35}\bSPPI\b|\bSPPI\s+(?:condition|test)\s+(?:is\s+)?(?:met|satisfied|passed|fulfilled)\b/i.test(query);
  const spPi = {
    positive: qualifiedCashFlows.positive || (affirmativeSppi && !sppiMention.negative),
    negative: qualifiedCashFlows.negative || sppiMention.negative
  };
  const collectAndSell = assertionCues(query, /\b(?:to\s+)?collect(?:ing)?(?: contractual cash flows)?\s+(?:and|&)\s+(?:to\s+)?sell(?:ing)?\b|\bcollect[- ]and[- ]sell\b/gi);
  const holdToCollect = assertionCues(query, /\b(?:solely|only)\s+to\s+collect\b|\bhold(?:ing)?[- ]to[- ]collect\b|\bheld\s+(?:solely\s+)?to\s+collect\b/gi);
  const nonBasicCashFlowFeature = /\b(?:share[- ]price|equity[- ]price|equity[- ]index|commodity[- ]linked|leveraged|inverse[- ]floating|non[- ]basic lending|cash[- ]flow feature)\b/i.test(query);
  // A negated SPPI assertion, contradictory assertion, or mixed positive
  // business-model description is outside this deterministic answer slice.
  if (nonBasicCashFlowFeature || spPi.negative || (spPi.positive && collectAndSell.positive && holdToCollect.positive) ||
      (collectAndSell.positive && collectAndSell.negative) || (holdToCollect.positive && holdToCollect.negative)) return undefined;
  if (debtInstrument && spPi.positive && collectAndSell.positive) return 'debt-fvoci';
  if (debtInstrument && spPi.positive && holdToCollect.positive) return 'debt-amortised-cost';
  if (debtInstrument && /\bclassif(?:y|ied|ication)\b/i.test(query)) return 'debt-missing-facts';
  return undefined;
}

function assertionCues(query: string, pattern: RegExp): { positive: boolean; negative: boolean } {
  let positive = false;
  let negative = false;
  const matcher = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  for (const match of query.matchAll(matcher)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    const beforeClause = query.slice(0, index).split(/[,.!?;:]|\b(?:but|however|whereas|instead|and)\b/i).at(-1) || '';
    const afterClause = query.slice(end).split(/[,.!?;:]|\b(?:but|however|whereas|instead|and)\b/i)[0] || '';
    const negatedBefore = /\b(?:not|never|no|without|does not|doesn't|do not|don't|cannot|can't|fails? to|failed to)\b/i.test(beforeClause);
    const negatedAfter = /^(?:\s+[-\w']+){0,5}\s+\b(?:not|never|without|fails? to|failed to|does not|doesn't|do not|don't)\b/i.test(afterClause);
    if (negatedBefore || negatedAfter) negative = true;
    else positive = true;
  }
  return { positive, negative };
}

function hasRequiredFacts(topic: AnswerTopic, query: string): boolean {
  switch (topic) {
    case 'initial-measurement': {
      const fvtplExcluded = /\bnot measured at FVTPL\b/i.test(query) || /\boutside FVTPL\b/i.test(query);
      const exceptionExcluded = /\b(?:not covered by|not subject to|outside) the trade[- ]receivable exception\b/i.test(query) ||
        /\bnot measured at FVTPL\s+or\s+covered by the trade[- ]receivable exception\b/i.test(query);
      const exceptionAffirmed = /\bcovered by the trade[- ]receivable exception\b/i.test(query);
      const coordinatedExclusion = /\bnot measured at FVTPL\s+or\s+covered by the trade[- ]receivable exception\b/i.test(query);
      const directlyAttributable =
        /\bdirectly attributable(?: acquisition)? transaction costs?\b|\btransaction costs?\b.{0,50}\bdirectly attributable\b/i.test(query) &&
        !/\btransaction costs?[^.!?;:]{0,100}\b(?:not|never|without)\s+(?:being\s+)?directly attributable\b|\b(?:not|never|without)\s+(?:being\s+)?directly attributable(?: acquisition)? transaction costs?\b/i.test(query);
      return fvtplExcluded && exceptionExcluded && directlyAttributable && (!exceptionAffirmed || coordinatedExclusion);
    }
    case 'equity-fvoci':
      {
        const election = assertionCues(query, /\b(?:irrevocably elected|irrevocable election)\b/gi);
        const tradingStatus = assertionCues(query, /\bheld for trading\b/gi);
        const contingentConsideration = assertionCues(query, /\bcontingent consideration\b/gi);
        return tradingStatus.negative && !tradingStatus.positive &&
          contingentConsideration.negative && !contingentConsideration.positive &&
          election.positive && !election.negative &&
          ( /\b(?:irrevocably elected|irrevocable election)\b.{0,100}\b(?:initial recognition|initially recognized|initially recognised)\b/i.test(query) ||
            /\b(?:initial recognition|initially recognized|initially recognised)\b.{0,100}\b(?:irrevocably elected|irrevocable election)\b/i.test(query) );
      }
    case 'amendment-effective-date':
      return /\bperiod\b.{0,70}\b(?:beginning|starts?|commencing)\b.{0,35}\b(?:1 January 2025|January 1,? 2025)\b/i.test(query);
    case 'ecl':
      {
        const amortisedCost = measurementBasisAssertions(query, 'amortised cost');
        const fvtpl = measurementBasisAssertions(query, 'FVTPL');
        return hasNonPociAssertion(query) && hasNoSicrAssertion(query) &&
          !/\b(?:equity investment|equity instrument|shares? in another company)\b/i.test(query) &&
          /\b(?:bond|loan|debt instrument)\b/i.test(query) &&
          amortisedCost.positive && !amortisedCost.negative && !fvtpl.positive;
      }
    case 'debt-amortised-cost':
    case 'debt-fvoci':
    case 'debt-missing-facts':
      return true;
  }
}

function hasNonPociAssertion(query: string): boolean {
  const poci = assertionCues(query, /\b(?:purchased or originated credit[- ]impaired|(?<!non[- ])POCI)\b/gi);
  const nonPoci = assertionCues(query, /\bnon[- ]?poci\b/gi);
  if (poci.positive || (poci.negative && (poci.positive || nonPoci.negative)) || nonPoci.negative) return false;
  return poci.negative || nonPoci.positive;
}

function hasNoSicrAssertion(query: string): boolean {
  if (/\bnot\s+(?:no|without)\s+(?:a\s+)?(?:significant increase in credit risk|SICR)\b/i.test(query)) return false;
  const sicr = assertionCues(query, /\b(?:significant increase in credit risk|SICR)\b/gi);
  return sicr.negative && !sicr.positive;
}

function measurementBasisAssertions(query: string, basis: 'amortised cost' | 'FVTPL'): { positive: boolean; negative: boolean } {
  const matcher = new RegExp(`\\b(?:measured|classified)\\s+(?:subsequently\\s+)?(?:at|as)\\s+${basis}\\b`, 'gi');
  let positive = false;
  let negative = false;
  for (const match of query.matchAll(matcher)) {
    const index = match.index ?? 0;
    const priorClause = query.slice(0, index).split(/[.!?;:]/).at(-1) ?? '';
    const precedingWords = priorClause.slice(-45);
    if (/\b(?:not|never|without)\b(?:\s+[\w'-]+){0,3}\s*$/i.test(precedingWords)) negative = true;
    else positive = true;
  }
  return { positive, negative };
}

function buildAnswer(topic: AnswerTopic, query: string): Sfrsi9KnowledgeAnswer | undefined {
  let body: string;
  let ruleIds: string[];
  let missingFields: MissingFieldInfo[] = [];
  let missingFacts: string[] = [];

  switch (topic) {
    case 'debt-amortised-cost':
      body = 'The facts state that the debt investment is managed solely to collect contractual cash flows and that its specified-date cash flows are solely payments of principal and interest (the SPPI condition). With both classification conditions met, the asset is measured subsequently at **amortised cost**, subject to applicable exceptions such as a qualifying fair-value designation.';
      ruleIds = ['IFRS9_DEBT_CLASSIFICATION'];
      break;
    case 'debt-fvoci':
      body = 'The facts state that the debt investment is managed both to collect contractual cash flows and to sell, and that it meets the SPPI condition. A qualifying debt asset in that collect-and-sell business model is measured subsequently at **fair value through other comprehensive income (FVOCI)**, subject to applicable exceptions.';
      ruleIds = ['IFRS9_DEBT_CLASSIFICATION'];
      break;
    case 'debt-missing-facts':
      body = 'The available facts are insufficient to determine the bond’s classification. SFRS(I) 9 requires both the business model for managing the asset and an assessment of whether its contractual cash flows are solely payments of principal and interest. Please describe how the portfolio is managed (including whether assets are held to collect, managed both to collect and sell, or managed on another basis). What are the bond’s contractual cash-flow terms, including any features that could change the timing or amount of principal or interest? Until those facts are assessed, I cannot conclude amortised cost, debt FVOCI or FVTPL.';
      ruleIds = ['IFRS9_DEBT_CLASSIFICATION'];
      missingFacts = ['business model for managing the bond', 'contractual cash-flow terms and SPPI assessment'];
      missingFields = [
        { fieldKey: 'businessModel', fieldName: 'Business model', prompt: 'Please describe the business model used to manage this bond.', whyNeeded: 'SFRS(I) 9 classification depends in part on the business model for managing the financial asset.' },
        { fieldKey: 'contractualCashFlows', fieldName: 'Contractual cash-flow characteristics', prompt: 'What are the bond’s contractual cash-flow terms, including any non-basic lending features?', whyNeeded: 'The contractual cash flows must be assessed against the solely-payments-of-principal-and-interest condition.' }
      ];
      break;
    case 'initial-measurement': {
      const amounts = extractInitialMeasurementAmounts(query);
      if (!amounts) return undefined;
      const totalCents = amounts.fairValueCents + amounts.costCents;
      if (!Number.isSafeInteger(totalCents)) return undefined;
      const total = formatSgdCents(totalCents);
      body = 'For this financial asset, which is outside FVTPL and the paragraph 5.1.3 trade-receivable exception, initial measurement is fair value plus directly attributable transaction costs. **Initial carrying amount: SGD ' +
        total + '** (SGD ' + formatSgdCents(amounts.fairValueCents) + ' + SGD ' + formatSgdCents(amounts.costCents) +
        '). The supplied facts do not establish a counterparty or settlement status, so they are not enough to prepare journal entries.';
      ruleIds = ['IFRS9_INITIAL_MEASUREMENT'];
      break;
    }
    case 'amendment-effective-date':
      body = 'For an annual reporting period beginning on 1 January 2025, the 2024 classification and measurement amendments to SFRS(I) 9 and SFRS(I) 7 are **not mandatory yet**. ACRA’s announcement states that they are effective for annual reporting periods beginning on or after **1 January 2026**.';
      ruleIds = ['SFRSI9_2026_CLASSIFICATION_AMENDMENTS'];
      break;
    case 'equity-fvoci':
      body = 'On the stated facts, the investment is not held for trading or contingent consideration and the irrevocable FVOCI election was made at initial recognition. Fair value changes are presented in OCI. On disposal, the cumulative OCI gain or loss is **not subsequently reclassified (recycled) to profit or loss**; a transfer within equity may be made.';
      ruleIds = ['IFRS9_EQUITY_CLASSIFICATION'];
      break;
    case 'ecl':
      body = 'Because this non-POCI financial asset is measured at amortised cost and credit risk has not increased significantly since initial recognition, the general impairment approach uses **12-month expected credit losses (ECL)** for the loss allowance. The amount cannot be calculated from the information supplied. Please provide the exposure and probability-weighted expected cash-shortfall estimates, together with the information needed to reflect timing and reasonable, supportable scenarios.';
      ruleIds = ['IFRS9_ECL_GENERAL'];
      missingFacts = ['exposure', 'probability-weighted expected cash shortfalls', 'timing and scenario estimates'];
      missingFields = [{ fieldKey: 'eclMeasurementInputs', fieldName: 'ECL measurement inputs', prompt: 'Please provide exposure and probability-weighted expected cash-shortfall estimates, including relevant timing assumptions.', whyNeeded: 'The ECL horizon can be identified, but a monetary amount requires measurement inputs and reasonable, supportable scenarios.' }];
      break;
  }

  const citations = [...ruleIds.map(id => formatRuleCitation(id, topic)), formatAdoptionCitation()];
  const scenarioState: AccountingScenarioState = {
    scenarioType: 'SFRSI9_KNOWLEDGE_ADVISORY',
    rawQuery: query,
    transactionTitle: 'SFRS(I) 9 Knowledge Advisory',
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    directGroups: [],
    isComplete: missingFields.length === 0,
    missingFields,
    ...(missingFacts.length ? { missingFacts } : {}),
    queryIntent: 'STATUTORY_ADVISORY',
    primaryDomain: 'ACCOUNTING_SFRS',
    accountingTreatmentSummary: body
  };

  return {
    messageText: '### SFRS(I) 9 — ' + titleFor(topic) + '\n\n' + body + '\n\n### Sources\n' + citations.join('\n'),
    scenarioState,
    ...(missingFields.length ? { clarifications: missingFields } : {})
  };
}

function formatRuleCitation(ruleId: string, topic: AnswerTopic): string {
  const rule = STANDARDS_REPOSITORY[ruleId];
  const paragraphs: Record<AnswerTopic, string[]> = {
    'debt-amortised-cost': ['4.1.2'],
    'debt-fvoci': ['4.1.2A'],
    'debt-missing-facts': ['4.1.1'],
    'initial-measurement': ['5.1.1'],
    'amendment-effective-date': [],
    'equity-fvoci': ['5.7.5', 'B5.7.1'],
    ecl: ['5.5.5', '5.5.17']
  };
  const targets = paragraphs[topic];
  const labels = targets.length
    ? targets.map(paragraph => '[SFRS(I) 9 §' + paragraph + ' — ' + rule.standardTitle + '](' + rule.officialSourceUrl + ')')
    : ['[SFRS(I) 9 — ' + rule.standardTitle + '](' + rule.officialSourceUrl + ')'];
  return labels.join(' · ');
}

function formatAdoptionCitation(): string {
  const rule = STANDARDS_REPOSITORY.SFRSI9_ADOPTION;
  return '[SFRS(I) 9 Singapore framework — ACRA](' + rule.officialSourceUrl + ')';
}

function titleFor(topic: AnswerTopic): string {
  const titles: Record<AnswerTopic, string> = {
    'debt-amortised-cost': 'Debt asset classification',
    'debt-fvoci': 'Debt asset classification',
    'debt-missing-facts': 'Debt asset classification',
    'initial-measurement': 'Initial measurement',
    'amendment-effective-date': '2024 amendments effective date',
    'equity-fvoci': 'Equity FVOCI election',
    ecl: 'Expected credit losses'
  };
  return titles[topic];
}

function extractInitialMeasurementAmounts(query: string): { fairValueCents: number; costCents: number } | undefined {
  const fairValue = query.match(/\bfair value\b[^.]{0,50}?\b(?:is|of)\s*(?:SGD\s*)?([\d,]+(?:\.\d{1,2})?)(?![\d.])/i);
  const costs = query.match(/\b(?:directly attributable\s+)?(?:acquisition\s+)?transaction costs?\b[^.]{0,60}?\b(?:are|is|of|amounts? to)\s*(?:SGD\s*)?([\d,]+(?:\.\d{1,2})?)(?![\d.])/i);
  const fairValueCents = fairValue ? parseCents(fairValue[1]) : undefined;
  const costCents = costs ? parseCents(costs[1]) : undefined;
  return fairValueCents !== undefined && costCents !== undefined ? { fairValueCents, costCents } : undefined;
}

function parseCents(value: string): number | undefined {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, fraction = ''] = value.replace(/,/g, '').split('.');
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction)) return undefined;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : undefined;
}

function formatSgdCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return dollars.toLocaleString('en-SG') + (remainder ? '.' + String(remainder).padStart(2, '0') : '');
}
