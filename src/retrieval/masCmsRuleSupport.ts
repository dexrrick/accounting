import type { BoundedStatutoryAdvisorySupportInput } from './statutoryAdvisorySupport';

type MasRuleProfile = 'MAS_CMS_LICENSE_GENERAL_RULE';

function compact(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ' ';
    });
}

function hasCmsIdentity(text: string): boolean {
  return /\bcms\b|\bcapital\s+markets\s+services\b/i.test(text);
}

function hasGeneralRuleAskClause(text: string): boolean {
  return text.split(/[?!.;\r\n]+/).some(clause => {
    if (!hasCmsIdentity(clause)) return false;
    return /\b(?:what\s+is|define|definition|meaning|overview)\b/i.test(clause)
      || /\b(?:when|whether|in\s+what\s+circumstances)\b.{0,100}\b(?:required|requirement|must)\b/i.test(clause)
      || /\b(?:general|generally)\b.{0,80}\b(?:rule|requirement|licensing|licence|license|required)\b/i.test(clause)
      || /\b(?:licensing|licen[cs]e)\s+requirements?\b/i.test(clause);
  });
}

function hasOutOfScopeRequest(input: BoundedStatutoryAdvisorySupportInput): boolean {
  const request = `${input.subject}\n${input.originalQuery ?? ''}`;
  return /\b(?:financial\s+advis(?:er|or)s?|digital\s+payment\s+tokens?|dpt)\b/i.test(request)
    || /\bfund\s+managers?\b.{0,100}\b(?:admission|criteria|eligibility|application|requirements?)\b/i.test(request)
    || /\b(?:admission|criteria|eligibility)\b.{0,100}\bfund\s+managers?\b/i.test(request)
    || /\b(?:licen[cs]e\s+)?fees?\b|\b(?:minimum|base|regulatory)\s+capital\s+requirements?\b|\bcapital\s+adequacy\b/i.test(request)
    || /\b(?:my|our|this)\s+(?:company|business|entity)\b|\bdo\s+(?:i|we)\s+need\s+(?:a\s+)?(?:cms\s+)?licen[cs]e\b/i.test(request);
}

function recognizeProfile(input: BoundedStatutoryAdvisorySupportInput): MasRuleProfile | undefined {
  const authority = compact(input.authority).replace(/ /g, '');
  const topicId = compact(input.topicId).replace(/ /g, '');
  if (!['mas', 'monetaryauthorityofsingapore'].includes(authority) || topicId !== 'mascmslicence') return undefined;
  if (hasOutOfScopeRequest(input)) return undefined;
  if (!hasCmsIdentity(input.subject) || !hasGeneralRuleAskClause(input.originalQuery ?? '')) return undefined;
  return 'MAS_CMS_LICENSE_GENERAL_RULE';
}

function cleanVisibleText(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|nav|header|footer|aside|button|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi, ' ')
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]\s*>/gi, ' ')
    .replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' '))
    .normalize('NFKD')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

function sourceParagraphs(sourceText: string): string[] {
  const withoutChrome = sourceText
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|nav|header|footer|aside|button|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi, ' ')
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]\s*>/gi, ' ');
  const paragraphMarkup = [...withoutChrome.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)];
  const blocks = paragraphMarkup.length > 0
    ? paragraphMarkup.flatMap(match => cleanVisibleText(match[1]).split(/\n{2,}/))
    : cleanVisibleText(withoutChrome).split(/\n{1,}/);
  return blocks.map(block => decodeHtmlEntities(block)
    .normalize('NFKD')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().toLowerCase()).filter(Boolean);
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+/).map(sentence => sentence.trim()).filter(Boolean);
}

function hasCmsLicense(text: string): boolean {
  return /\bcms\s+licen[cs]e\b|\bcapital\s+markets\s+services\s+licen[cs]e\b/i.test(text);
}

function hasSfaAnchor(text: string): boolean {
  return /\bsfa\b|\bsecurities\s+(?:and|&)\s+futures\s+act\b/i.test(text);
}

function hasMandatoryHoldingDuty(text: string): boolean {
  const affirmative = /\b(?:must|shall|is\s+required\s+to|are\s+required\s+to|needs?\s+to|has\s+to|have\s+to)\s+(?:hold|obtain|possess|maintain)\s+(?:(?:a|an|the|its|valid)\s+)?(?:cms|capital\s+markets\s+services)\s+licen[cs]e\b/i;
  const negated = /\b(?:(?:does|do|did)\s+not\s+(?:need\s+to|have\s+to)|needs?\s+not|not\s+required\s+to|(?:must|shall)\s+not|cannot|may\s+not)\s+(?:hold|obtain|possess|maintain)\s+(?:(?:a|an|the|its|valid)\s+)?(?:cms|capital\s+markets\s+services)\s+licen[cs]e\b/i;
  return affirmative.test(text) && !negated.test(text);
}

function hasCompanyRegulatedActivityLink(text: string): boolean {
  return /\b(?:company|companies|entity|entities)\b/i.test(text)
    && /\bregulated\s+activities\b/i.test(text)
    && /\b(?:under|pursuant\s+to)\b.{0,45}\b(?:sfa|securities\s+(?:and|&)\s+futures\s+act)\b/i.test(text)
    && /\b(?:if|when|where)\b.{0,100}\b(?:company|companies|entity|entities)\b/i.test(text);
}

function hasCapitalPointerOrExample(text: string): boolean {
  return /\b(?:minimum|base|regulatory)\s+capital\b|\bcapital\s+(?:requirement|adequacy)\b|\b(?:sgd|s\$)\s*\$?\s*\d|\$\s*\d[\d,]*(?:\.\d{1,2})?\b/i.test(text);
}

function hasContradictoryCmsDuty(text: string): boolean {
  const negativeDuty = /\b(?:company|companies|entity|entities|it|they)\b.{0,90}\b(?:(?:does|do|did)\s+not\s+(?:need\s+to|have\s+to)|needs?\s+not|not\s+required\s+to|(?:must|shall)\s+not|cannot|may\s+not)\s+(?:hold|obtain|possess|maintain)\b.{0,50}\b(?:cms|capital\s+markets\s+services)\s+licen[cs]e\b/i;
  const noLicenseRequired = /\bno\s+(?:cms|capital\s+markets\s+services)\s+licen[cs]e\s+(?:is|are)\s+required\b/i;
  const mustHoldNone = /\b(?:must|shall)\s+hold\s+no\s+(?:cms|capital\s+markets\s+services)\s+licen[cs]e\b/i;
  return negativeDuty.test(text) || noLicenseRequired.test(text) || mustHoldNone.test(text);
}

function supportsCmsGeneralRule(sourceText: string): boolean {
  return sourceParagraphs(sourceText).some(paragraph => {
    if (hasCapitalPointerOrExample(paragraph) || hasContradictoryCmsDuty(paragraph)) return false;
    return splitSentences(paragraph).some(sentence => hasCmsLicense(sentence)
      && hasSfaAnchor(sentence)
      && hasMandatoryHoldingDuty(sentence)
      && hasCompanyRegulatedActivityLink(sentence));
  });
}

/**
 * Supports only MAS's general CMS licence rule when the question explicitly asks
 * for the CMS definition or general licensing requirement. Provenance, topic
 * admission, complete quotations and user-specific application remain separate gates.
 */
export function supportMasCmsRule(input: BoundedStatutoryAdvisorySupportInput): boolean | undefined {
  const profile = recognizeProfile(input);
  if (profile === undefined) return undefined;
  const paragraphs = sourceParagraphs(input.sourceText);
  if (paragraphs.length === 0) return false;
  return supportsCmsGeneralRule(input.sourceText);
}
