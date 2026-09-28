import type {
  IrasEvidencePresentation,
  IrasPresentationClaimReference,
  IrasPresentationPassage,
  IrasPresentationSourceGroup,
  IrasEvidencePresentationStatus,
  QueryDomain
} from '../types/accounting';
import type { QuestionClassificationResult } from '../classification/questionClassifier';
import type { EvidenceQualityAssessment } from '../retrieval/evidenceQualityGate';
import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import type { VerifiedEvidenceClaim } from '../verification/claimEvidenceVerifier';
import type { IrasApplicationConclusion } from '../engine/irasApplicationEvaluator';
import { getSafeOfficialUrl } from './statutoryLinkResolver';

export interface IrasEvidencePresentationInput {
  query: string;
  classification: QuestionClassificationResult;
  quality: EvidenceQualityAssessment;
  acceptedClaims: readonly VerifiedEvidenceClaim[];
  missingFacts: readonly string[];
  existingFactPrompts?: readonly string[];
  applicationConclusions: readonly IrasApplicationConclusion[];
  hasVerifiedCalculation: boolean;
  hasApplicationUncertainty: boolean;
  calculationLead?: string;
}

function explicitlyCorporateQuery(query: string): boolean {
  return /\b(?:corporate|company|companies|corporation|pte\.?\s*ltd\.?|form\s+c(?:-s)?|estimated chargeable income|\beci\b)\b/i.test(query);
}

function explicitlyEmployerQuery(query: string): boolean {
  return /\b(?:employer|ir21|ir8a|auto.inclusion scheme|employer tax|employment income reporting)\b/i.test(query);
}

function explicitlyIndividualQuery(query: string): boolean {
  return /\b(?:individuals?|personal income tax|individual taxpayer|singapore tax resident|tax resident individual|personal tax)\b/i.test(query);
}

/** Display-only IRAS naming derived from the canonical classification, not legacy IRAS_TAX. */
export function getIrasDomainDisplayLabel(
  classification?: Pick<QuestionClassificationResult, 'domains' | 'topicIds'>,
  rawQuery = '',
  fallbackDomain?: QueryDomain
): string {
  const domains = new Set(classification?.domains || []);
  const incomeTaxDomainIds = ['IRAS_INDIVIDUAL_TAX', 'IRAS_CORPORATE_TAX', 'IRAS_EMPLOYER_TAX'] as const;
  const incomeTaxDomains = incomeTaxDomainIds.filter(domain => domains.has(domain));
  const hasGst = domains.has('IRAS_GST');

  if (hasGst && incomeTaxDomains.length > 0) return 'IRAS Income Tax and GST';
  if (hasGst || fallbackDomain === 'IRAS_GST') return 'IRAS GST';
  if (incomeTaxDomains.length === 1) {
    const domain = incomeTaxDomains[0];
    if (domain === 'IRAS_INDIVIDUAL_TAX') return 'IRAS Individual Income Tax';
    if (domain === 'IRAS_EMPLOYER_TAX') return 'IRAS Employer Tax';
    if (explicitlyIndividualQuery(rawQuery)) return 'IRAS Individual Income Tax';
    if ((classification?.topicIds.length || 0) > 0 || explicitlyCorporateQuery(rawQuery)) return 'IRAS Corporate Income Tax';
  }
  if (incomeTaxDomains.length === 0 && fallbackDomain === 'IRAS_TAX') {
    if (explicitlyEmployerQuery(rawQuery)) return 'IRAS Employer Tax';
    if (explicitlyIndividualQuery(rawQuery)) return 'IRAS Individual Income Tax';
    if (explicitlyCorporateQuery(rawQuery)) return 'IRAS Corporate Income Tax';
  }
  if (domains.has('IRAS_PROPERTY_TAX')) return 'IRAS Property Tax';
  if (domains.has('IRAS_STAMP_DUTY')) return 'IRAS Stamp Duty';
  if (domains.has('IRAS_CRS_FATCA')) return 'IRAS CRS and FATCA';
  if (fallbackDomain === 'IRAS_TAX' || incomeTaxDomains.length > 0) {
    return 'IRAS Income Tax';
  }
  return 'IRAS Income Tax';
}

export function hasCurrentIrasEvidencePresentation(
  presentation: IrasEvidencePresentation | undefined,
  rawQuery: string | undefined,
  primaryDomain: QueryDomain | undefined,
  queryIntent?: 'TRANSACTION' | 'STATUTORY_ADVISORY' | 'HYBRID'
): presentation is IrasEvidencePresentation {
  const hasIrasScope = primaryDomain === 'IRAS_TAX' || primaryDomain === 'IRAS_GST' ||
    (primaryDomain === 'ACCOUNTING_SFRS' && queryIntent === 'HYBRID');
  if (!presentation || !hasIrasScope || !rawQuery) return false;
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return normalize(presentation.query) === normalize(rawQuery);
}

function cleanSourceTitle(value: string | undefined): string {
  const cleaned = (value || '').trim()
    .replace(/^IRAS\s*(?:[|:–—-]\s*)?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Verified IRAS guidance';
}

function scopeIdentity(record: AuthoritativeSourceRecord): string {
  return `${record.id}|${record.provenance}|${record.validFrom || ''}|${record.validTo || ''}`;
}

function sourceGroupKey(claim: VerifiedEvidenceClaim, record: AuthoritativeSourceRecord): string {
  return claim.canonicalUrl ? `url:${claim.canonicalUrl}` : `record:${scopeIdentity(record)}`;
}

function passageIdentity(text: string, references: readonly IrasPresentationClaimReference[]): string {
  const scope = references[0];
  return [text, scope.supportKind, scope.provenance,
    scope.validFrom || '', scope.validTo || ''].join('\n');
}

function buildSourceGroups(
  acceptedClaims: readonly VerifiedEvidenceClaim[],
  records: readonly AuthoritativeSourceRecord[]
): IrasPresentationSourceGroup[] {
  const grouped = new Map<string, IrasPresentationSourceGroup>();
  for (const claim of acceptedClaims) {
    const record = records.find(candidate => candidate.id === claim.recordId);
    if (!record) continue;
    const safeUrl = claim.canonicalUrl
      ? getSafeOfficialUrl(claim.canonicalUrl, undefined, undefined, undefined, records)
      : '';
    const canonicalUrl = safeUrl || undefined;
    const key = sourceGroupKey(claim, record);
    let group = grouped.get(key);
    if (!group) {
      group = {
        key,
        title: cleanSourceTitle(record.documentTitle),
        ...(canonicalUrl ? { canonicalUrl } : {}),
        summary: '',
        passages: []
      };
      grouped.set(key, group);
    }
    const claimReference: IrasPresentationClaimReference = {
      recordId: record.id,
      ...(claim.canonicalUrl ? { canonicalUrl: claim.canonicalUrl } : {}),
      provenance: record.provenance,
      supportKind: claim.supportKind,
      ...(record.validFrom ? { validFrom: record.validFrom } : {}),
      ...(record.validTo ? { validTo: record.validTo } : {})
    };
    const identity = passageIdentity(claim.text, [claimReference]);
    const existing = group.passages.find(passage => passageIdentity(passage.text, passage.claimReferences) === identity);
    if (existing) {
      if (!existing.claimReferences.some(reference => reference.recordId === record.id)) existing.claimReferences.push(claimReference);
    } else {
      const passage: IrasPresentationPassage = {
        text: claim.text,
        supportKind: claim.supportKind,
        claimReferences: [claimReference]
      };
      group.passages.push(passage);
    }
  }
  for (const group of grouped.values()) {
    const reviewedCount = group.passages.filter(passage => passage.supportKind === 'REVIEWED_EDITORIAL_SUMMARY').length;
    const exactCount = group.passages.length - reviewedCount;
    const descriptors = [
      ...(exactCount ? [`${exactCount} verified source passage${exactCount === 1 ? '' : 's'}`] : []),
      ...(reviewedCount ? [`${reviewedCount} reviewed non-verbatim ${reviewedCount === 1 ? 'summary' : 'summaries'}`] : [])
    ];
    group.summary = `${descriptors.join(' and ')}; expand to inspect the admitted wording and scope.`;
  }
  return [...grouped.values()];
}

function statusFor(input: IrasEvidencePresentationInput): IrasEvidencePresentationStatus {
  if (input.quality.status === 'INSUFFICIENT' || input.quality.uncoveredTopicIds.length > 0 || input.acceptedClaims.length === 0) {
    return 'INSUFFICIENT';
  }
  if (allKnownFacts(input).length > 0 || input.hasApplicationUncertainty ||
      input.applicationConclusions.some(conclusion => conclusion.certainty === 'CONDITIONAL')) return 'CONDITIONAL';
  return 'VERIFIED';
}

function allKnownFacts(input: IrasEvidencePresentationInput): string[] {
  return [...new Set([
    ...input.missingFacts,
    ...input.quality.missingFacts,
    ...(input.existingFactPrompts || [])
  ].map(fact => fact.trim()).filter(Boolean))];
}

function applicationStatusText(status: IrasEvidencePresentationStatus, missingFacts: readonly string[]): string {
  if (status === 'INSUFFICIENT') {
    const facts = missingFacts.length ? ` Material facts to confirm: ${missingFacts.join('; ')}` : '';
    return `Evidence Incomplete — Review Required. The verified sources do not cover every required topic.${facts}`;
  }
  if (status === 'CONDITIONAL') {
    return missingFacts.length
      ? `Conditional — Facts Required. ${missingFacts.join('; ')}`
      : 'Conditional — Facts Required. The source rules are verified, but their application to this case is not established by the available facts.';
  }
  return 'Verified Evidence. The requested rule topics are supported, with no unresolved application conditions reported.';
}

function normalizePresentationText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function passageScopeKey(passage: IrasPresentationPassage): string {
  const references = [...passage.claimReferences]
    .map(reference => [reference.provenance, reference.validFrom || '', reference.validTo || ''].join('|'))
    .sort();
  return [passage.supportKind, ...references].join('\n');
}

function isCompleteBlockOf(text: string, candidate: string): boolean {
  const normalizedCandidate = normalizePresentationText(candidate);
  return text.split(/\r?\n\s*\r?\n/).some(block => normalizePresentationText(block) === normalizedCandidate);
}

function safeChatCaveat(input: IrasEvidencePresentationInput, status: IrasEvidencePresentationStatus): string {
  const facts = allKnownFacts(input);
  if (status === 'INSUFFICIENT') return applicationStatusText(status, facts);
  if (facts.length > 0) return `Conditional — Facts Required. ${facts.join('; ')}`;
  return applicationStatusText(status, facts);
}

export function createIrasEvidencePresentation(input: IrasEvidencePresentationInput): IrasEvidencePresentation {
  const quality = input.quality;
  const records = quality.eligibleRecords;
  const status = statusFor(input);
  const sourceGroups = buildSourceGroups(input.acceptedClaims, records);
  const domainLabel = getIrasDomainDisplayLabel(input.classification, input.query, 'IRAS_TAX');
  const groupNumbers = new Map(sourceGroups.map((group, index) => [group.key, index + 1]));
  const ruleUnits = new Map<string, { text: string; sourceReferences: Set<number> }>();
  for (const group of sourceGroups) {
    const sourceReference = groupNumbers.get(group.key)!;
    const chatTextByPassage = new Map<IrasPresentationPassage, string>();
    const omittedExampleKeys = new Set<string>();
    for (const passage of group.passages) {
      const blocks = passage.text.split(/\r?\n\s*\r?\n/).map(block => block.trim());
      const scopeKey = passageScopeKey(passage);
      const removableIndexes = new Set<number>();
      for (let index = 0; index + 2 < blocks.length; index += 1) {
        if (!/^Example:\s*\S/i.test(blocks[index]) || !/^[•▪◦-]\s/.test(blocks[index + 2])) continue;
        const exampleBlock = blocks[index + 1];
        const matchingPassage = group.passages.find(other => other !== passage &&
          passageScopeKey(other) === scopeKey &&
          normalizePresentationText(other.text) === normalizePresentationText(exampleBlock));
        if (!matchingPassage) continue;
        removableIndexes.add(index);
        removableIndexes.add(index + 1);
        omittedExampleKeys.add(`${scopeKey}\n${normalizePresentationText(exampleBlock)}`);
      }
      if (removableIndexes.size > 0) {
        chatTextByPassage.set(passage, blocks.filter((_, index) => !removableIndexes.has(index)).join('\n\n'));
      }
    }
    for (const passage of group.passages) {
      const scopeKey = passageScopeKey(passage);
      const text = chatTextByPassage.get(passage) || passage.text;
      if (omittedExampleKeys.has(`${scopeKey}\n${normalizePresentationText(text)}`)) continue;
      const compactText = text.split(/\r?\n\s*\r?\n/)
        .map(block => block.trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n');
      const normalized = normalizePresentationText(text);
      const isRepeatedCompleteBlock = group.passages.some(other =>
        other !== passage && passageScopeKey(other) === scopeKey &&
        normalizePresentationText(other.text).length > normalized.length &&
        isCompleteBlockOf(other.text, text));
      if (isRepeatedCompleteBlock) continue;
      const compactNormalized = normalizePresentationText(compactText);
      const key = `${scopeKey}\n${compactNormalized}`;
      const existing = ruleUnits.get(key) || { text: compactText, sourceReferences: new Set<number>() };
      existing.sourceReferences.add(sourceReference);
      ruleUnits.set(key, existing);
    }
  }
  const calculationLead = input.calculationLead?.replace(/\s*\[([^\]]+)\]\(<https:[^>]+>\)/g, ' ($1)');
  const lines = [`${domainLabel} — verified guidance`];
  if (calculationLead) {
    lines.push('', calculationLead);
  }
  if (ruleUnits.size > 0) lines.push('', 'The admitted rules relevant to the question are:');
  for (const unit of ruleUnits.values()) {
    const references = [...unit.sourceReferences].sort((left, right) => left - right).join(',');
    lines.push(`• ${unit.text} [${references}]`);
  }
  const applicationConclusions = input.applicationConclusions;
  if (applicationConclusions.length > 0) {
    lines.push('', 'Application findings');
    for (const conclusion of applicationConclusions) {
      const group = sourceGroups.find(candidate => candidate.passages.some(passage =>
        passage.claimReferences.some(reference => reference.recordId === conclusion.sourceRecordId)));
      const reference = group ? ` [${groupNumbers.get(group.key)}]` : '';
      lines.push(`• ${conclusion.text}${reference}`);
    }
  }
  if (sourceGroups.length > 0) {
    const sourceList = sourceGroups.map(group => `[${groupNumbers.get(group.key)}] ${group.title}`).join('; ');
    lines.push('', `Sources: ${sourceList}`);
  }
  lines.push('', `Application status: ${safeChatCaveat(input, status)}`);

  const titles = sourceGroups.map(group => group.title);
  const overview = titles.length
    ? `The verified guidance is grouped into ${titles.length} official source section${titles.length === 1 ? '' : 's'} below. Expand a section to inspect each admitted passage, its record reference and recorded scope.`
    : 'No admitted verified IRAS passages are available for source review.';

  return {
    query: input.query,
    domainLabel,
    status,
    chatAnswer: lines.join('\n'),
    ...(calculationLead ? { calculationLead } : {}),
    overview,
    applicationStatus: safeChatCaveat(input, status),
    factsToConfirm: allKnownFacts(input),
    sourceGroups
  };
}
