import { isExplicitForeignTaxOnlyQuestion, type QuestionClassificationResult } from '../classification/questionClassifier';
import type { SingaporeKnowledgeDomain } from '../standards/coverageRegistry';
import { getCoverageTopicsByIds } from '../standards/coverageRegistry';
import { defaultQueryTopicResolver } from '../retrieval/queryTopicResolver';
import type { ProviderSettings } from '../types/provider';
import { executeStructuredLlmCall } from './aiTransport';

export const SEMANTIC_QUESTION_MIN_CONFIDENCE = 0.72;
export const SEMANTIC_QUESTION_TIMEOUT_MS = 8_000;

export type QuestionUnderstandingMode = 'SEMANTIC_INTERPRETATION' | 'SEMANTIC_PLUS_RULES' | 'DETERMINISTIC_FALLBACK';
export type SemanticPopulation = 'INDIVIDUAL' | 'EMPLOYEE' | 'EMPLOYER' | 'COMPANY' | 'SHAREHOLDER' | 'FUND' | 'PROPERTY_OWNER' | 'UNKNOWN';
export type SemanticQuestionDomain =
  | 'ACCOUNTING' | 'IRAS_INCOME_TAX' | 'IRAS_GST' | 'IRAS_PROPERTY_TAX' | 'IRAS_STAMP_DUTY' | 'IRAS_OTHER'
  | 'CPF_PAYROLL' | 'MOM_EMPLOYMENT' | 'ACRA_CORPORATE' | 'MAS_FUNDS' | 'UNKNOWN';
export type SemanticQuestionOperation =
  | 'EXPLAIN_RULE' | 'EXPLAIN_INTERACTION' | 'DETERMINE_TREATMENT' | 'CHECK_ELIGIBILITY' | 'CALCULATE'
  | 'PREPARE_JOURNAL' | 'COMPARE' | 'FILING_REQUIREMENT' | 'OTHER';
export type SemanticAuthority = 'IRAS' | 'CPF' | 'ACRA' | 'MOM' | 'MAS' | 'ACCOUNTING_STANDARDS' | 'IFRS_FOUNDATION' | 'SSO' | 'UNKNOWN';
export type SemanticConceptRole = 'PRIMARY' | 'RELATED' | 'CONTEXT_ONLY';

export interface SemanticQuestionInterpretation {
  jurisdiction: string[];
  authorityCandidates: SemanticAuthority[];
  contextualAuthorities: SemanticAuthority[];
  domain: SemanticQuestionDomain;
  population: SemanticPopulation;
  primarySubject: string;
  concepts: Array<{ concept: string; role: SemanticConceptRole }>;
  requestedOperation: SemanticQuestionOperation;
  requiresUserSpecificFacts: boolean;
  calculationRequested: boolean;
  factsExplicitlyProvided: string[];
  confidence: number;
}

export interface SemanticQuestionUnderstanding {
  mode: QuestionUnderstandingMode;
  interpretation?: SemanticQuestionInterpretation;
  failure?: 'NO_PROVIDER' | 'INVALID_RESPONSE' | 'LOW_CONFIDENCE' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'QUERY_TOO_LONG';
}

export interface QuestionUnderstandingDiagnostics {
  mode: QuestionUnderstandingMode;
  population: SemanticPopulation;
  primarySubject: string;
  requestedOperation: SemanticQuestionOperation;
  authorityCandidates: SemanticAuthority[];
  concepts: string[];
}

/** Retrieval-only description of a material concept present in the question. */
export interface RequestedQuestionConcept {
  id: string;
  label: string;
  terms: string[];
  topicIds: string[];
}

const POPULATIONS = new Set<SemanticPopulation>(['INDIVIDUAL', 'EMPLOYEE', 'EMPLOYER', 'COMPANY', 'SHAREHOLDER', 'FUND', 'PROPERTY_OWNER', 'UNKNOWN']);
const DOMAINS = new Set<SemanticQuestionDomain>(['ACCOUNTING', 'IRAS_INCOME_TAX', 'IRAS_GST', 'IRAS_PROPERTY_TAX', 'IRAS_STAMP_DUTY', 'IRAS_OTHER', 'CPF_PAYROLL', 'MOM_EMPLOYMENT', 'ACRA_CORPORATE', 'MAS_FUNDS', 'UNKNOWN']);
const OPERATIONS = new Set<SemanticQuestionOperation>(['EXPLAIN_RULE', 'EXPLAIN_INTERACTION', 'DETERMINE_TREATMENT', 'CHECK_ELIGIBILITY', 'CALCULATE', 'PREPARE_JOURNAL', 'COMPARE', 'FILING_REQUIREMENT', 'OTHER']);
const AUTHORITIES = new Set<SemanticAuthority>(['IRAS', 'CPF', 'ACRA', 'MOM', 'MAS', 'ACCOUNTING_STANDARDS', 'IFRS_FOUNDATION', 'SSO', 'UNKNOWN']);
const CONCEPT_ROLES = new Set<SemanticConceptRole>(['PRIMARY', 'RELATED', 'CONTEXT_ONLY']);
const MAX_LABEL_LENGTH = 160;

/** Redacts a few recognizable case values only at the diagnostics boundary. */
export function sanitizeSemanticDiagnosticLabel(label: string): string {
  if (/(?:https?:\/\/|www\.|sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|Bearer\s+[A-Za-z0-9._-]{12,})/i.test(label)) return '';
  const month = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  return label
    .replace(/\b(?:SGD|USD|AUD|CAD|EUR|GBP|HKD|JPY|CNY|NZD|CHF)\s*[-+]?\s*\d[\d,]*(?:\.\d+)?|\bS\$\s*[-+]?\s*\d[\d,]*(?:\.\d+)?|[$€£¥]\s*[-+]?\s*\d[\d,]*(?:\.\d+)?/gi, '[amount]')
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, '[date]')
    .replace(new RegExp(`\\b(?:\\d{1,2}\\s+${month}\\.?\\s+\\d{4}|${month}\\s+\\d{1,2},?\\s+\\d{4})\\b`, 'gi'), '[date]')
    .replace(/\b(?:YA|tax year|year of assessment)\s*20\d{2}\b/gi, '[date]')
    .replace(/\b(?:[A-Z][\p{L}\p{N}&.'’-]*\s+){0,3}(?:Pte\.?\s+Ltd\.?|Private\s+Limited|Limited|Ltd\.?|LLP|LLC|Inc\.?|Corporation|Corp\.?|PLC)(?:[’']s)?\b/gu, '[entity]')
    .split('').filter(character => character.charCodeAt(0) > 0x1f).join('')
    .slice(0, MAX_LABEL_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function validLabelList(value: unknown, maxItems: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every(item =>
    typeof item === 'string' && isSafeSemanticLabel(item));
}

function isSafeSemanticLabel(value: string): boolean {
  const hasControlCharacter = Array.from(value).some(character => character.charCodeAt(0) <= 0x1f);
  return value.trim().length > 0 && value.length <= MAX_LABEL_LENGTH && !hasControlCharacter &&
    !/(?:https?:\/\/|www\.)/i.test(value) &&
    !/(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|Bearer\s+[A-Za-z0-9._-]{12,})/i.test(value);
}

function validAuthorities(value: unknown): value is SemanticAuthority[] {
  return Array.isArray(value) && value.length <= 5 && value.every(item => typeof item === 'string' && AUTHORITIES.has(item as SemanticAuthority)) &&
    new Set(value).size === value.length;
}

function domainAuthorityIsPossible(value: SemanticQuestionInterpretation): boolean {
  const has = (authority: SemanticAuthority) => value.authorityCandidates.includes(authority);
  switch (value.domain) {
    case 'IRAS_INCOME_TAX':
    case 'IRAS_GST':
    case 'IRAS_PROPERTY_TAX':
    case 'IRAS_STAMP_DUTY':
    case 'IRAS_OTHER':
      return has('IRAS');
    case 'CPF_PAYROLL': return has('CPF');
    case 'MOM_EMPLOYMENT': return has('MOM');
    case 'ACRA_CORPORATE': return has('ACRA');
    case 'MAS_FUNDS': return has('MAS');
    case 'ACCOUNTING': return has('ACCOUNTING_STANDARDS') || has('IFRS_FOUNDATION') || has('ACRA');
    case 'UNKNOWN': return true;
  }
}

/** Strictly validates provider output; unknown keys and contradictory flags are rejected. */
export function validateSemanticQuestionInterpretation(value: unknown): SemanticQuestionInterpretation | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [
    'jurisdiction', 'authorityCandidates', 'contextualAuthorities', 'domain', 'population', 'primarySubject', 'concepts',
    'requestedOperation', 'requiresUserSpecificFacts', 'calculationRequested', 'factsExplicitlyProvided', 'confidence'
  ])) return undefined;
  if (!validLabelList(value.jurisdiction, 6) || !validAuthorities(value.authorityCandidates) ||
      !validAuthorities(value.contextualAuthorities) || typeof value.domain !== 'string' || !DOMAINS.has(value.domain as SemanticQuestionDomain) ||
      typeof value.population !== 'string' || !POPULATIONS.has(value.population as SemanticPopulation) ||
      typeof value.primarySubject !== 'string' || !isSafeSemanticLabel(value.primarySubject) ||
      !Array.isArray(value.concepts) || value.concepts.length > 12 ||
      !OPERATIONS.has(value.requestedOperation as SemanticQuestionOperation) ||
      typeof value.requiresUserSpecificFacts !== 'boolean' || typeof value.calculationRequested !== 'boolean' ||
      !validLabelList(value.factsExplicitlyProvided, 12) || typeof value.confidence !== 'number' ||
      !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) return undefined;

  const concepts = value.concepts.flatMap(item => {
    if (!isRecord(item) || !hasExactKeys(item, ['concept', 'role']) || typeof item.concept !== 'string' ||
        !isSafeSemanticLabel(item.concept) ||
        typeof item.role !== 'string' || !CONCEPT_ROLES.has(item.role as SemanticConceptRole)) return [];
    return [{ concept: item.concept.trim(), role: item.role as SemanticConceptRole }];
  });
  if (concepts.length !== value.concepts.length) return undefined;

  const interpretation: SemanticQuestionInterpretation = {
    jurisdiction: value.jurisdiction.map(item => item.trim()),
    authorityCandidates: value.authorityCandidates as SemanticAuthority[],
    contextualAuthorities: value.contextualAuthorities as SemanticAuthority[],
    domain: value.domain as SemanticQuestionDomain,
    population: value.population as SemanticPopulation,
    primarySubject: value.primarySubject.trim(),
    concepts,
    requestedOperation: value.requestedOperation as SemanticQuestionOperation,
    requiresUserSpecificFacts: value.requiresUserSpecificFacts,
    calculationRequested: value.calculationRequested,
    factsExplicitlyProvided: value.factsExplicitlyProvided.map(item => item.trim()),
    confidence: value.confidence
  };
  if (!domainAuthorityIsPossible(interpretation)) return undefined;
  if (interpretation.calculationRequested !== (interpretation.requestedOperation === 'CALCULATE')) return undefined;
  if (interpretation.calculationRequested && !interpretation.requiresUserSpecificFacts) return undefined;
  if (interpretation.requestedOperation === 'PREPARE_JOURNAL' && interpretation.domain !== 'ACCOUNTING') return undefined;
  if (interpretation.authorityCandidates.includes('UNKNOWN') && interpretation.authorityCandidates.length > 1) return undefined;
  return interpretation;
}

function hasConfiguredProvider(provider?: ProviderSettings | string): boolean {
  if (typeof provider === 'string') return provider.trim().length > 10;
  if (!provider || provider.activeProvider === 'offline') return false;
  const partial = provider as Partial<ProviderSettings>;
  if (provider.activeProvider === 'gemini') return (partial.gemini?.apiKey || '').trim().length > 10;
  if (provider.activeProvider === 'openai') return (partial.openai?.apiKey || '').trim().length > 0;
  return (partial.azure?.apiKey || '').trim().length > 0 && (partial.azure?.endpoint || '').trim().length > 0;
}

const SYSTEM_INSTRUCTION = 'Interpret the user question only. Do not answer it or provide accounting, tax, or legal conclusions. Do not invent rules. Identify governing versus contextual authorities. Return only one JSON object matching the requested schema; no explanation or reasoning.';

const RESPONSE_SCHEMA = `Return exactly these keys. Enums: domain=ACCOUNTING|IRAS_INCOME_TAX|IRAS_GST|IRAS_PROPERTY_TAX|IRAS_STAMP_DUTY|IRAS_OTHER|CPF_PAYROLL|MOM_EMPLOYMENT|ACRA_CORPORATE|MAS_FUNDS|UNKNOWN; population=INDIVIDUAL|EMPLOYEE|EMPLOYER|COMPANY|SHAREHOLDER|FUND|PROPERTY_OWNER|UNKNOWN; authority values=IRAS|CPF|ACRA|MOM|MAS|ACCOUNTING_STANDARDS|IFRS_FOUNDATION|SSO|UNKNOWN; operation=EXPLAIN_RULE|EXPLAIN_INTERACTION|DETERMINE_TREATMENT|CHECK_ELIGIBILITY|CALCULATE|PREPARE_JOURNAL|COMPARE|FILING_REQUIREMENT|OTHER; concept role=PRIMARY|RELATED|CONTEXT_ONLY. confidence must be a number from 0 through 1. calculationRequested must be true exactly when operation=CALCULATE; CALCULATE requires requiresUserSpecificFacts=true. PREPARE_JOURNAL requires ACCOUNTING.

Separate general explanation from resolving a particular case. requiresUserSpecificFacts means the requested result depends on facts about the person's or entity's own situation, whether or not the user already supplied those facts; it does not mean that more facts are necessarily missing. Use CHECK_ELIGIBILITY for a specific person's claim or a specific business cost/supply, and set the flag true. Use DETERMINE_TREATMENT with the flag true for a particular transaction, income receipt, or taxpayer case. Use EXPLAIN_RULE or EXPLAIN_INTERACTION with the flag false when explaining general criteria or how rules relate, independent of deciding an identified case. A general rule may mention employers, employees, relatives, business types, conditions, or illustrative amounts and still be conceptual. Put only case facts explicitly stated by the user in factsExplicitlyProvided; omit examples and general conditions.

Identify the taxpayer or regulated party whose own status is at issue, not an employer, employee, relative, customer, or other contextual person. A bare first-person plural or a statement that overseas money was received does not identify whether the recipient is an individual, employer, company, or fund; use population=UNKNOWN unless the question establishes it. Use EMPLOYEE only for the employee's own position, EMPLOYER only for the employer's own obligations, and COMPANY only when the company itself is the taxpayer or claimant. A shareholder is not automatically the company. Do not turn a contextual authority mention into a governing authority. The governing authority must match the domain; contextualAuthorities are merely mentioned.

General illustration: asking for the rules that govern caregiver-related relief is EXPLAIN_RULE or EXPLAIN_INTERACTION, requiresUserSpecificFacts=false, even if the rule has caps and conditions. Case illustration: asking whether a named organization can claim a cost it incurred is CHECK_ELIGIBILITY, requiresUserSpecificFacts=true, even when the cost and amount are already stated. Example JSON: {"jurisdiction":["Singapore"],"authorityCandidates":["IRAS"],"contextualAuthorities":["CPF"],"domain":"IRAS_INCOME_TAX","population":"INDIVIDUAL","primarySubject":"personal income tax relief","concepts":[{"concept":"CPF relief","role":"RELATED"}],"requestedOperation":"EXPLAIN_INTERACTION","requiresUserSpecificFacts":false,"calculationRequested":false,"factsExplicitlyProvided":[],"confidence":0.91}`;

/** Calls only the configured provider with the current question; no evidence or conversation history is supplied. */
export async function interpretSemanticQuestion(
  query: string,
  provider?: ProviderSettings | string,
  callStructured: typeof executeStructuredLlmCall = executeStructuredLlmCall
): Promise<SemanticQuestionUnderstanding> {
  if (!hasConfiguredProvider(provider)) return { mode: 'DETERMINISTIC_FALLBACK', failure: 'NO_PROVIDER' };
  if (query.length > 6_000) return { mode: 'DETERMINISTIC_FALLBACK', failure: 'QUERY_TOO_LONG' };
  const prompt = `${RESPONSE_SCHEMA}\n\nInterpret this question:\n${query}`;
  try {
    const response = await callStructured(prompt, SYSTEM_INSTRUCTION, provider, {
      jsonMode: true,
      timeoutMs: SEMANTIC_QUESTION_TIMEOUT_MS,
      temperature: 0
    });
    if (response.length > 16_000) return { mode: 'DETERMINISTIC_FALLBACK', failure: 'INVALID_RESPONSE' };
    let raw: unknown;
    try { raw = JSON.parse(response); } catch { return { mode: 'DETERMINISTIC_FALLBACK', failure: 'INVALID_RESPONSE' }; }
    const interpretation = validateSemanticQuestionInterpretation(raw);
    if (!interpretation) return { mode: 'DETERMINISTIC_FALLBACK', failure: 'INVALID_RESPONSE' };
    if (interpretation.confidence < SEMANTIC_QUESTION_MIN_CONFIDENCE) return { mode: 'DETERMINISTIC_FALLBACK', failure: 'LOW_CONFIDENCE' };
    return { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  } catch (error) {
    return {
      mode: 'DETERMINISTIC_FALLBACK',
      failure: error instanceof Error && /abort|timed\s*out|timeout/i.test(error.message) ? 'TIMEOUT' : 'PROVIDER_ERROR'
    };
  }
}

function isIrasDomain(domain: SemanticQuestionDomain): boolean {
  return domain.startsWith('IRAS_');
}

function hasExplicitForeignOnlyTaxTarget(query: string): boolean {
  return isExplicitForeignTaxOnlyQuestion(query);
}

function semanticRoutingIsSupported(query: string, interpretation: SemanticQuestionInterpretation): boolean {
  const governingIras = interpretation.authorityCandidates.includes('IRAS');
  if (!isIrasDomain(interpretation.domain) || !governingIras || hasExplicitForeignOnlyTaxTarget(query)) return false;
  const singaporeScope = interpretation.jurisdiction.some(value => /\bsingapore\b/i.test(value)) ||
    /\b(?:singapore|singaporean|iras)\b/i.test(query);
  if (!singaporeScope) return false;
  // A clear payroll-contribution rate question with CPF as the governing
  // authority should remain on the established CPF route. Mentions inside tax
  // relief questions are left to the validated governing/context distinction.
  const asksCpfContribution = /\b(?:cpf|central provident fund)\b/i.test(query) &&
    /\b(?:contribution rate|contribute|ordinary wages?|additional wages?|payroll contribution)\b/i.test(query);
  const hasTaxReliefContext = /\b(?:tax relief|income tax|personal tax|corporate tax|taxable|tax treatment|foreign tax credit|double tax(?:ation)? relief)\b/i.test(query);
  return !(asksCpfContribution && !hasTaxReliefContext);
}

function semanticCpfRoutingIsSupported(query: string, interpretation: SemanticQuestionInterpretation): boolean {
  const taxOutcome = /\b(?:tax relief|claim.{0,24}relief|relief.{0,24}(?:cap|claim)|tax deductible|deductible for tax|tax deduction|taxable|income tax treatment)\b/i;
  const clauses = query.split(/[.!?;,]|\b(?:but|however|whereas|rather than)\b/i);
  const asksTaxOutcome = clauses.some(clause => taxOutcome.test(clause) &&
    !/\b(?:not|no|never|isn't|aren't|doesn't|don't|without)\b[^.?!;]{0,50}\b(?:tax relief|claim.{0,24}relief|relief.{0,24}(?:cap|claim)|tax deductible|deductible for tax|tax deduction|taxable|income tax treatment)\b/i.test(clause));
  return interpretation.domain === 'CPF_PAYROLL' && interpretation.authorityCandidates.includes('CPF') &&
    /\b(?:cpf|central provident fund|ordinary wages?|additional wages?|payroll contribution|cpf contribution)\b/i.test(query) && !asksTaxOutcome;
}

function hasExplicitCaseReference(query: string): boolean {
  return /\b(?:my|our|me|us|i|we|this\s+(?:business|company|income|receipt|expense|cost|claim|transaction|supply)|these\s+(?:expenses|costs|claims|supplies)|the\s+(?:company|business|taxpayer|recipient)(?:'s|’s)?)\b/i.test(query);
}

function isClearlyGeneralRuleQuestion(query: string): boolean {
  const explicitGeneral = /\b(?:in\s+general|generally|as\s+a\s+general\s+rule|general\s+(?:rules?|criteria|conditions)|what\s+are\s+(?:the\s+)?(?:rules|criteria|conditions)|interaction\s+between|interact\w*|overlap\w*|prioriti[sz]\w*|relationship\s+between)\b/i.test(query);
  const capInteraction = /\b(?:cap|limit|threshold)\b/i.test(query) &&
    /\b(?:interact\w*|overlap\w*|prioriti[sz]\w*|relationship)\b/i.test(query);
  return explicitGeneral || capInteraction;
}

function asksForCaseOutcome(query: string): boolean {
  return /\b(?:can|could|may|might|do|does|is|are|am|will|would|should)\b[^?]{0,140}\b(?:claim\w*|qualif\w*|eligib\w*|deduct\w*|taxable|subject\s+to\s+tax|liable|tax\s+treatment|apply\s+to)\b/i.test(query);
}

function refineUnknownEmploymentPopulation(
  query: string,
  semantic: SemanticQuestionInterpretation
): SemanticQuestionInterpretation {
  const semanticSubject = [semantic.primarySubject, ...semantic.concepts
    .filter(item => item.role !== 'CONTEXT_ONLY').map(item => item.concept)].join(' ');
  const explicitCompanyTaxOutcome = /\b(?:company|corporate|business)\b[^.!?]{0,100}\b(?:deduct\w*|taxable profits?|chargeable income|tax return|form c(?:-s)?|\beci\b)\b|\b(?:deduct\w*|taxable profits?|chargeable income|tax return|form c(?:-s)?|\beci\b)[^.!?]{0,100}\b(?:company|corporate|business)\b/i.test(query);
  const namesEmploymentRecipient = /\b(?:employee|employees|staff|workers?|employer[ -]?(?:funded|paid))\b/i.test(query) ||
    /\bemployment\s+benefits?\b/i.test(`${query} ${semanticSubject}`);
  const asksEmployerCompliance = /\b(?:ir21|ir8a|ir8s|ais|fil(?:e|ing)|report(?:ing)?|withhold(?:ing)?)\b/i.test(query) &&
    /\b(?:employer|employee|employees|staff)\b/i.test(query);
  const employmentBenefitQuestion = semantic.domain === 'IRAS_INCOME_TAX' && namesEmploymentRecipient &&
    /\b(?:benefits?\s+in\s+kind|perquisites?|employment\s+benefits?|housing\s+allowances?|personal\s+insurance|reimbursements?)\b/i.test(`${query} ${semanticSubject}`) &&
    /\b(?:tax(?:able|ability|ed)?|income\s+tax|perquisites?|benefits?\s+in\s+kind)\b/i.test(`${query} ${semanticSubject}`) &&
    !explicitCompanyTaxOutcome && !asksEmployerCompliance;
  if (employmentBenefitQuestion && semantic.population !== 'EMPLOYEE') {
    return validateSemanticQuestionInterpretation({ ...semantic, population: 'EMPLOYEE' }) || semantic;
  }
  if (semantic.domain !== 'IRAS_INCOME_TAX' || semantic.population !== 'UNKNOWN') return semantic;
  const describesEmploymentIncome = /\b(?:employment\s+income|employee\s+(?:income|earnings)|salary|wages?)\b/i.test(semanticSubject);
  const identifiesEmployeeRecipient = /\b(?:employees?|individuals?|persons?|tax\s+residents?|resident\s+individuals?)\b[^.!?]{0,180}\b(?:earn\w*|receive\w*|derive\w*|employment\s+income|salar(?:y|ies)|wages?|income|pay\w*\s+tax|taxed)\b/i.test(query) ||
    /\b(?:earn\w*|receive\w*|derive\w*)\b[^.!?]{0,180}\b(?:employment\s+income|salar(?:y|ies)|wages?)\b/i.test(query) ||
    /\b(?:salar(?:y|ies)|wages?|employment\s+income)\b[^.!?]{0,180}\b(?:taxed\s+twice|double\s+tax(?:ation)?|foreign\s+tax\s+credits?)\b/i.test(query);
  const hasTaxTreatyQuestion = /\b(?:income\s+tax|tax\s+treatment|taxable|double\s+tax(?:ation)?|tax\s+treaty|foreign\s+tax\s+credits?)\b/i.test(query);
  if (!describesEmploymentIncome || !identifiesEmployeeRecipient || !hasTaxTreatyQuestion) return semantic;
  return validateSemanticQuestionInterpretation({ ...semantic, population: 'EMPLOYEE' }) || semantic;
}

function explicitlyRequestsCpfPayrollOutcome(query: string): boolean {
  const asksForRate = /\b(?:what|which|current|applicable)\b[^.!?]{0,45}\b(?:cpf|central provident fund)\b[^.!?]{0,40}\b(?:contribution\s+)?rates?\b/i.test(query) ||
    /\b(?:calculate|compute|work\s+out|determine|estimate)\b[^.!?]{0,35}\b(?:cpf|central provident fund)\b[^.!?]{0,25}\b(?:contribution\s+)?rates?\b/i.test(query);
  const asksApplicableRate = /\b(?:current|applicable)\b[^.!?]{0,45}\b(?:cpf|central provident fund)\b[^.!?]{0,40}\b(?:contribution\s+)?rates?\b/i.test(query) ||
    /\b(?:what|which)\b[^.!?]{0,25}\b(?:cpf|central provident fund)\b[^.!?]{0,25}\b(?:contribution\s+)?rates?\s+(?:currently\s+)?appl(?:y|ies)\b/i.test(query);
  const asksForObligation = /\b(?:how much|what amount|what|which|calculate|compute|work\s+out|determine|estimate|must|should)\b[^.!?]{0,60}\b(?:employer|employee|cpf|central provident fund)\b[^.!?]{0,50}\b(?:contribution|contribute|payroll)\b[^.!?]{0,30}\b(?:due|payable|owe|owed|pay|paid|obligation|amount)\b/i.test(query) ||
    /\b(?:employer|employee)\b[^.!?]{0,50}\b(?:must|should|will|needs? to)\s+(?:pay|contribute)\b[^.!?]{0,40}\b(?:cpf|central provident fund)\b/i.test(query);
  const calculatesSeparatePayroll = /\b(?:calculate|compute|work\s+out|determine|estimate)\b[^.!?]{0,45}\b(?:employer|employee)\b[^.!?]{0,35}\b(?:cpf|central provident fund)\s+(?:contributions?|payroll)\b/i.test(query);
  const asksCalculatedCpfOutcome = /\b(?:calculate|compute|work\s+out|determine|estimate)\b[^.!?]{0,45}\b(?:employer|employee|cpf|central provident fund)\b[^.!?]{0,40}\b(?:contribution|contribute|payroll|amount|rate)\b/i.test(query);
  const asksConceptualRelationship = /\b(?:relationship|interact\w*|overlap\w*|interplay)\b/i.test(query);
  const asksExplicitObligationAmount = /\b(?:how much|what amount)\b[^.!?]{0,100}\b(?:cpf|central provident fund|employer|employee)\b[^.!?]{0,60}\b(?:contributions?|contribute|payroll|pay|obligation)\b/i.test(query) ||
    /\bwhat\s+must\s+(?:the\s+)?(?:employer|employee)\s+(?:pay|contribute)\b[^.!?]{0,40}\b(?:cpf|central provident fund)\b/i.test(query) ||
    /\b(?:what|which)\s+(?:is\s+)?(?:the\s+)?(?:cpf|central provident fund)\b[^.!?]{0,25}\b(?:obligation|contribution amount|amount payable|contributions? due)\b/i.test(query);
  const directRateRequest = asksForRate && (!asksConceptualRelationship || asksApplicableRate || asksCalculatedCpfOutcome);
  const directObligationRequest = asksExplicitObligationAmount || asksForObligation && !asksConceptualRelationship;
  return directRateRequest || directObligationRequest || calculatesSeparatePayroll;
}

function isContextualCpfInPersonalReliefQuestion(query: string, semantic: SemanticQuestionInterpretation): boolean {
  const isReliefCalculation = semantic.calculationRequested && semantic.requestedOperation === 'CALCULATE';
  const isConceptualReliefInteraction = semantic.requestedOperation === 'EXPLAIN_INTERACTION' &&
    !semantic.requiresUserSpecificFacts &&
    /\b(?:relationship|interact\w*|overlap\w*|interplay)\b/i.test(query) &&
    /\b(?:cap|limit|threshold)\b/i.test(query);
  return semantic.domain === 'IRAS_INCOME_TAX' &&
    (semantic.population === 'INDIVIDUAL' || semantic.population === 'EMPLOYEE') &&
    (isReliefCalculation || isConceptualReliefInteraction) &&
    /\b(?:personal\s+(?:income\s+)?tax(?:\s+relief)?|income\s+tax\s+relief|personal\s+relief|relief\s+cap|tax\s+relief\s+cap)\b/i.test(query) &&
    /\b(?:cpf|central provident fund)\b/i.test(query) &&
    !explicitlyRequestsCpfPayrollOutcome(query);
}

function toRegistryDomain(domain: SemanticQuestionDomain, population: SemanticPopulation): SingaporeKnowledgeDomain | undefined {
  switch (domain) {
    case 'IRAS_INCOME_TAX':
      if (population === 'INDIVIDUAL' || population === 'EMPLOYEE') return 'IRAS_INDIVIDUAL_TAX';
      if (population === 'EMPLOYER') return 'IRAS_EMPLOYER_TAX';
      if (population === 'COMPANY' || population === 'FUND') return 'IRAS_CORPORATE_TAX';
      return undefined;
    case 'IRAS_GST': return 'IRAS_GST';
    case 'IRAS_PROPERTY_TAX': return 'IRAS_PROPERTY_TAX';
    case 'IRAS_STAMP_DUTY': return 'IRAS_STAMP_DUTY';
    default: return undefined;
  }
}

function canonicalRequestedConcepts(query: string, semantic?: SemanticQuestionInterpretation): RequestedQuestionConcept[] {
  const semanticLabels = semantic?.concepts.filter(item => item.role !== 'CONTEXT_ONLY').map(item => item.concept) || [];
  const text = `${query} ${semantic?.primarySubject || ''} ${semanticLabels.join(' ')}`.toLowerCase();
  const concepts: RequestedQuestionConcept[] = [];
  const add = (id: string, label: string, terms: string[], topicIds: string[]) => {
    if (!concepts.some(item => item.id === id)) concepts.push({ id, label, terms, topicIds });
  };
  const personalReliefContext = /\b(?:personal|individual)\s+(?:income\s+)?tax\s+relief\b|\bpersonal\s+relief\b/i.test(text) ||
    /\b(?:srs|cpf)\b/i.test(text) && /\b(?:relief|tax\s+cap|relief\s+cap)\b/i.test(text);
  const asksReliefCap = personalReliefContext && /\b(?:relief\s+cap|cap\s+of\s+(?:sgd\s*)?\$?\s*80,?000|overall\s+(?:personal\s+)?(?:income\s+tax\s+)?relief|aggregate\s+(?:personal\s+)?(?:income\s+tax\s+)?relief|total\s+(?:personal\s+)?relief\s+limit)\b/i.test(text);
  if (asksReliefCap) add('personal_income_tax_relief_cap', 'Overall personal income tax relief cap',
    ['personal income tax relief cap', 'overall relief cap', 'aggregate relief cap', '80,000 relief cap'], ['iras-individual-relief-cap']);
  if (personalReliefContext && /\b(?:cpf|central provident fund|mandatory cpf contributions?|compulsory cpf contributions?)\b/i.test(text)) {
    add('cpf_relief', 'CPF Relief / compulsory CPF contributions', ['cpf relief', 'central provident fund relief', 'compulsory cpf contributions'], ['iras-individual-cpf-relief']);
  }
  if (personalReliefContext && /\b(?:srs|supplementary retirement scheme)\b/i.test(text)) {
    add('srs_relief', 'Supplementary Retirement Scheme (SRS) Relief', ['srs relief', 'supplementary retirement scheme relief'], ['iras-individual-srs-relief']);
  }
  if (personalReliefContext) {
    if (/\b(?:parenthood|parent relief|parents? relief)\b/i.test(text)) {
      add('parent_relief', 'Parent Relief', ['parent relief', 'parents relief'], ['iras-individual-parent-relief']);
    }
    if (/\b(?:caregiver|grandparent caregiver|caregiving)\b/i.test(text)) {
      add('grandparent_caregiver_relief', 'Grandparent Caregiver Relief', ['grandparent caregiver relief', 'caregiver relief'], ['iras-individual-grandparent-caregiver-relief']);
    }
    if (/\b(?:parenthood|caregiver|working mother|wmcr|qualifying child|qcr)\b/i.test(text)) {
      add('working_mother_child_relief', "Working Mother's Child Relief (WMCR)", ['working mother child relief', 'wmcr'], ['iras-individual-wmcr']);
      add('qualifying_child_relief', 'Qualifying Child Relief (QCR)', ['qualifying child relief', 'qcr'], ['iras-individual-qcr']);
    }
    if (asksReliefCap && /\b(?:overlap\w*|prioriti[sz]\w*|order|sequence|interact\w*|interplay)\b/i.test(text)) {
      add('relief_claim_prioritization', 'Order or prioritization among relief claims', ['order of relief claims', 'priority among relief claims', 'prioritization of relief claims', 'sequence of tax relief claims'], []);
    }
  }
  const companyProfitDeductionOutcome = /\b(?:company|corporate|business)\b[^.!?]{0,100}\b(?:deduct\w*|taxable profits?|chargeable income|tax return|form c(?:-s)?|\beci\b)\b|\b(?:deduct\w*|taxable profits?|chargeable income|tax return|form c(?:-s)?|\beci\b)[^.!?]{0,100}\b(?:company|corporate|business)\b/i.test(query);
  const namesEmploymentRecipient = /\b(?:employee|employees|staff|workers?|employer[ -]?(?:funded|paid))\b/i.test(query) ||
    /\bemployment\s+benefits?\b/i.test(text);
  const employeeBenefits = !companyProfitDeductionOutcome && namesEmploymentRecipient &&
    /\b(?:benefits?\s+in\s+kind|perquisites?|employment\s+benefits?|housing\s+allowances?|personal\s+insurance|reimbursements?)\b/i.test(query) &&
    /\b(?:tax(?:able|ability|ed)?|income\s+tax|perquisites?|benefits?\s+in\s+kind)\b/i.test(query);
  if (employeeBenefits) {
    add('employee_benefit_tax_treatment', 'Tax treatment of employee benefits and perquisites',
      ['employee benefits', 'employment benefits', 'benefits in kind', 'benefits-in-kind', 'taxable perquisites', 'gains and profits derived by an employee'], ['iras-employment-benefits']);
    if (/\b(?:business\s+reimbursements?|reimbursements?)\b/i.test(query)) {
      add('employee_reimbursement_tax_treatment', 'Employee reimbursement tax treatment',
        ['employee reimbursements', 'business reimbursements', 'taxable vs non-taxable reimbursements', 'reimbursement for an item', 'reimbursement to an employee'], ['iras-employment-benefits']);
    }
    if (/\b(?:housing\s+allowances?|accommodation|rent paid by (?:the )?employer)\b/i.test(query)) {
      add('employee_housing_benefit_tax_treatment', 'Employee housing and accommodation tax treatment',
        ['housing allowance', 'housing allowances', 'accommodation and related benefits', 'accommodation provided to an employee', 'rent paid by employer'], ['iras-employment-benefits']);
    }
    if (/\b(?:personal\s+insurance|insurance\s+premiums?)\b/i.test(query)) {
      add('employee_personal_insurance_tax_treatment', 'Employee personal insurance premium tax treatment',
        ['personal insurance', 'insurance premium', 'insurance premiums', 'personal insurance policy where employee is policyholder', 'employer-paid insurance premium'], ['iras-employment-benefits']);
    }
  }
  const requestedDomain = concepts.some(concept => concept.id === 'employee_benefit_tax_treatment')
    ? 'IRAS_EMPLOYER_TAX'
    : semantic ? toRegistryDomain(semantic.domain, semantic.population) : undefined;

  // Semantic labels are retrieval aids. Keep them in the requested-concept
  // diagnostic and discovery list, while evidence checks still require their
  // meaning to occur in an admitted official source's text.
  for (const label of semanticLabels) {
    const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (normalized.length < 5 || concepts.some(item => item.label.toLowerCase().includes(normalized) || normalized.includes(item.label.toLowerCase()))) continue;
    const hasCanonical = (id: string) => concepts.some(concept => concept.id === id);
    const isAlreadyCoveredCanonicalConcept =
      hasCanonical('cpf_relief') && /\b(?:cpf|central provident fund)\b/.test(normalized) && /\b(?:reliefs?|contributions?)\b/.test(normalized) ||
      hasCanonical('srs_relief') && /\b(?:srs|supplementary retirement scheme)\b/.test(normalized) && /\breliefs?\b/.test(normalized) ||
      ['parent_relief', 'grandparent_caregiver_relief', 'working_mother_child_relief', 'qualifying_child_relief'].some(hasCanonical) &&
        /\b(?:parenthood|parent|caregiver|family|working mother|wmcr|qualifying child|qcr)\b/.test(normalized) && /\breliefs?\b/.test(normalized) ||
      hasCanonical('personal_income_tax_relief_cap') && /\b(?:personal|individual)\b/.test(normalized) && /\breliefs?\b/.test(normalized) && /\b(?:cap|limit|ceiling)\b/.test(normalized) ||
      hasCanonical('employee_benefit_tax_treatment') && (
        hasCanonical('employee_reimbursement_tax_treatment') && /\breimbursements?\b/.test(normalized) ||
        hasCanonical('employee_housing_benefit_tax_treatment') && /\b(?:housing|accommodation|rent)\b/.test(normalized) ||
        hasCanonical('employee_personal_insurance_tax_treatment') && /\b(?:personal insurance|insurance premiums?)\b/.test(normalized) ||
        /\b(?:benefits? in kind|perquisites?|employment benefits?)\b/.test(normalized)
      );
    if (isAlreadyCoveredCanonicalConcept) continue;
    const mappedTopics = defaultQueryTopicResolver.decomposeQuery(label).topics
      .filter(topic => topic.domainId.startsWith('IRAS_') && (!requestedDomain || topic.domainId === requestedDomain))
      .map(topic => topic.id);
    if (mappedTopics.some(topicId => concepts.some(concept => concept.topicIds.includes(topicId)))) continue;
    const id = `semantic_${normalized.replace(/\s+/g, '_').slice(0, 48)}`;
    add(id, label, [label], mappedTopics);
  }
  return concepts;
}

/** Concepts derived from the complete query plus validated intent labels; never evidence by themselves. */
export function getRequestedQuestionConcepts(query: string, understanding?: SemanticQuestionUnderstanding | SemanticQuestionInterpretation): RequestedQuestionConcept[] {
  const semantic = validateSemanticQuestionInterpretation(
    understanding && 'interpretation' in understanding ? understanding.interpretation : understanding
  );
  return canonicalRequestedConcepts(query, semantic);
}

/** Query terms used only to rank/fetch scoped evidence; user facts and evidence gates keep the original question. */
export function buildSemanticDiscoveryQuery(query: string, interpretation?: SemanticQuestionInterpretation): string {
  const semantic = validateSemanticQuestionInterpretation(interpretation);
  if (!semantic || !isIrasDomain(semantic.domain)) return query;
  const concepts = semantic.concepts.filter(item => item.role !== 'CONTEXT_ONLY').map(item => item.concept);
  return [query, semantic.primarySubject, ...concepts, semantic.population, semantic.requestedOperation]
    .filter(Boolean).join(' ');
}

export function isShortSemanticFollowUp(query: string): boolean {
  const shortQuery = query.trim();
  if (shortQuery.length > 140) return false;
  const continuationPrefix = /^\s*(?:and|also|so|then|what about|how about|would that|is that|does that|can i for that|why is that|how does that)\b/i.test(shortQuery);
  const questionWithExplicitAnaphora = /^\s*(?:can|could|would|should|do|does|is|are|what|how)\b[^?]{0,110}\b(?:it|that|this\s+(?:transaction|purchase|expense|supply|asset|invoice|amount|case)|the same (?:transaction|purchase|expense|supply))\b[^?]*\??\s*$/i.test(shortQuery);
  return continuationPrefix || questionWithExplicitAnaphora;
}

export interface ReconciledQuestionUnderstanding {
  classification: QuestionClassificationResult;
  understanding: SemanticQuestionUnderstanding;
}

/** Deterministically guards and projects the semantic interpretation into existing IRAS routing fields. */
export function reconcileQuestionUnderstanding(
  query: string,
  classification: QuestionClassificationResult,
  understanding: SemanticQuestionUnderstanding
): ReconciledQuestionUnderstanding {
  const wrapperIsValidated = (understanding.mode === 'SEMANTIC_INTERPRETATION' || understanding.mode === 'SEMANTIC_PLUS_RULES') &&
    understanding.failure === undefined;
  const validatedSemantic = wrapperIsValidated ? validateSemanticQuestionInterpretation(understanding.interpretation) : undefined;
  const semantic = validatedSemantic ? refineUnknownEmploymentPopulation(query, validatedSemantic) : undefined;
  if (!semantic || semantic.confidence < SEMANTIC_QUESTION_MIN_CONFIDENCE) {
    return { classification, understanding: { mode: 'DETERMINISTIC_FALLBACK', failure: understanding.failure || (semantic ? 'INVALID_RESPONSE' : undefined) } };
  }

  // Semantic understanding is currently an IRAS reference implementation.
  // CPF semantics only constrain an already-supported contribution route;
  // they do not add new CPF knowledge or source coverage.
  if (semantic.domain === 'CPF_PAYROLL') {
    if (!semanticCpfRoutingIsSupported(query, semantic)) return { classification, understanding: { mode: 'DETERMINISTIC_FALLBACK', failure: 'INVALID_RESPONSE' } };
    const conceptText = [semantic.primarySubject, ...semantic.concepts.filter(item => item.role !== 'CONTEXT_ONLY').map(item => item.concept)].join(' ');
    const cpfTopics = defaultQueryTopicResolver.decomposeQuery(conceptText).topics
      .filter(topic => topic.domainId.startsWith('CPF_')).map(topic => topic.id);
    const existingCpfTopics = classification.topicIds.filter(id => getCoverageTopicsByIds([id])[0]?.domainId.startsWith('CPF_'));
    const topicIds = [...new Set([...existingCpfTopics, ...cpfTopics])];
    const domains = [...new Set([...getCoverageTopicsByIds(topicIds).map(topic => topic.domainId), ...(topicIds.length ? [] : ['CPF_CONTRIBUTIONS' as SingaporeKnowledgeDomain])])];
    return {
      classification: {
        ...classification,
        primaryDomain: 'PAYROLL', domains, topicIds, authorities: ['CPF'], multiAuthority: false,
        accountingAnalysisRequired: false, taxAnalysisRequired: false, regulatoryAnalysisRequired: true,
        calculationRequired: semantic.calculationRequested, journalEntryRequired: false,
        missingFacts: requiresCaseSpecificFacts(query, semantic)
          ? ['Employee age band, citizenship or residency status, wage type, and applicable contribution period.']
          : [],
        intent: 'STATUTORY_ADVISORY',
        reasoning: `Semantic interpretation routed this ${semantic.population.toLowerCase()} contribution question to CPF.`
      },
      understanding: { ...understanding, interpretation: semantic, mode: 'SEMANTIC_PLUS_RULES' }
    };
  }
  // For authorities outside the scoped IRAS/CPF route, retain the existing
  // deterministic behavior while exposing the validated semantic metadata.
  if (!isIrasDomain(semantic.domain)) return { classification, understanding: { ...understanding, interpretation: semantic, mode: 'SEMANTIC_PLUS_RULES' } };
  const corroboratedNonIrasGovernors = semantic.authorityCandidates.filter(authority =>
    authority !== 'IRAS' && classification.authorities.includes(authority) &&
    !(authority === 'CPF' && isContextualCpfInPersonalReliefQuestion(query, semantic)));
  const deterministicCpfOutcomeRequested = classification.authorities.includes('CPF') && explicitlyRequestsCpfPayrollOutcome(query);
  if (corroboratedNonIrasGovernors.length > 0 || deterministicCpfOutcomeRequested) {
    return { classification, understanding: { mode: 'DETERMINISTIC_FALLBACK', failure: 'INVALID_RESPONSE' } };
  }
  if (!semanticRoutingIsSupported(query, semantic)) {
    return { classification, understanding: { mode: 'DETERMINISTIC_FALLBACK', failure: understanding.failure || 'INVALID_RESPONSE' } };
  }

  const conceptText = [semantic.primarySubject, ...semantic.concepts.filter(item => item.role !== 'CONTEXT_ONLY').map(item => item.concept)].join(' ');
  const requestedConcepts = canonicalRequestedConcepts(query, semantic);
  const hasEmploymentBenefitTopic = requestedConcepts.some(concept => concept.topicIds.includes('iras-employment-benefits'));
  const selectedDomain = hasEmploymentBenefitTopic ? 'IRAS_EMPLOYER_TAX' : toRegistryDomain(semantic.domain, semantic.population);
  const semanticTopicIds = (semantic.domain === 'IRAS_INCOME_TAX' && !selectedDomain ? [] : defaultQueryTopicResolver.decomposeQuery(conceptText).topics)
    .filter(topic => topic.domainId.startsWith('IRAS_'))
    .filter(topic => {
      return !selectedDomain || topic.domainId === selectedDomain ||
        hasEmploymentBenefitTopic && topic.id === 'iras-employment-benefits';
    })
    .map(topic => topic.id);
  const targetDomain = selectedDomain;
  const topicIds = [...new Set([
    ...classification.topicIds.filter(id => {
      const topic = getCoverageTopicsByIds([id])[0];
      return topic?.domainId.startsWith('IRAS_') && (targetDomain ? topic.domainId === targetDomain : semanticTopicIds.includes(id)) ||
        hasEmploymentBenefitTopic && id === 'iras-employment-benefits';
    }),
    ...semanticTopicIds,
    ...requestedConcepts.flatMap(concept => concept.topicIds.filter(id => {
      const topic = getCoverageTopicsByIds([id])[0];
      return topic?.domainId.startsWith('IRAS_') && (!targetDomain || topic.domainId === targetDomain) ||
        hasEmploymentBenefitTopic && id === 'iras-employment-benefits';
    }))
  ])];
  const domains = [...new Set([
    ...getCoverageTopicsByIds(topicIds).map(topic => topic.domainId),
    ...(targetDomain ? [targetDomain] : [])
  ])];
  const operation = semantic.requestedOperation;
  const needsSpecificFacts = requiresCaseSpecificFacts(query, semantic);
  const primaryDomain = semantic.domain === 'IRAS_GST' ? 'GST' : 'TAX';
  const retainsAccountingScope = classification.accountingAnalysisRequired &&
    /\b(?:accounting|journal|bookkeeping|balance sheet|financial statements?|sfrs|ifrs|ias\s*\d+|how to record|recording the transaction|book the transaction)\b/i.test(query);
  const semanticMissingFacts = needsSpecificFacts
    ? [...new Set([
      ...(retainsAccountingScope ? classification.missingFacts : []),
      ...relevantDeterministicMissingFacts(query, classification, semantic)
    ])]
    : [];
  const reconciled: QuestionClassificationResult = {
    ...classification,
    primaryDomain: retainsAccountingScope ? 'MIXED' : primaryDomain,
    domains: retainsAccountingScope
      ? [...new Set([...classification.domains.filter(domain => !domain.startsWith('IRAS_') || domains.includes(domain)), ...domains])]
      : domains,
    topicIds: retainsAccountingScope
      ? [...new Set([...classification.topicIds.filter(id => getCoverageTopicsByIds([id])[0]?.domainId.startsWith('ACCOUNTING_')), ...topicIds])]
      : topicIds,
    authorities: retainsAccountingScope ? [...new Set([...classification.authorities, 'IRAS'])] : ['IRAS'],
    multiAuthority: retainsAccountingScope || false,
    accountingAnalysisRequired: retainsAccountingScope,
    taxAnalysisRequired: true,
    regulatoryAnalysisRequired: retainsAccountingScope ? classification.regulatoryAnalysisRequired : false,
    calculationRequired: retainsAccountingScope ? classification.calculationRequired || semantic.calculationRequested : semantic.calculationRequested,
    journalEntryRequired: retainsAccountingScope ? classification.journalEntryRequired || operation === 'PREPARE_JOURNAL' : operation === 'PREPARE_JOURNAL',
    missingFacts: semanticMissingFacts,
    intent: retainsAccountingScope ? classification.intent : operation === 'PREPARE_JOURNAL' ? 'HYBRID' : 'STATUTORY_ADVISORY',
    reasoning: `Semantic interpretation routed this ${semantic.population.toLowerCase()} question to IRAS for ${semantic.primarySubject}.`
  };
  return { classification: reconciled, understanding: { ...understanding, interpretation: semantic, mode: 'SEMANTIC_PLUS_RULES' } };
}

/** Safe allowlisted telemetry projection; user facts and contextual authority mentions are deliberately excluded. */
export function projectQuestionUnderstandingDiagnostics(understanding: SemanticQuestionUnderstanding): QuestionUnderstandingDiagnostics | undefined {
  const semantic = validateSemanticQuestionInterpretation(understanding.interpretation);
  if (!semantic) return {
    mode: 'DETERMINISTIC_FALLBACK', population: 'UNKNOWN', primarySubject: '',
    requestedOperation: 'OTHER', authorityCandidates: [], concepts: []
  };
  return {
    mode: understanding.mode,
    population: semantic.population,
    primarySubject: sanitizeSemanticDiagnosticLabel(semantic.primarySubject),
    requestedOperation: semantic.requestedOperation,
    authorityCandidates: semantic.authorityCandidates.filter(authority => authority !== 'UNKNOWN'),
    concepts: semantic.concepts.filter(item => item.role !== 'CONTEXT_ONLY').map(item => sanitizeSemanticDiagnosticLabel(item.concept)).filter(Boolean).slice(0, 12)
  };
}

/** Values for a transient IRAS retrieval topic. These only affect target selection/ranking. */
export function getSemanticIrasDiscoveryContext(understanding: SemanticQuestionUnderstanding | undefined, query = '') {
  const semantic = validateSemanticQuestionInterpretation(understanding?.interpretation);
  if (!semantic || !isIrasDomain(semantic.domain) || !semantic.authorityCandidates.includes('IRAS')) return undefined;
  const requestedConcepts = canonicalRequestedConcepts(query, semantic);
  const semanticText = `${semantic.primarySubject} ${semantic.concepts.filter(item => item.role !== 'CONTEXT_ONLY').map(item => item.concept).join(' ')}`;
  const employmentBenefitSubject = /\b(?:benefits?|perquisites?|reimbursements?|housing allowances?|insurance)\b/i.test(semanticText);
  const employmentBenefits = semantic.domain === 'IRAS_INCOME_TAX' && employmentBenefitSubject &&
    (semantic.population === 'EMPLOYEE' || requestedConcepts.some(concept => concept.topicIds.includes('iras-employment-benefits')));
  const domainId = employmentBenefits ? 'IRAS_EMPLOYER_TAX' : toRegistryDomain(semantic.domain, semantic.population) || 'IRAS_OTHER';
  return {
    domainId,
    population: semantic.population,
    primarySubject: semantic.primarySubject,
    concepts: semantic.concepts.filter(item => item.role !== 'CONTEXT_ONLY').map(item => item.concept),
    requestedConcepts,
    mappedTopicIds: [...new Set(requestedConcepts.flatMap(concept => concept.topicIds))],
    requestedOperation: semantic.requestedOperation
  };
}

function relevantDeterministicMissingFacts(
  query: string,
  classification: QuestionClassificationResult,
  semantic: SemanticQuestionInterpretation
): string[] {
  const { domain, population } = semantic;
  const allowed = domain === 'IRAS_GST'
    ? /gst|input tax|output tax|meal|entertainment|supplier|customer|invoice|business|private|vehicle|supply|recipient|place of/i
    : domain === 'IRAS_INCOME_TAX'
      ? population === 'INDIVIDUAL' || population === 'EMPLOYEE'
        ? /tax|income|employment|employee|resident|relief|year of assessment|foreign|treaty|recipient|payment|period/i
        : population === 'COMPANY' || population === 'FUND'
          ? /tax|income|company|sharehold|foreign|business|year of assessment|recipient|payment|period|ownership|loss/i
          : /taxpayer|recipient|income|source|period|amount/i
      : /tax|income|property|ownership|stamp|transfer|date|amount|period/i;
  const retained = classification.missingFacts.filter(fact => allowed.test(fact));
  if (retained.length) return retained;
  const isPureConceptualPrefix = /^(?:what\s+is|what\s+are|explain|define|definition|describe|overview|difference\s+between|how\s+does|summari[sz]e)\b/i.test(query.trim());
  const hasClaimantRegistration = /\b(?:our|my)\s+(?:company|business)\s+(?:is|was|remains)\s+(?:gst[ -]?registered|registered for gst)\b/i.test(query) ||
    /\b(?:our|my)\s+(?:gst[ -]?registered|registered for gst)\s+(?:company|business)\b/i.test(query);
  const claimantRegistrationNegated = /\b(?:our|my)\s+(?:company|business)\s+(?:is|was|remains)\s+(?:not|never|isn't|unregistered)\s+(?:gst[ -]?registered|registered for gst)\b/i.test(query);
  const hasSupplierRegistration = /\b(?:supplier|vendor)\s+(?:is|was|remains)\s+(?:gst[ -]?registered|registered for gst)\b/i.test(query) ||
    /\b(?:gst[ -]?registered|registered for gst)\s+(?:supplier|vendor)\b/i.test(query);
  const supplierRegistrationNegated = /\b(?:supplier|vendor)\s+(?:is|was|remains)\s+(?:not|never|isn't|unregistered)\s+(?:gst[ -]?registered|registered for gst)\b/i.test(query) ||
    /\b(?:not|never|isn't|unregistered)\s+(?:gst[ -]?registered|registered for gst)\s+(?:supplier|vendor)\b/i.test(query);
  const isCompleteMealInputTaxCase = domain === 'IRAS_GST' &&
    !semantic.calculationRequested && semantic.requestedOperation !== 'CALCULATE' &&
    !isPureConceptualPrefix &&
    classification.primaryDomain === 'GST' && classification.authorities.includes('IRAS') &&
    /\b(?:meal|meals|lunch|dinner|dining|entertainment)\b/i.test(query) &&
    /\b(?:input tax|input gst)\b/i.test(query) &&
    /\b(?:claim|recover)\w*\b/i.test(query) &&
    /\btax invoice\b/i.test(query) &&
    hasClaimantRegistration && !claimantRegistrationNegated &&
    hasSupplierRegistration && !supplierRegistrationNegated;
  if (isCompleteMealInputTaxCase) return [];
  if (domain === 'IRAS_INCOME_TAX' && (population === 'UNKNOWN' || population === 'EMPLOYER')) {
    return ['Nature of the taxpayer or recipient and the source/type of income.'];
  }
  if (domain === 'IRAS_INCOME_TAX' && (population === 'INDIVIDUAL' || population === 'EMPLOYEE')) {
    return ['Facts relevant to the individual eligibility or treatment question, including the relevant tax year and personal circumstances.'];
  }
  if (domain === 'IRAS_INCOME_TAX' && (population === 'COMPANY' || population === 'SHAREHOLDER' || population === 'FUND')) {
    return ['Facts relevant to the company income or claim, including the relevant tax year and supporting transaction details.'];
  }
  if (domain === 'IRAS_GST') return ['Nature and business purpose of the purchase or supply, parties’ GST status, and supporting tax invoice where relevant.'];
  return ['Facts needed to identify the taxpayer or recipient, relevant period, and transaction or income type.'];
}

function requiresCaseSpecificFacts(query: string, semantic: SemanticQuestionInterpretation): boolean {
  const hasCaseReference = hasExplicitCaseReference(query);
  if (semantic.calculationRequested || semantic.requestedOperation === 'CALCULATE') return true;
  if (hasCaseReference && asksForCaseOutcome(query)) return true;
  if (!hasCaseReference && isClearlyGeneralRuleQuestion(query)) return false;
  if (semantic.requiresUserSpecificFacts || semantic.requestedOperation === 'CHECK_ELIGIBILITY') return true;
  if (semantic.requestedOperation !== 'DETERMINE_TREATMENT' ||
      isClearlyGeneralRuleQuestion(query) && !hasCaseReference) return false;
  const containsSpecificEvent = /\b(?:paid|incurred|purchased|received|earned|sold|supplied|imported|transferred|owned|charged|provided)\b/i.test(query) &&
    /\b(?:expense|cost|income|receipt|supply|transaction|fee|amount|goods|asset|service|sale|salary|wage|business)\b/i.test(query);
  return containsSpecificEvent || semantic.factsExplicitlyProvided.length > 0 && hasCaseReference;
}
