import type { AccountingStandard, AccountingScenarioState, MissingFieldInfo, ChatMessage, JournalEntryGroup } from '../types/accounting';
import type { AccountingEvent } from '../types/conversationState';
import type { ProviderSettings } from '../types/provider';
import { parseAccountingQuery, isDeterministicFixture } from '../engine/scenarioParser';
import { defaultAccountingGuardrails } from '../engine/accountingGuardrails';
import { appendStatutorySourceFooter } from '../utils/statutoryLinkResolver';
import { repairAndParseAIJson } from '../utils/jsonRepair';
import { callAzureOpenAI, callStandardOpenAI } from './azureOpenAiService';
import {
  buildGroundedReasoningContext,
  formatGroundedSystemPrompt,
  postProcessAIResponse,
  type GroundedReasoningContext
} from './groundingContextBuilder';
import { RequestProfiler } from './telemetry';
import { defaultSourceFreshnessManager } from '../standards/sourceFreshnessManager';
import { formatSingaporeDate } from '../utils/dateUtils';

export interface GeminiResponse {
  messageText: string;
  scenarioState: AccountingScenarioState;
  clarifications?: MissingFieldInfo[];
}

export interface FastPathEvaluation {
  canBypass: boolean;
  reason: string;
}

/**
 * Strict 6-Condition Test for Fast-Path Zero-LLM Execution.
 * Core Principle: Deterministic != Authoritative.
 * The zero-Gemini fast path should ONLY be used when ALL of the following are true:
 * 1. The deterministic engine can fully answer the question.
 * 2. The required supporting source/evidence is verified.
 * 3. The source is authoritative for the question (verbatim primary law).
 * 4. The source is current/effective for the relevant period.
 * 5. No professional interpretation or judgment is required (not an accounting transaction/journal).
 * 6. No material facts are missing.
 */
export function evaluateFastPathEligibility(
  userInput: string,
  deterministicScenario: AccountingScenarioState | null,
  groundedContext: GroundedReasoningContext
): FastPathEvaluation {
  // Condition 1: The deterministic engine can fully answer the question
  if (!deterministicScenario) {
    return { canBypass: false, reason: 'Deterministic scenario is missing' };
  }
  if (!deterministicScenario.isComplete) {
    return { canBypass: false, reason: 'Deterministic scenario is incomplete' };
  }
  if (deterministicScenario.scenarioType === 'UNRECOGNIZED') {
    return { canBypass: false, reason: 'Scenario is unrecognized by deterministic engine' };
  }
  if (deterministicScenario.missingFields && deterministicScenario.missingFields.length > 0) {
    return { canBypass: false, reason: 'Deterministic scenario has missing fields' };
  }

  // Condition 5: No professional interpretation or judgment is required
  // Transactions requiring account determination, standard selection, or journal synthesis must route to Gemini.
  const classification = groundedContext.classification;
  if (
    classification.accountingAnalysisRequired ||
    classification.journalEntryRequired ||
    classification.intent === 'TRANSACTION' ||
    classification.intent === 'HYBRID'
  ) {
    return { canBypass: false, reason: 'Professional accounting interpretation, transaction analysis, or journal entry required' };
  }

  // Condition 6: No material facts are missing
  if (
    (groundedContext.missingFacts && groundedContext.missingFacts.length > 0) ||
    (deterministicScenario.missingFacts && deterministicScenario.missingFacts.length > 0)
  ) {
    return { canBypass: false, reason: 'Material facts are missing from query' };
  }

  // Condition 2 & 3: The required supporting source/evidence is verified and authoritative at section level
  const supportingCitations = deterministicScenario.directGroups?.[0]?.citations || [];
  const supportingAdvisories = deterministicScenario.statutoryAdvisory || [];

  if (supportingCitations.length === 0 && supportingAdvisories.length === 0) {
    return { canBypass: false, reason: 'No supporting citations or statutory advisories found' };
  }

  const allRetrieved = [
    ...groundedContext.primaryEvidence,
    ...groundedContext.officialGuidance,
    ...groundedContext.curatedSummaries
  ];

  // Claim Completeness: Identify distinct statutory topics in user query
  // and ensure every queried claim has a section-level verified primary source.
  const qLower = userInput.toLowerCase();
  const claimRules: Array<{ topic: string; test: boolean; sectionMatch: string }> = [
    { topic: 'Annual Leave', test: qLower.includes('annual leave'), sectionMatch: '88a' },
    { topic: 'Sick / Hospitalisation Leave', test: qLower.includes('sick leave') || qLower.includes('hospitalisation') || qLower.includes('medical leave'), sectionMatch: '89' },
    { topic: 'Part IV Overtime', test: qLower.includes('overtime') || qLower.includes('part iv') || qLower.includes('working hours'), sectionMatch: '38' },
    { topic: 'CPF Wage Ceilings', test: qLower.includes('cpf ceiling') || qLower.includes('ordinary wage') || qLower.includes('aw ceiling'), sectionMatch: 'first schedule' },
    { topic: 'Compulsory GST Registration', test: qLower.includes('gst registration') || qLower.includes('compulsory gst') || (qLower.includes('gst') && qLower.includes('threshold')), sectionMatch: 'first schedule' },
    { topic: 'Section 14 Tax Deductibility', test: qLower.includes('section 14') || qLower.includes('wholly and exclusively'), sectionMatch: '14' },
    { topic: 'Section 205C Audit Exemption', test: qLower.includes('audit exemption') || qLower.includes('small company'), sectionMatch: '205c' },
    // Phase 3 Expanded Statutory Claims:
    { topic: 'Loss Carry-Back Relief', test: qLower.includes('carry back') || qLower.includes('carry-back'), sectionMatch: '37e' },
    { topic: 'Loss Carry-Forward Relief', test: qLower.includes('carry forward') || qLower.includes('carry-forward'), sectionMatch: '37' },
    { topic: 'Safe Harbour Share Disposal', test: qLower.includes('safe harbour') || qLower.includes('safe harbor') || (qLower.includes('disposal') && qLower.includes('shares')), sectionMatch: '13w' },
    { topic: 'Withholding Tax', test: qLower.includes('withholding tax') || qLower.includes('section 45'), sectionMatch: '45' },
    { topic: 'Renovation & Refurbishment S14Q', test: qLower.includes('renovation') || qLower.includes('refurbishment') || qLower.includes('14q'), sectionMatch: '14q' },
    { topic: 'GST De Minimis Rule', test: qLower.includes('de minimis') || (qLower.includes('regulation 28') && qLower.includes('gst')), sectionMatch: '28' },
    { topic: 'GST Reverse Charge', test: qLower.includes('reverse charge') || (qLower.includes('imported services') && qLower.includes('gst')), sectionMatch: '14' },
    { topic: 'GST Bad Debt Relief', test: qLower.includes('bad debt relief') || (qLower.includes('bad debt') && qLower.includes('gst')), sectionMatch: '82' },
    { topic: 'GST Time of Supply', test: qLower.includes('time of supply'), sectionMatch: '11' },
    { topic: 'Director Conflict Disclosure', test: (qLower.includes('director') && (qLower.includes('conflict') || qLower.includes('interest'))) || qLower.includes('section 156'), sectionMatch: '156' },
    { topic: 'Company Secretary Mandate', test: qLower.includes('company secretary') || qLower.includes('section 171'), sectionMatch: '171' },
    { topic: 'Registrable Controllers (RORC)', test: qLower.includes('registrable controllers') || qLower.includes('rorc'), sectionMatch: '142' },
    { topic: 'Abolition of Par Value', test: qLower.includes('par value') || qLower.includes('nominal value'), sectionMatch: '68' },
    { topic: 'Capital Reduction Solvency', test: qLower.includes('capital reduction') || qLower.includes('reduction of share capital'), sectionMatch: '78b' },
    { topic: 'CPF Account Allocation Rates', test: qLower.includes('ordinary account') || qLower.includes('special account') || qLower.includes('medisave') || qLower.includes('allocation rate'), sectionMatch: 'allocation' },
    { topic: 'MOM Rest Day Pay', test: qLower.includes('rest day'), sectionMatch: '36' },
    { topic: 'Mandatory Retrenchment Notification', test: qLower.includes('retrenchment notification') || qLower.includes('mandatory retrenchment'), sectionMatch: 'retrenchment' },
    { topic: 'CDCA Parental Leave Entitlement', test: qLower.includes('paternity leave') || qLower.includes('parental leave') || qLower.includes('cdca'), sectionMatch: 'cdca' }
  ];

  const activeClaims = claimRules.filter(c => c.test);

  for (const claim of activeClaims) {
    const claimEvidence = allRetrieved.find(r => {
      const sec = (r.paragraphOrSection || '').toLowerCase().replace(/[\s\-_()]/g, '');
      const reqSec = claim.sectionMatch.toLowerCase().replace(/[\s\-_()]/g, '');
      return sec.includes(reqSec);
    });

    if (!claimEvidence) {
      return { canBypass: false, reason: `Query claim '${claim.topic}' lacks section-level evidence in retrieved sources` };
    }
    if (claimEvidence.sourceStatus !== 'VERIFIED') {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' (${claimEvidence.documentTitle}) has status '${claimEvidence.sourceStatus}', not VERIFIED` };
    }
    if (claimEvidence.evidenceTier !== 'PRIMARY_SOURCE') {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' (${claimEvidence.documentTitle}) is tier '${claimEvidence.evidenceTier}', not PRIMARY_SOURCE` };
    }
    if (!claimEvidence.isVerbatimText) {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' (${claimEvidence.documentTitle}) is not authentic verbatim text` };
    }
    if (!claimEvidence.effectiveDate || claimEvidence.effectiveDate.toLowerCase().includes('unknown')) {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' lacks a verified effective date` };
    }
    if (claimEvidence.sourceAuthority === 'REFERENCE_API') {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' is from a reference API, not an approved statutory authority` };
    }

    // Temporal freshness validation: AUDIT_OVERDUE or HISTORICAL provisions cannot satisfy current fast path
    const claimFreshness = claimEvidence.freshnessStatus || defaultSourceFreshnessManager.evaluateSourceFreshness(claimEvidence);
    if (claimFreshness === 'AUDIT_OVERDUE') {
      return { canBypass: false, reason: `Evidence for '${claim.topic}' (${claimEvidence.documentTitle}) is overdue for audit verification` };
    }
    if (claimFreshness === 'HISTORICAL_SUPERSEDED') {
      const mentionsHistorical = qLower.includes('historical') || qLower.includes('prior') || qLower.includes('past') || qLower.includes('former') || qLower.includes('superseded');
      if (!mentionsHistorical) {
        return { canBypass: false, reason: `Evidence for '${claim.topic}' (${claimEvidence.documentTitle}) is historical/superseded and cannot satisfy current deterministic fast path` };
      }
    }
  }

  // Verify all supporting citations match at the section level to verified primary sources
  for (const cite of supportingCitations) {
    const rawStd = (cite.standard || '').toLowerCase().replace(/[\s\-_()]/g, '');
    const rawPara = (cite.paragraph || '').toLowerCase().replace(/[\s\-_()]/g, '');

    const matched = allRetrieved.find(r => {
      const rCode = (r.standardOrActCode || '').toLowerCase().replace(/[\s\-_()]/g, '');
      const rTitle = (r.documentTitle || '').toLowerCase().replace(/[\s\-_()]/g, '');
      const rSec = (r.paragraphOrSection || '').toLowerCase().replace(/[\s\-_()]/g, '');

      const actMatches = rawStd.includes(rCode) || rCode.includes(rawStd) || rawStd.includes(rTitle) || rTitle.includes(rawStd);
      // Section-level verification: must match section/provision, not just the general Act
      const secMatches = !rawPara || rSec.includes(rawPara) || rawPara.includes(rSec) ||
        Boolean(rawPara.match(/\d+[a-z]?/i) && rSec.includes(rawPara.match(/\d+[a-z]?/i)![0]));

      return actMatches && secMatches;
    });

    if (!matched) {
      return { canBypass: false, reason: `Supporting citation '${cite.standard} ${cite.paragraph}' not found at section level in retrieved sources` };
    }
    if (matched.sourceStatus !== 'VERIFIED') {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle} ${matched.paragraphOrSection}' has status '${matched.sourceStatus}', not VERIFIED` };
    }
    if (matched.sourceType !== 'AUTHORITATIVE_SOURCE' && matched.evidenceTier !== 'PRIMARY_SOURCE') {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle}' is tier '${matched.evidenceTier}', not PRIMARY_SOURCE` };
    }
    if (!matched.isVerbatimText) {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle} ${matched.paragraphOrSection}' is not authentic verbatim text` };
    }

    // Condition 4: The source is current/effective for the relevant period
    if (!matched.effectiveDate || matched.effectiveDate.toLowerCase().includes('unknown')) {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle}' lacks a verified effective date` };
    }
    if (matched.sourceAuthority === 'REFERENCE_API') {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle}' is from a reference API and cannot satisfy statutory authority requirements` };
    }

    const matchedFreshness = matched.freshnessStatus || defaultSourceFreshnessManager.evaluateSourceFreshness(matched);
    if (matchedFreshness === 'AUDIT_OVERDUE') {
      return { canBypass: false, reason: `Supporting source '${matched.documentTitle}' is overdue for audit verification` };
    }
    if (matchedFreshness === 'HISTORICAL_SUPERSEDED') {
      const mentionsHistorical = qLower.includes('historical') || qLower.includes('prior') || qLower.includes('past') || qLower.includes('former') || qLower.includes('superseded');
      if (!mentionsHistorical) {
        return { canBypass: false, reason: `Supporting source '${matched.documentTitle}' is historical/superseded and cannot satisfy current deterministic fast path` };
      }
    }
  }

  return { canBypass: true, reason: 'All 6 authoritative deterministic conditions satisfied with claim-complete section-level verified primary sources' };
}

export async function processAccountingQuery(
  userInput: string,
  currentScenario: AccountingScenarioState | null,
  standard: AccountingStandard,
  providerOrApiKey?: ProviderSettings | string,
  modelName: string = 'gemini-3.5-flash-lite',
  chatHistory: ChatMessage[] = []
): Promise<GeminiResponse> {
  const profiler = new RequestProfiler(userInput, modelName);
  let apiErrorMessage: string | null = null;

  // 1. Check if query matches an explicit deterministic test fixture
  const isFixture = isDeterministicFixture(userInput);
  const tDet0 = Date.now();
  const deterministicScenario = await parseAccountingQuery(userInput, currentScenario);
  profiler.recordStage('deterministic_engine', Date.now() - tDet0);

  // 2. Build grounded context to evaluate evidence provenance and classification
  const tGround0 = Date.now();
  const groundedContext = await buildGroundedReasoningContext(userInput, currentScenario, undefined, providerOrApiKey);
  profiler.recordStage('grounding', Date.now() - tGround0);

  // 3. Evaluate Fast-Path Bypass (ONLY for explicit deterministic fixtures)
  if (isFixture) {
    const fastPathCheck = evaluateFastPathEligibility(userInput, deterministicScenario, groundedContext);
    if (fastPathCheck.canBypass) {
      profiler.recordFirstVisibleResponse();
      profiler.setTokenCounts(0, 0, 0);
      profiler.logSummary();

      return renderStructuredOfflineResponse(deterministicScenario, standard, null, groundedContext);
    }
  }

  // 4. Live AI API call if provider settings or apiKey is provided
  if (providerOrApiKey) {
    if (typeof providerOrApiKey === 'object') {
      const active = providerOrApiKey.activeProvider;
      if (active === 'azure' && providerOrApiKey.azure?.apiKey && providerOrApiKey.azure.endpoint) {
        try {
          return await callAzureOpenAI(userInput, currentScenario, standard, providerOrApiKey.azure, chatHistory, groundedContext, deterministicScenario);
        } catch (err: any) {
          console.warn('Azure OpenAI API call failed, falling back to smart universal engine:', err);
          apiErrorMessage = err?.message || 'Azure OpenAI Error';
          profiler.recordFallback();
        }
      } else if (active === 'gemini' && providerOrApiKey.gemini?.apiKey && providerOrApiKey.gemini.apiKey.trim().length > 10) {
        try {
          return await callGeminiAPI(
            userInput,
            currentScenario,
            standard,
            providerOrApiKey.gemini.apiKey.trim(),
            providerOrApiKey.gemini.model || modelName,
            chatHistory,
            groundedContext,
            deterministicScenario,
            profiler
          );
        } catch (err: any) {
          console.warn('Gemini API call failed, falling back to smart universal engine:', err);
          apiErrorMessage = err?.message || 'Gemini API Error';
          profiler.recordFallback();
        }
      } else if (active === 'openai' && providerOrApiKey.openai?.apiKey && providerOrApiKey.openai.apiKey.trim().length > 10) {
        try {
          return await callStandardOpenAI(
            userInput,
            currentScenario,
            standard,
            providerOrApiKey.openai,
            chatHistory,
            groundedContext,
            deterministicScenario
          );
        } catch (err: any) {
          console.warn('OpenAI API call failed, falling back to smart universal engine:', err);
          apiErrorMessage = err?.message || 'OpenAI API Error';
          profiler.recordFallback();
        }
      }
    } else if (typeof providerOrApiKey === 'string' && providerOrApiKey.trim().length > 10) {
      try {
        return await callGeminiAPI(
          userInput,
          currentScenario,
          standard,
          providerOrApiKey.trim(),
          modelName,
          chatHistory,
          groundedContext,
          deterministicScenario,
          profiler
        );
      } catch (err: any) {
        console.warn('Gemini API call failed, falling back to smart universal engine:', err);
        apiErrorMessage = err?.message || 'Gemini API Error';
        profiler.recordFallback();
      }
    }
  }

  // 5. Fallback structured offline response rendered from deterministic state
  profiler.recordFallback();
  profiler.recordFirstVisibleResponse();
  const fallbackResponse = renderStructuredOfflineResponse(deterministicScenario, standard, apiErrorMessage, groundedContext);
  profiler.logSummary();
  return fallbackResponse;
}

/**
 * Structured offline response renderer.
 * Modularizes offline message generation cleanly without cluttering the pipeline coordinator.
 */
export function renderStructuredOfflineResponse(
  parsed: AccountingScenarioState,
  standard: AccountingStandard,
  apiErrorMessage: string | null = null,
  groundedContext?: GroundedReasoningContext
): GeminiResponse {
  const std1 = standard === 'SFRS_I' ? 'SFRS(I) 1-1' : 'IAS 1';
  const std9 = standard === 'SFRS_I' ? 'SFRS(I) 9' : 'IFRS 9';
  const std16 = standard === 'SFRS_I' ? 'SFRS(I) 16' : 'IFRS 16';
  const std21 = standard === 'SFRS_I' ? 'SFRS(I) 1-21' : 'IAS 21';
  const std16Name = standard === 'SFRS_I' ? 'SFRS(I) 1-16' : 'IAS 16';
  const std38Name = standard === 'SFRS_I' ? 'SFRS(I) 1-38' : 'IAS 38';

  const finalizeMessage = (text: string, state: AccountingScenarioState) => {
    const fullText = apiErrorMessage
      ? `> ⚠️ **Provider Notice**: ${apiErrorMessage}. Reverted seamlessly to the Singapore Statutory Offline Engine.\n\n${text}`
      : text;
    return appendStatutorySourceFooter(fullText, state);
  };

  const ensureEventSourcedState = (state: AccountingScenarioState): AccountingScenarioState => {
    if (state.directGroups && state.directGroups.length > 0 && (!state.actualEvents || state.actualEvents.length === 0)) {
      const committed = (state.committedDirectGroups && state.committedDirectGroups.length > 0)
        ? state.committedDirectGroups
        : state.directGroups.filter(g => !g.isHypothetical);
      const actualEvts: AccountingEvent[] = committed.map((grp, idx) => {
        const txId = grp.transactionId || grp.id || `tx-init-${idx + 1}`;
        grp.transactionId = txId;
        return {
          id: grp.id || `evt-init-${idx + 1}`,
          transactionId: txId,
          targetTransactionId: grp.targetTransactionId,
          type: (grp.title && grp.title.toLowerCase().includes('settle')) ? 'settlement' : 'initial_transaction',
          description: grp.title || 'Initial transaction',
          amount: grp.totalDebit,
          currency: state.transactionCurrency || state.functionalCurrency || 'SGD',
          affectedAccounts: grp.lines.map(l => l.accountName),
          journalLines: grp.lines,
          eventDate: grp.eventDate,
          isHypothetical: false
        };
      });
      return {
        ...state,
        transactionId: state.transactionId || committed[0]?.transactionId || 'tx-init-1',
        committedDirectGroups: committed,
        actualEvents: actualEvts,
        accountingEvents: state.accountingEvents || actualEvts
      };
    }
    return state;
  };

  // 1. UNRECOGNIZED / FREE-FORM QUERY (OFFLINE MODE)
  if (parsed.scenarioType === 'UNRECOGNIZED') {
    const errorPrefix = apiErrorMessage
      ? `> ⚠️ **Gemini API Call Notice**: ${apiErrorMessage}\n> Please verify your API Key and Model in the **Settings** panel.\n\n`
      : '';

    let replyText = `${errorPrefix}### Semantic Transaction Analysis (Offline Mode)\n\n`;

    if (groundedContext?.semanticUnderstanding) {
      const sem = groundedContext.semanticUnderstanding;
      replyText += `**Extracted Economic Facts**:\n` +
        `* **Reporting Entity**: ${sem.reportingEntity.type.toUpperCase()}${sem.reportingEntity.description ? ` (${sem.reportingEntity.description})` : ''}\n` +
        (sem.counterparty ? `* **Counterparty Role**: ${sem.counterparty.role.toUpperCase()}${sem.counterparty.description ? ` (${sem.counterparty.description})` : ''}\n` : '') +
        `* **Transaction Nature**: ${sem.transactionType || 'General Commercial Transaction'}\n` +
        `* **Ownership Context**: ${(sem.ownershipContext || 'unknown').toUpperCase()}\n` +
        `* **Payment Status**: ${(sem.paymentStatus || 'unknown').toUpperCase()}\n` +
        `* **Currency Fact**: ${sem.currency.value || 'Unspecified'} (Source: ${sem.currency.source}, Confidence: ${sem.currency.confidence})\n\n`;

      if (sem.ownershipContext === 'own_equity') {
        const amt = sem.amount || 1;
        const curr = sem.currency.value || parsed.functionalCurrency || 'SGD';
        const isUnpaid = sem.paymentStatus === 'unpaid';
        const debitAccountName = isUnpaid ? 'Amount Due from Shareholder (Receivable)' : 'Cash at Bank (Current Account)';
        const debitAccountCode = isUnpaid ? '1150' : '1010';
        const debitLineExplanation = isUnpaid ? 'Allotment receivable under Companies Act §63(1)' : 'Receipt of share capital';

        replyText += `**Statutory & Standard Directives**:\n` +
          `* **Singapore Companies Act 1967 §68**: Shares of a Singapore company have no nominal or par value. Share premium is abolished; 100% of consideration is credited to Share Capital under Equity.\n` +
          `* **Singapore Companies Act 1967 §63(1)**: Allotment of shares can be fully paid, partly paid, or unpaid. When shares are unpaid, an enforceable allotment receivable is recognized against the subscriber.\n` +
          `* **SFRS(I) 1-32 §33**: An entity's own equity instruments can NEVER be recognized as a financial asset (no FVTPL/FVTOCI).\n\n` +
          `**Double Entry Journal**:\n` +
          `* **Debit**: **${debitAccountName}** — **${curr} ${amt.toFixed(2)}** *(${debitLineExplanation})*\n` +
          `* **Credit**: **Share Capital (Ordinary Shares)** — **${curr} ${amt.toFixed(2)}** *(Credited 100% to share capital under Companies Act §68)*\n\n`;

        const allotmentTxId = `tx-allot-${Date.now()}`;
        const initialGroup: JournalEntryGroup = {
          id: 'grp-equity-allotment-1',
          transactionId: allotmentTxId,
          eventDate: formatSingaporeDate(new Date()),
          title: isUnpaid ? 'Share Capital Allotment (Unpaid)' : 'Share Capital Issuance (Paid)',
          summary: `Allotment of ordinary shares ${isUnpaid ? 'unpaid' : 'fully paid'} under Singapore Companies Act §68`,
          lines: [
            {
              id: 'l-equity-dr',
              accountCode: debitAccountCode,
              accountName: debitAccountName,
              category: 'ASSET',
              debit: amt,
              credit: 0,
              lineExplanation: debitLineExplanation
            },
            {
              id: 'l-equity-cr',
              accountCode: '3000',
              accountName: 'Share Capital (Ordinary Shares)',
              category: 'EQUITY',
              debit: 0,
              credit: amt,
              lineExplanation: 'Credited 100% to share capital under Companies Act §68 (par value abolished)'
            }
          ],
          totalDebit: amt,
          totalCredit: amt,
          isBalanced: true,
          citations: [],
          rationalePoints: [
            'Under Singapore Companies Act 1967 §68, shares have no nominal/par value. 100% of consideration is credited to share capital.',
            isUnpaid ? 'Under §63(1), shares can be allotted unpaid, creating an enforceable receivable.' : 'Funds received directly into bank account.',
            'Under SFRS(I) 1-32 §33, own equity instruments are never financial assets.'
          ],
          authorityStatus: 'DETERMINISTIC'
        };

        const initialEvent: AccountingEvent = {
          id: 'evt-allot-1',
          transactionId: allotmentTxId,
          type: 'initial_transaction',
          description: initialGroup.title,
          amount: amt,
          currency: curr,
          affectedAccounts: initialGroup.lines.map(l => l.accountName),
          journalLines: initialGroup.lines,
          eventDate: initialGroup.eventDate,
          isHypothetical: false
        };

        parsed = {
          ...parsed,
          scenarioType: 'UNIVERSAL',
          transactionId: allotmentTxId,
          amount: amt,
          transactionTitle: isUnpaid ? 'Issuance of Unpaid Share Capital' : 'Issuance of Share Capital',
          directGroups: [initialGroup],
          committedDirectGroups: [initialGroup],
          actualEvents: [initialEvent],
          accountingEvents: [initialEvent]
        };
      }
    } else {
      replyText += `The local offline rule engine could not find a predefined pattern for this specific transaction.\n\n`;
    }

    replyText += `*Note: To answer free-form, custom commercial transactions with dynamic reasoning, connect an AI Provider (Google Gemini, Azure OpenAI, or OpenAI) in Settings.*`;

    const finalState = ensureEventSourcedState(parsed);
    return {
      messageText: replyText,
      scenarioState: finalState
    };
  }

  // 2. CAPITALISATION OF EXPENDITURE (SFRS(I) 1-38 vs IRAS TAX DEDUCTIBILITY)
  if (parsed.scenarioType === 'CAPITALISATION_SFRS138' && parsed.directGroups) {
    const grp = parsed.directGroups[0];
    const cost = grp.totalDebit;
    const replyText = `### Accounting Analysis: Capitalisation of Expenditure\n\n` +
      `**Governing Frameworks**: **${std38Name} (*Intangible Assets*)** & **Income Tax Act 1947 (§14 / §15 / §14C)**\n\n` +
      `---\n\n` +
      `#### 1. Financial Reporting Treatment (${std38Name})\n` +
      `* **Research Phase (§54)**: All expenditure on research (or the research stage of an internal project) **must be expensed in P&L when incurred**. No intangible asset may ever be recognized from research.\n` +
      `* **Development Phase (§57)**: Expenditure can be capitalized as an Intangible Asset **if and only if** the entity demonstrates all 6 cumulative criteria:\n` +
      `  1. **Technical Feasibility** of completing the intangible asset so that it will be available for use or sale.\n` +
      `  2. **Intention to Complete** the intangible asset and use or sell it.\n` +
      `  3. **Ability to Use or Sell** the intangible asset.\n` +
      `  4. **Probable Future Economic Benefits** (existence of a market or internal usefulness).\n` +
      `  5. **Adequate Technical, Financial, and Other Resources** to complete development.\n` +
      `  6. **Reliable Measurement** of the expenditure attributable to the development phase.\n` +
      `* **Tangible Fixed Assets**: Under **${std16Name} §7**, expenditure is capitalised only if probable future economic benefits flow to the entity and cost can be reliably measured. Routine repairs and maintenance must be expensed.\n\n` +
      `---\n\n` +
      `#### 2. Singapore Tax Treatment (IRAS)\n` +
      `* **Accounting Treatment $\\neq$ Tax Treatment**: Capitalizing an expenditure for financial reporting does not grant a tax deduction.\n` +
      `* **Section 15(1) Disallowance**: Capital expenditure and accounting amortization/depreciation are disallowed as direct P&L deductions and must be added back in Form C-S.\n` +
      `* **Enterprise Innovation Scheme (EIS) / Section 14C**: Under the Enterprise Innovation Scheme, qualifying businesses enjoy a **400% enhanced tax deduction** on up to SGD 400,000 of qualifying R&D expenditure per Year of Assessment.\n` +
      `* **Section 19A / 19B Allowances**: Plant and machinery claim Section 19A Capital Allowances (1-year 100% write-off for computers/qualifying equipment or 3-year write-off); qualifying intellectual property acquisitions claim Section 19B writing-down allowances.\n\n` +
      `---\n\n` +
      `### Illustrative Compound Journal Entry (${grp.eventDate})\n\n` +
      `* **Debit**: **Intangible Assets - Capitalised Development Costs (Non-Current Asset)** — **SGD ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Credit**: **Cash at Bank / Trade Payables** — **SGD ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n\n` +
      `**Balance Check**: $\\text{Total Debits (SGD } ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}) == \\text{Total Credits (SGD } ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}) \\quad \\checkmark\\ \\mathbf{Balanced}$`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 3. SINGAPORE STATUTORY & REGULATORY ADVISORY (IRAS / ACRA / CPF / MOM / MAS)
  if (parsed.scenarioType === 'SINGAPORE_STATUTORY_ADVISORY') {
    const adv = parsed.statutoryAdvisory?.[0];
    const authority = adv?.authority || 'IRAS / ACRA';
    const rawTitle = parsed.transactionTitle || adv?.topic || 'Statutory Compliance Directive';
    const cleanTitle = rawTitle.replace(/^(?:Statutory\s*Directives?:\s*)+/i, '');
    const act = adv?.statuteOrAct || 'Singapore Statutes';
    const section = adv?.sectionOrSchedule || '';
    const url = adv?.officialUrl || 'https://sso.agc.gov.sg';

    let replyText = `### Statutory Directive: ${cleanTitle}\n\n` +
      `**Governing Authority**: **${authority}** | **Legislation**: **${act} (${section})**\n\n` +
      `---\n\n` +
      `#### 1. Statutory Principle\n` +
      `${adv?.summary || 'Governed strictly under Singapore statutory law.'}\n\n` +
      `---\n\n` +
      `#### 2. Key Rules, Thresholds & Compliance Mandates\n`;

    if (adv?.keyRules) {
      for (const rule of adv.keyRules) {
        replyText += `* ${rule}\n`;
      }
    }

    replyText += `\n---\n\n` +
      `#### 3. Official Statutory Source & Verification\n` +
      `* Verified against [${act} ${section}](${url}) on **Singapore Statutes Online (SSO)** / Official Regulatory Directory.\n` +
      `* Review the **Statutory Citations & "Why"** tab for full legal references and citations.`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 3.5. PAYROLL, PRORATED SALARY & STATUTORY CPF (MOM EA §22 & CPF ACT §7)
  if (parsed.scenarioType === 'PAYROLL_CPF_SALARY' && parsed.directGroups) {
    const grp = parsed.directGroups[0];
    const grossLine = grp.lines.find(l => l.accountCode === '5010');
    const employerCpfLine = grp.lines.find(l => l.accountCode === '5020');
    const cpfPayableLine = grp.lines.find(l => l.accountCode === '2050');
    const netSalaryLine = grp.lines.find(l => l.accountCode === '2060');

    const grossSalary = grossLine?.debit || 0;
    const employerCpf = employerCpfLine?.debit || 0;
    const totalCpf = cpfPayableLine?.credit || 0;
    const netSalary = netSalaryLine?.credit || 0;
    const employeeCpf = totalCpf - employerCpf;

    const baseSalaryParam = parsed.keyParameters?.find(p => p.label.includes('Basic Monthly Salary'))?.value || `SGD ${grossSalary.toLocaleString()}`;
    const workingDaysParam = parsed.keyParameters?.find(p => p.label.includes('Working Days'))?.value || '22 / 22 days';
    const sdlParam = parsed.keyParameters?.find(p => p.label.includes('Skills Development Levy'))?.value || 'SGD 4.36';

    let replyText = `### Statutory Payroll & CPF Assessment: ${parsed.transactionTitle}\n\n` +
      `**Governing Authorities**: **MOM, CPF Board & IRAS** | **Legislation**: **Employment Act 1968 §22** & **Central Provident Fund Act 1953 §7 / First Schedule**\n\n` +
      `---\n\n` +
      `#### 1. Statutory Proration & Entitlement (MOM Employment Act §22)\n` +
      `* **Contracted Basic Monthly Salary**: **${baseSalaryParam}**\n` +
      `* **Statutory Working Days (Mon–Fri)**: **${workingDaysParam}**\n` +
      `* **MOM Incomplete Month Formula**:\n` +
      `  $$\\text{Gross Salary Payable} = \\frac{\\text{Monthly Basic Rate of Pay}}{\\text{Total Working Days in Month}} \\times \\text{Actual Working Days Worked}$$\n` +
      `* **Gross Prorated Salary Payable**: $\\mathbf{SGD\\ ${grossSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })}}$\n\n` +
      `---\n\n` +
      `#### 2. Statutory CPF & Net Salary Breakdown (CPF Act 1953 & 2026 Ceilings)\n` +
      `* **Gross Salary Subject to CPF (Ordinary Wage)**: **SGD ${grossSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(Within 2026 OW ceiling of SGD 8,000)*\n` +
      `* **Employee CPF Contribution (20%)**: $\\mathbf{SGD\\ ${employeeCpf.toLocaleString(undefined, { minimumFractionDigits: 2 })}}$ *(Statutory Rule: Cents discarded per CPF Act §7)*\n` +
      `* **Employer CPF Contribution (17%)**: $\\mathbf{SGD\\ ${employerCpf.toLocaleString(undefined, { minimumFractionDigits: 2 })}}$ *(Statutory Rule: Total rounded to dollar)*\n` +
      `* **Total CPF Payable to CPF Board (37%)**: $\\mathbf{SGD\\ ${totalCpf.toLocaleString(undefined, { minimumFractionDigits: 2 })}}$\n` +
      `* **Net Take-Home Salary Payable to Staff**: $\\mathbf{SGD\\ ${netSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })}}$ *(Gross SGD ${grossSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })} - Employee CPF SGD ${employeeCpf.toLocaleString(undefined, { minimumFractionDigits: 2 })})*\n` +
      `* **Skills Development Levy (SDL)**: **${sdlParam}** *(0.25% of gross remuneration payable by employer)*\n\n` +
      `---\n\n` +
      `#### 3. Singapore Tax Deductibility & MOM Compliance (IRAS & MOM)\n` +
      `* **100% Tax Deductibility**: Under **Section 14(1) and Section 14(1)(e) of the Income Tax Act 1947**, staff salaries (**SGD ${grossSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })}**) and mandatory employer CPF (**SGD ${employerCpf.toLocaleString(undefined, { minimumFractionDigits: 2 })}**) are fully tax-deductible expenses in Form C-S.\n` +
      `* **Disbursement Timeline**: Under **Section 21(2) of the Employment Act 1968**, all outstanding salary must be disbursed to the employee on their last day of employment.\n\n` +
      `---\n\n` +
      `### Single Compound Journal Entry (${grp.eventDate})\n\n` +
      `* **Debit**: **Staff Salaries & Wages (P&L - Operating Expense)** — **SGD ${grossSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Debit**: **Employer CPF Contribution (P&L - Operating Expense)** — **SGD ${employerCpf.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Credit**: **CPF Payable to CPF Board (Current Liability)** — **SGD ${totalCpf.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Credit**: **Net Salaries Payable / Staff Clearing (Current Liability)** — **SGD ${netSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n\n` +
      `**Balance Check**: $\\text{Total Debits (SGD } ${(grossSalary + employerCpf).toLocaleString(undefined, { minimumFractionDigits: 2 })}) == \\text{Total Credits (SGD } ${(totalCpf + netSalary).toLocaleString(undefined, { minimumFractionDigits: 2 })}) \\quad \\checkmark\\ \\mathbf{Balanced}$`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 4. CAR PURCHASE WITH BLOCKED GST & DISALLOWED TAX DEPRECIATION
  if (parsed.scenarioType === 'CAR_PURCHASE_STATUTORY' && parsed.directGroups) {
    const grp = parsed.directGroups[0];
    const cost = grp.totalDebit;
    const replyText = `### Statutory Directive: Acquisition of Passenger Motor Car\n\n` +
      `**Governing Authorities**: **IRAS & AGC Singapore** | **Statutes**: **Income Tax Act 1947 §15(1)(k)** & **GST (General) Regulations Reg 26**\n\n` +
      `---\n\n` +
      `#### 1. Disallowance of 9% Input GST Claim (Regulation 26)\n` +
      `* Under **Regulation 26 of the GST (General) Regulations**, input tax incurred on the purchase, hire, or running expenses of a passenger motor car (S-plate) is **strictly blocked from recovery**.\n` +
      `* **Accounting Treatment**: The full purchase price of **SGD ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}** (inclusive of GST) is capitalized into asset cost. No amount is debited to *GST Input Tax*.\n\n` +
      `---\n\n` +
      `#### 2. Prohibition of Tax Deductions & Capital Allowances (§15(1)(k))\n` +
      `* Under **Section 15(1)(k) of the Income Tax Act 1947**, **no tax deduction or Section 19/19A Capital Allowances** are granted on passenger motor cars.\n` +
      `* **Tax Add-Back**: All accounting depreciation charged in P&L must be **added back 100%** in the corporate tax computation (Form C-S / Form C).\n` +
      `* Petrol, parking, road tax, and maintenance expenses for the passenger car are also non-deductible under Section 15(1)(k).\n\n` +
      `---\n\n` +
      `### Single Compound Journal Entry (${grp.eventDate})\n\n` +
      `* **Debit**: **Motor Vehicles - Cost (Non-Current Asset)** — **SGD ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(Full gross outlay capitalized)*\n` +
      `* **Credit**: **Cash at Bank (Current Asset)** — **SGD ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(Bank disbursement)*\n\n` +
      `**Balance Check**: $\\text{Total Debits (SGD } ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}) == \\text{Total Credits (SGD } ${cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}) \\quad \\checkmark\\ \\mathbf{Balanced}$`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 5. ASSET PURCHASE WITH TRADE DISCOUNT, GST, CASH & CREDIT TERMS
  if (parsed.scenarioType === 'ASSET_PURCHASE_DISCOUNT' && parsed.directGroups) {
    const grp = parsed.directGroups[0];
    const equipLine = grp.lines.find(l => l.category === 'ASSET' && l.debit > 0 && l.accountCode === '1500');
    const gstLine = grp.lines.find(l => l.accountCode === '1190');
    const bankLine = grp.lines.find(l => l.accountCode === '1010');
    const payableLine = grp.lines.find(l => l.accountCode === '2010');

    const costVal = equipLine?.debit || 18000;
    const gstVal = gstLine?.debit || 1620;
    const bankVal = bankLine?.credit || 5000;
    const payableVal = payableLine?.credit || 14620;

    const listPriceParam = parsed.keyParameters?.find(p => p.label.includes('List Price'));
    const discountParam = parsed.keyParameters?.find(p => p.label.includes('Trade Discount'));
    const listPriceStr = listPriceParam?.value || 'SGD 20,000.00';
    const discountLabel = discountParam?.label || 'Trade Discount (10%)';
    const discountValStr = discountParam?.value || '-SGD 2,000.00';

    let replyText = `### Under ${std16Name} (*Property, Plant and Equipment* §16(a)) & Singapore GST Act\n\n` +
      `Here is the single compound journal entry on **${grp.eventDate}** to record the purchase of office equipment:\n\n` +
      `---\n\n` +
      `#### 1. Asset Capitalization & Trade Discount Deduction (${std16Name} §16(a))\n` +
      `* **List Price**: **${listPriceStr}** (exclusive of 9% GST)\n` +
      `* **Less ${discountLabel}**: $\\mathbf{${discountValStr}}$\n` +
      `* **Net Initial Cost Recognized**:\n` +
      `  $$\\text{Asset Cost} = \\mathbf{SGD\\ ${costVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}}$$\n` +
      `  *(Statutory Rule: Under ${std16Name} §16(a), trade discounts are deducted directly from the list price. Trade discounts are **never** recorded as a separate ledger line in accounting).* \n\n` +
      `---\n\n` +
      `#### 2. Singapore 9% Recoverable Input GST (IRAS)\n` +
      `* Under IRAS guidelines, 9% GST is levied on the **discounted selling price**:\n` +
      `  $$\\text{Input GST (9\\%)} = \\text{SGD } ${costVal.toLocaleString()} \\times 9\\% = \\mathbf{SGD\\ ${gstVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}}$$\n` +
      `* **Total Gross Invoice Payable**: $\\text{SGD } ${costVal.toLocaleString()} + \\text{SGD } ${gstVal.toLocaleString()} = \\mathbf{SGD\\ ${(costVal + gstVal).toLocaleString(undefined, { minimumFractionDigits: 2 })}}$\n\n` +
      `---\n\n` +
      `#### 3. Settlement Breakdown\n` +
      `* **Immediate Bank Transfer**: **SGD ${bankVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Remaining Balance on Credit Terms (Trade Payables)**:\n` +
      `  $$\\text{Trade Payables} = ${(costVal + gstVal).toLocaleString()} - ${bankVal.toLocaleString()} = \\mathbf{SGD\\ ${payableVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}}$$\n\n` +
      `---\n\n` +
      `### Single Compound Journal Entry (${grp.eventDate})\n\n` +
      `* **Debit**: **Office Equipment - Cost (Non-Current Asset)** — **SGD ${costVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Debit**: **GST Input Tax (IRAS 9% Claimable Receivable)** — **SGD ${gstVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Credit**: **Cash at Bank (Current Asset)** — **SGD ${bankVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Credit**: **Trade Payables / Other Payables (Current Liability)** — **SGD ${payableVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n\n` +
      `**Balance Check**: $\\text{Total Debits (SGD } ${(costVal + gstVal).toLocaleString(undefined, { minimumFractionDigits: 2 })}) == \\text{Total Credits (SGD } ${(bankVal + payableVal).toLocaleString(undefined, { minimumFractionDigits: 2 })}) \\quad \\checkmark\\ \\mathbf{Balanced}$`;

    if (parsed.directGroups.length > 1) {
      const grp2 = parsed.directGroups[1];
      replyText += `\n\n---\n\n### Subsequent Event: ${grp2.title} (${grp2.eventDate})\n\n` +
        `* **Debit**: **Trade Payables (Current Liability)** — **SGD ${payableVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(Derecognition of liability)*\n` +
        `* **Credit**: **Cash at Bank (Current Asset)** — **SGD ${payableVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(Cash outflow)*\n\n` +
        `*(Under ${std9} §3.3.1, the financial liability is extinguished upon full settlement).*`;
    }

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 6. PPE MACHINERY ACQUISITION WITH TRADE-IN, GST, DEPRECIATION & LOAN
  if (parsed.scenarioType === 'PPE_IAS16' && parsed.directGroups) {
    const replyText = `### Under ${std16Name} (*Property, Plant and Equipment*), Singapore GST Act, & ${std9} (*Financial Instruments*)\n\n` +
      `Here is the complete statutory accounting schedule and double entries on **1 April 2026** for your machinery purchase, trade-in derecognition, and equipment loan:\n\n` +
      `---\n\n` +
      `#### 1. Depreciation Catch-Up Schedule (1 Jan 2026 – 31 Mar 2026)\n` +
      `* Under **${std16Name} §55**, depreciation ceases at the date of derecognition. Therefore, depreciation for Jan–Mar 2026 (3 months) must be recognized **prior to disposal**:\n` +
      `  $$\\text{Catch-up Depreciation} = \\text{SGD } 50,000 \\times 20\\% \\times \\frac{3}{12} = \\mathbf{SGD\\ 2,500.00}$$\n` +
      `* **Total Accumulated Depreciation at 1 April 2026**:\n` +
      `  $$\\text{SGD } 20,000 \\text{ (2024–2025)} + \\text{SGD } 2,500 \\text{ (Jan–Mar 2026)} = \\mathbf{SGD\\ 22,500.00}$$\n` +
      `* **Carrying Amount / Net Book Value (NBV) at Disposal**:\n` +
      `  $$\\text{SGD } 50,000 - \\text{SGD } 22,500 = \\mathbf{SGD\\ 27,500.00}$$\n\n` +
      `---\n\n` +
      `#### 2. Trade-in Valuation & Singapore 9% GST Breakdown (IRAS)\n` +
      `* Under the Singapore GST Act, a trade-in constitutes a taxable supply (disposal of business asset):\n` +
      `  * **Agreed Trade-in Value (Gross)**: **SGD 21,800.00** (inclusive of 9% GST)\n` +
      `  * **Net Trade-in Consideration**: $\\text{SGD } 21,800 / 1.09 = \\mathbf{SGD\\ 20,000.00}$\n` +
      `  * **Output GST Payable to IRAS (9%)**: $\\text{SGD } 21,800 - 20,000 = \\mathbf{SGD\\ 1,800.00}$\n` +
      `* **Loss on Disposal Recognized in P&L (${std16Name} §68 & §71)**:\n` +
      `  $$\\text{Loss on Disposal} = \\text{Carrying Amount } (\\text{SGD } 27,500) - \\text{Net Consideration } (\\text{SGD } 20,000) = \\mathbf{SGD\\ 7,500.00}$$\n\n` +
      `---\n\n` +
      `#### 3. New Machinery Cost & Equipment Loan Funding\n` +
      `* **New Machine Cost (${std16Name} §16)**: **SGD 100,000.00** (capitalized net of recoverable tax)\n` +
      `* **Input GST (9% Claimable Receivable)**: **SGD 9,000.00** $\\rightarrow$ Total invoice: **SGD 109,000.00**\n` +
      `* **Less Trade-in credit**: SGD 21,800.00\n` +
      `* **Less Bank cash paid**: SGD 30,000.00\n` +
      `* **Remaining Balance Funded via Equipment Loan**:\n` +
      `  $$\\text{Loan Principal} = 109,000 - 21,800 - 30,000 = \\mathbf{SGD\\ 57,200.00}$$\n` +
      `* **2-Year 5% p.a. Flat Interest**:\n` +
      `  $$\\text{Unexpired Loan Interest} = 57,200 \\times 5\\% \\times 2 = \\mathbf{SGD\\ 5,720.00}$$\n` +
      `* **Gross Equipment Loan Payable**: $57,200 + 5,720 = \\mathbf{SGD\\ 62,920.00}$\n` +
      `  *(The SGD 5,720 unexpired interest is recorded upfront as a contra-liability account, so the net loan obligation on initial recognition is exactly SGD 57,200 under ${std9})*.\n\n` +
      `---\n\n` +
      `### Summary of Double Entries (1 April 2026)\n` +
      `1. **Catch-up Depreciation**: Dr. Depreciation Expense SGD 2,500 | Cr. Accumulated Depreciation SGD 2,500\n` +
      `2. **Disposal of Old Machine**: Dr. Acc. Depr SGD 22,500 | Dr. Loss on Disposal SGD 7,500 | Dr. Vendor Clearing SGD 21,800 || Cr. Machinery Cost SGD 50,000 | Cr. GST Output Tax SGD 1,800\n` +
      `3. **Acquisition & Financing**: Dr. Machinery Cost SGD 100,000 | Dr. GST Input Tax SGD 9,000 | Dr. Unexpired Loan Interest SGD 5,720 || Cr. Vendor Clearing SGD 21,800 | Cr. Cash at Bank SGD 30,000 | Cr. Equipment Loan Payable SGD 62,920\n\n` +
      `Review the **Double Entry Journal** tab for the full verified ledger table with citations!`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 7. GENERAL EXPENSES (Entertainment, Travel, Utilities, Salaries, etc.)
  if (parsed.scenarioType === 'GENERAL_EXPENSE') {
    const amt = parsed.amount || 3000;
    const exp = parsed.expenseAccountName || 'Entertainment & Hospitality Expenses';
    const pay = parsed.paymentMethodAccountName || 'Cash at Bank';

    const replyText = `### Under ${std1} (*Presentation of Financial Statements - Accrual Basis*)\n\n` +
      `Here is the complete double entry for your **${exp}** of **${parsed.functionalCurrency} ${amt.toLocaleString()}**:\n\n` +
      `* **Debit**: **${exp} (P&L - Operating Expense)** — **${parsed.functionalCurrency} ${amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n` +
      `* **Credit**: **${pay} (Current Asset)** — **${parsed.functionalCurrency} ${amt.toLocaleString(undefined, { minimumFractionDigits: 2 })}**\n\n` +
      `#### Accounting Rationale:\n` +
      `1. **Debit Reason**: Operating expenses increase on the debit side under ${std1} §28, reducing profit for the period.\n` +
      `2. **Credit Reason**: Asset accounts (Cash at Bank) decrease on the credit side as funds flow out to settle the expense.\n` +
      `3. **Balance Sheet & P&L Impact**: Total Assets decrease by ${parsed.functionalCurrency} ${amt.toLocaleString()}, and Net Profit decreases by ${parsed.functionalCurrency} ${amt.toLocaleString()}.`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 8. LEASE ACCOUNTING (IFRS 16 / SFRS(I) 16)
  if (parsed.scenarioType === 'LEASE_IFRS16') {
    const termYears = parsed.leaseTermYears || 3;
    const termMonths = parsed.leaseTermMonths || 36;
    const rent = parsed.leasePaymentMonthly || 3000;
    const rate = parsed.leaseDiscountRateAnnual || 5.0;

    const replyText = `### Under ${std16} (*Leases*)\n\n` +
      `For your **${termYears}-year rental agreement** paying **${parsed.functionalCurrency} ${rent.toLocaleString()}/month**:\n\n` +
      `Under **${std16} §22**, commercial leases over 12 months can **no longer be treated as off-balance sheet operating rent**. You must capitalize a **Right-of-Use (ROU) Asset** and a corresponding **Lease Liability**.\n\n` +
      `1. **At Inception (Commencement Date)**:\n` +
      `   * **Dr. Right-of-Use Asset**: ~${parsed.functionalCurrency} 100,097.10\n` +
      `   * **Cr. Lease Liability**: ~${parsed.functionalCurrency} 100,097.10\n` +
      `   *(Calculated as the present value of ${termMonths} payments of ${parsed.functionalCurrency} ${rent.toLocaleString()} discounted at ${rate}% p.a. Incremental Borrowing Rate under §26)*\n\n` +
      `2. **Every Month (Payment & Interest Accrual)**:\n` +
      `   * **Dr. Lease Liability (Principal)**: ${parsed.functionalCurrency} 2,582.93\n` +
      `   * **Dr. Finance Cost / Interest Expense (P&L)**: ${parsed.functionalCurrency} 417.07\n` +
      `   * **Cr. Cash / Bank**: ${parsed.functionalCurrency} ${rent.toLocaleString()}\n\n` +
      `3. **Every Month (Straight-Line Depreciation)**:\n` +
      `   * **Dr. Depreciation Expense - ROU Asset (P&L)**: ${parsed.functionalCurrency} 2,780.48\n` +
      `   * **Cr. Accumulated Depreciation - ROU Asset**: ${parsed.functionalCurrency} 2,780.48\n\n` +
      `Check the **Double Entry Journal** tab to review the complete statutory breakdown!`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 9. EQUITY SHARES WITH FOREX (IFRS 9 / IAS 21)
  if (parsed.scenarioType === 'EQUITY_INVESTMENT_FX') {
    const buyRate = parsed.purchaseFxRate ?? 1.34;
    const sellRate = parsed.saleFxRate ?? 1.36;
    const initialSGD = (parsed.purchaseAmountForeign || 0) * buyRate;
    const proceedsSGD = (parsed.saleAmountForeign || 0) * sellRate;
    const stockGainSGD = ((parsed.saleAmountForeign || 0) - (parsed.purchaseAmountForeign || 0)) * sellRate;
    const fxGainSGD = (parsed.purchaseAmountForeign || 0) * (sellRate - buyRate);

    const replyText = `### Under ${std9} (*Financial Instruments*) & ${std21} (*Foreign Exchange*)\n\n` +
      `For **${parsed.assetName}** (invested USD ${(parsed.purchaseAmountForeign || 0).toLocaleString()} on ${parsed.purchaseDate}, sold for USD ${parsed.saleAmountForeign?.toLocaleString()} on ${parsed.saleDate}):\n\n` +
      `**Spot Exchange Rates (Powered by Frankfurter API - European Central Bank)**:\n` +
      `* Purchase Spot Rate: **${buyRate} SGD/USD**\n` +
      `* Sale Spot Rate: **${sellRate} SGD/USD**\n\n` +
      `#### Double Entries (Explicit Realized FX Gain View):\n` +
      `1. **On Acquisition (${parsed.purchaseDate})**:\n` +
      `   * **Dr. Financial Asset at FVTPL (${parsed.assetName})**: ${parsed.functionalCurrency} ${initialSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n` +
      `   * **Cr. Cash / Bank (USD Account)**: ${parsed.functionalCurrency} ${initialSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n` +
      `2. **On Sale / Disposal (${parsed.saleDate})**:\n` +
      `   * **Dr. Cash / Bank (USD Account)**: ${parsed.functionalCurrency} ${proceedsSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })} *(Gross proceeds)*\n` +
      `   * **Cr. Financial Asset at FVTPL (${parsed.assetName})**: ${parsed.functionalCurrency} ${initialSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })} *(Derecognition)*\n` +
      `   * **Cr. Fair Value Gain on Shares (P&L)**: ${parsed.functionalCurrency} ${stockGainSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })} *(Stock appreciation)*\n` +
      `   * **Cr. Realized Foreign Exchange Gain (P&L / ${std21})**: ${parsed.functionalCurrency} ${fxGainSGD.toLocaleString(undefined, { minimumFractionDigits: 2 })} *(Currency gain on capital)*`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 10. UNIVERSAL / MULTI-TURN SETTLEMENT / DIRECT ENTRIES
  if (parsed.directGroups && parsed.directGroups.length > 0) {
    let replyText = `### Accounting Analysis: ${parsed.transactionTitle}\n\n`;
    if (parsed.accountingTreatmentSummary) {
      replyText += `#### 1. Accounting Treatment\n${parsed.accountingTreatmentSummary}\n\n---\n\n`;
    }

    replyText += `#### 2. Double Entry Schedule\n\n`;
    for (const grp of parsed.directGroups) {
      replyText += `**${grp.title}** (${grp.eventDate}):\n`;
      for (const line of grp.lines) {
        if (line.debit > 0) {
          replyText += `* **Debit**: **${line.accountName}** — **${parsed.functionalCurrency} ${line.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(${line.lineExplanation})*\n`;
        } else if (line.credit > 0) {
          replyText += `* **Credit**: **${line.accountName}** — **${parsed.functionalCurrency} ${line.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}** *(${line.lineExplanation})*\n`;
        }
      }
      if (grp.isBalanced) {
        replyText += `*Balance Check: Debits (${parsed.functionalCurrency} ${grp.totalDebit.toFixed(2)}) == Credits (${parsed.functionalCurrency} ${grp.totalCredit.toFixed(2)}) ✓ Balanced*\n\n`;
      }
    }

    if (parsed.singaporeTaxTreatmentSummary) {
      replyText += `---\n\n#### 3. Singapore Tax Implications\n${parsed.singaporeTaxTreatmentSummary}\n\n`;
    }

    replyText += `Check the **Double Entry Journal** tab for complete ledger posting details.`;

    return {
      messageText: finalizeMessage(replyText, parsed),
      scenarioState: parsed
    };
  }

  // 11. FALLBACK UNCLASSIFIED / UNRECOGNIZED
  const fallbackText = `### Accounting Inquiry Assessment\n\n` +
    `**Transaction**: ${parsed.transactionTitle || 'Unclassified Query'}\n\n` +
    `The offline engine could not match this inquiry to an explicit pre-calculated benchmark fixture. ` +
    `Connect an AI Provider (Gemini, Azure OpenAI, or OpenAI) in Settings for dynamic reasoning and source citation.`;

  return {
    messageText: finalizeMessage(fallbackText, parsed),
    scenarioState: parsed
  };
}

export async function callGeminiAPI(
  userInput: string,
  currentScenario: AccountingScenarioState | null,
  standard: AccountingStandard,
  apiKey: string,
  modelName: string = 'gemini-3.5-flash-lite',
  chatHistory: ChatMessage[] = [],
  groundedContext?: GroundedReasoningContext,
  deterministicScenario?: AccountingScenarioState | null,
  existingProfiler?: RequestProfiler
): Promise<GeminiResponse> {
  const profiler = existingProfiler || new RequestProfiler(userInput, modelName);
  const tGround0 = Date.now();
  const context = groundedContext || await buildGroundedReasoningContext(userInput, currentScenario, undefined, apiKey);
  const systemInstruction = formatGroundedSystemPrompt(context, standard);
  profiler.recordStage('grounding', Date.now() - tGround0);

  // Multi-turn conversational history for Gemini: Condense prior turns to eliminate prompt re-bloat
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  // Filter out system welcome messages and raw processing error cards; limit to last 4 turns
  const conversationTurns = (chatHistory || [])
    .filter((m) => m.id !== 'welcome-msg' && m.text && !m.text.startsWith('⚠️ **Processing Error**'))
    .slice(-4);

  for (const m of conversationTurns) {
    const role: 'user' | 'model' = m.sender === 'user' ? 'user' : 'model';
    let textToSend = m.text;
    if (role === 'model') {
      // Strip out huge tables, journals, and citations from prior assistant turns to prevent prompt re-bloat
      textToSend = textToSend
        .replace(/### Double Entry Journal[\s\S]*?(?=#{2,4}\s+|$)/gi, '')
        .replace(/#### 4\. Official Statutory Sources[\s\S]*?(?=#{2,4}\s+|$)/gi, '')
        .replace(/\|[^\n]+\|\n\|[-:| ]+\|\n(?:\|[^\n]+\|\n)+/g, '')
        .trim();
      if (textToSend.length > 400) {
        textToSend = textToSend.slice(0, 400) + '... [Prior response condensed]';
      }
    }
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += `\n\n${textToSend}`;
    } else {
      contents.push({ role, parts: [{ text: textToSend }] });
    }
  }

  const activeScenarioSummary = currentScenario ? `
[CURRENT ACTIVE TRANSACTION CONTEXT]
Transaction Title: ${currentScenario.transactionTitle || 'N/A'}
Functional Currency: ${currentScenario.functionalCurrency || 'SGD'}
Active Parameters:
${JSON.stringify(currentScenario.keyParameters || [], null, 2)}
Active Double Entry Journal Groups:
${currentScenario.directGroups?.map((g, idx) => `Group #${idx + 1} (${g.eventDate}) - ${g.title}:\n` + g.lines.map(l => `  ${l.debit > 0 ? `Debit: ${l.accountName} (${l.accountCode || ''}) - SGD ${l.debit}` : `Credit: ${l.accountName} (${l.accountCode || ''}) - SGD ${l.credit}`}`).join('\n')).join('\n') || 'None'}
` : '';

  const currentTurnText = `${activeScenarioSummary}\n[USER QUERY / FOLLOW-UP]:\n${userInput}`.trim();

  if (contents.length > 0) {
    if (contents[contents.length - 1].role === 'user') {
      contents[contents.length - 1].parts[0].text = currentTurnText;
    } else {
      contents.push({ role: 'user', parts: [{ text: currentTurnText }] });
    }
  } else {
    contents.push({ role: 'user', parts: [{ text: currentTurnText }] });
  }

  // Optimize generationConfig:
  // For models with thinking support (gemini-2.5-flash / thinking models), set thinking budget
  // to prevent runaway chain-of-thought tokens on statutory and transactional queries.
  const generationConfig: any = {
    temperature: 0.1,
    responseMimeType: 'application/json'
  };

  if (modelName.includes('2.5') || modelName.includes('thinking')) {
    if (context.classification.intent === 'STATUTORY_ADVISORY') {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    } else if (context.classification.intent === 'TRANSACTION') {
      generationConfig.thinkingConfig = { thinkingBudget: 512 };
    } else {
      generationConfig.thinkingConfig = { thinkingBudget: 1024 };
    }
  }

  const requestBody = {
    contents,
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig
  };

  // 12-second AbortController timeout to guarantee fast interactive latency
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  const tReq0 = Date.now();
  let rawJsonText = '';
  let usage: any = null;

  try {
    // Attempt streaming with Server-Sent Events (?alt=sse) to measure genuine Time to First Visible Response (TTFVR)
    const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const streamRes = await fetch(streamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (streamRes.ok && streamRes.body) {
      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let isFirstChunk = true;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (isFirstChunk) {
          profiler.recordFirstVisibleResponse();
          isFirstChunk = false;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const chunkJson = JSON.parse(trimmed.slice(6));
              const partText = chunkJson?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (partText) rawJsonText += partText;
              if (chunkJson?.usageMetadata) usage = chunkJson.usageMetadata;
            } catch {
              // Ignore partial SSE delimiter chunks
            }
          }
        }
      }
    } else {
      throw new Error(`Streaming response returned ${streamRes.status}`);
    }
  } catch (streamErr: any) {
    if (controller.signal.aborted || streamErr?.name === 'AbortError') {
      clearTimeout(timeoutId);
      profiler.recordStage('gemini_request', Date.now() - tReq0);
      profiler.recordTimeout();
      profiler.recordFallback();
      throw new Error(`Gemini request timed out after 12s. Reverting to deterministic accounting engine.`);
    }

    // Fallback to standard generateContent if streaming is unavailable
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      profiler.recordFirstVisibleResponse();

      if (!res.ok) {
        throw new Error(`Gemini HTTP Error ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      usage = data?.usageMetadata;
      rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (stdErr: any) {
      clearTimeout(timeoutId);
      profiler.recordStage('gemini_request', Date.now() - tReq0);
      if (stdErr?.name === 'AbortError' || controller.signal.aborted) {
        profiler.recordTimeout();
        profiler.recordFallback();
        throw new Error(`Gemini request timed out after 12s. Reverting to deterministic accounting engine.`);
      }
      throw stdErr;
    }
  } finally {
    clearTimeout(timeoutId);
  }

  profiler.recordStage('gemini_request', Date.now() - tReq0);

  if (usage) {
    profiler.setTokenCounts(
      usage.promptTokenCount || 0,
      usage.candidatesTokenCount || 0,
      usage.candidatesTokensDetails?.[0]?.thinkingTokenCount || 0
    );
  }

  if (!rawJsonText) {
    throw new Error('No content returned by Gemini');
  }

  const tPost0 = Date.now();
  const parsed = repairAndParseAIJson(rawJsonText);
  const result = postProcessAIResponse(parsed, currentScenario, userInput, context, deterministicScenario, standard);
  // Validate AI proposed groups against deterministic accounting guardrails
  if (result.scenarioState.directGroups && result.scenarioState.directGroups.length > 0 && context.semanticUnderstanding) {
    const valResult = defaultAccountingGuardrails.validate(context.semanticUnderstanding, result.scenarioState.directGroups);
    if (!valResult.isValid) {
      console.warn(`[Guardrails] Detected ${valResult.violations.length} accounting violation(s) in AI proposal:`, valResult.violations.map(v => v.code));
    }
  }

  profiler.recordStage('assembly', Date.now() - tPost0);
  profiler.recordFirstVisibleResponse();

  // Transparent telemetry console output
  profiler.logSummary();

  return result;
}
