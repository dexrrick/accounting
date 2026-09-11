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
import type { GroundedReasoningContext } from '../services/groundingContextBuilder';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { defaultCitationVerifier } from '../verification/citationVerifier';
import { appendStatutorySourceFooter, getSafeOfficialUrl } from '../utils/statutoryLinkResolver';
import { formatSingaporeDate } from '../utils/dateUtils';

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

  const hasAuthoritativeDeterministicEntries = Boolean(
    isRecognizedDeterministicFixture &&
    deterministicScenario!.directGroups &&
    deterministicScenario!.directGroups.length > 0
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

    const safeUrl = verification.matchedRecord?.officialSourceUrl ||
      getSafeOfficialUrl(cite.officialSourceUrl, cite.standard, cite.paragraph, cite.authority as any) ||
      cite.officialSourceUrl;

    verifiedCitations.push({
      standard: cite.standard || '',
      paragraph: cite.paragraph || '',
      title: (cite as any).title || verification.matchedRecord?.documentTitle || `${cite.standard} ${cite.paragraph}`,
      text: (cite as any).text || verification.matchedRecord?.sourceText || '',
      authority: (cite.authority || verification.matchedRecord?.authorityName || 'SSO') as any,
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

  if (hasAuthoritativeDeterministicEntries) {
    // Deterministic engine calculations strictly govern
    directGroups = deterministicScenario!.directGroups!.map(grp => ({
      ...grp,
      authorityStatus: grp.authorityStatus || authorityStatus
    }));
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
      const debitsCount = compact.requiredAccounts.filter(a => a.debitCredit === 'DEBIT').length;
      const creditsCount = compact.requiredAccounts.filter(a => a.debitCredit === 'CREDIT').length;

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
          lineExplanation: acc.rationale || `Recognition of ${acc.accountName}`
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

  // 4. Assemble Statutory Advisories
  const statutoryAdvisory: StatutoryAdvisoryInfo[] = [
    ...(deterministicScenario?.statutoryAdvisory || []),
    ...(compact.statutoryAdvisory || [])
  ];

  if (statutoryAdvisory.length === 0 && (compact.keyRules || compact.directAnswer)) {
    const domain = groundedContext.classification.primaryDomain;
    const primaryAuth = (domain === 'EMPLOYMENT' ? 'MOM'
      : domain === 'PAYROLL' ? 'CPF'
      : domain === 'CORPORATE_REGULATORY' ? 'ACRA'
      : 'IRAS') as any;

    statutoryAdvisory.push({
      authority: primaryAuth,
      statuteOrAct: primaryAuth === 'MOM' ? 'Employment Act 1968' : primaryAuth === 'CPF' ? 'Central Provident Fund Act 1953' : primaryAuth === 'ACRA' ? 'Companies Act 1967' : 'Income Tax Act 1947',
      sectionOrSchedule: 'Statutory Directives',
      topic: domain,
      summary: compact.directAnswer || 'Statutory directives under Singapore law',
      keyRules: compact.keyRules || [],
      officialUrl: 'https://sso.agc.gov.sg',
      isTaxDeductible: undefined,
      isGstClaimable: undefined
    });
  }

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
      if (sem.reportingEntity?.type) {
        keyParameters.push({ label: 'Reporting Entity', value: sem.reportingEntity.type.toUpperCase(), badge: 'Perspective' });
      }
      if (sem.counterparty?.role) {
        keyParameters.push({ label: 'Counterparty', value: sem.counterparty.role.toUpperCase(), badge: 'Counterparty' });
      }
      if (sem.ownershipContext && sem.ownershipContext !== 'not_applicable') {
        keyParameters.push({ label: 'Ownership Context', value: sem.ownershipContext.toUpperCase(), badge: 'Equity' });
      }
      if (sem.paymentStatus) {
        keyParameters.push({ label: 'Payment Status', value: sem.paymentStatus.toUpperCase(), badge: 'Settlement' });
      }
      if (sem.currency?.value) {
        keyParameters.push({ label: 'Currency', value: `${sem.currency.value} (${sem.currency.source})`, badge: 'Currency' });
      }
      if (sem.amount !== undefined && sem.amount > 0) {
        keyParameters.push({ label: 'Transaction Amount', value: `${sem.currency?.value || 'SGD'} ${sem.amount.toLocaleString()}`, badge: 'Stated Fact' });
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
      ...(compact.missingFacts || [])
    ])
  ];

  // 7. Uncertainty Disclaimer
  let uncertaintyDisclaimer = compact.uncertaintyDisclaimer || deterministicScenario?.uncertaintyDisclaimer || '';
  if (missingFacts.length > 0) {
    const notice = `Conclusion is conditional upon establishing: ${missingFacts.join('; ')}.`;
    if (!uncertaintyDisclaimer.includes('conditional upon establishing')) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${notice} ${uncertaintyDisclaimer}` : notice;
    }
  }

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
          messageText += `* **${c.standard} ${c.paragraph}** (${c.authority}): [${c.title}](${c.officialSourceUrl || 'https://sso.agc.gov.sg'})\n`;
        }
      }

      if (directGroups.length > 0) {
        const grp = directGroups[0];
        messageText += `\n---\n\n### Double Entry Journal: ${grp.title} (${grp.eventDate})\n\n`;

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
      const assessmentTitle = isRecognizedDeterministicFixture
        ? (deterministicScenario?.transactionTitle || 'Financial Reporting Treatment')
        : (compact.transactionNature || compact.transactionTitle || (groundedContext.semanticUnderstanding?.transactionType ? groundedContext.semanticUnderstanding.transactionType.replace(/_/g, ' ').toUpperCase() : 'Financial Reporting Treatment'));

      messageText = `### SFRS(I) Accounting Assessment: ${assessmentTitle}\n\n` +
        `**Authority Status**: **${authorityStatus === 'DETERMINISTIC' ? '✓ Deterministic Calculations' : authorityStatus === 'CONDITIONAL' ? '⚠️ Conditional (Missing Facts)' : '🤖 AI Proposed'}**\n\n` +
        `---\n\n` +
        `#### 1. Recommended Accounting Treatment (${stdLabel})\n` +
        `${compact.treatment || deterministicScenario?.accountingTreatmentSummary || 'Treatment evaluated under Singapore Financial Reporting Standards.'}\n\n`;

      if (compact.reasoning) {
        messageText += `---\n\n#### 2. Professional Technical Reasoning\n${compact.reasoning}\n\n`;
      }

      if (compact.singaporeTaxImpact || (isRecognizedDeterministicFixture && deterministicScenario?.singaporeTaxTreatmentSummary)) {
        messageText += `---\n\n#### 3. Singapore Tax Treatment (IRAS)\n` +
          `${compact.singaporeTaxImpact || deterministicScenario?.singaporeTaxTreatmentSummary}\n\n`;
      }

      if (keyParameters.length > 0) {
        messageText += `---\n\n#### 4. Key Statutory & Computational Facts\n`;
        for (const p of keyParameters) {
          messageText += `* **${p.label}**: ${p.value}\n`;
        }
        messageText += `\n`;
      }

      if (directGroups.length > 0) {
        const grp = directGroups[0];
        messageText += `---\n\n### Double Entry Journal: ${grp.title} (${grp.eventDate})\n\n`;

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

  const resolvedScenarioType = isRecognizedDeterministicFixture
    ? deterministicScenario!.scenarioType
    : (compact.scenarioType || (queryMode === 'STATUTORY_ADVISORY' ? 'SINGAPORE_STATUTORY_ADVISORY' : 'UNIVERSAL'));

  const resolvedTransactionTitle = isRecognizedDeterministicFixture
    ? (deterministicScenario?.transactionTitle || 'Accounting & Statutory Advisory')
    : (compact.transactionNature || compact.transactionTitle || (groundedContext.semanticUnderstanding?.transactionType ? groundedContext.semanticUnderstanding.transactionType.replace(/_/g, ' ').toUpperCase() : 'Accounting & Statutory Advisory'));

  const scenarioState: AccountingScenarioState = {
    scenarioType: resolvedScenarioType,
    queryIntent: queryMode as any,
    primaryDomain: deterministicScenario?.primaryDomain || (
      groundedContext.classification.primaryDomain === 'EMPLOYMENT' ? 'MOM_EMPLOYMENT' :
      groundedContext.classification.primaryDomain === 'PAYROLL' ? 'CPF_BOARD' :
      groundedContext.classification.primaryDomain === 'CORPORATE_REGULATORY' ? 'ACRA_CORP' :
      groundedContext.classification.primaryDomain === 'TAX' ? 'IRAS_TAX' :
      groundedContext.classification.primaryDomain === 'GST' ? 'IRAS_GST' :
      'ACCOUNTING_SFRS'
    ),
    rawQuery: userInput,
    transactionTitle: resolvedTransactionTitle,
    functionalCurrency: deterministicScenario?.functionalCurrency || 'SGD',
    transactionCurrency: deterministicScenario?.transactionCurrency || (groundedContext.semanticUnderstanding?.currency?.value || 'SGD'),
    authorityStatus: finalAuthorityStatus,
    accountingTreatmentSummary: compact.treatment || (isRecognizedDeterministicFixture ? deterministicScenario?.accountingTreatmentSummary : undefined),
    singaporeTaxTreatmentSummary: compact.singaporeTaxImpact || (isRecognizedDeterministicFixture ? deterministicScenario?.singaporeTaxTreatmentSummary : undefined),
    regulatoryMandatesSummary: isRecognizedDeterministicFixture ? deterministicScenario?.regulatoryMandatesSummary : undefined,
    effectiveDateOrTiming: isRecognizedDeterministicFixture ? deterministicScenario?.effectiveDateOrTiming : undefined,
    uncertaintyDisclaimer: uncertaintyDisclaimer || undefined,
    keyParameters,
    directGroups,
    statutoryAdvisory: statutoryAdvisory.length > 0 ? statutoryAdvisory : undefined,
    assumptions: assumptions.length > 0 ? assumptions : undefined,
    missingFacts: missingFacts.length > 0 ? missingFacts : undefined,
    isComplete: !hasPendingValuation && missingFacts.length === 0 && retrievedEvidenceScope.length > 0,
    missingFields: []
  };

  return {
    messageText: appendStatutorySourceFooter(messageText, scenarioState),
    scenarioState
  };
}
