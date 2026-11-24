import type {
  AuthorityPresentedIssue,
  AuthorityPresentedWorkstream,
  AuthorityPresentedSource
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';

type PracticalRule = 'IRAS_ECI_DEADLINE' | 'ACRA_SECRETARY_APPOINTMENT';

const IRAS_ECI_SUBJECT_WORDS = new Set([
  'a', 'an', 'the', 'company', 'companies', 'eci', 'estimated', 'chargeable', 'income', 'file', 'filing', 'filed',
  'furnish', 'deadline', 'due', 'date', 'time', 'limit', 'period', 'when', 'how', 'long', 'many', 'month', 'months',
  'within', 'financial', 'year', 'end', 'ends', 'after', 'from', 'to', 'must', 'required', 'general', 'rule', 'rules'
]);
const ACRA_SECRETARY_SUBJECT_WORDS = new Set([
  'a', 'an', 'the', 'company', 'companies', 'local', 'secretary', 'appoint', 'appointed', 'appointing', 'appointment',
  'deadline', 'due', 'date', 'time', 'limit', 'period', 'when', 'how', 'long', 'many', 'month', 'months', 'within',
  'of', 'successful', 'registration', 'register', 'registered', 'incorporation', 'incorporated', 'after', 'from',
  'to', 'must', 'required', 'general', 'rule', 'rules'
]);

export interface IrasAcraPracticalRuleEvidence {
  text: string;
  title: string;
  officialUrl: string;
  authority: 'IRAS' | 'ACRA';
}

function compact(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isScopedPracticalRuleSubject(rule: PracticalRule, subject: string): boolean {
  const tokens = compact(subject).split(' ').filter(Boolean);
  if (tokens.length === 0) return false;
  const vocabulary = rule === 'IRAS_ECI_DEADLINE' ? IRAS_ECI_SUBJECT_WORDS : ACRA_SECRETARY_SUBJECT_WORDS;
  if (tokens.some(token => !vocabulary.has(token))) return false;
  if (rule === 'IRAS_ECI_DEADLINE') {
    return tokens.includes('eci') || ['estimated', 'chargeable', 'income'].every(token => tokens.includes(token));
  }
  return tokens.includes('company') && tokens.includes('secretary');
}

function outOfScopeQuestion(query: string): boolean {
  return /\b(?:19|20)\d{2}\b|\b(?:historical|previous|former|old|superseded|before\s+\d{4})\b/i.test(query) ||
    /\b(?:calculate|compute|estimate|how much|my company|our company|this company|eligib\w*|waiver|exempt(?:ion)?|penalt\w*|fines?|dut(?:y|ies)|fees?|charges?)\b/i.test(query);
}

function hasExplicitGeneralIntent(query: string): boolean {
  return /\b(?:in general|general rule|general guidance|generally)\b/i.test(query);
}

function normalizeSourceText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(?:p|li|tr|table|div|section|article|h[1-6]|ul|ol|main|dt|dd)\s*>/gi, '. ')
    .replace(/<br\b[^>]*>/gi, '. ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function ruleFor(query: string, authority: string, topicId: string): PracticalRule | undefined {
  const text = compact(query);
  if (outOfScopeQuestion(query)) return undefined;

  if (authority === 'IRAS' && topicId === 'iras-cit-eci' &&
      /\b(?:eci|estimated chargeable income)\b/.test(text) &&
      /\b(?:when|deadline|due date|how long|time limit|within how many months|filing period)\b/.test(query.toLowerCase())) {
    return 'IRAS_ECI_DEADLINE';
  }
  if (authority === 'ACRA' && topicId === 'acra_company-secretary' &&
      /\b(?:company )?secretary\b/.test(text) &&
      /\b(?:when|deadline|due date|how long|time limit|within how many months|appointment period)\b/.test(query.toLowerCase())) {
    return 'ACRA_SECRETARY_APPOINTMENT';
  }
  return undefined;
}

function ruleForPresentedIssue(query: string, authority: string, subject: string): PracticalRule | undefined {
  const queryText = compact(query);
  if (outOfScopeQuestion(query)) return undefined;
  if (authority === 'IRAS' && /\b(?:eci|estimated chargeable income)\b/.test(queryText) &&
      /\b(?:eci|estimated chargeable income)\b/i.test(subject) &&
      /\b(?:when|deadline|due date|how long|time limit|within how many months|filing period)\b/.test(query.toLowerCase())) {
    return 'IRAS_ECI_DEADLINE';
  }
  if (authority === 'ACRA' && /\b(?:company secretary|secretary)\b/.test(queryText) &&
      /\b(?:company )?secretary\b/i.test(subject) &&
      /\b(?:when|deadline|due date|how long|time limit|within how many months|appointment period)\b/.test(query.toLowerCase())) {
    return 'ACRA_SECRETARY_APPOINTMENT';
  }
  return undefined;
}

function provesEciDeadline(text: string): boolean {
  const normalized = normalizeSourceText(text);
  const statements = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  const month = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
  const eciDeadline = new RegExp(
    `\\b(?:file|furnish|be filed|be furnished)\\b.{0,100}\\b(?:eci|estimated chargeable income)\\b.{0,100}\\bwithin\\s+${month}\\s+months?\\s+(?:from|after)\\s+(?:the\\s+)?end\\s+of\\s+(?:your\\s+|its\\s+|the\\s+)?financial\\s+year\\b`,
    'gi'
  );
  const hasThreeMonthDuty = statements.some(statement =>
    /\b(?:your company|the company)\b.{0,100}\b(?:has to|must|is required to)\s+(?:file|furnish)\s+(?:its\s+|your\s+)?(?:eci|estimated chargeable income)\b.{0,80}\bwithin\s+3\s+months?\s+(?:from|after)\s+(?:the\s+)?end\s+of\s+(?:your\s+|its\s+|the\s+)?financial\s+year\b/i.test(statement));
  const hasWaiverQualification = /\bunless\b.{0,180}\b(?:eci filing waiver|waiver to file eci|exempt(?:ed)? from eci filing)\b/i.test(normalized);
  const hasSpecificNonFilingQualification = /\bunless\b.{0,260}\b(?:specifically not required to file eci|not required to furnish eci|not required to file estimated chargeable income)\b/i.test(normalized);
  const hasConflictingDeadline = statements.some(statement =>
    [...statement.matchAll(eciDeadline)].some(match => (NUMBER_WORDS[match[1]] ?? Number(match[1])) !== 3));
  const hasNegatedDeadline = statements.some(statement =>
    /\b(?:not|never|does not|do not|is not|are not|cannot|need not|must not|should not)\b[^.!?]{0,140}\b(?:file|furnish|be filed|be furnished)\b[^.!?]{0,100}\b(?:eci|estimated chargeable income)\b[^.!?]{0,80}\bwithin\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+months?\s+(?:from|after)\s+(?:the\s+)?end\s+of\s+(?:your\s+|its\s+|the\s+)?financial\s+year\b/i.test(statement) ||
    /\b(?:eci|estimated chargeable income)\b[^.!?]{0,100}\b(?:must not|should not|need not|is not required to)\s+(?:be filed|be furnished)\b[^.!?]{0,80}\bwithin\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+months?\s+(?:from|after)\s+(?:the\s+)?end\s+of\s+(?:your\s+|its\s+|the\s+)?financial\s+year\b/i.test(statement));
  return hasThreeMonthDuty && hasWaiverQualification && hasSpecificNonFilingQualification &&
    !hasConflictingDeadline && !hasNegatedDeadline;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
});

function provesAcraSecretaryDeadline(text: string): boolean {
  const normalized = normalizeSourceText(text);
  const statements = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  const month = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
  const appointmentPeriod = new RegExp(
    `\\b(?:company\\s+)?secretary\\b.{0,100}\\b(?:must\\s+be\\s+appointed|should\\s+be\\s+appointed|is\\s+to\\s+be\\s+appointed|be\\s+appointed|appointed|appointment\\s+is\\s+required|appointment\\s+must\\s+be\\s+made)\\b.{0,60}\\bwithin\\s+${month}\\s+months?\\b`,
    'gi'
  );
  const hasCompanySecretaryDuty = statements.some(statement =>
    /\b(?:every|all)\s+compan(?:y|ies)\b.{0,100}\bmust have\b.{0,100}\bcompany secretary\b/i.test(statement));
  const hasNegatedCompanySecretaryDuty = statements.some(statement =>
    /\b(?:every|all)\s+compan(?:y|ies)\b.{0,100}\b(?:must not have|must have no|do not need to have|need not have|are not required to have|is not required to have)\b.{0,100}\bcompany secretary\b/i.test(statement) ||
    /\bno company\b.{0,100}\b(?:must have|is required to have|needs to have)\b.{0,40}\bcompany secretary\b/i.test(statement));
  const hasSixMonthAppointment = statements.some(statement =>
    /\b(?:company\s+)?secretary\b.{0,100}\b(?:must\s+be\s+appointed|is\s+required\s+to\s+be\s+appointed)\b.{0,60}\bwithin\s+six\s+months?\s+of\s+(?:successful\s+)?(?:company\s+)?(?:registration|incorporation)\b/i.test(statement));
  const hasConflictingAppointmentPeriod = statements.some(statement =>
    [...statement.matchAll(appointmentPeriod)].some(match => (NUMBER_WORDS[match[1]] ?? Number(match[1])) !== 6));
  const hasNegatedAppointmentDeadline = statements.some(statement =>
    /\b(?:company\s+)?secretary\b.{0,100}\b(?:must not|cannot|need not|is not required to|are not required to|not required to|should not)\s+be appointed\b.{0,60}\bwithin\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+months?\b/i.test(statement) ||
    /\b(?:company\s+)?secretary\b.{0,100}\bappointment\b.{0,60}\b(?:must not|need not|is not required to|are not required to)\b.{0,60}\bwithin\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+months?\b/i.test(statement));
  return hasCompanySecretaryDuty && !hasNegatedCompanySecretaryDuty && hasSixMonthAppointment &&
    !hasConflictingAppointmentPeriod && !hasNegatedAppointmentDeadline;
}

function sourceForRule(rule: PracticalRule, source: AuthorityPresentedSource): boolean {
  if (source.provenance !== 'LIVE_EXTERNAL' || source.validTo) return false;
  try {
    const url = new URL(source.officialUrl || '');
    if (url.protocol !== 'https:') return false;
    if (rule === 'IRAS_ECI_DEADLINE') {
      return ['www.iras.gov.sg', 'iras.gov.sg'].includes(url.hostname) &&
        /^\/taxes\/corporate-income-tax\/estimated-chargeable-income-\(eci\)-filing\/?$/i.test(url.pathname);
    }
    return ['www.acra.gov.sg', 'acra.gov.sg'].includes(url.hostname) &&
      /^\/register\/business\/registering-different-business-structures\/local-company\/appointing-company-directors-other-key-officers\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function completeEvidenceFromClaims(
  rule: PracticalRule,
  source: AuthorityPresentedSource,
  issueId: string
): boolean {
  return groupExactIssueClaimsByDocument(source, issueId).some(group => {
    const texts = group.map(claim => claim.text);
    return rule === 'IRAS_ECI_DEADLINE'
      ? provesEciDeadline(texts.join(' '))
      : provesAcraSecretaryDeadline(texts.join(' '));
  });
}

/**
 * Checks the whole fetched official page before excerpts are selected. Undefined
 * means this rule helper does not own the request; false means a supported ask
 * lacks complete, correctly qualified source wording.
 */
export function provesIrasAcraPracticalRuleSource(
  query: string,
  authority: string,
  topicId: string,
  sourceText: string
): boolean | undefined {
  const rule = ruleFor(query, authority, topicId);
  if (!rule) return undefined;
  return rule === 'IRAS_ECI_DEADLINE'
    ? provesEciDeadline(sourceText)
    : provesAcraSecretaryDeadline(sourceText);
}

/** Returns bounded, issue-text support only for the two general timing rules. */
export function supportIrasAcraPracticalRuleSource(
  query: string,
  authority: string,
  topicId: string,
  subject: string,
  sourceText: string
): boolean | undefined {
  const rule = ruleFor(query, authority, topicId);
  if (!rule) return undefined;
  if (!isScopedPracticalRuleSubject(rule, subject)) return false;
  return rule === 'IRAS_ECI_DEADLINE'
    ? provesEciDeadline(sourceText)
    : provesAcraSecretaryDeadline(sourceText);
}

/** Renders a bounded rule only from current, exact, issue-bound official evidence. */
export function getIrasAcraPracticalRuleEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): IrasAcraPracticalRuleEvidence | undefined {
  const rule = ruleForPresentedIssue(query, stream.authority, issue.subject);
  const expected = rule === 'IRAS_ECI_DEADLINE' ? {
    authority: 'IRAS' as const,
    domain: 'IRAS_CORPORATE_TAX',
    topicPattern: /\beci\b|estimated chargeable income/i,
    text: 'For a company required to file Estimated Chargeable Income (ECI), IRAS sets the general deadline at three months after the end of its financial year. An ECI filing waiver or a category specifically not required to file is an exception; whether an exception applies depends on the company’s circumstances.',
    prove: provesEciDeadline
  } : rule === 'ACRA_SECRETARY_APPOINTMENT' ? {
    authority: 'ACRA' as const,
    domain: 'ACRA_CORPORATE',
    topicPattern: /company secretary|secretary appointment/i,
    text: 'ACRA’s general guidance says every company must have a company secretary, appointed within six months of successful registration. This states the general appointment timeline, not whether a particular person or company meets the applicable requirements.',
    prove: provesAcraSecretaryDeadline
  } : undefined;
  if (!rule || !expected || stream.authority !== expected.authority || stream.domain !== expected.domain ||
      issue.evidenceStatus !== 'VERIFIED' ||
      issue.applicationStatus === 'UNRESOLVED' &&
        !(rule === 'ACRA_SECRETARY_APPOINTMENT' && issue.operation === 'EXPLAIN_RULE' && hasExplicitGeneralIntent(query)) ||
      !['EXPLAIN_RULE', 'FILING_REQUIREMENT'].includes(issue.operation) || issue.population !== 'Company' ||
      !expected.topicPattern.test(issue.subject) || !isScopedPracticalRuleSubject(rule, issue.subject)) return undefined;

  for (const source of stream.sources) {
    if (!sourceForRule(rule, source) || !completeEvidenceFromClaims(rule, source, issue.id)) continue;
    return { authority: expected.authority, text: expected.text, title: source.title, officialUrl: source.officialUrl! };
  }
  return undefined;
}
