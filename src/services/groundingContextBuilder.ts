import type {
  AccountingStandard,
  AccountingScenarioState,
  ExplicitAssumption,
  QueryDomain,
  StatutoryAuthority,
  JournalEntryGroup,
  StandardCitation,
  JournalAuthorityStatus
} from '../types/accounting';
import type { QuestionClassificationResult } from '../classification/questionClassifier';
import { classifyQuestion } from '../classification/questionClassifier';
import type { ProviderSettings } from '../types/provider';
import { defaultTransactionUnderstandingService, type TransactionUnderstanding } from './transactionUnderstandingService';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import type { ISourceRetriever } from '../retrieval/sourceRetriever';
import { defaultAdvancedSourceRetriever } from '../retrieval/advancedSourceRetriever';
import { defaultCitationVerifier } from '../verification/citationVerifier';
import { appendStatutorySourceFooter, getSafeOfficialUrl } from '../utils/statutoryLinkResolver';
import { formatSingaporeDate } from '../utils/dateUtils';
import { assembleDeterministicResponse } from '../engine/responseAssembler';
import { extractAccountingContext } from './conversationAccountingState';

/**
 * Provider-neutral structured reasoning context.
 * Shared identically across Gemini, OpenAI, and Azure OpenAI adapters.
 */
export interface GroundedReasoningContext {
  classification: QuestionClassificationResult;
  userFacts: string[];
  missingFacts: string[];
  assumptions: ExplicitAssumption[];
  primaryEvidence: AuthoritativeSourceRecord[];
  officialGuidance: AuthoritativeSourceRecord[];
  curatedSummaries: AuthoritativeSourceRecord[];
  applicationRules: string[];
  currentInformationRequired: boolean;
  semanticUnderstanding?: TransactionUnderstanding;
}

/**
 * Maps query canonical domain to source retriever domain
 */
function mapCanonicalDomainToQueryDomain(domain: string): QueryDomain {
  switch (domain) {
    case 'ACCOUNTING':
      return 'ACCOUNTING_SFRS';
    case 'TAX':
      return 'IRAS_TAX';
    case 'GST':
      return 'IRAS_GST';
    case 'CORPORATE_REGULATORY':
      return 'ACRA_CORP';
    case 'EMPLOYMENT':
      return 'MOM_EMPLOYMENT';
    case 'PAYROLL':
      return 'CPF_BOARD';
    default:
      return 'GENERAL';
  }
}

/**
 * Extracts facts explicitly stated in user input.
 */
export function extractUserFacts(query: string, scenario?: AccountingScenarioState | null): string[] {
  const facts: string[] = [];
  const q = query.trim();

  // Currencies and amounts
  const amountMatches = q.match(/(?:sgd|\$|usd|eur|gbp)?\s*[\d,]+(?:\.\d+)?\s*(?:k|m|thousand|million|billion)?\b/gi);
  if (amountMatches && amountMatches.length > 0) {
    facts.push(`Numerical quantities stated: ${amountMatches.map(m => m.trim()).join(', ')}`);
  }

  // Dates
  const dateMatches = q.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g);
  if (dateMatches && dateMatches.length > 0) {
    facts.push(`Transaction dates specified: ${dateMatches.join(', ')}`);
  }

  // Functional currency
  if (q.toLowerCase().includes('usd')) facts.push('Foreign currency involved: USD');
  if (q.toLowerCase().includes('sgd')) facts.push('Singapore Dollar (SGD) referenced');

  // Key entities / transactions
  if (q.toLowerCase().includes('share') || q.toLowerCase().includes('stock')) facts.push('Equity instrument / share transaction');
  if (q.toLowerCase().includes('lease') || q.toLowerCase().includes('rental')) facts.push('Lease or rental agreement transaction');
  if (q.toLowerCase().includes('car') || q.toLowerCase().includes('vehicle')) facts.push('Motor vehicle acquisition / outlay');
  if (q.toLowerCase().includes('software') || q.toLowerCase().includes('development') || q.toLowerCase().includes('r&d')) {
    facts.push('Software development / R&D expenditure');
  }
  if (q.toLowerCase().includes('trade discount')) facts.push('Supplier trade discount granted');

  if (scenario?.keyParameters) {
    for (const p of scenario.keyParameters) {
      if (p.badge !== 'Assumed Parameter' && !facts.some(f => f.includes(p.label))) {
        facts.push(`${p.label}: ${p.value}`);
      }
    }
  }

  return facts;
}

/**
 * Formulates deterministic application and calculation rules relevant to query.
 * Eliminates domain cross-contamination (e.g. no FX or lease rules in tax/employment queries).
 */
export function formulateApplicationRules(
  classification: QuestionClassificationResult,
  query: string
): string[] {
  const rules: string[] = [];
  const q = query.toLowerCase();

  // Computational double-entry balancing convention (strictly for transactions / journal requests)
  if (
    (q.includes('journal') || q.includes('entry') || q.includes('debit') || q.includes('credit') || classification.journalEntryRequired) &&
    (classification.intent === 'TRANSACTION' || classification.intent === 'HYBRID' || classification.journalEntryRequired)
  ) {
    rules.push('Calculation Rule: Sum of Debits must equal Sum of Credits exactly. Double-entry journals must balance to 2 decimal places.');
  }

  // Acquisition consideration arithmetic convention (strictly for trade discount purchase queries)
  if (q.includes('trade discount') || (q.includes('discount') && (q.includes('supplier') || q.includes('purchase') || q.includes('equipment') || q.includes('goods') || q.includes('invoice')))) {
    rules.push('Calculation Convention: Supplier trade discounts are deducted directly from the gross purchase price to derive initial cost consideration; trade discounts are not recorded as operating expenses.');
  }

  // Foreign currency transaction bifurcation arithmetic convention (strictly for forex / foreign currency queries)
  if (
    (q.includes('fx') || q.includes('forex') || q.includes('exchange rate') || (q.includes('foreign') && q.includes('currency')) || (q.includes('usd') && (q.includes('share') || q.includes('stock') || q.includes('gain')))) &&
    (classification.intent === 'TRANSACTION' || classification.accountingAnalysisRequired)
  ) {
    rules.push('Calculation Convention: Currency variance on monetary settlement is calculated as Foreign Amount * (Spot_disposal - Spot_acquisition); asset valuation variance is calculated as (Disposal_price - Cost_price) * Spot_disposal.');
  }

  // Cost allocation calculation convention (strictly for depreciation/amortization queries)
  if (
    (q.includes('depreciation') || q.includes('amortis') || q.includes('amortiz')) &&
    (classification.intent === 'TRANSACTION' || classification.accountingAnalysisRequired)
  ) {
    rules.push('Calculation Convention: Straight-line cost allocation formula is (Initial Cost - Residual Value) / Useful Life.');
  }

  return rules;
}

/**
 * Builds the provider-neutral GroundedReasoningContext.
 */
export async function buildGroundedReasoningContext(
  userInput: string,
  currentScenario?: AccountingScenarioState | null,
  retriever: ISourceRetriever = defaultAdvancedSourceRetriever,
  providerOrApiKey?: ProviderSettings | string
): Promise<GroundedReasoningContext> {
  // 1. Semantic Transaction Understanding & Question Classification
  const conversationContext = extractAccountingContext(currentScenario);
  const semanticUnderstanding = await defaultTransactionUnderstandingService.understandTransaction(
    userInput,
    currentScenario?.functionalCurrency || 'SGD',
    'SG',
    providerOrApiKey,
    conversationContext
  );
  const classification = classifyQuestion(userInput);

  // 2. Source Retrieval (Supplied with Semantic Context for Reranking)
  const targetDomain = mapCanonicalDomainToQueryDomain(classification.primaryDomain);
  const targetAuthorities = classification.authorities as StatutoryAuthority[];

  const retrieved = await retriever.retrieveSources({
    query: userInput,
    domain: targetDomain !== 'GENERAL' ? targetDomain : undefined,
    authorities: targetAuthorities.length > 0 ? targetAuthorities : undefined,
    maxResults: 6,
    semanticContext: semanticUnderstanding
  });

  // 3. Four-Tier Evidence Sorting based explicitly on evidenceTier
  const primaryEvidence: AuthoritativeSourceRecord[] = [];
  const officialGuidance: AuthoritativeSourceRecord[] = [];
  const curatedSummaries: AuthoritativeSourceRecord[] = [];

  for (const record of retrieved) {
    if (
      record.evidenceTier === 'PRIMARY_SOURCE' &&
      (record.sourceStatus === 'VERIFIED' || record.sourceStatus === 'HISTORICAL') &&
      record.isVerbatimText === true
    ) {
      primaryEvidence.push(record);
    } else if (record.evidenceTier === 'OFFICIAL_GUIDANCE') {
      officialGuidance.push(record);
    } else {
      curatedSummaries.push(record);
    }
  }

  // 4. Facts, Missing Facts, and Assumptions
  const userFacts = extractUserFacts(userInput, currentScenario);
  const missingFacts = [...classification.missingFacts];

  const isTransactionQuery =
    classification.intent === 'TRANSACTION' ||
    classification.intent === 'HYBRID' ||
    classification.journalEntryRequired;

  if (isTransactionQuery && semanticUnderstanding.factsMissing) {
    for (const mf of semanticUnderstanding.factsMissing) {
      if (!missingFacts.includes(mf)) {
        missingFacts.push(mf);
      }
    }
  }

  // Assumptions: only when genuinely needed for an illustrative calculation/scenario
  const assumptions: ExplicitAssumption[] = [];
  if (currentScenario?.assumptions) {
    assumptions.push(...currentScenario.assumptions);
  }

  if (semanticUnderstanding.assumptions) {
    for (const asm of semanticUnderstanding.assumptions) {
      if (!assumptions.some(a => a.field === 'currency_assumption' || a.basisOrRationale === asm)) {
        assumptions.push({
          id: `sem-asm-${assumptions.length + 1}`,
          field: 'currency_or_transaction_parameter',
          assumedValue: asm,
          basisOrRationale: asm,
          materiality: 'LOW',
          userClarificationPrompt: 'Please confirm currency or transaction parameters if different.'
        });
      }
    }
  }

  // 5. Application and Calculation Rules
  const applicationRules = formulateApplicationRules(classification, userInput);

  return {
    classification,
    userFacts,
    missingFacts,
    assumptions,
    primaryEvidence,
    officialGuidance,
    curatedSummaries,
    applicationRules,
    currentInformationRequired: classification.currentInformationRequired,
    semanticUnderstanding
  };
}

/**
 * Formats the GroundedReasoningContext into a comprehensive, evidence-first system prompt
 * shared identically by Gemini, OpenAI, and Azure OpenAI adapters.
 */
export function formatGroundedSystemPrompt(
  context: GroundedReasoningContext,
  standard: AccountingStandard
): string {
  const stdLabel = standard === 'SFRS_I'
    ? 'Singapore Financial Reporting Standards (International) [SFRS(I)]'
    : 'International Financial Reporting Standards [IFRS]';

  let prompt = `You are an authoritative Senior Singapore Accounting & Statutory Research Assistant for professional accountants.
Your primary directive is to provide correct, authoritative, and traceable information under ${stdLabel} and Singapore statutory law.

================================================================================
EVIDENCE-FIRST REASONING PRINCIPLES (MANDATORY SAFEGUARDS)
================================================================================
1. EVIDENCE GROUNDING: Use the supplied evidence for authoritative legal and accounting claims.
2. ANTI-FABRICATION: You must NEVER invent standards, paragraph numbers, statutory sections, rates, thresholds, deadlines, or citations.
3. CURATED SUMMARY STATUS: Never treat a curated summary as verified primary-source text.
4. APPLICATION RULES: Never treat an application/calculation rule as statutory authority.
5. STRICT SEPARATION: Clearly distinguish in your reasoning and output:
   - User Facts: Stated explicitly by the user.
   - Missing Facts: Required to confirm accounting treatment but omitted by user.
   - Assumptions: Introduced SOLELY for illustrative calculations; never silently convert a missing fact into an established fact.
   - Evidence: Grounded in retrieved primary sources or curated standards.
   - Professional Analysis: Applying the evidence to facts.
   - Conclusion: Recommended accounting or tax treatment.
   - Illustrative Journal Entry: Presented ONLY if facts and recognition criteria support it (or marked strictly conditional).
6. TIME-SENSITIVITY & UNCERTAINTY HANDLING:
   When current information is required but available evidence is insufficient or unverified, state:
   "I couldn't verify the applicable current source from the available evidence."
   Do not silently answer from unverified model memory.
7. CITATION INTEGRITY: Do not invent a citation merely because the user asks for one. Tie citations strictly to verified records.
8. INCOMPLETE EVIDENCE: If evidence conflicts or is incomplete, state the limitation instead of guessing.
9. CONCEPTUAL EXPLANATIONS: General model knowledge may be used for explanatory context, but must NOT be presented as verified authoritative evidence or given fabricated citations.

================================================================================
GROUNDED REASONING CONTEXT SUPPLIED TO YOU
================================================================================
`;

  // Section 1: User-Provided Facts
  prompt += `\n[1. USER-PROVIDED FACTS]\n`;
  if (context.userFacts.length > 0) {
    for (const fact of context.userFacts) {
      prompt += `• ${fact}\n`;
    }
  } else {
    prompt += `• None explicitly extracted from query.\n`;
  }

  // Section 1.1: Semantic Transaction Facts & Mandatory Guardrails
  if (context.semanticUnderstanding) {
    const sem = context.semanticUnderstanding;
    prompt += `\n[1.1 UNDERSTOOD TRANSACTION FACTS & MANDATORY ACCOUNTING GUARDRAILS]\n`;
    prompt += `• Reporting Entity: ${sem.reportingEntity.type.toUpperCase()}${sem.reportingEntity.description ? ` (${sem.reportingEntity.description})` : ''}\n`;
    if (sem.counterparty) {
      prompt += `• Counterparty Role: ${sem.counterparty.role.toUpperCase()}${sem.counterparty.description ? ` (${sem.counterparty.description})` : ''}\n`;
    }
    prompt += `• Ownership Context: ${(sem.ownershipContext || 'unknown').toUpperCase()}\n`;
    prompt += `• Payment Status: ${(sem.paymentStatus || 'unknown').toUpperCase()}\n`;
    prompt += `• Currency Fact: ${sem.currency.value || 'UNSPECIFIED'} (Source: ${sem.currency.source}, Confidence: ${sem.currency.confidence})\n`;
    if (sem.ownershipContext === 'own_equity') {
      prompt += `⚠️ MANDATORY GUARDRAIL (SFRS(I) 1-32 §33): The reporting entity is issuing its own equity. An entity's own shares can NEVER be recognized as a Financial Asset at FVTPL/FVTOCI. Credit Share Capital under Equity.\n`;
    }
    if (sem.currency.value === null || sem.currency.source === 'unknown') {
      prompt += `⚠️ MANDATORY GUARDRAIL: Currency is unspecified. Do NOT invent USD or execute foreign exchange translation.\n`;
    }
  }

  // Section 2: Missing Facts
  prompt += `\n[2. MISSING FACTS (FACTS REQUIRED BEFORE REACHING FINAL CONCLUSION)]\n`;
  if (context.missingFacts.length > 0) {
    for (const mf of context.missingFacts) {
      prompt += `⚠️ Missing Fact: ${mf}\n`;
    }
  } else {
    prompt += `• No material facts currently missing for general evaluation.\n`;
  }

  // Section 3: Explicit Assumptions
  prompt += `\n[3. EXPLICIT ASSUMPTIONS (ILLUSTRATIVE SCENARIO USE ONLY)]\n`;
  if (context.assumptions.length > 0) {
    for (const a of context.assumptions) {
      prompt += `• [${a.materiality} Materiality] ${a.field}: Assumed '${String(a.assumedValue)}' (${a.basisOrRationale})\n`;
    }
  } else {
    prompt += `• None assumed. Do not assume missing criteria are satisfied without explicitly marking them.\n`;
  }

  // Section 4: Authoritative Primary Source Evidence
  prompt += `\n[4. AUTHORITATIVE PRIMARY SOURCE EVIDENCE (VERBATIM STATUTES)]\n`;
  if (context.primaryEvidence.length > 0) {
    for (const p of context.primaryEvidence) {
      const freshnessLabel = p.freshnessStatus === 'HISTORICAL_SUPERSEDED'
        ? '[HISTORICAL / SUPERSEDED PROVISION]'
        : p.freshnessStatus === 'PENDING_EFFECTIVE'
        ? '[PENDING EFFECTIVE]'
        : p.freshnessStatus === 'AUDIT_OVERDUE'
        ? '[VERIFICATION REVIEW DUE]'
        : '[CURRENT PROVISION]';
      prompt += `### Primary Source: ${p.documentTitle} (${p.paragraphOrSection}) ${freshnessLabel}\n`;
      if (p.validFrom || p.validTo) {
        prompt += `Temporal Validity: ${p.validFrom || 'Initial'} to ${p.validTo || 'Present (In Force)'}\n`;
      }
      prompt += `Authority: ${p.authorityName} | Publisher: ${p.sourcePublisher}\n`;
      prompt += `Official URL: ${p.officialSourceUrl}\n`;
      prompt += `Verbatim Statutory Text:\n"${p.sourceText}"\n\n`;
    }
  } else {
    prompt += `• No verbatim primary statutory provision retrieved for this specific query.\n`;
  }

  // Section 5: Official Guidance
  prompt += `\n[5. OFFICIAL / CURATED GUIDANCE]\n`;
  if (context.officialGuidance.length > 0) {
    for (const g of context.officialGuidance) {
      prompt += `### Guidance: ${g.documentTitle} (${g.paragraphOrSection})\n`;
      prompt += `Authority: ${g.authorityName} | Publisher: ${g.sourcePublisher}\n`;
      prompt += `Summary: ${g.principleSummary}\n`;
      prompt += `Guidance Text: ${g.sourceText}\n\n`;
    }
  } else {
    prompt += `• No specific administrative guidance documents retrieved.\n`;
  }

  // Section 6: Curated Summaries (Needs Review)
  prompt += `\n[6. CURATED SUMMARIES (SFRS(I) STANDARDS & ACT SUMMARIES - NEEDS REVIEW)]\n`;
  if (context.curatedSummaries.length > 0) {
    for (const c of context.curatedSummaries) {
      const freshnessLabel = c.freshnessStatus === 'HISTORICAL_SUPERSEDED'
        ? '[HISTORICAL / SUPERSEDED PROVISION]'
        : c.freshnessStatus === 'PENDING_EFFECTIVE'
        ? '[PENDING EFFECTIVE]'
        : c.freshnessStatus === 'AUDIT_OVERDUE'
        ? '[VERIFICATION REVIEW DUE]'
        : '[CURRENT PROVISION]';
      prompt += `### Curated Standard/Statute Summary: ${c.documentTitle} (${c.paragraphOrSection}) ${freshnessLabel}\n`;
      if (c.validFrom || c.validTo) {
        prompt += `Temporal Validity: ${c.validFrom || 'Initial'} to ${c.validTo || 'Present (In Force)'}\n`;
      }
      prompt += `Authority: ${c.authorityName} | Instrument: ${c.legalOrStandardInstrument}\n`;
      prompt += `Official Source Portal: ${c.officialSourceUrl}\n`;
      prompt += `Status: ${c.sourceStatus} (${c.sourceType})\n`;
      prompt += `Principle / Summary: ${c.sourceText}\n\n`;
    }
  } else {
    prompt += `• No curated standard summaries retrieved.\n`;
  }

  // Section 7: Application & Calculation Rules
  prompt += `\n[7. APPLICATION & CALCULATION RULES (DETERMINISTIC LOGIC)]\n`;
  if (context.applicationRules.length > 0) {
    for (const r of context.applicationRules) {
      prompt += `• ${r}\n`;
    }
  } else {
    prompt += `• Standard accounting accrual and math balancing conventions apply.\n`;
  }

  // Section 8: Compact Decision Schema Specification
  if (context.classification.intent === 'STATUTORY_ADVISORY') {
    prompt += `
================================================================================
RESPONSE FORMAT SPECIFICATION (COMPACT STATUTORY DECISION SCHEMA)
================================================================================
CRITICAL FOR LATENCY & ACCURACY:
Do NOT write verbose markdown essays or redundant nested structures in JSON.
Deterministic application code automatically renders the markdown headers, citation badges, and UI cards.
Return ONLY this concise, compact JSON payload:
{
  "directAnswer": "Clear, direct answer and statutory entitlement/principle under Singapore law",
  "keyRules": [
    "Specific statutory rule 1 with statutory numbers/thresholds/formula",
    "Specific statutory rule 2..."
  ],
  "caveats": [
    "Qualifying condition or exception 1..."
  ],
  "statuteReferences": [
    {
      "standard": "Act Name (e.g. Employment Act 1968)",
      "paragraph": "Section or Part (e.g. Part IV §38)",
      "authority": "MOM" | "CPF" | "IRAS" | "ACRA",
      "officialSourceUrl": "https://sso.agc.gov.sg/..."
    }
  ]
}
Return pure JSON only.
`;
  } else if (context.classification.intent === 'TRANSACTION' || context.classification.journalEntryRequired) {
    prompt += `
================================================================================
RESPONSE FORMAT SPECIFICATION (COMPACT TRANSACTION & JOURNAL DECISION SCHEMA)
================================================================================
CRITICAL FOR LATENCY & ACCURACY:
Do NOT write verbose markdown essays, redundant nested structures, or monetary amounts in JSON.
The deterministic accounting engine automatically computes debit/credit balancing, monetary amounts, foreign exchange rates, and UI parameters.
Gemini must NOT calculate amounts, balances, or invent placeholder numbers ($1,000, $50,000, etc.). Focus strictly on accounting classification, applicable standard, required account names, categories, debit/credit orientation, and missing valuation facts.
Return ONLY this concise, compact JSON payload:
{
  "transactionNature": "Brief title/nature of the transaction",
  "treatment": "Authoritative financial reporting treatment under ${stdLabel}",
  "requiredAccounts": [
    {
      "accountName": "Account Name (e.g. Office Equipment)",
      "category": "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
      "debitCredit": "DEBIT" | "CREDIT",
      "rationale": "Why debited/credited"
    }
  ],
  "bifurcateFx": true | false,
  "tradeDiscountHandling": "string",
  "missingFacts": ["Any missing facts required to establish final treatment"],
  "assumptions": [
    { "field": "string", "assumedValue": "string", "basis": "string", "materiality": "HIGH" | "MEDIUM" | "LOW" }
  ],
  "citations": [
    {
      "standard": "SFRS(I) Standard or Act Name",
      "paragraph": "§Paragraph or Section",
      "authority": "ASC" | "ACRA" | "IRAS" | "MOM" | "CPF",
      "officialSourceUrl": "string"
    }
  ]
}
Return pure JSON only.
`;
  } else {
    prompt += `
================================================================================
RESPONSE FORMAT SPECIFICATION (COMPACT ACCOUNTING REASONING SCHEMA)
================================================================================
CRITICAL FOR LATENCY & ACCURACY:
Do NOT write verbose markdown essays or duplicate boilerplate. Focus strictly on professional reasoning and technical treatment.
Return ONLY this concise, compact JSON payload:
{
  "decision": "Core conclusion on recognition, measurement, or compliance",
  "treatment": "Detailed financial reporting treatment under ${stdLabel}",
  "reasoning": "Technical rationale applying the standard or statutory provision to user facts",
  "singaporeTaxImpact": "Tax deductibility under Income Tax Act, capital allowances, or GST impact",
  "missingFacts": ["Any missing material facts required before reaching final conclusion"],
  "assumptions": [
    { "field": "string", "assumedValue": "string", "basis": "string", "materiality": "HIGH" | "MEDIUM" | "LOW" }
  ],
  "citations": [
    {
      "standard": "Standard or Act Name",
      "paragraph": "§Paragraph or Section",
      "authority": "ASC" | "ACRA" | "IRAS" | "MOM" | "CPF",
      "officialSourceUrl": "string"
    }
  ]
}
Return pure JSON only.
`;
  }

  return prompt;
}

/**
 * Post-processes an AI-generated accounting response:
 * 1. Executes post-generation citation verification on all returned citations.
 * 2. Applies deterministic accounting engine guardrails (balancing, FX bifurcation, trade discounts).
 * 3. Enforces uncertainty disclaimers when time-sensitive information is missing.
 * 4. Ensures strict separation of user facts, missing facts, and assumptions.
 */
export function postProcessAIResponse(
  parsed: any,
  currentScenario: AccountingScenarioState | null,
  userInput: string,
  groundedContext: GroundedReasoningContext,
  deterministicScenario?: AccountingScenarioState | null,
  standard: AccountingStandard = 'SFRS_I'
): {
  messageText: string;
  scenarioState: AccountingScenarioState;
} {
  // If parsed is a compact decision (has directAnswer, treatment, decision, requiredAccounts, or lacks directGroups and messageText),
  // delegate to assembleDeterministicResponse which compiles the complete verified markdown, journal entries, and scenario state.
  const isCompactPayload = Boolean(
    parsed &&
    (parsed.directAnswer !== undefined ||
     parsed.requiredAccounts !== undefined ||
     (parsed.treatment !== undefined && (!parsed.directGroups || parsed.directGroups.length === 0)) ||
     (parsed.decision !== undefined && (!parsed.directGroups || parsed.directGroups.length === 0)) ||
     (!parsed.messageText && (!parsed.directGroups || parsed.directGroups.length === 0)))
  );

  if (isCompactPayload) {
    return assembleDeterministicResponse(
      parsed,
      userInput,
      currentScenario,
      groundedContext,
      deterministicScenario || null,
      standard
    );
  }

  const retrievedEvidenceScope: AuthoritativeSourceRecord[] = [
    ...groundedContext.primaryEvidence,
    ...groundedContext.officialGuidance,
    ...groundedContext.curatedSummaries
  ];

  // 1. Deterministic Accounting Engine Governance:
  // If the deterministic accounting engine recognized this transaction and calculated authoritative entries,
  // the deterministic engine's directGroups and calculations govern the journal output.
  // Gemini is responsible for accounting interpretation, tax summaries, and narrative advisory.
  const hasAuthoritativeDeterministicEntries =
    deterministicScenario &&
    deterministicScenario.scenarioType !== 'UNRECOGNIZED' &&
    deterministicScenario.directGroups &&
    deterministicScenario.directGroups.length > 0;

  // Enforce Phase 2.2 Hardening: Authority status triad
  // Deterministic engine recognized transaction -> DETERMINISTIC (or CONDITIONAL if missing facts exist)
  // Unrecognized transaction (AI proposed entries) -> strictly AI_PROPOSED (or CONDITIONAL if missing facts exist)
  // Missing facts ALWAYS trigger CONDITIONAL status.
  const hasMissingFacts = Boolean(groundedContext.missingFacts && groundedContext.missingFacts.length > 0);
  const computedAuthorityStatus: JournalAuthorityStatus = hasMissingFacts
    ? 'CONDITIONAL'
    : (hasAuthoritativeDeterministicEntries
        ? (deterministicScenario.authorityStatus || 'DETERMINISTIC')
        : 'AI_PROPOSED');

  let directGroups: JournalEntryGroup[];

  if (hasAuthoritativeDeterministicEntries) {
    directGroups = deterministicScenario.directGroups!.map((grp) => ({
      ...grp,
      authorityStatus: grp.authorityStatus || computedAuthorityStatus
    }));
  } else {
    // Validate and compute totals on AI-supplied directGroups
    directGroups = (parsed.directGroups || []).map((grp: any, gIdx: number) => {
      const lines = (grp.lines || []).map((l: any, lIdx: number) => ({
        id: l.id || `line-${gIdx}-${lIdx}`,
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
      // If an expense line was mistakenly generated for a trade discount, remove it
      const tradeDiscountExpenseIdx = lines.findIndex(
        (l: any) => l.accountName.toLowerCase().includes('trade discount') && l.category === 'EXPENSE'
      );
      if (tradeDiscountExpenseIdx !== -1) {
        lines.splice(tradeDiscountExpenseIdx, 1);
      }

      const totalDebit = Math.round(lines.reduce((s: number, l: any) => s + l.debit, 0) * 100) / 100;
      const totalCredit = Math.round(lines.reduce((s: number, l: any) => s + l.credit, 0) * 100) / 100;
      const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

      // Post-generation citation verification on all citations in this group
      const verifiedCitations: StandardCitation[] = (grp.citations || []).map((cite: any) => {
        const verification = defaultCitationVerifier.verifyCitation(cite, cite.authority, retrievedEvidenceScope);
        const safeUrl = verification.matchedRecord?.officialSourceUrl ||
          getSafeOfficialUrl(cite.officialSourceUrl, cite.standard, cite.paragraph, cite.authority) ||
          cite.officialSourceUrl;

        return {
          standard: cite.standard || '',
          paragraph: cite.paragraph || '',
          title: cite.title || '',
          text: cite.text || '',
          authority: cite.authority,
          officialSourceUrl: safeUrl,
          verificationStatus: verification.status,
          isAuthoritativePrimarySource: verification.isAuthoritativePrimarySource,
          isStructurallyValid: verification.isStructurallyValid,
          verificationReason: verification.reason,
          structuralVerificationOnly: true
        };
      });

      return {
        id: grp.id || `grp-${gIdx + 1}`,
        eventDate: formatSingaporeDate(grp.eventDate || new Date()),
        title: grp.title || `Entry Group ${gIdx + 1}`,
        summary: grp.summary || '',
        lines,
        totalDebit,
        totalCredit,
        isBalanced,
        citations: verifiedCitations,
        rationalePoints: grp.rationalePoints || [],
        authorityStatus: computedAuthorityStatus
      };
    });
  }

  // Safeguard: If AI response didn't supply directGroups (e.g. conceptual advisory query), preserve current
  if (directGroups.length === 0 && currentScenario?.directGroups && currentScenario.directGroups.length > 0) {
    directGroups = currentScenario.directGroups.map((grp) => ({
      ...grp,
      authorityStatus: grp.authorityStatus || computedAuthorityStatus
    }));
  }

  // If deterministic scenario provided keyParameters, prioritize them
  const keyParameters = (hasAuthoritativeDeterministicEntries && deterministicScenario.keyParameters && deterministicScenario.keyParameters.length > 0)
    ? deterministicScenario.keyParameters
    : ((parsed.keyParameters && Array.isArray(parsed.keyParameters) && parsed.keyParameters.length > 0)
      ? parsed.keyParameters
      : (currentScenario?.keyParameters || []));

  const finalTitle = (parsed.transactionTitle && parsed.transactionTitle !== 'Accounting Transaction')
    ? parsed.transactionTitle
    : (deterministicScenario?.transactionTitle || currentScenario?.transactionTitle || 'Accounting Transaction');

  // Verify and normalize statutory advisories
  const statutoryAdvisory = (parsed.statutoryAdvisory || deterministicScenario?.statutoryAdvisory || currentScenario?.statutoryAdvisory || []).map((adv: any) => ({
    ...adv,
    officialUrl: getSafeOfficialUrl(adv.officialUrl, adv.statuteOrAct, adv.sectionOrSchedule, adv.authority) || adv.officialUrl
  }));

  // Uncertainty handling & conditional conclusions
  let uncertaintyDisclaimer = parsed.uncertaintyDisclaimer || currentScenario?.uncertaintyDisclaimer || '';

  // 1. Missing material facts produce conditional conclusions
  if (groundedContext.missingFacts && groundedContext.missingFacts.length > 0) {
    const missingConditionNotice = `Conclusion is conditional upon establishing: ${groundedContext.missingFacts.join('; ')}.`;
    if (!uncertaintyDisclaimer.includes('conditional upon establishing') && !uncertaintyDisclaimer.includes(missingConditionNotice)) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${missingConditionNotice} ${uncertaintyDisclaimer}` : missingConditionNotice;
    }
  }

  // 2. No retrieved evidence -> no claim presented as authoritative
  if (retrievedEvidenceScope.length === 0) {
    const noEvidenceNotice = "No authoritative evidence was retrieved from the verified repository to support this claim.";
    if (!uncertaintyDisclaimer.includes(noEvidenceNotice) && !(parsed.messageText || '').includes(noEvidenceNotice)) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${noEvidenceNotice} ${uncertaintyDisclaimer}` : noEvidenceNotice;
    }
  }

  // 3. Time-sensitivity fallback
  if (groundedContext.currentInformationRequired && groundedContext.primaryEvidence.length === 0) {
    const fallbackNotice = "I couldn't verify the applicable current source from the available evidence.";
    if (!uncertaintyDisclaimer.includes(fallbackNotice) && !(parsed.messageText || '').includes(fallbackNotice)) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${fallbackNotice} ${uncertaintyDisclaimer}` : fallbackNotice;
    }
  }

  // Ensure assumptions are explicit and separated from missing facts
  const assumptions: ExplicitAssumption[] = [
    ...(parsed.assumptions || []),
    ...(deterministicScenario?.assumptions || []),
    ...groundedContext.assumptions.filter(
      (ga) => !(parsed.assumptions || []).some((pa: any) => pa.field === ga.field)
    )
  ];

  const scenarioState: AccountingScenarioState = {
    scenarioType: parsed.scenarioType || deterministicScenario?.scenarioType || currentScenario?.scenarioType || 'UNIVERSAL',
    queryIntent: parsed.queryIntent || (statutoryAdvisory.length > 0 ? 'STATUTORY_ADVISORY' : currentScenario?.queryIntent || 'TRANSACTION'),
    primaryDomain: parsed.primaryDomain || deterministicScenario?.primaryDomain || currentScenario?.primaryDomain || (statutoryAdvisory.length > 0 ? (statutoryAdvisory[0].authority === 'ACRA' ? 'ACRA_CORP' : statutoryAdvisory[0].authority === 'CPF' ? 'CPF_BOARD' : statutoryAdvisory[0].authority === 'MOM' ? 'MOM_EMPLOYMENT' : 'IRAS_TAX') : 'ACCOUNTING_SFRS'),
    rawQuery: userInput,
    transactionTitle: finalTitle,
    functionalCurrency: parsed.functionalCurrency || deterministicScenario?.functionalCurrency || currentScenario?.functionalCurrency || 'SGD',
    transactionCurrency: parsed.transactionCurrency || deterministicScenario?.transactionCurrency || currentScenario?.transactionCurrency || 'SGD',
    accountingTreatmentSummary: parsed.accountingTreatmentSummary || deterministicScenario?.accountingTreatmentSummary || currentScenario?.accountingTreatmentSummary,
    singaporeTaxTreatmentSummary: parsed.singaporeTaxTreatmentSummary || deterministicScenario?.singaporeTaxTreatmentSummary || currentScenario?.singaporeTaxTreatmentSummary,
    regulatoryMandatesSummary: parsed.regulatoryMandatesSummary || deterministicScenario?.regulatoryMandatesSummary || currentScenario?.regulatoryMandatesSummary,
    effectiveDateOrTiming: parsed.effectiveDateOrTiming || deterministicScenario?.effectiveDateOrTiming || currentScenario?.effectiveDateOrTiming,
    uncertaintyDisclaimer: uncertaintyDisclaimer || undefined,
    authorityStatus: computedAuthorityStatus,
    keyParameters,
    directGroups,
    statutoryAdvisory: statutoryAdvisory.length > 0 ? statutoryAdvisory : undefined,
    assumptions: assumptions.length > 0 ? assumptions : undefined,
    missingFacts: groundedContext.missingFacts.length > 0 ? groundedContext.missingFacts : undefined,
    isComplete: groundedContext.missingFacts.length === 0 && retrievedEvidenceScope.length > 0,
    missingFields: []
  };

  return {
    messageText: appendStatutorySourceFooter(parsed.messageText || '', scenarioState),
    scenarioState
  };
}
