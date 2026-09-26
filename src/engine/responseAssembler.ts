import type {
  AccountingStandard,
  AccountingScenarioState,
  JournalEntryGroup,
  JournalLine,
  StandardCitation,
  StatutoryAdvisoryInfo,
  ExplicitAssumption,
  JournalAuthorityStatus
} from '../types/accounting';
import type { GroundedReasoningContext, GroundingEvidenceTrace, SourceMapFallbackTrace } from '../services/groundingContextBuilder';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { defaultCitationVerifier } from '../verification/citationVerifier';
import { appendStatutorySourceFooter, getSafeOfficialUrl } from '../utils/statutoryLinkResolver';
import { formatSingaporeDate } from '../utils/dateUtils';
import {
  extractAccountingContext,
  calculateAccountingDelta,
  validateAccountingStateTransition,
  commitAccountingEvent
} from '../services/conversationAccountingState';
import { buildAccountingMeasurementProjection } from './projectionBuilder';
import { hasSemanticRoutingConflict } from '../services/semanticScenarioResolver';

function buildResponseGroundingEvidenceTrace(context: GroundedReasoningContext): GroundingEvidenceTrace[] {
  const records = [...context.primaryEvidence, ...context.officialGuidance, ...context.curatedSummaries];
  return records.map(record => {
    const metadata = record as unknown as { groundingEligible?: boolean; recordRole?: string };
    const liveCandidate = metadata.recordRole === 'DISCOVERED_EVIDENCE' &&
      record.provenance === 'LIVE_EXTERNAL' && record.lifecycleState === 'CANDIDATE' &&
      record.verificationMethod === 'LIVE_OFFICIAL_TOPIC_VERIFIED';
    return {
      recordId: record.id,
      lifecycleState: record.lifecycleState,
      groundingEligible: metadata.groundingEligible !== false && metadata.recordRole !== 'SOURCE_MAP_POINTER',
      provenance: record.provenance,
      officialSourceUrl: record.officialSourceUrl,
      ...(liveCandidate ? {
        fetchStatus: 'SUCCESS',
        finalUrl: record.officialSourceUrl,
        topicMatched: true,
        titleMatched: true,
        contentMatched: true
      } : {}),
      candidateOnly: record.lifecycleState === 'CANDIDATE'
    };
  });
}

export interface CompactStatutoryDecision {
  directAnswer?: string;
  keyRules?: string[];
  caveats?: string[];
  statuteReferences?: Array<{
    standard?: string;
    paragraph?: string;
    authority?: string;
    officialSourceUrl?: string;
  }>;
}

export interface CompactAccountingDecision {
  treatment?: string;
  decision?: string;
  reasoning?: string;
  singaporeTaxImpact?: string;
  assumptions?: Array<{ field: string; assumedValue: string | number; basis?: string; materiality?: 'HIGH' | 'MEDIUM' | 'LOW' }>;
  missingFacts?: string[];
  citations?: Array<{ standard?: string; paragraph?: string; authority?: string; officialSourceUrl?: string; text?: string; title?: string }>;
}

export interface CompactJournalDecision {
  transactionNature?: string;
  treatment?: string;
  requiredAccounts?: Array<{
    accountName: string;
    category: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
    debitCredit: 'DEBIT' | 'CREDIT';
    rationale?: string;
  }>;
  bifurcateFx?: boolean;
  tradeDiscountHandling?: string;
  assumptions?: Array<{ field: string; assumedValue: string | number; basis?: string; materiality?: 'HIGH' | 'MEDIUM' | 'LOW' }>;
  missingFacts?: string[];
  citations?: Array<{ standard?: string; paragraph?: string; authority?: string; officialSourceUrl?: string; text?: string; title?: string }>;
}

export type CompactAIDecision = CompactStatutoryDecision & CompactAccountingDecision & CompactJournalDecision & {
  messageText?: string;
  scenarioType?: string;
  transactionTitle?: string;
  keyParameters?: any[];
  directGroups?: any[];
  statutoryAdvisory?: any[];
  uncertaintyDisclaimer?: string;
};

export function isMealInputTaxQuery(userInput: string): boolean {
  return /\b(?:gst|input\s+tax|input\s+gst)\b/i.test(userInput) &&
    /\b(?:meals?|lunch(?:eon)?|dining|entertainment)\b/i.test(userInput) &&
    /\b(?:claim\w*|recover\w*|input\s+tax)\b/i.test(userInput);
}

function isUnresolvedMealInputTaxFact(fact: string): boolean {
  return /\b(?:customer|supplier)\s+gst\s+registration status\b/i.test(fact) ||
    /\bgst\s+registration status\b/i.test(fact) ||
    /\bbusiness or private use\b/i.test(fact) ||
    /\bsupporting tax invoice\b/i.test(fact) ||
    /\bbusiness purpose of (?:the )?(?:meal|entertainment)\b/i.test(fact) ||
    /\bpurpose of (?:the )?(?:meal|entertainment)\b/i.test(fact) ||
    /\bwho attended\b|\battendees?\b|\brelationship to (?:the )?company\b/i.test(fact);
}

export function hasUnresolvedMealInputTaxEligibility(userInput: string, missingFacts: string[] = []): boolean {
  return isMealInputTaxQuery(userInput) && missingFacts.some(isUnresolvedMealInputTaxFact);
}

/**
 * Replace only a positive, unconditional meal/entertainment input-GST claim
 * with a fact-requesting response. Conditional answers remain untouched.
 */
export function guardUnconditionalMealInputTaxClaim(
  responseText: string,
  userInput: string,
  groundedContext: Pick<GroundedReasoningContext, 'primaryEvidence' | 'officialGuidance' | 'curatedSummaries' | 'sourceMapFallbackTrace'>,
  missingFacts: string[] = []
): string {
  if (!hasUnresolvedMealInputTaxEligibility(userInput, missingFacts)) return responseText;

  const assertiveClaim = /\b(?:gst|input\s+tax|input\s+gst)\b[^.!?\n]{0,120}\b(?:is|are)\s+(?:(?:always|universally|automatically)\s+)?(?:fully\s+)?(?:claimable|recoverable)\b|\b(?:gst|input\s+tax|input\s+gst)\b[^.!?\n]{0,120}\b(?:can be|are|is)\s+(?:(?:always|universally|automatically)\s+)?(?:claimed|recovered)\b/i;
  const allInputsClaimable = /\b(?:all|every|each)\b[^.!?\n]{0,120}\b(?:gst|input\s+tax|input\s+gst)\b[^.!?\n]{0,120}\b(?:claimable|recoverable|claimed|recovered)\b/i;
  const canAlwaysClaim = /\b(?:you|we|the company|a business|the business|taxpayers?)\s+can\s+(?:always\s+)?(?:claim|recover)\b[^.!?\n]{0,120}\b(?:gst|input\s+tax|input\s+gst)\b/i;
  const universalNegativeClaim = /\b(?:gst|input\s+tax|input\s+gst)\b[^.!?\n]{0,120}\b(?:is|are)\s+(?:never|not ever)\s+(?:fully\s+)?(?:claimable|recoverable|claimed|recovered)\b|\b(?:gst|input\s+tax|input\s+gst)\b[^.!?\n]{0,120}\bcan\s+never\s+(?:be\s+)?(?:claimed|recovered|claimable|recoverable)\b|\b(?:you|we|the company|a business|the business|taxpayers?)\s+can\s+never\s+(?:claim|recover)\b[^.!?\n]{0,120}\b(?:gst|input\s+tax|input\s+gst)\b|\bno\b[^.!?\n]{0,100}\b(?:gst|input\s+tax|input\s+gst)\b[^.!?\n]{0,100}\b(?:claimable|recoverable|claimed|recovered)\b/i;
  const broadMealNegativeClaim = /\b(?:input\s+tax|input\s+gst|gst)\b[^.!?\n]{0,200}\b(?:disallowed|blocked|not\s+(?:claimable|recoverable|allowed|allowable)|ineligible|restricted)\b/i;
  const claimPatterns = [assertiveClaim, allInputsClaimable, canAlwaysClaim, universalNegativeClaim, broadMealNegativeClaim];
  const findClaim = (text: string): RegExpExecArray | undefined => {
    const matches = claimPatterns
      .map(pattern => pattern.exec(text))
      .filter((match): match is RegExpExecArray => match !== null)
      .sort((left, right) => left.index - right.index);
    return matches[0];
  };
  const isUnqualifiedClaim = (sentence: string): boolean => {
    const notAllCaution = /\bnot\s+(?:all|every|each)\b[^.!?\n]{0,120}\b(?:gst|input\s+tax|input\s+gst)\b[^.!?\n]{0,120}\b(?:claimable|recoverable|claimed|recovered)\b/i.test(sentence);
    if (notAllCaution) return false;
    const hasMealTaxScope = /\b(?:gst|input\s+tax|input\s+gst)\b/i.test(sentence) &&
      /\b(?:business\s+entertainment|entertainment|meals?|lunch(?:eon)?|dining)\b/i.test(sentence);
    const negativeMealCostIsSpecific = /\b(?:input\s+tax|input\s+gst|gst)\b[^.!?\n]{0,100}\b(?:on|for)\b[^.!?\n]{0,60}\b(?:private|personal|non[- ]business|without (?:a )?business purpose|no business purpose)\b[^.!?\n]{0,50}\b(?:meal|lunch(?:eon)?|dining|entertainment|use|cost|expense)\b|\b(?:input\s+tax|input\s+gst|gst)\b[^.!?\n]{0,100}\b(?:meal|lunch(?:eon)?|dining|entertainment|use|cost|expense)\b[^.!?\n]{0,60}\b(?:private|personal|non[- ]business|without (?:a )?business purpose|no business purpose)\b/i.test(sentence);
    const broadNegative = hasMealTaxScope && broadMealNegativeClaim.test(sentence);
    if (broadNegative && !negativeMealCostIsSpecific) {
      const generalNegative = /\b(?:generally|usually|typically|normally|ordinarily|as a general rule)\b[^.!?\n]{0,60}\b(?:disallowed|blocked|not\s+(?:claimable|recoverable|allowed|allowable)|ineligible|restricted)\b/i.test(sentence);
      const hasSpecificRequirementCondition = /\b(?:if|when|where|provided(?: that)?|subject to|only if|only where|unless|to the extent|based on)\b[^.!?\n]{0,120}\b(?:ordinary input.tax|conditions?|requirements?|valid tax invoice|business purpose|taxable supplies|registered for gst)\b/i.test(sentence);
      if (generalNegative || !hasSpecificRequirementCondition) return true;
    }
    const absoluteNegative = universalNegativeClaim.test(sentence);
    const positive = assertiveClaim.test(sentence) || allInputsClaimable.test(sentence) || canAlwaysClaim.test(sentence);
    if (!positive && !absoluteNegative) return false;
    // Negation must attach to the claim predicate itself. A later clause such
    // as “supporting invoices are not required” does not cancel “GST is
    // claimable”; it makes that unsupported universal assertion more serious.
    const negatedClaimPredicate = /\b(?:is|are|be|being)\s+(?:(?:always|universally|automatically)\s+)?(?:not|never)\s+(?:(?:always|universally|automatically)\s+)?(?:fully\s+)?(?:claimable|recoverable)\b|\b(?:cannot|can['’]t|must not|should not)\s+(?:be\s+)?(?:claimed|recovered)\b/i.test(sentence);
    if (negatedClaimPredicate && !absoluteNegative) return false;
    const sentenceDisregardsFacts = /\b(?:regardless of|irrespective of|without regard to)\s+(?:the )?(?:purpose|records|documentation|business use|registration)\b/i.test(sentence) ||
      /\bwithout\s+(?:any\s+)?(?:records?|documentation|valid tax invoice|business purpose)\b/i.test(sentence) ||
      /\b(?:despite|even if)\b[^.!?\n]{0,80}\bno\s+(?:records?|documentation|valid tax invoice|business purpose)\b/i.test(sentence);
    const sentenceIsConditional = /\b(?:may|might|could)\s+be\s+(?:claimable|claimed|recoverable|recovered)\b|\b(?:if|when|where|provided(?: that)?|subject to|only if|only where|unless|to the extent|based on)\b[^.!?\n]{0,120}\b(?:ordinary input.tax|conditions?|requirements?|valid tax invoice|business purpose|taxable supplies|registered for gst)\b/i.test(sentence);
    return sentenceDisregardsFacts || !sentenceIsConditional;
  };

  const splitResponseText = (text: string): string[] => {
    const segments: string[] = [];
    let segmentStart = 0;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === '\r' || character === '\n') {
        if (index > segmentStart) segments.push(text.slice(segmentStart, index));
        const lineBreakEnd = character === '\r' && text[index + 1] === '\n' ? index + 2 : index + 1;
        segments.push(text.slice(index, lineBreakEnd));
        index = lineBreakEnd - 1;
        segmentStart = lineBreakEnd;
        continue;
      }
      if (!'.!?'.includes(character)) continue;
      const isDecimalPoint = character === '.' && /\d/.test(text[index - 1] || '') && /\d/.test(text[index + 1] || '');
      const isSentenceEnd = !isDecimalPoint && (index + 1 === text.length || /\s/.test(text[index + 1]));
      if (!isSentenceEnd) continue;
      segments.push(text.slice(segmentStart, index + 1));
      segmentStart = index + 1;
    }
    if (segmentStart < text.length) segments.push(text.slice(segmentStart));
    return segments;
  };

  const accountingContext = /\b(?:dr|cr|debit|credit|journal|entry|accounting|expense|cash|bank|paid|payment|record|recorded|booking|balance|sgd|amount)\b/i;
  const offendingSentences = splitResponseText(responseText).filter(segment => isUnqualifiedClaim(segment));
  if (offendingSentences.length === 0) return responseText;

  const records = [
    ...groundedContext.primaryEvidence,
    ...groundedContext.officialGuidance,
    ...groundedContext.curatedSummaries
  ];
  const candidateInputTaxPage = groundedContext.sourceMapFallbackTrace?.candidateOnly === true &&
    groundedContext.sourceMapFallbackTrace.sourceMapIds.includes('IRAS_GST_INPUT_TAX_SOURCE_MAP');
  const evidenceStatus = candidateInputTaxPage
    ? 'The retrieved IRAS input-tax page is candidate evidence pending review; it does not establish this case’s eligibility.'
    : records.length === 0
      ? 'No authoritative IRAS evidence was retrieved to establish this case’s eligibility.'
      : 'The available evidence does not establish this case’s eligibility without the facts below.';
  const requiredFacts = missingFacts.filter(isUnresolvedMealInputTaxFact);
  const factRequest = requiredFacts.length > 0
    ? requiredFacts.join('; ')
    : 'business purpose, attendees and their relationship to the company, GST registration and use, and a valid tax invoice';

  const replacement = `Do not assume input GST on customer or supplier meals is always claimable. ${evidenceStatus} Before assessing a claim, confirm: ${factRequest}.`;
  const replaceClaimClause = (sentence: string): string => {
    if (!isUnqualifiedClaim(sentence)) return sentence;
    const claim = findClaim(sentence);
    if (!claim) return sentence;

    let prefixBoundaryIndex = 0;
    let prefixBoundary: 'comma' | 'semicolon' | 'colon' | 'conjunction' | undefined;
    const beforeClaim = sentence.slice(0, claim.index);
    const boundaryPattern = /;|,|:|\b(?:and|but)\b/gi;
    for (const boundary of beforeClaim.matchAll(boundaryPattern)) {
      const kind = boundary[0] === ';' ? 'semicolon'
        : boundary[0] === ',' ? 'comma'
          : boundary[0] === ':' ? 'colon'
            : 'conjunction';
      if (kind === 'conjunction' && !accountingContext.test(beforeClaim.slice(0, boundary.index))) continue;
      prefixBoundaryIndex = boundary.index;
      prefixBoundary = kind;
    }

    const prefixCandidate = (prefixBoundary ? sentence.slice(0, prefixBoundaryIndex) : beforeClaim).trim();
    const preservePrefix = Boolean(prefixCandidate) && (Boolean(prefixBoundary) || accountingContext.test(prefixCandidate));
    const prefix = preservePrefix ? prefixCandidate.replace(/[\s,;:]+$/g, '') : '';

    const afterClaim = sentence.slice(claim.index + claim[0].length);
    let suffix = '';
    const semicolonBoundary = /;/.exec(afterClaim);
    if (semicolonBoundary) {
      suffix = afterClaim.slice(semicolonBoundary.index + semicolonBoundary[0].length).trim();
    } else {
      const suffixBoundaryPattern = /,\s*(?:and|but)\s+|\s+(?:and|but)\s+/gi;
      for (const boundary of afterClaim.matchAll(suffixBoundaryPattern)) {
        const candidate = afterClaim.slice(boundary.index + boundary[0].length).trim();
        if (accountingContext.test(candidate)) suffix = candidate;
      }
    }
    suffix = suffix.replace(/^[,;:]\s*/, '');
    if (suffix) suffix = suffix[0].toUpperCase() + suffix.slice(1);

    const prefixHasAccountingContent = accountingContext.test(prefix);
    const guardedPrefix = prefix
      ? `${prefix}${prefixHasAccountingContent ? '.' : prefixBoundary === 'colon' ? ':' : ','} `
      : '';
    const guardedSuffix = suffix
      ? `${replacement} ${/[.!?]$/.test(replacement) ? '' : '.'}${suffix}`
      : replacement;
    return `${guardedPrefix}${guardedSuffix}`;
  };

  return splitResponseText(responseText).map(replaceClaimClause).join('');
}

/**
 * Deterministic Response Assembler
 * Takes a compact AI decision + deterministic engine state and deterministically
 * constructs the full, verified, audit-ready response and scenario state.
 */
export function assembleDeterministicResponse(
  compact: CompactAIDecision,
  userInputOrScenario: string | AccountingScenarioState | null,
  currentScenarioOrInput: AccountingScenarioState | string | null,
  groundedContext: GroundedReasoningContext,
  deterministicScenario: AccountingScenarioState | null,
  standard: AccountingStandard
): {
  messageText: string;
  scenarioState: AccountingScenarioState;
  sourceMapFallbackTrace?: SourceMapFallbackTrace;
  groundingEvidence?: GroundingEvidenceTrace[];
} {
  const userInput = typeof userInputOrScenario === 'string'
    ? userInputOrScenario
    : (typeof currentScenarioOrInput === 'string' ? currentScenarioOrInput : (deterministicScenario?.rawQuery || ''));

  const stdLabel = standard === 'SFRS_I' ? 'SFRS(I)' : 'IFRS';
  const queryMode = groundedContext.classification.intent;
  const retrievedEvidenceScope: AuthoritativeSourceRecord[] = [
    ...groundedContext.primaryEvidence,
    ...groundedContext.officialGuidance,
    ...groundedContext.curatedSummaries
  ];

  // 1. Determine Authority Status & Fixture Recognition
  const isRecognizedDeterministicFixture = Boolean(
    deterministicScenario &&
    deterministicScenario.scenarioType !== 'UNRECOGNIZED'
  );

  const isHypotheticalQuery = Boolean(
    groundedContext.semanticUnderstanding?.isHypothetical ||
    groundedContext.semanticUnderstanding?.followUpAnalysis?.isHypothetical
  );

  const semanticRoutingConflict = hasSemanticRoutingConflict(deterministicScenario, groundedContext.semanticUnderstanding);
  const hasAuthoritativeDeterministicEntries = Boolean(
    isRecognizedDeterministicFixture &&
    deterministicScenario!.directGroups &&
    deterministicScenario!.directGroups.length > 0 &&
    !isHypotheticalQuery &&
    !semanticRoutingConflict
  );

  const hasMissingFacts = Boolean(
    (groundedContext.missingFacts && groundedContext.missingFacts.length > 0) ||
    (compact.missingFacts && compact.missingFacts.length > 0)
  );

  const authorityStatus: JournalAuthorityStatus = hasMissingFacts
    ? 'CONDITIONAL'
    : (hasAuthoritativeDeterministicEntries
        ? (deterministicScenario?.authorityStatus || 'DETERMINISTIC')
        : 'AI_PROPOSED');

  const resolvedScenarioType = isRecognizedDeterministicFixture
    ? deterministicScenario!.scenarioType
    : (compact.scenarioType || (queryMode === 'STATUTORY_ADVISORY' ? 'SINGAPORE_STATUTORY_ADVISORY' : 'UNIVERSAL'));

  const resolvedTransactionTitle = isRecognizedDeterministicFixture
    ? (deterministicScenario?.transactionTitle || 'Accounting & Statutory Advisory')
    : (compact.transactionNature || compact.transactionTitle || (groundedContext.semanticUnderstanding?.transactionType ? groundedContext.semanticUnderstanding.transactionType.replace(/_/g, ' ').toUpperCase() : 'Accounting & Statutory Advisory'));

  // 2. Assemble Citations with Structural Verification
  const rawCitations = [
    ...(compact.citations || []),
    ...(compact.statuteReferences || []),
    ...(deterministicScenario?.directGroups?.flatMap(g => g.citations) || [])
  ];

  const verifiedCitations: StandardCitation[] = [];
  const seenCites = new Set<string>();

  for (const cite of rawCitations) {
    const key = `${cite.standard || ''}_${cite.paragraph || ''}`.toLowerCase();
    if (!key || seenCites.has(key)) continue;
    seenCites.add(key);

    const verification = defaultCitationVerifier.verifyCitation(
      cite as StandardCitation,
      cite.authority as any,
      retrievedEvidenceScope
    );
    if (!verification.isValid || !verification.matchedRecord?.officialSourceUrl) continue;

    const safeUrl = verification.matchedRecord.officialSourceUrl;

    verifiedCitations.push({
      standard: cite.standard || '',
      paragraph: cite.paragraph || '',
      title: (cite as any).title || verification.matchedRecord?.documentTitle || `${cite.standard} ${cite.paragraph}`,
      text: (cite as any).text || verification.matchedRecord?.sourceText || '',
      authority: (verification.matchedRecord.authority || 'SSO') as any,
      sourcePublisher: verification.matchedRecord.sourcePublisher,
      officialSourceUrl: safeUrl,
      verificationStatus: verification.status,
      isAuthoritativePrimarySource: verification.isAuthoritativePrimarySource,
      isStructurallyValid: verification.isStructurallyValid,
      verificationReason: verification.reason,
      structuralVerificationOnly: true
    });
  }

  // 3. Assemble Direct Groups & Journal Entries
  let directGroups: JournalEntryGroup[] = [];
  let invalidJournalProposalReason: string | undefined;

  const followUp = groundedContext.semanticUnderstanding?.followUpAnalysis;
  const isSettlementFollowUp = Boolean(
    followUp && (followUp.eventType === 'settlement' || followUp.eventType === 'partial_settlement')
  );
  const currentScenario = typeof userInputOrScenario === 'object' && userInputOrScenario !== null
    ? (userInputOrScenario as AccountingScenarioState)
    : (typeof currentScenarioOrInput === 'object' && currentScenarioOrInput !== null ? (currentScenarioOrInput as AccountingScenarioState) : null);

  let committedDirectGroups: JournalEntryGroup[] | undefined = currentScenario?.committedDirectGroups;
  let projectedGroups: JournalEntryGroup[] | undefined = undefined;

  const priorCommittedGroups = (currentScenario?.committedDirectGroups && currentScenario.committedDirectGroups.length > 0)
    ? [...currentScenario.committedDirectGroups]
    : (currentScenario?.directGroups ? currentScenario.directGroups.filter(g => !g.isHypothetical) : []);
  const settlementCurrency = groundedContext.semanticUnderstanding?.currency?.value || currentScenario?.functionalCurrency || 'SGD';
  const settlementDelta = isSettlementFollowUp
    ? calculateAccountingDelta(extractAccountingContext(currentScenario), followUp!, settlementCurrency)
    : null;

  // Never let a model fill a settlement gap with a generic journal.  A
  // settlement is permissible only when the committed state contains one
  // resolvable outstanding balance.  This check deliberately happens before
  // accepting either deterministic fallback groups or AI-supplied groups.
  if (isSettlementFollowUp) {
    if (!settlementDelta?.resultingAccountingEvent) {
      const baseState = currentScenario || deterministicScenario;
      const clarification = 'I cannot post a settlement journal because the payment does not match one outstanding balance, or it exceeds that balance. Please identify the original transaction, confirm the settlement amount, and explain any excess.';
      return {
        messageText: `### Clarification Required\n\n${clarification}`,
        scenarioState: {
          ...(baseState || {
            scenarioType: 'UNRECOGNIZED',
            transactionTitle: 'Settlement Requires an Outstanding Balance',
            functionalCurrency: settlementCurrency,
            transactionCurrency: settlementCurrency
          }),
          rawQuery: userInput,
          authorityStatus: 'CONDITIONAL',
          directGroups: [],
          committedDirectGroups: priorCommittedGroups,
          projectedGroups: undefined,
          isComplete: false,
          missingFields: [{
            fieldKey: 'settlementTarget',
            fieldName: 'Outstanding balance being settled',
            prompt: clarification,
            whyNeeded: 'A settlement journal must derecognize a specific balance from committed accounting history.'
          }]
        }
      };
    }
  }

  if (hasAuthoritativeDeterministicEntries && !isSettlementFollowUp) {
    // Deterministic engine calculations strictly govern
    directGroups = deterministicScenario!.directGroups!.map(grp => ({
      ...grp,
      authorityStatus: grp.authorityStatus || authorityStatus
    }));
    committedDirectGroups = directGroups.filter(g => !g.isHypothetical);
  } else if (
    followUp &&
    (followUp.eventType === 'settlement' || followUp.eventType === 'partial_settlement')
  ) {
    const delta = settlementDelta;
    if (delta && delta.resultingAccountingEvent) {
      const isHypo = Boolean(delta.isHypothetical);
      const totalDebit = Math.round(delta.journalLines.reduce((sum, line) => sum + line.debit, 0) * 100) / 100;
      const totalCredit = Math.round(delta.journalLines.reduce((sum, line) => sum + line.credit, 0) * 100) / 100;
      const settlementGroup: JournalEntryGroup = {
        id: `grp-followup-settlement-${priorCommittedGroups.length + 1}`,
        transactionId: delta.resultingAccountingEvent.transactionId,
        targetTransactionId: delta.resultingAccountingEvent.targetTransactionId,
        isHypothetical: isHypo,
        eventDate: formatSingaporeDate(new Date()),
        title: `${isHypo ? 'Hypothetical ' : ''}Settlement of ${delta.balanceUpdates[0].accountName}`,
        summary: delta.explanation,
        lines: delta.journalLines,
        totalDebit,
        totalCredit,
        isBalanced: totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01,
        citations: verifiedCitations,
        rationalePoints: [delta.explanation],
        authorityStatus: 'AI_PROPOSED'
      };

      if (isHypo) {
        committedDirectGroups = priorCommittedGroups;
        projectedGroups = [settlementGroup];
        directGroups = [...priorCommittedGroups, settlementGroup];
      } else {
        committedDirectGroups = [...priorCommittedGroups, settlementGroup];
        projectedGroups = undefined;
        directGroups = committedDirectGroups;
      }
    }
  } else if (
    followUp &&
    (followUp.eventType === 'hypothetical_branch' ||
     followUp.eventType === 'reclassification' ||
     followUp.eventType === 'policy_election')
  ) {
    const convContext = extractAccountingContext(currentScenario);
    const targetBasis = followUp.targetMeasurementBasis || 'UNKNOWN';
    const proj = buildAccountingMeasurementProjection({
      committedContext: convContext,
      followUpAnalysis: followUp,
      requestedBasis: targetBasis
    });

    if (proj.success && proj.projectedGroups.length > 0) {
      committedDirectGroups = priorCommittedGroups;
      projectedGroups = proj.projectedGroups;
      directGroups = proj.projectedGroups;
    }
  } else if (compact.directGroups && compact.directGroups.length > 0) {
    // Pre-computed or raw direct groups
    directGroups = compact.directGroups.map((grp: any, idx: number) => {
      const lines = (grp.lines || []).map((l: any, lIdx: number) => ({
        id: l.id || `l-${idx}-${lIdx}`,
        accountCode: l.accountCode || '1000',
        accountName: l.accountName || 'Account',
        category: l.category || 'ASSET',
        debit: typeof l.debit === 'number' ? Math.round(l.debit * 100) / 100 : 0,
        credit: typeof l.credit === 'number' ? Math.round(l.credit * 100) / 100 : 0,
        foreignCurrency: l.foreignCurrency,
        foreignDebit: l.foreignDebit,
        foreignCredit: l.foreignCredit,
        exchangeRate: l.exchangeRate,
        lineExplanation: l.lineExplanation || ''
      }));

      // Trade discount guardrail: Deducted directly from asset purchase cost (SFRS(I) 1-16 §16(a))
      const tradeDiscountExpenseIdx = lines.findIndex(
        (l: any) => l.accountName.toLowerCase().includes('trade discount') && l.category === 'EXPENSE'
      );
      if (tradeDiscountExpenseIdx !== -1) {
        lines.splice(tradeDiscountExpenseIdx, 1);
      }

      const totalDebit = Math.round(lines.reduce((s: number, l: any) => s + l.debit, 0) * 100) / 100;
      const totalCredit = Math.round(lines.reduce((s: number, l: any) => s + l.credit, 0) * 100) / 100;

      return {
        id: grp.id || `grp-${idx + 1}`,
        eventDate: formatSingaporeDate(grp.eventDate || new Date()),
        title: grp.title || `Entry Group ${idx + 1}`,
        summary: grp.summary || '',
        lines,
        totalDebit,
        totalCredit,
        isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
        citations: verifiedCitations,
        rationalePoints: grp.rationalePoints || [],
        authorityStatus
      };
    });
  } else if (compact.requiredAccounts && compact.requiredAccounts.length > 0) {
    const debitsCount = compact.requiredAccounts.filter(account => account.debitCredit === 'DEBIT').length;
    const creditsCount = compact.requiredAccounts.filter(account => account.debitCredit === 'CREDIT').length;
    if (debitsCount === 0 || creditsCount === 0) {
      invalidJournalProposalReason = 'The proposed journal does not contain both a debit and a credit. Please identify what was received or prepaid and the account paid.';
    } else {
    // Amounts for journal lines can ONLY come from scenario-specific structured facts/formulas
    // in deterministicScenario. Arbitrary numbers (dates, quantities, terms, percentages) from user text
    // MUST NEVER be extracted via regex into journal amounts.
    let knownAmount: number | undefined = undefined;
    if (isRecognizedDeterministicFixture && deterministicScenario?.isComplete && deterministicScenario?.amount && deterministicScenario.amount > 0) {
      knownAmount = deterministicScenario.amount;
    } else if (groundedContext.semanticUnderstanding?.amount && groundedContext.semanticUnderstanding.amount > 0) {
      knownAmount = groundedContext.semanticUnderstanding.amount;
    }

    const isUnvaluedOrNovel = !knownAmount || userInput.toLowerCase().includes('barter') || userInput.toLowerCase().includes('exchange');

    if (isUnvaluedOrNovel) {
      // Missing or unstructured monetary amounts: NEVER manufacture numbers from raw text.
      const lines: JournalLine[] = compact.requiredAccounts.map((acc, aIdx) => ({
        id: `line-ai-${aIdx + 1}`,
        accountCode: acc.category === 'ASSET' ? '1500' : acc.category === 'LIABILITY' ? '2000' : acc.category === 'EQUITY' ? '3000' : acc.category === 'EXPENSE' ? '5000' : '4000',
        accountName: acc.accountName,
        category: acc.category,
        debit: 0,
        credit: 0,
        lineExplanation: `${acc.rationale || `Recognition of ${acc.accountName}`} — [Valuation pending determination]`
      }));

      directGroups = [{
        id: 'grp-ai-proposed-unvalued-1',
        eventDate: formatSingaporeDate(new Date()),
        title: compact.transactionNature || 'AI-Proposed Double Entry (Pending Valuation)',
        summary: compact.treatment || 'Illustrative journal proposal with uncalculated monetary amounts',
        lines,
        totalDebit: 0,
        totalCredit: 0,
        isBalanced: false, // Cannot be balanced without valuations
        citations: verifiedCitations,
        rationalePoints: [
          compact.treatment || 'Accounting treatment proposed by AI reasoning',
          '⚠️ AMOUNTS PENDING: Transaction amounts/fair values were not specified in query. Journal structure is proposed by AI; monetary amounts must be determined before posting.',
          'Authority Status: CONDITIONAL (Subject to independent valuation and audit review)'
        ],
        authorityStatus: 'CONDITIONAL'
      }];
    } else {
      // Structured amount available from complete deterministic scenario formula or verified semantic facts
      const displayCurrency = deterministicScenario?.functionalCurrency ?? groundedContext.semanticUnderstanding?.currency?.value ?? 'SGD';
      const lines: JournalLine[] = compact.requiredAccounts.map((acc, aIdx) => {
        const isDebit = acc.debitCredit === 'DEBIT';
        const amt = isDebit ? (debitsCount === 1 ? knownAmount! : 0) : (creditsCount === 1 ? knownAmount! : 0);
        return {
          id: `line-ai-${aIdx + 1}`,
          accountCode: acc.category === 'ASSET' ? '1500' : acc.category === 'LIABILITY' ? '2000' : acc.category === 'EQUITY' ? '3000' : acc.category === 'EXPENSE' ? '5000' : '4000',
          accountName: acc.accountName,
          category: acc.category,
          debit: isDebit ? amt : 0,
          credit: !isDebit ? amt : 0,
          lineExplanation: amt > 0
            ? (acc.rationale || `Recognition of ${acc.accountName}`)
            : `${acc.accountName}: Amount pending individual allocation breakdown (aggregate ${displayCurrency} ${knownAmount!.toLocaleString()})`
        };
      });

      const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
      const isBalanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01;

      directGroups = [{
        id: 'grp-ai-proposed-1',
        eventDate: formatSingaporeDate(new Date()),
        title: compact.transactionNature || 'AI-Proposed Double Entry',
        summary: compact.treatment || 'Illustrative journal proposal',
        lines,
        totalDebit,
        totalCredit,
        isBalanced,
        citations: verifiedCitations,
        rationalePoints: [
          compact.treatment || 'Accounting treatment proposed by AI reasoning',
          `Authority Status: ${authorityStatus} (Proposed by AI)`
        ],
        authorityStatus: authorityStatus === 'DETERMINISTIC' ? 'AI_PROPOSED' : authorityStatus
      }];
    }
    }
  }

  // Treat malformed provider payloads as incomplete data, never as a render-time exception.
  directGroups = directGroups.map(grp => ({ ...grp, lines: Array.isArray(grp.lines) ? grp.lines : [] }));

  // Guardrail A & C Enforcement: Ensure follow-up settlements never credit Share Capital again
  if (followUp && (followUp.eventType === 'settlement' || followUp.eventType === 'partial_settlement')) {
    const convContext = extractAccountingContext(currentScenario);
    for (const grp of directGroups) {
      const validation = validateAccountingStateTransition(convContext, grp.lines, followUp.eventType);
      if (!validation.isValid && validation.violations.some(v => v.includes('GUARDRAIL_VIOLATION_DUPLICATE_EQUITY'))) {
        for (const line of grp.lines) {
          if (line.credit > 0 && line.category === 'EQUITY' && line.accountName.toLowerCase().includes('share capital')) {
            line.accountCode = '1150';
            line.accountName = 'Amount Due from Shareholder (Receivable)';
            line.category = 'ASSET';
            line.lineExplanation = 'Settlement of allotment receivable (Share Capital previously recognized upon allotment)';
          }
        }
      }
    }
  }

  // 4. Assemble Statutory Advisories
  const isAccountingOnly = groundedContext.classification.primaryDomain === 'ACCOUNTING' &&
    !groundedContext.classification.taxAnalysisRequired;
  const suppliedAdvisories: StatutoryAdvisoryInfo[] = [
    ...(deterministicScenario?.statutoryAdvisory || []),
    ...(compact.statutoryAdvisory || [])
  ];

  // A generic provider advisory must never attach tax legislation to a pure
  // financial-reporting question. This also protects the source footer, which
  // is derived from these advisory records.
  const statutoryAdvisory: StatutoryAdvisoryInfo[] = isAccountingOnly
    ? suppliedAdvisories.filter((advisory) =>
        advisory.authority !== 'IRAS' && !/income tax|tax deduct|capital allowance/i.test(advisory.statuteOrAct || '')
      )
    : suppliedAdvisories;

  if (statutoryAdvisory.length === 0 && (compact.keyRules || compact.directAnswer)) {
    const domain = groundedContext.classification.primaryDomain;
    const primaryAuth = (domain === 'ACCOUNTING' ? 'ASC'
      : domain === 'EMPLOYMENT' ? 'MOM'
      : domain === 'PAYROLL' ? 'CPF'
      : domain === 'MAS_FUNDS' ? 'MAS'
      : domain === 'CORPORATE_REGULATORY' ? 'ACRA'
      : domain === 'TAX' || domain === 'GST' ? 'IRAS'
      : 'SSO') as any;

    const statuteOrAct = primaryAuth === 'ASC' ? 'SFRS(I) 1-1 Presentation of Financial Statements'
      : primaryAuth === 'MOM' ? 'Employment Act 1968'
      : primaryAuth === 'CPF' ? 'Central Provident Fund Act 1953'
      : primaryAuth === 'MAS' ? 'MAS Funds, Family Office and VCC Framework'
      : primaryAuth === 'ACRA' ? 'Companies Act 1967'
      : primaryAuth === 'IRAS' ? 'Income Tax Act 1947'
      : 'Singapore Statutes Online';

    statutoryAdvisory.push({
      authority: primaryAuth,
      statuteOrAct,
      sectionOrSchedule: primaryAuth === 'ASC' ? 'Presentation and reclassification guidance' : primaryAuth === 'MAS' ? 'MAS fund-management, SFO and VCC guidance' : 'Statutory Directives',
      topic: domain,
      summary: compact.directAnswer || 'Statutory directives under Singapore law',
      keyRules: compact.keyRules || [],
      officialUrl: primaryAuth === 'ASC'
        ? 'https://asc.acra.gov.sg/singapore-financial-reporting-standards-international/archives/effective-for-annual-reporting-period-beginning-on-1-january-2025'
        : primaryAuth === 'MAS'
          ? 'https://www.mas.gov.sg/regulation/capital-markets'
        : '',
      isTaxDeductible: undefined,
      isGstClaimable: undefined
    });
  }

  const safeStatutoryAdvisory = statutoryAdvisory.map(advisory => ({
    ...advisory,
    officialUrl: getSafeOfficialUrl(
      advisory.officialUrl,
      advisory.statuteOrAct,
      advisory.sectionOrSchedule,
      advisory.authority,
      retrievedEvidenceScope
    )
  }));

  // 5. Assemble Key Parameters
  const keyParameters: { label: string; value: string; badge?: string; highlight?: boolean }[] = [];

  if (isRecognizedDeterministicFixture) {
    if (deterministicScenario?.keyParameters) {
      keyParameters.push(...deterministicScenario.keyParameters);
    }
  } else {
    keyParameters.push({
      label: 'Evaluation Mode',
      value: 'AI Grounded Reasoning',
      badge: 'AI Active'
    });
    keyParameters.push({
      label: 'Detected Domain',
      value: groundedContext.classification.primaryDomain,
      badge: 'Classification'
    });
    keyParameters.push({
      label: 'AI Status',
      value: 'Live Grounded Pipeline Connected',
      badge: 'Online'
    });

    if (groundedContext.semanticUnderstanding) {
      const sem = groundedContext.semanticUnderstanding;
      const provenanceBadge = sem.provenance?.isFallback ? 'Heuristic Rule' : 'AI Semantic';
      if (sem.reportingEntity?.type && sem.reportingEntity.type !== 'unknown') {
        keyParameters.push({ label: 'Reporting Entity', value: sem.reportingEntity.type.toUpperCase(), badge: provenanceBadge });
      }
      if (sem.counterparty?.role && sem.counterparty.role !== 'unknown') {
        keyParameters.push({ label: 'Counterparty', value: sem.counterparty.role.toUpperCase(), badge: provenanceBadge });
      }
      if (sem.ownershipContext && sem.ownershipContext !== 'not_applicable' && sem.ownershipContext !== 'unknown') {
        keyParameters.push({ label: 'Ownership Context', value: sem.ownershipContext.toUpperCase(), badge: provenanceBadge });
      }
      if (sem.paymentStatus && sem.paymentStatus !== 'unknown') {
        keyParameters.push({ label: 'Payment Status', value: sem.paymentStatus.toUpperCase(), badge: provenanceBadge });
      }
      if (sem.currency?.value && sem.currency.value !== 'UNKNOWN') {
        keyParameters.push({ label: 'Currency', value: `${sem.currency.value} (${sem.currency.source})`, badge: provenanceBadge });
      }
      if (sem.amount !== undefined && sem.amount > 0) {
        keyParameters.push({ label: 'Transaction Amount', value: `${sem.currency?.value || 'SGD'} ${sem.amount.toLocaleString()}`, badge: provenanceBadge });
      }
      if (sem.provenance) {
        keyParameters.push({
          label: 'Semantic Provenance',
          value: sem.provenance.tier === 'AI_REASONING' ? 'AI Grounded Reasoning' : 'Deterministic Heuristic Fallback',
          badge: provenanceBadge
        });
      }
    }

    if (followUp && (followUp.eventType === 'settlement' || followUp.eventType === 'partial_settlement')) {
      const delta = settlementDelta;
      if (delta) {
        keyParameters.push({
          label: 'Settlement Amount',
          value: `${delta.currency} ${delta.amount.toFixed(2)}`,
          badge: delta.isHypothetical ? 'Hypothetical' : 'Settlement'
        });
        keyParameters.push({
          label: 'Settled Account',
          value: delta.balanceUpdates[0]?.accountName || 'Amount Due from Shareholder',
          badge: 'Receivable'
        });
        keyParameters.push({
          label: 'Remaining Balance',
          value: `${delta.currency} ${(delta.balanceUpdates[0]?.resultingBalance ?? 0).toFixed(2)}`,
          badge: 'Balance'
        });
      }
    }
  }

  if (compact.keyParameters && compact.keyParameters.length > 0) {
    keyParameters.push(...compact.keyParameters);
  }

  if (keyParameters.length === 0) {
    if (compact.decision) {
      keyParameters.push({ label: 'Accounting Decision', value: compact.decision, badge: 'Decision', highlight: true });
    }
    if (compact.treatment) {
      keyParameters.push({ label: 'Treatment Principle', value: compact.treatment.slice(0, 60), badge: 'SFRS(I)' });
    }
    keyParameters.push({ label: 'Authority Status', value: authorityStatus, badge: authorityStatus });
  }

  // 6. Assemble Assumptions & Missing Facts
  const assumptions: ExplicitAssumption[] = [
    ...(deterministicScenario?.assumptions || []),
    ...(groundedContext.assumptions || []),
    ...(compact.assumptions || []).map((a, idx) => ({
      id: `assump-${idx + 1}`,
      field: a.field,
      assumedValue: a.assumedValue,
      basisOrRationale: a.basis || 'Assumed parameter for illustrative computation',
      materiality: a.materiality || 'MEDIUM'
    }))
  ];

  const missingFacts = [
    ...new Set([
      ...(groundedContext.missingFacts || []),
      ...(compact.missingFacts || []),
      ...(invalidJournalProposalReason ? [invalidJournalProposalReason] : [])
    ])
  ];
  const guardedStatutoryAdvisory = safeStatutoryAdvisory.map(advisory => ({
    ...advisory,
    summary: guardUnconditionalMealInputTaxClaim(advisory.summary || '', userInput, groundedContext, missingFacts),
    keyRules: advisory.keyRules?.map(rule =>
      guardUnconditionalMealInputTaxClaim(rule, userInput, groundedContext, missingFacts)
    ),
    ...(hasUnresolvedMealInputTaxEligibility(userInput, missingFacts) && typeof advisory.isGstClaimable === 'boolean'
      ? { isGstClaimable: undefined }
      : {})
  }));
  const selectedAccountingTreatmentSummary = compact.treatment ||
    (isRecognizedDeterministicFixture ? deterministicScenario?.accountingTreatmentSummary : undefined);
  const selectedSingaporeTaxImpact = compact.singaporeTaxImpact ||
    (isRecognizedDeterministicFixture ? deterministicScenario?.singaporeTaxTreatmentSummary : undefined);
  const selectedRegulatoryMandatesSummary = isRecognizedDeterministicFixture
    ? deterministicScenario?.regulatoryMandatesSummary
    : undefined;
  const guardedAccountingTreatmentSummary = typeof selectedAccountingTreatmentSummary === 'string'
    ? guardUnconditionalMealInputTaxClaim(selectedAccountingTreatmentSummary, userInput, groundedContext, missingFacts)
    : selectedAccountingTreatmentSummary;
  const guardedSingaporeTaxImpact = typeof selectedSingaporeTaxImpact === 'string'
    ? guardUnconditionalMealInputTaxClaim(selectedSingaporeTaxImpact, userInput, groundedContext, missingFacts)
    : selectedSingaporeTaxImpact;
  const guardedRegulatoryMandatesSummary = typeof selectedRegulatoryMandatesSummary === 'string'
    ? guardUnconditionalMealInputTaxClaim(selectedRegulatoryMandatesSummary, userInput, groundedContext, missingFacts)
    : selectedRegulatoryMandatesSummary;

  // 7. Uncertainty Disclaimer
  let uncertaintyDisclaimer = compact.uncertaintyDisclaimer || deterministicScenario?.uncertaintyDisclaimer || '';
  if (missingFacts.length > 0) {
    const notice = `Conclusion is conditional upon establishing: ${missingFacts.join('; ')}.`;
    if (!uncertaintyDisclaimer.includes('conditional upon establishing')) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${notice} ${uncertaintyDisclaimer}` : notice;
    }
  }
  uncertaintyDisclaimer = guardUnconditionalMealInputTaxClaim(uncertaintyDisclaimer, userInput, groundedContext, missingFacts);

  // 8. Deterministic Markdown Response Construction (Eliminates LLM markdown token bloat!)
  let messageText = compact.messageText || '';

  if (!messageText || messageText.length < 30) {
    const isAccountingOrJournal = Boolean(
      (compact.requiredAccounts && compact.requiredAccounts.length > 0) ||
      compact.treatment ||
      compact.decision ||
      queryMode === 'TRANSACTION' ||
      queryMode === 'HYBRID'
    );

    if (!isAccountingOrJournal && (queryMode === 'STATUTORY_ADVISORY' || statutoryAdvisory.length > 0)) {
      const adv = statutoryAdvisory[0];
      messageText = `### Statutory Directive: ${deterministicScenario?.transactionTitle || adv?.topic || 'Singapore Statutory Compliance'}\n\n` +
        `**Governing Authority**: **${adv?.authority || 'Singapore Regulatory Authority'}** | **Legislation**: **${adv?.statuteOrAct || 'Singapore Statutes'}** | **Authority Status**: **` +
        `${authorityStatus === 'DETERMINISTIC' ? '✓ Deterministic Statutory Engine' : authorityStatus === 'CONDITIONAL' ? '⚠️ Conditional' : '🤖 AI Proposed'}` +
        `**\n\n---\n\n` +
        `#### 1. Statutory Principle & Ruling\n` +
        `${compact.directAnswer || adv?.summary || 'Governed strictly under Singapore statutory law.'}\n\n` +
        `---\n\n` +
        `#### 2. Key Rules, Thresholds & Mandatory Provisions\n`;

      const rules = compact.keyRules || adv?.keyRules || [];
      for (const rule of rules) {
        messageText += `* ${rule}\n`;
      }

      if (compact.caveats && compact.caveats.length > 0) {
        messageText += `\n---\n\n#### 3. Statutory Caveats & Qualifying Conditions\n`;
        for (const caveat of compact.caveats) {
          messageText += `* ⚠️ ${caveat}\n`;
        }
      }

      if (verifiedCitations.length > 0) {
        messageText += `\n---\n\n#### 4. Official Statutory Sources & Verification\n`;
        for (const c of verifiedCitations) {
          const sourceLabel = c.sourcePublisher && c.sourcePublisher === 'IFRS Foundation' && c.authority === 'ACRA'
            ? 'IFRS Foundation; Singapore framework authority: ACRA / ASC'
            : (c.sourcePublisher || c.authority);
          const label = `**${c.standard} ${c.paragraph}** (${sourceLabel}): ${c.title}`;
          messageText += c.officialSourceUrl ? `* ${label} ([official source](${c.officialSourceUrl}))\n` : `* ${label}\n`;
        }
      }

      if (directGroups.length > 0) {
        const grp = directGroups[directGroups.length - 1];
        const entryHeader = directGroups.length > 1
          ? `### Double Entry Journal: ${grp.title} (${grp.eventDate}) — [Entry ${directGroups.length} of ${directGroups.length}]\n\n`
          : `### Double Entry Journal: ${grp.title} (${grp.eventDate})\n\n`;
        messageText += `\n---\n\n${entryHeader}`;

        const isPendingValuation = !grp.isBalanced || grp.authorityStatus === 'CONDITIONAL' || grp.lines.every(l => l.debit === 0 && l.credit === 0);
        if (isPendingValuation) {
          messageText += `> ⚠️ **Uncertified Journal Proposal**: Account selections proposed by AI. Monetary amounts are uncalculated because required transaction values were not provided. Do not post to general ledger without independent valuation.\n\n`;
        }

        for (const line of grp.lines) {
          if (line.debit > 0) {
            messageText += `* **Debit**: **${line.accountName}** — **SGD ${line.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(${line.lineExplanation})*\n`;
          } else if (line.credit > 0) {
            messageText += `* **Credit**: **${line.accountName}** — **SGD ${line.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(${line.lineExplanation})*\n`;
          } else {
            const side = line.lineExplanation.toLowerCase().includes('debit') || line.category === 'ASSET' || line.category === 'EXPENSE' ? 'Debit' : 'Credit';
            messageText += `* **${side}**: **${line.accountName}** — **[Valuation pending]** *(${line.lineExplanation})*\n`;
          }
        }

        if (grp.isBalanced) {
          messageText += `\n**Balance Check**: Total Debits (SGD ${grp.totalDebit.toLocaleString()}) == Total Credits (SGD ${grp.totalCredit.toLocaleString()})  ✓ Balanced\n`;
        } else {
          messageText += `\n**Balance Check**: ⚠️ **Pending Valuation**: Cannot verify balancing until transaction values or asset appraisals are determined.\n`;
        }
      }
    } else {
      messageText = `### ${stdLabel} Accounting Assessment: ${resolvedTransactionTitle}\n\n`;
      messageText += `**Authority Status**: **${authorityStatus === 'DETERMINISTIC' ? '✓ Deterministic Engine' : authorityStatus === 'CONDITIONAL' ? '⚠️ Conditional Proposal' : '🤖 AI Grounded Proposal'}**\n\n`;

      if (compact.directAnswer) {
        messageText += `#### 1. Core Principle & Treatment Directive\n${compact.directAnswer}\n\n`;
      } else if (compact.treatment) {
        messageText += `#### 1. Accounting Treatment Principle\n${compact.treatment}\n\n`;
      }

      if (compact.reasoning) {
        messageText += `#### 2. Technical Rationale & Analysis\n${compact.reasoning}\n\n`;
      }

      if (compact.singaporeTaxImpact) {
        messageText += `#### 3. Singapore Statutory & Tax Implications\n${compact.singaporeTaxImpact}\n\n`;
      }

      if (keyParameters.length > 0) {
        messageText += `---\n\n#### 4. Key Statutory & Computational Facts\n`;
        for (const p of keyParameters) {
          messageText += `* **${p.label}**: ${p.value}\n`;
        }
        messageText += `\n`;
      }

      if (directGroups.length > 0) {
        const grp = directGroups[directGroups.length - 1];
        const entryHeader = directGroups.length > 1
          ? `### Double Entry Journal: ${grp.title} (${grp.eventDate}) — [Entry ${directGroups.length} of ${directGroups.length}]\n\n`
          : `### Double Entry Journal: ${grp.title} (${grp.eventDate})\n\n`;
        messageText += `---\n\n${entryHeader}`;

        const isPendingValuation = !grp.isBalanced || grp.authorityStatus === 'CONDITIONAL' || grp.lines.every(l => l.debit === 0 && l.credit === 0);
        if (isPendingValuation) {
          messageText += `> ⚠️ **Uncertified Journal Proposal**: Account selections proposed by AI. Monetary amounts are uncalculated because required transaction values were not provided. Do not post to general ledger without independent valuation.\n\n`;
        }

        for (const line of grp.lines) {
          if (line.debit > 0) {
            messageText += `* **Debit**: **${line.accountName}** — **SGD ${line.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(${line.lineExplanation})*\n`;
          } else if (line.credit > 0) {
            messageText += `* **Credit**: **${line.accountName}** — **SGD ${line.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(${line.lineExplanation})*\n`;
          } else {
            const side = line.lineExplanation.toLowerCase().includes('debit') || line.category === 'ASSET' || line.category === 'EXPENSE' ? 'Debit' : 'Credit';
            messageText += `* **${side}**: **${line.accountName}** — **[Valuation pending]** *(${line.lineExplanation})*\n`;
          }
        }

        if (grp.isBalanced) {
          messageText += `\n**Balance Check**: Total Debits (SGD ${grp.totalDebit.toLocaleString()}) == Total Credits (SGD ${grp.totalCredit.toLocaleString()})  ✓ Balanced\n`;
        } else {
          messageText += `\n**Balance Check**: ⚠️ **Pending Valuation**: Cannot verify balancing until transaction values or asset appraisals are determined.\n`;
        }
      }
    }
  }

  const hasPendingValuation = directGroups.some(g => !g.isBalanced && g.authorityStatus === 'CONDITIONAL');
  if (hasPendingValuation) {
    if (!missingFacts.includes('Fair value or transaction price for exchange consideration')) {
      missingFacts.push('Fair value or transaction price for exchange consideration');
    }
  }

  const finalAuthorityStatus: JournalAuthorityStatus = hasPendingValuation
    ? 'CONDITIONAL'
    : authorityStatus;

  let finalActualEvents = currentScenario?.actualEvents;
  let finalAccountingEvents = currentScenario?.accountingEvents;
  let isHypoScenario = Boolean(currentScenario?.isHypothetical);
  let resolvedAmount: number | undefined = undefined;

  if (followUp && (followUp.eventType === 'settlement' || followUp.eventType === 'partial_settlement')) {
    const convContext = extractAccountingContext(currentScenario);
    const delta = settlementDelta;
    if (delta && delta.resultingAccountingEvent) {
      isHypoScenario = Boolean(delta.isHypothetical);
      resolvedAmount = delta.amount;
      const priorActual = convContext.actualEvents;

      finalActualEvents = isHypoScenario
        ? priorActual
        : commitAccountingEvent(priorActual, delta.resultingAccountingEvent);
      finalAccountingEvents = [...(currentScenario?.accountingEvents || priorActual), delta.resultingAccountingEvent];
    }
  } else if (!finalActualEvents && directGroups.length > 0) {
    committedDirectGroups = directGroups.filter(g => !g.isHypothetical);
    finalActualEvents = committedDirectGroups.map((grp, idx) => ({
      id: grp.id || `evt-${idx + 1}`,
      transactionId: grp.transactionId || grp.id || `tx-${idx + 1}`,
      targetTransactionId: grp.targetTransactionId,
      type: 'initial_transaction',
      description: grp.title,
      amount: grp.totalDebit,
      currency: deterministicScenario?.transactionCurrency || 'SGD',
      affectedAccounts: grp.lines.map(l => l.accountName),
      journalLines: grp.lines,
      eventDate: grp.eventDate,
      isHypothetical: false
    }));
    finalAccountingEvents = [...(finalActualEvents ?? [])];
  } else if (hasAuthoritativeDeterministicEntries && !committedDirectGroups) {
    committedDirectGroups = directGroups.filter(g => !g.isHypothetical);
  }

  if (resolvedAmount === undefined) {
    if (deterministicScenario?.amount && deterministicScenario.amount > 0) {
      resolvedAmount = deterministicScenario.amount;
    } else if (groundedContext.semanticUnderstanding?.amount && groundedContext.semanticUnderstanding.amount > 0) {
      resolvedAmount = groundedContext.semanticUnderstanding.amount;
    }
  }

  // 9. Journal Generation Consistency Guard
  // Invariant: If active projected or evaluated measurement basis is FVOCI:
  // - MUST NOT contain any FVTPL accounts (e.g. Fair Value Gain [P&L], Realized FX Gain [P&L])
  // - P&L recycling must be zero
  const activeBasis = followUp?.targetMeasurementBasis ||
    groundedContext.semanticUnderstanding?.projectedMeasurementBasis ||
    groundedContext.semanticUnderstanding?.actualMeasurementBasis ||
    currentScenario?.actualMeasurementBasis;

  if (activeBasis === 'FVOCI') {
    for (const grp of directGroups) {
      for (const line of grp.lines) {
        const accLower = line.accountName.toLowerCase();
        if (accLower.includes('fvtpl') || accLower.includes('fair value gain (profit or loss)') || accLower.includes('fair value gain [p&l]')) {
          throw new Error(`[JOURNAL_CONSISTENCY_VIOLATION] Journal for FVOCI contains FVTPL account: ${line.accountName}`);
        }
        if (accLower.includes('realized foreign exchange gain') && accLower.includes('p&l')) {
          throw new Error(`[JOURNAL_CONSISTENCY_VIOLATION] Journal for FVOCI contains P&L FX gain account: ${line.accountName}`);
        }
      }
    }
  }

  const convContextForState = extractAccountingContext(currentScenario);
  const resolvedActualBasis = currentScenario?.actualMeasurementBasis ||
    deterministicScenario?.actualMeasurementBasis ||
    convContextForState.underlyingTransaction?.actualMeasurementBasis ||
    (currentScenario?.classification as any) ||
    'UNKNOWN';

  const resolvedProjectedBasis = followUp?.targetMeasurementBasis ||
    groundedContext.semanticUnderstanding?.projectedMeasurementBasis ||
    currentScenario?.projectedMeasurementBasis;

  const resolvedUnderlyingTx = currentScenario?.underlyingTransaction ||
    deterministicScenario?.underlyingTransaction ||
    convContextForState.underlyingTransaction;

  const scenarioState: AccountingScenarioState = {
    scenarioType: resolvedScenarioType,
    queryIntent: queryMode as any,
    primaryDomain: deterministicScenario?.primaryDomain || (
      groundedContext.classification.primaryDomain === 'EMPLOYMENT' ? 'MOM_EMPLOYMENT' :
      groundedContext.classification.primaryDomain === 'PAYROLL' ? 'CPF_BOARD' :
      groundedContext.classification.primaryDomain === 'MAS_FUNDS' ? 'MAS_FUNDS' :
      groundedContext.classification.primaryDomain === 'CORPORATE_REGULATORY' ? 'ACRA_CORP' :
      groundedContext.classification.primaryDomain === 'TAX' ? 'IRAS_TAX' :
      groundedContext.classification.primaryDomain === 'GST' ? 'IRAS_GST' :
      groundedContext.classification.authorities.includes('MAS') ? 'MAS_FUNDS' :
      'ACCOUNTING_SFRS'
    ),
    rawQuery: userInput,
    transactionTitle: resolvedTransactionTitle,
    functionalCurrency: deterministicScenario?.functionalCurrency || 'SGD',
    transactionCurrency: deterministicScenario?.transactionCurrency || (groundedContext.semanticUnderstanding?.currency?.value || 'SGD'),
    authorityStatus: finalAuthorityStatus,
    accountingTreatmentSummary: guardedAccountingTreatmentSummary,
    singaporeTaxTreatmentSummary: guardedSingaporeTaxImpact,
    regulatoryMandatesSummary: guardedRegulatoryMandatesSummary,
    effectiveDateOrTiming: isRecognizedDeterministicFixture ? deterministicScenario?.effectiveDateOrTiming : undefined,
    uncertaintyDisclaimer: uncertaintyDisclaimer || undefined,
    amount: resolvedAmount,
    accountingEvents: finalAccountingEvents,
    actualEvents: finalActualEvents,
    isHypothetical: isHypoScenario,
    keyParameters,
    directGroups,
    committedDirectGroups,
    projectedGroups,
    statutoryAdvisory: guardedStatutoryAdvisory.length > 0 ? guardedStatutoryAdvisory : undefined,
    assumptions: assumptions.length > 0 ? assumptions : undefined,
    missingFacts: missingFacts.length > 0 ? missingFacts : undefined,
    ownershipContext: deterministicScenario?.ownershipContext || groundedContext.semanticUnderstanding?.ownershipContext || currentScenario?.ownershipContext,
    semanticUnderstanding: groundedContext.semanticUnderstanding || currentScenario?.semanticUnderstanding,
    actualMeasurementBasis: resolvedActualBasis,
    projectedMeasurementBasis: resolvedProjectedBasis,
    underlyingTransaction: resolvedUnderlyingTx,
    classification: (resolvedProjectedBasis || resolvedActualBasis) as any,
    isComplete: !hasPendingValuation && missingFacts.length === 0 && retrievedEvidenceScope.length > 0,
    missingFields: []
  };

  return {
    messageText: appendStatutorySourceFooter(
      guardUnconditionalMealInputTaxClaim(messageText, userInput, groundedContext, missingFacts),
      scenarioState,
      retrievedEvidenceScope
    ),
    scenarioState,
    sourceMapFallbackTrace: groundedContext.sourceMapFallbackTrace,
    groundingEvidence: buildResponseGroundingEvidenceTrace(groundedContext)
  };
}
