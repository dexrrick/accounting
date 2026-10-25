import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';
import { supportsCpfAdditionalWages } from './statutoryAdvisorySupport';

export type CpfMasPracticalAuthority = 'CPF' | 'MAS';
export interface CpfMasPracticalRuleRequest {
  authority: string;
  topicId: string;
  subject: string;
  query: string;
  sourceText: string;
}

export interface CpfMasPracticalRuleEvidence {
  authority: CpfMasPracticalAuthority;
  text: string;
  title: string;
  officialUrl: string;
}

type PracticalRule = 'CPF_ADDITIONAL_WAGES' | 'MAS_FUND_MANAGEMENT_LICENSING';

const CPF_ADDITIONAL_WAGES_URL =
  'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions';
const MAS_FUND_MANAGEMENT_URL =
  'https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing';

function visibleText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|button|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ' ';
    })
    .normalize('NFKD')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasPersonalOrOutOfScopeFacts(value: string): boolean {
  return /\b(?:19|20)\d{2}\b|\b(?:historical|historic|previous|prior|former|old|superseded|before\s+\d{4})\b/i.test(value)
    || /\b(?:my|our|this|these|its)\s+(?:company|fund|business|employee|bonus|payment|fund manager)\b|\b(?:i|we|our company|my company)\b/i.test(value)
    || /\b(?:calculate|compute|estimate|how much|amount|rate|ceiling|threshold|eligib(?:le|ility)|qualif(?:y|ies|ication)|exempt(?:ion)? for (?:me|us|my|our)|application for (?:my|our))\b/i.test(value);
}

function recognizeRule(input: Pick<CpfMasPracticalRuleRequest, 'authority' | 'topicId' | 'subject' | 'query'>): PracticalRule | undefined {
  const scopeText = `${input.subject}\n${input.query}`;
  if (hasPersonalOrOutOfScopeFacts(scopeText)) return undefined;

  if (input.authority === 'CPF' && input.topicId === 'cpf-additional-wages'
    && /\b(?:additional\s+wages?|\baw\b)/i.test(input.subject)
    && /\b(?:additional\s+wages?|\baw\b)/i.test(input.query)
    && /\b(?:what|which|explain|define|definition|meaning|classif\w*)\b/i.test(input.query)) {
    return 'CPF_ADDITIONAL_WAGES';
  }

  const subjectIsVcfmSpecific = /\b(?:vcfm|venture\s+capital\s+fund\s+manager)\b/i.test(input.subject);
  const subjectNamesLfmc = /\blfmc\b|\blicensed\s+fund\s+management\s+company\b|\bfund\s+management\b/i.test(input.subject);
  const lfmcLicensingClauses = input.query.split(/[.!?;]|\band\b|\balso\b|\bbut\b|\bas well as\b/i)
    .map(clause => clause.trim())
    .filter(clause => /\b(?:fund\s+management|lfmc|licensed\s+fund\s+management\s+company|(?:firm|company|entity)\b[\s\S]{0,70}\bmanag\w*\s+funds?)\b/i.test(clause)
      && /\b(?:when|whether|what|which|explain|general(?:ly)?|need|requires?|required|requirement|licen[cs](?:e|ing))\b/i.test(clause));
  const asksDistinctActivity = (value: string): boolean =>
    /\b(?:deal(?:ing)?\s+(?:in\s+)?(?:securities|capital markets products?)|advis(?:e|ing)\s+(?:on|about)\s+(?:investment|securities)|investment advice|custod(?:y|ian)|other\s+(?:regulated\s+)?activities)\b/i.test(value);
  const hasGeneralLfmcLicensingClause = lfmcLicensingClauses.some(clause => !asksDistinctActivity(clause));

  if (input.authority === 'MAS' && input.topicId === 'mas-lfmc' && !subjectIsVcfmSpecific
    && subjectNamesLfmc && hasGeneralLfmcLicensingClause && !asksDistinctActivity(input.subject)) {
    return 'MAS_FUND_MANAGEMENT_LICENSING';
  }

  return undefined;
}

function splitStatements(value: string): string[] {
  return value.split(/(?<=[.!?])\s+|\s*\|\s*/).map(item => item.trim()).filter(Boolean);
}

function hasMasGeneralLicenceRule(text: string): boolean {
  return /\bif\s+your\s+company\b[^.!?]{0,140}\b(?:conduct|undertake)\s+fund\s+management\s+activities?\b[^.!?]{0,140}\bregulated\s+under\b[^.!?]{0,70}\bsecurities\s+and\s+futures\s+act\s+2001\b[^.!?]{0,180}\bmust\s+apply\s+to\s+be\s+a?\s*licensed\s+fund\s+management\s+company\b[^.!?]{0,100}\bcapital\s+markets\s+services\s+(?:\(cms\)\s+)?licen[cs]e\b/.test(text);
}

function hasMasClassExemptionQualification(text: string): boolean {
  return /\bif\s+your\s+company\b[^.!?]{0,100}\b(?:able|eligible)\s+to\s+operate\b[^.!?]{0,90}\bexisting\s+class\s+exemption\b[^.!?]{0,130}\bdoes\s+not\s+require\s+(?:a\s+)?licen[cs]e\b/.test(text);
}

function provesMasFundManagementLicensing(text: string): boolean {
  const normalized = visibleText(text);
  const exemptionContradiction = /\bclass\s+exemption\b[^.!?]{0,160}\b(?:must|shall|is\s+required\s+to)\b[^.!?]{0,90}\b(?:hold|apply\s+for|obtain)\b[^.!?]{0,80}\blicen[cs]e\b/.test(normalized)
    || /\b(?:even\s+if|despite)\b[^.!?]{0,100}\bclass\s+exemption\b[^.!?]{0,100}\b(?:must|shall|is\s+required\s+to)\b[^.!?]{0,90}\b(?:hold|apply\s+for|obtain)\b[^.!?]{0,80}\blicen[cs]e\b/.test(normalized);
  const generalDutyContradiction = splitStatements(normalized).some(statement =>
    !/\bclass\s+exemption\b/.test(statement)
      && /\bfund\s+management\b/.test(statement)
      && /\b(?:do\s+not\s+need|need\s+not|(?:do|does)\s+not\s+require|(?:are|is)\s+not\s+required\s+to)\b[^.!?]{0,90}\b(?:cms\s+)?licen[cs]e\b/.test(statement));
  return !exemptionContradiction && !generalDutyContradiction
    && hasMasGeneralLicenceRule(normalized) && hasMasClassExemptionQualification(normalized);
}

/**
 * Qualifies a complete, independently fetched page before quote selection.
 * Undefined means this conservative full-page rule proof does not own the
 * request; false means the owned topic lacks one or more required premises.
 */
export function provesCpfMasPracticalRuleSource(input: CpfMasPracticalRuleRequest): boolean | undefined {
  const rule = recognizeRule(input);
  if (!rule) return undefined;
  return rule === 'CPF_ADDITIONAL_WAGES'
    ? supportsCpfAdditionalWages(input.sourceText)
    : provesMasFundManagementLicensing(input.sourceText);
}

/**
 * Keeps the MAS class-exemption paragraph only when it is an exact standalone
 * quote from a page that proves both the general licensing duty and exception.
 */
export function isCpfMasPracticalRuleComponentQuote(
  input: CpfMasPracticalRuleRequest,
  quote: string
): boolean {
  if (recognizeRule(input) !== 'MAS_FUND_MANAGEMENT_LICENSING'
    || !provesMasFundManagementLicensing(input.sourceText)) return false;

  const normalizedQuote = visibleText(quote);
  return Boolean(normalizedQuote)
    && hasMasClassExemptionQualification(normalizedQuote)
    && splitStatements(visibleText(input.sourceText)).some(statement => statement === normalizedQuote);
}

function isExpectedSource(source: AuthorityPresentedSource, authority: CpfMasPracticalAuthority): boolean {
  if (source.provenance !== 'LIVE_EXTERNAL' || source.validTo) return false;
  try {
    const url = new URL(source.officialUrl || '');
    if (url.protocol !== 'https:') return false;
    if (authority === 'CPF') return ['www.cpf.gov.sg', 'cpf.gov.sg'].includes(url.hostname)
      && url.pathname.replace(/\/$/, '') === new URL(CPF_ADDITIONAL_WAGES_URL).pathname;
    return ['www.mas.gov.sg', 'mas.gov.sg'].includes(url.hostname)
      && url.pathname.replace(/\/$/, '') === new URL(MAS_FUND_MANAGEMENT_URL).pathname;
  } catch {
    return false;
  }
}

function explainsFromClaims(claimTexts: readonly string[], rule: PracticalRule): boolean {
  if (rule === 'CPF_ADDITIONAL_WAGES') return supportsCpfAdditionalWages(claimTexts.join('\n'));
  return provesMasFundManagementLicensing(claimTexts.join('\n'));
}

/** Builds a narrow answer only from exact verified quotes bound to one current official page and issue. */
export function getCpfMasPracticalRuleEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): CpfMasPracticalRuleEvidence | undefined {
  const authority = stream.authority;
  if (authority !== 'CPF' && authority !== 'MAS') return undefined;
  const rule = recognizeRule({ authority, topicId: authority === 'CPF' ? 'cpf-additional-wages' : 'mas-lfmc',
    subject: issue.subject, query });
  if (!rule || (authority === 'CPF' && (stream.domain !== 'CPF_PAYROLL' || issue.population !== 'Employer')) ||
      (authority === 'MAS' && (stream.domain !== 'MAS_FUNDS' || issue.population !== 'Company')) ||
      issue.evidenceStatus !== 'VERIFIED' || issue.applicationStatus !== 'NOT_REQUIRED' ||
      issue.operation !== 'EXPLAIN_RULE') return undefined;

  for (const source of stream.sources) {
    if (!isExpectedSource(source, authority)) continue;
    const hasCompleteBoundRule = groupExactIssueClaimsByDocument(source, issue.id)
      .some(group => explainsFromClaims(group.map(claim => claim.text), rule));
    if (!hasCompleteBoundRule) continue;
    const text = rule === 'CPF_ADDITIONAL_WAGES'
      ? 'CPF classifies wages that are not Ordinary Wages as Additional Wages for that month.'
      : 'A company conducting fund management activities regulated under the Securities and Futures Act 2001 must apply to be a licensed fund management company holding a Capital Markets Services licence. A company that can operate under an existing class exemption does not require a licence.';
    return { authority, text, title: source.title, officialUrl: source.officialUrl! };
  }
  return undefined;
}
