import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';

export interface IrasCpfExpansionRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  officialUrl?: string;
}

export interface IrasCpfExpansionEvidence {
  authority: 'IRAS' | 'CPF';
  text: string;
  title: string;
  officialUrl: string;
}

type ExpansionRule = 'IRAS_INPUT_TAX' | 'IRAS_ECI_FILING' | 'CPF_WAGE_CLASSIFICATION';

const IRAS_INPUT_TAX_URL = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax';
const IRAS_ECI_URL = 'https://www.iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-(eci)-filing';
const CPF_WAGES_URL = 'https://www.cpf.gov.sg/employer/employer-obligations/what-constitutes-wages-for-cpf-contributions';
const MAX_QUOTE_LENGTH = 4_500;

function visibleText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(?:p|li|tr|table|div|section|article|h[1-6]|ul|ol|main|dt|dd|th|td)\s*>/gi, '\n')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ' ';
    })
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isHistoricalOrCaseSpecific(query: string): boolean {
  return /\b(?:19|20)\d{2}\b|\b(?:historical|historic|previous|prior|former|old|superseded)\b/i.test(query)
    || /\b(?:my|our|this)\s+(?:company|business|employee|payroll|purchase|supplier|invoice|claim|revenue|eci)\b/i.test(query)
    || /\b(?:calculate|compute|estimate the|how much|will (?:we|my company|the company) qualify|are we eligible|can we claim this|based on these figures)\b/i.test(query);
}

function isStandaloneAdditionalWageDefinition(query: string): boolean {
  const asksForDefinition = /\b(?:define|definition|meaning|mean|means|explain|explains|describe|what is|what are|what does|what (?:kind|type) of|how does|how do)\b/i.test(query);
  return /\badditional wages?\b/i.test(query)
    && asksForDefinition
    && !/\b(?:ordinary wages?|\bow\b|bonuses?|\baws\b|allowances?|reimbursements?|components?|classif\w*|ceilings?|rates?|contributions?|calculate|compute|eligib\w*|qualif\w*|threshold|due date|deadline|payment timing)\b/i.test(query);
}

function recognizesRule(input: Pick<IrasCpfExpansionRequest, 'authority' | 'topicId' | 'query' | 'subject'>): ExpansionRule | undefined {
  const { authority, topicId, query, subject } = input;
  if (isHistoricalOrCaseSpecific(query)) return undefined;
  if (authority === 'CPF' && isStandaloneAdditionalWageDefinition(query)) return undefined;

  if (authority === 'IRAS' && topicId === 'iras-gst-input-tax'
    && /\b(?:gst|input tax|input gst)\b/i.test(query)
    && /\b(?:conditions?|requirements?|criteria|claim(?:ing)? input tax|input tax claim rules?)\b/i.test(query)
    && !/\b(?:motor cars?|vehicle exceptions?|staff medical|medical insurance|input tax apportionment|particular goods|missing trader fraud (?:checks?|indicators?|due diligence)|how to (?:ascertain|identify|check)|what (?:reasonable )?steps)\b/i.test(query)
    && /\b(?:gst|input tax|claim)\b/i.test(subject)) {
    return 'IRAS_INPUT_TAX';
  }

  if (authority === 'IRAS' && topicId === 'iras-cit-eci'
    && /\b(?:eci|estimated chargeable income)\b/i.test(query)
    && /\b(?:waiver|waive|exempt|nil|revenue|must|need|requirement|file|filing)\b/i.test(query)
    && !/\b(?:penalt\w*|late filing|failure to file|notice of assessment|estimated assessment|objection|appeal|revise|payment deadline|late payment)\b/i.test(query)
    && !(/\b(?:when|deadline|due date)\b/i.test(query) && !/\b(?:waiver|waive|nil|revenue|who must|who needs|need to file)\b/i.test(query))
    && /\b(?:eci|estimated chargeable income|corporate tax)\b/i.test(subject)) {
    return 'IRAS_ECI_FILING';
  }

  if (authority === 'CPF' && ['cpf-additional-wages', 'cpf-ordinary-wages', 'cpf-bonus-backpay'].includes(topicId)
    && /\b(?:cpf|central provident fund)\b/i.test(query)
    && /\b(?:classif\w*|ordinary wages?|additional wages?|\bow\b|\baw\b|allowances?|reimbursements?|bonuses?|\baws\b|what constitutes wages|which payments?|payments? (?:that )?attract cpf)\b/i.test(query)
    && !/\b(?:ceilings?|rates?|rate table|how much|calculate|compute|eligib\w*|qualif\w*|threshold)\b/i.test(query)
    && /\b(?:wages?|payroll|allowance|reimbursement|bonus|cpf)\b/i.test(subject)) {
    return 'CPF_WAGE_CLASSIFICATION';
  }
  return undefined;
}

function between(text: string, startPattern: RegExp, endPattern: RegExp): string | undefined {
  const start = startPattern.exec(text);
  if (!start || start.index < 0) return undefined;
  const rest = text.slice(start.index + start[0].length);
  const end = endPattern.exec(rest);
  const result = text.slice(start.index, end ? start.index + start[0].length + end.index : undefined).trim();
  return result || undefined;
}

function sentence(text: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(text);
  return match ? match[0].trim() : undefined;
}

function normalizedQuote(text: string): string {
  return text.replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/revenue\s+1\s+is/gi, 'revenue1 is')
    .replace(/\s+#/g, '#')
    .trim();
}

function inputTaxConditions(text: string): string | undefined {
  const source = visibleText(text).replace(/\s+([,.;:!?])/g, '$1');
  const start = /you can claim input tax incurred on your purchases only if all the following conditions are met:/i.exec(source);
  if (!start || start.index < 0) return undefined;
  const afterStart = start.index + start[0].length;
  const end = /8\.\s+you\b[^\n]{0,300}?reasonable steps[^\n]*\./i.exec(source.slice(afterStart));
  return end ? source.slice(start.index, afterStart + end.index + end[0].length).trim() : undefined;
}

function eciWaiverSection(text: string): string | undefined {
  return between(visibleText(text),
    /your company does not need to file eci in any year of assessment \(ya\) when both criteria are met:/i,
    /your company is required to self-assess if it qualifies for the eci filing waiver\./i);
}

function hasContextualRequirementDenial(text: string): boolean {
  return /\b(?:this|that|the same|above)\s+(?:condition|criterion|requirement|test)\b[^.!?;\n]{0,80}\b(?:no longer applies?|no longer required|not required|is unnecessary|does not apply|doesn't apply|does not matter|is false|was false)\b/i.test(text)
    || /\b(?:condition|criterion|requirement|test)\b[^.!?;\n]{0,70}\b(?:no longer applies?|no longer required|not required|is unnecessary|does not apply|doesn't apply)\b/i.test(text);
}

function hasInputTaxContradiction(text: string): boolean {
  const source = visibleText(text).toLowerCase();
  return /\b(?:you are not|you need not be|you do not need to be|not required to be)\s+(?:gst[- ]registered|registered for gst)\b/i.test(source)
    || /\b(?:goods or services|purchases?)\b[^.!?\n]{0,100}\b(?:not supplied to you|not imported by you|not used for (?:the )?purpose of your business)\b/i.test(source)
    || /\b(?:local purchases|input tax claims?)\b[^.!?\n]{0,100}\b(?:not supported by|do not need|do not require)\b[^.!?\n]{0,60}\b(?:tax invoice|invoice)\b/i.test(source)
    || /\bimports?\b[^.!?\n]{0,100}\b(?:do not need|not supported by|without)\b[^.!?\n]{0,50}\bimport permits?\b/i.test(source)
    || /\binput tax\b[^.!?\n]{0,100}\bnot attributable to taxable supplies\b/i.test(source)
    || /\b(?:all )?input tax claims?\b[^.!?\n]{0,100}\b(?:are|is) disallowed under regulations? 2[67]\b/i.test(source)
    || /\b(?:you have not taken|you need not take|no need to take) reasonable steps\b[^.!?\n]{0,100}\bmissing trader fraud\b/i.test(source)
    || /\breasonable steps?\b[^.!?\n]{0,100}\b(?:are not required|is not required|not needed)\b[^.!?\n]{0,100}\bmissing trader fraud\b/i.test(source);
}

function provesInputTaxConditions(text: string): boolean {
  const source = visibleText(text).toLowerCase();
  const conditions = inputTaxConditions(source);
  if (!conditions) return false;
  const normalized = conditions.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ');
  const required = [
    /1\.\s*you are gst-registered\b/,
    /2\.\s*the goods or services are supplied to you or imported by you\b/,
    /3\.\s*the goods or services are used or will be used for the purpose of your business\b/,
    /4\.\s*local purchases are supported by valid tax invoices addressed to you, or simplified tax invoices, at the time of claiming of the input tax\b/,
    /5\.\s*imports are supported by import permits that show that you are the importer of the goods and other supporting documents\b/,
    /6\.\s*the input tax is directly attributable to taxable supplies[\s\S]{0,220}that would be taxable supplies if made in singapore\b/,
    /7\.\s*the input tax claims are not disallowed under regulations 26 and 27 of the gst \(general\) regulations\b/,
    /8\.\s*you have taken reasonable steps to ascertain and concluded that the goods or services were not part of a missing trader fraud arrangement and the conclusion is one that a reasonable person would have made\b/
  ];
  return required.every(pattern => pattern.test(normalized));
}

function inputTaxConditionQuotes(text: string): string[] {
  const source = visibleText(text).replace(/\s+([,.;:!?])/g, '$1');
  const patterns = [
    /you can claim input tax incurred on your purchases only if all the following conditions are met:/i,
    /1\.\s*you are gst-registered;?/i,
    /2\.\s*the goods or services are supplied to you or imported by you;?/i,
    /3\.\s*the goods or services are used or will be used for the purpose of your business;?/i,
    /4\.\s*local purchases are supported by valid tax invoices addressed to you, or simplified tax invoices,\s*at the time of claiming of the input tax;?/i,
    /5\.\s*imports are supported by import permits that show that you are the importer of the goods and other supporting documents such as the supplier's invoices and relevant transport documents;?/i,
    /6\.\s*the input tax is directly attributable to taxable supplies[\s\S]{0,220}?that would be taxable supplies if made in singapore;?/i,
    /7\.\s*the input tax claims are not disallowed under regulations 26 and 27 of the gst \(general\) regulations;?/i,
    /8\.\s*you have taken reasonable steps to ascertain and concluded that the goods or services were not part of a missing trader fraud arrangement and the conclusion is one that a reasonable person would have made\.?/i
  ];
  const quotes = patterns.map(pattern => pattern.exec(source)?.[0].replace(/\s+/g, ' ').replace(/\s+\)/g, ')').trim());
  if (quotes.some(quote => typeof quote !== 'string' || quote.length > MAX_QUOTE_LENGTH)) return [];
  return quotes as string[];
}

function hasEciWaiverContradiction(text: string): boolean {
  const section = eciWaiverSection(text)?.toLowerCase();
  if (!section) return false;
  return hasContextualRequirementDenial(section)
    || /\b(?:revenue|turnover)(?:\s*\d)?\b[^.!?\n]{0,100}\b(?:exceeds?|more than|above)\s+\$?5\s+million\b/i.test(section)
    || /\b(?:annual revenue|revenue)\b[^.!?\n]{0,100}\b(?:must be|is required to be)\s+(?:nil|zero)\b/i.test(section)
    || /\beci\b[^.!?\n]{0,100}\b(?:may be positive|need not be nil|can be positive)\b/i.test(section)
    || /\b(?:exempt amount|partial tax exemption|tax exemption scheme for new start-up companies)\b[^.!?\n]{0,100}\b(?:deducted|subtracted) before determining (?:whether|if) (?:the )?eci is nil\b/i.test(section);
}

function provesEciFiling(text: string): boolean {
  const source = visibleText(text).toLowerCase();
  const waiver = eciWaiverSection(source);
  const hasGeneralFilingDuty = /your company has to file eci within 3 months from the end of your financial year unless:/i.test(source)
    && /your company qualifies for the eci filing waiver/i.test(source)
    && /your company is specifically not required to file eci/i.test(source);
  if (!waiver || !hasGeneralFilingDuty) return false;
  const hasRevenueCriterion = /(?:1\.\s*)?annual revenue\s*(?:\d+\s*)?is \$5 million or below for the financial year\b/i.test(waiver);
  const hasNilCriterion = /(?:2\.\s*)?eci is nil for the ya\.[\s\S]{0,180}amount before deducting the exempt amount under the partial tax exemption scheme or the tax exemption scheme for new\s+start-up companies\b/i.test(waiver);
  const hasRevenueDefinition = /revenue refers to a company's main source of income and excludes separate source income, such as interest, dividend and rental, which does not arise from its principal activity\./i.test(source)
    && /in the case of an investment holding company, the revenue is\s*its investment income/i.test(source);
  const selfAssessment = /your company is required to self-assess if it qualifies for the eci filing waiver/i.test(source);
  const separateCategoryExemption = /entities specifically not required to file eci[\s\S]{0,1000}foreign ship owners or charterers[\s\S]{0,500}foreign universities[\s\S]{0,500}designated unit trusts and approved cpf unit trusts[\s\S]{0,500}real estate investment trusts[\s\S]{0,500}specifically granted the waiver to furnish eci by iras/i.test(source);
  return hasRevenueCriterion && hasNilCriterion && hasRevenueDefinition && selfAssessment && separateCategoryExemption;
}

function cpfWageSection(text: string): string | undefined {
  return between(visibleText(text),
    /under the cpf act, wages are defined as remuneration in money/i,
    /the additional wage ceiling is computed as follows:/i)
    || between(visibleText(text),
      /under the cpf act, wages are defined as remuneration in money/i,
      /the additional wage ceiling calculator/i);
}

function hasCpfWageContradiction(text: string): boolean {
  const source = visibleText(text).toLowerCase();
  return hasContextualRequirementDenial(cpfWageSection(source) || source)
    || /for wages to be classified as ordinary wages[\s\S]{0,350}\bpayable after the 14th of the following month\b/i.test(source)
    || /\b(?:ordinary wages|ow)\b[^.!?\n]{0,150}\bpayable after the 14th of the following month\b/i.test(source)
    || /\b(?:annual performance bonus|annual bonus)\b[^.!?\n]{0,120}\b(?:is|are) ordinary wages\b/i.test(source)
    || /\b(?:reimbursements?|office stationery)\b[^.!?\n]{0,120}\b(?:are|is) wages? (?:and|that) (?:should|must) be included\b/i.test(source)
    || /\b(?:meal allowance|transport allowance|performance bonus|overtime pay)\b[^.!?\n]{0,100}\bnot wages\b/i.test(source);
}

function provesCpfWageClassification(text: string): boolean {
  const source = visibleText(text).toLowerCase();
  const section = cpfWageSection(source);
  if (!section || section.length > MAX_QUOTE_LENGTH) return false;
  const normalized = section.replace(/\s+/g, ' ');
  const facts = [
    /wages are defined as remuneration in money, including any bonus that is due or granted to a person in respect of his employment\./,
    /only payments that are considered wages should be included when declaring wage information and computing cpf contributions\./,
    /payments to include as wages[\s\S]{0,500}basic wage[\s\S]{0,120}overtime pay[\s\S]{0,120}bonus[\s\S]{0,120}allowance[\s\S]{0,120}commission[\s\S]{0,120}cash incentive/,
    /payments not to include as wages[\s\S]{0,300}termination benefit[\s\S]{0,240}reimbursement[\s\S]{0,240}official purposes[\s\S]{0,140}must not exceed the expenditure incurred[\s\S]{0,150}benefit in kind/,
    /classifying wages as ordinary wages or additional wages/,
    /ordinary wages[\s\S]{0,250}employment in that month[\s\S]{0,150}payable by the 14th of the following month/,
    /wages which are not classified as ordinary wages will be additional wages for the month/,
    /annual performance bonus/
  ];
  return facts.every(pattern => pattern.test(normalized));
}

function ruleHasContradiction(rule: ExpansionRule, sourceText: string): boolean {
  const source = visibleText(sourceText);
  if (/\b(?:it is false that|it is not true that|it is incorrect that|it is not the case that|does not state that)\b/i.test(source)) return true;
  if (rule === 'IRAS_INPUT_TAX') {
    const conditions = inputTaxConditions(source);
    return Boolean(conditions && (hasInputTaxContradiction(conditions) || hasContextualRequirementDenial(conditions)));
  }
  if (rule === 'IRAS_ECI_FILING') return hasEciWaiverContradiction(source);
  return hasCpfWageContradiction(source);
}

/** Contradiction-only source guard. Incomplete premises alone do not reject a source for other rules. */
export function hasIrasCpfExpansionContradiction(input: IrasCpfExpansionRequest): boolean {
  const rule = recognizesRule(input);
  return rule ? ruleHasContradiction(rule, input.sourceText) : false;
}

function prove(rule: ExpansionRule, sourceText: string): boolean {
  if (ruleHasContradiction(rule, sourceText)) return false;
  if (rule === 'IRAS_INPUT_TAX') return provesInputTaxConditions(sourceText);
  if (rule === 'IRAS_ECI_FILING') return provesEciFiling(sourceText);
  return provesCpfWageClassification(sourceText);
}

function allowedUrl(rule: ExpansionRule): string {
  return rule === 'IRAS_INPUT_TAX' ? IRAS_INPUT_TAX_URL
    : rule === 'IRAS_ECI_FILING' ? IRAS_ECI_URL
      : CPF_WAGES_URL;
}

function exactOfficialUrl(value: string | undefined, expected: string): boolean {
  if (!value) return false;
  try {
    const actual = new URL(value);
    const required = new URL(expected);
    return actual.protocol === 'https:' && actual.hostname === required.hostname
      && actual.pathname === required.pathname && !actual.search && !actual.hash && !actual.username && !actual.password;
  } catch {
    return false;
  }
}

/** Undefined means this module does not own the topic; false means required source facts fail closed. */
export function supportIrasCpfExpansionRule(input: IrasCpfExpansionRequest): boolean | undefined {
  const rule = recognizesRule(input);
  if (!rule || isHistoricalOrCaseSpecific(input.query)) return rule ? false : undefined;
  if (input.officialUrl && !exactOfficialUrl(input.officialUrl, allowedUrl(rule))) return false;
  return prove(rule, input.sourceText);
}

/** Returns exact, bounded visible passages only after the complete page has passed its rule proof. */
export function selectIrasCpfExpansionQuotes(input: IrasCpfExpansionRequest): string[] {
  const rule = recognizesRule(input);
  if (!rule || !exactOfficialUrl(input.officialUrl, allowedUrl(rule)) || supportIrasCpfExpansionRule(input) !== true) return [];
  const source = visibleText(input.sourceText);
  if (rule === 'IRAS_INPUT_TAX') {
    return inputTaxConditionQuotes(source);
  }
  if (rule === 'IRAS_ECI_FILING') {
    const quotes = [
      sentence(source, /your company has to file eci within 3 months from the end of your financial year unless:/i),
      sentence(source, /your company qualifies for the eci filing waiver;/i),
      sentence(source, /your company is specifically not required to file eci\.?/i),
      sentence(source, /your company does not need to file eci in any year of assessment \(ya\) when both criteria are met:/i),
      sentence(source, /annual revenue\s*1?\s*is \$5 million or below for the financial year;/i),
      sentence(source, /eci is nil for the ya\./i),
      sentence(source, /the eci should be the amount before deducting the exempt amount under the partial tax exemption scheme or the tax exemption scheme for new\s+start-up companies\s*\./i),
      sentence(source, /revenue refers to a company's main source of income and excludes separate source income, such as interest, dividend and rental, which does not arise from its principal activity\./i),
      sentence(source, /in the case of an investment holding company, the revenue is[\s\S]{0,160}?interest income\)\./i),
      sentence(source, /your company is required to self-assess if it qualifies for the eci filing waiver\./i),
      sentence(source, /entities specifically not required to file eci/i),
      sentence(source, /if your company falls within 1 of the following categories, it does not need to file eci:?/i),
      sentence(source, /foreign ship owners or charterers[\s\S]{0,400}?shipping return(?:\s*\(pdf,\s*\d+\s*kb\))?/i),
      sentence(source, /foreign universities/i),
      sentence(source, /designated unit trusts and approved cpf unit trusts\s*#?/i),
      sentence(source, /real estate investment trusts that have been granted the tax treatment under section 43\(2\) of the income tax act 1947/i),
      sentence(source, /cases specifically granted the waiver to furnish eci by iras\.?/i)
    ].filter((quote): quote is string => Boolean(quote)).map(normalizedQuote);
    return quotes.every(quote => quote.length <= MAX_QUOTE_LENGTH) ? quotes : [];
  }
  const quote = cpfWageSection(source);
  return quote && quote.length <= MAX_QUOTE_LENGTH ? [quote] : [];
}

function ruleForPresentedIssue(query: string, authority: string, subject: string): ExpansionRule | undefined {
  if (authority === 'IRAS' && /\b(?:input tax|input gst)\b/i.test(query)
    && /\b(?:input tax|gst|claim)\b/i.test(subject)) {
    return recognizesRule({ authority, topicId: 'iras-gst-input-tax', query, subject });
  }
  if (authority === 'IRAS' && /\b(?:eci|estimated chargeable income)\b/i.test(query)
    && /\b(?:eci|estimated chargeable income|corporate tax)\b/i.test(subject)) {
    return recognizesRule({ authority, topicId: 'iras-cit-eci', query, subject });
  }
  if (authority === 'CPF' && /\b(?:cpf|central provident fund)\b/i.test(query)
    && /\b(?:wages?|pay|allowance|reimbursement|bonus|cpf)\b/i.test(subject)) {
    const topicId = /\b(?:additional wages?|\baw\b|bonus|aws)\b/i.test(query) ? 'cpf-additional-wages' : 'cpf-ordinary-wages';
    return recognizesRule({ authority, topicId, query, subject });
  }
  return undefined;
}

function expectedSource(authority: 'IRAS' | 'CPF', rule: ExpansionRule, source: AuthorityPresentedSource): boolean {
  return source.provenance === 'LIVE_EXTERNAL' && !source.validTo
    && source.officialUrl === allowedUrl(rule)
    && (authority === 'IRAS' || rule === 'CPF_WAGE_CLASSIFICATION');
}

function expectedDomain(rule: ExpansionRule): string {
  return rule === 'CPF_WAGE_CLASSIFICATION' ? 'CPF_PAYROLL'
    : rule === 'IRAS_INPUT_TAX' ? 'IRAS_GST' : 'IRAS_CORPORATE_TAX';
}

function answerText(rule: ExpansionRule): string {
  if (rule === 'IRAS_INPUT_TAX') {
    return 'IRAS allows an input tax claim only when all applicable conditions are met: the claimant is GST-registered; the goods or services are supplied to or imported by it and are used for its business; local purchases have valid tax invoices and imports have the required import permits and supporting documents; the input tax is attributable to qualifying taxable or specified out-of-scope supplies; the claim is not disallowed under Regulations 26 or 27; and the claimant has taken reasonable steps to conclude that the goods or services are not part of a Missing Trader Fraud arrangement, on a conclusion a reasonable person would make. This is a general rule; a specific claim also depends on its facts and any applicable exceptions.';
  }
  if (rule === 'IRAS_ECI_FILING') {
    return 'A company generally files ECI within three months after its financial year end unless it is specifically not required to file or qualifies for the waiver. For each Year of Assessment, the waiver requires both annual revenue of S$5 million or less for the financial year and nil ECI before deducting the partial tax exemption or new start-up tax exemption. Revenue generally means income from the company’s main activity, with separate-source income excluded where it does not arise from that activity; an investment holding company’s revenue is its investment income. The company self-assesses whether it qualifies. IRAS also lists categories separately exempt from filing, so check the current official guidance before applying the rule to a particular entity.';
  }
  return 'CPF wage treatment has two steps. First decide whether a payment is wages: CPF Board lists salary, overtime pay, bonuses, meal and transport allowances, commissions and cash incentives as examples of wages; a qualifying reimbursement for official employer expenses is excluded when it does not exceed the expense, as are specified termination benefits and non-cash benefits. Then classify wages as Ordinary Wages (OW) only when they are for employment in that month and payable by the 14th of the following month. Wages that do not meet the OW definition are Additional Wages (AW); an annual performance bonus is an example. OW and AW are both part of total wages and are subject to their applicable ceilings. Specific contribution amounts depend on the employee’s facts and the relevant contribution period.';
}

/** Renders general rule explanations only from complete exact claims bound to this issue and page revision. */
export function getIrasCpfExpansionEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): IrasCpfExpansionEvidence | undefined {
  const rule = ruleForPresentedIssue(query, stream.authority, issue.subject);
  if (!rule) return undefined;
  const authority = rule === 'CPF_WAGE_CLASSIFICATION' ? 'CPF' : 'IRAS';
  const populationAllowed = rule === 'CPF_WAGE_CLASSIFICATION' ? ['Employer', 'Employee'] : ['Company'];
  if (stream.authority !== authority || stream.domain !== expectedDomain(rule)
    || !populationAllowed.includes(issue.population)
    || !['EXPLAIN_RULE', 'FILING_REQUIREMENT'].includes(issue.operation)
    || issue.evidenceStatus !== 'VERIFIED'
    || !['NOT_REQUIRED', 'UNRESOLVED'].includes(issue.applicationStatus)
    || !stream.issues.some(candidate => candidate.id === issue.id && candidate.evidenceStatus === 'VERIFIED')) return undefined;

  for (const source of stream.sources) {
    if (!expectedSource(authority, rule, source)) continue;
    const completeBoundRule = groupExactIssueClaimsByDocument(source, issue.id)
      .some(group => prove(rule, group.map(claim => claim.text).join('\n\n')));
    if (!completeBoundRule) continue;
    return { authority, text: answerText(rule), title: source.title, officialUrl: source.officialUrl! };
  }
  return undefined;
}
