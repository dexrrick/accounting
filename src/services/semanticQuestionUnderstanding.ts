import { isExplicitForeignTaxOnlyQuestion, type QuestionClassificationResult } from '../classification/questionClassifier';
import type { SingaporeKnowledgeDomain } from '../standards/coverageRegistry';
import { getCoverageTopicsByIds } from '../standards/coverageRegistry';
import { defaultQueryTopicResolver } from '../retrieval/queryTopicResolver';
import type { ProviderSettings } from '../types/provider';
import { executeStructuredLlmCall } from './aiTransport';

export const SEMANTIC_QUESTION_MIN_CONFIDENCE = 0.72;
export const SEMANTIC_QUESTION_TIMEOUT_MS = 8_000;
export const SEMANTIC_QUESTION_SCHEMA_VERSION = 2 as const;

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
export type SemanticEvidenceRequirement = 'AUTHORITATIVE_SOURCE' | 'CASE_FACTS' | 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' | 'UNRESOLVED';

/** One material workstream identified in a compound question. IDs are assigned during reconciliation. */
export interface SemanticQuestionIssue {
  subject: string;
  population: SemanticPopulation;
  domain: SemanticQuestionDomain;
  governingAuthorities: SemanticAuthority[];
  contextualAuthorities: SemanticAuthority[];
  operation: SemanticQuestionOperation;
  mappedTopicIds: string[];
  evidenceRequirement: SemanticEvidenceRequirement;
  confidence: number;
}

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
  /** Optional for compatibility with existing single-issue providers and fixtures. */
  issues?: SemanticQuestionIssue[];
}

/** Versioned provider wire contract. The calculation flag is derived after validation. */
export type SemanticQuestionInterpretationV2 = Omit<SemanticQuestionInterpretation, 'calculationRequested' | 'issues'> & {
  schemaVersion: typeof SEMANTIC_QUESTION_SCHEMA_VERSION;
  issues: SemanticQuestionIssue[];
};

export interface SemanticQuestionUnderstanding {
  mode: QuestionUnderstandingMode;
  interpretation?: SemanticQuestionInterpretation;
  failure?: 'NO_PROVIDER' | 'INVALID_RESPONSE' | 'LOW_CONFIDENCE' | 'TIMEOUT' | 'PROVIDER_ERROR' | 'RATE_LIMITED' | 'QUERY_TOO_LONG';
  failureReason?: 'RESPONSE_TOO_LARGE' | 'MALFORMED_JSON' | 'CONTRADICTORY_FIELDS' | 'SCHEMA_MISMATCH';
  /** Safe HTTP status extracted from the transport's sanitized error message. */
  providerStatus?: number;
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
const EVIDENCE_REQUIREMENTS = new Set<SemanticEvidenceRequirement>([
  'AUTHORITATIVE_SOURCE', 'CASE_FACTS', 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', 'UNRESOLVED'
]);
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

function domainAuthorityIsPossible(value: Pick<SemanticQuestionInterpretation, 'domain' | 'authorityCandidates'>): boolean {
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

function hasSemanticContractContradiction(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const isVersion2 = value.schemaVersion === SEMANTIC_QUESTION_SCHEMA_VERSION;
  const calculated = isVersion2
    ? value.requestedOperation === 'CALCULATE'
    : value.calculationRequested;
  if (!isVersion2 && typeof value.requestedOperation === 'string' && OPERATIONS.has(value.requestedOperation as SemanticQuestionOperation) &&
      typeof value.calculationRequested === 'boolean' &&
      value.calculationRequested !== (value.requestedOperation === 'CALCULATE')) return true;
  if (calculated === true && value.requiresUserSpecificFacts === false) return true;
  if (value.requestedOperation === 'PREPARE_JOURNAL' && typeof value.domain === 'string' &&
      DOMAINS.has(value.domain as SemanticQuestionDomain) && value.domain !== 'ACCOUNTING') return true;
  if (Array.isArray(value.authorityCandidates) && typeof value.domain === 'string' && DOMAINS.has(value.domain as SemanticQuestionDomain) &&
      value.authorityCandidates.every(authority => typeof authority === 'string' && AUTHORITIES.has(authority as SemanticAuthority)) &&
      !domainAuthorityIsPossible({
        domain: value.domain as SemanticQuestionDomain,
        authorityCandidates: value.authorityCandidates as SemanticAuthority[]
      })) return true;
  if (Array.isArray(value.authorityCandidates) &&
      value.authorityCandidates.every(authority => typeof authority === 'string' && AUTHORITIES.has(authority as SemanticAuthority)) &&
      value.authorityCandidates.includes('UNKNOWN') && value.authorityCandidates.length > 1) return true;
  if (Array.isArray(value.issues)) {
    for (const issue of value.issues) {
      if (!isRecord(issue) || typeof issue.domain !== 'string' || !DOMAINS.has(issue.domain as SemanticQuestionDomain) ||
          !Array.isArray(issue.governingAuthorities) || issue.governingAuthorities.length !== 1 ||
          !issue.governingAuthorities.every(authority => typeof authority === 'string' && AUTHORITIES.has(authority as SemanticAuthority))) continue;
      if (!issueDomainAuthoritiesArePossible(issue.domain as SemanticQuestionDomain, issue.governingAuthorities as SemanticAuthority[])) return true;
    }
  }
  return false;
}

const LEGACY_INTERPRETATION_KEYS = [
  'jurisdiction', 'authorityCandidates', 'contextualAuthorities', 'domain', 'population', 'primarySubject', 'concepts',
  'requestedOperation', 'requiresUserSpecificFacts', 'calculationRequested', 'factsExplicitlyProvided', 'confidence'
] as const;

const V2_INTERPRETATION_KEYS = [
  'schemaVersion', 'jurisdiction', 'authorityCandidates', 'contextualAuthorities', 'domain', 'population', 'primarySubject',
  'concepts', 'requestedOperation', 'requiresUserSpecificFacts', 'factsExplicitlyProvided', 'confidence', 'issues'
] as const;

function topicDomainsForIssue(domain: SemanticQuestionDomain, population: SemanticPopulation): SingaporeKnowledgeDomain[] {
  switch (domain) {
    case 'ACCOUNTING': return ['ACCOUNTING_SFRS', 'ACCOUNTING_FRS', 'ACCOUNTING_SMALL_ENTITIES'];
    case 'IRAS_INCOME_TAX': {
      const primary = toRegistryDomain(domain, population);
      // Employee-benefit reporting topics sit in the employer tax domain, while
      // an employee's personal relief belongs to individual income tax.
      return primary ? [primary, ...(population === 'EMPLOYEE' ? ['IRAS_EMPLOYER_TAX' as const] : [])] : [];
    }
    case 'IRAS_GST': return ['IRAS_GST'];
    case 'IRAS_PROPERTY_TAX': return ['IRAS_PROPERTY_TAX'];
    case 'IRAS_STAMP_DUTY': return ['IRAS_STAMP_DUTY'];
    case 'IRAS_OTHER': return ['IRAS_CRS_FATCA'];
    case 'CPF_PAYROLL':
      // CPF payroll applies to employee/employer relationships; unrelated
      // subject populations must not inherit CPF topic mappings.
      return population === 'SHAREHOLDER' || population === 'FUND' || population === 'PROPERTY_OWNER'
        ? [] : ['CPF_CONTRIBUTIONS', 'CPF_PAYROLL_LEVIES'];
    case 'MOM_EMPLOYMENT': return ['MOM_EMPLOYMENT', 'MOM_WORK_PASSES', 'MOM_FOREIGN_WORKFORCE'];
    case 'ACRA_CORPORATE': return ['ACRA_COMPANIES', 'ACRA_VCC', 'ACRA_CSP'];
    case 'MAS_FUNDS': return ['MAS_FUND_MANAGEMENT', 'MAS_FAMILY_OFFICE', 'MAS_REGULATORY_REPORTING', 'MAS_AML'];
    case 'UNKNOWN': return [];
  }
}

function semanticAuthorityCoversTopic(authorities: SemanticAuthority[], topicAuthorities: readonly string[], domain: SemanticQuestionDomain): boolean {
  const accepted = new Set<string>(authorities);
  if (domain === 'ACCOUNTING' && (accepted.has('ACCOUNTING_STANDARDS') || accepted.has('IFRS_FOUNDATION'))) accepted.add('ACRA');
  return topicAuthorities.some(authority => accepted.has(authority));
}

export function canonicalAccountingWorkstreamAuthority(
  domain: SemanticQuestionDomain,
  authority: SemanticAuthority
): SemanticAuthority {
  return domain === 'ACCOUNTING' && authority === 'IFRS_FOUNDATION' ? 'ACCOUNTING_STANDARDS' : authority;
}

function resolveIssueTopicIds(
  subject: string,
  domain: SemanticQuestionDomain,
  population: SemanticPopulation,
  governingAuthorities: SemanticAuthority[],
  independentlyRecognizedTopicIds: ReadonlySet<string>
): string[] {
  const allowedDomains = topicDomainsForIssue(domain, population);
  const subjectTopicIds = defaultQueryTopicResolver.decomposeQuery(subject).topics.map(topic => topic.id);
  return getCoverageTopicsByIds(subjectTopicIds).filter(topic =>
    independentlyRecognizedTopicIds.has(topic.id) && allowedDomains.includes(topic.domainId) &&
    semanticAuthorityCoversTopic(governingAuthorities, topic.authorities, domain))
    .map(topic => topic.id).sort();
}

function deriveEvidenceRequirement(
  domain: SemanticQuestionDomain,
  operation: SemanticQuestionOperation,
  caseSpecific?: boolean
): SemanticEvidenceRequirement {
  if (domain === 'UNKNOWN') return 'UNRESOLVED';
  if (operation === 'EXPLAIN_INTERACTION') {
    if (caseSpecific === undefined) return 'UNRESOLVED';
    return caseSpecific ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' : 'AUTHORITATIVE_SOURCE';
  }
  if (operation === 'EXPLAIN_RULE' || operation === 'COMPARE' || operation === 'OTHER') return 'AUTHORITATIVE_SOURCE';
  return 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS';
}

function validateSemanticQuestionIssue(value: unknown): SemanticQuestionIssue | undefined {
  const issueKeys = [
    'subject', 'population', 'domain', 'governingAuthorities', 'contextualAuthorities', 'operation',
    'mappedTopicIds', 'evidenceRequirement', 'confidence'
  ];
  if (!isRecord(value) || !hasExactKeys(value, issueKeys) || typeof value.subject !== 'string' || !isSafeSemanticLabel(value.subject) ||
      typeof value.population !== 'string' || !POPULATIONS.has(value.population as SemanticPopulation) ||
      typeof value.domain !== 'string' || !DOMAINS.has(value.domain as SemanticQuestionDomain) ||
      !validAuthorities(value.governingAuthorities) || !validAuthorities(value.contextualAuthorities) ||
      !OPERATIONS.has(value.operation as SemanticQuestionOperation) ||
      !Array.isArray(value.mappedTopicIds) || value.mappedTopicIds.length > 20 ||
      !value.mappedTopicIds.every(id => typeof id === 'string' && id.trim().length > 0) ||
      typeof value.evidenceRequirement !== 'string' || !EVIDENCE_REQUIREMENTS.has(value.evidenceRequirement as SemanticEvidenceRequirement) ||
      typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 ||
      value.confidence < SEMANTIC_QUESTION_MIN_CONFIDENCE) return undefined;

  const domain = value.domain as SemanticQuestionDomain;
  const population = value.population as SemanticPopulation;
  const governingAuthorities = value.governingAuthorities as SemanticAuthority[];
  const contextualAuthorities = value.contextualAuthorities as SemanticAuthority[];
  const topicHints = value.mappedTopicIds as string[];
  if (governingAuthorities.length !== 1 ||
      contextualAuthorities.some(authority => governingAuthorities.includes(authority))) return undefined;
  if (domain === 'UNKNOWN') {
    if (governingAuthorities[0] !== 'UNKNOWN') return undefined;
  } else if (!issueDomainAuthoritiesArePossible(domain, governingAuthorities)) return undefined;
  const allowedDomains = topicDomainsForIssue(domain, population);
  const mappedTopicIds = getCoverageTopicsByIds(topicHints).filter(topic =>
    allowedDomains.includes(topic.domainId) && semanticAuthorityCoversTopic(governingAuthorities, topic.authorities, domain))
    .map(topic => topic.id).sort();
  const operation = value.operation as SemanticQuestionOperation;
  return {
    subject: value.subject.trim(), population, domain, governingAuthorities, contextualAuthorities,
    operation, mappedTopicIds: [...new Set(mappedTopicIds)],
    evidenceRequirement: deriveEvidenceRequirement(domain, operation), confidence: value.confidence
  };
}

function issueDomainAuthoritiesArePossible(domain: SemanticQuestionDomain, authorities: SemanticAuthority[]): boolean {
  const authority = authorities[0];
  switch (domain) {
    case 'ACCOUNTING': return authority === 'ACCOUNTING_STANDARDS' || authority === 'IFRS_FOUNDATION' || authority === 'ACRA' || authority === 'SSO';
    case 'IRAS_INCOME_TAX':
    case 'IRAS_GST':
    case 'IRAS_PROPERTY_TAX':
    case 'IRAS_STAMP_DUTY':
    case 'IRAS_OTHER': return authority === 'IRAS';
    case 'CPF_PAYROLL': return authority === 'CPF';
    case 'MOM_EMPLOYMENT': return authority === 'MOM';
    case 'ACRA_CORPORATE': return authority === 'ACRA';
    case 'MAS_FUNDS': return authority === 'MAS';
    case 'UNKNOWN': return authority === 'UNKNOWN';
  }
}

/** Strictly validates provider output; unknown keys and contradictory flags are rejected. */
export function validateSemanticQuestionInterpretation(value: unknown): SemanticQuestionInterpretation | undefined {
  if (!isRecord(value)) return undefined;
  const isVersion2 = Object.hasOwn(value, 'schemaVersion');
  const exactSchema = isVersion2
    ? value.schemaVersion === SEMANTIC_QUESTION_SCHEMA_VERSION && hasExactKeys(value, V2_INTERPRETATION_KEYS)
    : hasExactKeys(value, LEGACY_INTERPRETATION_KEYS) || hasExactKeys(value, [...LEGACY_INTERPRETATION_KEYS, 'issues']);
  if (!exactSchema || (isVersion2 && (!Array.isArray(value.issues) || value.issues.length === 0)) ||
      Object.hasOwn(value, 'issues') && (!Array.isArray(value.issues) || value.issues.length > 12)) return undefined;
  if (!validLabelList(value.jurisdiction, 6) || !validAuthorities(value.authorityCandidates) ||
      !validAuthorities(value.contextualAuthorities) || typeof value.domain !== 'string' || !DOMAINS.has(value.domain as SemanticQuestionDomain) ||
      typeof value.population !== 'string' || !POPULATIONS.has(value.population as SemanticPopulation) ||
      typeof value.primarySubject !== 'string' || !isSafeSemanticLabel(value.primarySubject) ||
      !Array.isArray(value.concepts) || value.concepts.length > 12 ||
      !OPERATIONS.has(value.requestedOperation as SemanticQuestionOperation) ||
      typeof value.requiresUserSpecificFacts !== 'boolean' || !isVersion2 && typeof value.calculationRequested !== 'boolean' ||
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
    calculationRequested: isVersion2
      ? value.requestedOperation === 'CALCULATE'
      : value.calculationRequested as boolean,
    factsExplicitlyProvided: value.factsExplicitlyProvided.map(item => item.trim()),
    confidence: value.confidence,
    ...(Object.hasOwn(value, 'issues') ? { issues: (value.issues as unknown[]).map(validateSemanticQuestionIssue) as SemanticQuestionIssue[] } : {})
  };
  if (Object.hasOwn(value, 'issues') && interpretation.issues?.some(issue => !issue)) return undefined;
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

const RESPONSE_SCHEMA = `Return a V2 JSON object with exactly these top-level keys: schemaVersion, jurisdiction, authorityCandidates, contextualAuthorities, domain, population, primarySubject, concepts, requestedOperation, requiresUserSpecificFacts, factsExplicitlyProvided, confidence, issues. Set schemaVersion=2. The application derives the calculation flag from requestedOperation; it is not included in this wire response. Include 1–12 issues, one for every requested material outcome, including exactly one for a simple single-outcome question. Do not provide issue IDs; they are assigned deterministically. Each issue has exactly: subject, population, domain, governingAuthorities, contextualAuthorities, operation, mappedTopicIds, evidenceRequirement, confidence. Each concept has exactly {"concept":"...","role":"PRIMARY|RELATED|CONTEXT_ONLY"}; labels must be safe and nonempty, for example {"concept":"expense recognition","role":"PRIMARY"}. Confidence is a number from 0 through 1.

mappedTopicIds are optional candidate hints; the application derives candidates from the issue subject and maps them only when independently recognized in the original question and consistent with domain, population, and authority. Leave them empty when unsure; keep every issue even without a matching topic. evidenceRequirement is AUTHORITATIVE_SOURCE|CASE_FACTS|AUTHORITATIVE_SOURCE_AND_CASE_FACTS|UNRESOLVED; the application derives it from domain and operation. For EXPLAIN_INTERACTION, use case facts only for case-specific issues; otherwise use UNRESOLVED when unsure. Issues describe questions to resolve, never conclusions.

For compound questions, decompose every distinct material outcome the user asks about into its own issue. An issue represents a requested answer or decision, not every noun, fact, or authority mentioned. Do not omit an issue because another authority or topic is more prominent. When the question asks separately about obligations or treatment for different parties, represent those as separate issues when their outcomes can differ; do not merge them just because they share a governing authority or domain. Multiple issues may have the same governing authority but different domains, populations, or operations. Assign exactly one governing authority to each issue and ensure it matches the issue domain. Put an authority in contextualAuthorities only when it is relevant context for that issue but does not govern it; merely mentioning an authority must not create an issue or workstream. Use UNKNOWN rather than inventing unsupported certainty. If a compound question has no single accurate top-level domain or population, set the top-level domain and population to UNKNOWN and put the precise values on issues[]. Use authorityCandidates=[UNKNOWN] when no single top-level authority set applies; never mix UNKNOWN with other top-level authority values.

Separate requested outcomes from background facts and context. Mentioning that an expense was recorded under IFRS/SFRS(I), or that an accounting standard was applied, is context when the user asks only about tax deductibility; create an accounting issue only when the user asks how to recognize, present, measure, disclose, or journalize it. Distinguish a company acting as employer from the company as corporate taxpayer: employer reporting obligations are not the same outcome as company tax deductibility. A company/COMPANY population applies only when the company's own tax position is requested.

Classify each issue by the subject of the requested outcome. An employee's personal relief claim or salary/employment-income tax is individual income tax (IRAS); an employee benefit/perquisite tax question is employment-benefit tax (IRAS). EMPLOYEE alone does not imply a taxable benefit. Employer reporting is a separate issue only when the employer's reporting duty is requested; if the reporter is not established, use population=UNKNOWN rather than assuming the employee or company is the reporter. A company acting as employer for employment reporting has population=EMPLOYER; COMPANY is reserved for the company's own tax position. An employee's own CPF contribution amount and an employer's CPF contribution amount are separate payroll issues when both are requested.

Choose each issue's operation by the requested output. Use CALCULATE when the requested output is a numeric amount to pay, contribute, remit, deduct, withhold, charge, or provide—even if inputs are missing and no "amount", "how much", or "calculate" term appears. A number merely included as a case fact or illustration is not a calculation. Use DETERMINE_TREATMENT to apply a rule to a stated transaction, receipt, expense, benefit, or person's circumstances; this includes liability applicability or type even when phrased "explain" or "what tax applies". Use population=UNKNOWN if the affected party is unclear. Use CHECK_ELIGIBILITY for qualification or entitlement under a rule, scheme, or requirement, even if claimant status is unclear; for relief, "what can I claim?" or "can I claim?" asks entitlement, while "how much can I claim?" asks an amount (CALCULATE). Use UNKNOWN when needed. A requested taxability or deductible-status outcome for a transaction is DETERMINE_TREATMENT. Use EXPLAIN_RULE for general principles or conditions without applying them to a case. Use EXPLAIN_INTERACTION only for a requested relationship between rules; multiple issues alone are not interaction. Use FILING_REQUIREMENT for filing, reporting, or notification procedures; a requested withholding amount is CALCULATE, while a separately requested procedure is FILING_REQUIREMENT. Use PREPARE_JOURNAL for requested entries, COMPARE for requested alternatives, and otherwise OTHER. requiresUserSpecificFacts is true when a result depends on a particular case, even if its facts are supplied, and false for conceptual guidance.

Set top-level requestedOperation only when one operation describes the whole question; use OTHER for mixed operations. For mixed journal and non-accounting outcomes, use top-level domain/population UNKNOWN and operation OTHER, retaining PREPARE_JOURNAL on its issue. Record only user-supplied case facts in factsExplicitlyProvided.

Enums: domain=ACCOUNTING|IRAS_INCOME_TAX|IRAS_GST|IRAS_PROPERTY_TAX|IRAS_STAMP_DUTY|IRAS_OTHER|CPF_PAYROLL|MOM_EMPLOYMENT|ACRA_CORPORATE|MAS_FUNDS|UNKNOWN; population=INDIVIDUAL|EMPLOYEE|EMPLOYER|COMPANY|SHAREHOLDER|FUND|PROPERTY_OWNER|UNKNOWN; authority values=IRAS|CPF|ACRA|MOM|MAS|ACCOUNTING_STANDARDS|IFRS_FOUNDATION|SSO|UNKNOWN; operation=EXPLAIN_RULE|EXPLAIN_INTERACTION|DETERMINE_TREATMENT|CHECK_ELIGIBILITY|CALCULATE|PREPARE_JOURNAL|COMPARE|FILING_REQUIREMENT|OTHER; concept role=PRIMARY|RELATED|CONTEXT_ONLY. CALCULATE requires requiresUserSpecificFacts=true. PREPARE_JOURNAL requires ACCOUNTING.

Conceptual rules may mention parties, claims, conditions, or illustrative amounts without deciding an identified case. The case-specific flag does not mean facts are missing; omit hypothetical examples and general conditions from factsExplicitlyProvided.

Identify the taxpayer or regulated party whose own status is at issue. A bare first-person plural or a statement that overseas money was received does not establish whether the party is an individual, employer, company, or fund; use UNKNOWN. Use EMPLOYEE only for the employee's own position, EMPLOYER only for the employer's obligations, and COMPANY only when the company itself is the taxpayer or claimant. A shareholder is not automatically the company.

Full V2 mixed journal-and-tax example: {"schemaVersion":2,"jurisdiction":["Singapore"],"authorityCandidates":["UNKNOWN"],"contextualAuthorities":[],"domain":"UNKNOWN","population":"UNKNOWN","primarySubject":"expense journal and tax deductibility","concepts":[{"concept":"expense accounting","role":"RELATED"},{"concept":"income-tax deductibility","role":"PRIMARY"}],"requestedOperation":"OTHER","requiresUserSpecificFacts":true,"factsExplicitlyProvided":[],"confidence":0.9,"issues":[{"subject":"expense journal","population":"COMPANY","domain":"ACCOUNTING","governingAuthorities":["ACCOUNTING_STANDARDS"],"contextualAuthorities":[],"operation":"PREPARE_JOURNAL","mappedTopicIds":[],"evidenceRequirement":"AUTHORITATIVE_SOURCE_AND_CASE_FACTS","confidence":0.9},{"subject":"company expense deduction eligibility","population":"COMPANY","domain":"IRAS_INCOME_TAX","governingAuthorities":["IRAS"],"contextualAuthorities":["ACCOUNTING_STANDARDS"],"operation":"CHECK_ELIGIBILITY","mappedTopicIds":[],"evidenceRequirement":"AUTHORITATIVE_SOURCE_AND_CASE_FACTS","confidence":0.9}]}`;

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
    if (response.length > 16_000) return { mode: 'DETERMINISTIC_FALLBACK', failure: 'INVALID_RESPONSE', failureReason: 'RESPONSE_TOO_LARGE' };
    let raw: unknown;
    try { raw = JSON.parse(response); } catch {
      return { mode: 'DETERMINISTIC_FALLBACK', failure: 'INVALID_RESPONSE', failureReason: 'MALFORMED_JSON' };
    }
    const interpretation = validateSemanticQuestionInterpretation(raw);
    if (!interpretation) return {
      mode: 'DETERMINISTIC_FALLBACK',
      failure: 'INVALID_RESPONSE',
      failureReason: hasSemanticContractContradiction(raw) ? 'CONTRADICTORY_FIELDS' : 'SCHEMA_MISMATCH'
    };
    if (interpretation.confidence < SEMANTIC_QUESTION_MIN_CONFIDENCE) return { mode: 'DETERMINISTIC_FALLBACK', failure: 'LOW_CONFIDENCE' };
    return { mode: 'SEMANTIC_INTERPRETATION', interpretation };
  } catch (error) {
    // aiTransport deliberately withholds provider bodies and includes only the HTTP status.
    // Preserve 429 as a transport outcome so callers can retry without scoring it as model quality.
    const providerStatusMatch = error instanceof Error
      ? error.message.match(/^Gemini API request failed with HTTP (\d{3})\./)
      : null;
    const providerStatus = providerStatusMatch ? Number(providerStatusMatch[1]) : undefined;
    return {
      mode: 'DETERMINISTIC_FALLBACK',
      failure: providerStatus === 429
        ? 'RATE_LIMITED'
        : error instanceof Error && /abort|timed\s*out|timeout/i.test(error.message) ? 'TIMEOUT' : 'PROVIDER_ERROR',
      ...(providerStatus ? { providerStatus } : {})
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
  /** Separate workstream plan for future orchestration; it does not replace classification. */
  issuePlan: SemanticIssueReconciliation;
}

export interface ReconciledSemanticQuestionIssue extends SemanticQuestionIssue {
  id: string;
  /** MAPPED means taxonomy mapping succeeded; it does not mean the issue is answered. */
  status: 'MAPPED' | 'UNRESOLVED';
  unresolvedReason?: 'NO_COVERAGE_TOPIC' | 'UNASSIGNED_QUERY_TOPIC' | 'UNKNOWN_DOMAIN';
}

export interface SemanticIssueReconciliation {
  source: 'SEMANTIC_ISSUES' | 'TAXONOMY_FALLBACK';
  issues: ReconciledSemanticQuestionIssue[];
  /** True only when a semantic plan covers every independently recognized topic and has no residual query text. */
  coverageEstablished: boolean;
  /** Fail-closed signal for unsupported query text, unresolved issues, or absent recognized topic coverage. */
  hasUnmappedResidual: boolean;
}

/** Deterministically guards and projects the semantic interpretation into existing IRAS routing fields. */
function reconcileLegacyQuestionUnderstanding(
  query: string,
  classification: QuestionClassificationResult,
  understanding: SemanticQuestionUnderstanding
): Omit<ReconciledQuestionUnderstanding, 'issuePlan'> {
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
  const retainsAccountingScope = semantic.issues !== undefined
    ? semantic.issues.some(issue => issue.domain === 'ACCOUNTING' || issue.operation === 'PREPARE_JOURNAL')
    : classification.accountingAnalysisRequired &&
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

function stableIssueId(issue: Pick<SemanticQuestionIssue, 'subject' | 'population' | 'domain' | 'governingAuthorities' | 'operation' | 'mappedTopicIds'>): string {
  const canonical = [
    issue.domain, issue.population, issue.subject.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' '),
    [...issue.governingAuthorities].sort().join(','), issue.operation, [...issue.mappedTopicIds].sort().join(',')
  ].join('|');
  let hash = 0x811c9dc5;
  for (const character of canonical) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return 'issue_' + (hash >>> 0).toString(16).padStart(8, '0');
}

function issueFromTaxonomyGroup(topics: ReturnType<typeof defaultQueryTopicResolver.decomposeQuery>['topics']): SemanticQuestionIssue {
  const first = topics[0];
  const registryDomain = first.domainId;
  let domain: SemanticQuestionDomain;
  let population: SemanticPopulation = 'UNKNOWN';
  if (registryDomain.startsWith('ACCOUNTING_')) domain = 'ACCOUNTING';
  else if (registryDomain.startsWith('IRAS_')) {
    if (registryDomain === 'IRAS_GST') domain = 'IRAS_GST';
    else if (registryDomain === 'IRAS_PROPERTY_TAX') domain = 'IRAS_PROPERTY_TAX';
    else if (registryDomain === 'IRAS_STAMP_DUTY') domain = 'IRAS_STAMP_DUTY';
    else if (registryDomain === 'IRAS_CRS_FATCA') domain = 'IRAS_OTHER';
    else {
      domain = 'IRAS_INCOME_TAX';
      if (registryDomain === 'IRAS_INDIVIDUAL_TAX') population = 'INDIVIDUAL';
      else if (registryDomain === 'IRAS_CORPORATE_TAX') population = 'COMPANY';
    }
  } else if (registryDomain.startsWith('CPF_')) domain = 'CPF_PAYROLL';
  else if (registryDomain.startsWith('MOM_')) domain = 'MOM_EMPLOYMENT';
  else if (registryDomain.startsWith('ACRA_')) domain = 'ACRA_CORPORATE';
  else if (registryDomain.startsWith('MAS_')) domain = 'MAS_FUNDS';
  else domain = 'UNKNOWN';

  const governingAuthorities: SemanticAuthority[] = domain === 'ACCOUNTING'
    ? ['ACCOUNTING_STANDARDS']
    : first.authorities.filter((authority): authority is SemanticAuthority => AUTHORITIES.has(authority as SemanticAuthority));
  return {
    subject: topics.map(topic => topic.name).join('; '),
    population,
    domain,
    governingAuthorities,
    contextualAuthorities: [],
    operation: 'OTHER',
    mappedTopicIds: topics.map(topic => topic.id),
    evidenceRequirement: deriveEvidenceRequirement(domain, 'OTHER'),
    confidence: 1
  };
}

function independentlyRecognizedTopics(query: string, classification: QuestionClassificationResult) {
  const decomposition = defaultQueryTopicResolver.decomposeQuery(query);
  const candidateIds = [...new Set([...decomposition.topics.map(topic => topic.id), ...classification.topicIds])];
  const topics = defaultQueryTopicResolver.resolveTopicIds(candidateIds).filter(topic =>
    topic.domainId.startsWith('ACCOUNTING_') || topic.domainId.startsWith('IRAS_') ||
    topic.domainId.startsWith('CPF_') || topic.domainId.startsWith('MOM_') ||
    topic.domainId.startsWith('ACRA_') || topic.domainId.startsWith('MAS_'));
  return { topics, hasUnparsedText: (decomposition.unresolvedTopics?.length || 0) > 0 };
}

function reconcileSemanticIssuePlan(
  query: string,
  classification: QuestionClassificationResult,
  understanding: SemanticQuestionUnderstanding
): SemanticIssueReconciliation {
  const wrapperIsValidated = (understanding.mode === 'SEMANTIC_INTERPRETATION' || understanding.mode === 'SEMANTIC_PLUS_RULES') &&
    understanding.failure === undefined;
  const semantic = wrapperIsValidated ? validateSemanticQuestionInterpretation(understanding.interpretation) : undefined;
  const inventory = independentlyRecognizedTopics(query, classification);
  const inventoryIds = new Set(inventory.topics.map(topic => topic.id));
  const usesSemanticIssues = semantic?.issues !== undefined;
  const seenIds = new Map<string, number>();
  const addId = (issue: SemanticQuestionIssue): string => {
    const baseId = stableIssueId(issue);
    const occurrence = (seenIds.get(baseId) || 0) + 1;
    seenIds.set(baseId, occurrence);
    return occurrence === 1 ? baseId : baseId + '_' + occurrence;
  };

  if (usesSemanticIssues) {
    const issues: ReconciledSemanticQuestionIssue[] = (semantic.issues || []).map(issue => {
      const routedIssue = {
        ...issue,
        governingAuthorities: issue.governingAuthorities.map(authority =>
          canonicalAccountingWorkstreamAuthority(issue.domain, authority))
      };
      const mappedTopicIds = resolveIssueTopicIds(routedIssue.subject, routedIssue.domain, routedIssue.population, routedIssue.governingAuthorities, inventoryIds);
      const reconciledIssue = {
        ...routedIssue,
        mappedTopicIds,
        evidenceRequirement: deriveEvidenceRequirement(routedIssue.domain, routedIssue.operation, semantic.requiresUserSpecificFacts)
      };
      const unresolvedReason: ReconciledSemanticQuestionIssue['unresolvedReason'] = mappedTopicIds.length > 0
        ? undefined
        : routedIssue.domain === 'UNKNOWN' ? 'UNKNOWN_DOMAIN' : 'NO_COVERAGE_TOPIC';
      return {
        ...reconciledIssue,
        id: addId(reconciledIssue),
        status: unresolvedReason ? 'UNRESOLVED' : 'MAPPED',
        ...(unresolvedReason ? { unresolvedReason } : {})
      };
    });
    const mappedInventory = new Set(issues.flatMap(issue => issue.mappedTopicIds));
    for (const topic of inventory.topics) {
      if (mappedInventory.has(topic.id)) continue;
      const residual = issueFromTaxonomyGroup([topic]);
      issues.push({
        ...residual,
        id: addId(residual),
        status: 'UNRESOLVED',
        unresolvedReason: 'UNASSIGNED_QUERY_TOPIC'
      });
    }
    const hasUnmappedResidual = inventory.hasUnparsedText || inventory.topics.length === 0 ||
      issues.some(issue => issue.status === 'UNRESOLVED');
    return {
      source: 'SEMANTIC_ISSUES',
      issues,
      coverageEstablished: inventory.topics.length > 0 && !hasUnmappedResidual,
      hasUnmappedResidual
    };
  }

  const groups = new Map<SingaporeKnowledgeDomain, typeof inventory.topics>();
  for (const topic of inventory.topics) groups.set(topic.domainId, [...(groups.get(topic.domainId) || []), topic]);
  const issues = [...groups.values()].map(issueFromTaxonomyGroup).map(issue => {
    return {
      ...issue,
      id: addId(issue),
      status: 'MAPPED' as const
    };
  });
  return { source: 'TAXONOMY_FALLBACK', issues, coverageEstablished: false, hasUnmappedResidual: true };
}

/** Keeps issue reconciliation separate from the legacy flat classification projection. */
export function reconcileQuestionUnderstanding(
  query: string,
  classification: QuestionClassificationResult,
  understanding: SemanticQuestionUnderstanding
): ReconciledQuestionUnderstanding {
  const reconciled = reconcileLegacyQuestionUnderstanding(query, classification, understanding);
  return { ...reconciled, issuePlan: reconcileSemanticIssuePlan(query, classification, understanding) };
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
