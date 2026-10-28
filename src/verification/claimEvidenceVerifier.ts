import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import { hasVerifiedSourceUrlProvenance, isApprovedSingaporeSourceUrl } from '../standards/approvedSourceRegistry';
import { defaultSourceFreshnessManager, SourceFreshnessManager } from '../standards/sourceFreshnessManager';
import { defaultSourceVersioningManager, type SourceVersioningManager } from '../standards/sourceVersioning';
import { verifySharedDocumentAdmission } from '../standards/sharedDocumentAdmission';
import type { SharedDocumentAdmissionOptions } from '../standards/sharedDocumentAdmission';
import type { VerifiedDocumentBinding } from '../standards/unifiedSourceModel';
import type { QueryDomain, StatutoryAuthority } from '../types/accounting';
import { getCoverageTopicById } from '../standards/coverageRegistry';
import { supportBoundedStatutoryAdvisory } from '../retrieval/statutoryAdvisorySupport';
import { selectIrasCpfCoverageQuotes, supportIrasCpfCoverageRule } from '../retrieval/irasCpfCoverageRules';
import { selectMomAcraMasCoverageQuotes, supportMomAcraMasCoverageRule } from '../retrieval/momAcraMasCoverageRules';
import { selectPracticalExpansionQuotes, supportPracticalExpansionRule } from '../retrieval/practicalStatutoryExpansion';
import { STATUTORY_KNOWLEDGE_POINTERS_20261027B, sourceProvesKnowledgeDate } from '../retrieval/statutoryKnowledge20261027b';
import { selectMomSalaryPaymentRuleQuote, supportMomSalaryPaymentIssue } from '../retrieval/momSalaryPaymentRule';

import { normalizeEvidenceText, startsAttachedEvidenceQualification } from '../utils/evidenceTextBoundaries';
export { startsAttachedEvidenceQualification } from '../utils/evidenceTextBoundaries';

export type VerifiedEvidenceClaim = {
  text: string;
  recordId: string;
  quote: string;
  /** Present only when the record has independent, exact URL verification. */
  canonicalUrl?: string;
  supportKind: 'EXACT_SOURCE_QUOTE' | 'REVIEWED_EDITORIAL_SUMMARY';
  sourceBinding?: VerifiedDocumentBinding;
  /** Current revalidation scope for an independently admitted managed document. */
  sourceAdmissionOptions?: Pick<SharedDocumentAdmissionOptions,
    'targetDate' | 'expectedAuthority' | 'expectedDomain' | 'applicabilityTarget'>;
};

export type RejectedEvidenceClaim = {
  text: string;
  reason: string;
};

export type EvidenceClaimsVerificationResult = {
  accepted: VerifiedEvidenceClaim[];
  rejected: RejectedEvidenceClaim[];
};

export interface VerifyEvidenceClaimsOptions {
  missingFacts: string[];
  targetDate?: string;
  referenceDate?: string;
  expectedAuthority?: StatutoryAuthority;
  expectedDomain?: QueryDomain;
  applicabilityTarget?: 'ACRA_FYE';
  versioningManager?: SourceVersioningManager;
  boundedCoverageRequest?: BoundedCoverageRequest;
}

export interface BoundedCoverageRequest {
  authority: StatutoryAuthority;
  topicId: string;
  query: string;
  subject: string;
}

interface BoundedCoverageRuleProfile {
  authority: StatutoryAuthority;
  domain: string;
  officialUrls: readonly string[];
}

const BOUNDED_COVERAGE_RULE_PROFILES: Readonly<Record<string, BoundedCoverageRuleProfile>> = {
  'IRAS:iras-gst-standard-rated-supplies': {
    authority: 'IRAS', domain: 'IRAS_GST',
    officialUrls: ['https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-to-charge-goods-and-services-tax-(gst)']
  },
  'IRAS:iras-gst-zero-rating': {
    authority: 'IRAS', domain: 'IRAS_GST',
    officialUrls: ['https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/goods-and-services-tax-(gst)-what-it-is-and-how-it-works', 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/completing-gst-returns']
  },
  'IRAS:iras-gst-exempt-supplies': {
    authority: 'IRAS', domain: 'IRAS_GST',
    officialUrls: ['https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/goods-and-services-tax-(gst)-what-it-is-and-how-it-works']
  },
  'IRAS:iras-gst-out-of-scope-supplies': {
    authority: 'IRAS', domain: 'IRAS_GST',
    officialUrls: ['https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-is-gst-not-charged/out-of-scope-supplies']
  },
  'ACRA:acra_agm': {
    authority: 'ACRA', domain: 'ACRA_CORP',
    officialUrls: ['https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/holding-annual-general-meetings/due-dates-requirements/']
  },
  'ACRA:acra_annual-returns': {
    authority: 'ACRA', domain: 'ACRA_CORP',
    officialUrls: ['https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-annual-returns-companies/deadline-requirements/']
  },
  'MOM:mom-part-iv-overtime': {
    authority: 'MOM', domain: 'MOM_EMPLOYMENT',
    officialUrls: ['https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days']
  },
  'MOM:mom_overtime': {
    authority: 'MOM', domain: 'MOM_EMPLOYMENT',
    officialUrls: ['https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days']
  },
  'IRAS:iras-gst-input-tax': {
    authority: 'IRAS', domain: 'IRAS_GST',
    officialUrls: ['https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax']
  },
  'IRAS:iras-cit-eci': {
    authority: 'IRAS', domain: 'IRAS_TAX',
    officialUrls: ['https://www.iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-(eci)-filing']
  },
  'CPF:cpf-ordinary-wages': {
    authority: 'CPF', domain: 'CPF_BOARD',
    officialUrls: ['https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions']
  },
  'CPF:cpf-additional-wages': {
    authority: 'CPF', domain: 'CPF_BOARD',
    officialUrls: ['https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions']
  },
  'CPF:cpf-bonus-backpay': {
    authority: 'CPF', domain: 'CPF_BOARD',
    officialUrls: ['https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions']
  },
  'ACRA:acra_company-secretary': {
    authority: 'ACRA', domain: 'ACRA_CORP',
    officialUrls: ['https://www.acra.gov.sg/register/business/registering-different-business-structures/local-company/appointing-company-directors-other-key-officers/']
  },
  'MAS:mas-regulatory-reporting': {
    authority: 'MAS', domain: 'MAS_FUNDS',
    officialUrls: ['https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit--vcfms29-may-2026-clean.pdf',
      'https://www.mas.gov.sg/-/media/mas-media-library/regulation/guidance/cmi/compliance-toolkits-for-fund-management-companies/sfa-compliance-toolkit-lfmcs29-may-2026-clean.pdf']
  },
  'IRAS:iras-gst-filing-deadlines': {
    authority: 'IRAS', domain: 'IRAS_GST',
    officialUrls: ['https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/gst-filing-due-dates-and-requests-for-extension']
  },
  'CPF:cpf-contribution-due-dates': {
    authority: 'CPF', domain: 'CPF_BOARD',
    officialUrls: [
      'https://www.cpf.gov.sg/service/article/when-is-the-due-date-for-cpf-contributions',
      'https://www.cpf.gov.sg/employer/compliance-and-rectifications/enforcement-and-penalties-for-non-compliance'
    ]
  },
  'CPF:cpf_contribution_rates': {
    authority: 'CPF', domain: 'CPF_BOARD',
    officialUrls: ['https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay']
  },
  'CPF:cpf-employee-coverage': {
    authority: 'CPF', domain: 'CPF_BOARD',
    officialUrls: ['https://www.cpf.gov.sg/employer/employer-obligations/who-should-receive-cpf-contributions']
  },
  'CPF:cpf-contribution-computation': {
    authority: 'CPF', domain: 'CPF_BOARD',
    officialUrls: ['https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay']
  },
  'CPF:cpf-pr-contribution-rates': {
    authority: 'CPF', domain: 'CPF_BOARD',
    officialUrls: ['https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay']
  },
  'MOM:mom-salary-payment': {
    authority: 'MOM', domain: 'MOM_EMPLOYMENT',
    officialUrls: ['https://www.mom.gov.sg/employment-practices/salary/paying-salary',
      'https://www.mom.gov.sg/employment-practices/salary/salary-deductions']
  },
  'ACRA:acra_small_company': {
    authority: 'ACRA', domain: 'ACRA_CORP',
    officialUrls: ['https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/preparing-financial-statements/audit-exemptions/']
  },
  'ACRA:acra_audit-requirements': {
    authority: 'ACRA', domain: 'ACRA_CORP',
    officialUrls: ['https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/preparing-financial-statements/audit-exemptions/']
  },
  'MAS:mas-vcfm': {
    authority: 'MAS', domain: 'MAS_FUNDS',
    officialUrls: ['https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing']
  },
  'MAS:mas-fund-management-exemptions': {
    authority: 'MAS', domain: 'MAS_FUNDS',
    officialUrls: ['https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing']
  }
};

function sameExactOfficialCoverageUrl(actualValue: string, expectedValue: string): boolean {
  try {
    const actual = new URL(actualValue);
    const expected = new URL(expectedValue);
    return actual.protocol === 'https:' && !actual.username && !actual.password && !actual.port &&
      !actual.search && !actual.hash && actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function recordBoundToCoverageTopic(record: AuthoritativeSourceRecord, topicId: string): boolean {
  const topic = getCoverageTopicById(topicId);
  return Boolean(topic && (topic.sourceRecordIds.includes(record.id) ||
    [...(record.tags || []), ...(record.relatedTopicIds || []), ...(record.sourceMapTopicIds || []),
      ...(record.retrievalHints || [])].includes(topicId)));
}

/** Narrow fallback for complete native list/section quotes. The normal generic span rules remain unchanged. */
function isExactBoundedCoverageRuleSpan(
  record: AuthoritativeSourceRecord,
  quote: string,
  request: BoundedCoverageRequest | undefined
): boolean {
  if (!request) return false;
  const momSalaryRuleQuote = request.authority === 'MOM' && request.topicId === 'mom-salary-payment'
    ? selectMomSalaryPaymentRuleQuote(request.query, record.sourceText)
    : undefined;
  // The exact contiguous-span profile is exclusively for the new ordinary
  // salary-period rule. Leave final-salary and salary-deduction evidence to
  // their established full-source rule profiles.
  if (request.authority === 'MOM' && request.topicId === 'mom-salary-payment' &&
      momSalaryRuleQuote !== undefined &&
      supportMomSalaryPaymentIssue(request.query, request.subject, record.sourceText) === true) {
    const officialUrl = 'https://www.mom.gov.sg/employment-practices/salary/paying-salary';
    return record.provenance === 'LIVE_EXTERNAL' && record.lifecycleState === 'CANDIDATE' &&
      record.sourceStatus === 'NEEDS_REVIEW' && !record.validTo && record.authority === 'MOM' &&
      record.sourceAuthority === 'MOM' && record.domain === 'MOM_EMPLOYMENT' &&
      recordBoundToCoverageTopic(record, 'mom-salary-payment') &&
      typeof record.officialSourceUrl === 'string' && typeof record.canonicalSourceUrl === 'string' &&
      sameExactOfficialCoverageUrl(record.officialSourceUrl, officialUrl) &&
      sameExactOfficialCoverageUrl(record.canonicalSourceUrl, officialUrl) &&
      momSalaryRuleQuote === quote;
  }
  const legacyProfile = BOUNDED_COVERAGE_RULE_PROFILES[`${request.authority}:${request.topicId}`];
  const knowledgeUrls = STATUTORY_KNOWLEDGE_POINTERS_20261027B.filter(pointer =>
    pointer.authority === request.authority && pointer.topicIds.includes(request.topicId)).map(pointer => pointer.url);
  const knowledgeDomains: Readonly<Record<string, string>> = { IRAS: request.topicId.includes('gst') ? 'IRAS_GST' : 'IRAS_TAX',
    CPF: 'CPF_BOARD', ACRA: 'ACRA_CORP', MOM: 'MOM_EMPLOYMENT', MAS: 'MAS_FUNDS' };
  const knowledgeDomain = knowledgeDomains[request.authority];
  const profile = legacyProfile || (knowledgeUrls.length && knowledgeDomain
    ? { authority: request.authority, domain: knowledgeDomain, officialUrls: knowledgeUrls } : undefined);
  if (!profile || profile.authority !== request.authority || record.authority !== profile.authority ||
      record.sourceAuthority !== profile.authority || record.domain !== profile.domain ||
      !recordBoundToCoverageTopic(record, request.topicId) ||
      typeof record.officialSourceUrl !== 'string' || typeof record.canonicalSourceUrl !== 'string' ||
      ![...profile.officialUrls, ...knowledgeUrls].some(expectedUrl =>
        sameExactOfficialCoverageUrl(record.officialSourceUrl!, expectedUrl) &&
        sameExactOfficialCoverageUrl(record.canonicalSourceUrl!, expectedUrl))) return false;
  const coverageRequest = {
    authority: request.authority, topicId: request.topicId,
    query: request.query, subject: request.subject, sourceText: record.sourceText,
    officialUrl: record.officialSourceUrl
  };
  const fullRecordProof = supportPracticalExpansionRule(coverageRequest) ??
    supportIrasCpfCoverageRule(coverageRequest) ?? supportMomAcraMasCoverageRule(coverageRequest);
  if (fullRecordProof !== true) return false;
  const quoteProof = supportPracticalExpansionRule({ ...coverageRequest, sourceText: quote }) ??
    supportIrasCpfCoverageRule({ ...coverageRequest, sourceText: quote }) ??
    supportMomAcraMasCoverageRule({ ...coverageRequest, sourceText: quote });
  const expansionProof = supportPracticalExpansionRule(coverageRequest);
  // An expansion component may establish one premise of the complete rule.
  // Require the full document proof and exact selector membership here; the
  // workstream requires every selected premise from this same record below.
  if (quoteProof !== true && expansionProof !== true) return false;
  const exactSelectedSpans = [
    ...selectPracticalExpansionQuotes(coverageRequest),
    ...selectIrasCpfCoverageQuotes(coverageRequest),
    ...selectMomAcraMasCoverageQuotes(coverageRequest)
  ];
  return exactSelectedSpans.some(selected => normalizeEvidenceText(selected) === normalizeEvidenceText(quote));
}

const APPLICATION_SOURCE_TYPES = new Set(['APPLICATION_RULE']);
const COMMON_ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|mr|mrs|ms|dr|prof|no|nos|sec|secs|s|para|paras|art|arts|pt|ltd|pte|co)\.$/i;

function isIncompleteColonEndedQuote(value: string): boolean {
  const normalized = normalizeEvidenceText(value);
  return /:$/.test(normalized) || /^exceptions?$/i.test(normalized);
}

function isCompleteIndividualFtcConditionsQuote(sourceText: string, quote: string): boolean {
  const blocks = sourceText
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/)
    .map(block => block.trim())
    .filter(Boolean);
  const normalizedQuote = normalizeEvidenceText(quote);
  for (let introIndex = 0; introIndex + 3 < blocks.length; introIndex += 1) {
    if (!/^anyone claiming ftc must satisfy all of the following conditions:$/i.test(blocks[introIndex])) continue;
    const hasHeading = introIndex > 0 && /^conditions for claiming (?:foreign tax credit|ftc)$/i.test(blocks[introIndex - 1]);
    const quoteStart = hasHeading ? introIndex - 1 : introIndex;
    const conditionItems: string[] = [];
    let cursor = introIndex + 1;
    while (cursor < blocks.length && /^(?:\|\s*)*[•◦▪](?:\s|$)/.test(blocks[cursor])) {
      conditionItems.push(blocks[cursor].replace(/^(?:\|\s*)*[•◦▪]\s*/, ''));
      cursor += 1;
    }
    if (conditionItems.length !== 3) continue;
    const combinedConditions = conditionItems.join(' ').toLowerCase();
    const hasResidencyCondition = /tax resident in singapore/.test(conditionItems[0].toLowerCase());
    const hasForeignTaxPaidCondition = /tax has been paid or is payable on the same income in the foreign country/i.test(combinedConditions);
    const hasSingaporeTaxabilityCondition = /income is taxable in singapore/i.test(combinedConditions);
    if (!hasResidencyCondition || !hasForeignTaxPaidCondition || !hasSingaporeTaxabilityCondition) continue;

    let attachedEnd = cursor - 1;
    while (attachedEnd + 1 < blocks.length && startsAttachedEvidenceQualification(blocks[attachedEnd + 1])) attachedEnd += 1;
    const completeQuote = normalizeEvidenceText(blocks.slice(quoteStart, attachedEnd + 1).join(' '));
    const completeListOnlyQuote = normalizeEvidenceText(blocks.slice(introIndex, attachedEnd + 1).join(' '));
    if (completeQuote === normalizedQuote || completeListOnlyQuote === normalizedQuote) return true;
  }
  return false;
}

function isCompleteIndividualOverseasIncomeListQuote(sourceText: string, quote: string): boolean {
  const blocks = sourceText
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/)
    .map(block => block.trim())
    .filter(Boolean);
  const normalizedQuote = normalizeEvidenceText(quote);
  const startIndex = blocks.findIndex(block => /^overseas income is taxable in singapore when:$/i.test(block));
  if (startIndex < 0) return false;
  const endIndex = blocks.findIndex((block, index) => index > startIndex && /^a\. tax treatment in singapore$/i.test(block));
  if (endIndex < 0) return false;
  const section = blocks.slice(startIndex, endIndex);
  const bullets = section.filter(block => /^(?:\|\s*)*[•◦▪](?:\s|$)/.test(block));
  const text = section.join(' ').toLowerCase();
  if (bullets.length < 6 ||
      !/overseas employment is incidental to (?:your|his|her) singapore employment/.test(text) ||
      !/you are employed outside of singapore on behalf of the government of singapore/.test(text) ||
      !/services rendered in singapore/.test(text)) return false;
  return normalizeEvidenceText(section.join(' ')) === normalizedQuote;
}

function parseIrasEciDeadlineListItem(block: string, position: 1 | 2): 'WAIVER' | 'NON_FILING' | undefined {
  const match = /^(?:(•)\s+|([1-2])[.)]\s+)(.+)$/u.exec(block.trim());
  if (!match || (match[2] && Number(match[2]) !== position)) return undefined;
  const text = match[3].trim();
  if (position === 1 && /^your company qualifies for the eci filing waiver;\s*or$/i.test(text)) return 'WAIVER';
  if (position === 2 && /^your company is specifically not required to file eci\.?$/i.test(text)) return 'NON_FILING';
  return undefined;
}

function irasEciDeadlineBlocks(sourceText: string): { blocks: string[]; introIndex: number } | undefined {
  const blocks = sourceText
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/)
    .map(block => block.trim())
    .filter(Boolean);
  const introIndexes = blocks.flatMap((block, index) =>
    normalizeEvidenceText(block).toLowerCase() ===
      'your company has to file eci within 3 months from the end of your financial year unless:'
      ? [index] : []);
  return introIndexes.length === 1 ? { blocks, introIndex: introIndexes[0] } : undefined;
}

function hasIrasEciColonEndedIntro(sourceText: string): boolean {
  return sourceText
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/)
    .some(block => normalizeEvidenceText(block).toLowerCase() ===
      'your company has to file eci within 3 months from the end of your financial year unless:');
}

function isIrasEciDeadlineListComponentQuote(sourceText: string, quote: string): boolean {
  const blocks = sourceText
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/)
    .map(block => block.trim())
    .filter(Boolean);
  const normalizedQuote = normalizeEvidenceText(quote);
  const introIndexes = blocks.flatMap((block, index) =>
    normalizeEvidenceText(block).toLowerCase() ===
      'your company has to file eci within 3 months from the end of your financial year unless:'
      ? [index] : []);
  for (const introIndex of introIndexes) {
    let listEnd = introIndex;
    while (listEnd + 1 < blocks.length && /^(?:•|◦|▪|[1-9][.)])\s/.test(blocks[listEnd + 1])) listEnd += 1;
    for (let start = introIndex; start <= listEnd; start += 1) {
      for (let end = start; end <= listEnd; end += 1) {
        if (normalizeEvidenceText(blocks.slice(start, end + 1).join(' ')) === normalizedQuote) return true;
      }
    }
  }
  return false;
}

/**
 * Returns the exact bounded IRAS ECI filing paragraph and its two ordered
 * exceptions. List markers are retained by the official-page text validator;
 * an incomplete, reordered, expanded, or changed list is not quotable.
 */
export function completeIrasEciFilingDeadlineQuote(sourceText: string): string | undefined {
  const source = irasEciDeadlineBlocks(sourceText);
  if (!source) return undefined;
  const { blocks, introIndex } = source;
  if (parseIrasEciDeadlineListItem(blocks[introIndex + 1] || '', 1) !== 'WAIVER' ||
      parseIrasEciDeadlineListItem(blocks[introIndex + 2] || '', 2) !== 'NON_FILING' ||
      /^(?:•|◦|▪|[1-9][.)])\s/.test(blocks[introIndex + 3] || '') ||
      startsAttachedEvidenceQualification(blocks[introIndex + 3] || '')) return undefined;
  const quote = blocks.slice(introIndex, introIndex + 3).join('\n\n');
  return quote.length <= 3_200 ? quote : undefined;
}

function isPartialIrasEciFilingDeadlineQuote(sourceText: string, quote: string): boolean {
  const source = irasEciDeadlineBlocks(sourceText);
  if (!source) return false;
  const { blocks, introIndex } = source;
  const normalizedQuote = normalizeEvidenceText(quote);
  if (normalizedQuote === normalizeEvidenceText(blocks[introIndex])) return true;
  const firstItem = blocks[introIndex + 1] || '';
  const secondItem = blocks[introIndex + 2] || '';
  if (parseIrasEciDeadlineListItem(firstItem, 1) === 'WAIVER' &&
      normalizedQuote === normalizeEvidenceText([blocks[introIndex], firstItem].join(' '))) return true;
  if (parseIrasEciDeadlineListItem(secondItem, 2) === 'NON_FILING' &&
      normalizedQuote === normalizeEvidenceText(secondItem)) return true;
  if (parseIrasEciDeadlineListItem(firstItem, 1) === 'WAIVER' &&
      normalizedQuote === normalizeEvidenceText(firstItem)) return true;
  return false;
}

function isIrasEciFilingDeadlineRecord(record: AuthoritativeSourceRecord): boolean {
  return record.authority === 'IRAS' && record.domain === 'IRAS_TAX' &&
    [...(record.tags || []), ...(record.relatedTopicIds || []), ...(record.sourceMapTopicIds || [])]
      .includes('iras-cit-eci');
}

/**
 * IRAS CPF top-up eligibility is one source section: a two-item numbered
 * qualification list, followed by the current MRSS and MMSS exclusions. Keep
 * the exact contiguous source span so no list item or attached exclusion can
 * be omitted while quoting the complete eligibility proposition.
 */
export function completeIrasCpfCashTopUpEligibilityQuote(sourceText: string): string | undefined {
  const blocks = sourceText
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/)
    .map(block => block.trim())
    .filter(Boolean);
  const introIndex = blocks.findIndex(block => /\bcpf cash top[ -]?up relief is given to encourage\b/i.test(block));
  const qualificationIndex = blocks.findIndex((block, index) => index > introIndex &&
    /\bto qualify for the tax relief\b/i.test(block) && /:\s*$/.test(block));
  if (introIndex < 0 || qualificationIndex < 0) return undefined;

  const items: string[] = [];
  for (let index = qualificationIndex + 1; index < blocks.length; index += 1) {
    const lines = blocks[index].split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const numberedLines = lines.filter(line => /^\d+[.)]\s+/.test(line));
    if (numberedLines.length > 0) {
      items.push(...numberedLines.map(line => line.replace(/^\d+[.)]\s+/, '')));
      continue;
    }
    if (items.length > 0) break;
  }
  if (items.length !== 2 ||
      !/\bsingapore citizen\s*\/\s*permanent resident\b|\bsingapore citizen or permanent resident\b/i.test(items[0]) ||
      !/\bcash top[ -]?ups?\b/i.test(items[1]) ||
      !/\b(?:preceding|previous) year\b|\bin 20\d{2}\b/i.test(items[1]) ||
      !/\bretirement sum topping[ -]?up scheme\b|\brstu\b/i.test(items[1])) return undefined;

  const mrssIndex = blocks.findIndex((block, index) => index > qualificationIndex &&
    /\bmatched retirement savings scheme\b/i.test(block) &&
    /\bmatching grants?\b/i.test(block) && /\bwill not be eligible\b/i.test(block));
  const mmssIndex = blocks.findIndex((block, index) => index > mrssIndex &&
    /\bmatched medisave scheme\b/i.test(block) &&
    /\bmatching grants?\b/i.test(block) && /\bwill not qualify\b/i.test(block));
  if (mrssIndex < 0 || mmssIndex < 0 || mmssIndex <= mrssIndex) return undefined;
  const quote = blocks.slice(introIndex, mmssIndex + 1).join('\n\n');
  return quote.length <= 5_000 ? quote : undefined;
}

/**
 * Returns the two complete CPF top-up limit sections as exact contiguous
 * source spans. The headline annual caps and the own-account FRS table are a
 * single completeness unit: if either section is absent or cannot be bounded,
 * callers must keep the limit proposition incomplete.
 */
export function completeIrasCpfCashTopUpLimitQuotes(sourceText: string): string[] {
  const blocks = sourceText
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/)
    .map(block => block.trim())
    .filter(Boolean);
  const headlineIndex = blocks.findIndex(block =>
    /\$\s*16,?000\b/i.test(block) &&
    /\$\s*8,?000\b[^.!?;:]{0,80}\bfor self\b/i.test(block) &&
    /\$\s*8,?000\b[^.!?;:]{0,100}\bfor family members\b/i.test(block) &&
    /\b(?:eligible )?cpf cash top[ -]?ups?\b/i.test(block)
  );
  if (headlineIndex < 0) return [];

  const mrssIndex = blocks.findIndex((block, index) => index < headlineIndex &&
    /\bmatched retirement savings scheme\b/i.test(block) &&
    /\bmatching grants?\b/i.test(block) && /\bwill not be eligible\b/i.test(block));
  const mmssIndex = blocks.findIndex((block, index) => index > mrssIndex && index < headlineIndex &&
    /\bmatched medisave scheme\b/i.test(block) &&
    /\bmatching grants?\b/i.test(block) && /\bwill not qualify\b/i.test(block));
  if (mrssIndex < 0 || mmssIndex < 0 || mmssIndex >= headlineIndex) return [];

  const overallCapIndex = blocks.findIndex((block, index) => index > headlineIndex &&
    /\bpersonal income tax relief cap of \$\s*80,?000\b/i.test(block) &&
    /\btotal amount of all tax reliefs claimed\b/i.test(block) &&
    /\bincluding\b[^.!?]{0,140}\bcash top[ -]?ups?\b/i.test(block));
  if (overallCapIndex <= headlineIndex) return [];
  let headlineEnd = overallCapIndex;
  while (headlineEnd + 1 < blocks.length && startsAttachedEvidenceQualification(blocks[headlineEnd + 1])) {
    headlineEnd += 1;
  }
  const headlineQuote = blocks.slice(mrssIndex, headlineEnd + 1).join('\n\n');
  if (headlineQuote.length > 3_200) return [];

  const tableHeadingIndex = blocks.findIndex((block, index) => index > overallCapIndex &&
    /^(?:#{1,6}\s*)?limit on cash top[ -]?up amount for computing tax relief$/i.test(block));
  const tableIntroductionIndex = blocks.findIndex((block, index) => index > overallCapIndex &&
    /\bthere is a limit on the amount of cash top[ -]?ups? to self and your family members that qualifies for tax relief\b/i.test(block));
  const tableHeaderIndex = blocks.findIndex((block, index) => index >= tableIntroductionIndex &&
    /\bage of recipients\b/i.test(block) && /\blimit on cash top[ -]?up amount for computing tax relief\b/i.test(block));
  const tableStart = tableHeadingIndex >= 0 && tableIntroductionIndex > tableHeadingIndex
    ? tableHeadingIndex
    : tableIntroductionIndex;
  if (tableStart < 0 || tableHeaderIndex < 0) return [];

  const saIndex = blocks.findIndex((block, index) => index >= tableHeaderIndex &&
    /\brecipients below age 55\b/i.test(block) &&
    /\bspecial account\s*\(sa\)(?![a-z0-9])/i.test(block) &&
    /\b(?:full retirement sum|frs)\b/i.test(block) &&
    /\bsa savings\b/i.test(block) && /\b(?:withdraw\w*|investment\w*)\b/i.test(block));
  const raIndex = blocks.findIndex((block, index) => index >= tableHeaderIndex &&
    /\brecipients aged 55 years and above\b/i.test(block) &&
    /\bretirement account\s*\(ra\)(?![a-z0-9])/i.test(block) &&
    /\b(?:full retirement sum|frs)\b/i.test(block));
  const hasCompleteInlineAccountRows = saIndex >= 0 && raIndex >= saIndex;
  let lastAccountRowIndex: number;
  let tableEnd: number;
  let tableText: string;
  if (hasCompleteInlineAccountRows) {
    // Preserve the reviewed one-block layout exactly. The split-row branch
    // below handles extracted tables whose cells and list items become separate
    // source blocks.
    lastAccountRowIndex = Math.max(saIndex, raIndex);
    const tableEndMarkerIndex = blocks.findIndex((block, index) => index > lastAccountRowIndex &&
      (/^to check your top[ -]?up limit\b/i.test(block) || /^for the yas? 20\d{2}\b/i.test(block)));
    const tableEndMarkerInLastRow = /\bto check your top[ -]?up limit\b/i.test(blocks[lastAccountRowIndex]);
    if (tableEndMarkerIndex < 0 && !tableEndMarkerInLastRow) return [];
    tableEnd = tableEndMarkerIndex >= 0 ? tableEndMarkerIndex - 1 : lastAccountRowIndex;
    if (tableEnd < lastAccountRowIndex) return [];
    tableText = blocks.slice(tableStart, tableEnd + 1).join(' ');
  } else {
    // Some official-page table extractors retain each recipient, condition,
    // calculation and footnote as a separate paragraph. Require one ordered
    // SA row and one ordered RA row, then validate their conditions separately
    // so one row can never supply another row's missing qualification.
    const endMarkerIndexes = blocks.flatMap((block, index) => index > tableHeaderIndex &&
      /^to check your top[ -]?up limit\b/i.test(block) ? [index] : []);
    if (endMarkerIndexes.length !== 1) return [];
    const endMarkerIndex = endMarkerIndexes[0];
    const saMarkerIndexes = blocks.flatMap((block, index) => index >= tableHeaderIndex && index < endMarkerIndex &&
      /^for recipients below age 55\b/i.test(block) ? [index] : []);
    const raMarkerIndexes = blocks.flatMap((block, index) => index >= tableHeaderIndex && index < endMarkerIndex &&
      /^for recipients aged 55 years and above\b/i.test(block) ? [index] : []);
    if (saMarkerIndexes.length !== 1 || raMarkerIndexes.length !== 1 ||
        saMarkerIndexes[0] >= raMarkerIndexes[0]) return [];
    const splitRaIndex = raMarkerIndexes[0];
    lastAccountRowIndex = splitRaIndex;
    tableEnd = endMarkerIndex - 1;
    if (tableEnd < lastAccountRowIndex) return [];
    tableText = blocks.slice(tableStart, tableEnd + 1).join(' ');
  }
  const embeddedTableEndMarkers = [...tableText.matchAll(/\bto check your top[ -]?up limit\b/gi)];
  if (embeddedTableEndMarkers.length > 1) return [];
  // A collapsed extractor can place the table-end instruction and following
  // prose in the same block. Validate every row and qualification only against
  // the bytes before that boundary while retaining the original exact span.
  const tableValidationText = embeddedTableEndMarkers.length === 1
    ? tableText.slice(0, embeddedTableEndMarkers[0].index)
    : tableText;
  const saAgeMarkers = [...tableValidationText.matchAll(/\bFor recipients below age 55\b/gi)];
  const raAgeMarkers = [...tableValidationText.matchAll(/\bFor recipients aged 55 years and above\b/gi)];
  if (saAgeMarkers.length !== 1 || raAgeMarkers.length !== 1 ||
      saAgeMarkers[0].index === undefined || raAgeMarkers[0].index === undefined ||
      saAgeMarkers[0].index >= raAgeMarkers[0].index) return [];
  const saRowText = tableValidationText.slice(saAgeMarkers[0].index, raAgeMarkers[0].index);
  const raRowText = tableValidationText.slice(raAgeMarkers[0].index);
  // A flattened table block can contain all of the correct phrases while
  // assigning the RA formula and its savings qualification to the wrong age.
  // Keep these conditions inside the age category that governs each account.
  if (!/\bspecial account\s*\(sa\)(?![a-z0-9])/i.test(saRowText) ||
      !/\b(?:full retirement sum|frs)\b/i.test(saRowText) ||
      !/\bmaximum allowed cash top[ -]?up\s*:\s*frs\s*[-–—]\s*sa savings\b/i.test(saRowText) ||
      !/\bamount withdrawn from sa for investments\b/i.test(saRowText) ||
      !/net sa savings withdrawn under cpf investment scheme\s*\(cpfis\)[^.!?]{0,180}investments that have not been completely disposed of/i.test(saRowText) ||
      !/\bretirement account\s*\(ra\)(?![a-z0-9])/i.test(raRowText) ||
      !/\b(?:full retirement sum|frs)\b/i.test(raRowText) ||
      !/\bmaximum allowed cash top[ -]?up\s*:\s*frs\s*[-–—]\s*ra\b/i.test(raRowText) ||
      !/ra savings refers to the cash set aside in the ra[^.!?]{0,220}plus amounts withdrawn/i.test(raRowText)) return [];
  if (!/\bage of recipients\b/i.test(blocks[tableHeaderIndex]) ||
      !/\blimit on cash top[ -]?up amount for computing tax relief\b/i.test(blocks[tableHeaderIndex]) ||
      !/\brecipients below age 55\b/i.test(tableValidationText) ||
      !/\bspecial account\s*\(sa\)(?![a-z0-9])/i.test(tableValidationText) ||
      !/\brecipients aged 55 years and above\b/i.test(tableValidationText) ||
      !/\bretirement account\s*\(ra\)(?![a-z0-9])/i.test(tableValidationText) ||
      !/\b(?:full retirement sum|frs)\b/i.test(tableValidationText) ||
      !/\bmaximum allowed cash top[ -]?up\b/i.test(tableValidationText)) return [];
  const mediSaveRows = [...tableValidationText.matchAll(/\(b\)\s*Top-up to MediSave Account\s*\(MA\):[\s\S]*?(?=For recipients aged 55 years and above|To check your top[ -]?up limit|$)/gi)]
    .map(match => match[0]);
  const tableDefinesBhs = /\bBasic Healthcare Sum\s*\(BHS\)/i.test(tableValidationText);
  if (!tableDefinesBhs || mediSaveRows.length !== 2 || mediSaveRows.some(row =>
    !/(?:\bBasic Healthcare Sum\s*\(BHS\)|\bthe BHS\b)/i.test(row) ||
    !/\bself-employed person\s*\(SEP\)[^.!?]{0,120}must be up-to-date with their MediSave payable/i.test(row) ||
    !/\bmaximum allowed cash top[ -]?up:\s*BHS\s*[-–—]\s*MA balance before the top-up\b/i.test(row))) return [];
  let boundedTableEnd = tableEnd;
  while (boundedTableEnd + 1 < blocks.length && startsAttachedEvidenceQualification(blocks[boundedTableEnd + 1])) {
    boundedTableEnd += 1;
  }
  const tableQuote = blocks.slice(tableStart, boundedTableEnd + 1).join('\n\n');
  if (tableQuote.length > 3_200) return [];
  return [headlineQuote, tableQuote];
}

/** Complete, contiguous IRAS motor-car connected-person exception and both qualifications. */
export function completeIrasGstMotorCarConnectedPersonExceptionQuote(sourceText: string): string | undefined {
  const blocks = sourceText
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/)
    .map(block => block.trim())
    .filter(Boolean);
  const legacyHeadingIndex = blocks.findIndex(block => /\bexpenses on motor car used by a connected person\b/i.test(block));
  const currentHeadingIndex = blocks.findIndex(block => /^motor car used by a connected person\b/i.test(block));
  if (legacyHeadingIndex < 0 && currentHeadingIndex >= 0) {
    const headingIndex = currentHeadingIndex;
    const ruleIndex = blocks.findIndex((block, index) => index > headingIndex &&
      /\bfrom 1 jan(?:uary)? 2023\b/i.test(block) &&
      /\bwhere a motor car is used by a connected person\b/i.test(block) &&
      /\bgst incurred on the motor car expenses is generally not claimable\b/i.test(block) &&
      /\ban exception applies only if you satisfy both of the following conditions\b/i.test(block) &&
      /\bin addition to the conditions for claiming input tax\b/i.test(block));
    const item1Index = blocks.findIndex((block, index) => index > ruleIndex &&
      /^\s*•\s*you recover the motor car expenses from the connected person\b/i.test(block));
    const item2Index = blocks.findIndex((block, index) => index > item1Index &&
      /^\s*•\s*the recovery is not ancillary to (?:any primary supply made by you to the connected person|any primary supply you make to them)\b/i.test(block));
    const recipientRestrictionIndex = blocks.findIndex((block, index) => index > item2Index &&
      /^where the connected person is gst-registered, the input tax claim on the motor car expenses recovered by you is disallowed under regulation 27\b/i.test(block));
    if (ruleIndex <= headingIndex || item1Index <= ruleIndex || item2Index <= item1Index ||
        recipientRestrictionIndex <= item2Index ||
        !/\brecover only a portion\b[^.!?;:]{0,100}\bonly claim input tax to the extent of the portion recovered\b/i.test(blocks[item1Index])) {
      return undefined;
    }
    const currentQuote = blocks.slice(headingIndex, recipientRestrictionIndex + 1).join('\n\n');
    return currentQuote.length <= 5_000 ? currentQuote : undefined;
  }
  const headingIndex = legacyHeadingIndex;
  if (headingIndex < 0) return undefined;
  const item1Index = blocks.findIndex((block, index) => index > headingIndex && /^\s*1[.)]\s+/m.test(block));
  const item2Index = blocks.findIndex((block, index) => index > item1Index && /^\s*2[.)]\s+/m.test(block));
  if (item1Index < 0 || item2Index <= item1Index) return undefined;
  const headingAndItems = blocks.slice(headingIndex, item2Index + 1).join(' ');
  if (!/\bconnected person\b/i.test(headingAndItems) ||
      !/\bunless you satisfy both of the following conditions\b/i.test(headingAndItems) ||
      !/\brecover the motor car expenses from the connected person\b/i.test(headingAndItems) ||
      !/\brecover only a portion\b[^.!?;:]{0,100}\bonly claim input tax to the extent of the portion recovered\b/i.test(headingAndItems) ||
      !/\bthe recovery is not ancillary to any primary supply\b/i.test(headingAndItems)) return undefined;

  let endIndex = item2Index;
  for (let index = item2Index + 1; index < blocks.length; index += 1) {
    if (/^other motor vehicles\b/i.test(blocks[index]) || /^goods given away\b/i.test(blocks[index])) break;
    if (/^(?:to determine whether the recovery|in instances where both conditions)\b/i.test(blocks[index])) endIndex = index;
    else if (endIndex < index - 1 && /^(?:examples?:|faqs?:|common errors?\b)/i.test(blocks[index])) break;
  }
  const quote = blocks.slice(headingIndex, endIndex + 1).join('\n\n');
  return quote.length <= 5_000 ? quote : undefined;
}

function normalizeApprovedHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const raw = value.trim();
  const authority = raw.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (!authority || authority.includes('@') || authority.includes(':')) return undefined;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
        !isApprovedSingaporeSourceUrl(raw)) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function findDateRejection(
  record: AuthoritativeSourceRecord,
  targetDate: string | undefined
): string | undefined {
  if (targetDate !== undefined && !isIsoDate(targetDate)) return 'TARGET_DATE_INVALID';

  const validFrom = record.validFrom || record.effectiveDate;
  const validTo = record.validTo;
  if (validFrom !== undefined && !isIsoDate(validFrom)) return 'SOURCE_DATE_BOUNDS_INVALID';
  if (validTo !== undefined && !isIsoDate(validTo)) return 'SOURCE_DATE_BOUNDS_INVALID';

  if (record.sourceStatus === 'HISTORICAL') {
    if (!targetDate) return 'HISTORICAL_TARGET_DATE_REQUIRED';
    if (!validFrom || !validTo) return 'HISTORICAL_DATE_BOUNDS_REQUIRED';
  }
  if (!targetDate) return undefined;

  if (validFrom && targetDate < validFrom) return 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE';
  if (validTo && targetDate > validTo) return 'SOURCE_NOT_IN_EFFECT_ON_TARGET_DATE';

  // A current source with no stated effective period cannot substantiate a
  // date earlier than the snapshot that was reviewed or retrieved.
  if (!validFrom) {
    const capturedDate = record.provenance === 'LIVE_EXTERNAL'
      ? record.retrievedAt?.slice(0, 10)
      : record.lastVerifiedDate;
    if (!isIsoDate(capturedDate) || targetDate < capturedDate) return 'TARGET_DATE_UNBOUNDED';
  }
  return undefined;
}

export function findRecordEligibilityRejection(
  record: AuthoritativeSourceRecord,
  targetDate?: string,
  referenceDate?: string,
  versioningManager: SourceVersioningManager = defaultSourceVersioningManager,
  expectedAuthority?: StatutoryAuthority,
  expectedDomain?: QueryDomain,
  applicabilityTarget?: VerifyEvidenceClaimsOptions['applicabilityTarget'],
  boundedCoverageRequest?: BoundedCoverageRequest
): string | undefined {
  if (APPLICATION_SOURCE_TYPES.has(record.sourceType) || record.evidenceTier === 'APPLICATION_RULE') {
    return 'APPLICATION_SOURCE_NOT_ALLOWED';
  }

  const documentAdmission = verifySharedDocumentAdmission(record, versioningManager, {
    targetDate,
    referenceDate,
    expectedAuthority,
    expectedDomain,
    applicabilityTarget
  });
  if (documentAdmission.required) return documentAdmission.admitted ? undefined : documentAdmission.reason;

  const legacyReferenceDate = referenceDate || SourceFreshnessManager.DEFAULT_REFERENCE_DATE;

  if (record.lifecycleState === 'REJECTED' || record.lifecycleState === 'STAGED' ||
      record.recordRole === 'SOURCE_MAP_POINTER' || record.groundingEligible === false) {
    return 'SOURCE_RECORD_NOT_GROUNDING_ELIGIBLE';
  }

  if (record.provenance === 'LOCAL_STATIC') {
    if (record.sourceStatus !== 'VERIFIED' && record.sourceStatus !== 'HISTORICAL') return 'LOCAL_SOURCE_NOT_VERIFIED';
    if (record.lifecycleState !== 'ACTIVE') return 'LOCAL_SOURCE_NOT_ACTIVE';
    if (record.verificationMethod !== 'STATUTORY_LEGISLATION_AUDIT' &&
        record.verificationMethod !== 'CURATED_EDITORIAL_REVIEW') return 'LOCAL_SOURCE_REVIEW_PROVENANCE_MISSING';
    if (defaultSourceFreshnessManager.evaluateSourceFreshness(record, legacyReferenceDate) === 'AUDIT_OVERDUE') {
      return 'LOCAL_SOURCE_REVIEW_AUDIT_OVERDUE';
    }
  } else if (record.provenance === 'LIVE_EXTERNAL') {
    if (record.lifecycleState !== 'CANDIDATE' || record.sourceStatus !== 'NEEDS_REVIEW' ||
        record.verificationMethod !== 'LIVE_OFFICIAL_TOPIC_VERIFIED' ||
        record.urlVerificationStatus !== 'VERIFIED' ||
        !/^[a-f\d]{64}$/i.test(record.documentHash || '') ||
        !record.retrievedAt || !Number.isFinite(Date.parse(record.retrievedAt))) {
      return 'LIVE_SOURCE_CANDIDATE_INCOMPLETE';
    }
    // A source-map validity window is routing metadata. A freshly fetched page
    // cannot establish an older rule merely by inheriting that pointer's dates.
    if (targetDate && targetDate < record.retrievedAt.slice(0, 10) &&
        !sourceProvesKnowledgeDate({
          authority: boundedCoverageRequest?.authority || '', topicId: boundedCoverageRequest?.topicId || '',
          query: boundedCoverageRequest?.query || '', subject: boundedCoverageRequest?.subject || '',
          sourceText: record.sourceText, officialUrl: record.officialSourceUrl }, targetDate)) {
      return 'LIVE_HISTORICAL_PAGE_SCOPE_UNVERIFIED';
    }
  } else {
    return 'SOURCE_PROVENANCE_NOT_ALLOWED';
  }

  if (!record.sourceText || normalizeEvidenceText(record.sourceText) === '') return 'SOURCE_TEXT_MISSING';

  const officialUrl = normalizeApprovedHttpsUrl(record.officialSourceUrl);
  const canonicalUrl = normalizeApprovedHttpsUrl(record.canonicalSourceUrl);
  if (!officialUrl || !canonicalUrl || officialUrl !== canonicalUrl) return 'SOURCE_URL_NOT_APPROVED_OR_CANONICAL';

  // A complete issue-bound commencement quotation supplies its own date. It
  // does not confer historical approval on a page or inherit pointer dates.
  if (boundedCoverageRequest && record.authority === boundedCoverageRequest.authority
      && record.sourceAuthority === boundedCoverageRequest.authority && !record.validTo
      && !record.validFrom && !record.effectiveDate
      && sourceProvesKnowledgeDate({ ...boundedCoverageRequest,
        sourceText: record.sourceText, officialUrl: record.officialSourceUrl }, targetDate)) return undefined;
  return findDateRejection(record, targetDate);
}

function splitParagraphIntoSentences(paragraph: string): string[] {
  const sentences: string[] = [];
  let segmentStart = 0;
  for (let index = 0; index < paragraph.length; index += 1) {
    const character = paragraph[index];
    if (!'.!?'.includes(character)) continue;
    const isDecimalPoint = character === '.' && /\d/.test(paragraph[index - 1] || '') && /\d/.test(paragraph[index + 1] || '');
    if (isDecimalPoint || (index + 1 < paragraph.length && !/\s/.test(paragraph[index + 1]))) continue;
    if (character === '.' && COMMON_ABBREVIATIONS.test(paragraph.slice(segmentStart, index + 1))) continue;

    const sentence = paragraph.slice(segmentStart, index + 1).trim();
    if (sentence) sentences.push(sentence);
    segmentStart = index + 1;
  }
  const remainder = paragraph.slice(segmentStart).trim();
  if (remainder) sentences.push(remainder);
  return sentences;
}

function quoteIsWholeSourceSpan(record: AuthoritativeSourceRecord, quote: string): 'MATCH' | 'NO_MATCH' | 'OMITS_ATTACHED_QUALIFICATION' {
  const sourceText = record.sourceText;
  const paragraphs = sourceText
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
  const normalizedQuote = normalizeEvidenceText(quote);
  const eciDeadlineDutyAnchor = /\b(?:file|furnish)\s+eci\s+within\s+(?:3|three)\s+months?\b/i.test(quote);
  if (isIrasEciFilingDeadlineRecord(record) && hasIrasEciColonEndedIntro(sourceText) &&
      (eciDeadlineDutyAnchor || isIrasEciDeadlineListComponentQuote(sourceText, quote))) {
    const completeQuote = completeIrasEciFilingDeadlineQuote(sourceText);
    if (completeQuote && normalizeEvidenceText(completeQuote) === normalizedQuote) return 'MATCH';
    return isPartialIrasEciFilingDeadlineQuote(sourceText, quote) || isIncompleteColonEndedQuote(normalizedQuote)
      ? 'OMITS_ATTACHED_QUALIFICATION'
      : 'NO_MATCH';
  }
  if (isCompleteIndividualFtcConditionsQuote(sourceText, quote)) return 'MATCH';
  if (isCompleteIndividualOverseasIncomeListQuote(sourceText, quote)) return 'MATCH';
  const cpfEligibilityRecord = record.authority === 'IRAS' && record.domain === 'IRAS_TAX' &&
    [...(record.tags || []), ...(record.relatedTopicIds || []), ...(record.sourceMapTopicIds || [])]
      .includes('iras-individual-cpf-cash-top-up-relief');
  if (cpfEligibilityRecord) {
    const completeQuote = completeIrasCpfCashTopUpEligibilityQuote(sourceText);
    if (completeQuote) {
      const blocks = sourceText
        .normalize('NFC')
        .replace(/\u00a0/g, ' ')
        .split(/\r?\n[\t ]*\r?\n+/)
        .map(block => block.trim())
        .filter(Boolean);
      const completeNormalized = normalizeEvidenceText(completeQuote);
      if (normalizedQuote === completeNormalized) return 'MATCH';
      const introIndex = blocks.findIndex(block => /\bcpf cash top[ -]?up relief is given to encourage\b/i.test(block));
      const endIndex = blocks.findIndex((block, index) => index > introIndex &&
        /\bmatched medisave scheme\b/i.test(block) && /\bwill not qualify\b/i.test(block));
      for (let end = introIndex; introIndex >= 0 && end < endIndex; end += 1) {
        if (normalizeEvidenceText(blocks.slice(introIndex, end + 1).join(' ')) === normalizedQuote) {
          return 'OMITS_ATTACHED_QUALIFICATION';
        }
      }
    }
  }
  const cpfLimitRecord = record.authority === 'IRAS' && record.domain === 'IRAS_TAX' &&
    [...(record.tags || []), ...(record.relatedTopicIds || []), ...(record.sourceMapTopicIds || [])]
      .includes('iras-individual-cpf-cash-top-up-relief');
  if (cpfLimitRecord && /\$\s*(?:16,?000|8,?000|80,?000)\b|\b(?:full retirement sum|frs|special account\s*\(sa\)|retirement account\s*\(ra\)|recipients below age 55|recipients aged 55 years and above)\b/i.test(quote)) {
    const completeQuotes = completeIrasCpfCashTopUpLimitQuotes(sourceText);
    if (completeQuotes.length !== 2) return 'NO_MATCH';
    const normalizedCompleteQuotes = completeQuotes.map(normalizeEvidenceText);
    if (normalizedCompleteQuotes.includes(normalizedQuote)) return 'MATCH';
    const quoteIsExactSubspan = completeQuotes.some(completeQuote => {
      const completeSentences = completeQuote
        .split(/\r?\n[\t ]*\r?\n+/)
        .flatMap(paragraph => splitParagraphIntoSentences(paragraph));
      for (let start = 0; start < completeSentences.length; start += 1) {
        let span = '';
        for (let end = start; end < completeSentences.length; end += 1) {
          span = span ? `${span} ${completeSentences[end]}` : completeSentences[end];
          const normalizedSpan = normalizeEvidenceText(span);
          if (normalizedSpan === normalizedQuote) return true;
          if (normalizedSpan.length > normalizedQuote.length) break;
        }
      }
      return false;
    });
    return quoteIsExactSubspan ? 'OMITS_ATTACHED_QUALIFICATION' : 'NO_MATCH';
  }
  const carConnectedPersonRecord = record.authority === 'IRAS' && record.domain === 'IRAS_GST' &&
    [...(record.tags || []), ...(record.relatedTopicIds || []), ...(record.sourceMapTopicIds || [])]
      .some(topicId => ['iras-gst-blocked-input-tax', 'iras-gst-motor-vehicles'].includes(topicId));
  if (carConnectedPersonRecord) {
    const completeQuote = completeIrasGstMotorCarConnectedPersonExceptionQuote(sourceText);
    if (completeQuote) {
      if (normalizeEvidenceText(completeQuote) === normalizedQuote) return 'MATCH';
      const blocks = sourceText
        .normalize('NFC')
        .replace(/\u00a0/g, ' ')
        .split(/\r?\n[\t ]*\r?\n+/)
        .map(block => block.trim())
        .filter(Boolean);
      const headingIndex = blocks.findIndex(block => /\bexpenses on motor car used by a connected person\b/i.test(block));
      const item1Index = blocks.findIndex((block, index) => index > headingIndex && /^\s*1[.)]\s+/m.test(block));
      for (let end = headingIndex; headingIndex >= 0 && end < blocks.length; end += 1) {
        if (normalizeEvidenceText(blocks.slice(headingIndex, end + 1).join(' ')) === normalizedQuote) {
          return 'OMITS_ATTACHED_QUALIFICATION';
        }
      }
      if (item1Index > headingIndex && normalizeEvidenceText(blocks.slice(headingIndex, item1Index + 1).join(' ')) === normalizedQuote) {
        return 'OMITS_ATTACHED_QUALIFICATION';
      }
    }
  }
  if (isIncompleteColonEndedQuote(normalizedQuote)) return 'OMITS_ATTACHED_QUALIFICATION';

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    if (normalizeEvidenceText(paragraph) === normalizedQuote) {
      const nextParagraph = paragraphs[paragraphIndex + 1];
      if (nextParagraph && startsAttachedEvidenceQualification(nextParagraph)) {
        return 'OMITS_ATTACHED_QUALIFICATION';
      }
      return 'MATCH';
    }

    // A rule paragraph followed by an attached qualifier can be cited only as
    // the complete, contiguous source span. This admits exact multi-paragraph
    // quotes without permitting summaries or omission of the qualifier.
    if (paragraphIndex + 1 < paragraphs.length && startsAttachedEvidenceQualification(paragraphs[paragraphIndex + 1])) {
      let attachedEnd = paragraphIndex + 1;
      while (attachedEnd + 1 < paragraphs.length && startsAttachedEvidenceQualification(paragraphs[attachedEnd + 1])) {
        attachedEnd += 1;
      }
      let attachedSpan = normalizeEvidenceText(paragraph);
      for (let end = paragraphIndex + 1; end <= attachedEnd; end += 1) {
        attachedSpan += ` ${normalizeEvidenceText(paragraphs[end])}`;
        if (attachedSpan === normalizedQuote) {
          return end === attachedEnd ? 'MATCH' : 'OMITS_ATTACHED_QUALIFICATION';
        }
      }
    }

    const sentences = splitParagraphIntoSentences(paragraph);
    for (let start = 0; start < sentences.length; start += 1) {
      let span = '';
      for (let end = start; end < sentences.length; end += 1) {
        span = span ? `${span} ${sentences[end]}` : sentences[end];
        const normalizedSpan = normalizeEvidenceText(span);
        if (normalizedSpan === normalizedQuote) {
          const nextSentence = sentences[end + 1] || paragraphs[paragraphIndex + 1];
          if (nextSentence && startsAttachedEvidenceQualification(nextSentence)) {
            return 'OMITS_ATTACHED_QUALIFICATION';
          }
          return 'MATCH';
        }
        if (normalizedSpan.length > normalizedQuote.length) break;
      }
    }
  }
  return 'NO_MATCH';
}

type BoundedAdvisoryProfile = 'CPF_ORDINARY_WAGES' | 'MOM_PART_IV_OVERTIME';

function boundedAdvisoryProfileForRecord(record: AuthoritativeSourceRecord): BoundedAdvisoryProfile | undefined {
  if (record.provenance !== 'LIVE_EXTERNAL' || record.lifecycleState !== 'CANDIDATE' ||
      record.sourceStatus !== 'NEEDS_REVIEW') {
    return undefined;
  }

  const topicBindings = new Set([
    ...(record.sourceMapTopicIds || []),
    ...(record.relatedTopicIds || []),
    ...(record.tags || [])
  ]);
  if (record.authority === 'CPF' && record.sourceAuthority === 'CPF' && record.domain === 'CPF_BOARD' &&
      topicBindings.has('cpf-ordinary-wages')) {
    return 'CPF_ORDINARY_WAGES';
  }
  if (record.authority === 'MOM' && record.sourceAuthority === 'MOM' && record.domain === 'MOM_EMPLOYMENT' &&
      topicBindings.has('mom-part-iv-overtime')) {
    return 'MOM_PART_IV_OVERTIME';
  }
  return undefined;
}

function isAdvisoryListItem(block: string): boolean {
  return /^(?:\|\s*)*[•◦▪]\s+/u.test(block);
}

function advisoryListHeaderIndex(blocks: string[], profile: BoundedAdvisoryProfile): number {
  const header = profile === 'CPF_ORDINARY_WAGES'
    ? /\bfor wages to be classified as ordinary wages for the month\b.{0,140}\bthey must meet both (?:(?:of )?the )?following (?:criteria|conditions):/i
    : /\byou can claim overtime if you are:/i;
  return blocks.findIndex(block => header.test(block));
}

/**
 * Accepts only a bounded, exact, contiguous quotation that includes the complete
 * native list and passes the substantive CPF/MOM support check. Generic quote
 * matching remains unchanged for every other record and request.
 */
function quoteIsCompleteBoundedAdvisorySpan(record: AuthoritativeSourceRecord, quote: string): boolean {
  const profile = boundedAdvisoryProfileForRecord(record);
  if (!profile || record.sourceText.length > 100_000) return false;

  const normalizedQuote = normalizeEvidenceText(quote);
  if (!normalizedQuote || normalizedQuote.length > 5_000) return false;

  const blocks = record.sourceText
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n[\t ]*\r?\n+/)
    .map(block => block.trim())
    .filter(Boolean);
  if (blocks.length > 300) return false;
  const normalizedBlocks = blocks.map(normalizeEvidenceText);
  const headerIndex = advisoryListHeaderIndex(normalizedBlocks, profile);
  if (headerIndex < 0) return false;

  let listEnd = headerIndex;
  let listItemCount = 0;
  while (listEnd + 1 < blocks.length && isAdvisoryListItem(normalizedBlocks[listEnd + 1])) {
    listEnd += 1;
    listItemCount += 1;
  }
  if (listItemCount < 2) return false;

  let requiredEnd = listEnd;
  while (requiredEnd + 1 < blocks.length && startsAttachedEvidenceQualification(blocks[requiredEnd + 1])) {
    requiredEnd += 1;
  }

  let supportChecks = 0;
  for (let start = 0; start <= headerIndex && supportChecks < 2_000; start += 1) {
    if (isAdvisoryListItem(normalizedBlocks[start])) continue;
    let span = '';
    for (let end = start; end < blocks.length && supportChecks < 2_000; end += 1) {
      span = span ? `${span} ${normalizedBlocks[end]}` : normalizedBlocks[end];
      if (span.length > normalizedQuote.length) break;
      if (span !== normalizedQuote) continue;
      supportChecks += 1;
      if (end < requiredEnd || end < listEnd) continue;

      const subject = profile === 'CPF_ORDINARY_WAGES' ? 'ordinary wages definition' : 'Part IV overtime eligibility';
      if (supportBoundedStatutoryAdvisory({
        authority: profile === 'CPF_ORDINARY_WAGES' ? 'CPF' : 'MOM',
        topicId: profile === 'CPF_ORDINARY_WAGES' ? 'cpf-ordinary-wages' : 'mom-part-iv-overtime',
        subject,
        sourceText: blocks.slice(start, end + 1).join('\n\n')
      }) === true) return true;
    }
  }
  return false;
}

function reject(text: string, reason: string): RejectedEvidenceClaim {
  return { text, reason };
}

/**
 * Verifies only literal source quotations. This does not infer entailment from
 * vocabulary overlap and does not verify application of a rule to facts.
 */
export function verifyEvidenceClaims(
  claims: unknown,
  records: AuthoritativeSourceRecord[],
  options: VerifyEvidenceClaimsOptions
): EvidenceClaimsVerificationResult {
  const accepted: VerifiedEvidenceClaim[] = [];
  const rejected: RejectedEvidenceClaim[] = [];
  const targetDate = options?.targetDate;
  const versioningManager = options?.versioningManager || defaultSourceVersioningManager;

  if (!Array.isArray(claims)) {
    return { accepted, rejected: [reject('', 'CLAIMS_NOT_ARRAY')] };
  }

  for (const claimValue of claims) {
    if (!claimValue || typeof claimValue !== 'object' || Array.isArray(claimValue)) {
      rejected.push(reject('', 'CLAIM_NOT_OBJECT'));
      continue;
    }
    const claim = claimValue as Record<string, unknown>;
    const text = typeof claim.text === 'string' ? claim.text : '';
    if (claim.kind === 'APPLICATION') {
      rejected.push(reject(text, options?.missingFacts?.length ? 'APPLICATION_REQUIRES_FACTS_AND_DETERMINISTIC_ENGINE' : 'APPLICATION_REQUIRES_DETERMINISTIC_ENGINE'));
      continue;
    }
    if (claim.kind !== 'RULE') {
      rejected.push(reject(text, 'CLAIM_KIND_NOT_ALLOWED'));
      continue;
    }
    if (typeof claim.text !== 'string' || text.trim() === '' || typeof claim.quote !== 'string' ||
        claim.quote.trim() === '' || typeof claim.recordId !== 'string' || claim.recordId.trim() === '') {
      rejected.push(reject(text, 'CLAIM_FIELDS_MISSING'));
      continue;
    }

    const quote = claim.quote;
    if (/[.…]{3,}|…/u.test(quote)) {
      rejected.push(reject(text, 'ELLIPSIS_NOT_ALLOWED'));
      continue;
    }
    if (normalizeEvidenceText(text) !== normalizeEvidenceText(quote)) {
      rejected.push(reject(text, 'CLAIM_TEXT_MUST_EQUAL_QUOTE'));
      continue;
    }

    const matchingRecords = records.filter(record => record.id === claim.recordId);
    if (matchingRecords.length === 0) {
      rejected.push(reject(text, 'SOURCE_RECORD_NOT_FOUND'));
      continue;
    }
    if (matchingRecords.length !== 1) {
      rejected.push(reject(text, 'SOURCE_RECORD_ID_AMBIGUOUS'));
      continue;
    }
    const record = matchingRecords[0];
    const eligibilityRejection = findRecordEligibilityRejection(
      record,
      targetDate,
      options?.referenceDate,
      versioningManager,
      options?.expectedAuthority,
      options?.expectedDomain,
      options?.applicabilityTarget,
      options?.boundedCoverageRequest
    );
    if (eligibilityRejection) {
      rejected.push(reject(text, eligibilityRejection));
      continue;
    }

    const sourceUrl = normalizeApprovedHttpsUrl(record.canonicalSourceUrl);
    if (!sourceUrl) {
      rejected.push(reject(text, 'SOURCE_URL_NOT_APPROVED_OR_CANONICAL'));
      continue;
    }
    const canonicalUrl = hasVerifiedSourceUrlProvenance(record) ? sourceUrl : undefined;
    if (claim.citationUrl !== undefined) {
      const citationUrl = normalizeApprovedHttpsUrl(claim.citationUrl);
      if (!citationUrl || citationUrl !== sourceUrl) {
        rejected.push(reject(text, 'CITATION_URL_MISMATCH'));
        continue;
      }
      if (!canonicalUrl) {
        rejected.push(reject(text, 'CITATION_URL_UNVERIFIED'));
        continue;
      }
    }

    const sourceSpanResult = quoteIsWholeSourceSpan(record, quote);
    const selectedExpansionComponent = sourceSpanResult === 'OMITS_ATTACHED_QUALIFICATION' &&
      options?.boundedCoverageRequest &&
      supportPracticalExpansionRule({ ...options.boundedCoverageRequest, sourceText: record.sourceText,
        officialUrl: record.officialSourceUrl }) === true &&
      isExactBoundedCoverageRuleSpan(record, quote, options.boundedCoverageRequest);
    // The ordinary salary deadline is one item under a source heading and
    // may be marked as omitting the following overtime list item. Admit only
    // the exact, query-bound MOM selector span; do not relax the generic span
    // rules for other evidence.
    const selectedMomSalaryRuleSpan = sourceSpanResult === 'OMITS_ATTACHED_QUALIFICATION' &&
      options?.boundedCoverageRequest?.authority === 'MOM' &&
      options.boundedCoverageRequest.topicId === 'mom-salary-payment' &&
      isExactBoundedCoverageRuleSpan(record, quote, options.boundedCoverageRequest);
    const quoteResult = selectedExpansionComponent || selectedMomSalaryRuleSpan || sourceSpanResult === 'NO_MATCH' && (
      quoteIsCompleteBoundedAdvisorySpan(record, quote) ||
      isExactBoundedCoverageRuleSpan(record, quote, options?.boundedCoverageRequest)
    ) ? 'MATCH' : sourceSpanResult;
    if (quoteResult === 'OMITS_ATTACHED_QUALIFICATION') {
      rejected.push(reject(text, 'QUOTE_OMITS_ATTACHED_QUALIFICATION'));
      continue;
    }
    if (quoteResult !== 'MATCH') {
      rejected.push(reject(text, 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH'));
      continue;
    }

    const sharedAdmission = verifySharedDocumentAdmission(record, versioningManager, {
      targetDate,
      referenceDate: options?.referenceDate,
      expectedAuthority: options?.expectedAuthority,
      expectedDomain: options?.expectedDomain,
      applicabilityTarget: options?.applicabilityTarget
    });
    const sourceAdmissionOptions = sharedAdmission.required && sharedAdmission.admitted
      ? {
        ...(targetDate ? { targetDate } : {}),
        ...(options?.expectedAuthority ? { expectedAuthority: options.expectedAuthority } : {}),
        ...(options?.expectedDomain ? { expectedDomain: options.expectedDomain } : {}),
        ...(options?.applicabilityTarget ? { applicabilityTarget: options.applicabilityTarget } : {})
      }
      : undefined;
    accepted.push({
      text,
      recordId: record.id,
      quote,
      ...(canonicalUrl ? { canonicalUrl } : {}),
      supportKind: record.provenance === 'LOCAL_STATIC' &&
        (record.sourceType === 'CURATED_SUMMARY' || record.isVerbatimText === false)
        ? 'REVIEWED_EDITORIAL_SUMMARY' : 'EXACT_SOURCE_QUOTE',
      ...(sharedAdmission.required && sharedAdmission.admitted ? {
        sourceBinding: sharedAdmission.binding,
        sourceAdmissionOptions
      } : {})
    });
  }

  return { accepted, rejected };
}
