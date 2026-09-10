import type {
  AccountingStandard,
  AccountingScenarioState,
  ExplicitAssumption,
  QueryDomain,
  StatutoryAuthority,
  JournalEntryGroup,
  StandardCitation
} from '../types/accounting';
import type { QuestionClassificationResult } from '../classification/questionClassifier';
import { classifyQuestion } from '../classification/questionClassifier';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { defaultSourceRetriever, type ISourceRetriever } from '../retrieval/sourceRetriever';
import { defaultCitationVerifier } from '../verification/citationVerifier';
import { appendStatutorySourceFooter, getSafeOfficialUrl } from '../utils/statutoryLinkResolver';
import { formatSingaporeDate } from '../utils/dateUtils';

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
 */
export function formulateApplicationRules(
  classification: QuestionClassificationResult,
  query: string
): string[] {
  const rules: string[] = [];
  const q = query.toLowerCase();

  // Accounting rules
  if (classification.accountingAnalysisRequired || q.includes('discount') || q.includes('cost')) {
    rules.push('Application Rule: Trade discounts must be deducted directly from asset purchase cost (SFRS(I) 1-16 §16(a)); never recorded as an expense.');
  }

  if (classification.accountingAnalysisRequired && (q.includes('fx') || q.includes('foreign') || q.includes('usd') || q.includes('gain') || q.includes('share'))) {
    rules.push('Application Rule: Realized foreign exchange gain/loss on monetary items must be strictly bifurcated from equity market appreciation (SFRS(I) 1-21 & SFRS(I) 9).');
  }

  if (q.includes('journal') || q.includes('entry') || q.includes('debit') || q.includes('credit') || classification.journalEntryRequired) {
    rules.push('Calculation Rule: Sum of Debits must equal Sum of Credits exactly. Double entry journals must balance to 2 decimal places.');
  }

  // Tax and GST rules
  if (classification.taxAnalysisRequired || q.includes('tax') || q.includes('gst')) {
    rules.push('Statutory Rule: Singapore standard GST rate is 9% (effective 1 Jan 2024). Input tax on S-plate passenger cars is blocked under Regulation 26.');
    rules.push('Statutory Rule: Accounting depreciation is disallowed for corporate tax and added back in Form C-S; capital allowances claimed under Section 19/19A.');
  }

  // Payroll / Corporate rules
  if (classification.regulatoryAnalysisRequired || q.includes('cpf') || q.includes('audit')) {
    if (q.includes('cpf') || q.includes('wage') || q.includes('ceiling')) {
      rules.push('Statutory Rule: Singapore CPF Ordinary Wage (OW) monthly ceiling is SGD 8,000 in 2026.');
    }
    if (q.includes('audit') || q.includes('small company')) {
      rules.push('Statutory Rule: Small company audit exemption requires satisfying at least 2 of 3 quantitative criteria (Revenue <= $10M, Assets <= $10M, Staff <= 50) for 2 consecutive FYs.');
    }
  }

  return rules;
}

/**
 * Builds the provider-neutral GroundedReasoningContext.
 */
export async function buildGroundedReasoningContext(
  userInput: string,
  currentScenario?: AccountingScenarioState | null,
  retriever: ISourceRetriever = defaultSourceRetriever
): Promise<GroundedReasoningContext> {
  // 1. Question Classification
  const classification = classifyQuestion(userInput);

  // 2. Source Retrieval
  const targetDomain = mapCanonicalDomainToQueryDomain(classification.primaryDomain);
  const targetAuthorities = classification.authorities as StatutoryAuthority[];

  const retrieved = await retriever.retrieveSources({
    query: userInput,
    domain: targetDomain !== 'GENERAL' ? targetDomain : undefined,
    authorities: targetAuthorities.length > 0 ? targetAuthorities : undefined,
    maxResults: 6
  });

  // 3. Four-Tier Evidence Sorting
  const primaryEvidence: AuthoritativeSourceRecord[] = [];
  const officialGuidance: AuthoritativeSourceRecord[] = [];
  const curatedSummaries: AuthoritativeSourceRecord[] = [];

  for (const record of retrieved) {
    // A. Verified Primary Source: only when sourceStatus === 'VERIFIED', sourceType === 'AUTHORITATIVE_SOURCE', and isVerbatimText === true
    if (
      record.sourceStatus === 'VERIFIED' &&
      record.sourceType === 'AUTHORITATIVE_SOURCE' &&
      record.isVerbatimText === true
    ) {
      primaryEvidence.push(record);
    }
    // B. Official Guidance: official gov portal link but not verbatim primary statute
    else if (
      record.officialSourceUrl &&
      record.officialSourceUrl.includes('gov.sg') &&
      !record.isVerbatimText &&
      record.sourceType === 'APPLICATION_RULE'
    ) {
      officialGuidance.push(record);
    }
    // C. Curated Summaries: SFRS(I) standards, editorial statutory summaries
    else {
      curatedSummaries.push(record);
    }
  }

  // 4. Facts, Missing Facts, and Assumptions
  const userFacts = extractUserFacts(userInput, currentScenario);
  const missingFacts = [...classification.missingFacts];

  // Assumptions: only when genuinely needed for an illustrative calculation/scenario
  const assumptions: ExplicitAssumption[] = [];
  if (currentScenario?.assumptions) {
    assumptions.push(...currentScenario.assumptions);
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
    currentInformationRequired: classification.currentInformationRequired
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
      prompt += `### Primary Source: ${p.documentTitle} (${p.paragraphOrSection})\n`;
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
      prompt += `### Curated Standard/Statute Summary: ${c.documentTitle} (${c.paragraphOrSection})\n`;
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

  // Section 8: Required JSON Output Format
  prompt += `
================================================================================
RESPONSE FORMAT SPECIFICATION
================================================================================
Respond in pure JSON adhering strictly to this schema:
{
  "scenarioType": "UNIVERSAL",
  "queryIntent": "TRANSACTION" | "STATUTORY_ADVISORY" | "HYBRID",
  "primaryDomain": "ACCOUNTING_SFRS" | "IRAS_TAX" | "IRAS_GST" | "ACRA_CORP" | "MOM_EMPLOYMENT" | "CPF_BOARD" | "MULTI_AUTHORITY" | "GENERAL",
  "transactionTitle": "string",
  "functionalCurrency": "SGD",
  "transactionCurrency": "SGD",
  "accountingTreatmentSummary": "Detailed SFRS(I) financial statement treatment",
  "singaporeTaxTreatmentSummary": "Detailed IRAS tax deductibility, capital allowances, and GST treatment",
  "regulatoryMandatesSummary": "ACRA, MOM, or CPF compliance directives",
  "effectiveDateOrTiming": "Current effective dates or note if unverified",
  "uncertaintyDisclaimer": "State any missing facts, conditional criteria, or required verification",
  "messageText": "Comprehensive markdown response with structured headers, calculations, and citations",
  "keyParameters": [
    { "label": "string", "value": "string", "badge": "string", "highlight": boolean }
  ],
  "directGroups": [
    {
      "id": "grp-1",
      "eventDate": "DD/MM/YYYY",
      "title": "string",
      "summary": "string",
      "lines": [
        {
          "id": "line-1",
          "accountCode": "string",
          "accountName": "string",
          "category": "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
          "debit": number,
          "credit": number,
          "lineExplanation": "string"
        }
      ],
      "citations": [
        {
          "standard": "string",
          "paragraph": "string",
          "title": "string",
          "text": "string",
          "officialSourceUrl": "string",
          "authority": "IRAS" | "ACRA" | "CPF" | "MOM" | "MAS" | "ASC" | "SSO"
        }
      ],
      "rationalePoints": ["string"]
    }
  ],
  "statutoryAdvisory": [
    {
      "authority": "IRAS" | "ACRA" | "CPF" | "MOM" | "MAS" | "CUSTOMS" | "ASC" | "SSO",
      "statuteOrAct": "string",
      "sectionOrSchedule": "string",
      "topic": "string",
      "summary": "string",
      "keyRules": ["string"],
      "officialUrl": "string",
      "isTaxDeductible": boolean,
      "isGstClaimable": boolean
    }
  ]
}
Return pure JSON only.
`;

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
  groundedContext: GroundedReasoningContext
): {
  messageText: string;
  scenarioState: AccountingScenarioState;
} {
  // Validate and compute totals on directGroups
  let directGroups: JournalEntryGroup[] = (parsed.directGroups || []).map((grp: any, gIdx: number) => {
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
      const verification = defaultCitationVerifier.verifyCitation(cite, cite.authority);
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
        verificationReason: verification.reason
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
      rationalePoints: grp.rationalePoints || []
    };
  });

  // Safeguard: If AI response didn't supply directGroups (e.g. conceptual advisory query), preserve current
  if (directGroups.length === 0 && currentScenario?.directGroups && currentScenario.directGroups.length > 0) {
    directGroups = currentScenario.directGroups;
  }

  // Safeguard: If AI response didn't supply keyParameters, preserve current
  const keyParameters = (parsed.keyParameters && Array.isArray(parsed.keyParameters) && parsed.keyParameters.length > 0)
    ? parsed.keyParameters
    : (currentScenario?.keyParameters || []);

  const finalTitle = (parsed.transactionTitle && parsed.transactionTitle !== 'Accounting Transaction')
    ? parsed.transactionTitle
    : (currentScenario?.transactionTitle || parsed.transactionTitle || 'Accounting Transaction');

  // Verify and normalize statutory advisories
  const statutoryAdvisory = (parsed.statutoryAdvisory || currentScenario?.statutoryAdvisory || []).map((adv: any) => ({
    ...adv,
    officialUrl: getSafeOfficialUrl(adv.officialUrl, adv.statuteOrAct, adv.sectionOrSchedule, adv.authority) || adv.officialUrl
  }));

  // Uncertainty handling: If current time-sensitive info required but evidence is missing
  let uncertaintyDisclaimer = parsed.uncertaintyDisclaimer || currentScenario?.uncertaintyDisclaimer || '';
  if (groundedContext.currentInformationRequired && groundedContext.primaryEvidence.length === 0) {
    const fallbackNotice = "I couldn't verify the applicable current source from the available evidence.";
    if (!uncertaintyDisclaimer.includes(fallbackNotice) && !(parsed.messageText || '').includes(fallbackNotice)) {
      uncertaintyDisclaimer = uncertaintyDisclaimer ? `${fallbackNotice} ${uncertaintyDisclaimer}` : fallbackNotice;
    }
  }

  // Ensure assumptions are explicit and separated from missing facts
  const assumptions: ExplicitAssumption[] = [
    ...(parsed.assumptions || []),
    ...groundedContext.assumptions.filter(
      (ga) => !(parsed.assumptions || []).some((pa: any) => pa.field === ga.field)
    )
  ];

  const scenarioState: AccountingScenarioState = {
    scenarioType: parsed.scenarioType || currentScenario?.scenarioType || 'UNIVERSAL',
    queryIntent: parsed.queryIntent || (statutoryAdvisory.length > 0 ? 'STATUTORY_ADVISORY' : currentScenario?.queryIntent || 'TRANSACTION'),
    primaryDomain: parsed.primaryDomain || currentScenario?.primaryDomain || (statutoryAdvisory.length > 0 ? (statutoryAdvisory[0].authority === 'ACRA' ? 'ACRA_CORP' : statutoryAdvisory[0].authority === 'CPF' ? 'CPF_BOARD' : statutoryAdvisory[0].authority === 'MOM' ? 'MOM_EMPLOYMENT' : 'IRAS_TAX') : 'ACCOUNTING_SFRS'),
    rawQuery: userInput,
    transactionTitle: finalTitle,
    functionalCurrency: parsed.functionalCurrency || currentScenario?.functionalCurrency || 'SGD',
    transactionCurrency: parsed.transactionCurrency || currentScenario?.transactionCurrency || 'SGD',
    accountingTreatmentSummary: parsed.accountingTreatmentSummary || currentScenario?.accountingTreatmentSummary,
    singaporeTaxTreatmentSummary: parsed.singaporeTaxTreatmentSummary || currentScenario?.singaporeTaxTreatmentSummary,
    regulatoryMandatesSummary: parsed.regulatoryMandatesSummary || currentScenario?.regulatoryMandatesSummary,
    effectiveDateOrTiming: parsed.effectiveDateOrTiming || currentScenario?.effectiveDateOrTiming,
    uncertaintyDisclaimer: uncertaintyDisclaimer || undefined,
    keyParameters,
    directGroups,
    statutoryAdvisory: statutoryAdvisory.length > 0 ? statutoryAdvisory : undefined,
    assumptions: assumptions.length > 0 ? assumptions : undefined,
    missingFacts: groundedContext.missingFacts.length > 0 ? groundedContext.missingFacts : undefined,
    isComplete: groundedContext.missingFacts.length === 0,
    missingFields: []
  };

  return {
    messageText: appendStatutorySourceFooter(parsed.messageText || '', scenarioState),
    scenarioState
  };
}
