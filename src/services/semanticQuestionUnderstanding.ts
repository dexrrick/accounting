import { isExplicitForeignTaxOnlyQuestion, type QuestionClassificationResult } from '../classification/questionClassifier';
import type { SingaporeKnowledgeDomain } from '../standards/coverageRegistry';
import { getCoverageTopicsByIds } from '../standards/coverageRegistry';
import { defaultQueryTopicResolver, isBoundedAcraAnnualReturnMissingFactsQuestion } from '../retrieval/queryTopicResolver';
import { isAcraAnnualReturnDeadlineQuestion } from '../retrieval/acraAnnualReturnFilingRule';
import { identifyAcraAnnualReturnCompanyFacts, isAcraAnnualReturnApplicationQuestion } from '../engine/acraAnnualReturnApplication';
import type { ProviderSettings } from '../types/provider';
import { executeStructuredLlmCall, type TransportAttemptDiagnostic } from './aiTransport';
import {
  ensureRequestCompletenessContext,
  type RequestCompletenessContext
} from './requestCompleteness';
import {
  getRoutingChildTopicIdsMentionedInSubject,
  getRoutingParentIdsForChild,
  proveRequestedTopicOwnership
} from './requestedTopicOwnership';
import { removeNegatedJournalDirectives, removeNegatedOutputDirectives } from '../utils/journalRequestIntent';

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

/** Shared V2 wire-contract metadata used by validation, prompting, diagnostics, and Gemini structured output. */
export const SEMANTIC_POPULATION_VALUES = [
  'INDIVIDUAL', 'EMPLOYEE', 'EMPLOYER', 'COMPANY', 'SHAREHOLDER', 'FUND', 'PROPERTY_OWNER', 'UNKNOWN'
] as const satisfies readonly SemanticPopulation[];
export const SEMANTIC_DOMAIN_VALUES = [
  'ACCOUNTING', 'IRAS_INCOME_TAX', 'IRAS_GST', 'IRAS_PROPERTY_TAX', 'IRAS_STAMP_DUTY', 'IRAS_OTHER',
  'CPF_PAYROLL', 'MOM_EMPLOYMENT', 'ACRA_CORPORATE', 'MAS_FUNDS', 'UNKNOWN'
] as const satisfies readonly SemanticQuestionDomain[];
export const SEMANTIC_OPERATION_VALUES = [
  'EXPLAIN_RULE', 'EXPLAIN_INTERACTION', 'DETERMINE_TREATMENT', 'CHECK_ELIGIBILITY', 'CALCULATE',
  'PREPARE_JOURNAL', 'COMPARE', 'FILING_REQUIREMENT', 'OTHER'
] as const satisfies readonly SemanticQuestionOperation[];
export const SEMANTIC_AUTHORITY_VALUES = [
  'IRAS', 'CPF', 'ACRA', 'MOM', 'MAS', 'ACCOUNTING_STANDARDS', 'IFRS_FOUNDATION', 'SSO', 'UNKNOWN'
] as const satisfies readonly SemanticAuthority[];
export const SEMANTIC_CONCEPT_ROLE_VALUES = ['PRIMARY', 'RELATED', 'CONTEXT_ONLY'] as const satisfies readonly SemanticConceptRole[];
export const SEMANTIC_EVIDENCE_REQUIREMENT_VALUES = [
  'AUTHORITATIVE_SOURCE', 'CASE_FACTS', 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', 'UNRESOLVED'
] as const satisfies readonly SemanticEvidenceRequirement[];

export const SEMANTIC_V2_INTERPRETATION_KEYS = [
  'schemaVersion', 'jurisdiction', 'authorityCandidates', 'contextualAuthorities', 'domain', 'population', 'primarySubject',
  'concepts', 'requestedOperation', 'factsExplicitlyProvided', 'confidence', 'issues'
] as const;
/** Accepted only for compatibility with V2 responses produced before specificity became application-derived. */
export const SEMANTIC_V2_COMPATIBILITY_KEYS = [
  'schemaVersion', 'jurisdiction', 'authorityCandidates', 'contextualAuthorities', 'domain', 'population', 'primarySubject',
  'concepts', 'requestedOperation', 'requiresUserSpecificFacts', 'factsExplicitlyProvided', 'confidence', 'issues'
] as const;
export const SEMANTIC_CONCEPT_KEYS = ['concept', 'role'] as const;
export const SEMANTIC_ISSUE_KEYS = [
  'subject', 'population', 'domain', 'governingAuthorities', 'contextualAuthorities', 'operation',
  'mappedTopicIds', 'evidenceRequirement', 'confidence'
] as const;
export const SEMANTIC_V2_WIRE_LIMITS = Object.freeze({
  jurisdictionItems: 6,
  authorityItems: 5,
  issueGoverningAuthorityItems: 1,
  conceptItems: 12,
  factItems: 12,
  issueItemsMinimum: 1,
  issueItemsMaximum: 12,
  mappedTopicIdItems: 20,
  confidenceMinimum: 0,
  confidenceMaximum: 1
});

const stringArraySchema = (maxItems: number) => ({
  type: 'array',
  items: { type: 'string' },
  maxItems
});
const enumSchema = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
const confidenceSchema = {
  type: 'number', minimum: SEMANTIC_V2_WIRE_LIMITS.confidenceMinimum,
  maximum: SEMANTIC_V2_WIRE_LIMITS.confidenceMaximum
} as const;

/** Gemini's supported JSON Schema subset for the exact V2 provider wire shape. */
export const SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...SEMANTIC_V2_INTERPRETATION_KEYS],
  properties: {
    schemaVersion: { type: 'integer', enum: [SEMANTIC_QUESTION_SCHEMA_VERSION] },
    jurisdiction: stringArraySchema(SEMANTIC_V2_WIRE_LIMITS.jurisdictionItems),
    authorityCandidates: { ...stringArraySchema(SEMANTIC_V2_WIRE_LIMITS.authorityItems), items: enumSchema(SEMANTIC_AUTHORITY_VALUES) },
    contextualAuthorities: { ...stringArraySchema(SEMANTIC_V2_WIRE_LIMITS.authorityItems), items: enumSchema(SEMANTIC_AUTHORITY_VALUES) },
    domain: enumSchema(SEMANTIC_DOMAIN_VALUES),
    population: enumSchema(SEMANTIC_POPULATION_VALUES),
    primarySubject: { type: 'string' },
    concepts: {
      type: 'array',
      maxItems: SEMANTIC_V2_WIRE_LIMITS.conceptItems,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...SEMANTIC_CONCEPT_KEYS],
        properties: {
          concept: { type: 'string' },
          role: enumSchema(SEMANTIC_CONCEPT_ROLE_VALUES)
        }
      }
    },
    requestedOperation: enumSchema(SEMANTIC_OPERATION_VALUES),
    factsExplicitlyProvided: stringArraySchema(SEMANTIC_V2_WIRE_LIMITS.factItems),
    confidence: confidenceSchema,
    issues: {
      type: 'array',
      minItems: SEMANTIC_V2_WIRE_LIMITS.issueItemsMinimum,
      // Gemini rejects this cap in the combined V2 schema; the application validator still enforces it.
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...SEMANTIC_ISSUE_KEYS],
        properties: {
          subject: { type: 'string' },
          population: enumSchema(SEMANTIC_POPULATION_VALUES),
          domain: enumSchema(SEMANTIC_DOMAIN_VALUES),
          governingAuthorities: {
            type: 'array',
            minItems: SEMANTIC_V2_WIRE_LIMITS.issueGoverningAuthorityItems,
            maxItems: SEMANTIC_V2_WIRE_LIMITS.issueGoverningAuthorityItems,
            items: enumSchema(SEMANTIC_AUTHORITY_VALUES)
          },
          contextualAuthorities: { ...stringArraySchema(SEMANTIC_V2_WIRE_LIMITS.authorityItems), items: enumSchema(SEMANTIC_AUTHORITY_VALUES) },
          operation: enumSchema(SEMANTIC_OPERATION_VALUES),
          mappedTopicIds: stringArraySchema(SEMANTIC_V2_WIRE_LIMITS.mappedTopicIdItems),
          evidenceRequirement: enumSchema(SEMANTIC_EVIDENCE_REQUIREMENT_VALUES),
          confidence: confidenceSchema
        }
      }
    }
  }
} as const;

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

/** Versioned provider wire contract. Calculation and case specificity are application-derived. */
export type SemanticQuestionInterpretationV2 = Omit<SemanticQuestionInterpretation, 'calculationRequested' | 'requiresUserSpecificFacts' | 'issues'> & {
  schemaVersion: typeof SEMANTIC_QUESTION_SCHEMA_VERSION;
  issues: SemanticQuestionIssue[];
};

export interface SemanticQuestionUnderstanding {
  mode: QuestionUnderstandingMode;
  /** Whether the model returned a response that could be assessed against the semantic contract. */
  assessmentStatus?: 'PASSED' | 'FAILED' | 'NOT_ASSESSED';
  /** Redacted per-attempt transport outcomes; provider bodies and request content are never included. */
  transportAttempts?: readonly TransportAttemptDiagnostic[];
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
  /** Present only for concepts projected from validated semantic labels. */
  role?: SemanticConceptRole;
  /** Broad semantic context for safely attributing a topicless diagnostic. */
  semanticDomain?: SemanticQuestionDomain;
  semanticPopulation?: SemanticPopulation;
  semanticAuthorities?: SemanticAuthority[];
}

const POPULATIONS = new Set<SemanticPopulation>(SEMANTIC_POPULATION_VALUES);
const DOMAINS = new Set<SemanticQuestionDomain>(SEMANTIC_DOMAIN_VALUES);
const OPERATIONS = new Set<SemanticQuestionOperation>(SEMANTIC_OPERATION_VALUES);
const CASE_FACTS_REQUIRED_OPERATIONS = new Set<SemanticQuestionOperation>([
  'CALCULATE', 'DETERMINE_TREATMENT', 'PREPARE_JOURNAL'
]);
// Internal normalized values carry app-derived specificity for query-less
// projections. Provider objects can never enter this map. Inputs are still
// structurally validated on every call; cached decisions are reused only while
// the requested operations and subjects they were derived from remain stable.
const normalizedSpecificity = new WeakMap<object, {
  requestedOperation: SemanticQuestionOperation;
  primarySubject: string;
  root: boolean;
  issues?: Array<{ operation: SemanticQuestionOperation; subject: string; required: boolean }>;
}>();
const AUTHORITIES = new Set<SemanticAuthority>(SEMANTIC_AUTHORITY_VALUES);
const CONCEPT_ROLES = new Set<SemanticConceptRole>(SEMANTIC_CONCEPT_ROLE_VALUES);
const EVIDENCE_REQUIREMENTS = new Set<SemanticEvidenceRequirement>(SEMANTIC_EVIDENCE_REQUIREMENT_VALUES);
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
  return Array.isArray(value) && value.length <= SEMANTIC_V2_WIRE_LIMITS.authorityItems && value.every(item => typeof item === 'string' && AUTHORITIES.has(item as SemanticAuthority)) &&
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
  if (!isVersion2 && typeof value.requestedOperation === 'string' && OPERATIONS.has(value.requestedOperation as SemanticQuestionOperation) &&
      typeof value.calculationRequested === 'boolean' &&
      value.calculationRequested !== (value.requestedOperation === 'CALCULATE')) return true;
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

const GST_INPUT_TAX_RECOVERY_SUBJECT_WORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'general', 'condition', 'conditions', 'rule', 'rules', 'input', 'tax', 'claim',
  'claims', 'claiming', 'claimed', 'recover', 'recovery', 'recoverable', 'recovering', 'recovered', 'business',
  'businesses', 'purchase', 'purchases', 'purchasing', 'company', 'companies', 'corporate', 'corporation',
  'corporations', 'entity', 'entities', 'singapore', 'gst', 'registered', 'of', 'and', 'or', 'to', 'for', 'on',
  'by', 'from', 'in', 'as', 'under', 'with', 'may', 'be', 'is', 'are', 'subject'
]);
const normalizeGstInputTaxText = (value: string) => value.toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function isGstInputTaxRecoverySubject(subject: string): boolean {
  const normalizedSubject = normalizeGstInputTaxText(subject);
  return /\binput tax\b/.test(normalizedSubject) && /\b(?:claim\w*|recover\w*)\b/.test(normalizedSubject);
}

/** Text anchors shared by the narrow GST query-to-issue binding and its concept ownership checks. */
export function hasBoundedGstInputTaxRecoveryAnchors(query: string, subject: string): boolean {
  const normalizedQuery = normalizeGstInputTaxText(query);
  const normalizedSubject = normalizeGstInputTaxText(subject);
  const subjectWords = normalizedSubject.split(' ').filter(Boolean);
  const prohibited = /\b(?:unregistered|nonregistered|not registered|output|exempt\w*|eligible|qualif\w*|blocked|disallowed|private|personal|dividend|residen(?:ce|cy|t)|filing|reporting|accounting|journal|payroll|registration|register(?:ing)?)\b/;
  const additionalOutcome = /\band\s+(?:also\s+)?(?:explain|determine|assess|calculate|compute|prepare|account for|record|report|file|claim|what|how|whether)\b/;
  const negatedRegistration = /\b(?:not|never|no longer)\b.{0,35}\bgst registered company\b/;
  const conditionalRegistration = /\b(?:if|whether|when|once|unless|until)\b.{0,55}\b(?:is|are|be|becomes?|became|becoming|gets?|got|will be|would be|could be|might be|may be|register(?:s|ed|ing)?)\b.{0,25}\bgst registered company\b/;
  const uncertainRegistration = /\b(?:may|might|could|possibly|perhaps|not sure)\b.{0,40}\bgst registered company\b/;
  const futureRegistration = /\b(?:will|would|plans? to|intends? to|expects? to|aims? to|hopes? to|is planning to|are planning to|has plans to)\b.{0,35}\b(?:be|become|becomes?|becoming|gets?|register(?:s|ed|ing)?)\b.{0,25}\bgst registered company\b/;
  return subjectWords.length > 0 && subjectWords.every(word => GST_INPUT_TAX_RECOVERY_SUBJECT_WORDS.has(word)) &&
    /\bgst registered company\b/.test(normalizedQuery) && /\binput tax\b/.test(normalizedQuery) &&
    /\bbusiness purchases?\b/.test(normalizedQuery) && isGstInputTaxRecoverySubject(normalizedSubject) &&
    !prohibited.test(normalizedQuery) && !prohibited.test(normalizedSubject) &&
    !additionalOutcome.test(normalizedQuery) && !negatedRegistration.test(normalizedQuery) &&
    !conditionalRegistration.test(normalizedQuery) && !uncertainRegistration.test(normalizedQuery) &&
    !futureRegistration.test(normalizedQuery);
}

export function canonicalAccountingWorkstreamAuthority(
  domain: SemanticQuestionDomain,
  authority: SemanticAuthority
): SemanticAuthority {
  return domain === 'ACCOUNTING' && authority === 'IFRS_FOUNDATION' ? 'ACCOUNTING_STANDARDS' : authority;
}

const ACRA_ANNUAL_RETURN_SUBJECT_WORDS = new Set([
  'a', 'the', 'general', 'ordinary', 'annual', 'return', 'filing', 'deadline', 'due', 'date',
  'company', 'companies', 'singapore', 'acra', 'rule', 'rules', 'and', 'requirement', 'requirements',
  'financial', 'year', 'end', 'after', 'months', 'listed', 'non', 'unlisted', 'fye'
]);

function isBoundedAcraAnnualReturnSubject(
  query: string,
  subject: string,
  domain: SemanticQuestionDomain,
  population: SemanticPopulation,
  operation: SemanticQuestionOperation,
  governingAuthorities: SemanticAuthority[],
  independentlyRecognizedTopicIds: ReadonlySet<string>,
  issueCount: number
): boolean {
  const subjectWords = subject.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const boundedOrdinarySubject = subjectWords.length > 0 &&
    subjectWords.every(word => ACRA_ANNUAL_RETURN_SUBJECT_WORDS.has(word));
  const vccScope = /\b(?:vcc|variable[\s-]+capital\s+compan(?:y|ies))\b/i;
  if (!/\bannual[\s-]+return\b/i.test(subject) || !boundedOrdinarySubject || domain !== 'ACRA_CORPORATE' || population !== 'COMPANY' ||
      !['EXPLAIN_RULE', 'FILING_REQUIREMENT', 'DETERMINE_TREATMENT', 'CALCULATE'].includes(operation) ||
      governingAuthorities.length !== 1 || governingAuthorities[0] !== 'ACRA' ||
      issueCount !== 1 || !independentlyRecognizedTopicIds.has('acra_annual-returns') ||
      independentlyRecognizedTopicIds.has('acra_vcc') || vccScope.test(query) || vccScope.test(subject)) {
    return false;
  }

  return true;
}

function canonicalAcraAnnualReturnSubjectIfBounded(
  query: string,
  subject: string,
  domain: SemanticQuestionDomain,
  population: SemanticPopulation,
  operation: SemanticQuestionOperation,
  governingAuthorities: SemanticAuthority[],
  independentlyRecognizedTopicIds: ReadonlySet<string>,
  issueCount: number
): string {
  if (!isBoundedAcraAnnualReturnSubject(query, subject, domain, population, operation,
    governingAuthorities, independentlyRecognizedTopicIds, issueCount)) return subject;

  // Resolve bounded annual-return labels (including due-date wording) through
  // the existing topic resolver without rewriting the provider's diagnostics.
  return 'annual return filing deadline';
}

const GST_FILING_SUBJECT_WORDS = new Set([
  'gst', 'goods', 'services', 'tax', 'return', 'returns', 'filing', 'file', 'deadline', 'deadlines', 'due', 'date', 'dates',
  'nil', 'duty', 'duties', 'extension', 'extensions', 'procedure', 'procedures', 'requirement', 'requirements',
  'accounting', 'period', 'periods', 'when', 'has', 'no', 'activity',
  'quarter', 'quarterly', 'payment', 'payments', 'company', 'companies', 'registered', 'rule', 'rules', 'and', 'or',
  'a', 'an', 'the', 'for', 'from', 'on', 'in', 'of', 'to', 'under', 'after', 'each', 'within'
]);

const MAS_CLASS_EXEMPTION_SUBJECT_WORDS = new Set([
  'conditional', 'class', 'classes', 'exemption', 'exemptions', 'exempt', 'from', 'fund', 'funds', 'management',
  'licensing', 'licence', 'licences', 'license', 'licenses', 'manager', 'managers', 'requirement', 'requirements',
  'rule', 'rules', 'and', 'or', 'a', 'an', 'the', 'for', 'of', 'to', 'under'
]);

const CPF_DUE_DATE_SUBJECT_WORDS = new Set([
  'cpf', 'contribution', 'contributions', 'legal', 'due', 'date', 'dates', 'late', 'payment', 'payments', 'enforcement',
  'cut', 'off', 'cutoff', 'deadline', 'deadlines', 'remit', 'remittance', 'employer', 'employers', 'last', 'day',
  'calendar', 'month', 'and', 'or', 'a', 'an', 'the', 'for', 'of', 'to', 'by', 'after', 'following'
]);

function normalizedSubjectWords(subject: string): string[] {
  return subject.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function hasOnlyBoundedSubjectWords(subject: string, allowedWords: ReadonlySet<string>): boolean {
  const words = normalizedSubjectWords(subject);
  return words.length > 0 && words.every(word => allowedWords.has(word));
}

function hasBoundedGstFilingSubject(subject: string): boolean {
  const words = normalizedSubjectWords(subject);
  return hasOnlyBoundedSubjectWords(subject, GST_FILING_SUBJECT_WORDS) && words.includes('gst') &&
    words.some(word => word === 'return' || word === 'returns') &&
    words.some(word => ['filing', 'file', 'deadline', 'deadlines', 'due'].includes(word));
}

function hasBoundedMasClassExemptionSubject(subject: string): boolean {
  const words = normalizedSubjectWords(subject);
  const classExemption = hasOnlyBoundedSubjectWords(subject, MAS_CLASS_EXEMPTION_SUBJECT_WORDS) && words.includes('class') &&
    words.some(word => word === 'exemption' || word === 'exemptions') && words.includes('fund') &&
    words.includes('management') && words.some(word => ['licensing', 'licence', 'license'].includes(word));
  const relatedCorporationExemptionWords = new Set([
    'whether', 'related', 'corporation', 'fund', 'management', 'is', 'automatically', 'exempt'
  ]);
  const relatedCorporationExemption = hasOnlyBoundedSubjectWords(subject, relatedCorporationExemptionWords) &&
    words.includes('related') && words.includes('corporation') && words.includes('management') &&
    words.includes('automatically') && words.includes('exempt');
  return classExemption || relatedCorporationExemption;
}

function hasBoundedGstFilingTopicBinding(
  query: string,
  subject: string,
  domain: SemanticQuestionDomain,
  population: SemanticPopulation,
  operation: SemanticQuestionOperation,
  governingAuthorities: SemanticAuthority[],
  independentlyRecognizedTopicIds: ReadonlySet<string>
): boolean {
  return domain === 'IRAS_GST' && population === 'COMPANY' &&
    ['EXPLAIN_RULE', 'FILING_REQUIREMENT'].includes(operation) &&
    governingAuthorities.length === 1 && governingAuthorities[0] === 'IRAS' &&
    independentlyRecognizedTopicIds.has('iras-gst-filing-deadlines') &&
    hasBoundedGstFilingSubject(subject) &&
    /\b(?:gst|goods and services tax)\b/i.test(query) &&
    /\b(?:returns?|filing|file)\b/i.test(query) && /\b(?:due|deadline|filing|file|nil|extension)\b/i.test(query);
}

function hasBoundedMasClassExemptionTopicBinding(
  query: string,
  subject: string,
  domain: SemanticQuestionDomain,
  population: SemanticPopulation,
  operation: SemanticQuestionOperation,
  governingAuthorities: SemanticAuthority[],
  independentlyRecognizedTopicIds: ReadonlySet<string>
): boolean {
  return domain === 'MAS_FUNDS' && population === 'COMPANY' &&
    ['EXPLAIN_RULE', 'CHECK_ELIGIBILITY'].includes(operation) &&
    governingAuthorities.length === 1 && governingAuthorities[0] === 'MAS' &&
    independentlyRecognizedTopicIds.has('mas-fund-management-exemptions') &&
    hasBoundedMasClassExemptionSubject(subject) &&
    (/\bclass\s+exemptions?\b/i.test(query) && /\bfund\s+management\b/i.test(query) &&
      /\blicen[cs](?:e|ing)\b/i.test(query) ||
      /\bfund manager\b/i.test(query) && /\bwithout\s+(?:an?\s+)?(?:mas\s+)?licen[cs]e\b/i.test(query) ||
      /\bclass exempt\b/i.test(query) && /\bfund management activities\b/i.test(query) ||
      /\bmanag\w*\s+money\b[^.!?]{0,100}\brelated corporation\b[^.!?]{0,100}\bautomatically exempt\b/i.test(query));
}

function hasSeparateMasLfmcLicensingAsk(query: string): boolean {
  const askBoundary = /\s+\b(?:and|or|but|also)\s+(?=(?:what|which|who|where|when|why|how|can|could|do|does|did|is|are|will|would|should|must|generally|separately|apply|explain|determine|check)\b)/i;
  const clauses = query.split(/[.!?;\n]+/).flatMap(sentence => sentence.split(askBoundary)).map(clause => clause.trim());
  return clauses.some(clause =>
    /\b(?:lfmc|licensed fund management company|fund manager|fund management)\b/i.test(clause) &&
    /\b(?:licen[cs](?:e|ing)|apply|requirement|regulated)\b/i.test(clause) &&
    !/\b(?:exempt(?:ion|ions|ed)?|without\s+(?:an?\s+)?(?:mas\s+)?licen[cs]e|does not require\s+(?:an?\s+)?(?:mas\s+)?licen[cs]e)\b/i.test(clause)
  );
}

function hasBoundedCpfDueDateIssue(
  query: string,
  subject: string,
  domain: SemanticQuestionDomain,
  population: SemanticPopulation,
  operation: SemanticQuestionOperation,
  governingAuthorities: SemanticAuthority[],
  independentlyRecognizedTopicIds: ReadonlySet<string>
): boolean {
  const words = normalizedSubjectWords(subject);
  return domain === 'CPF_PAYROLL' && population === 'EMPLOYER' && operation === 'FILING_REQUIREMENT' &&
    governingAuthorities.length === 1 && governingAuthorities[0] === 'CPF' &&
    independentlyRecognizedTopicIds.has('cpf-contribution-due-dates') &&
    hasOnlyBoundedSubjectWords(subject, CPF_DUE_DATE_SUBJECT_WORDS) &&
    words.includes('cpf') && words.some(word => word === 'contribution' || word === 'contributions') &&
    words.some(word => ['due', 'date', 'dates', 'deadline', 'deadlines', 'payment', 'payments', 'remit', 'remittance'].includes(word)) &&
    /\b(?:cpf|central provident fund)\b/i.test(query) &&
    /\b(?:due|deadline|date|payment|pay|remit|remittance)\b/i.test(query);
}

function hasCpfRateOrAmountOutcome(query: string, subject: string): boolean {
  return /\b(?:rates?|percentages?|percent|amounts?|how\s+much|calculate|compute|estimate|work\s+out|factor\w*|depend\w*|var(?:y|ies)|age|wage\s+band|wage\s+ceiling|citizenship|residency|rate\s+table|rate\s+schedule)\b/i.test(query + ' ' + subject);
}

function resolveIssueTopicIds(
  query: string,
  subject: string,
  domain: SemanticQuestionDomain,
  population: SemanticPopulation,
  operation: SemanticQuestionOperation,
  governingAuthorities: SemanticAuthority[],
  independentlyRecognizedTopicIds: ReadonlySet<string>,
  issueCount: number
): { mappedTopicIds: string[]; routingChildTopicIds: string[]; contextualTopicIds: string[] } {
  const allowedDomains = topicDomainsForIssue(domain, population);
  const subjectForTopicResolution = canonicalAcraAnnualReturnSubjectIfBounded(
    query, subject, domain, population, operation, governingAuthorities, independentlyRecognizedTopicIds, issueCount
  );
  const newAnnualReturnFamily = /\b(?:dormant|inactive|tax waiver|waived.*tax|share capital|branch.register exception)\b/i.test(query + ' ' + subject);
  const constrainB3AnnualReturnSubject = isBoundedAcraAnnualReturnMissingFactsQuestion(query) ||
    isAcraAnnualReturnDeadlineQuestion(query) && issueCount === 1 && !newAnnualReturnFamily;
  const boundedAcraAnnualReturnSubject = !constrainB3AnnualReturnSubject ||
    isBoundedAcraAnnualReturnSubject(query, subject, domain, population, operation,
      governingAuthorities, independentlyRecognizedTopicIds, issueCount);
  const subjectTopicIds = defaultQueryTopicResolver.decomposeQuery(subjectForTopicResolution).topics
    .map(topic => topic.id)
    .filter(topicId => topicId !== 'acra_annual-returns' || boundedAcraAnnualReturnSubject);
  const subjectTopics = getCoverageTopicsByIds(subjectTopicIds);
  const officerConfirmationOnly = issueCount === 1 && domain === 'ACRA_CORPORATE' && population === 'COMPANY'
    && governingAuthorities.length === 1 && governingAuthorities[0] === 'ACRA'
    && independentlyRecognizedTopicIds.has('acra-annual-return-officer-particulars')
    && subjectTopicIds.includes('acra-annual-return-officer-particulars')
    && !/\b(?:deadline|due date|extension|penalt\w*|how to file|filing process|filing procedure)\b/i.test(query + ' ' + subject);
  const bindRecognizedGstFilingTopic = hasBoundedGstFilingTopicBinding(
    query, subject, domain, population, operation, governingAuthorities, independentlyRecognizedTopicIds
  );
  const bindRecognizedMasClassExemptionTopic = hasBoundedMasClassExemptionTopicBinding(
    query, subject, domain, population, operation, governingAuthorities, independentlyRecognizedTopicIds
  );
  const bindRecognizedCpfDueDateTopic = hasBoundedCpfDueDateIssue(
    query, subject, domain, population, operation, governingAuthorities, independentlyRecognizedTopicIds
  );
  const generalCpfFamily = domain === 'CPF_PAYROLL' && population === 'EMPLOYER' && issueCount === 1 &&
    governingAuthorities.length === 1 && governingAuthorities[0] === 'CPF' &&
    ['EXPLAIN_RULE', 'CHECK_ELIGIBILITY'].includes(operation) &&
    (independentlyRecognizedTopicIds.has('cpf-employee-coverage') || independentlyRecognizedTopicIds.has('cpf-contribution-computation')) &&
    !/\b(?:what rate|which rate|percentage|rate table|rate schedule|calculate|compute|how much|amount payable)\b/i.test(query);
  const contextualizeCpfRates = (bindRecognizedCpfDueDateTopic && !hasCpfRateOrAmountOutcome(query, subject)) || generalCpfFamily;
  const contextualizeMasLfmc = bindRecognizedMasClassExemptionTopic && issueCount === 1 &&
    independentlyRecognizedTopicIds.has('mas-lfmc') && !hasSeparateMasLfmcLicensingAsk(query);
  const reportingRegimeContext = issueCount === 1 && domain === 'MAS_FUNDS' && population === 'COMPANY' &&
    ['EXPLAIN_RULE', 'FILING_REQUIREMENT'].includes(operation) &&
    governingAuthorities.length === 1 && governingAuthorities[0] === 'MAS' &&
    independentlyRecognizedTopicIds.has('mas-regulatory-reporting') &&
    /\b(?:financial returns?|audited filings?|reporting|notification|filing calendar)\b/i.test(subject) &&
    !hasSeparateMasLfmcLicensingAsk(query) &&
    !/\b(?:apply|application|obtain|licensing|admission|licence eligibility|license eligibility|exemptions?)\b/i.test(query);
  const contextualizeMasVcfm = issueCount === 1 && domain === 'MAS_FUNDS' && population === 'COMPANY' &&
    ['EXPLAIN_RULE', 'FILING_REQUIREMENT'].includes(operation) &&
    governingAuthorities.length === 1 && governingAuthorities[0] === 'MAS' &&
    independentlyRecognizedTopicIds.has('mas-regulatory-reporting') &&
    independentlyRecognizedTopicIds.has('mas-vcfm') &&
    /\b(?:vcfm|venture capital fund manager)\b/i.test(query) &&
    /\b(?:annual declarations?|form 25a|nil misconduct|nil return)\b/i.test(query) &&
    /\b(?:annual declarations?|form 25a|nil misconduct|nil return)\b/i.test(subject) &&
    !/\b(?:licen[cs](?:e|ing)|admission|eligibility|qualif\w*|exemption)\b/i.test(query + ' ' + subject);
  const bindRecognizedGstTopic = domain === 'IRAS_GST' && population === 'COMPANY' && operation === 'EXPLAIN_RULE' &&
    governingAuthorities.length === 1 && governingAuthorities[0] === 'IRAS' && issueCount === 1 &&
    independentlyRecognizedTopicIds.has('iras-gst-input-tax') && hasBoundedGstInputTaxRecoveryAnchors(query, subject);
  const bindGstCategoryComparison = domain === 'IRAS_GST' && population === 'COMPANY' && issueCount === 1 &&
    ['EXPLAIN_RULE', 'CHECK_ELIGIBILITY'].includes(operation) &&
    governingAuthorities.length === 1 && governingAuthorities[0] === 'IRAS' &&
    independentlyRecognizedTopicIds.has('iras-gst-zero-rating') && independentlyRecognizedTopicIds.has('iras-gst-exempt-supplies') &&
    /\bexempt\b/i.test(subject) && /\bzero[- ]rat(?:e|ed|ing)\b/i.test(subject);
  const boundTopicIds = [
    ...(bindRecognizedGstFilingTopic ? ['iras-gst-filing-deadlines'] : []),
    ...(bindRecognizedMasClassExemptionTopic ? ['mas-fund-management-exemptions'] : []),
    ...(bindRecognizedCpfDueDateTopic ? ['cpf-contribution-due-dates'] : []),
    ...(bindRecognizedGstTopic ? ['iras-gst-input-tax'] : []),
    ...(bindGstCategoryComparison ? ['iras-gst-zero-rating', 'iras-gst-exempt-supplies'] : [])
  ];
  const topicsForMapping = boundTopicIds.length
    ? [...new Map([...subjectTopics, ...getCoverageTopicsByIds(boundTopicIds)].map(topic => [topic.id, topic])).values()]
    : subjectTopics;
  const routingChildTopicIds = [...new Set([
    ...topicsForMapping.filter(topic => getRoutingParentIdsForChild(topic.id).length > 0).map(topic => topic.id),
    ...getRoutingChildTopicIdsMentionedInSubject(subject)
  ])].sort();
  const eligibleTopics = topicsForMapping.filter(topic =>
    allowedDomains.includes(topic.domainId) &&
    semanticAuthorityCoversTopic(governingAuthorities, topic.authorities, domain) &&
    !(topic.id === 'iras-gst-input-tax' && population !== 'COMPANY' && isGstInputTaxRecoverySubject(subject)) &&
    !(officerConfirmationOnly && topic.id === 'acra_annual-returns') &&
    !(topic.id === 'iras-gst-filing-deadlines' && hasBoundedGstFilingSubject(subject) && !bindRecognizedGstFilingTopic) &&
    !(topic.id === 'mas-fund-management-exemptions' && hasBoundedMasClassExemptionSubject(subject) && !bindRecognizedMasClassExemptionTopic) &&
    !(contextualizeCpfRates && topic.id === 'cpf_contribution_rates') &&
    !(reportingRegimeContext && ['mas-lfmc', 'mas-vcfm'].includes(topic.id)) &&
    !(contextualizeMasVcfm && topic.id === 'mas-vcfm'));
  const childParents = new Set(routingChildTopicIds.flatMap(getRoutingParentIdsForChild));
  return {
    mappedTopicIds: eligibleTopics
      .filter(topic => independentlyRecognizedTopicIds.has(topic.id) && !childParents.has(topic.id))
      .map(topic => topic.id).sort(),
    routingChildTopicIds,
    contextualTopicIds: [
      ...(officerConfirmationOnly && independentlyRecognizedTopicIds.has('acra_annual-returns') ? ['acra_annual-returns'] : []),
      ...(contextualizeCpfRates && independentlyRecognizedTopicIds.has('cpf_contribution_rates') ? ['cpf_contribution_rates'] : []),
      ...(contextualizeMasLfmc ? ['mas-lfmc'] : []),
      ...(contextualizeMasVcfm ? ['mas-vcfm'] : []),
      ...(reportingRegimeContext ? ['mas-lfmc', 'mas-vcfm'].filter(id => independentlyRecognizedTopicIds.has(id)) : [])
    ]
  };
}

function deriveEvidenceRequirement(
  domain: SemanticQuestionDomain,
  operation: SemanticQuestionOperation,
  caseSpecific?: boolean
): SemanticEvidenceRequirement {
  if (domain === 'UNKNOWN') return 'UNRESOLVED';
  if (caseSpecific !== undefined) return caseSpecific
    ? 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS'
    : 'AUTHORITATIVE_SOURCE';
  if (operation === 'EXPLAIN_INTERACTION') {
    return 'UNRESOLVED';
  }
  if (operation === 'EXPLAIN_RULE' || operation === 'COMPARE' || operation === 'OTHER') return 'AUTHORITATIVE_SOURCE';
  return 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS';
}

function validateSemanticQuestionIssue(value: unknown): SemanticQuestionIssue | undefined {
  if (!isRecord(value) || !hasExactKeys(value, SEMANTIC_ISSUE_KEYS) || typeof value.subject !== 'string' || !isSafeSemanticLabel(value.subject) ||
      typeof value.population !== 'string' || !POPULATIONS.has(value.population as SemanticPopulation) ||
      typeof value.domain !== 'string' || !DOMAINS.has(value.domain as SemanticQuestionDomain) ||
      !validAuthorities(value.governingAuthorities) || !validAuthorities(value.contextualAuthorities) ||
      !OPERATIONS.has(value.operation as SemanticQuestionOperation) ||
      !Array.isArray(value.mappedTopicIds) || value.mappedTopicIds.length > SEMANTIC_V2_WIRE_LIMITS.mappedTopicIdItems ||
      !value.mappedTopicIds.every(id => typeof id === 'string' && id.trim().length > 0) ||
      typeof value.evidenceRequirement !== 'string' || !EVIDENCE_REQUIREMENTS.has(value.evidenceRequirement as SemanticEvidenceRequirement) ||
      typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) ||
      value.confidence < SEMANTIC_V2_WIRE_LIMITS.confidenceMinimum || value.confidence > SEMANTIC_V2_WIRE_LIMITS.confidenceMaximum ||
      value.confidence < SEMANTIC_QUESTION_MIN_CONFIDENCE) return undefined;

  const domain = value.domain as SemanticQuestionDomain;
  const population = value.population as SemanticPopulation;
  const governingAuthorities = value.governingAuthorities as SemanticAuthority[];
  const contextualAuthorities = value.contextualAuthorities as SemanticAuthority[];
  const topicHints = value.mappedTopicIds as string[];
  if (governingAuthorities.length !== SEMANTIC_V2_WIRE_LIMITS.issueGoverningAuthorityItems ||
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

/** Strictly validates provider output, then derives case specificity from the query and requested issue operations. */
export function validateSemanticQuestionInterpretation(value: unknown, query?: string): SemanticQuestionInterpretation | undefined {
  if (!isRecord(value)) return undefined;
  const derivationQuery = query?.trim() ? query : undefined;
  const cachedSpecificity = !derivationQuery ? normalizedSpecificity.get(value) : undefined;
  const cachedRootMatches = cachedSpecificity !== undefined &&
    cachedSpecificity?.requestedOperation === value.requestedOperation &&
    cachedSpecificity.primarySubject === value.primarySubject &&
    cachedSpecificity.root === value.requiresUserSpecificFacts;
  const isVersion2 = Object.hasOwn(value, 'schemaVersion');
  const exactSchema = isVersion2
    ? value.schemaVersion === SEMANTIC_QUESTION_SCHEMA_VERSION &&
      (hasExactKeys(value, SEMANTIC_V2_INTERPRETATION_KEYS) || hasExactKeys(value, SEMANTIC_V2_COMPATIBILITY_KEYS))
    : hasExactKeys(value, LEGACY_INTERPRETATION_KEYS) || hasExactKeys(value, [...LEGACY_INTERPRETATION_KEYS, 'issues']);
  if (!exactSchema || (isVersion2 && (!Array.isArray(value.issues) || value.issues.length < SEMANTIC_V2_WIRE_LIMITS.issueItemsMinimum)) ||
      Object.hasOwn(value, 'issues') && (!Array.isArray(value.issues) || value.issues.length > SEMANTIC_V2_WIRE_LIMITS.issueItemsMaximum)) return undefined;
  if (!validLabelList(value.jurisdiction, SEMANTIC_V2_WIRE_LIMITS.jurisdictionItems) || !validAuthorities(value.authorityCandidates) ||
      !validAuthorities(value.contextualAuthorities) || typeof value.domain !== 'string' || !DOMAINS.has(value.domain as SemanticQuestionDomain) ||
      typeof value.population !== 'string' || !POPULATIONS.has(value.population as SemanticPopulation) ||
      typeof value.primarySubject !== 'string' || !isSafeSemanticLabel(value.primarySubject) ||
      !Array.isArray(value.concepts) || value.concepts.length > SEMANTIC_V2_WIRE_LIMITS.conceptItems ||
      !OPERATIONS.has(value.requestedOperation as SemanticQuestionOperation) ||
      Object.hasOwn(value, 'requiresUserSpecificFacts') && typeof value.requiresUserSpecificFacts !== 'boolean' ||
      !isVersion2 && typeof value.calculationRequested !== 'boolean' ||
      !validLabelList(value.factsExplicitlyProvided, SEMANTIC_V2_WIRE_LIMITS.factItems) || typeof value.confidence !== 'number' ||
      !Number.isFinite(value.confidence) || value.confidence < SEMANTIC_V2_WIRE_LIMITS.confidenceMinimum ||
      value.confidence > SEMANTIC_V2_WIRE_LIMITS.confidenceMaximum) return undefined;

  const concepts = value.concepts.flatMap(item => {
    if (!isRecord(item) || !hasExactKeys(item, SEMANTIC_CONCEPT_KEYS) || typeof item.concept !== 'string' ||
        !isSafeSemanticLabel(item.concept) ||
        typeof item.role !== 'string' || !CONCEPT_ROLES.has(item.role as SemanticConceptRole)) return [];
    return [{ concept: item.concept.trim(), role: item.role as SemanticConceptRole }];
  });
  if (concepts.length !== value.concepts.length) return undefined;

  const issues = Object.hasOwn(value, 'issues')
    ? (value.issues as unknown[]).map(validateSemanticQuestionIssue) as SemanticQuestionIssue[]
    : undefined;
  if (issues?.some(issue => !issue)) return undefined;
  const issueSpecificities = issues?.map((issue, index) => {
    const cachedIssue = cachedRootMatches ? cachedSpecificity?.issues?.[index] : undefined;
    if (!derivationQuery && cachedIssue?.operation === issue!.operation && cachedIssue.subject === issue!.subject) {
      return cachedIssue.required;
    }
    return deriveRequestedIssueSpecificity(derivationQuery, issue!, true);
  });
  const normalizedIssues = issues?.map((issue, index) => {
    return {
      ...issue!,
      evidenceRequirement: deriveEvidenceRequirement(issue!.domain, issue!.operation, issueSpecificities?.[index])
    };
  });
  const reportedCalculation = isVersion2
    ? value.requestedOperation === 'CALCULATE'
    : value.calculationRequested as boolean;
  const requiresUserSpecificFacts = CASE_FACTS_REQUIRED_OPERATIONS.has(value.requestedOperation as SemanticQuestionOperation) ||
    (issueSpecificities?.length ? issueSpecificities.some(Boolean) :
      cachedRootMatches ? cachedSpecificity!.root : deriveRequestedIssueSpecificity(derivationQuery, {
        subject: value.primarySubject.trim(), operation: value.requestedOperation as SemanticQuestionOperation
      }, false));
  const interpretation: SemanticQuestionInterpretation = {
    jurisdiction: value.jurisdiction.map(item => item.trim()),
    authorityCandidates: value.authorityCandidates as SemanticAuthority[],
    contextualAuthorities: value.contextualAuthorities as SemanticAuthority[],
    domain: value.domain as SemanticQuestionDomain,
    population: value.population as SemanticPopulation,
    primarySubject: value.primarySubject.trim(),
    concepts,
    requestedOperation: value.requestedOperation as SemanticQuestionOperation,
    requiresUserSpecificFacts,
    calculationRequested: reportedCalculation,
    factsExplicitlyProvided: value.factsExplicitlyProvided.map(item => item.trim()),
    confidence: value.confidence,
    ...(normalizedIssues ? { issues: normalizedIssues } : {})
  };
  if (!domainAuthorityIsPossible(interpretation)) return undefined;
  if (interpretation.calculationRequested !== (interpretation.requestedOperation === 'CALCULATE')) return undefined;
  if (interpretation.requestedOperation === 'PREPARE_JOURNAL' && interpretation.domain !== 'ACCOUNTING') return undefined;
  if (interpretation.authorityCandidates.includes('UNKNOWN') && interpretation.authorityCandidates.length > 1) return undefined;
  normalizedSpecificity.set(interpretation, {
    requestedOperation: interpretation.requestedOperation,
    primarySubject: interpretation.primarySubject,
    root: interpretation.requiresUserSpecificFacts,
    ...(normalizedIssues ? { issues: normalizedIssues.map((issue, index) => ({
      operation: issue.operation,
      subject: issue.subject,
      required: issueSpecificities?.[index] ?? true
    })) } : {})
  });
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
const CONCEPT_FORMAT_EXAMPLE = JSON.stringify({
  [SEMANTIC_CONCEPT_KEYS[0]]: '...',
  [SEMANTIC_CONCEPT_KEYS[1]]: SEMANTIC_CONCEPT_ROLE_VALUES.join('|')
});
const CONCEPT_SAMPLE = JSON.stringify({
  [SEMANTIC_CONCEPT_KEYS[0]]: 'expense recognition',
  [SEMANTIC_CONCEPT_KEYS[1]]: SEMANTIC_CONCEPT_ROLE_VALUES[0]
});

const RESPONSE_SCHEMA = `Return a V2 JSON object with exactly these top-level keys: ${SEMANTIC_V2_INTERPRETATION_KEYS.join(', ')}. Set schemaVersion=${SEMANTIC_QUESTION_SCHEMA_VERSION}. The application derives the calculation flag from requestedOperation; it is not included in this wire response. Include ${SEMANTIC_V2_WIRE_LIMITS.issueItemsMinimum}–${SEMANTIC_V2_WIRE_LIMITS.issueItemsMaximum} issues, one for every requested material outcome, including exactly one for a simple single-outcome question. Do not provide issue IDs; they are assigned deterministically. Each issue has exactly: ${SEMANTIC_ISSUE_KEYS.join(', ')}. Each concept has exactly ${CONCEPT_FORMAT_EXAMPLE}; labels must be safe and nonempty, for example ${CONCEPT_SAMPLE}. Confidence is a number from ${SEMANTIC_V2_WIRE_LIMITS.confidenceMinimum} through ${SEMANTIC_V2_WIRE_LIMITS.confidenceMaximum}.

mappedTopicIds are optional candidate hints; the application derives candidates from the issue subject and maps them only when independently recognized in the original question and consistent with domain, population, and authority. Leave them empty when unsure; keep every issue even without a matching topic. evidenceRequirement is ${SEMANTIC_EVIDENCE_REQUIREMENT_VALUES.join('|')}; the application derives it from domain, operation, and issue specificity. Issues describe questions to resolve, never conclusions.

For compound questions, decompose every distinct material outcome the user asks about into its own issue. An issue represents a requested answer or decision, not every noun, fact, or authority mentioned. Do not omit an issue because another authority or topic is more prominent. When the question asks separately about obligations or treatment for different parties, represent those as separate issues when their outcomes can differ; do not merge them just because they share a governing authority or domain. Multiple issues may have the same governing authority but different domains, populations, or operations. Assign exactly one governing authority to each issue and ensure it matches the issue domain. Put an authority in contextualAuthorities only when it is relevant context for that issue but does not govern it; merely mentioning an authority must not create an issue or workstream. Use UNKNOWN rather than inventing unsupported certainty. If a compound question has no single accurate top-level domain or population, set the top-level domain and population to UNKNOWN and put the precise values on issues[]. Use authorityCandidates=[UNKNOWN] when no single top-level authority set applies; never mix UNKNOWN with other top-level authority values.

Role semantics: PRIMARY is the main requested outcome; RELATED is a material descriptor or related concept and does not itself require another issue; CONTEXT_ONLY is background. Create separate issues only for independently requested outcomes whose answers may differ. Keep different parties' outcomes separate and distinguish employer duties from company tax. A standard or accounting treatment mentioned only as tax context creates no accounting issue; add one only for a requested recognition, measurement, presentation, disclosure, or journal outcome.

Classify each issue by the subject of the requested outcome. An employee's personal relief claim or salary/employment-income tax is individual income tax (IRAS); an employee benefit/perquisite tax question is employment-benefit tax (IRAS). EMPLOYEE alone does not imply a taxable benefit. Employer reporting is a separate issue only when the employer's reporting duty is requested; if the reporter is not established, use population=UNKNOWN rather than assuming the employee or company is the reporter. A company acting as employer for employment reporting has population=EMPLOYER; COMPANY is reserved for the company's own tax position. An employee's own CPF contribution amount and an employer's CPF contribution amount are separate payroll issues when both are requested.

Choose each issue's operation by the requested output. Use CALCULATE when the requested output is a numeric amount to pay, contribute, remit, deduct, withhold, charge, or provide—even if inputs are missing and no "amount", "how much", or "calculate" term appears. A number merely included as a case fact or illustration is not a calculation. Use DETERMINE_TREATMENT to apply a rule to a stated transaction, receipt, expense, benefit, or person's circumstances; a requested taxability or deductible-status outcome for a transaction is DETERMINE_TREATMENT. It also covers liability applicability or type even when phrased "explain" or "what tax applies". Use population=UNKNOWN if the affected party is unclear. Use CHECK_ELIGIBILITY for qualification or entitlement under a rule, scheme, or requirement, even if claimant status is unclear; for relief, "what can I claim?" or "can I claim?" asks entitlement, while "how much can I claim?" asks an amount (CALCULATE). Use EXPLAIN_RULE for general principles or conditions without applying them to a case. Use EXPLAIN_INTERACTION only for a requested relationship between rules; multiple issues alone are not interaction. Use FILING_REQUIREMENT for filing, reporting, or notification procedures; a requested withholding amount is CALCULATE, while a separately requested procedure is FILING_REQUIREMENT. Use PREPARE_JOURNAL for requested entries, COMPARE for requested alternatives, and otherwise OTHER. Do not emit a requiresUserSpecificFacts field: the application derives case specificity and per-issue evidence from the query, independent of supplied-fact counts or provider hints. CALCULATE, DETERMINE_TREATMENT, and PREPARE_JOURNAL are always case-specific; CHECK_ELIGIBILITY is so only for a specific claimant or transaction. Generic employee/class eligibility, "who can claim/qualifies", conditions, and general rules are source-only. Distinguish an audience request from a claim about the user's circumstances. The root flag is the OR of issue specificity, plus mandatory top-operation lower bounds; keep mixed issues' evidence independent.

Set top-level requestedOperation only when one operation describes the whole question; use OTHER for mixed operations. For mixed journal and non-accounting outcomes, use top-level domain/population UNKNOWN and operation OTHER, retaining PREPARE_JOURNAL on its issue. Record only user-supplied case facts in factsExplicitlyProvided.

Enums: domain=${SEMANTIC_DOMAIN_VALUES.join('|')}; population=${SEMANTIC_POPULATION_VALUES.join('|')}; authority values=${SEMANTIC_AUTHORITY_VALUES.join('|')}; operation=${SEMANTIC_OPERATION_VALUES.join('|')}; concept role=${SEMANTIC_CONCEPT_ROLE_VALUES.join('|')}. PREPARE_JOURNAL requires ACCOUNTING.

Conceptual rules may mention parties, claims, conditions, or illustrative amounts without deciding an identified case. Case specificity does not mean facts are missing; omit hypothetical examples and general conditions from factsExplicitlyProvided.

Identify whose own tax or regulatory status is at issue. First-person plural or overseas receipt alone does not establish an individual, employer, company, or fund; use UNKNOWN. Use EMPLOYEE for the employee's position, EMPLOYER for employer obligations, and COMPANY only as taxpayer or claimant; a shareholder is not the company.

Full V2 mixed journal-and-tax example: {"schemaVersion":2,"jurisdiction":["Singapore"],"authorityCandidates":["UNKNOWN"],"contextualAuthorities":[],"domain":"UNKNOWN","population":"UNKNOWN","primarySubject":"expense journal and tax deductibility","concepts":[{"concept":"expense accounting","role":"RELATED"},{"concept":"income-tax deductibility","role":"PRIMARY"}],"requestedOperation":"OTHER","factsExplicitlyProvided":[],"confidence":0.9,"issues":[{"subject":"expense journal","population":"COMPANY","domain":"ACCOUNTING","governingAuthorities":["ACCOUNTING_STANDARDS"],"contextualAuthorities":[],"operation":"PREPARE_JOURNAL","mappedTopicIds":[],"evidenceRequirement":"AUTHORITATIVE_SOURCE_AND_CASE_FACTS","confidence":0.9},{"subject":"company expense deduction eligibility","population":"COMPANY","domain":"IRAS_INCOME_TAX","governingAuthorities":["IRAS"],"contextualAuthorities":["ACCOUNTING_STANDARDS"],"operation":"CHECK_ELIGIBILITY","mappedTopicIds":[],"evidenceRequirement":"AUTHORITATIVE_SOURCE_AND_CASE_FACTS","confidence":0.9}]}`;

/** Calls only the configured provider with the current question; no evidence or conversation history is supplied. */
export async function interpretSemanticQuestion(
  query: string,
  provider?: ProviderSettings | string,
  callStructured: typeof executeStructuredLlmCall = executeStructuredLlmCall
): Promise<SemanticQuestionUnderstanding> {
  const transportAttempts: TransportAttemptDiagnostic[] = [];
  if (!hasConfiguredProvider(provider)) return {
    mode: 'DETERMINISTIC_FALLBACK', assessmentStatus: 'NOT_ASSESSED', transportAttempts, failure: 'NO_PROVIDER'
  };
  if (query.length > 6_000) return {
    mode: 'DETERMINISTIC_FALLBACK', assessmentStatus: 'NOT_ASSESSED', transportAttempts, failure: 'QUERY_TOO_LONG'
  };
  const prompt = `${RESPONSE_SCHEMA}\n\nInterpret this question:\n${query}`;
  // Injected transports own dispatch and retry policy; keep their established
  // four-option wire contract stable for archived evaluation senders.
  const structuredOptions = {
    jsonMode: true,
    responseJsonSchema: SEMANTIC_QUESTION_V2_RESPONSE_JSON_SCHEMA,
    timeoutMs: SEMANTIC_QUESTION_TIMEOUT_MS,
    temperature: 0,
    ...(callStructured === executeStructuredLlmCall ? {
      retryGeminiTransientFailures: true,
      captureTransportAttemptDiagnostics: transportAttempts
    } : {})
  };
  try {
    const response = await callStructured(prompt, SYSTEM_INSTRUCTION, provider, structuredOptions);
    if (response.length > 16_000) return {
      mode: 'DETERMINISTIC_FALLBACK', assessmentStatus: 'FAILED', transportAttempts,
      failure: 'INVALID_RESPONSE', failureReason: 'RESPONSE_TOO_LARGE'
    };
    let raw: unknown;
    try { raw = JSON.parse(response); } catch {
      return {
        mode: 'DETERMINISTIC_FALLBACK', assessmentStatus: 'FAILED', transportAttempts,
        failure: 'INVALID_RESPONSE', failureReason: 'MALFORMED_JSON'
      };
    }
    const interpretation = validateSemanticQuestionInterpretation(raw, query);
    if (!interpretation) return {
      mode: 'DETERMINISTIC_FALLBACK',
      assessmentStatus: 'FAILED',
      transportAttempts,
      failure: 'INVALID_RESPONSE',
      failureReason: hasSemanticContractContradiction(raw) ? 'CONTRADICTORY_FIELDS' : 'SCHEMA_MISMATCH'
    };
    if (interpretation.confidence < SEMANTIC_QUESTION_MIN_CONFIDENCE) return {
      mode: 'DETERMINISTIC_FALLBACK', assessmentStatus: 'FAILED', transportAttempts, failure: 'LOW_CONFIDENCE'
    };
    return {
      mode: 'SEMANTIC_INTERPRETATION', assessmentStatus: 'PASSED', transportAttempts,
      interpretation: normalizeAcraAnnualReturnDeadlineRuleInterpretation(query,
        normalizeGeneralCompanyTaxResidencyRuleInterpretation(query,
          normalizeIssueLocalCpfTaxOutcome(query, interpretation)))
    };
  } catch (error) {
    // aiTransport deliberately withholds provider bodies and includes only the HTTP status.
    // Preserve 429 as a transport outcome so callers can retry without scoring it as model quality.
    const providerStatusMatch = error instanceof Error
      ? error.message.match(/^Gemini API request failed with HTTP (\d{3})\./)
      : null;
    const providerStatus = providerStatusMatch ? Number(providerStatusMatch[1]) : undefined;
    return {
      mode: 'DETERMINISTIC_FALLBACK',
      assessmentStatus: 'NOT_ASSESSED',
      transportAttempts,
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
  const ownedCaseReference = /\b(?:my|our|your)\s+(?:(?:[\p{L}][\p{L}'’-]*)\s+){0,3}(?:compan(?:y|ies)|business(?:es)?|income|receipts?|expenses?|costs?|claims?|transactions?|suppl(?:y|ies)|payments?|employees?|employers?|reliefs?|deductions?|allowances?|contributions?|returns?|mothers?|fathers?|parents?|spouses?|children|clients?)\b/iu.test(query);
  const demonstrativeCaseReference = /\bthis\s+(?:business|company|income|receipt|expense|cost|claim|transaction|supply|payment|employee|employer)|these\s+(?:expenses|costs|claims|supplies)\b/i.test(query);
  const definitePartyOutcome = /\b(?:can|could|may|might|does|do|is|are|will|would|should)\s+the\s+(?:company|business|taxpayer|recipient)\b[^?]{0,100}\b(?:claim\w*|qualif\w*|eligib\w*|deduct\w*|taxable|liable|apply\s+for|pay\s+tax)\b/i.test(query);
  const namedEntity = /\b[A-Z][\p{L}\p{N}&.'’-]*(?:\s+[A-Z][\p{L}\p{N}&.'’-]*){0,3}\s+(?:Pte\.?\s+Ltd\.?|Private\s+Limited|Limited|Ltd\.?|LLP|LLC|Inc\.?|Corporation|Corp\.?)\b/u.test(query);
  return ownedCaseReference || demonstrativeCaseReference || definitePartyOutcome || namedEntity;
}

function hasFirstPersonOutcomeApplication(query: string): boolean {
  return /\b(?:can|could|may|might|do|does|will|would|should)\s+(?:i|we)\s+(?:claim\w*|qualif\w*|deduct\w*|apply\s+for|be\s+taxed|pay\s+tax)\b|\b(?:am\s+i|are\s+we)\s+(?:eligible|qualif\w*|taxable|liable)\b|\b(?:if|whether)\s+(?:i|we)\s+(?:can|could|may|might|am|are|would|will|should)\b[^.!?]{0,100}\b(?:claim\w*|qualif\w*|deduct\w*|taxable|liable|eligible)\b|\b(?:apply|taxable|deductible|eligible|liable)\b[^.!?]{0,60}\b(?:to|for)\s+(?:me|us)\b|\b(?:i|we)\s+(?:paid|incurred|purchased|received|claimed|sold|provided|supplied)\b[^.!?]{0,120}\b(?:tax treatment|taxable|input tax|deductible|claim\w*)\b/i.test(query);
}

function isClearlyGeneralRuleQuestion(query: string): boolean {
  const explicitGeneral = /\b(?:in\s+general|generally|as\s+a\s+general\s+rule|general\s+(?:rules?|criteria|conditions|overview|explanation|principles?)|what\s+are\s+(?:the\s+)?(?:rules|criteria|conditions)|(?:what|which)\s+conditions?\b|who\s+qualifies|interaction\s+between|interact\w*|overlap\w*|prioriti[sz]\w*|relationship\s+between)\b/i.test(query);
  const genericHypotheticalRule = /\b(?:if|when)\s+(?:a|an|any)\s+(?:(?:singapore|resident|individual|foreign)\s+){0,2}(?:tax\s+resident|employee|employer|company|business|individual|person|taxpayer)\b[^?]{0,220}\b(?:when|whether|what|how)\b/i.test(query);
  const capInteraction = /\b(?:cap|limit|threshold)\b/i.test(query) &&
    /\b(?:interact\w*|overlap\w*|prioriti[sz]\w*|relationship)\b/i.test(query);
  return explicitGeneral || genericHypotheticalRule || capInteraction;
}

function isGeneralCompanyTaxResidencyRuleQuestion(query: string): boolean {
  const ending = String.raw`(?:\s+(?:here|in\s+singapore))?\s*[?.!]*\s*$`;
  const generalRuleQuestion = new RegExp(
    String.raw`^\s*(?:under|as|in)\s+singapore['’]s?\s+general\s+rule\s*,?\s+when\s+(?:is|does)\s+(?:a|any)\s+company\s+(?:tax\s+resident|tax\s+residen(?:ce|cy))\b${ending}`,
    'i'
  ).test(query);
  const rulesDetermineQuestion = /^\s*how\s+do\s+singapore\s+tax\s+rules\s+determine\s+whether\s+a\s+company\s+is\s+tax\s+resident\s+(?:here|in\s+singapore)\s*[?.!]*\s*$/i.test(query);
  // A common natural-language version states the proposition first, then asks
  // for the rule in a second sentence (for example, whether Singapore
  // incorporation alone makes a company tax resident). Treat that as a rule
  // request when the prompt explicitly asks for the general residency test.
  const incorporationAloneRuleQuestion =
    /\b(?:is|does)\s+(?:being\s+)?incorporat(?:ion|ed)\s+(?:in\s+singapore\s+)?alone\s+(?:enough|sufficient)\s+to\s+(?:make|render)\s+(?:a|any)\s+company\s+(?:a\s+)?tax\s+resident\b/i.test(query) &&
    /\b(?:general(?:ly)?|test|control\s+and\s+management)\b/i.test(query);
  return (generalRuleQuestion || rulesDetermineQuestion || incorporationAloneRuleQuestion) &&
    !hasExplicitCaseReference(query) && !hasCaseLinkedCircumstances(query) && !hasFirstPersonOutcomeApplication(query);
}

function hasSemanticCompanyTaxResidencyAnchors(value: string): boolean {
  const normalized = value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /\b(?:company|companies|corporate|corporation)\b/.test(normalized) &&
    /\btax\b/.test(normalized) && /\b(?:residence|residency|resident)\b/.test(normalized);
}

function isCompanyResidencyRulePrefaceClause(clause: string): boolean {
  return /^(?:for|under)\s+singapore(?:['’]s)?\s+(?:(?:corporate|company)\s+)?(?:income\s+)?tax$/i.test(clause.trim());
}

function companyResidencyGeneralRuleBindings(
  query: string,
  interpretation: SemanticQuestionInterpretation
): Array<{ issueIndex: number; issue: SemanticQuestionIssue; clause: string }> {
  const issues = interpretation.issues || [];
  if (issues.length === 0) return [];
  const clauses = queryClauses(query);
  const ruleClauses = clauses.map((clause, index) => ({ clause, index })).filter(({ clause }) => hasSemanticCompanyTaxResidencyAnchors(clause))
    .map(({ index }) => semanticIssueClauseWithFollowOns(query, clauses, index, 'company tax residency determination'))
    .filter((clause): clause is string => Boolean(clause) &&
      hasSemanticCompanyTaxResidencyAnchors(clause) && isGeneralCompanyTaxResidencyRuleQuestion(clause));
  const bindings: Array<{ issueIndex: number; issue: SemanticQuestionIssue; clause: string }> = [];
  for (const clause of ruleClauses) {
    const clauseNeedsFacts = hasExplicitCaseReference(clause) || hasCaseLinkedCircumstances(clause) ||
      hasFirstPersonOutcomeApplication(clause);
    const matchingIssues = issues.map((issue, issueIndex) => ({ issue, issueIndex })).filter(({ issue }) =>
      issue.domain === 'IRAS_INCOME_TAX' && issue.population === 'COMPANY' &&
      issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'IRAS' &&
      hasSemanticCompanyTaxResidencyAnchors(issue.subject) &&
      ['DETERMINE_TREATMENT', 'CHECK_ELIGIBILITY', 'EXPLAIN_RULE'].includes(issue.operation) &&
      (hasExplicitCaseReference(issue.subject) || hasCaseLinkedCircumstances(issue.subject) ||
        hasFirstPersonOutcomeApplication(issue.subject)) === clauseNeedsFacts &&
      semanticIssueIsCompatibleWithRoot(issue, query, interpretation));
    if (matchingIssues.length === 1) bindings.push({ ...matchingIssues[0], clause });
  }
  return bindings;
}

function normalizeGeneralCompanyTaxResidencyRuleInterpretation(
  query: string,
  interpretation: SemanticQuestionInterpretation
): SemanticQuestionInterpretation {
  const bindings = companyResidencyGeneralRuleBindings(query, interpretation);
  if (bindings.length === 0) return interpretation;

  const normalizedIssues = interpretation.issues?.map((issue, index) =>
    bindings.some(binding => binding.issueIndex === index)
      ? { ...issue, operation: 'EXPLAIN_RULE' as const }
      : issue);
  const singleIssue = interpretation.issues?.length === 1 ? interpretation.issues[0] : undefined;
  const singleBinding = bindings.length === 1 ? bindings[0] : undefined;
  const clauses = queryClauses(query);
  const firstBoundClauseIndex = singleBinding
    ? clauses.findIndex(clause => singleBinding.clause.includes(clause))
    : -1;
  const unmatchedClauses = singleBinding ? clauses.map((clause, index) => ({ clause, index }))
    .filter(({ clause }) => !singleBinding.clause.includes(clause)) : [];
  const rootIsOnlyThisRule = Boolean(singleIssue && singleBinding && firstBoundClauseIndex >= 0 &&
    unmatchedClauses.every(({ clause, index }) => index < firstBoundClauseIndex && isCompanyResidencyRulePrefaceClause(clause)));
  const singleIssueBinding = rootIsOnlyThisRule && bindings.length === 1;
  return validateSemanticQuestionInterpretation({
    ...interpretation,
    ...(singleIssueBinding ? { requestedOperation: 'EXPLAIN_RULE', requiresUserSpecificFacts: false } : {}),
    ...(normalizedIssues ? { issues: normalizedIssues } : {})
  }, query) || interpretation;
}

function normalizeIssueLocalCpfTaxOutcome(
  query: string,
  interpretation: SemanticQuestionInterpretation
): SemanticQuestionInterpretation {
  const issues = interpretation.issues;
  if (!issues?.length) return interpretation;
  let changed = false;
  const normalizedIssues = issues.map(issue => {
    if (issue.domain !== 'CPF_PAYROLL' || issue.governingAuthorities.length !== 1 ||
        issue.governingAuthorities[0] !== 'CPF' || !/\b(?:relief|cash\s+top[ -]?ups?)\b/i.test(issue.subject) ||
        !['INDIVIDUAL', 'EMPLOYEE', 'UNKNOWN'].includes(issue.population)) return issue;
    const issueQuery = queryWithSemanticIssueFollowOns(query, issue.subject);
    if (!issueQuery || !/\b(?:cpf|central provident fund)\b/i.test(issueQuery) ||
        !/\b(?:tax\s+relief|personal\s+(?:income\s+)?tax\s+relief|personal\s+relief)\b/i.test(issueQuery) ||
        /\b(?:not|never|no)\b[^.!?]{0,50}\b(?:tax\s+relief|personal\s+(?:income\s+)?tax\s+relief|personal\s+relief)\b/i.test(issueQuery) ||
        explicitlyRequestsCpfPayrollOutcome(issues.length === 1 ? query : issueQuery) ||
        issue.population === 'UNKNOWN' && !/\b(?:personal|individual|my\s+own|own\s+(?:cpf|central provident fund)|employee['’]s\s+own)\b/i.test(issueQuery)) return issue;
    const generalRuleFollowOn = isBoundedCpfCashTopUpGeneralRuleQuery(issueQuery, query, issue, issues);
    if (['COMPANY', 'EMPLOYER'].includes(issue.population)) return issue;
    changed = true;
    const normalizedPopulation = issue.population === 'UNKNOWN' ? 'INDIVIDUAL' : issue.population;
    return {
      ...issue,
      population: normalizedPopulation,
      domain: 'IRAS_INCOME_TAX' as const,
      governingAuthorities: ['IRAS' as const],
      contextualAuthorities: [...new Set([...issue.contextualAuthorities, 'CPF' as const])]
        .filter(authority => authority !== 'IRAS'),
      ...(generalRuleFollowOn && issue.operation === 'CHECK_ELIGIBILITY' ? { operation: 'EXPLAIN_RULE' as const } : {})
    };
  });
  if (!changed) return interpretation;
  const singleIssue = issues.length === 1;
  return validateSemanticQuestionInterpretation({
    ...interpretation,
    ...(singleIssue ? {
      authorityCandidates: ['IRAS'],
      contextualAuthorities: [...new Set([...interpretation.contextualAuthorities, 'CPF'])].filter(authority => authority !== 'IRAS'),
      domain: 'IRAS_INCOME_TAX',
      population: normalizedIssues[0].population,
      ...(normalizedIssues[0].operation === 'EXPLAIN_RULE' ? {
        requestedOperation: 'EXPLAIN_RULE', requiresUserSpecificFacts: false
      } : {})
    } : {}),
    issues: normalizedIssues
  }, query) || interpretation;
}

function cpfIssueOwnsExecutableCalculation(
  fullQuery: string,
  issue: SemanticQuestionIssue,
  issues: readonly SemanticQuestionIssue[]
): boolean {
  const calculations = queryClauseSpans(fullQuery).flatMap(({ text }, index) =>
    text.split(/(?<=\.)\s+(?=(?:calculate|compute|estimate|how\s+much)\b)/i)
      .map(fragment => ({ text: removeNegatedOutputDirectives(fragment), index }))
  ).filter(({ text }) => /\b(?:calculate|compute|estimate|how\s+much\s+(?:relief|tax\s+relief)|my\s+(?:personal\s+)?(?:relief|tax\s+relief)\s+amount)\b/i.test(text));
  if (calculations.length === 0) return false;

  const issueStarts = issues.map((candidate, index) => ({
    issue: candidate,
    index,
    clauseIndex: queryClauseIndexForSemanticIssue(fullQuery, candidate.subject)
  }));
  const currentIssueIndex = issues.indexOf(issue);
  // Ambiguous issue matches cannot safely isolate another issue's calculation.
  if (currentIssueIndex < 0 || issueStarts.some(start => start.clauseIndex === undefined)) return true;

  for (const calculation of calculations) {
    const clauseAnchors = new Set(semanticConceptAnchors(calculation.text));
    // Relief is intentionally generic in ordinary concept matching. Here it
    // identifies a cash-top-up relief calculation only when an issue owns the
    // same relief subject, allowing a later CPF calculation to remain bound to
    // CPF even when a MOM issue appears between the questions.
    if (/\b(?:relief|tax\s+relief)\b/i.test(calculation.text)) clauseAnchors.add('relief');
    const eligibleIssues = issueStarts.filter(start => start.clauseIndex! <= calculation.index);
    if (eligibleIssues.length === 0) return true;
    const scoredOwners = eligibleIssues.map(candidate => {
      const issueAnchors = new Set(semanticConceptAnchors(candidate.issue.subject));
      if (/\bcash\s+top[ -]?ups?\b[\s\S]{0,45}\b(?:tax\s+)?relief\b/i.test(candidate.issue.subject)) issueAnchors.add('relief');
      return { index: candidate.index, score: [...clauseAnchors].filter(anchor => issueAnchors.has(anchor)).length };
    }).sort((left, right) => right.score - left.score || left.index - right.index);
    if (scoredOwners[0].score === 0 || scoredOwners.length > 1 && scoredOwners[0].score === scoredOwners[1].score ||
        scoredOwners[0].index === currentIssueIndex) return true;
  }
  return false;
}

function statesPersonalCpfTopUpAmount(query: string): boolean {
  return queryClauseSpans(query).some(({ text }) => {
    const topUp = /\b(?:cash\s+)?top[ -]?ups?\b/i.exec(text);
    if (!topUp) return false;
    const monetaryNumber = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;
    const explicitCurrency = new RegExp(String.raw`(?:\b(?:SGD|S\$|Singapore dollars?|dollars?)\s*\$?\s*${monetaryNumber}|\$\s*${monetaryNumber}|${monetaryNumber}\s*(?:SGD|Singapore dollars?|dollars?))`, 'i');
    const amountGrammar = new RegExp(String.raw`\b(?:cash\s+)?top[ -]?ups?\b[^.!?;]{0,50}?\b(?:of|amount(?:ing)?(?:\s+to)?|worth|valued\s+at|totaling|totalling)\s+(?:(?:SGD|S\$)\s*)?${monetaryNumber}\b`, 'i');
    const directAmount = new RegExp(String.raw`\b(?:cash\s+)?top[ -]?ups?\s+(?:(?:SGD|S\$)\s*)?${monetaryNumber}\b`, 'i');
    const amountBeforeTopUp = new RegExp(String.raw`\b${monetaryNumber}\s+(?:cash\s+)?top[ -]?ups?\b`, 'i');
    const currencyMatch = explicitCurrency.exec(text);
    if (currencyMatch) {
      const number = currencyMatch.slice(1).find(Boolean);
      if (number) {
        const numberOffset = currencyMatch.index + currencyMatch[0].lastIndexOf(number);
        if (Math.abs(numberOffset - topUp.index) <= 85) return true;
      }
    }
    const amountMatches = [amountGrammar.exec(text), directAmount.exec(text), amountBeforeTopUp.exec(text)].filter(
      (match): match is RegExpExecArray => match !== null
    );
    return amountMatches.some(match => {
      const number = match[1];
      if (!number) return false;
      const numberOffset = match.index + match[0].lastIndexOf(number);
      const contextBeforeNumber = text.slice(Math.max(0, numberOffset - 45), numberOffset);
      const contextAfterNumber = text.slice(numberOffset + number.length, numberOffset + number.length + 36);
      const yearOrDate = /\b(?:year\s+of\s+assessment|assessment\s+year|calendar\s+year|financial\s+year|YA|FY)\s*$/i.test(contextBeforeNumber) ||
        /\b(?:effective(?:\s+from)?|with\s+effect\s+from)\b[^.!?;]{0,24}\b(?:\d{1,2}\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*$/i.test(contextBeforeNumber);
      const ageCondition = /\b(?:aged?|age|under|below|over|above|at\s+least|younger\s+than|older\s+than)\s*$/i.test(contextBeforeNumber) ||
        /^\s*(?:years?\s+old|years?\s+of\s+age|and\s+older|or\s+older|and\s+younger|or\s+younger)\b/i.test(contextAfterNumber);
      return !yearOrDate && !ageCondition;
    });
  });
}

function isBoundedCpfCashTopUpGeneralRuleQuery(
  query: string,
  fullQuery = query,
  issue?: SemanticQuestionIssue,
  siblingIssues: readonly SemanticQuestionIssue[] = issue ? [issue] : []
): boolean {
  const statesGeneralEligibility = /\b(?:explain|describe|outline|summari[sz]e)\b[^.!?;]{0,100}\b(?:general\s+)?eligib\w*\s+conditions?\b/i.test(query);
  const statesReliefLimits = /\b(?:relief\s+limits?|limits?\s+(?:on\s+)?relief|maximum\s+relief|relief\s+caps?)\b/i.test(query);
  const ruleOnlyIntent = /\b(?:this\s+is|this\s+remains)\s+a\s+general\s+rules?\s+question\b/i.test(query) ||
    statesGeneralEligibility && statesReliefLimits;
  const executableRequestText = fullQuery.replace(
    /\b(?:do\s+not|don['’]?t|never)\s+(?:calculate|compute|estimate)\b(?:(?!\b(?:but|and)\s+(?:please\s+)?(?:calculate|compute|estimate)\b)(?!\b(?:rather\s+(?:than\s+)?|instead(?:\s+of)?\s*)(?:please\s+)?(?:calculate|compute|estimate)\b)[^,;.!?])*/gi,
    ' '
  );
  const requestsCaseAmount = /\b(?:calculate|compute|estimate|how\s+much\s+(?:relief|tax\s+relief)|my\s+(?:personal\s+)?(?:relief|tax\s+relief)\s+amount)\b/i.test(executableRequestText) &&
    (!issue || cpfIssueOwnsExecutableCalculation(fullQuery, issue, siblingIssues));
  const statesPersonalTopUpAmount = statesPersonalCpfTopUpAmount(query);
  const explicitCaseFacts = hasCaseLinkedCircumstances(fullQuery) ||
    statesPersonalTopUpAmount ||
    /\b(?:can|could|do|does|will|would|should)\s+i\b[^.!?;]{0,100}\b(?:qualif\w*|eligib\w*|claim\w*)\b|\b(?:am\s+i|are\s+we)\s+(?:eligible|qualif\w*|able\s+to\s+claim)\b/i.test(fullQuery);
  return /\b(?:cpf|central provident fund)\b/i.test(query) &&
    /\bcash\s+top[ -]?ups?\b/i.test(query) &&
    /\b(?:tax\s+relief|personal\s+(?:income\s+)?tax\s+relief|personal\s+relief)\b/i.test(query) &&
    ruleOnlyIntent && !requestsCaseAmount && !explicitCaseFacts;
}

function isGeneralAcraAnnualReturnMonthCountRuleQuestion(query: string): boolean {
  const ruleQuestion = query.replace(/[,.;?]?\s*(?:please\s+)?cite\s+(?:the\s+)?(?:official\s+)?(?:rule|source|reference)\s*[.!?]*$/i, '');
  const clauses = ruleQuestion.split(/[?!;]+|\b(?:however|whereas|but also|also)\b|\band\s+(?=(?:what|how|who|explain|compare|whether|do|does|is|are|can|could|may)\b)/i)
    .map(clause => clause.trim()).filter(Boolean);
  return clauses.length === 1 && /\bhow many months?\b/i.test(query) &&
    /\bafter\s+(?:the\s+)?(?:financial year end|fye)\b/i.test(query) &&
    /\bannual returns?\b/i.test(query) &&
    !/\b(?:calculate|compute|work out|exact date|calendar date|by what date|what date)\b/i.test(query) &&
    !/\b(?:19|20)\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/i.test(query) &&
    !/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(query);
}

function normalizeAcraAnnualReturnDeadlineRuleInterpretation(
  query: string,
  interpretation: SemanticQuestionInterpretation
): SemanticQuestionInterpretation {
  const issue = interpretation.issues?.length === 1 ? interpretation.issues[0] : undefined;
  if (!isGeneralAcraAnnualReturnMonthCountRuleQuestion(query) ||
      !isAcraAnnualReturnDeadlineQuestion(query) || interpretation.domain !== 'ACRA_CORPORATE' ||
      !interpretation.authorityCandidates.includes('ACRA') || interpretation.factsExplicitlyProvided.length > 0 ||
      interpretation.requestedOperation !== 'DETERMINE_TREATMENT' ||
      interpretation.population !== 'COMPANY' || !issue || issue.domain !== 'ACRA_CORPORATE' ||
      issue.population !== 'COMPANY' || issue.governingAuthorities.length !== 1 ||
      issue.governingAuthorities[0] !== 'ACRA' || issue.operation !== 'DETERMINE_TREATMENT' ||
      issue.mappedTopicIds.length !== 1 || issue.mappedTopicIds[0] !== 'acra_annual-returns' ||
      !/\bannual returns?\b/i.test(issue.subject) || hasExplicitCaseReference(query) ||
      hasCaseLinkedCircumstances(query) || hasFirstPersonOutcomeApplication(query) ||
      /\b[A-Z][\p{L}\p{N}&.'’-]*(?:\s+[A-Z][\p{L}\p{N}&.'’-]*){0,3}\s+(?:Pte\.?\s+Ltd\.?|Private\s+Limited|Limited|Ltd\.?|LLP|LLC|Inc\.?|Corporation|Corp\.?)\b/u.test(query)) {
    return interpretation;
  }

  return validateSemanticQuestionInterpretation({
    ...interpretation,
    requestedOperation: 'EXPLAIN_RULE',
    requiresUserSpecificFacts: false,
    calculationRequested: false,
    issues: [{ ...issue, operation: 'EXPLAIN_RULE' }]
  }, query) || interpretation;
}

function asksForCaseOutcome(query: string): boolean {
  return /\b(?:can|could|may|might|do|does|is|are|am|will|would|should)\b[^?]{0,140}\b(?:claim\w*|qualif\w*|eligib\w*|deduct\w*|taxable|subject\s+to\s+tax|liable|tax\s+treatment|apply\s+to)\b/i.test(query) ||
    /\b(?:is|are|does|do|will|would)\b[^.!?]{0,140}\b(?:tax\s+)?residen(?:ce|cy|t)\b/i.test(query) ||
    /\b(?:whether|if)\b[^.!?]{0,100}\b(?:is|are|will|would|does|do|determine|assess)\b[^.!?]{0,60}\b(?:tax\s+)?residen(?:ce|cy|t)\b/i.test(query);
}

const GENERIC_ISSUE_SUBJECT_WORDS = new Set([
  'about', 'accounting', 'amount', 'case', 'company', 'conditions', 'deduction', 'eligibility', 'general',
  'income', 'issue', 'payment', 'personal', 'question', 'relief', 'rule', 'rules', 'singapore', 'tax', 'treatment'
]);

const SEMANTIC_SOURCE_AUTHORITY_PATTERNS: Array<[string, RegExp]> = [
  ['ACRA', /\b(?:acra|accounting and corporate regulatory authority)(?:['’]s)?\s+(?:official\s+)?(?:guidance|rules?|requirements?|law|act|regulations?)\b/i],
  ['CPF', /\b(?:cpf(?:\s+board)?|central provident fund board)(?:['’]s)?\s+(?:official\s+)?(?:guidance|rules?|requirements?|law|act|regulations?)\b/i],
  ['IRAS', /\b(?:iras|inland revenue authority of singapore)(?:['’]s)?\s+(?:official\s+)?(?:guidance|rules?|requirements?|law|act|regulations?)\b/i],
  ['MAS', /\b(?:mas|monetary authority of singapore)(?:['’]s)?\s+(?:official\s+)?(?:guidance|rules?|requirements?|law|act|regulations?)\b/i],
  ['MOM', /\b(?:mom|ministry of manpower)(?:['’]s)?\s+(?:official\s+)?(?:guidance|rules?|requirements?|law|act|regulations?)\b/i]
];

const STANDALONE_SOURCE_AUTHORITY_PREFACE = /^\s*(?:under|according\s+to|based\s+on|using)\s+(?:current\s+)?(?:the\s+)?(?:official\s+)?(?:acra|accounting and corporate regulatory authority|cpf(?:\s+board)?|central provident fund board|iras|inland revenue authority of singapore|mas|monetary authority of singapore|mom|ministry of manpower)(?:['’]s)?\s+(?:guidance|rules?|requirements?|law|act|regulations?)\s*$/i;

function hasCaseLinkedCircumstances(query: string): boolean {
  return /\bfor\s+(?:someone|a person|an individual|a particular (?:employee|company|business|taxpayer))\b[^.!?]{0,100}\b(?:earning|paid|received|incurred|purchased|owned|provided|claimed)\b/i.test(query) ||
    /\b(?:someone|a person|an individual|a particular (?:employee|company|business|taxpayer))\b[^.!?]{0,100}\b(?:earning|paid|received|incurred|purchased|owned|provided|claimed)\b/i.test(query);
}

function queryClauses(query: string): string[] {
  return queryClauseSpans(query).map(clause => clause.text);
}

interface QueryClauseSpan {
  text: string;
  start: number;
  end: number;
}

function queryClauseSpans(query: string): QueryClauseSpan[] {
  const clauses: QueryClauseSpan[] = [];
  const separator = /[?!;]+|\.(?=\s+(?:please\s+)?(?:explain|describe|outline|summari[sz]e|do\s+not|don['’]?t|never|under|according\s+to|based\s+on|using|this\s+is\s+a\s+general|what|which|who|how|can|could|do|does|is|are|will|would|should)\b)|(?<!\d),(?!\d)|\b(?:however|whereas|but also|also|separately)\b|\band\s+(?=(?:what|how|who|explain|compare|whether|do|does|is|are|can|could|may)\b)/gi;
  let start = 0;
  const append = (end: number) => {
    const raw = query.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) clauses.push({ text, start: start + leading, end: start + leading + text.length });
  };
  for (const match of query.matchAll(separator)) {
    append(match.index);
    start = match.index + match[0].length;
  }
  append(query.length);
  return clauses;
}

function isBoundedSemanticIssueFollowOn(clause: string): boolean {
  return /^(?:please\s+)?(?:explain|describe|outline|summari[sz]e)\b/i.test(clause) &&
      /\b(?:general|rules?|eligib\w*|conditions?|criteria|limits?|caps?|requirements?|guidance)\b/i.test(clause) ||
    /^this\s+(?:is|remains)\s+a\s+general\s+rules?\s+question\b/i.test(clause) ||
    /^(?:please\s+)?(?:do\s+not|don['’]?t|never)\s+(?:calculate|compute|estimate|quantify|create|prepare)\b/i.test(clause);
}

function semanticIssueFollowOnCanAttach(
  query: string,
  clauses: string[],
  baseIndex: number,
  followOnIndex: number,
  subject?: string
): boolean {
  const spans = queryClauseSpans(query);
  const baseClause = spans[baseIndex]?.text;
  const next = spans[followOnIndex]?.text;
  if (!baseClause || !next) return false;
  const previousEnd = spans[baseIndex].end;
  const nextStart = spans[followOnIndex].start;
  const bridge = query.slice(previousEnd, nextStart);
  if (/\b(?:separately|also|however|whereas|but\s+also|independently)\b/i.test(bridge)) return false;
  const sourceContextClause = baseIndex > 0 && STANDALONE_SOURCE_AUTHORITY_PREFACE.test(clauses[baseIndex - 1])
    ? clauses[baseIndex - 1] : baseClause;
  const baseAuthorities = new Set(SEMANTIC_SOURCE_AUTHORITY_PATTERNS
    .filter(([, pattern]) => pattern.test(sourceContextClause)).map(([authority]) => authority));
  const nextAuthorities = SEMANTIC_SOURCE_AUTHORITY_PATTERNS
    .filter(([, pattern]) => pattern.test(next)).map(([authority]) => authority);
  if (baseAuthorities.size > 0 && nextAuthorities.some(authority => !baseAuthorities.has(authority))) return false;
  const continuesIssueQuestion = subject !== undefined && (() => {
    const issueAnchors = [...new Set(normalizeSemanticAnchorText(subject).split(' ').map(semanticConceptAnchor)
      .filter(term => term.length >= 3 && !GENERIC_ISSUE_SUBJECT_WORDS.has(term) &&
        !SEMANTIC_CONCEPT_FILLER_WORDS.has(term)))];
    const nextAnchors = new Set(normalizeSemanticAnchorText(next).split(' ').map(semanticConceptAnchor));
    return issueAnchors.some(anchor => nextAnchors.has(anchor)) &&
      /^(?:when|what|which|how|who|is|are|does|do|can|could|may|might|will|would|should)\b/i.test(next) &&
      /\band\b/i.test(bridge);
  })();
  return isBoundedSemanticIssueFollowOn(next) || continuesIssueQuestion;
}

function semanticIssueClauseWithFollowOns(query: string, clauses: string[], baseIndex: number, subject?: string): string {
  if (baseIndex < 0 || baseIndex >= clauses.length) return '';
  const bound = [clauses[baseIndex]];
  for (let index = baseIndex + 1; index < clauses.length; index += 1) {
    const next = clauses[index];
    if (!semanticIssueFollowOnCanAttach(query, clauses, baseIndex, index, subject)) break;
    bound.push(next);
  }
  return bound.join('. ');
}

function semanticIssueClauseGroups(
  query: string,
  clauses: string[],
  subject?: string
): Array<{ startIndex: number; endIndex: number; clauses: string[] }> {
  const groups: Array<{ startIndex: number; endIndex: number; clauses: string[] }> = [];
  for (let index = 0; index < clauses.length; index += 1) {
    const current = groups.at(-1);
    if (current && isBoundedSemanticIssueFollowOn(clauses[index]) &&
        semanticIssueFollowOnCanAttach(query, clauses, current.startIndex, index, subject)) {
      current.clauses.push(clauses[index]);
      current.endIndex = index;
    } else {
      groups.push({ startIndex: index, endIndex: index, clauses: [clauses[index]] });
    }
  }
  return groups;
}

/** Punctuation and bounded conjunction clauses used for issue-local concept ownership. */
export function getSemanticQueryClauses(query: string): string[] {
  return queryClauses(query);
}

/** Selects one raw clause only when its original wording uniquely matches the issue. */
function queryClauseIndexForSemanticIssue(query: string, subject: string): number | undefined {
  const clauses = queryClauses(query);
  if (clauses.length < 2) return 0;
  if (hasSemanticCompanyTaxResidencyAnchors(subject)) {
    const issueNeedsFacts = hasExplicitCaseReference(subject) || hasCaseLinkedCircumstances(subject) ||
      hasFirstPersonOutcomeApplication(subject);
    const matchingClauses = clauses.map((clause, index) => ({ clause, index })).filter(({ clause }) => hasSemanticCompanyTaxResidencyAnchors(clause)).map(({ clause, index }) => ({
      clause,
      index,
      scoped: semanticIssueClauseWithFollowOns(query, clauses, index, subject)
    })).filter(({ scoped }) => scoped !== undefined &&
      (hasExplicitCaseReference(scoped) || hasCaseLinkedCircumstances(scoped) ||
        hasFirstPersonOutcomeApplication(scoped)) === issueNeedsFacts);
    if (matchingClauses.length === 1) return matchingClauses[0].index;
    return undefined;
  }
  const subjectTerms = semanticConceptAnchors(subject);
  if (subjectTerms.length === 0) return undefined;
  const scored = semanticIssueClauseGroups(query, clauses, subject).map(group => {
    const clause = clauses[group.startIndex];
    const scopedClause = group.clauses.join('. ');
    const clauseTerms = new Set(semanticConceptAnchors(scopedClause));
    return {
      clause,
      index: group.startIndex,
      score: subjectTerms.filter(term => clauseTerms.has(term)).length
    };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  return scored[0].score >= 2 && (scored.length === 1 || scored[0].score > scored[1].score)
    ? scored[0].index : undefined;
}

function queryClauseForSemanticIssue(query: string, subject: string): string | undefined {
  const index = queryClauseIndexForSemanticIssue(query, subject);
  return index === undefined ? undefined : queryClauses(query)[index];
}

/** Bounded issue-local text includes only the selected request and its attached follow-on context. */
function queryWithSemanticIssueFollowOns(query: string, subject: string): string | undefined {
  const clauses = queryClauses(query);
  const requestIndex = queryClauseIndexForSemanticIssue(query, subject);
  return requestIndex === undefined ? undefined : semanticIssueClauseWithFollowOns(query, clauses, requestIndex, subject);
}

function semanticCompanyResidencyLabelBelongsToIssue(
  label: string,
  query: string,
  issue: SemanticQuestionIssue
): boolean {
  const normalizedLabel = normalizeSemanticAnchorText(label);
  if (issue.domain !== 'IRAS_INCOME_TAX' || issue.population !== 'COMPANY' ||
      issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'IRAS' ||
      !hasSemanticCompanyTaxResidencyAnchors(issue.subject) ||
      !(/\b(?:residen(?:ce|cy|t))\b/.test(normalizedLabel) || normalizedLabel === 'control and management')) return false;
  const clause = queryWithSemanticIssueFollowOns(query, issue.subject);
  return Boolean(clause && hasSemanticCompanyTaxResidencyAnchors(clause));
}

function semanticEmploymentActDescriptorBelongsToMomCoverage(
  label: string,
  query: string,
  issue: SemanticQuestionIssue
): boolean {
  if (normalizeSemanticAnchorText(label) !== 'employment act' || issue.domain !== 'MOM_EMPLOYMENT' ||
      issue.population !== 'EMPLOYEE' || issue.governingAuthorities.length !== 1 ||
      issue.governingAuthorities[0] !== 'MOM' || !/\bpart\s+iv\b/i.test(issue.subject) ||
      !/\b(?:coverage|covered)\b/i.test(issue.subject)) return false;
  const clause = queryWithSemanticIssueFollowOns(query, issue.subject);
  return Boolean(clause && /\bemployment\s+act\b/i.test(clause) && /\bpart\s+iv\b/i.test(clause) &&
    /\b(?:coverage|covered)\b/i.test(clause));
}

function semanticMasCmsRequirementBelongsToIssue(
  label: string,
  query: string,
  issue: SemanticQuestionIssue
): boolean {
  const normalizedLabel = normalizeSemanticAnchorText(label);
  if (!/\b(?:licensing|licence|license)\b/.test(normalizedLabel) || !/\brequirement\b/.test(normalizedLabel) ||
      issue.domain !== 'MAS_FUNDS' || issue.governingAuthorities.length !== 1 ||
      issue.governingAuthorities[0] !== 'MAS' ||
      !/\b(?:cms|capital\s+markets\s+services)\b/i.test(issue.subject) ||
      !/\b(?:licen[cs]e|requirement|required)\b/i.test(issue.subject)) return false;
  const clauses = queryClauses(query);
  const definitionClause = clauses.some(clause => /\b(?:cms|capital\s+markets\s+services)\b/i.test(clause) &&
    (/\b(?:define|definition|meaning)\b/i.test(clause) ||
      /\bwhat\s+is\s+(?:a\s+|an\s+|the\s+)?(?:cms|capital\s+markets\s+services)\s+licen[cs]e\b/i.test(clause)));
  const requirementClauses = clauses.filter(clause =>
    /\b(?:generally|in\s+general|requirement|required|licensing)\b/i.test(clause) &&
    /\b(?:when|what|which|how|explain|describe|outline|summari[sz]e)\b/i.test(clause));
  const localClause = queryWithSemanticIssueFollowOns(query, issue.subject);
  return definitionClause && requirementClauses.length === 1 && Boolean(localClause) &&
    /\b(?:cms|capital\s+markets\s+services|licen[cs]e|licensing|requirement|required)\b/i.test(localClause || '');
}

function semanticConceptAnchor(value: string): string {
  const normalized = normalizeSemanticAnchorText(value);
  if (['license', 'licensing'].includes(normalized)) return 'licence';
  if (['required', 'require', 'requiring'].includes(normalized)) return 'requirement';
  if (['cover', 'covers', 'covered', 'covering', 'coverage'].includes(normalized)) return 'coverage';
  if (normalized.length > 4 && normalized.endsWith('ies')) return `${normalized.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zes|sses)$/.test(normalized)) return normalized.slice(0, -2);
  return normalized.length > 3 && normalized.endsWith('s') && !normalized.endsWith('ss')
    ? normalized.slice(0, -1)
    : normalized;
}

function normalizeSemanticAnchorText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const SEMANTIC_CONCEPT_FILLER_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'with', 'under', 'at', 'by', 'to', 'from', 'of', 'in', 'on', 'as']);

function semanticConceptAnchors(label: string): string[] {
  return [...new Set(normalizeSemanticAnchorText(label).split(' ')
    .map(semanticConceptAnchor)
    .filter(term => term.length >= 3 && !GENERIC_ISSUE_SUBJECT_WORDS.has(term) && !SEMANTIC_CONCEPT_FILLER_WORDS.has(term)))];
}

const SCOPED_CANONICAL_ALIAS_FAMILIES = [
  {
    ids: ['gst_blocked_motor_car_input_tax', 'gst_motor_car_input_tax_exceptions'],
    recognizedAliases: ['iras restriction', 'exceptions', 'input tax exceptions']
  },
  {
    ids: ['cpf_cash_top_up_relief', 'cpf_cash_top_up_relief_eligibility', 'cpf_cash_top_up_relief_limits'],
    recognizedAliases: ['eligibility conditions', 'qualifying conditions', 'conditions for eligibility',
      'relief limits', 'limits on relief', 'maximum relief', 'relief cap']
  },
  {
    ids: ['company_tax_residency_incorporation'],
    recognizedAliases: []
  }
];

function semanticLabelMatchesCanonicalFamilyVocabulary(
  label: string,
  concepts: RequestedQuestionConcept[],
  canonicalIds: readonly string[],
  recognizedAliases: readonly string[] = []
): boolean {
  if (recognizedAliases.includes(normalizeSemanticAnchorText(label))) return true;
  const familyConcepts = concepts.filter(concept => canonicalIds.includes(concept.id));
  if (familyConcepts.length === 0) return false;
  const knownAnchors = new Set(familyConcepts.flatMap(concept =>
    [concept.label, ...concept.terms].flatMap(semanticConceptAnchors)));
  const labelAnchors = semanticConceptAnchors(label);
  return labelAnchors.length > 0 && labelAnchors.every(anchor => knownAnchors.has(anchor));
}

function semanticLabelIsCoveredByCanonicalSubstring(
  label: string,
  normalized: string,
  concepts: RequestedQuestionConcept[],
  query: string,
  semantic: SemanticQuestionInterpretation | undefined
): boolean {
  return concepts.some(concept => {
    if (!concept.label.toLowerCase().includes(normalized) && !normalized.includes(concept.label.toLowerCase())) return false;
    const family = SCOPED_CANONICAL_ALIAS_FAMILIES.find(candidate => candidate.ids.includes(concept.id));
    if (!family) return true;
    if (!semanticLabelMatchesCanonicalFamilyVocabulary(label, concepts, family.ids, family.recognizedAliases)) return false;
    if (family.ids.includes('gst_blocked_motor_car_input_tax')) {
      return semanticGstMotorCarAliasIsCovered(label, query, semantic, false) ||
        semanticGstMotorCarAliasIsCovered(label, query, semantic, true) ||
        semanticIrasRestrictionAliasesCanonicalGst(label, query, semantic);
    }
    if (family.ids.includes('cpf_cash_top_up_relief')) {
      return semanticCpfCashTopUpAliasIsCovered(label, query, semantic, 'base') ||
        semanticCpfCashTopUpAliasIsCovered(label, query, semantic, 'eligibility') ||
        semanticCpfCashTopUpAliasIsCovered(label, query, semantic, 'limits');
    }
    return semanticCompanyResidencyIncorporationAliasIsCovered(label, query, semantic);
  });
}

function semanticConceptMatchesIssueClause(label: string, query: string, subject: string): boolean {
  const clause = queryWithSemanticIssueFollowOns(query, subject);
  const anchors = semanticConceptAnchors(label);
  if (!clause || anchors.length === 0) return false;
  const clauseWords = new Set(normalizeSemanticAnchorText(clause).split(' ').map(semanticConceptAnchor));
  const matchedAnchors = anchors.filter(anchor => clauseWords.has(anchor));
  return matchedAnchors.length >= Math.min(2, anchors.length);
}

function semanticIrasRestrictionFollowOnBelongsToIssue(
  label: string,
  query: string,
  issue: SemanticQuestionIssue
): boolean {
  if (normalizeSemanticAnchorText(label) !== 'iras restriction' || issue.domain !== 'IRAS_GST' ||
      issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'IRAS') return false;
  const subjectIndex = queryClauseIndexForSemanticIssue(query, issue.subject);
  if (subjectIndex === undefined || !semanticConceptMatchesIssueClause(issue.subject, query, issue.subject)) return false;
  const clauses = queryClauses(query);
  const clauseSpans = queryClauseSpans(query);
  const subjectEnd = clauseSpans[subjectIndex]?.end;
  if (subjectEnd === undefined) return false;
  const followOn = clauses[subjectIndex + 1];
  const followOnStart = clauseSpans[subjectIndex + 1]?.start;
  if (!followOn || !/\b(?:explain|describe|outline|summari[sz]e)\b/i.test(followOn) ||
      !/\biras\b/i.test(followOn) || !/\brestrictions?\b/i.test(followOn) ||
      !/\bexceptions?\b/i.test(followOn) ||
      /\b(?:acra|cpf|mas|mom)\b/i.test(followOn)) return false;
  if (followOnStart === undefined) return false;
  const interveningText = query.slice(subjectEnd, followOnStart);
  return !/\b(?:separately|also|however|whereas|but also|acra|cpf|mas|mom)\b/i.test(interveningText);
}

function independentlyMappedIssueTopicIds(query: string, issue: SemanticQuestionIssue, issueCount: number): string[] {
  const independentlyRecognizedTopicIds = new Set(defaultQueryTopicResolver.decomposeQuery(query).topics.map(topic => topic.id));
  return resolveIssueTopicIds(query, issue.subject, issue.domain, issue.population, issue.operation,
    issue.governingAuthorities, independentlyRecognizedTopicIds, issueCount).mappedTopicIds;
}

function semanticPersonalTaxReliefLabelBelongsToCpfIssue(
  label: string,
  query: string,
  issue: SemanticQuestionIssue,
  semantic: SemanticQuestionInterpretation
): boolean {
  if (normalizeSemanticAnchorText(label) !== 'personal tax relief' ||
      issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'IRAS') return false;
  const clause = queryWithSemanticIssueFollowOns(query, issue.subject);
  if (!clause || !/\bpersonal\s+(?:income\s+)?tax\s+relief\b/i.test(clause) ||
      !/\bpersonal\s+(?:income\s+)?tax\s+relief\b[^.!?]{0,60}\b(?:on|for)\s+(?:compulsory\s+)?(?:cpf|central provident fund)\b/i.test(clause)) return false;
  if (semantic.issues?.length === 1) {
    if (semantic.domain !== 'IRAS_INCOME_TAX' ||
        !['INDIVIDUAL', 'EMPLOYEE'].includes(semantic.population) ||
        semantic.authorityCandidates.length !== 1 || semantic.authorityCandidates[0] !== 'IRAS' ||
        !semanticIssueIsCompatibleWithRoot(issue, query, semantic) ||
        !['INDIVIDUAL', 'EMPLOYEE'].includes(issue.population) ||
        toRegistryDomain(issue.domain, issue.population) !== 'IRAS_INDIVIDUAL_TAX') return false;
  }
  return isMappedIndividualCpfReliefIssue(issue, independentlyMappedIssueTopicIds(query, issue, semantic.issues?.length || 1));
}

function semanticIssueForConceptLabel(
  label: string,
  query: string,
  semantic: SemanticQuestionInterpretation | undefined
): SemanticQuestionIssue | undefined {
  if (!semantic?.issues?.length) return undefined;
  const owners = semantic.issues.filter(issue =>
    semanticConceptMatchesIssueClause(label, query, issue.subject) ||
    semanticCompanyResidencyLabelBelongsToIssue(label, query, issue) ||
    semanticEmploymentActDescriptorBelongsToMomCoverage(label, query, issue) ||
    semanticMasCmsRequirementBelongsToIssue(label, query, issue) ||
    semanticCpfCashTopUpReliefBelongsToIssue(label, query, issue) ||
    semanticMotorCarExceptionBelongsToIssue(label, query, issue) ||
    semanticPersonalTaxReliefLabelBelongsToCpfIssue(label, query, issue, semantic) ||
    semanticIrasRestrictionFollowOnBelongsToIssue(label, query, issue));
  return owners.length === 1 ? owners[0] : undefined;
}

function semanticIssueForCanonicalAlias(
  label: string,
  query: string,
  semantic: SemanticQuestionInterpretation | undefined,
  genericLabel: RegExp,
  isCanonicalOwner: (issue: SemanticQuestionIssue) => boolean,
  matchesIssueClause: (clause: string) => boolean,
  matchesGenericIssueClause: (clause: string) => boolean = matchesIssueClause
): SemanticQuestionIssue | undefined {
  if (!semantic?.issues?.length) return undefined;
  if (genericLabel.test(normalizeSemanticAnchorText(label))) {
    const candidates = semantic.issues.filter(issue => {
      if (!semanticIssueIsCompatibleWithRoot(issue, query, semantic)) return false;
      const clause = queryWithSemanticIssueFollowOns(query, issue.subject);
      return Boolean(clause && matchesGenericIssueClause(clause));
    });
    const owner = candidates.length === 1 ? candidates[0] : undefined;
    if (!owner || !isCanonicalOwner(owner)) return undefined;
    const clause = queryWithSemanticIssueFollowOns(query, owner.subject);
    return clause && matchesIssueClause(clause) ? owner : undefined;
  }

  const owner = semanticIssueForConceptLabel(label, query, semantic);
  if (!owner || !semanticIssueIsCompatibleWithRoot(owner, query, semantic) || !isCanonicalOwner(owner)) return undefined;
  const clause = queryWithSemanticIssueFollowOns(query, owner.subject);
  return clause && matchesIssueClause(clause) ? owner : undefined;
}

function isIrasGstPassengerMotorCarInputTaxIssue(issue: SemanticQuestionIssue): boolean {
  return issue.domain === 'IRAS_GST' && issue.population === 'COMPANY' &&
    issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'IRAS' &&
    /\b(?:(?:passenger\s+)?motor\s+car|passenger\s+car)\b/i.test(issue.subject) &&
    /\b(?:input\s+tax|input\s+gst|blocked|restriction)\b/i.test(issue.subject);
}

function semanticGstMotorCarAliasIsCovered(
  label: string,
  query: string,
  semantic: SemanticQuestionInterpretation | undefined,
  requiresExceptions: boolean
): boolean {
  const genericExceptionLabel = /^(?:(?:input tax|input gst|gst|motor car|passenger car|s plate) )?exceptions?$/;
  const genericBaseLabel = /^(?:(?:input tax|input gst|gst) )?(?:motor car|passenger car|s plate|blocked input tax|restriction)$/;
  const owner = semanticIssueForCanonicalAlias(label, query, semantic,
    requiresExceptions ? genericExceptionLabel : genericBaseLabel,
    isIrasGstPassengerMotorCarInputTaxIssue,
    clause => /\b(?:(?:passenger\s+)?motor\s+cars?|passenger\s+cars?)\b/i.test(clause) &&
      /\b(?:input\s+tax|input\s+gst|blocked|restriction)\b/i.test(clause) &&
      (!requiresExceptions || /\bexceptions?\b/i.test(clause)),
    requiresExceptions ? clause => /\bexceptions?\b/i.test(clause) : undefined);
  return owner !== undefined;
}

function isIrasIndividualCpfCashTopUpReliefIssue(issue: SemanticQuestionIssue): boolean {
  return issue.domain === 'IRAS_INCOME_TAX' && ['INDIVIDUAL', 'EMPLOYEE'].includes(issue.population) &&
    issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'IRAS' &&
    /\b(?:cpf|central\s+provident\s+fund)\b/i.test(issue.subject) &&
    /\bcash\s+top[ -]?ups?\b/i.test(issue.subject) && /\brelief\b/i.test(issue.subject);
}

function semanticCpfCashTopUpAliasIsCovered(
  label: string,
  query: string,
  semantic: SemanticQuestionInterpretation | undefined,
  qualifier: 'base' | 'eligibility' | 'limits'
): boolean {
  const genericLabel = qualifier === 'eligibility'
    ? /^(?:eligibility|eligibility conditions?|qualifying conditions?|conditions for eligibility)$/
    : qualifier === 'limits'
      ? /^(?:relief limits?|limits on relief|maximum relief|relief cap)$/
      : /(?!)/;
  const owner = semanticIssueForCanonicalAlias(label, query, semantic, genericLabel,
    isIrasIndividualCpfCashTopUpReliefIssue,
    clause => /\b(?:cpf|central\s+provident\s+fund)\b/i.test(clause) &&
      /\bcash\s+top[ -]?ups?\b/i.test(clause) &&
      /\b(?:tax\s+relief|personal\s+(?:income\s+)?tax\s+relief|personal\s+relief)\b/i.test(clause) &&
      (qualifier === 'base' || qualifier === 'eligibility'
        ? qualifier === 'base' || /\b(?:eligib\w*|qualif\w*|conditions?|criteria|requirements?|who\s+(?:can|may)|entitled)\b/i.test(clause)
        : /\b(?:limits?|maximum|caps?|up\s+to|how\s+much|amount\s+of\s+(?:the\s+)?(?:tax\s+)?relief)\b/i.test(clause)),
    qualifier === 'eligibility'
      ? clause => /\b(?:eligib\w*|qualif\w*|conditions?|criteria|requirements?|who\s+(?:can|may)|entitled)\b/i.test(clause)
      : qualifier === 'limits'
        ? clause => /\b(?:limits?|maximum|caps?|up\s+to|how\s+much|amount\s+of\s+(?:the\s+)?(?:tax\s+)?relief)\b/i.test(clause)
        : undefined);
  return owner !== undefined;
}

function isIrasCompanyTaxResidencyIssue(issue: SemanticQuestionIssue): boolean {
  return issue.domain === 'IRAS_INCOME_TAX' && issue.population === 'COMPANY' &&
    issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'IRAS' &&
    hasSemanticCompanyTaxResidencyAnchors(issue.subject);
}

function semanticCompanyResidencyIncorporationAliasIsCovered(
  label: string,
  query: string,
  semantic: SemanticQuestionInterpretation | undefined
): boolean {
  const owner = semanticIssueForCanonicalAlias(label, query, semantic,
    /^(?:place of incorporation|incorporation(?: alone)?|singapore incorporation)$/,
    isIrasCompanyTaxResidencyIssue,
    clause => /\bincorporat(?:ion|ed)\b/i.test(clause) &&
      /\b(?:alone|place|sufficient|enough|determin\w*|establish\w*|resident|residen(?:ce|cy)|requirements?|qualif\w*|criteria)\b/i.test(clause),
    clause => /\bincorporat(?:ion|ed)\b/i.test(clause) &&
      /\b(?:alone|place|sufficient|enough|determin\w*|establish\w*|resident|residen(?:ce|cy)|requirements?|qualif\w*|criteria)\b/i.test(clause));
  return owner !== undefined;
}

function semanticCompanyResidencyControlTestAliasIsCovered(
  label: string,
  query: string,
  semantic: SemanticQuestionInterpretation | undefined
): boolean {
  return semanticIssueForCanonicalAlias(label, query, semantic,
    /^control and management test$/,
    isIrasCompanyTaxResidencyIssue,
    clause => /\bcontrol and management\b/.test(normalizeSemanticAnchorText(clause)) ||
      hasSemanticCompanyTaxResidencyAnchors(clause)) !== undefined;
}

function separateExplicitConceptExplanation(label: string, query: string): boolean | undefined {
  const normalizedLabel = normalizeSemanticAnchorText(label);
  const escapedLabel = normalizedLabel.split(' ').map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const separateClauses = query.matchAll(/\b(?:separately|also)\b\s*[:,]?\s*([^.!?;]+)/gi);
  for (const match of separateClauses) {
    const clause = match[1] || '';
    const normalizedClause = normalizeSemanticAnchorText(clause);
    const explanationMatch = /\b(?:explain|describe|outline|summari[sz]e)\b/i.exec(clause);
    const explanationPrefix = explanationMatch ? clause.slice(0, explanationMatch.index) : '';
    if (new RegExp(`(?:^|\\s)${escapedLabel}(?:$|\\s)`, 'i').test(normalizedClause) && explanationMatch) {
      return !/\b(?:not|never|do\s+not|don['’]?t|no\s+need)\b/i.test(explanationPrefix);
    }
  }
  return undefined;
}

function semanticLabelIsOnlyPayrollContext(
  label: string,
  query: string,
  semantic: SemanticQuestionInterpretation | undefined
): boolean {
  const normalizedLabel = normalizeSemanticAnchorText(label);
  if (!semantic?.issues?.length) return false;
  const isMomCoverageDescriptor = ['working hours', 'overtime', 'working hours and overtime'].includes(normalizedLabel);
  const momCoverageOwners = isMomCoverageDescriptor ? semantic.issues.filter(issue =>
    issue.domain === 'MOM_EMPLOYMENT' && issue.population === 'EMPLOYEE' &&
    issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'MOM' &&
    /\bpart\s+iv\b/i.test(issue.subject) && /\b(?:coverage|covered)\b/i.test(issue.subject)) : [];
  const owner = semanticIssueForConceptLabel(label, query, semantic) ||
    (momCoverageOwners.length === 1 ? momCoverageOwners[0] : undefined);
  if (!owner || owner.governingAuthorities.length !== 1) return false;
  const localClause = queryWithSemanticIssueFollowOns(query, owner.subject) || (momCoverageOwners.length === 1
    ? queryClauses(query).find(clause => /\b(?:coverage|covered)\b/i.test(clause) &&
      /\bpart\s+iv\b[\s\S]{0,80}\bfor\s+working\s+hours?\s+and\s+overtime\b/i.test(clause))
    : undefined);
  if (!localClause) return false;
  const otherClauses = queryClauses(query).filter(clause => !localClause.includes(clause))
    .flatMap(clause => clause.split(/\.(?!\d)|\bbut\b/i))
    .map(clause => removeNegatedOutputDirectives(clause).trim())
    .filter(clause => clause && !/^(?:do\s+not|don['’]?t|never)\s+(?:calculate|compute|create|prepare)\b/i.test(clause));
  const positiveLocalClause = removeNegatedOutputDirectives(localClause);

  if (normalizedLabel === 'cpf contributions' && owner.domain === 'CPF_PAYROLL' &&
      ['EMPLOYER', 'EMPLOYEE'].includes(owner.population) && owner.governingAuthorities[0] === 'CPF' &&
      /\bordinary\s+wages?\b/i.test(owner.subject) &&
      /\bordinary\s+wages?\b[\s\S]{0,80}\bfor\s+(?:the\s+)?(?:cpf|central provident fund)\s+contributions?\b/i.test(localClause)) {
    const separateExplanation = separateExplicitConceptExplanation(label, query);
    const independentContributionAsk = separateExplanation === true || separateExplanation === undefined && ((
      /\b(?:cpf|central provident fund)\b/i.test(positiveLocalClause) &&
      /\b(?:rates?|amounts?|payable|remit\w*|obligations?|how much)\b|\b(?:must|should|when|how)\b.{0,40}\bpay\b/i.test(positiveLocalClause)) ||
      otherClauses.some(clause => /\b(?:cpf|central provident fund)\b/i.test(clause) &&
        /\b(?:contribut\w*|rates?|amounts?|pay(?:ment|able)?|remit\w*|obligations?)\b/i.test(clause) &&
        /\b(?:what|which|how|calculate|must|should|do|does|is|are|explain|describe|outline|summari[sz]e)\b/i.test(clause)));
    return !independentContributionAsk;
  }

  if (isMomCoverageDescriptor && owner.domain === 'MOM_EMPLOYMENT' &&
      owner.population === 'EMPLOYEE' && owner.governingAuthorities[0] === 'MOM' &&
      /\bpart\s+iv\b/i.test(owner.subject) && /\b(?:coverage|covered)\b/i.test(owner.subject) &&
      /\b(?:part\s+iv\b[\s\S]{0,100}\bcoverage|covered\s+(?:by|under)\s+part\s+iv)\b[\s\S]{0,100}\b(?:for\s+)?(?:working\s+hours?|overtime)\b/i.test(localClause) &&
      (normalizedLabel === 'overtime' || !/\bovertime\b/i.test(normalizedLabel) ||
        /\bworking\s+hours?\b[\s\S]{0,35}\bovertime\b/i.test(localClause))) {
    const separateExplanation = separateExplicitConceptExplanation(label, query);
    const independentHoursOrOvertimeAsk = separateExplanation === true || separateExplanation === undefined && (
      /\b(?:rates?|pay(?:ment|able)?|entitlement|rules?|eligib\w*|limits?|maximum|how\s+many\s+hours?)\b/i.test(positiveLocalClause) &&
        /\b(?:working\s+hours?|overtime)\b/i.test(positiveLocalClause) ||
      otherClauses.some(clause => /\b(?:working\s+hours?|overtime)\b/i.test(clause) &&
        (/\b(?:rates?|pay(?:ment|able)?|entitlement|rules?|eligib\w*|limits?|maximum|how\s+many\s+hours?)\b/i.test(clause) ||
          /\b(?:working\s+hours?\s+and\s+overtime|overtime)\b/i.test(clause) &&
            /\b(?:explain|describe|outline|summari[sz]e)\b/i.test(clause)) &&
        /\b(?:what|which|how|calculate|must|should|do|does|is|are|explain|describe|outline)\b/i.test(clause)));
    return !independentHoursOrOvertimeAsk;
  }
  return false;
}

function semanticIrasRestrictionAliasesCanonicalGst(
  label: string,
  query: string,
  semantic: SemanticQuestionInterpretation | undefined
): boolean {
  if (normalizeSemanticAnchorText(label) !== 'iras restriction') return false;
  const owner = semanticIssueForConceptLabel(label, query, semantic);
  if (!owner || !semantic || !semanticIssueIsCompatibleWithRoot(owner, query, semantic) ||
      !isIrasGstPassengerMotorCarInputTaxIssue(owner)) return false;
  const clause = queryWithSemanticIssueFollowOns(query, owner.subject);
  return Boolean(clause && /\b(?:(?:passenger\s+)?motor\s+cars?|passenger\s+cars?)\b/i.test(clause) &&
    /\b(?:input\s+tax|input\s+gst|blocked|restriction)\b/i.test(clause));
}

function semanticIssueIsCompatibleWithRoot(
  issue: SemanticQuestionIssue,
  query: string,
  semantic: SemanticQuestionInterpretation
): boolean {
  const issues = semantic.issues || [];
  if (issues.length <= 1) {
    if (semantic.domain !== 'UNKNOWN' && semantic.domain !== issue.domain) return false;
    if (semantic.population !== 'UNKNOWN' && semantic.population !== issue.population) return false;
  }
  if (!semantic.authorityCandidates.includes('UNKNOWN') &&
      !issue.governingAuthorities.some(authority => semantic.authorityCandidates.includes(authority))) return false;

  const issueAuthorities = new Set(issues.flatMap(item => item.governingAuthorities));
  for (const issueItem of issues) for (const authority of issueItem.contextualAuthorities) issueAuthorities.add(authority);
  const unexplainedRootAuthorities = semantic.authorityCandidates.filter(authority =>
    authority !== 'UNKNOWN' && !issueAuthorities.has(authority) && !semantic.contextualAuthorities.includes(authority));
  if (unexplainedRootAuthorities.length === 0) return true;
  if (unexplainedRootAuthorities.length !== 1 || unexplainedRootAuthorities[0] !== 'SSO' ||
      issue.domain !== 'MOM_EMPLOYMENT' || issue.population !== 'EMPLOYEE' ||
      issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'MOM' ||
      !semantic.authorityCandidates.includes('MOM') || issues.filter(item =>
        item.domain === 'MOM_EMPLOYMENT' && item.governingAuthorities.length === 1 && item.governingAuthorities[0] === 'MOM').length !== 1 ||
      issues.some(item => item.governingAuthorities.includes('SSO'))) return false;

  const ssoClauses = queryClauses(query).filter(clause =>
    /\b(?:sso|singapore\s+statutes\s+online)\b/i.test(clause));
  if (ssoClauses.length === 0) return true;
  const momClause = queryClauseForSemanticIssue(query, issue.subject);
  if (!momClause || ssoClauses.length !== 1 || ssoClauses[0] !== momClause) return false;
  const publisherOnlyReference = /\b(?:employment\s+act|part\s+iv)\b/i.test(momClause) &&
    (/\b(?:employment\s+act|part\s+iv)\b[\s\S]{0,90}\b(?:on|at|from|published\s+on|available\s+on)\s+(?:the\s+)?(?:singapore\s+statutes\s+online|sso)\b|\b(?:singapore\s+statutes\s+online|sso)\b[\s\S]{0,70}\b(?:publisher|published|official\s+text|statutory\s+text|source\s+for)\b/i.test(momClause));
  const asksForIndependentStatutoryContent = /\b(?:separately|also|compare|comparison|independently|other\s+(?:acts?|statutes?|regulations?|provisions?))\b/i.test(momClause) ||
    /\b(?:what|which|how|explain|describe|interpret|apply)\b[^.!?]{0,90}\b(?:statutory\s+provisions?|other\s+(?:acts?|statutes?|regulations?)|legal\s+requirements?)\b/i.test(momClause);
  return publisherOnlyReference && !asksForIndependentStatutoryContent;
}

function semanticOwnerScopeForConceptLabel(
  label: string,
  query: string,
  semantic: SemanticQuestionInterpretation | undefined
): Pick<SemanticQuestionIssue, 'domain' | 'population' | 'governingAuthorities'> | undefined {
  if (!semantic) return undefined;
  const issues = semantic.issues || [];
  if (issues.length === 0) {
    return {
      domain: semantic.domain,
      population: semantic.population,
      governingAuthorities: semantic.authorityCandidates
    };
  }
  const ownerIssue = semanticIssueForConceptLabel(label, query, semantic);
  if (ownerIssue && semanticIssueIsCompatibleWithRoot(ownerIssue, query, semantic)) return {
    domain: ownerIssue.domain,
    population: ownerIssue.population,
    governingAuthorities: ownerIssue.governingAuthorities
  };
  if (issues.length === 1) return {
    domain: semantic.domain,
    population: semantic.population,
    governingAuthorities: semantic.authorityCandidates
  };
  return undefined;
}

function genericClassEligibilityQuestion(query: string): boolean {
  return /\b(?:can|could|may|might|does|do)\s+(?:(?:any|all)\s+|an?\s+(?!named\b|specific\b|particular\b|given\b))[^?]{0,100}\b(?:employees?|companies|individuals?|persons?|people|claimants?|taxpayers?)\b[^?]{0,80}\b(?:claim|qualif\w*|eligib\w*)\b/i.test(query) ||
    /\b(?:who\s+(?:can|could|may|might)\s+claim|who\s+qualifies|what\s+are\s+(?:the\s+)?(?:conditions|criteria)\s+for)\b/i.test(query);
}

function issueRequiresUserSpecificFacts(
  query: string,
  operation: SemanticQuestionOperation,
  subject: string,
  alignToIssue = true
): boolean | undefined {
  if (CASE_FACTS_REQUIRED_OPERATIONS.has(operation)) return true;
  const issueQuery = alignToIssue ? queryWithSemanticIssueFollowOns(query, subject) : query;
  if (!issueQuery) return undefined;
  if (operation === 'EXPLAIN_RULE' && isBoundedCpfCashTopUpGeneralRuleQuery(issueQuery)) return false;
  const explicitApplication = hasExplicitCaseReference(issueQuery) || hasCaseLinkedCircumstances(issueQuery) ||
    hasFirstPersonOutcomeApplication(issueQuery);
  if (operation === 'EXPLAIN_RULE') {
    return explicitApplication && asksForCaseOutcome(issueQuery) ? true : false;
  }
  if (!explicitApplication && /\b(?:my|our)\b/i.test(issueQuery)) return undefined;
  if (explicitApplication) return true;
  if (operation === 'CHECK_ELIGIBILITY') {
    if (isClearlyGeneralRuleQuestion(issueQuery) || genericClassEligibilityQuestion(issueQuery)) return false;
    return undefined;
  }
  if (isClearlyGeneralRuleQuestion(issueQuery)) return false;
  if (operation === 'COMPARE' && /\bcompare\b/i.test(issueQuery)) return false;
  if (operation === 'EXPLAIN_INTERACTION' && /\b(?:interact\w*|overlap\w*|prioriti[sz]\w*|relationship\s+between)\b/i.test(issueQuery)) return false;
  if (operation === 'FILING_REQUIREMENT') {
    if (/\bgeneral\b/i.test(issueQuery)) return false;
    // A short filing clause such as “what procedure applies?” can refer back
    // to a concrete event in another clause. Keep that shared case context for
    // this issue only; an explicit general-rules clause remains source-only.
    const wholeQueryHasCaseContext = hasExplicitCaseReference(query) ||
      hasCaseLinkedCircumstances(query) || hasFirstPersonOutcomeApplication(query);
    if (wholeQueryHasCaseContext && /\bappl(?:y|ies)\b/i.test(issueQuery)) return true;
    if (
      /\b(?:what\s+are|explain|filing requirements?)\b/i.test(issueQuery) ||
      /\b(?:what|which)\b[^?]{0,100}\b(?:return|filing|file|submit|notification|report)\b/i.test(issueQuery)
    ) return false;
  }
  return undefined;
}

function deriveRequestedIssueSpecificity(
  query: string | undefined,
  issue: Pick<SemanticQuestionIssue, 'operation' | 'subject'>,
  alignToIssue = true
): boolean {
  if (CASE_FACTS_REQUIRED_OPERATIONS.has(issue.operation)) return true;
  if (query === undefined) return true;
  // Unknown intent is deliberately conservative. A provider hint or the root
  // OR flag must never turn an unresolved issue into source-only evidence.
  return issueRequiresUserSpecificFacts(query, issue.operation, issue.subject, alignToIssue) ?? true;
}

/** Specificity metadata is derived, so disagreement with a historical provider flag is not a contradiction. */
export function hasSemanticQueryContractContradiction(query: string, value: unknown): boolean {
  void query;
  return isRecord(value) && hasSemanticContractContradiction(value);
}

function validatedSemanticForQuery(query: string, understanding: SemanticQuestionUnderstanding): SemanticQuestionInterpretation | undefined {
  const wrapperIsValidated = (understanding.mode === 'SEMANTIC_INTERPRETATION' || understanding.mode === 'SEMANTIC_PLUS_RULES') &&
    understanding.failure === undefined;
  return wrapperIsValidated ? validateSemanticQuestionInterpretation(understanding.interpretation, query) : undefined;
}

function deterministicCaseFactGuard(
  query: string,
  classification: QuestionClassificationResult
): QuestionClassificationResult {
  if (!classification.authorities.includes('IRAS') ||
      !(hasExplicitCaseReference(query) || hasFirstPersonOutcomeApplication(query)) || !asksForCaseOutcome(query)) {
    return classification;
  }
  const guard = 'Facts about the specific taxpayer, claim, or transaction are needed to assess this application.';
  return { ...classification, missingFacts: [...new Set([...classification.missingFacts, guard])] };
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
    return validateSemanticQuestionInterpretation({ ...semantic, population: 'EMPLOYEE' }, query) || semantic;
  }
  if (semantic.domain !== 'IRAS_INCOME_TAX' || semantic.population !== 'UNKNOWN') return semantic;
  const describesEmploymentIncome = /\b(?:employment\s+income|employee\s+(?:income|earnings)|salary|wages?)\b/i.test(semanticSubject);
  const identifiesEmployeeRecipient = /\b(?:employees?|individuals?|persons?|tax\s+residents?|resident\s+individuals?)\b[^.!?]{0,180}\b(?:earn\w*|receive\w*|derive\w*|employment\s+income|salar(?:y|ies)|wages?|income|pay\w*\s+tax|taxed)\b/i.test(query) ||
    /\b(?:earn\w*|receive\w*|derive\w*)\b[^.!?]{0,180}\b(?:employment\s+income|salar(?:y|ies)|wages?)\b/i.test(query) ||
    /\b(?:salar(?:y|ies)|wages?|employment\s+income)\b[^.!?]{0,180}\b(?:taxed\s+twice|double\s+tax(?:ation)?|foreign\s+tax\s+credits?)\b/i.test(query);
  const hasTaxTreatyQuestion = /\b(?:income\s+tax|tax\s+treatment|taxable|double\s+tax(?:ation)?|tax\s+treaty|foreign\s+tax\s+credits?)\b/i.test(query);
  if (!describesEmploymentIncome || !identifiesEmployeeRecipient || !hasTaxTreatyQuestion) return semantic;
  return validateSemanticQuestionInterpretation({ ...semantic, population: 'EMPLOYEE' }, query) || semantic;
}

function explicitlyRequestsCpfPayrollOutcome(query: string): boolean {
  const requestBoundary = /\s+\b(?:and|or|but|also)\s+(?=(?:what|which|who|where|when|why|how|can|could|do|does|did|is|are|will|would|should|must|calculate|compute|work\s+out|determine|estimate|explain|tell|state|identify)\b)/i;
  const clauses = query.split(/[.!?;\n]+/).flatMap(sentence => sentence.split(requestBoundary))
    .map(clause => clause.trim()).filter(Boolean);
  return clauses.some(clause => {
    const cpf = String.raw`(?:cpf|central provident fund)`;
    const ask = String.raw`(?:what|which|how much|what amount|calculate|compute|work\s+out|determine|estimate|current|applicable)`;
    const rateMentionAsked = new RegExp(`\\b${ask}\\b[^,]{0,65}\\b${cpf}\\b[^,]{0,55}\\b(?:contribution\\s+)?rates?\\b|\\b${ask}\\b[^,]{0,65}\\b(?:contribution\\s+)?rates?\\b[^,]{0,55}\\b${cpf}\\b`, 'i').test(clause);
    const conceptualReliefInteraction = /\b(?:relationship|interact\w*|overlap\w*|interplay)\b/i.test(clause) &&
      /\b(?:cap|limit|threshold)\b/i.test(clause);
    const explicitApplicableOrCalculatedRate = /\b(?:current|applicable)\b[^,]{0,65}\b(?:cpf|central provident fund)\b[^,]{0,55}\b(?:contribution\s+)?rates?\b|\b(?:calculate|compute|work\s+out|determine|estimate)\b[^,]{0,65}\b(?:cpf|central provident fund)\b[^,]{0,55}\b(?:contribution\s+)?rates?\b/i.test(clause);
    const rateRequest = rateMentionAsked && (!conceptualReliefInteraction || explicitApplicableOrCalculatedRate);
    const payerOutcome = new RegExp(`\\b(?:employer|employee)\\b[^,]{0,70}\\b${cpf}\\b[^,]{0,45}\\b(?:contributions?|rates?|amounts?|payroll|obligations?|(?:must|should|will|needs? to|has to|have to)\\s+(?:pay|contribute|make))\\b|\\b(?:employer|employee)\\b[^,]{0,45}\\b(?:must|should|will|needs? to|has to|have to|pay|contribute|owe|calculate|compute|work\\s+out)\\b[^,]{0,65}\\b${cpf}\\b|\\b${cpf}\\b[^,]{0,45}\\b(?:employer|employee)\\b[^,]{0,45}\\b(?:contributions?|rates?|amounts?|payroll|obligations?|(?:must|should|will|needs? to|has to|have to)\\s+(?:pay|contribute|make))\\b`, 'i').test(clause);
    const directPayerContributionAsk = /\b(?:what|which|how much|calculate|compute|work\s+out|determine|estimate)\b[^,]{0,65}\b(?:employer|employee)\b[^,]{0,55}\b(?:must|should|will|needs? to|has to|have to)\s+(?:pay|contribute|make)\b[^,]{0,45}\b(?:cpf|central provident fund)\b|\b(?:employer|employee)\b[^,]{0,35}\b(?:must|should|will|needs? to|has to|have to)\s+(?:pay|contribute|make)\b[^,]{0,55}\b(?:cpf|central provident fund)\b|\b(?:calculate|compute|work\s+out|determine|estimate)\b[^,]{0,45}\b(?:employer|employee)\b[^,]{0,45}\b${cpf}[^,]{0,30}\bcontributions?\b/i.test(clause);
    const directFirstPersonCpfAmountAsk = /\b(?:how\s+much|what\s+amount)\b[^,;.!?]{0,40}\b(?:(?:do|must|should|will)\s+(?:i|we)|am\s+i|required\s+to)\s+(?:pay|contribute|owe)\b[^,;.!?]{0,45}\b(?:(?:into|to|for)\s+(?:the\s+)?)?(?:cpf|central provident fund)\b|\b(?:how\s+much|what\s+amount)\b[^,;.!?]{0,25}\b(?:cpf|central provident fund)\b[^,;.!?]{0,35}\b(?:do|must|should|will)\s+(?:i|we)\s+(?:pay|contribute|owe)\b|\bwhat\s+(?:cpf|central provident fund)\s+amount\b[^,;.!?]{0,30}\b(?:do|must|should|will)\s+(?:i|we)\s+owe\b/i.test(clause);
    const explicitCpfAmount = new RegExp(`\\b(?:how much|what amount|calculate|compute|work\\s+out|determine|estimate)\\b[^,]{0,70}\\b${cpf}\\b[^,]{0,45}\\b(?:contributions?|contribute|payroll|amount payable|amount due)\\b[^,]{0,35}\\b(?:due|payable|owe|owed|amount|rate|payroll)\\b|\\b(?:how much|what amount)\\b[^,]{0,70}\\b${cpf}\\b[^,]{0,45}\\bcontributions?\\s+(?:are\\s+)?(?:due|payable)\\b|\\b(?:how much|what amount|calculate|compute|work\\s+out|determine|estimate)\\b[^,]{0,70}\\b(?:contributions?|contribute|payroll|amount payable|amount due)\\b[^,]{0,45}\\b${cpf}\\b`, 'i').test(clause);
    const requestedContributionMandate = new RegExp(`\\b${cpf}\\b[^.!?]{0,45}\\bcontributions?\\b[^.!?]{0,45}\\b(?:must|should|will|need\\s+to|has\\s+to|have\\s+to)\\b[^.!?]{0,45}\\b(?:make|pay|contribute)\\b`, 'i').test(clause);
    const explicitReliefRequest = /\b(?:personal|individual|income\s+tax)\s+(?:tax\s+)?relief\b|\brelief\s+(?:claim|amount|cap)\b/i.test(clause);
    const explicitContributionObligation = new RegExp(`\\b${cpf}\\b[^,]{0,40}\\bcontributions?\\b[^,]{0,35}\\b(?:due|payable|owe|owed|payroll)\\b`, 'i').test(clause);
    const explicitPayrollAskCue = /^\s*(?:what|which|who|how much|what amount|does|do|did|is|are|will|would|should|must|can|could|calculate|compute|work\s+out|determine|estimate|explain|tell|state|identify|check|find\s+out)\b/i.test(clause);
    return rateRequest || directPayerContributionAsk || directFirstPersonCpfAmountAsk ||
      explicitPayrollAskCue && !conceptualReliefInteraction && (payerOutcome || requestedContributionMandate) ||
      (explicitContributionObligation || !explicitReliefRequest) && explicitCpfAmount;
  });
}

function isContextualCpfInPersonalReliefQuestion(query: string, semantic: SemanticQuestionInterpretation): boolean {
  return semantic.domain === 'IRAS_INCOME_TAX' &&
    (semantic.population === 'INDIVIDUAL' || semantic.population === 'EMPLOYEE') &&
    /\b(?:personal\s+(?:income\s+)?tax(?:\s+relief)?|income\s+tax\s+relief|personal\s+relief|relief\s+cap|tax\s+relief\s+cap|cash\s+top[ -]?ups?)\b/i.test(query) &&
    /\b(?:cpf|central provident fund)\b/i.test(query) &&
    !explicitlyRequestsCpfPayrollOutcome(query);
}

function isMappedIndividualCpfReliefIssue(issue: SemanticQuestionIssue, mappedTopicIds: readonly string[]): boolean {
  return issue.domain === 'IRAS_INCOME_TAX' &&
    (issue.population === 'INDIVIDUAL' || issue.population === 'EMPLOYEE') &&
    issue.governingAuthorities.includes('IRAS') &&
    mappedTopicIds.includes('iras-individual-cpf-relief');
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

function explicitCpfCashTopUpReliefClauses(query: string): Array<{ clause: string; index: number; scoped: string }> {
  const clauses = queryClauses(query);
  return clauses.flatMap((clause, index) => {
    if (!/\b(?:cpf|central\s+provident\s+fund)\b/i.test(clause) ||
        !/\bcash\s+top[ -]?ups?\b/i.test(clause) ||
        !/\b(?:tax\s+relief|personal\s+(?:income\s+)?tax\s+relief|personal\s+relief|qualif\w*\s+for\s+(?:tax\s+)?relief)\b/i.test(clause)) return [];
    return [{ clause, index, scoped: semanticIssueClauseWithFollowOns(query, clauses, index, 'CPF cash top-up tax relief eligibility and limits') }];
  });
}

function requestedCpfCashTopUpReliefQualifiers(query: string): { eligibility: boolean; limits: boolean } {
  const requests = explicitCpfCashTopUpReliefClauses(query);
  if (!requests.length) return { eligibility: false, limits: false };
  const independentTopic = /\b(?:gst|goods\s+and\s+services\s+tax|acra|annual\s+returns?|mas|mom|employment\s+act|motor\s+cars?|srs|parent\s+relief|company\s+tax\s+residen(?:ce|cy|t))\b/i;
  const eligibility = requests.some(({ scoped }) =>
    /\b(?:eligib\w*|qualif\w*|conditions?|criteria|requirements?|who\s+(?:can|may)|entitled)\b/i.test(scoped) &&
    !independentTopic.test(scoped));
  const limits = requests.some(({ scoped }) =>
    /\b(?:limits?|maximum|caps?|up\s+to|how\s+much|amount\s+of\s+(?:the\s+)?(?:tax\s+)?relief)\b/i.test(scoped) &&
    !independentTopic.test(scoped));
  return { eligibility, limits };
}

function semanticCpfCashTopUpReliefBelongsToIssue(
  label: string,
  query: string,
  issue: SemanticQuestionIssue
): boolean {
  if (!/\b(?:cpf|cash\s+top[ -]?up)\b/i.test(label) || !/\brelief\b/i.test(label) ||
      !/\b(?:cpf|central\s+provident\s+fund)\b/i.test(issue.subject) ||
      !/\bcash\s+top[ -]?ups?\b/i.test(issue.subject) || !/\brelief\b/i.test(issue.subject) ||
      !['IRAS_INCOME_TAX', 'CPF_PAYROLL'].includes(issue.domain) ||
      !issue.governingAuthorities.some(authority => authority === 'IRAS' || authority === 'CPF')) return false;
  const localQuery = queryWithSemanticIssueFollowOns(query, issue.subject);
  return Boolean(localQuery && /\b(?:cpf|central\s+provident\s+fund)\b/i.test(localQuery) &&
    /\bcash\s+top[ -]?ups?\b/i.test(localQuery) &&
    /\b(?:tax\s+relief|personal\s+(?:income\s+)?tax\s+relief|personal\s+relief)\b/i.test(localQuery));
}

function semanticMotorCarExceptionBelongsToIssue(
  label: string,
  query: string,
  issue: SemanticQuestionIssue
): boolean {
  if (!/\b(?:passenger\s+)?motor\s+car\b/i.test(label) || !/\bexception/i.test(label) ||
      issue.domain !== 'IRAS_GST' || issue.governingAuthorities.length !== 1 ||
      issue.governingAuthorities[0] !== 'IRAS' ||
      !/\b(?:passenger\s+)?motor\s+car\b/i.test(issue.subject) ||
      !/\b(?:input\s+tax|input\s+gst|blocked|restriction)\b/i.test(issue.subject)) return false;
  const localQuery = queryWithSemanticIssueFollowOns(query, issue.subject);
  return Boolean(localQuery && /\b(?:passenger\s+)?motor\s+car\b/i.test(localQuery) &&
    /\b(?:input\s+tax|input\s+gst|blocked|restriction)\b/i.test(localQuery) &&
    /\bexceptions?\b/i.test(localQuery));
}

function queryExplicitlyRequestsMotorCarInputTaxExceptions(query: string): boolean {
  const clauses = queryClauses(query);
  const vehicleRestrictionClauses = clauses.filter(clause =>
    /\b(?:passenger\s+)?motor\s+cars?\b/i.test(clause) &&
    /\b(?:gst|goods\s+and\s+services\s+tax|input\s+tax|input\s+gst|restriction|blocked|claim|recover)\b/i.test(clause));
  if (vehicleRestrictionClauses.length === 0) return false;
  if (vehicleRestrictionClauses.some(clause => /\bexceptions?\b/i.test(clause))) return true;
  return vehicleRestrictionClauses.some(baseClause => {
    const baseIndex = clauses.indexOf(baseClause);
    const nextClause = clauses[baseIndex + 1];
    if (!nextClause || !/\bexceptions?\b/i.test(nextClause)) return false;
    const baseEnd = query.indexOf(baseClause) + baseClause.length;
    const nextStart = query.indexOf(nextClause, baseEnd);
    const bridge = query.slice(baseEnd, nextStart < 0 ? baseEnd : nextStart);
    return /\band\b/i.test(bridge) && !/\b(?:separately|also|however|whereas|independently)\b/i.test(bridge);
  });
}

function semanticIssueScopeMetadata(
  label: string,
  query: string,
  semantic?: SemanticQuestionInterpretation
): Pick<RequestedQuestionConcept, 'semanticDomain' | 'semanticPopulation' | 'semanticAuthorities'> | undefined {
  const issue = semanticIssueForConceptLabel(label, query, semantic);
  if (!issue || !semanticIssueIsCompatibleWithRoot(issue, query, semantic!)) return undefined;
  return {
    semanticDomain: issue.domain,
    semanticPopulation: issue.population,
    semanticAuthorities: issue.governingAuthorities
  };
}

function canonicalRequestedConcepts(query: string, semantic?: SemanticQuestionInterpretation): RequestedQuestionConcept[] {
  const semanticLabels = semantic?.concepts.filter(item => item.role !== 'CONTEXT_ONLY').map(item => item.concept) || [];
  const text = `${query} ${semantic?.primarySubject || ''} ${semanticLabels.join(' ')}`.toLowerCase();
  const concepts: RequestedQuestionConcept[] = [];
  const add = (id: string, label: string, terms: string[], topicIds: string[], metadata?: Pick<RequestedQuestionConcept,
    'role' | 'semanticDomain' | 'semanticPopulation' | 'semanticAuthorities'>) => {
    if (!concepts.some(item => item.id === id)) concepts.push({ id, label, terms, topicIds, ...(metadata || {}) });
  };
  const acraCompanySemanticScope = Boolean(semantic && (
    semantic.domain === 'ACRA_CORPORATE' && semantic.population === 'COMPANY' && semantic.authorityCandidates.includes('ACRA') ||
    semantic.issues?.some(issue => issue.domain === 'ACRA_CORPORATE' && issue.population === 'COMPANY' &&
      issue.governingAuthorities.includes('ACRA') && issue.mappedTopicIds.includes('acra_annual-returns'))
  ));
  const acraAnnualReturnScope = semantic
    ? acraCompanySemanticScope
    : /\b(?:acra|compan(?:y|ies))\b/i.test(query) && !/\b(?:income tax|tax returns?|gst)\b/i.test(query);
  const acraCompanyFacts = acraCompanySemanticScope && isAcraAnnualReturnDeadlineQuestion(query)
    ? identifyAcraAnnualReturnCompanyFacts(query)
    : undefined;
  if (acraAnnualReturnScope && isAcraAnnualReturnDeadlineQuestion(query)) {
    const topicIds = ['acra_annual-returns'];
    add('acra_annual_return_filing_deadline', 'Annual return filing deadline',
      ['filing deadline', 'annual return deadline', 'due date'], topicIds);
    if (/\b(?:financial\s+year\s+(?:end(?:ing)?|ended|ends?)|fye)\b/i.test(query)) {
      add('acra_annual_return_financial_year_end', 'Annual return deadline after financial year end',
        ['financial year end', 'FYE'], topicIds);
    }
    if (/\b(?:listed|non[\s-]?listed|unlisted)\s+(?:singapore\s+)?compan(?:y|ies)\b/i.test(query)) {
      add('acra_annual_return_listing_status', 'Annual return deadline by company listing status',
        ['listed companies', 'non-listed companies'], topicIds);
    }
    if (/\boverseas\s+branch\s+register\b/i.test(query)) {
      add('acra_annual_return_branch_register_qualification', 'Overseas branch register qualification for annual return deadlines',
        ['overseas branch register'], topicIds);
    }
  }
  const blockedPassengerCarInputTaxQuestion =
    /\b(?:passenger\s+(?:motor\s+)?car|s-plate)\b/i.test(text) &&
    /\b(?:gst|goods\s+and\s+services\s+tax|input\s+tax|input\s+gst)\b/i.test(text) &&
    /\b(?:claim\w*|recover\w*|blocked|restriction|exception\w*)\b/i.test(text);
  if (blockedPassengerCarInputTaxQuestion) {
    add('gst_blocked_motor_car_input_tax', 'Blocked input tax on passenger motor cars',
      ['passenger motor car input tax restriction', 'blocked motor-car input tax'],
      ['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'],
      semanticIssueScopeMetadata('Blocked input tax on passenger motor cars', query, semantic));
    const motorCarExceptionRequested = queryExplicitlyRequestsMotorCarInputTaxExceptions(query);
    if (motorCarExceptionRequested) {
      add('gst_motor_car_input_tax_exceptions', 'Passenger motor car input-tax exceptions',
        ['motor-car input-tax exceptions', 'exceptions to blocked passenger motor car input tax',
          'Regulations 26 and 27'],
        ['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'],
        semanticIssueScopeMetadata('Passenger motor car input-tax exceptions', query, semantic));
    }
  }
  const personalReliefContext = /\b(?:personal|individual)\s+(?:income\s+)?tax\s+relief\b|\bpersonal\s+relief\b/i.test(text) ||
    /\b(?:srs|cpf)\b/i.test(text) && /\b(?:relief|tax\s+cap|relief\s+cap)\b/i.test(text);
  const asksReliefCap = personalReliefContext && /\b(?:relief\s+cap|cap\s+of\s+(?:sgd\s*)?\$?\s*80,?000|overall\s+(?:personal\s+)?(?:income\s+tax\s+)?relief|aggregate\s+(?:personal\s+)?(?:income\s+tax\s+)?relief|total\s+(?:personal\s+)?relief\s+limit)\b/i.test(text);
  if (asksReliefCap) add('personal_income_tax_relief_cap', 'Overall personal income tax relief cap',
    ['personal income tax relief cap', 'overall relief cap', 'aggregate relief cap', '80,000 relief cap'], ['iras-individual-relief-cap']);
  const cpfCashTopUpRelief = explicitCpfCashTopUpReliefClauses(query).length > 0;
  const cashTopUpReliefQualifiers = requestedCpfCashTopUpReliefQualifiers(query);
  const explicitCompulsoryCpfRelief = /\b(?:mandatory|compulsory)\b[^.!?]{0,80}\b(?:cpf|central provident fund)\b|\b(?:cpf|central provident fund)\b[^.!?]{0,80}\b(?:mandatory|compulsory)\b/i.test(text);
  if (cpfCashTopUpRelief) {
    add('cpf_cash_top_up_relief', 'CPF cash top-up tax relief',
      ['CPF cash top-up relief', 'cash top-up relief', 'cash top ups to CPF Special or Retirement Account'],
      ['iras-individual-cpf-cash-top-up-relief'],
      semanticIssueScopeMetadata('CPF cash top-up tax relief', query, semantic));
    if (cashTopUpReliefQualifiers.eligibility) {
      add('cpf_cash_top_up_relief_eligibility', 'Eligibility for CPF cash top-up tax relief',
        ['CPF cash top-up relief eligibility', 'qualifying CPF cash top-ups', 'eligibility conditions for cash top-up relief'],
        ['iras-individual-cpf-cash-top-up-relief'],
        semanticIssueScopeMetadata('CPF cash top-up relief eligibility', query, semantic));
    }
    if (cashTopUpReliefQualifiers.limits) {
      add('cpf_cash_top_up_relief_limits', 'Limits on CPF cash top-up tax relief',
        ['CPF cash top-up relief limits', 'maximum CPF cash top-up tax relief', 'cash top-up relief cap'],
        ['iras-individual-cpf-cash-top-up-relief'],
        semanticIssueScopeMetadata('CPF cash top-up relief limits', query, semantic));
    }
  }
  if (personalReliefContext && (!cpfCashTopUpRelief || explicitCompulsoryCpfRelief) &&
      /\b(?:cpf|central provident fund|mandatory cpf contributions?|compulsory cpf contributions?)\b/i.test(text)) {
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
  const hasSingleCompanyIncomeTaxIssue = semantic?.domain === 'IRAS_INCOME_TAX' && semantic.population === 'COMPANY' &&
    (!semantic.issues || semantic.issues.length === 1 && semantic.issues[0].domain === 'IRAS_INCOME_TAX' &&
      semantic.issues[0].population === 'COMPANY' && semantic.issues[0].governingAuthorities.includes('IRAS'));
  const hasForeignDividendReceiptDirection =
    /\b(?:received|receiving|receipt)\b[^.!?]{0,70}\bdividends?\b/i.test(query) ||
    /\bdividends?\b[^.!?]{0,70}\b(?:received|receiving|receipt)\b/i.test(query);
  const hasForeignOriginInQuestion =
    /\b(?:foreign(?:[\s-]+sourced)?|overseas)\s+dividends?\b/i.test(query) ||
    /\bSingapore company\b.{0,65}\breceiv\w*\b.{0,60}\bdividends?\b.{0,80}\bThai subsidiary\b/i.test(query);
  const asksGeneralForeignDividendReceiptTreatment = hasSingleCompanyIncomeTaxIssue &&
    hasForeignDividendReceiptDirection && hasForeignOriginInQuestion &&
    /\b(?:treatment|taxable|tax|income tax)\b/i.test(query) &&
    /\b(?:foreign(?:[\s-]+sourced)?|overseas)\s+dividends?\b/i.test(text) &&
    !/\b(?:exempt(?:ions?|ed|ing)?|tax[\s-]free|underlying tax|qualif\w+)\b/i.test(query) &&
    !/\band\s+(?:also\s+)?(?:explain|determine|assess|calculate|compute|prepare|what|how|whether)\b/i.test(query) &&
    !/\bcompany\b[^.!?]{0,70}\b(?:paid|distributed)\b[^.!?]{0,50}\bdividends?\b/i.test(query);
  if (asksGeneralForeignDividendReceiptTreatment) {
    add('foreign_dividend_receipt_tax_treatment', 'Tax treatment of foreign dividend receipt',
      ['foreign dividend receipt', 'foreign-sourced income', 'dividend received in Singapore'], ['iras-foreign-sourced-income']);
  }
  const residencyBindings = semantic ? companyResidencyGeneralRuleBindings(query, semantic) : [];
  const generalCompanyTaxResidencyRequest = semantic && (semantic.issues?.length
    ? residencyBindings.length > 0
    : semantic.domain === 'IRAS_INCOME_TAX' && semantic.population === 'COMPANY' &&
      semantic.authorityCandidates.includes('IRAS') && isGeneralCompanyTaxResidencyRuleQuestion(query) &&
      hasSemanticCompanyTaxResidencyAnchors(semantic.primarySubject));
  if (generalCompanyTaxResidencyRequest) {
    add('company_tax_residency_rule', 'Company tax residency rule',
      ['tax resident in Singapore', 'control and management'], ['iras-corporate-tax-residency'],
      residencyBindings.length === 1
        ? semanticIssueScopeMetadata('Company tax residency rule', query, semantic)
        : undefined);
    const incorporationQualificationRequested = /\bincorporat(?:ion|ed)\b[^.!?]{0,100}\b(?:alone|sufficient|enough|place|determin\w*|establish\w*|resident|residen(?:ce|cy))\b|\b(?:alone|sufficient|enough)\b[^.!?]{0,100}\bincorporat(?:ion|ed)\b/i.test(query) &&
      /\b(?:company|corporate)\b[^.!?]{0,120}\b(?:tax\s+)?residen(?:ce|cy|t)\b/i.test(query) ||
      /\b(?:company|corporate)\b[^.!?]{0,90}\b(?:tax\s+)?residen(?:ce|cy|t)\b[^.!?]{0,100}\bincorporat(?:ion|ed)\b/i.test(query) &&
      /\b(?:alone|sufficient|enough|place|determin\w*|establish\w*)\b/i.test(query);
    if (incorporationQualificationRequested) {
      add('company_tax_residency_incorporation', 'Company tax residency and incorporation',
        ['incorporation alone', 'place of incorporation', 'Singapore incorporation'], ['iras-corporate-tax-residency'],
        residencyBindings.length === 1
          ? semanticIssueScopeMetadata('Company tax residency based on incorporation alone', query, semantic)
          : undefined);
    }
  }
  const cmsDefinitionClauses = queryClauses(query).filter(clause =>
    /\b(?:cms|capital\s+markets\s+services)\b/i.test(clause) &&
    (/\b(?:define|definition|meaning)\b/i.test(clause) ||
      /\bwhat\s+is\s+(?:a\s+|an\s+|the\s+)?(?:cms|capital\s+markets\s+services)\s+licen[cs]e\b/i.test(clause)) &&
    /\blicen[cs]e\b/i.test(clause));
  const locallyScopedMasDefinitionIssues = semantic
    ? (semantic.issues || []).filter(issue =>
      issue.domain === 'MAS_FUNDS' && issue.operation === 'EXPLAIN_RULE' &&
      issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'MAS' &&
      /\b(?:cms|capital\s+markets\s+services)\b/i.test(issue.subject) &&
      cmsDefinitionClauses.includes(queryClauseForSemanticIssue(query, issue.subject) || '') &&
      semanticIssueIsCompatibleWithRoot(issue, query, semantic))
    : [];
  const masIssueEstablished = semantic?.issues?.length
    ? locallyScopedMasDefinitionIssues.length === 1
    : semantic?.domain === 'MAS_FUNDS' && ['COMPANY', 'UNKNOWN'].includes(semantic.population) &&
      semantic.authorityCandidates.includes('MAS') && semantic.requestedOperation === 'EXPLAIN_RULE';
  const cmsDefinitionRequested = cmsDefinitionClauses.length > 0;
  if (masIssueEstablished && cmsDefinitionRequested) {
    add('mas_cms_licence_definition', 'Capital Markets Services Licence definition',
      ['Capital Markets Services Licence definition', 'CMS licence definition', 'SFA section 2(1)'], ['mas-cms-licence'],
      locallyScopedMasDefinitionIssues.length === 1
        ? semanticIssueScopeMetadata('Capital Markets Services Licence definition', query, semantic)
        : undefined);
  }
  // Semantic labels are retrieval aids. Keep them in the requested-concept
  // diagnostic and discovery list, while evidence checks still require their
  // meaning to occur in an admitted official source's text.
  for (const label of semanticLabels) {
    const semanticConcept = semantic?.concepts.find(item => item.concept === label);
    if (semanticConcept?.role === 'CONTEXT_ONLY') continue;
    const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (normalized.length < 5 || semanticLabelIsCoveredByCanonicalSubstring(label, normalized, concepts, query, semantic)) continue;
    const hasCanonical = (id: string) => concepts.some(concept => concept.id === id);
    const datedFyeLabel = normalized.match(/^(?:financial year (?:end(?:ing)?|ended|ends?)(?: date)?|fye) (?:on )?(\d{1,2}) (\d{1,2}) (20\d{2})$/);
    const datedFyeMatchesQuery = Boolean(datedFyeLabel && acraCompanyFacts?.financialYearEnd ===
      `${datedFyeLabel[3]}-${datedFyeLabel[2].padStart(2, '0')}-${datedFyeLabel[1].padStart(2, '0')}`);
    const singaporeIncorporatedListingLabel = normalized.match(/^singapore incorporated (non listed|unlisted|listed) compan(?:y|ies)$/);
    const listingLabelMatchesQuery = Boolean(singaporeIncorporatedListingLabel &&
      /\bsingapore[\s-]+incorporated\b/i.test(query) && acraCompanyFacts?.listingStatus ===
        (singaporeIncorporatedListingLabel[1] === 'listed' ? 'LISTED' : 'NON_LISTED'));
    const coveredAcraDeadlineQualifier = acraCompanySemanticScope && isAcraAnnualReturnDeadlineQuestion(query) && (
      hasCanonical('acra_annual_return_filing_deadline') &&
        /^(?:(?:annual return) )?(?:filing )?(?:deadline|due date)$/.test(normalized) ||
      hasCanonical('acra_annual_return_financial_year_end') && (
        /^(?:fye|financial year end|financial year end fye|financial year end date)$/.test(normalized) || datedFyeMatchesQuery
      ) ||
      hasCanonical('acra_annual_return_listing_status') && (
        /^(?:(?:listed|non listed|unlisted) (?:singapore )?compan(?:y|ies)|(?:company )?listing status)$/.test(normalized) ||
        listingLabelMatchesQuery
      ) ||
      hasCanonical('acra_annual_return_branch_register_qualification') && /^overseas branch register(?: qualification)?$/.test(normalized)
    );
    if (coveredAcraDeadlineQualifier) continue;
    const personalCpfReliefAliasOwner = hasCanonical('cpf_relief') && normalized === 'personal tax relief' &&
      semanticConcept?.role === 'PRIMARY'
      ? semanticIssueForConceptLabel(label, query, semantic)
      : undefined;
    const personalCpfReliefAliasIsCovered = personalCpfReliefAliasOwner !== undefined &&
      isMappedIndividualCpfReliefIssue(personalCpfReliefAliasOwner,
        independentlyMappedIssueTopicIds(query, personalCpfReliefAliasOwner, semantic?.issues?.length || 1));
    const isAlreadyCoveredCanonicalConcept =
      hasCanonical('foreign_dividend_receipt_tax_treatment') && normalized === 'tax exemption for foreign sourced income' ||
      hasCanonical('cpf_relief') && /\b(?:cpf|central provident fund)\b/.test(normalized) && /\b(?:reliefs?|contributions?)\b/.test(normalized) ||
      personalCpfReliefAliasIsCovered ||
      hasCanonical('srs_relief') && /\b(?:srs|supplementary retirement scheme)\b/.test(normalized) && /\breliefs?\b/.test(normalized) ||
      ['parent_relief', 'grandparent_caregiver_relief', 'working_mother_child_relief', 'qualifying_child_relief'].some(hasCanonical) &&
        /\b(?:parenthood|parent|caregiver|family|working mother|wmcr|qualifying child|qcr)\b/.test(normalized) && /\breliefs?\b/.test(normalized) ||
      hasCanonical('personal_income_tax_relief_cap') && /\b(?:personal|individual)\b/.test(normalized) && /\breliefs?\b/.test(normalized) && /\b(?:cap|limit|ceiling)\b/.test(normalized) ||
      hasCanonical('employee_benefit_tax_treatment') && (
        hasCanonical('employee_reimbursement_tax_treatment') && /\breimbursements?\b/.test(normalized) ||
        hasCanonical('employee_housing_benefit_tax_treatment') && /\b(?:housing|accommodation|rent)\b/.test(normalized) ||
        hasCanonical('employee_personal_insurance_tax_treatment') && /\b(?:personal insurance|insurance premiums?)\b/.test(normalized) ||
        /\b(?:benefits? in kind|perquisites?|employment benefits?)\b/.test(normalized)
      ) ||
      hasCanonical('company_tax_residency_rule') && (
        /^(?:(?:company|corporate)\s+)?(?:tax\s+)?residen(?:ce|cy|t)(?:\s+determination)?$/.test(normalized) ||
        normalized === 'control and management' ||
        normalized === 'control and management test' &&
          semanticCompanyResidencyControlTestAliasIsCovered(label, query, semantic)
      ) ||
      hasCanonical('company_tax_residency_incorporation') &&
        semanticLabelMatchesCanonicalFamilyVocabulary(label, concepts,
          ['company_tax_residency_incorporation']) &&
        /\bincorporat(?:ion|ed)\b/.test(normalized) && /\b(?:alone|place|sufficient|enough|resident|residen(?:ce|cy))\b/.test(normalized) &&
        semanticCompanyResidencyIncorporationAliasIsCovered(label, query, semantic) ||
      hasCanonical('gst_blocked_motor_car_input_tax') &&
        semanticLabelMatchesCanonicalFamilyVocabulary(label, concepts,
          SCOPED_CANONICAL_ALIAS_FAMILIES[0].ids, SCOPED_CANONICAL_ALIAS_FAMILIES[0].recognizedAliases) &&
        (semanticGstMotorCarAliasIsCovered(label, query, semantic, false) ||
          semanticIrasRestrictionAliasesCanonicalGst(label, query, semantic)) ||
      hasCanonical('cpf_cash_top_up_relief_eligibility') &&
        hasCanonical('cpf_cash_top_up_relief') &&
        semanticLabelMatchesCanonicalFamilyVocabulary(label, concepts,
          SCOPED_CANONICAL_ALIAS_FAMILIES[1].ids, SCOPED_CANONICAL_ALIAS_FAMILIES[1].recognizedAliases) &&
        (/(?:\b(?:cpf|cash top ups?)\b[\s\S]*\b(?:eligib\w*|qualif\w*|conditions?|criteria|requirements?)\b|^(?:eligibility|eligibility conditions?|qualifying conditions?|conditions for eligibility)$)/.test(normalized) &&
          semanticCpfCashTopUpAliasIsCovered(label, query, semantic, 'eligibility')) ||
      hasCanonical('cpf_cash_top_up_relief') &&
        semanticLabelMatchesCanonicalFamilyVocabulary(label, concepts,
          SCOPED_CANONICAL_ALIAS_FAMILIES[1].ids, SCOPED_CANONICAL_ALIAS_FAMILIES[1].recognizedAliases) &&
        /\b(?:cpf|central provident fund)\b/.test(normalized) && /\bcash top ups?\b/.test(normalized) && /\breliefs?\b/.test(normalized) &&
        semanticCpfCashTopUpAliasIsCovered(label, query, semantic, 'base') ||
      hasCanonical('cpf_cash_top_up_relief_limits') &&
        hasCanonical('cpf_cash_top_up_relief') &&
        semanticLabelMatchesCanonicalFamilyVocabulary(label, concepts,
          SCOPED_CANONICAL_ALIAS_FAMILIES[1].ids, SCOPED_CANONICAL_ALIAS_FAMILIES[1].recognizedAliases) &&
        (/(?:\b(?:cpf|cash top ups?)\b[\s\S]*\b(?:limits?|maximum|caps?|up to)\b|^(?:relief limits?|limits on relief|maximum relief|relief cap)$)/.test(normalized) &&
          semanticCpfCashTopUpAliasIsCovered(label, query, semantic, 'limits')) ||
      hasCanonical('gst_motor_car_input_tax_exceptions') &&
        semanticLabelMatchesCanonicalFamilyVocabulary(label, concepts,
          SCOPED_CANONICAL_ALIAS_FAMILIES[0].ids, SCOPED_CANONICAL_ALIAS_FAMILIES[0].recognizedAliases) &&
        semanticGstMotorCarAliasIsCovered(label, query, semantic, true);
    if (isAlreadyCoveredCanonicalConcept) continue;
    const gstRegistrationIsStatusContext = normalized === 'gst registration' &&
      /\b(?:gst|goods\s+and\s+services\s+tax)[-\s]+registered\s+company\b/i.test(query) &&
      !/\b(?:gst\s+registration|register(?:ed)?\s+for\s+gst)\b[^.!?]{0,80}\b(?:requirements?|rules?|obligations?|how|what|when|must|should)\b/i.test(query);
    if (gstRegistrationIsStatusContext) continue;
    if (semanticLabelIsOnlyPayrollContext(label, query, semantic)) continue;
    const ownerScope = semanticOwnerScopeForConceptLabel(label, query, semantic);
    const ownerDomain = ownerScope ? toRegistryDomain(ownerScope.domain, ownerScope.population) : undefined;
    const mappedTopics = ownerScope && ownerDomain
      ? defaultQueryTopicResolver.decomposeQuery(label).topics
        .filter(topic => topic.domainId.startsWith('IRAS_') && topic.domainId === ownerDomain)
        .map(topic => topic.id)
      : [];
    const id = `semantic_${normalized.replace(/\s+/g, '_').slice(0, 48)}`;
    add(id, label, [label], mappedTopics, semantic ? {
      ...(semanticConcept ? { role: semanticConcept.role } : {}),
      ...(ownerScope ? {
        semanticDomain: ownerScope.domain,
        semanticPopulation: ownerScope.population,
        semanticAuthorities: ownerScope.governingAuthorities
      } : {})
    } : undefined);
  }
  return concepts;
}

/** Concepts derived from the complete query plus validated intent labels; never evidence by themselves. */
export function getRequestedQuestionConcepts(query: string, understanding?: SemanticQuestionUnderstanding | SemanticQuestionInterpretation): RequestedQuestionConcept[] {
  const semantic = validateSemanticQuestionInterpretation(
    understanding && 'interpretation' in understanding ? understanding.interpretation : understanding,
    query
  );
  return canonicalRequestedConcepts(query, semantic);
}

/** Query terms used only to rank/fetch scoped evidence; user facts and evidence gates keep the original question. */
export function buildSemanticDiscoveryQuery(query: string, interpretation?: SemanticQuestionInterpretation): string {
  const semantic = validateSemanticQuestionInterpretation(interpretation, query);
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

/** Narrow lexical intent check for retaining a rule-only accounting gap after semantic transport failure. */
export function isConservativeUnmappedAccountingRuleExplanationIntent(query: string): boolean {
  const standardReferences = [...query.matchAll(/\b(?:SFRS\s*\(\s*I\s*\)|IFRS|IAS)\s*(?:No\.?\s*)?\d+(?:[-.]\d+)*[A-Z]?\b/gi)]
    .map(match => match[0].toUpperCase().replace(/[\s().]/g, ''));
  const explicitExplanation = /\b(?:explain|describe|outline|summari[sz]e)\b/i.test(query);
  const explicitNoCalculation = /\b(?:do\s+not|don't|dont|never)\s+(?:(?:need|want)\s+to\s+)?(?:calculate|compute|estimate|quantify)\b[^.!?;:]{0,45}\b(?:amounts?|totals?|values?|figures?)\b/i.test(query);
  const withoutNegatedJournals = removeNegatedJournalDirectives(query);
  const hasJournalOutput = /\b(?:journal|double[ -]+entr(?:y|ies)|accounting[ -]+entr(?:y|ies))\b/i;
  const explicitNoJournal = hasJournalOutput.test(query) && !hasJournalOutput.test(withoutNegatedJournals);
  const withoutNegatedCalculations = withoutNegatedJournals.replace(
    /\b(?:please\s+)?(?:do\s+not|don't|dont|never)\s+(?:(?:need|want)\s+to\s+)?(?:calculate|compute|estimate|quantify)\b[^.!?;:]{0,45}\b(?:amounts?|totals?|values?|figures?)\b/gi,
    ' '
  );
  const activeOutputs = withoutNegatedCalculations;
  const asksForAnotherOutput = /\b(?:calculat\w*|comput\w*|estimat\w*|quantif\w*|prepar\w*|creat\w*|record\w*|post\w*|compar\w*|contrast\w*|determin\w*|appl\w*|assess\w*|classif\w*|measur\w*)\b/i.test(activeOutputs) ||
    /\b(?:journal|double[ -]+entr(?:y|ies)|accounting[ -]+entr(?:y|ies))\b/i.test(activeOutputs);
  return query.length <= 1_000 && explicitExplanation && explicitNoCalculation && explicitNoJournal &&
    standardReferences.length > 0 && new Set(standardReferences).size === 1 && !asksForAnotherOutput;
}

export interface ReconciledQuestionUnderstanding {
  classification: QuestionClassificationResult;
  understanding: SemanticQuestionUnderstanding;
  /** Separate workstream plan for future orchestration; it does not replace classification. */
  issuePlan: SemanticIssueReconciliation;
  /** Exact-query representation diagnostics, separate from evidence and coverage. */
  requestCompletenessContext: RequestCompletenessContext;
}

export interface ReconciledSemanticQuestionIssue extends SemanticQuestionIssue {
  id: string;
  /** MAPPED means taxonomy mapping succeeded; it does not mean the issue is answered. */
  status: 'MAPPED' | 'UNRESOLVED';
  unresolvedReason?: 'NO_COVERAGE_TOPIC' | 'UNASSIGNED_QUERY_TOPIC' | 'UNKNOWN_DOMAIN';
  /** Raw query topics recognized as context for this issue; never used as governing/source scope. */
  contextualTopicIds?: string[];
  /** Routing-only parent topics inferred after complete clause ownership proof. */
  routingTopicIds?: string[];
}

export interface SemanticIssueReconciliation {
  source: 'SEMANTIC_ISSUES' | 'TAXONOMY_FALLBACK';
  issues: ReconciledSemanticQuestionIssue[];
  /** True only when a semantic plan covers every independently recognized topic and has no residual query text. */
  coverageEstablished: boolean;
  /** Fail-closed signal for unsupported query text, unresolved issues, or absent recognized topic coverage. */
  hasUnmappedResidual: boolean;
  /** Internal diagnostic for the bounded routing-parent ownership proof. */
  routingOwnershipFailure?: 'INCOMPLETE_SCOPE_PARTITION' | 'UNOWNED_REQUEST_ATOM';
}

/** Deterministically guards and projects the semantic interpretation into existing IRAS routing fields. */
function reconcileLegacyQuestionUnderstanding(
  query: string,
  classification: QuestionClassificationResult,
  understanding: SemanticQuestionUnderstanding
): Omit<ReconciledQuestionUnderstanding, 'issuePlan' | 'requestCompletenessContext'> {
  const validatedSemantic = validatedSemanticForQuery(query, understanding);
  const semantic = validatedSemantic ? refineUnknownEmploymentPopulation(query, validatedSemantic) : undefined;
  if (!semantic || semantic.confidence < SEMANTIC_QUESTION_MIN_CONFIDENCE) {
    return {
      classification: deterministicCaseFactGuard(query, classification),
      understanding: { mode: 'DETERMINISTIC_FALLBACK', failure: understanding.failure || (semantic ? 'INVALID_RESPONSE' : undefined) }
    };
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
    const semanticHasCpfReliefIssue = semantic.issues?.some(issue => issue.domain === 'IRAS_INCOME_TAX' &&
      (issue.population === 'INDIVIDUAL' || issue.population === 'EMPLOYEE') &&
      issue.governingAuthorities.includes('IRAS') && /\b(?:cpf|central provident fund)\b/i.test(issue.subject) &&
      /\brelief\b/i.test(issue.subject));
    const semanticHasCpfPayrollIssue = semantic.issues?.some(issue => issue.domain === 'CPF_PAYROLL' ||
      issue.governingAuthorities.includes('CPF'));
    if (deterministicCpfOutcomeRequested && semanticHasCpfReliefIssue && semantic.issues !== undefined && !semanticHasCpfPayrollIssue) {
      // Keep the mapped IRAS outcome so the independent raw CPF inventory can
      // remain as an unresolved payroll issue when the model omitted it.
      return { classification, understanding: { ...understanding, interpretation: semantic, mode: 'SEMANTIC_PLUS_RULES' } };
    }
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
  return {
    topics,
    rawTopicIds: [...new Set(decomposition.topics.map(topic => topic.id))],
    unresolvedFragments: [...(decomposition.unresolvedTopics || [])],
    hasUnparsedText: (decomposition.unresolvedTopics?.length || 0) > 0
  };
}

const ACRA_APPLICATION_DATE = String.raw`(?:[0-3]?\d[/-][01]?\d[/-]20\d{2}|20\d{2}-\d{2}-\d{2}|[0-3]?\d(?:st|nd|rd|th)?\s+[a-z]+\s+20\d{2})`;

function isBoundedAcraCompanyFactsFragment(fragment: string): boolean {
  return /^\s*for\s+(?:a|the)\s+(?:(?:singapore(?:[\s-]+incorporated)?|singapore-incorporated)\s+)?(?:(?:non[\s-]?listed|unlisted|listed|private|public)\s+)?compan(?:y|ies)\s+(?:(?:with|and|that\s+has|which\s+has)\s+)?(?:(?:no|without|not\s+having|does\s+not\s+have|has\s+no)\s+)?(?:an?\s+|the\s+)?overseas\s+branch\s+register\s*$/i.test(fragment);
}

function isBoundedAcraFyeAndOutputFragment(fragment: string): boolean {
  const fye = String.raw`(?:financial\s+year\s+(?:end(?:ing)?|ended|ends?)(?:\s+date)?|fye)`;
  const dateConnector = String.raw`(?:(?:is|of|on|ending|ended)\s+)?`;
  const deadlineQuestion = String.raw`what\s+(?:is|would\s+be)\s+(?:the\s+)?annual[-\s]+return\s+(?:filing\s+)?(?:filing\s+)?(?:deadline|due\s+date)\?`;
  const output = String.raw`(?:\s*(?:show|give|provide)\s+(?:the\s+)?date\s+as\s+dd\s*\/\s*mm\s*\/\s*yyyy\s*[.;,]?)?`;
  const noJournal = String.raw`(?:\s*;?\s*do\s+not\s+prepare\s+(?:a\s+)?(?:journal(?:\s+entry)?|entry)\s*[.!]?)?`;
  return new RegExp(String.raw`^\s*${fye}\s+${dateConnector}${ACRA_APPLICATION_DATE}\s*,\s*${deadlineQuestion}${output}${noJournal}\s*$`, 'i').test(fragment);
}

function canBindAcraApplicationInputResiduals(
  query: string,
  issues: ReconciledSemanticQuestionIssue[],
  inventory: ReturnType<typeof independentlyRecognizedTopics>
): boolean {
  if (!inventory.hasUnparsedText || issues.length !== 1 || inventory.rawTopicIds.length !== 1 ||
      inventory.rawTopicIds[0] !== 'acra_annual-returns' || inventory.topics.length !== 1 ||
      inventory.topics[0].id !== 'acra_annual-returns') return false;
  const issue = issues[0];
  if (issue.status !== 'MAPPED' || issue.domain !== 'ACRA_CORPORATE' || issue.population !== 'COMPANY' ||
      issue.governingAuthorities.length !== 1 || issue.governingAuthorities[0] !== 'ACRA' ||
      issue.mappedTopicIds.length !== 1 || issue.mappedTopicIds[0] !== 'acra_annual-returns' ||
      !isAcraAnnualReturnDeadlineQuestion(query) || !isAcraAnnualReturnApplicationQuestion(query, issue.operation) ||
      /\b(?:vcc|variable[\s-]+capital\s+compan(?:y|ies)|foreign(?:[\s-]+incorporated)?|overseas\s+company|incorporated\s+outside\s+singapore|extension|extended\s+deadline|waiver|special\s+order)\b/i.test(query)) {
    return false;
  }
  const fragments = inventory.unresolvedFragments;
  return fragments.length >= 2 && fragments.some(isBoundedAcraCompanyFactsFragment) &&
    fragments.some(isBoundedAcraFyeAndOutputFragment) &&
    fragments.every(fragment => isBoundedAcraCompanyFactsFragment(fragment) || isBoundedAcraFyeAndOutputFragment(fragment));
}

function reconcileSemanticIssuePlan(
  query: string,
  classification: QuestionClassificationResult,
  understanding: SemanticQuestionUnderstanding,
  requestCompletenessContext?: RequestCompletenessContext
): SemanticIssueReconciliation {
  const semantic = validatedSemanticForQuery(query, understanding);
  const inventory = independentlyRecognizedTopics(query, classification);
  const inventoryIds = new Set(inventory.topics.map(topic => topic.id));
  const seenIds = new Map<string, number>();
  const addId = (issue: SemanticQuestionIssue): string => {
    const baseId = stableIssueId(issue);
    const occurrence = (seenIds.get(baseId) || 0) + 1;
    seenIds.set(baseId, occurrence);
    return occurrence === 1 ? baseId : baseId + '_' + occurrence;
  };

  if (semantic && semantic.issues !== undefined) {
    const semanticIssues = semantic.issues;
    const separateCpfPayrollOutcomeRequested = explicitlyRequestsCpfPayrollOutcome(query);
    const semanticHasCpfGoverningIssue = semanticIssues.some(issue => issue.domain === 'CPF_PAYROLL' ||
      issue.governingAuthorities.includes('CPF'));
    const issueMappings: Array<ReconciledSemanticQuestionIssue & { subjectRoutingChildTopicIds: string[] }> = semanticIssues.map(issue => {
      const routedIssue = {
        ...issue,
        governingAuthorities: issue.governingAuthorities.map(authority =>
          canonicalAccountingWorkstreamAuthority(issue.domain, authority))
      };
      const mapping = resolveIssueTopicIds(
        query, routedIssue.subject, routedIssue.domain, routedIssue.population, routedIssue.operation,
        routedIssue.governingAuthorities, inventoryIds, semanticIssues.length
      );
      const mappedTopicIds = mapping.mappedTopicIds;
      const reconciledIssue = {
        ...routedIssue,
        mappedTopicIds,
        evidenceRequirement: deriveEvidenceRequirement(
          routedIssue.domain,
          routedIssue.operation,
          deriveRequestedIssueSpecificity(query, routedIssue, true)
        )
      };
      const unresolvedReason: ReconciledSemanticQuestionIssue['unresolvedReason'] = mappedTopicIds.length > 0
        ? undefined
        : routedIssue.domain === 'UNKNOWN' ? 'UNKNOWN_DOMAIN' : 'NO_COVERAGE_TOPIC';
      const contextualTopicIds = [...new Set([
        ...mapping.contextualTopicIds,
        ...(!semanticHasCpfGoverningIssue && !separateCpfPayrollOutcomeRequested &&
          inventoryIds.has('cpf_contribution_rates') &&
          isMappedIndividualCpfReliefIssue(routedIssue, mappedTopicIds)
          ? ['cpf_contribution_rates'] : [])
      ])];
      return {
        ...reconciledIssue,
        id: addId(reconciledIssue),
        status: unresolvedReason ? 'UNRESOLVED' : 'MAPPED',
        ...(unresolvedReason ? { unresolvedReason } : {}),
        ...(contextualTopicIds.length ? { contextualTopicIds } : {}),
        subjectRoutingChildTopicIds: mapping.routingChildTopicIds
      };
    });

    const relatedChildSubjectIds = [...new Set(issueMappings.flatMap(issue => issue.subjectRoutingChildTopicIds))];
    const ownershipGuardApplies = relatedChildSubjectIds.some(childTopicId =>
      getRoutingParentIdsForChild(childTopicId).some(parentTopicId => inventoryIds.has(parentTopicId)));
    let routingOwnershipFailure: SemanticIssueReconciliation['routingOwnershipFailure'];
    let routingTopicIdsByIssue = new Map<number, readonly string[]>();
    if (ownershipGuardApplies) {
      const ownership = proveRequestedTopicOwnership(
        query,
        issueMappings,
        inventoryIds,
        relatedChildSubjectIds,
        requestCompletenessContext?.inventory
      );
      if (ownership.complete) routingTopicIdsByIssue = new Map(ownership.routingTopicIdsByIssue);
      else routingOwnershipFailure = ownership.failure;
    }

    const issues: ReconciledSemanticQuestionIssue[] = issueMappings.map((issue, index) => {
      const routingTopicIds = routingTopicIdsByIssue.get(index) || [];
      const { subjectRoutingChildTopicIds: _subjectRoutingChildTopicIds, ...publicIssue } = issue;
      return { ...publicIssue, ...(routingTopicIds.length ? { routingTopicIds: [...routingTopicIds] } : {}) };
    });
    const mappedInventory = new Set(issues.flatMap(issue => [...issue.mappedTopicIds, ...(issue.contextualTopicIds || [])]));
    for (const issue of issues) for (const topicId of issue.routingTopicIds || []) mappedInventory.add(topicId);
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
    const hasUnmappedResidual = Boolean(routingOwnershipFailure) ||
      inventory.hasUnparsedText && !canBindAcraApplicationInputResiduals(query, issues, inventory) || inventory.topics.length === 0 ||
      issues.some(issue => issue.status === 'UNRESOLVED');
    return {
      source: 'SEMANTIC_ISSUES',
      issues,
      coverageEstablished: inventory.topics.length > 0 && !hasUnmappedResidual,
      hasUnmappedResidual,
      ...(routingOwnershipFailure ? { routingOwnershipFailure } : {})
    };
  }

  // Semantic transport/contract failure cannot establish an interpretation.
  // Retain only this explicitly rule-only, single-standard request as an
  // unresolved inventory gap when the existing topic catalog found no topic.
  const deterministicRuleOnlyGap = Boolean(understanding.failure && understanding.failure !== 'QUERY_TOO_LONG') &&
    isConservativeUnmappedAccountingRuleExplanationIntent(query) &&
    classification.primaryDomain === 'ACCOUNTING' &&
    classification.domains.length === 1 && classification.domains[0] === 'ACCOUNTING_SFRS' &&
    classification.authorities.length === 1 && classification.authorities[0] === 'ACRA' &&
    classification.intent === 'STATUTORY_ADVISORY' &&
    classification.accountingAnalysisRequired && !classification.taxAnalysisRequired &&
    !classification.calculationRequired && !classification.journalEntryRequired &&
    classification.missingFacts.length === 0 && inventory.topics.length === 0;
  if (deterministicRuleOnlyGap) {
    const requestedSubject = sanitizeSemanticDiagnosticLabel(query.trim().split(/[.!?]/, 1)[0] || 'Requested accounting-standard rule');
    const gap: SemanticQuestionIssue = {
      subject: requestedSubject || 'Requested accounting-standard rule',
      population: 'UNKNOWN',
      domain: 'ACCOUNTING',
      governingAuthorities: ['ACCOUNTING_STANDARDS'],
      contextualAuthorities: [],
      operation: 'EXPLAIN_RULE',
      mappedTopicIds: [],
      evidenceRequirement: 'AUTHORITATIVE_SOURCE',
      confidence: 1
    };
    return {
      source: 'TAXONOMY_FALLBACK',
      issues: [{ ...gap, id: addId(gap), status: 'UNRESOLVED', unresolvedReason: 'NO_COVERAGE_TOPIC' }],
      coverageEstablished: false,
      hasUnmappedResidual: true
    };
  }

  const groups = new Map<SingaporeKnowledgeDomain, typeof inventory.topics>();
  for (const topic of inventory.topics) groups.set(topic.domainId, [...(groups.get(topic.domainId) || []), topic]);
  const issues = [...groups.values()].map(issueFromTaxonomyGroup).map(issue => {
    if (isBoundedAcraAnnualReturnMissingFactsQuestion(query) && issue.domain === 'ACRA_CORPORATE' &&
        issue.mappedTopicIds.length === 1 && issue.mappedTopicIds[0] === 'acra_annual-returns') {
      const boundedFallbackIssue = {
        ...issue,
        subject: 'annual-return filing deadline',
        population: 'COMPANY' as const,
        operation: 'DETERMINE_TREATMENT' as const,
        evidenceRequirement: deriveEvidenceRequirement('ACRA_CORPORATE', 'DETERMINE_TREATMENT'),
        confidence: 1
      };
      return { ...boundedFallbackIssue, id: addId(boundedFallbackIssue), status: 'MAPPED' as const };
    }
    return {
      ...issue,
      id: addId(issue),
      status: 'MAPPED' as const
    };
  });
  const boundedAcraMissingFactsQuestion = isBoundedAcraAnnualReturnMissingFactsQuestion(query) && issues.length === 1 &&
    issues[0].status === 'MAPPED' && issues[0].domain === 'ACRA_CORPORATE' && issues[0].population === 'COMPANY' &&
    issues[0].governingAuthorities.length === 1 && issues[0].governingAuthorities[0] === 'ACRA' &&
    issues[0].mappedTopicIds.length === 1 && issues[0].mappedTopicIds[0] === 'acra_annual-returns';
  return { source: 'TAXONOMY_FALLBACK', issues,
    coverageEstablished: boundedAcraMissingFactsQuestion,
    hasUnmappedResidual: !boundedAcraMissingFactsQuestion };
}

/** Keeps issue reconciliation separate from the legacy flat classification projection. */
export function reconcileQuestionUnderstanding(
  query: string,
  classification: QuestionClassificationResult,
  understanding: SemanticQuestionUnderstanding,
  requestCompletenessContext?: RequestCompletenessContext
): ReconciledQuestionUnderstanding {
  const currentRequestCompletenessContext = ensureRequestCompletenessContext(query, requestCompletenessContext, understanding);
  const reconciled = reconcileLegacyQuestionUnderstanding(query, classification, understanding);
  return {
    ...reconciled,
    issuePlan: reconcileSemanticIssuePlan(query, classification, understanding, currentRequestCompletenessContext),
    requestCompletenessContext: currentRequestCompletenessContext
  };
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
  const semantic = validateSemanticQuestionInterpretation(understanding?.interpretation, query || undefined);
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

export function requiresCaseSpecificFacts(query: string, semantic: SemanticQuestionInterpretation): boolean {
  if (CASE_FACTS_REQUIRED_OPERATIONS.has(semantic.requestedOperation)) return true;
  const alignToIssue = (semantic.issues?.length || 0) > 1;
  if (semantic.issues?.length) return semantic.issues.some(issue =>
    deriveRequestedIssueSpecificity(query, issue, alignToIssue));
  return deriveRequestedIssueSpecificity(query, { operation: semantic.requestedOperation, subject: semantic.primarySubject }, false);
}
