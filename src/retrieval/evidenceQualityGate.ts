import type { QueryDomain, StatutoryAuthority } from '../types/accounting';
import { UNIFIED_SOURCE_REGISTRY, type AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { hasVerifiedSourceUrlProvenance, isApprovedSingaporeSourceUrl } from '../standards/approvedSourceRegistry';
import { getCoverageTopicById, getCoverageTopicsByIds, type SingaporeCoverageTopic } from '../standards/coverageRegistry';
import { SourceFreshnessManager } from '../standards/sourceFreshnessManager';
import { defaultTargetDateResolver } from './targetDateResolver';
import { findRecordEligibilityRejection } from '../verification/claimEvidenceVerifier';
import { hasUnresolvedSection14NBasisPeriod } from './statutoryDateScope';
import type { RequestedQuestionConcept } from '../services/semanticQuestionUnderstanding';

export interface EvidenceQualityTraceAttempt {
  topicId: string;
  sourceMapId?: string;
  fetchStatus: string;
  finalUrl?: string;
  pageTitle?: string;
  titleMatched: boolean;
  contentMatched: boolean;
}

/** Minimal structural slice of the production map-retrieval trace. */
export interface EvidenceQualitySourceMapTrace {
  path?: string;
  sourceMapIds?: string[];
  selectedRecordIds?: string[];
  finalVerifiedUrls?: string[];
  attempts?: EvidenceQualityTraceAttempt[];
}

export interface EvidenceQualityInput {
  query: string;
  topicIds: string[];
  records: AuthoritativeSourceRecord[];
  missingFacts: string[];
  sourceMapFallbackTrace?: EvidenceQualitySourceMapTrace;
  /** Optional explicit date already resolved by the caller. */
  targetDate?: string;
  referenceDate?: string;
  /** Routing hints let a no-topic IRAS query fail closed. */
  domain?: QueryDomain;
  authorities?: StatutoryAuthority[];
  /** Query-scoped discovery scope; never persisted as reviewed registry knowledge. */
  provisionalTopics?: SingaporeCoverageTopic[];
  /** Query-scoped material concepts, used for conservative relevance and coverage checks. */
  requestedConcepts?: RequestedQuestionConcept[];
}

export interface EvidenceQualityAssessment {
  status: 'LOCAL_SUFFICIENT' | 'RETRIEVED_SUFFICIENT' | 'LIMITED' | 'INSUFFICIENT';
  eligibleRecords: AuthoritativeSourceRecord[];
  rejectedRecords: Array<{ recordId: string; code: string; reason: string }>;
  coveredTopicIds: string[];
  uncoveredTopicIds: string[];
  /** Material query concepts that still lack source-text support for transient authority scopes. */
  uncoveredConceptGroups?: Record<string, string[][]>;
  requestedConcepts?: string[];
  coveredConcepts?: string[];
  uncoveredConcepts?: string[];
  acceptedSourceGroups?: string[];
  missingFacts: string[];
  targetDate?: string;
  targetDateConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

const GENERIC_TOPIC_WORDS = new Set([
  'about', 'account', 'accounts', 'agency', 'allowance', 'applicable', 'business', 'company', 'condition',
  'conditions', 'corporate', 'deductibility', 'deductible', 'deduction', 'deductions', 'expense', 'expenses',
  'exemption', 'exemptions', 'guidance', 'iras', 'income', 'inland', 'law', 'local', 'of', 'official', 'on',
  'or', 'payment', 'payments', 'relief', 'rules', 'rule', 'singapore', 'source', 'supplies', 'supply', 'tax',
  'taxes', 'the', 'treatment', 'under', 'with'
]);

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function words(value: string): string[] {
  return normalizeText(value).split(' ').filter(Boolean).map(word => {
    if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
    if (/(?:sses|shes|ches|xes|zes)$/.test(word) && word.length > 5) return word.slice(0, -2);
    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) return word.slice(0, -1);
    return word;
  });
}

function recordTopicAssociations(record: AuthoritativeSourceRecord): Set<string> {
  return new Set([
    ...(record.sourceMapTopicIds || []),
    ...(record.relatedTopicIds || []),
    ...(record.tags || []),
    ...(record.retrievalHints || [])
  ]);
}

function scopedConcepts(topic: SingaporeCoverageTopic): RequestedQuestionConcept[] {
  return (topic as SingaporeCoverageTopic & { requestedConcepts?: RequestedQuestionConcept[] }).requestedConcepts || [];
}

function scopedMappedTopicIds(topic: SingaporeCoverageTopic): string[] {
  return (topic as SingaporeCoverageTopic & { mappedTopicIds?: string[] }).mappedTopicIds || [];
}

function hasEmployeeTaxTreatmentFor(text: string, benefitPattern: RegExp, maxDistance = 180): boolean {
  const normalizedText = normalizeText(text);
  const subjects = new RegExp(benefitPattern.source, 'gi');
  for (const match of normalizedText.matchAll(subjects)) {
    const index = match.index || 0;
    const start = Math.max(0, index - maxDistance);
    const end = Math.min(normalizedText.length, index + match[0].length + maxDistance);
    const context = normalizedText.slice(start, end);
    // Corporate profit-tax language can mention employee costs and benefits in
    // passing. It does not establish how the item is taxed for the employee.
    if (/\b(?:corporate|company|business)\b.{0,55}\b(?:taxable profits?|chargeable income)\b/.test(context)) continue;
    if (/\b(?:employee|employees|employer|employment|staff|worker|workers)\b/.test(context) &&
        /\b(?:taxable|non taxable|not taxable|taxed|tax treatment|taxability|subject to tax|exempt from tax)\b/.test(context)) return true;
  }
  return false;
}

function directlyStatesReliefPriority(text: string): boolean {
  return text.split(/[.!?;\n]+/).some(rawClause => {
    const clause = normalizeText(rawClause);
    if (/\bin order to\b/.test(clause)) return false;
    const reliefTarget = '(?:(?:tax )?reliefs?|relief claims?|claims? for (?:tax )?relief)';
    const priorityOfReliefs = new RegExp(`\\b(?:priority|prioriti[sz]ation)\\s+(?:of|for|between|among)\\s+(?:the )?${reliefTarget}\\b`).test(clause);
    const reliefsPrioritized = new RegExp(`\\b${reliefTarget}\\b.{0,24}\\b(?:prioritized|prioritised|ranked|sequenced)\\b`).test(clause);
    const explicitOrderOfReliefs = new RegExp(`\\border(?:ing)?\\s+(?:of|for|between|among)\\s+(?:the )?${reliefTarget}\\b`).test(clause);
    const explicitlyAppliedInOrder = new RegExp(`\\b${reliefTarget}\\b.{0,32}\\b(?:applied|claimed|deducted|considered|taken)\\b.{0,24}\\bin (?:the |a )?(?:following|specified|fixed|prescribed|particular|specific|priority) order\\b`).test(clause);
    const orderInWhichApplied = new RegExp(`\\border in which ${reliefTarget} (?:are |must be |should be )?(?:applied|claimed|deducted|considered|taken)\\b`).test(clause);
    const noFixedPriorityForReliefs = new RegExp(`\\b(?:no|without)\\b.{0,35}\\b(?:(?:fixed|specific|prescribed)\\s+)?(?:priority|order|sequence)\\b.{0,60}\\b(?:tax reliefs?|personal reliefs?|relief claims?|claims? for (?:tax )?relief)\\b|\\b(?:tax reliefs?|personal reliefs?|relief claims?|claims? for (?:tax )?relief)\\b.{0,45}\\b(?:have|has|is|are)?\\s*(?:no|without)\\s+(?:(?:fixed|specific|prescribed)\\s+)?(?:priority|order|sequence)\\b`).test(clause);
    const reliefsMayBeClaimedInAnyOrder = new RegExp(`\\b(?:tax reliefs?|personal reliefs?|relief claims?)\\b.{0,45}\\b(?:may|can) be claimed in any order\\b`).test(clause);
    return priorityOfReliefs || reliefsPrioritized || explicitOrderOfReliefs || explicitlyAppliedInOrder || orderInWhichApplied ||
      noFixedPriorityForReliefs || reliefsMayBeClaimedInAnyOrder;
  });
}

export function matchesRequestedQuestionConcept(text: string, concept: RequestedQuestionConcept): boolean {
  const normalizedText = normalizeText(text);
  if (concept.id === 'relief_claim_prioritization') {
    return directlyStatesReliefPriority(text);
  }
  if (concept.id === 'employee_benefit_tax_treatment') {
    return hasEmployeeTaxTreatmentFor(text, /\b(?:benefits? in kind|perquisites?|employment benefits?|benefits?)\b/);
  }
  if (concept.id === 'employee_reimbursement_tax_treatment') {
    return hasEmployeeTaxTreatmentFor(text, /\breimbursements?\b/);
  }
  if (concept.id === 'employee_housing_benefit_tax_treatment') {
    return hasEmployeeTaxTreatmentFor(text, /\b(?:housing allowances?|housing benefits?|accommodation|rent paid by employer)\b/, 240);
  }
  if (concept.id === 'employee_personal_insurance_tax_treatment') {
    return hasEmployeeTaxTreatmentFor(text, /\b(?:personal insurance|insurance premiums?|insurance policy)\b/, 240);
  }
  const phraseMatches = concept.terms.some(term => {
    const normalizedTerm = normalizeText(term);
    return normalizedTerm.length >= 5 && normalizedText.includes(normalizedTerm);
  });
  if (phraseMatches) return true;
  if (concept.id === 'personal_income_tax_relief_cap') {
    return /\b(?:personal|individual)\b/.test(normalizedText) && /\brelief\b/.test(normalizedText) &&
      /\b(?:cap|capped|limit|ceiling|80 000)\b/.test(normalizedText);
  }
  if (concept.id === 'cpf_relief') return /\bcpf\b/.test(normalizedText) && /\brelief\b/.test(normalizedText);
  if (concept.id === 'srs_relief') return /\bsrs\b/.test(normalizedText) && /\brelief\b/.test(normalizedText);
  if (concept.id === 'parent_relief') return /\bparent\b/.test(normalizedText) && /\brelief\b/.test(normalizedText);
  if (concept.id === 'grandparent_caregiver_relief') return /\bgrandparent\b/.test(normalizedText) && /\bcaregiver\b/.test(normalizedText) && /\brelief\b/.test(normalizedText);
  if (concept.id === 'working_mother_child_relief') return /\b(?:wmcr|working mother(?:s)? child relief)\b/.test(normalizedText);
  if (concept.id === 'qualifying_child_relief') return /\b(?:qcr|qualifying child relief)\b/.test(normalizedText);
  const tokens = [...new Set(words(concept.label).filter(word => word.length >= 3 && !GENERIC_TOPIC_WORDS.has(word)))];
  if (tokens.length < 2) return false;
  const variants = (token: string) => token === 'cap' ? ['cap', 'capped', 'limit', 'ceiling']
    : token === 'priority' || token === 'prioritization' ? ['priority', 'prioritization', 'prioritise', 'prioritize', 'order', 'sequence']
      : token === 'relief' ? ['relief', 'reliefs'] : [token];
  const matched = tokens.filter(token => variants(token).some(variant => normalizedText.split(' ').includes(variant))).length;
  return matched >= Math.max(2, Math.ceil(tokens.length * 0.6));
}

function metadataAssociatesRecord(record: AuthoritativeSourceRecord, topic: SingaporeCoverageTopic): boolean {
  // Live discovery records are bound to the one topic whose page, population,
  // and excerpt were validated. Registry keywords remain routing metadata and
  // must not backfill associations to other topics.
  if (record.provenance === 'LIVE_EXTERNAL') return recordTopicAssociations(record).has(topic.id) ||
    scopedMappedTopicIds(topic).some(id => recordTopicAssociations(record).has(id));
  const mappedTopicIds = scopedMappedTopicIds(topic);
  if (mappedTopicIds.some(id => recordTopicAssociations(record).has(id) ||
      getCoverageTopicById(id)?.sourceRecordIds.includes(record.id))) return true;
  if (topic.sourceRecordIds.includes(record.id)) return true;
  const associations = recordTopicAssociations(record);
  if (associations.has(topic.id) || (topic.relatedTopicIds || []).some(id => associations.has(id))) return true;

  // Some legacy, reviewed local records predate explicit topic IDs. Allow a
  // registry-backed tag connection, but never use it without content matching.
  const recordTagWords = new Set((record.tags || []).flatMap(words));
  const registryPhrases = [topic.title, ...topic.keywords, ...(topic.aliases || [])];
  const normalizedTags = new Set((record.tags || []).map(normalizeText));
  return registryPhrases.some(phrase => {
    if (normalizeText(phrase).length >= 8 && normalizedTags.has(normalizeText(phrase))) return true;
    const distinctive = words(phrase).filter(word => word.length >= 4 && !GENERIC_TOPIC_WORDS.has(word));
    return distinctive.length >= 2 && distinctive.filter(word => recordTagWords.has(word)).length >= 2;
  });
}

export function matchesReviewedLocalRegistryRecord(record: AuthoritativeSourceRecord): boolean {
  const canonical = UNIFIED_SOURCE_REGISTRY[record.id];
  if (!canonical || canonical.provenance !== 'LOCAL_STATIC') return false;
  // A bound ID is an association only when the evidence payload is the reviewed
  // registry record. Compare all recorded authority, content, citation and
  // review metadata; freshnessStatus is recomputed for the request date.
  const candidateFields = record as unknown as Record<string, unknown>;
  const canonicalFields = canonical as unknown as Record<string, unknown>;
  const fields = new Set([...Object.keys(candidateFields), ...Object.keys(canonicalFields)]);
  fields.delete('freshnessStatus');
  return [...fields].every(field => JSON.stringify(candidateFields[field]) === JSON.stringify(canonicalFields[field]));
}

function distinctiveTextMatches(record: AuthoritativeSourceRecord, topic: SingaporeCoverageTopic, query: string): boolean {
  const text = normalizeText(record.sourceText || '');
  if (text.length < 24) return false;
  const concepts = scopedConcepts(topic);
  if (concepts.length > 0) return concepts.every(concept => matchesRequestedQuestionConcept(text, concept));
  if (topic.id === 'iras-individual-foreign-tax-credit') {
    // DTA and general double-tax guidance may mention the same income being
    // taxed twice, but that does not establish the separate FTC conditions.
    // Require the actual source text to state the credit and its core gates.
    return /\bforeign tax credit\b/.test(text) &&
      /\bsame income\b/.test(text) &&
      /\b(?:tax has been paid|tax is paid|tax paid|tax has been paid or is payable|tax is payable|paid or payable|paid or is payable)\b/.test(text) &&
      /\bincome is taxable in singapore\b/.test(text) &&
      /\btax resident in singapore\b/.test(text);
  }
  const textWords = new Set(words(text));
  if (topic.id.startsWith('iras-authority-query-')) {
    // Authority-level topics have no reviewed phrase. A page may support one
    // material clause, but a couple of incidental query words cannot establish
    // coverage for the entire request. Full coverage is aggregated by concept
    // group below; sitemap/search metadata never participates.
    return queryMaterialConceptGroups(query).some(group => supportsQueryConceptGroup(textWords, group));
  }
  const sourceFacingHints = topic.domainId.startsWith('IRAS_')
    ? [...(topic.paragraphHints || []), ...(topic.sectionHints || [])]
    : [];
  const registryPhrases = [topic.title, ...topic.keywords, ...(topic.aliases || []), ...sourceFacingHints];
  for (const phrase of registryPhrases) {
    const normalizedPhrase = normalizeText(phrase);
    if (normalizedPhrase.length >= 9 && text.includes(normalizedPhrase)) return true;
    const phraseWords = [...new Set(words(phrase).filter(word => word.length > 2 && !['and', 'for', 'from', 'the', 'with'].includes(word)))];
    const distinctivePhraseWords = phraseWords.filter(word => !GENERIC_TOPIC_WORDS.has(word));
    if (distinctivePhraseWords.length > 0 && phraseWords.length >= 2 && phraseWords.every(word => textWords.has(word))) return true;
    const distinctive = [...new Set(words(phrase).filter(word => word.length >= 4 && !GENERIC_TOPIC_WORDS.has(word)))];
    const overlap = distinctive.filter(word => textWords.has(word));
    if (overlap.length >= 2 || (record.provenance !== 'LIVE_EXTERNAL' && overlap.some(word => word.length >= 8))) return true;
  }
  return false;
}

const QUERY_CONTEXT_STOP_WORDS = new Set([
  'a', 'an', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'during', 'each', 'for', 'from', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'may', 'might',
  'must', 'of', 'on', 'or', 'should', 'that', 'their', 'them', 'there', 'these', 'this', 'those',
  'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'while', 'why', 'will', 'with', 'would',
  'then', 'also', 'whether'
]);
const QUERY_CONTEXT_SHORT_TOPIC_WORDS = new Set(['tax', 'gst', 'wht', 'cpf', 'dta', 'mas', 'mom', 'sso', 'vat']);

function requestedQueryText(query: string): string {
  // Users often add background facts first, then clarify the actual issue with
  // a discourse marker. Treat only that explicit requested outcome as a
  // required concept; the background remains available to routing/population
  // validation but does not have to be repeated in every cited rule.
  const focus = /\b(?:but\s+)?(?:i\s+am\s+asking(?:\s+specifically)?|i['’]m\s+asking(?:\s+specifically)?|the\s+question\s+is|what\s+i\s+need\s+to\s+know\s+is|i\s+(?:only\s+)?want\s+to\s+know)\b[\s,:-]*(?:(?:whether|if|what|how|when|which|why)\b\s*)?([\s\S]+)$/i.exec(query);
  if (focus?.[1]?.trim()) return focus[1].trim();
  // Conditional fact clauses often precede the actual tax question (for
  // example, a residency/employment scenario followed by “under what
  // conditions ...”). Keep the requested rule concepts in the evidence scope;
  // the user's facts remain in the full query for application and caveats.
  const requestedRule = /\b(?:under\s+what\s+conditions|whether)\b/i.exec(query);
  return requestedRule && requestedRule.index > 0 ? query.slice(requestedRule.index).trim() : query;
}

function queryMaterialConceptGroups(query: string): string[][] {
  const requestedText = requestedQueryText(query);
  const clauses = requestedText.split(/[,;.!?]|\b(?:and|or|while|whereas|but)\b/gi);
  return clauses.map(clause => [...new Set(words(clause)
    .map(word => word === 'oversea' || word === 'abroad' ? 'foreign'
      : word === 'remitted' || word === 'remittance' ? 'remit' : word)
    .filter(word => (word.length >= 4 || QUERY_CONTEXT_SHORT_TOPIC_WORDS.has(word)) && !QUERY_CONTEXT_STOP_WORDS.has(word)))])
    .filter(group => group.length >= 2 || (group.length === 1 && group[0].length >= 6));
}

function queryConceptVariants(term: string): string[] {
  if (term === 'foreign') return ['foreign', 'oversea', 'abroad', 'outside'];
  if (term === 'source' || term === 'sourced') return ['source', 'sourced', 'derive', 'derived'];
  if (term === 'remit') return ['remit', 'remitted', 'remittance'];
  if (term === 'physically') return ['physically', 'physical', 'wholly', 'outside', 'overseas'];
  if (term === 'working') return ['working', 'work', 'worked', 'employment', 'services', 'duties', 'rendered'];
  if (term === 'supporting') return ['supporting', 'support', 'supported', 'appropriate'];
  if (term === 'employee') return ['employee', 'employer'];
  if (term === 'personal') return ['personal', 'individual'];
  if (term === 'condition') return ['condition', 'qualify', 'qualification', 'criteria', 'require'];
  if (term === 'exclusion') return ['exclusion', 'exclude', 'excluded', 'cannot'];
  if (term === 'apply') return ['apply', 'applicable', 'eligibility', 'eligible', 'qualify', 'qualification', 'qualifying'];
  if (term === 'required') return ['required', 'require', 'must', 'necessary'];
  if (term === 'met') return ['met', 'meet', 'hold', 'acquire', 'satisfy', 'satisfied'];
  if (term === 'claim') return ['claim', 'claimed', 'claiming', 'claims'];
  if (term === 'taxable') return ['taxable', 'chargeable', 'tax', 'liable', 'subject'];
  if (term === 'eligible') return ['eligible', 'eligibility', 'qualify', 'qualification', 'entitled', 'claim'];
  return [term];
}

function supportsQueryConceptGroup(textWords: ReadonlySet<string>, group: readonly string[]): boolean {
  const matches = group.filter(term => queryConceptVariants(term).some(variant => textWords.has(variant))).length;
  const minimumMatches = group.length <= 2 ? group.length : Math.max(3, Math.ceil(group.length * 0.5));
  return matches >= minimumMatches;
}

function isGovernmentEmploymentScopedRelief(
  record: AuthoritativeSourceRecord,
  topic: SingaporeCoverageTopic,
  query: string
): boolean {
  const registeredReliefTopic = ['iras-individual-foreign-tax-credit', 'iras-individual-double-tax-agreements'].includes(topic.id);
  const provisionalReliefQuery = topic.id.startsWith('iras-authority-query-') &&
    /\b(?:foreign tax credit|double tax(?:ation)? relief|double tax(?:ation)? agreement|dtr|dtas?|taxed twice)\b/i.test(query);
  if (!registeredReliefTopic && !provisionalReliefQuery) return false;
  const blocks = (record.sourceText || '').split(/\r?\n[\t ]*\r?\n+/).map(block => block.trim()).filter(Boolean);
  const reliefBlocks = blocks.map((block, index) => ({ block, index })).filter(({ block }) =>
    /\b(?:double taxation relief|double tax relief|foreign tax credit|tax remission|taxed twice)\b/i.test(block)
  );
  if (reliefBlocks.length === 0) return false;

  const scopes = reliefBlocks.map(({ index }) => {
    let outsideHeading = -1;
    let governmentParent = -1;
    let generalReliefHeading = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (outsideHeading < 0 && /^[a-z]\.\s*tax treatment outside singapore$/i.test(blocks[cursor].replace(/^[•◦▪]\s*/, ''))) {
        outsideHeading = cursor;
      }
      if (/^[•◦▪]?\s*you are employed outside of singapore on behalf of the government of singapore\.?$/i.test(blocks[cursor])) {
        governmentParent = cursor;
        break;
      }
      if (generalReliefHeading < 0 && (
        /^(?:individual\s+)?(?:foreign tax credit|double tax(?:ation)? relief|claim(?:ing)? (?:foreign tax credit|double tax relief)|double taxation agreements?|tax treaty|dta)\b/i.test(blocks[cursor]) ||
        /^(?:avoidance of double taxation agreements?\s*\(dtas?\)|benefits under dtas?|tax residents of singapore)$/i.test(blocks[cursor])
      )) {
        generalReliefHeading = cursor;
      }
      // A new scenario heading ends the context inherited by this passage.
      if (cursor < index && /^[•◦▪]\s*(?:you are|if you are|when you are)\b/i.test(blocks[cursor])) break;
    }
    if (governmentParent >= 0 && outsideHeading > governmentParent) return 'GOVERNMENT' as const;
    if (generalReliefHeading >= 0) return 'GENERAL' as const;
    return 'UNPARSEABLE' as const;
  });

  // This gate admits records, not individual source blocks. If any co-located
  // relief passage is scoped to Government employment, the whole record must
  // stay out of an unspecified/private-employment answer; claim verification
  // cannot constrain later claims to only the general block.
  const governmentQuery = /\b(?:government of singapore|singapore government|public sector|civil service|public officer|government employee)\b/i.test(query);
  if (scopes.includes('GOVERNMENT')) return !governmentQuery;
  if (scopes.includes('GENERAL')) return false;
  return scopes.includes('UNPARSEABLE');
}

type IrasRequestHints = Pick<EvidenceQualityInput, 'domain' | 'authorities' | 'query'> & { topicIds?: string[] };

function isIrasRequest(input: IrasRequestHints): boolean {
  const topicIds = input.topicIds || [];
  const knownTopics = topicIds.map(id => getCoverageTopicById(id)).filter((topic): topic is NonNullable<typeof topic> => Boolean(topic));
  const hasIrasTopic = knownTopics.some(topic => topic.domainId.startsWith('IRAS_'));
  const hasNonIrasTopic = knownTopics.some(topic => !topic.domainId.startsWith('IRAS_'));
  const hasNonIrasAuthority = Boolean(input.authorities?.some(authority => authority !== 'IRAS'));

  // A mixed-authority or mixed-topic request must retain its non-IRAS
  // retrieval path. The evidence gate is for focused IRAS requests, not a
  // mechanism for discarding valid IFRS/MAS/ACRA records from a mixed query.
  if (hasNonIrasTopic || hasNonIrasAuthority) return false;
  if (input.domain) return input.domain.startsWith('IRAS_');
  if (input.authorities?.length) return input.authorities.length === 1 && input.authorities[0] === 'IRAS';
  if (hasIrasTopic) return true;
  return /\b(?:iras|gst|goods\s+and\s+services\s+tax|withholding\s+tax|\bwht\b|income\s+tax|section\s+14n|section\s+13w|\bir21\b|\beci\b)\b/i.test(input.query);
}

function hasIrasAssessmentScope(input: IrasRequestHints): boolean {
  const knownTopics = (input.topicIds || []).map(id => getCoverageTopicById(id))
    .filter((topic): topic is NonNullable<typeof topic> => Boolean(topic));
  return knownTopics.some(topic => topic.domainId.startsWith('IRAS_')) ||
    Boolean(input.domain?.startsWith('IRAS_')) ||
    Boolean(input.authorities?.includes('IRAS')) ||
    /\b(?:iras|gst|goods\s+and\s+services\s+tax|withholding\s+tax|\bwht\b|income\s+tax|section\s+14n|section\s+13w|\bir21\b|\beci\b)\b/i.test(input.query);
}

function isIrasEvidenceRecord(record: AuthoritativeSourceRecord): boolean {
  return record.authority === 'IRAS' || record.sourceAuthority === 'IRAS' || record.domain.startsWith('IRAS_');
}

function isUntouchedRecordEligible(record: AuthoritativeSourceRecord): boolean {
  return record.recordRole !== 'SOURCE_MAP_POINTER' && record.groundingEligible !== false &&
    record.lifecycleState !== 'CANDIDATE' && record.lifecycleState !== 'STAGED' && record.lifecycleState !== 'REJECTED' &&
    record.sourceType !== 'APPLICATION_RULE' && record.evidenceTier !== 'APPLICATION_RULE';
}

function isWithinTargetPeriod(record: AuthoritativeSourceRecord, targetDate: string): boolean {
  return (!record.validFrom || record.validFrom <= targetDate) && (!record.validTo || record.validTo >= targetDate);
}

function normalizeUrlIdentity(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    url.pathname = url.pathname.replace(/%28/gi, '(').replace(/%29/gi, ')').replace(/%27/gi, "'");
    return `${url.origin.toLowerCase()}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function traceProvesLiveRecord(
  record: AuthoritativeSourceRecord,
  topic: SingaporeCoverageTopic,
  trace?: EvidenceQualitySourceMapTrace
): boolean {
  const canonical = normalizeUrlIdentity(record.canonicalSourceUrl);
  const official = normalizeUrlIdentity(record.officialSourceUrl);
  if (!canonical || canonical !== official || record.urlVerificationStatus !== 'VERIFIED' ||
      !record.urlVerifiedDate || !hasVerifiedSourceUrlProvenance(record) ||
      !isApprovedSingaporeSourceUrl(record.officialSourceUrl) ||
      !trace?.selectedRecordIds?.includes(record.id) ||
      !trace.finalVerifiedUrls?.some(url => normalizeUrlIdentity(url) === canonical)) return false;

  const associations = recordTopicAssociations(record);
  const mappedTopicIds = scopedMappedTopicIds(topic);
  return Boolean(trace.attempts?.some(attempt =>
    (attempt.topicId === topic.id || mappedTopicIds.includes(attempt.topicId) && associations.has(attempt.topicId) || associations.has(topic.id) &&
      attempt.topicId.startsWith('iras-authority-query-concept-') && recordTopicAssociations(record).has(attempt.topicId)) &&
    attempt.fetchStatus === 'SUCCESS' &&
    attempt.titleMatched === true && attempt.contentMatched === true &&
    normalizeUrlIdentity(attempt.finalUrl) === canonical
  ));
}

function isVerifiedLiveCandidate(record: AuthoritativeSourceRecord, topic: SingaporeCoverageTopic, targetDate: string | undefined, trace?: EvidenceQualitySourceMapTrace): boolean {
  return record.provenance === 'LIVE_EXTERNAL' &&
    record.lifecycleState === 'CANDIDATE' && (record.recordRole as string | undefined) === 'DISCOVERED_EVIDENCE' &&
    record.groundingEligible === true && record.sourceType !== 'APPLICATION_RULE' &&
    record.evidenceTier !== 'APPLICATION_RULE' && record.sourceAuthority === 'IRAS' &&
    topic.authorities.includes(record.authority) && topic.legacyDomains.includes(record.domain) &&
    (!targetDate || isWithinTargetPeriod(record, targetDate)) && traceProvesLiveRecord(record, topic, trace) &&
    Boolean(record.sourceText?.trim());
}

function eligibilityRejectionMessage(code: string): string {
  switch (code) {
    case 'LOCAL_SOURCE_NOT_VERIFIED': return 'Local record is not marked VERIFIED or HISTORICAL.';
    case 'LOCAL_SOURCE_REVIEW_PROVENANCE_MISSING': return 'Local record lacks a recognized review method.';
    case 'LOCAL_SOURCE_REVIEW_AUDIT_OVERDUE': return 'Local record is overdue for its review audit.';
    case 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE': return 'Local record is outside its effective date range for the target date.';
    case 'SOURCE_URL_NOT_APPROVED_OR_CANONICAL': return 'Local record URL is not an approved source URL or does not match its canonical URL.';
    case 'SOURCE_RECORD_NOT_GROUNDING_ELIGIBLE': return 'Local record is not active or eligible for evidence grounding.';
    case 'LIVE_SOURCE_CANDIDATE_INCOMPLETE': return 'Live source candidate is missing required retrieval or URL verification metadata.';
    case 'LIVE_HISTORICAL_PAGE_SCOPE_UNVERIFIED': return 'Current live page retrieval does not establish the requested historical date.';
    default: return `Evidence eligibility check rejected the record (${code}).`;
  }
}

function explicitGstRateTransitionYears(query: string): number[] {
  if (!/\b(?:gst|goods\s+and\s+services\s+tax)\b/i.test(query) ||
      !/\b(?:invoice|invoiced|payment|paid|time\s+of\s+supply)\b/i.test(query)) return [];
  const years = [...new Set((query.match(/\b20\d{2}\b/g) || []).map(Number))].sort((a, b) => a - b);
  return years.length === 2 && years[1] === years[0] + 1 ? years : [];
}

function isStandardGstRateContext(record: AuthoritativeSourceRecord, topic: SingaporeCoverageTopic, years: number[]): boolean {
  const topicVocabulary = normalizeText([topic.id, topic.title, ...topic.keywords].join(' '));
  const standardRateTopic = /standard rated|standard rate/.test(topicVocabulary);
  const recordTagText = normalizeText((record.tags || []).join(' '));
  const recordText = record.sourceText || '';
  const tagAssociatesRate = /(?:gst rate|standard rate)/.test(recordTagText);
  // A current rate may be stated as effective from its start date without
  // repeating the user's later year. The record's validated interval supplies
  // the temporal link; the text must still contain both the rate and a date.
  const textHasRateAndPeriod = /\b\d+(?:\.\d+)?\s*%/.test(recordText) && /\b20\d{2}\b/.test(recordText);
  const yearRelevant = years.some(year =>
    (!record.validFrom || record.validFrom <= `${year}-12-31`) && (!record.validTo || record.validTo >= `${year}-01-01`));
  return standardRateTopic && tagAssociatesRate && textHasRateAndPeriod && yearRelevant;
}

function isLinkedTransitionRecord(record: AuthoritativeSourceRecord, records: AuthoritativeSourceRecord[]): boolean {
  return records.some(other => other.id !== record.id && (
    record.supersededByRecordId === other.id || record.historicalPredecessorRecordId === other.id ||
    other.supersededByRecordId === record.id || other.historicalPredecessorRecordId === record.id
  ));
}

export function isIrasEvidenceRequest(input: IrasRequestHints): boolean {
  return isIrasRequest(input);
}

/**
 * Evaluates whether selected records are actually topical, temporally valid,
 * and eligible to support an IRAS answer. This is a relevance/provenance gate,
 * not a claim-level semantic proof.
 */
export function evaluateEvidenceQuality(input: EvidenceQualityInput): EvidenceQualityAssessment {
  const referenceDate = input.referenceDate || SourceFreshnessManager.DEFAULT_REFERENCE_DATE;
  const resolvedTarget = input.targetDate
    ? { targetDate: input.targetDate, confidence: 'HIGH' as const }
    : defaultTargetDateResolver.resolveTargetDate(input.query, referenceDate);
  const targetDate = resolvedTarget.targetDate;
  const relevanceDate = targetDate || referenceDate;
  const targetTopics = [...new Map([
    ...getCoverageTopicsByIds(input.topicIds || []).filter(topic => topic.domainId.startsWith('IRAS_')),
    ...(input.provisionalTopics || []).filter(topic => topic.domainId.startsWith('IRAS_'))
  ].map(topic => [topic.id, topic])).values()];
  const uniqueRecords = [...new Map((input.records || []).map(record => [record.id, record])).values()];
  const rejectedRecords: EvidenceQualityAssessment['rejectedRecords'] = [];
  const eligibleById = new Map<string, AuthoritativeSourceRecord>();
  const covered = new Set<string>();
  const localByTopic = new Set<string>();
  const liveByTopic = new Set<string>();
  const irasRequest = hasIrasAssessmentScope(input);
  const requestedConcepts = input.requestedConcepts || targetTopics.flatMap(scopedConcepts);
  const reject = (recordId: string, code: string, reason: string) => rejectedRecords.push({ recordId, code, reason });

  if (!irasRequest) {
    const untouchedRecords = uniqueRecords.filter(isUntouchedRecordEligible);
    return {
      status: input.missingFacts.length ? 'LIMITED' : 'LOCAL_SUFFICIENT',
      eligibleRecords: untouchedRecords,
      rejectedRecords: [],
      coveredTopicIds: [],
      uncoveredTopicIds: [],
      requestedConcepts: requestedConcepts.map(concept => concept.label),
      coveredConcepts: [],
      uncoveredConcepts: requestedConcepts.map(concept => concept.label),
      acceptedSourceGroups: untouchedRecords.map(record => record.canonicalSourceUrl || record.id),
      missingFacts: [...input.missingFacts],
      targetDate: resolvedTarget.targetDate,
      targetDateConfidence: resolvedTarget.confidence
    };
  }

  if (targetTopics.length === 0) {
    for (const record of uniqueRecords) reject(record.id, 'IRAS_TOPIC_UNRESOLVED', 'IRAS retrieval has no resolved IRAS topic; evidence scope is insufficient.');
    return {
      status: 'INSUFFICIENT',
      eligibleRecords: [],
      rejectedRecords,
      coveredTopicIds: [],
      uncoveredTopicIds: [],
      requestedConcepts: requestedConcepts.map(concept => concept.label),
      coveredConcepts: [],
      uncoveredConcepts: requestedConcepts.map(concept => concept.label),
      acceptedSourceGroups: [],
      missingFacts: [...input.missingFacts],
      targetDate: resolvedTarget.targetDate,
      targetDateConfidence: resolvedTarget.confidence
    };
  }

  const transitionYears = explicitGstRateTransitionYears(input.query);
  const unresolvedRenovationBasisPeriod = hasUnresolvedSection14NBasisPeriod(input.query);
  for (const record of uniqueRecords) {
    if (unresolvedRenovationBasisPeriod && record.id.startsWith('ITA_SEC14N_RENOVATION_REFURBISHMENT')) {
      reject(record.id, 'SECTION14N_BASIS_PERIOD_UNRESOLVED',
        'An explicit calendar date and the stated YA differ; the company basis period must be established before choosing a Section 14N rule.');
      continue;
    }
    if (!isIrasEvidenceRecord(record)) {
      reject(record.id, 'EVIDENCE_OUTSIDE_IRAS_SCOPE', 'Non-IRAS record is outside the governed IRAS evidence scope.');
      continue;
    }
    if (record.recordRole === 'SOURCE_MAP_POINTER' || record.groundingEligible === false) {
      reject(record.id, 'SOURCE_MAP_POINTER_NOT_EVIDENCE', 'Source-map pointers are routing metadata, not answer evidence.');
      continue;
    }
    if (record.sourceType === 'APPLICATION_RULE' || record.evidenceTier === 'APPLICATION_RULE') {
      reject(record.id, 'APPLICATION_SOURCE_NOT_ALLOWED', 'Application rules are not authority evidence.');
      continue;
    }
    if (!record.sourceText?.trim()) {
      reject(record.id, 'SOURCE_TEXT_MISSING', 'Record has no substantive evidence text.');
      continue;
    }

    let accepted = false;
    let rejectedCode = 'TOPIC_ASSOCIATION_NOT_FOUND';
    let rejectedReason = 'No registry topic association with distinctive matching source text.';
    const eligibilityRejection = findRecordEligibilityRejection(record, targetDate, referenceDate);
    for (const topic of targetTopics) {
      const associated = metadataAssociatesRecord(record, topic);
      if (!associated) continue;
      if (record.provenance === 'LIVE_EXTERNAL' && isGovernmentEmploymentScopedRelief(record, topic, input.query)) {
        rejectedCode = 'TOPIC_SCOPE_MISMATCH';
        rejectedReason = 'The retrieved relief passage is scoped to Government of Singapore employment, which the query did not establish.';
        continue;
      }
      const explicitlyBoundLocal = record.provenance === 'LOCAL_STATIC' && topic.sourceRecordIds.includes(record.id);
      if (explicitlyBoundLocal &&
          (!topic.authorities.includes(record.authority) || !topic.legacyDomains.includes(record.domain))) {
        rejectedCode = 'TOPIC_AUTHORITY_DOMAIN_MISMATCH';
        rejectedReason = 'Explicitly bound local evidence must still match the coverage topic authority and source domain.';
        continue;
      }
      const rateYears = transitionYears.length === 2 ? transitionYears : [Number(relevanceDate.slice(0, 4))];
      const transitionContext = transitionYears.length === 2 && record.sourceStatus !== 'NEEDS_REVIEW' &&
        record.provenance === 'LOCAL_STATIC' && isStandardGstRateContext(record, topic, transitionYears) &&
        isLinkedTransitionRecord(record, uniqueRecords);
      const transitionTargetDate = transitionContext
        ? transitionYears.map(year => `${year}-06-30`).find(date => isWithinTargetPeriod(record, date))
        : undefined;
      const transitionEligibilityRejection = transitionTargetDate
        ? findRecordEligibilityRejection(record, transitionTargetDate, referenceDate)
        : undefined;
      const local = record.provenance === 'LOCAL_STATIC' && !eligibilityRejection ||
        Boolean(record.provenance === 'LOCAL_STATIC' && transitionTargetDate && !transitionEligibilityRejection);
      const live = !local && !eligibilityRejection &&
        isVerifiedLiveCandidate(record, topic, targetDate, input.sourceMapFallbackTrace);
      const topicTextMatches = distinctiveTextMatches(record, topic, input.query) || explicitlyBoundLocal || transitionContext ||
        (topic.domainId === 'IRAS_GST' && isStandardGstRateContext(record, topic, rateYears));
      if (!local && !live) {
        rejectedCode = eligibilityRejection || transitionEligibilityRejection ||
          (record.provenance === 'LIVE_EXTERNAL' ? 'LIVE_RETRIEVAL_TRACE_NOT_VERIFIED' : 'SOURCE_NOT_ELIGIBLE');
        rejectedReason = eligibilityRejection || transitionEligibilityRejection
          ? eligibilityRejectionMessage(rejectedCode)
          : record.provenance === 'LIVE_EXTERNAL'
            ? 'Live candidate lacks a matching successful URL/topic/content retrieval trace or verified provenance.'
            : 'Record provenance or lifecycle is not eligible for IRAS evidence.';
        continue;
      }
      if (explicitlyBoundLocal && !matchesReviewedLocalRegistryRecord(record)) {
        rejectedCode = 'BOUND_LOCAL_RECORD_MISMATCH';
        rejectedReason = 'Explicit source-record binding requires the reviewed local registry content and provenance.';
        continue;
      }
      if (!topicTextMatches) {
        rejectedCode = 'TOPIC_TEXT_NOT_DISTINCTIVE';
        rejectedReason = 'Topic metadata alone is insufficient; source text lacks distinctive evidence for this topic.';
        continue;
      }
      accepted = true;
      eligibleById.set(record.id, record);
      if (!topic.id.startsWith('iras-authority-query-')) {
        covered.add(topic.id);
        if (local) localByTopic.add(topic.id);
        else liveByTopic.add(topic.id);
      }
    }
    if (!accepted) reject(record.id, rejectedCode, rejectedReason);
  }

  const uncoveredConceptGroups: Record<string, string[][]> = {};
  const coveredConceptIds = new Set<string>();
  for (const topic of targetTopics.filter(candidate => candidate.id.startsWith('iras-authority-query-'))) {
    const topicConcepts = scopedConcepts(topic);
    const groups = topicConcepts.length > 0
      ? topicConcepts.map(concept => [...new Set(words(concept.label).filter(word => word.length >= 3 && !GENERIC_TOPIC_WORDS.has(word)))])
      : queryMaterialConceptGroups(input.query);
    const conceptRecords = [...eligibleById.values()].filter(record => {
      if (recordTopicAssociations(record).has(topic.id)) return true;
      return getCoverageTopicsByIds([...recordTopicAssociations(record)])
        .some(associatedTopic => associatedTopic.domainId === topic.domainId);
    });
    const combinedConceptWords = new Set(conceptRecords.flatMap(record => words(record.sourceText || '')));
    const supportingGroupIndexes = groups.map((group, index) => topicConcepts.length > 0
      ? conceptRecords.some(record => matchesRequestedQuestionConcept(record.sourceText || '', topicConcepts[index]))
      : supportsQueryConceptGroup(combinedConceptWords, group) ? true : false
    ).map((matched, index) => matched ? index : -1).filter(index => index >= 0);
    const missingGroupIndexes = groups.map((_, index) => index).filter(index => !supportingGroupIndexes.includes(index));
    const missingGroups = missingGroupIndexes.map(index => groups[index]);
    topicConcepts.forEach((concept, index) => {
      if (supportingGroupIndexes.includes(index)) coveredConceptIds.add(concept.id);
    });
    if (groups.length === 0 || missingGroups.length > 0) {
      uncoveredConceptGroups[topic.id] = groups.length === 0
        ? [['No material query concept could be resolved']]
        : topicConcepts.length > 0
          ? missingGroupIndexes.map(index => [topicConcepts[index]?.label || 'Uncovered requested concept'])
          : missingGroups;
      continue;
    }
    covered.add(topic.id);
    const localConceptWords = new Set(conceptRecords.filter(record => record.provenance === 'LOCAL_STATIC')
      .flatMap(record => words(record.sourceText || '')));
    const everyGroupHasLocalSupport = groups.every(group => supportsQueryConceptGroup(localConceptWords, group));
    if (everyGroupHasLocalSupport) localByTopic.add(topic.id);
    else liveByTopic.add(topic.id);
  }

  // Keep a live candidate only for a gap not already covered by validated local
  // content. This mirrors the existing local-first/fallback source lifecycle.
  const relevantLiveOnlyForGap = [...eligibleById.values()].filter(record => {
    if (record.provenance !== 'LIVE_EXTERNAL') return true;
    // Authority-query records can be useful for an independently supported
    // concept even while other requested concepts remain uncovered. Keep the
    // validated partial source available to a conditional answer; it does not
    // mark the provisional request sufficient and therefore cannot stop the
    // resolver's remaining discovery stages.
    if (targetTopics.some(topic => topic.id.startsWith('iras-authority-query-') && metadataAssociatesRecord(record, topic))) return true;
    const relatedTopics = targetTopics.filter(topic =>
      metadataAssociatesRecord(record, topic) && covered.has(topic.id) && !localByTopic.has(topic.id)
    );
    return relatedTopics.length > 0;
  });
  const eligibleRecords = [
    ...relevantLiveOnlyForGap.filter(record => record.provenance !== 'LIVE_EXTERNAL'),
    ...relevantLiveOnlyForGap.filter(record => record.provenance === 'LIVE_EXTERNAL')
  ];
  const uncoveredTopicIds = targetTopics.map(topic => topic.id).filter(id => !covered.has(id));
  const derivedConcepts = requestedConcepts.length > 0 ? requestedConcepts : targetTopics.flatMap(scopedConcepts);
  for (const concept of derivedConcepts) {
    const matchedRecord = [...eligibleById.values()].some(record => matchesRequestedQuestionConcept(record.sourceText || '', concept) &&
      (concept.topicIds.length === 0 || concept.topicIds.some(id => recordTopicAssociations(record).has(id)) ||
        targetTopics.some(topic => scopedConcepts(topic).some(scoped => scoped.id === concept.id) && metadataAssociatesRecord(record, topic))));
    if (matchedRecord) coveredConceptIds.add(concept.id);
  }
  const coveredConcepts = derivedConcepts.filter(concept => coveredConceptIds.has(concept.id)).map(concept => concept.label);
  const uncoveredConcepts = derivedConcepts.filter(concept => !coveredConceptIds.has(concept.id)).map(concept => concept.label);
  const allCoveredLocally = uncoveredTopicIds.length === 0 && targetTopics.every(topic => localByTopic.has(topic.id));
  let status: EvidenceQualityAssessment['status'];
  if (eligibleRecords.length === 0) status = 'INSUFFICIENT';
  else if (input.missingFacts.length > 0 || uncoveredTopicIds.length > 0 || uncoveredConcepts.length > 0) status = 'LIMITED';
  else if (allCoveredLocally) status = 'LOCAL_SUFFICIENT';
  else status = 'RETRIEVED_SUFFICIENT';

  return {
    status,
    eligibleRecords,
    rejectedRecords,
    coveredTopicIds: targetTopics.map(topic => topic.id).filter(id => covered.has(id)),
    uncoveredTopicIds,
    ...(Object.keys(uncoveredConceptGroups).length > 0 ? { uncoveredConceptGroups } : {}),
    requestedConcepts: derivedConcepts.map(concept => concept.label),
    coveredConcepts,
    uncoveredConcepts,
    acceptedSourceGroups: [...new Set(eligibleRecords.map(record => record.canonicalSourceUrl || record.id))],
    missingFacts: [...input.missingFacts],
    targetDate: resolvedTarget.targetDate,
    targetDateConfidence: resolvedTarget.confidence
  };
}
