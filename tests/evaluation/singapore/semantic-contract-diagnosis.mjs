import {
  SEMANTIC_QUESTION_MIN_CONFIDENCE,
  validateSemanticQuestionInterpretation
} from '../../../src/services/semanticQuestionUnderstanding.ts';

const MAX_RESPONSE_CHARS = 16_000;
const MAX_SHAPE_ITEMS = 13;
const MAX_SHAPE_COUNT = 10_000;

const ENUMS = Object.freeze({
  authority: new Set(['IRAS', 'CPF', 'ACRA', 'MOM', 'MAS', 'ACCOUNTING_STANDARDS', 'IFRS_FOUNDATION', 'SSO', 'UNKNOWN']),
  domain: new Set(['ACCOUNTING', 'IRAS_INCOME_TAX', 'IRAS_GST', 'IRAS_PROPERTY_TAX', 'IRAS_STAMP_DUTY', 'IRAS_OTHER', 'CPF_PAYROLL', 'MOM_EMPLOYMENT', 'ACRA_CORPORATE', 'MAS_FUNDS', 'UNKNOWN']),
  population: new Set(['INDIVIDUAL', 'EMPLOYEE', 'EMPLOYER', 'COMPANY', 'SHAREHOLDER', 'FUND', 'PROPERTY_OWNER', 'UNKNOWN']),
  operation: new Set(['EXPLAIN_RULE', 'EXPLAIN_INTERACTION', 'DETERMINE_TREATMENT', 'CHECK_ELIGIBILITY', 'CALCULATE', 'PREPARE_JOURNAL', 'COMPARE', 'FILING_REQUIREMENT', 'OTHER']),
  conceptRole: new Set(['PRIMARY', 'RELATED', 'CONTEXT_ONLY']),
  evidenceRequirement: new Set(['AUTHORITATIVE_SOURCE', 'CASE_FACTS', 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', 'UNRESOLVED'])
});

const LEGACY_KEYS = [
  'jurisdiction', 'authorityCandidates', 'contextualAuthorities', 'domain', 'population', 'primarySubject', 'concepts',
  'requestedOperation', 'requiresUserSpecificFacts', 'calculationRequested', 'factsExplicitlyProvided', 'confidence'
];
const ROOT_KEYS = new Set([...LEGACY_KEYS, 'issues']);
const ISSUE_KEYS = [
  'subject', 'population', 'domain', 'governingAuthorities', 'contextualAuthorities', 'operation',
  'mappedTopicIds', 'evidenceRequirement', 'confidence'
];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, MAX_SHAPE_COUNT) : 0;
}

function valueType(value) {
  if (value === null) return 'NULL';
  if (Array.isArray(value)) return 'ARRAY';
  if (isRecord(value)) return 'OBJECT';
  if (typeof value === 'string') return 'STRING';
  if (typeof value === 'number') return 'NUMBER';
  if (typeof value === 'boolean') return 'BOOLEAN';
  return 'OTHER';
}

function safeEnum(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : 'INVALID';
}

function labelIsSafe(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160 &&
    !Array.from(value).some(character => character.charCodeAt(0) <= 0x1f) &&
    !/(?:https?:\/\/|www\.)/i.test(value) &&
    !/(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|Bearer\s+[A-Za-z0-9._-]{12,})/i.test(value);
}

function confidenceShape(value) {
  if (typeof value !== 'number') return 'INVALID';
  if (!Number.isFinite(value)) return 'NONFINITE';
  if (value < 0 || value > 1) return 'OUT_OF_RANGE';
  if (value < SEMANTIC_QUESTION_MIN_CONFIDENCE) return 'BELOW_MINIMUM';
  return 'VALID_RANGE';
}

function shapeField(record, key) {
  const present = isRecord(record) && Object.hasOwn(record, key);
  const value = present ? record[key] : undefined;
  return { present, type: present ? valueType(value) : 'MISSING' };
}

function shapeStringList(value, maxItems) {
  return {
    type: valueType(value),
    count: Array.isArray(value) ? safeCount(value.length) : 0,
    withinLimit: Array.isArray(value) && value.length <= maxItems,
    itemTypes: Array.isArray(value) ? value.slice(0, MAX_SHAPE_ITEMS).map(valueType) : [],
    itemsValid: Array.isArray(value) ? value.slice(0, MAX_SHAPE_ITEMS).map(item => labelIsSafe(item)) : []
  };
}

function shapeAuthorities(value) {
  return {
    type: valueType(value),
    count: Array.isArray(value) ? safeCount(value.length) : 0,
    withinLimit: Array.isArray(value) && value.length <= 5,
    values: Array.isArray(value) ? value.slice(0, MAX_SHAPE_ITEMS).map(item => safeEnum(item, ENUMS.authority)) : []
  };
}

function shapeIssue(value) {
  if (!isRecord(value)) return { type: valueType(value) };
  return {
    type: 'OBJECT',
    keyCount: safeCount(Object.keys(value).length),
    extraKeyCount: safeCount(Object.keys(value).filter(key => !ISSUE_KEYS.includes(key)).length),
    missingKeyCount: safeCount(ISSUE_KEYS.filter(key => !Object.hasOwn(value, key)).length),
    population: safeEnum(value.population, ENUMS.population),
    domain: safeEnum(value.domain, ENUMS.domain),
    operation: safeEnum(value.operation, ENUMS.operation),
    evidenceRequirement: safeEnum(value.evidenceRequirement, ENUMS.evidenceRequirement),
    governingAuthorities: shapeAuthorities(value.governingAuthorities),
    contextualAuthorities: shapeAuthorities(value.contextualAuthorities),
    mappedTopicIds: {
      type: valueType(value.mappedTopicIds),
      count: Array.isArray(value.mappedTopicIds) ? safeCount(value.mappedTopicIds.length) : 0,
      withinLimit: Array.isArray(value.mappedTopicIds) && value.mappedTopicIds.length <= 20,
      itemTypes: Array.isArray(value.mappedTopicIds) ? value.mappedTopicIds.slice(0, MAX_SHAPE_ITEMS).map(valueType) : []
    },
    confidence: confidenceShape(value.confidence)
  };
}

function makeSafeShape(value) {
  if (!isRecord(value)) return { rootType: valueType(value) };
  const keys = Object.keys(value);
  return {
    rootType: 'OBJECT',
    keyCount: safeCount(keys.length),
    extraKeyCount: safeCount(keys.filter(key => !ROOT_KEYS.has(key)).length),
    missingKeyCount: safeCount(LEGACY_KEYS.filter(key => !Object.hasOwn(value, key)).length),
    fields: {
      jurisdiction: shapeStringList(value.jurisdiction, 6),
      authorityCandidates: shapeAuthorities(value.authorityCandidates),
      contextualAuthorities: shapeAuthorities(value.contextualAuthorities),
      domain: safeEnum(value.domain, ENUMS.domain),
      population: safeEnum(value.population, ENUMS.population),
      primarySubject: { type: valueType(value.primarySubject), valid: labelIsSafe(value.primarySubject) },
      concepts: {
        type: valueType(value.concepts),
        count: Array.isArray(value.concepts) ? safeCount(value.concepts.length) : 0,
        withinLimit: Array.isArray(value.concepts) && value.concepts.length <= 12,
        items: Array.isArray(value.concepts) ? value.concepts.slice(0, MAX_SHAPE_ITEMS).map(item => isRecord(item) ? {
          type: 'OBJECT',
          keyCount: safeCount(Object.keys(item).length),
          extraKeyCount: safeCount(Object.keys(item).filter(key => !['concept', 'role'].includes(key)).length),
          missingKeyCount: safeCount(['concept', 'role'].filter(key => !Object.hasOwn(item, key)).length),
          concept: { type: valueType(item.concept), valid: labelIsSafe(item.concept) },
          role: safeEnum(item.role, ENUMS.conceptRole)
        } : { type: valueType(item) }) : []
      },
      requestedOperation: safeEnum(value.requestedOperation, ENUMS.operation),
      requiresUserSpecificFacts: typeof value.requiresUserSpecificFacts === 'boolean' ? value.requiresUserSpecificFacts : 'INVALID',
      calculationRequested: typeof value.calculationRequested === 'boolean' ? value.calculationRequested : 'INVALID',
      factsExplicitlyProvided: shapeStringList(value.factsExplicitlyProvided, 12),
      confidence: confidenceShape(value.confidence),
      issues: {
        present: Object.hasOwn(value, 'issues'),
        type: Object.hasOwn(value, 'issues') ? valueType(value.issues) : 'MISSING',
        count: Array.isArray(value.issues) ? safeCount(value.issues.length) : 0,
        withinLimit: Array.isArray(value.issues) && value.issues.length <= 12,
        items: Array.isArray(value.issues) ? value.issues.slice(0, MAX_SHAPE_ITEMS).map(shapeIssue) : []
      }
    }
  };
}

function makeCollector() {
  const violations = [];
  const add = (code, path) => violations.push({ code, path });
  return { violations, add };
}

function diagnoseExactKeys(record, requiredKeys, optionalKeys, path, add) {
  for (const key of requiredKeys) if (!Object.hasOwn(record, key)) add('MISSING_KEY', `${path}${key}`);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (Object.keys(record).some(key => !allowed.has(key))) add('UNEXPECTED_KEY', path || '$');
}

function diagnoseLabelList(value, maxItems, path, add) {
  if (!Array.isArray(value)) { add('WRONG_TYPE', path); return; }
  if (value.length > maxItems) { add('COUNT_LIMIT', path); return; }
  const invalidIndex = value.findIndex(item => !labelIsSafe(item));
  if (invalidIndex >= 0) add(typeof value[invalidIndex] === 'string' ? 'INVALID_LABEL' : 'WRONG_TYPE', `${path}[${invalidIndex}]`);
}

function diagnoseAuthorities(value, path, add) {
  if (!Array.isArray(value)) { add('WRONG_TYPE', path); return; }
  if (value.length > 5) { add('COUNT_LIMIT', path); return; }
  const badIndex = value.findIndex(item => typeof item !== 'string' || !ENUMS.authority.has(item));
  if (badIndex >= 0) { add(typeof value[badIndex] === 'string' ? 'INVALID_AUTHORITY' : 'WRONG_TYPE', `${path}[${badIndex}]`); return; }
  if (new Set(value).size !== value.length) add('DUPLICATE_AUTHORITY', path);
}

function domainAuthorityPossible(domain, authorities) {
  const has = value => authorities.includes(value);
  if (['IRAS_INCOME_TAX', 'IRAS_GST', 'IRAS_PROPERTY_TAX', 'IRAS_STAMP_DUTY', 'IRAS_OTHER'].includes(domain)) return has('IRAS');
  if (domain === 'CPF_PAYROLL') return has('CPF');
  if (domain === 'MOM_EMPLOYMENT') return has('MOM');
  if (domain === 'ACRA_CORPORATE') return has('ACRA');
  if (domain === 'MAS_FUNDS') return has('MAS');
  if (domain === 'ACCOUNTING') return has('ACCOUNTING_STANDARDS') || has('IFRS_FOUNDATION') || has('ACRA');
  return domain === 'UNKNOWN';
}

function issueDomainAuthorityPossible(domain, authority) {
  if (domain === 'ACCOUNTING') return ['ACCOUNTING_STANDARDS', 'IFRS_FOUNDATION', 'ACRA', 'SSO'].includes(authority);
  if (['IRAS_INCOME_TAX', 'IRAS_GST', 'IRAS_PROPERTY_TAX', 'IRAS_STAMP_DUTY', 'IRAS_OTHER'].includes(domain)) return authority === 'IRAS';
  if (domain === 'CPF_PAYROLL') return authority === 'CPF';
  if (domain === 'MOM_EMPLOYMENT') return authority === 'MOM';
  if (domain === 'ACRA_CORPORATE') return authority === 'ACRA';
  if (domain === 'MAS_FUNDS') return authority === 'MAS';
  return domain === 'UNKNOWN' && authority === 'UNKNOWN';
}

function diagnoseEnum(value, values, path, add, code = 'INVALID_ENUM') {
  if (typeof value !== 'string') add('WRONG_TYPE', path);
  else if (!values.has(value)) add(code, path);
}

function diagnoseIssue(issue, index, add) {
  const path = `issues[${index}].`;
  if (!isRecord(issue)) { add('ISSUE_STRUCTURE', `issues[${index}]`); return; }
  const before = [];
  diagnoseExactKeys(issue, ISSUE_KEYS, [], path, (code, field) => before.push({ code: code === 'MISSING_KEY' || code === 'UNEXPECTED_KEY' ? 'ISSUE_STRUCTURE' : code, path: field }));
  if (before.length) { add(before[0].code, before[0].path); return; }
  if (typeof issue.subject !== 'string') { add('WRONG_TYPE', `${path}subject`); return; }
  if (!labelIsSafe(issue.subject)) { add('INVALID_LABEL', `${path}subject`); return; }
  diagnoseEnum(issue.population, ENUMS.population, `${path}population`, add, 'INVALID_POPULATION');
  diagnoseEnum(issue.domain, ENUMS.domain, `${path}domain`, add, 'INVALID_DOMAIN');
  diagnoseAuthorities(issue.governingAuthorities, `${path}governingAuthorities`, add);
  diagnoseAuthorities(issue.contextualAuthorities, `${path}contextualAuthorities`, add);
  diagnoseEnum(issue.operation, ENUMS.operation, `${path}operation`, add, 'INVALID_OPERATION');
  if (!Array.isArray(issue.mappedTopicIds)) add('WRONG_TYPE', `${path}mappedTopicIds`);
  else if (issue.mappedTopicIds.length > 20) add('COUNT_LIMIT', `${path}mappedTopicIds`);
  else if (issue.mappedTopicIds.some(id => typeof id !== 'string' || id.trim().length === 0)) {
    const bad = issue.mappedTopicIds.findIndex(id => typeof id !== 'string' || id.trim().length === 0);
    add(typeof issue.mappedTopicIds[bad] === 'string' ? 'INVALID_TOPIC_ID' : 'WRONG_TYPE', `${path}mappedTopicIds[${bad}]`);
  }
  diagnoseEnum(issue.evidenceRequirement, ENUMS.evidenceRequirement, `${path}evidenceRequirement`, add, 'INVALID_EVIDENCE_REQUIREMENT');
  if (typeof issue.confidence !== 'number' || !Number.isFinite(issue.confidence)) add('INVALID_CONFIDENCE', `${path}confidence`);
  else if (issue.confidence < 0 || issue.confidence > 1) add('CONFIDENCE_OUT_OF_RANGE', `${path}confidence`);
  else if (issue.confidence < SEMANTIC_QUESTION_MIN_CONFIDENCE) add('LOW_CONFIDENCE', `${path}confidence`);

  if (!Array.isArray(issue.governingAuthorities) || !Array.isArray(issue.contextualAuthorities) ||
      !issue.governingAuthorities.every(item => typeof item === 'string' && ENUMS.authority.has(item)) ||
      !issue.contextualAuthorities.every(item => typeof item === 'string' && ENUMS.authority.has(item))) return;
  if (issue.governingAuthorities.length !== 1) { add('ISSUE_AUTHORITY_COUNT', `${path}governingAuthorities`); return; }
  if (issue.contextualAuthorities.some(authority => issue.governingAuthorities.includes(authority))) {
    add('AUTHORITY_OVERLAP', `${path}contextualAuthorities`); return;
  }
  if (ENUMS.domain.has(issue.domain) && !issueDomainAuthorityPossible(issue.domain, issue.governingAuthorities[0])) {
    add('DOMAIN_AUTHORITY_MISMATCH', `${path}governingAuthorities`);
  }
}

function diagnoseObject(value) {
  const { violations, add } = makeCollector();
  if (!isRecord(value)) {
    add('WRONG_ROOT_TYPE', '$');
    return violations;
  }

  diagnoseExactKeys(value, LEGACY_KEYS, ['issues'], '', add);
  if (Object.hasOwn(value, 'issues')) {
    if (!Array.isArray(value.issues)) add('ISSUE_STRUCTURE', 'issues');
    else if (value.issues.length > 12) add('ISSUE_COUNT_LIMIT', 'issues');
  }

  diagnoseLabelList(value.jurisdiction, 6, 'jurisdiction', add);
  diagnoseAuthorities(value.authorityCandidates, 'authorityCandidates', add);
  diagnoseAuthorities(value.contextualAuthorities, 'contextualAuthorities', add);
  diagnoseEnum(value.domain, ENUMS.domain, 'domain', add, 'INVALID_DOMAIN');
  diagnoseEnum(value.population, ENUMS.population, 'population', add, 'INVALID_POPULATION');
  if (typeof value.primarySubject !== 'string') add('WRONG_TYPE', 'primarySubject');
  else if (!labelIsSafe(value.primarySubject)) add('INVALID_LABEL', 'primarySubject');
  if (!Array.isArray(value.concepts)) add('WRONG_TYPE', 'concepts');
  else if (value.concepts.length > 12) add('COUNT_LIMIT', 'concepts');
  diagnoseEnum(value.requestedOperation, ENUMS.operation, 'requestedOperation', add, 'INVALID_OPERATION');
  if (typeof value.requiresUserSpecificFacts !== 'boolean') add('WRONG_TYPE', 'requiresUserSpecificFacts');
  if (typeof value.calculationRequested !== 'boolean') add('WRONG_TYPE', 'calculationRequested');
  diagnoseLabelList(value.factsExplicitlyProvided, 12, 'factsExplicitlyProvided', add);
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) add('INVALID_CONFIDENCE', 'confidence');
  else if (value.confidence < 0 || value.confidence > 1) add('CONFIDENCE_OUT_OF_RANGE', 'confidence');

  if (Array.isArray(value.concepts) && value.concepts.length <= 12) {
    for (let index = 0; index < value.concepts.length; index += 1) {
      const concept = value.concepts[index];
      const path = `concepts[${index}]`;
      if (!isRecord(concept)) { add('CONCEPT_STRUCTURE', path); continue; }
      const badKeys = !Object.hasOwn(concept, 'concept') || !Object.hasOwn(concept, 'role') ||
        Object.keys(concept).some(key => !['concept', 'role'].includes(key));
      if (badKeys) { add('CONCEPT_STRUCTURE', path); continue; }
      if (typeof concept.concept !== 'string') add('WRONG_TYPE', `${path}.concept`);
      else if (!labelIsSafe(concept.concept)) add('INVALID_LABEL', `${path}.concept`);
      diagnoseEnum(concept.role, ENUMS.conceptRole, `${path}.role`, add, 'INVALID_CONCEPT_ROLE');
    }
  }

  if (Array.isArray(value.issues) && value.issues.length <= 12) {
    for (let index = 0; index < value.issues.length; index += 1) diagnoseIssue(value.issues[index], index, add);
  }

  const topAuthoritiesUsable = Array.isArray(value.authorityCandidates) &&
    value.authorityCandidates.every(authority => typeof authority === 'string' && ENUMS.authority.has(authority));
  if (ENUMS.domain.has(value.domain) && topAuthoritiesUsable && !domainAuthorityPossible(value.domain, value.authorityCandidates)) {
    add('DOMAIN_AUTHORITY_MISMATCH', 'authorityCandidates');
  }
  if (typeof value.requestedOperation === 'string' && ENUMS.operation.has(value.requestedOperation) &&
      typeof value.calculationRequested === 'boolean' && value.calculationRequested !== (value.requestedOperation === 'CALCULATE')) {
    add('CALCULATION_FLAG_MISMATCH', 'calculationRequested');
  }
  if (value.calculationRequested === true && value.requiresUserSpecificFacts === false) add('CASE_FLAG_CONTRADICTION', 'requiresUserSpecificFacts');
  if (value.requestedOperation === 'PREPARE_JOURNAL' && ENUMS.domain.has(value.domain) && value.domain !== 'ACCOUNTING') {
    add('JOURNAL_DOMAIN_MISMATCH', 'domain');
  }
  if (topAuthoritiesUsable && value.authorityCandidates.includes('UNKNOWN') && value.authorityCandidates.length > 1) {
    add('UNKNOWN_AUTHORITY_MIX', 'authorityCandidates');
  }
  return violations;
}

/** Returns only fixed reason codes, allowlisted field paths, and a non-sensitive shape summary. */
export function diagnoseSemanticContract(value) {
  const shape = makeSafeShape(value);
  const violations = diagnoseObject(value);
  let validatorAccepted = false;
  try { validatorAccepted = Boolean(validateSemanticQuestionInterpretation(value)); } catch {
    validatorAccepted = false;
  }
  const confidence = isRecord(value) ? confidenceShape(value.confidence) : 'INVALID';
  const interpreted = validatorAccepted && confidence !== 'BELOW_MINIMUM';
  let rejectionCode = violations[0]?.code;
  let rejectionPath = violations[0]?.path;
  if (!validatorAccepted && !rejectionCode) {
    rejectionCode = 'UNCLASSIFIED_REJECTION';
    rejectionPath = '$';
  } else if (validatorAccepted && confidence === 'BELOW_MINIMUM') {
    rejectionCode = 'LOW_CONFIDENCE';
    rejectionPath = 'confidence';
  } else if (validatorAccepted) {
    rejectionCode = 'NONE';
    rejectionPath = undefined;
  }
  return {
    validatorAccepted,
    interpreted,
    rejectionCode,
    ...(rejectionPath ? { rejectionPath } : {}),
    violations: validatorAccepted ? [] : violations.length ? violations : [{ code: 'UNCLASSIFIED_REJECTION', path: '$' }],
    safeShape: shape
  };
}

/** Parses an in-memory provider response and reports only fixed diagnostics. */
export function diagnoseSemanticResponse(response) {
  if (typeof response !== 'string') return {
    validatorAccepted: false, interpreted: false, rejectionCode: 'MALFORMED_JSON', rejectionPath: '$',
    violations: [{ code: 'MALFORMED_JSON', path: '$' }], safeShape: { responseType: valueType(response) }
  };
  if (response.length > MAX_RESPONSE_CHARS) return {
    validatorAccepted: false, interpreted: false, rejectionCode: 'RESPONSE_TOO_LARGE', rejectionPath: '$',
    violations: [{ code: 'RESPONSE_TOO_LARGE', path: '$' }],
    safeShape: { responseType: 'STRING', responseChars: Math.min(response.length, MAX_SHAPE_COUNT), exceedsLimit: true }
  };
  let parsed;
  try { parsed = JSON.parse(response); } catch {
    return {
      validatorAccepted: false, interpreted: false, rejectionCode: 'MALFORMED_JSON', rejectionPath: '$',
      violations: [{ code: 'MALFORMED_JSON', path: '$' }],
      safeShape: { responseType: 'STRING', responseChars: safeCount(response.length), malformed: true }
    };
  }
  return diagnoseSemanticContract(parsed);
}

export const semanticContractDiagnosticLimits = Object.freeze({ maxResponseChars: MAX_RESPONSE_CHARS, maxItems: MAX_SHAPE_ITEMS });
