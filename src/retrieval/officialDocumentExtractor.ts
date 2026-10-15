import type { QueryDomain, StatutoryAuthority } from '../types/accounting';
import type { AuthoritativeSourceRecord, SourceLocator } from '../standards/unifiedSourceModel';
import { SINGAPORE_STATUTORY_REPOSITORY } from '../standards/singaporeStatutesKnowledge';
import { computeProvisionHash, computeSha256Bytes } from '../standards/sourceVersioning';
import {
  defaultExternalSourceValidator,
  type TopicContentExpectation
} from './externalSourceValidator';
import {
  cleanHtmlText,
  extractSSOProvision
} from './sourceAdapters';
import {
  ControlledWebRetriever,
  type ControlledFetchResult,
  defaultControlledWebRetriever
} from './controlledWebRetriever';
import {
  extractPdfDocumentText,
  PdfDocumentExtractionError,
  type PdfTextExtraction
} from './pdfDocumentTextExtractor';

export interface OfficialDocumentLegislationExpectation {
  actCode: string;
  actTitle: string;
  section: string;
}

export interface OfficialDocumentExtractionRequest {
  url: string;
  authority: StatutoryAuthority;
  domain: QueryDomain;
  expectedTopic: TopicContentExpectation;
  standardOrActCode: string;
  legalOrStandardInstrument: string;
  documentKind?: 'AUTO' | 'HTML' | 'TEXT' | 'PDF' | 'SSO_LEGISLATION';
  relevantSection?: string;
  sectionHeading?: string;
  elementId?: string;
  legislation?: OfficialDocumentLegislationExpectation;
  /** A historical claim is accepted only when a bounded source-text interval contains this ISO date. */
  asOfDate?: string;
  topicIds?: string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export type OfficialDocumentExtractionResult =
  | { status: 'SUCCESS'; record: AuthoritativeSourceRecord }
  | { status: 'REJECTED'; code: string; reason: string };

interface PublisherInfo {
  publisher: string;
  authority: StatutoryAuthority;
  sourceAuthority?: AuthoritativeSourceRecord['sourceAuthority'];
}

interface SelectedText {
  text: string;
  locator: SourceLocator;
  exactBoundary: boolean;
  heading?: string;
  pageNumber?: number;
  substantive?: boolean;
}

interface HtmlElementBoundary {
  tagName: string;
  idValue?: string;
  idAttributeCount: number;
  startOffset: number;
  endOffset?: number;
  hidden: boolean;
  malformed: boolean;
}

interface ApplicabilityDates {
  effectiveDate?: string;
  validFrom?: string;
  validTo?: string;
  invalid?: boolean;
}

const AUTHORITY_NAMES: Partial<Record<StatutoryAuthority, string>> = {
  IRAS: 'Inland Revenue Authority of Singapore',
  ACRA: 'Accounting and Corporate Regulatory Authority',
  CPF: 'Central Provident Fund Board',
  MOM: 'Ministry of Manpower',
  MAS: 'Monetary Authority of Singapore',
  ASC: 'Accounting Standards Council',
  CUSTOMS: 'Singapore Customs',
  AGC: "Attorney-General's Chambers",
  SSO: 'Singapore Statutes Online'
};

const DIRECT_PUBLISHERS: Record<string, PublisherInfo> = {
  'iras.gov.sg': { publisher: 'Inland Revenue Authority of Singapore', authority: 'IRAS', sourceAuthority: 'IRAS' },
  'www.iras.gov.sg': { publisher: 'Inland Revenue Authority of Singapore', authority: 'IRAS', sourceAuthority: 'IRAS' },
  'acra.gov.sg': { publisher: 'Accounting and Corporate Regulatory Authority', authority: 'ACRA', sourceAuthority: 'ACRA' },
  'www.acra.gov.sg': { publisher: 'Accounting and Corporate Regulatory Authority', authority: 'ACRA', sourceAuthority: 'ACRA' },
  'cpf.gov.sg': { publisher: 'Central Provident Fund Board', authority: 'CPF', sourceAuthority: 'CPF' },
  'www.cpf.gov.sg': { publisher: 'Central Provident Fund Board', authority: 'CPF', sourceAuthority: 'CPF' },
  'mom.gov.sg': { publisher: 'Ministry of Manpower', authority: 'MOM', sourceAuthority: 'MOM' },
  'www.mom.gov.sg': { publisher: 'Ministry of Manpower', authority: 'MOM', sourceAuthority: 'MOM' },
  'mas.gov.sg': { publisher: 'Monetary Authority of Singapore', authority: 'MAS', sourceAuthority: 'MAS' },
  'www.mas.gov.sg': { publisher: 'Monetary Authority of Singapore', authority: 'MAS', sourceAuthority: 'MAS' },
  'sso.agc.gov.sg': { publisher: 'Singapore Statutes Online / Attorney-General’s Chambers', authority: 'AGC', sourceAuthority: 'AGC' },
  'asc.acra.gov.sg': { publisher: 'Accounting Standards Council', authority: 'ASC' }
};

const AUTHORITY_DOMAINS: Partial<Record<StatutoryAuthority, QueryDomain[]>> = {
  IRAS: ['IRAS_TAX', 'IRAS_GST'],
  ACRA: ['ACRA_CORP'],
  CPF: ['CPF_BOARD'],
  MOM: ['MOM_EMPLOYMENT'],
  MAS: ['MAS_FUNDS'],
  ASC: ['ACCOUNTING_SFRS'],
  AGC: ['MULTI_AUTHORITY', 'GENERAL'],
  SSO: ['MULTI_AUTHORITY', 'GENERAL']
};

const MONTH_NUMBER: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
};
const DATE_PATTERN = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})`;
const MAX_OFFICIAL_DOCUMENT_BYTES = 1_500_000;

function reject(code: string, reason: string): OfficialDocumentExtractionResult {
  return { status: 'REJECTED', code, reason };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function matchesAnyText(text: string, candidates: string[]): boolean {
  const normalizedText = normalizeText(text);
  return candidates.some(candidate => {
    const normalizedCandidate = normalizeText(candidate);
    return normalizedCandidate.length > 0 && normalizedText.includes(normalizedCandidate);
  });
}

function validateRequest(request: OfficialDocumentExtractionRequest): string | undefined {
  if (!request.url || !request.standardOrActCode.trim() || !request.legalOrStandardInstrument.trim()) {
    return 'A URL, standard or Act identifier, and instrument title are required';
  }
  if (!AUTHORITY_NAMES[request.authority]) return `Unsupported governing authority '${request.authority}'`;
  if (!AUTHORITY_DOMAINS[request.authority]?.includes(request.domain)) {
    return `Domain '${request.domain}' is not registered for authority '${request.authority}'`;
  }
  const topic = request.expectedTopic;
  if (!topic || !Array.isArray(topic.standardIdentifiers) || !topic.standardIdentifiers.some(value => value.trim()) ||
      !Array.isArray(topic.expectedTitles) || !topic.expectedTitles.some(value => value.trim()) ||
      !Array.isArray(topic.topicTerms) || !topic.topicTerms.some(value => value.trim())) {
    return 'A document request requires standard identifiers, expected titles, and topic terms';
  }
  const minimumMatches = topic.minimumTopicTermMatches ?? 1;
  if (!Number.isInteger(minimumMatches) || minimumMatches < 1 || minimumMatches > topic.topicTerms.length) {
    return 'Topic term match threshold is outside the supplied topic-term set';
  }
  if (request.elementId && !/^[\w:.-]{1,128}$/.test(request.elementId)) return 'The requested HTML element identifier is invalid';
  if (request.legislation && request.documentKind && request.documentKind !== 'SSO_LEGISLATION') {
    return 'An SSO Act expectation cannot be combined with a non-legislation document kind';
  }
  if ((request.documentKind === 'SSO_LEGISLATION' || request.legislation) && !request.legislation) {
    return 'SSO legislation retrieval requires an Act code, Act title, and exact section';
  }
  if (request.asOfDate && (!/^\d{4}-\d{2}-\d{2}$/.test(request.asOfDate) || !parseSourceDate(request.asOfDate))) {
    return 'Historical applicability dates must use a valid ISO YYYY-MM-DD date';
  }
  if (request.maxResponseBytes !== undefined && (!Number.isInteger(request.maxResponseBytes) || request.maxResponseBytes <= 0 || request.maxResponseBytes > MAX_OFFICIAL_DOCUMENT_BYTES)) {
    return 'Maximum document response size must be a positive integer within the official-source byte limit';
  }
  return undefined;
}

function resolvePublisher(finalUrl: string, authority: StatutoryAuthority): PublisherInfo | undefined {
  let parsed: URL;
  try { parsed = new URL(finalUrl); } catch { return undefined; }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'ask.gov.sg') {
    const pathAuthority = parsed.pathname.split('/').filter(Boolean)[0]?.toUpperCase();
    if (pathAuthority === authority) return { publisher: 'Ask.gov.sg', authority, sourceAuthority: 'ASK_GOV_SG' };
    return undefined;
  }
  const publisher = DIRECT_PUBLISHERS[hostname];
  return publisher?.authority === authority || (hostname === 'sso.agc.gov.sg' && authority !== 'AGC' && authority !== 'SSO')
    ? publisher
    : undefined;
}

function supportedAct(request: OfficialDocumentExtractionRequest): { actTitle: string; authorityName: string } | undefined {
  const expected = request.legislation;
  if (!expected) return undefined;
  const actCode = expected.actCode.trim();
  const actTitle = normalizeText(expected.actTitle);
  const legalInstrument = normalizeText(request.legalOrStandardInstrument);
  if (!actCode || !actTitle || normalizeText(request.standardOrActCode) !== normalizeText(actCode) || legalInstrument !== actTitle) return undefined;
  const matchingRules = Object.values(SINGAPORE_STATUTORY_REPOSITORY).filter(rule => {
    let canonical: URL;
    try { canonical = new URL(rule.canonicalUrl); } catch { return false; }
    return canonical.hostname.toLowerCase() === 'sso.agc.gov.sg' &&
      canonical.pathname.toLowerCase() === `/act/${actCode}`.toLowerCase() &&
      rule.authority === request.authority &&
      rule.actCode.toLowerCase() === actCode.toLowerCase() &&
      normalizeText(rule.actTitle) === actTitle;
  });
  if (matchingRules.length === 0) return undefined;
  const distinctTitles = new Set(matchingRules.map(rule => normalizeText(rule.actTitle)));
  if (distinctTitles.size !== 1) return undefined;
  return { actTitle: matchingRules[0].actTitle, authorityName: matchingRules[0].authorityName };
}

const EXCLUDED_HTML_ANCESTORS = new Set(['aside', 'footer', 'nav', 'script', 'style', 'template', 'noscript', 'svg']);
const VOID_HTML_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function scanHtmlElements(html: string): HtmlElementBoundary[] {
  const elements: HtmlElementBoundary[] = [];
  const stack: HtmlElementBoundary[] = [];
  const tokens = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][\w:-]*)\b([^>]*)>/gi;
  for (const match of html.matchAll(tokens)) {
    const raw = match[0];
    if (raw.startsWith('<!--') || raw.startsWith('<!')) continue;
    const tagName = (match[1] || '').toLowerCase();
    const offset = match.index ?? 0;
    if (raw.startsWith('</')) {
      let stackIndex = stack.length - 1;
      while (stackIndex >= 0 && stack[stackIndex].tagName !== tagName) stackIndex--;
      if (stackIndex < 0) continue;
      for (let index = stack.length - 1; index >= stackIndex; index--) {
        stack[index].endOffset = offset + raw.length;
        if (index !== stackIndex) stack[index].malformed = true;
      }
      if (stackIndex !== stack.length - 1) stack[stackIndex].malformed = true;
      stack.splice(stackIndex);
      continue;
    }

    const attributes = match[2] || '';
    const idAttributes = [...attributes.matchAll(/(?:^|\s)id(?=\s|=|$)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/gi)];
    const element: HtmlElementBoundary = {
      tagName,
      ...(idAttributes.length ? { idValue: idAttributes[0][1] ?? idAttributes[0][2] ?? idAttributes[0][3] ?? '' } : {}),
      idAttributeCount: idAttributes.length,
      startOffset: offset,
      hidden: EXCLUDED_HTML_ANCESTORS.has(tagName) || stack.some(parent => parent.hidden),
      malformed: false
    };
    elements.push(element);
    if (VOID_HTML_ELEMENTS.has(tagName) || /\/\s*>$/.test(raw)) element.endOffset = offset + raw.length;
    else stack.push(element);
  }
  for (const element of stack) element.malformed = true;
  return elements;
}

function exactHtmlElement(html: string, elementId: string): { text: string; startOffset: number; endOffset: number; tagName: string; substantive: boolean; tableStructure: SourceLocator['tableStructure'] } | undefined {
  const matches = scanHtmlElements(html).filter(element => element.idValue === elementId && !element.hidden);
  if (matches.length !== 1) return undefined;
  const match = matches[0];
  if (match.idAttributeCount !== 1 || match.hidden || match.malformed || match.endOffset === undefined ||
      ['a', 'area', 'button', 'img', 'input', 'link', 'meta', 'option'].includes(match.tagName)) return undefined;
  const visibleMarkup = html.slice(match.startOffset, match.endOffset);
  const text = cleanHtmlText(visibleMarkup.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|noscript|svg|template|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' '));
  const tableStructure = assessHtmlTableStructure(visibleMarkup);
  return text.length > 0
    ? { text, startOffset: match.startOffset, endOffset: match.endOffset, tagName: match.tagName,
      substantive: hasSubstantiveHtmlContent(visibleMarkup), tableStructure }
    : undefined;
}

function assessHtmlTableStructure(markup: string): SourceLocator['tableStructure'] {
  const cleanMarkup = markup.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
  const tables = [...cleanMarkup.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)];
  if (tables.length === 0) return 'NONE';
  for (const table of tables) {
    const tableBody = table[1];
    if (/<table\b/i.test(tableBody)) return 'AMBIGUOUS';
    const rows = [...tableBody.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr\s*>/gi)];
    if (rows.length < 2) return 'AMBIGUOUS';
    const parsedRows = rows.map(row => {
      const cells = [...row[2].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)];
      if (cells.some(cell => /\b(?:colspan|rowspan)\s*=\s*["']?\d+/i.test(cell[2]))) return undefined;
      return cells.map(cell => cleanHtmlText(cell[3]));
    });
    const expectedCount = parsedRows[0]?.length ?? 0;
    if (expectedCount < 2 || parsedRows.some(row => !row || row.length !== expectedCount || row.some(cell => !cell))) return 'AMBIGUOUS';
  }
  return 'PRESERVED';
}

function hasSubstantiveHtmlContent(markup: string): boolean {
  const withoutChrome = markup
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|noscript|svg|template|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, ' ');
  const proseBlocks = [...withoutChrome.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)]
    .map(match => cleanHtmlText(match[2]))
    .filter(text => text.length >= 35 && text.split(/\s+/).length >= 6);
  if (proseBlocks.length > 0) return true;
  return assessHtmlTableStructure(withoutChrome) === 'PRESERVED';
}

function extractHtmlHeadingSection(html: string, requestedHeading: string): SelectedText | undefined {
  const candidates = scanHtmlElements(html).filter(element => /^h[1-6]$/.test(element.tagName) && !element.hidden &&
    !element.malformed && element.endOffset !== undefined).map(element => ({
      level: Number(element.tagName[1]),
      tagName: element.tagName,
      heading: cleanHtmlText(html.slice(element.startOffset, element.endOffset)),
      start: element.startOffset,
      end: element.endOffset as number
    }));
  const requested = normalizeText(requestedHeading);
  const found = candidates.filter(candidate => normalizeText(candidate.heading) === requested);
  if (found.length !== 1) return undefined;
  const selected = found[0];
  const nextHeading = candidates.find(candidate => candidate.start > selected.start && candidate.level <= selected.level);
  const mainClose = html.indexOf('</main', selected.end);
  const articleClose = html.indexOf('</article', selected.end);
  const bodyClose = html.indexOf('</body', selected.end);
  const contentEnd = [mainClose, articleClose, bodyClose].filter(offset => offset >= 0).sort((a, b) => a - b)[0];
  const endOffset = nextHeading?.start ?? contentEnd ?? html.length;
  if (endOffset <= selected.start) return undefined;
  const visibleMarkup = html.slice(selected.start, endOffset)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|noscript|svg|template|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const text = cleanHtmlText(visibleMarkup);
  const tableStructure = assessHtmlTableStructure(visibleMarkup);
  return text.length > 0 ? {
    text,
    locator: {
      heading: selected.heading,
      startOffset: selected.start,
      endOffset,
      boundary: { startOffset: selected.start, endOffset },
      sourceNode: selected.tagName,
      tableStructure,
      sourceType: 'HTML'
    },
    exactBoundary: tableStructure !== 'AMBIGUOUS',
    heading: selected.heading,
    substantive: hasSubstantiveHtmlContent(visibleMarkup)
  } : undefined;
}

function selectHtmlText(html: string, request: OfficialDocumentExtractionRequest): SelectedText | undefined {
  if (request.elementId) {
    const match = exactHtmlElement(html, request.elementId);
    if (!match) return undefined;
    return {
      text: match.text,
      locator: {
        elementId: request.elementId,
        heading: request.relevantSection || request.sectionHeading,
        startOffset: match.startOffset,
        endOffset: match.endOffset,
        boundary: { startOffset: match.startOffset, endOffset: match.endOffset },
        sourceNode: `${match.tagName}#${request.elementId}`,
        tableStructure: match.tableStructure,
        sourceType: 'HTML'
      },
      exactBoundary: match.tableStructure !== 'AMBIGUOUS',
      heading: request.relevantSection || request.sectionHeading,
      substantive: match.substantive
    };
  }
  const heading = request.sectionHeading || request.relevantSection;
  if (heading) return extractHtmlHeadingSection(html, heading);
  const bodyMarkup = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html)?.[1] || html;
  const visibleMarkup = bodyMarkup
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|noscript|svg|template|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const substantiveText = cleanHtmlText(visibleMarkup);
  if (substantiveText.length < 55 || substantiveText.split(/\s+/).filter(Boolean).length < 10 || !hasSubstantiveHtmlContent(visibleMarkup)) return undefined;
  return {
    text: substantiveText,
    locator: { sourceType: 'HTML' },
    exactBoundary: false
  };
}

function extractSsoSection(html: string, request: OfficialDocumentExtractionRequest, actTitle: string): SelectedText | undefined {
  const legislation = request.legislation;
  if (!legislation) return undefined;
  const sectionMatch = /^\s*(?:section|sec\.?|s\.?)\s*(\d+[a-z]?)\s*(?:\((\d+[a-z]?)\))?\s*$/i.exec(legislation.section);
  if (!sectionMatch) return undefined;
  const sectionNumber = sectionMatch[1];
  const subsection = sectionMatch[2];
  const sectionLabel = `Section ${sectionNumber}${subsection ? `(${subsection})` : ''}`;

  const expectedIds = subsection
    ? [`pr${sectionNumber}-${subsection}`, `pr${sectionNumber}-${subsection}-`, `sec${sectionNumber}-${subsection}`, `sec${sectionNumber}-${subsection}-`, `pr${sectionNumber}_${subsection}`]
    : [`pr${sectionNumber}-`, `pr${sectionNumber}`, `sec${sectionNumber}`];
  const matches = scanHtmlElements(html).filter(element => (element.tagName === 'div' || element.tagName === 'p') &&
    !element.hidden && element.idValue !== undefined && expectedIds.includes(element.idValue));
  if (matches.length !== 1) return undefined;
  const container = matches[0];
  if (container.idAttributeCount !== 1 || container.hidden || container.malformed || container.endOffset === undefined) return undefined;
  const outerHtml = html.slice(container.startOffset, container.endOffset);

  // The legacy numeric subsection parser is safe only after the globally
  // unique, visible ID boundary has been established. Restrict it to that
  // actual node so comments or sibling containers cannot win its first match.
  if (subsection && /^\d+$/.test(sectionNumber) && /^\d+[a-z]?$/i.test(subsection)) {
    const extraction = extractSSOProvision(outerHtml, legislation.actCode, sectionLabel);
    if (extraction.extractionStatus === 'EXACT' && extraction.sourceLocator.section === sectionNumber &&
        extraction.sourceLocator.subsection?.toLowerCase() === subsection.toLowerCase() && extraction.text.length > 20) {
      const localStart = extraction.sourceLocator.startOffset ?? 0;
      const localEnd = extraction.sourceLocator.endOffset ?? outerHtml.length;
      return {
        text: extraction.text,
        locator: {
          ...extraction.sourceLocator,
          document: actTitle,
          act: legislation.actCode,
          section: sectionNumber,
          subsection,
          startOffset: container.startOffset + localStart,
          endOffset: container.startOffset + localEnd,
          boundary: { startOffset: container.startOffset + localStart, endOffset: container.startOffset + localEnd },
          sourceType: 'HTML',
          canonicalLocator: `${actTitle} > ${sectionLabel}`
        },
        exactBoundary: true,
        heading: sectionLabel
      };
    }
  }

  const visibleHtml = outerHtml.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|noscript|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const text = cleanHtmlText(visibleHtml);
  const tableStructure = assessHtmlTableStructure(visibleHtml);
  if (text.length < 20 || !hasSubstantiveHtmlContent(outerHtml)) return undefined;
  return {
    text,
    locator: {
      document: actTitle,
      act: legislation.actCode,
      section: sectionNumber,
      subsection,
      heading: sectionLabel,
      elementId: container.idValue,
      startOffset: container.startOffset,
      endOffset: container.endOffset,
      boundary: { startOffset: container.startOffset, endOffset: container.endOffset },
      sourceNode: `${container.tagName}#${container.idValue || `pr${sectionNumber}-${subsection || ''}`}`,
      tableStructure,
      sourceType: 'HTML',
      canonicalLocator: `${actTitle} > ${sectionLabel}`
    },
    exactBoundary: tableStructure !== 'AMBIGUOUS',
    heading: sectionLabel
  };
}

function selectPdfText(pdf: PdfTextExtraction, request: OfficialDocumentExtractionRequest): SelectedText | undefined {
  const requestedHeading = request.sectionHeading || request.relevantSection;
  if (!requestedHeading) {
    return {
      text: pdf.pageTexts.join('\n\n').trim(),
      locator: { sourceType: 'PDF', pageCount: pdf.pageCount, tableStructure: pdf.tableStructure },
      exactBoundary: !pdf.hasEmptyPageText && pdf.tableStructure !== 'AMBIGUOUS'
    };
  }
  const normalizedHeading = normalizeText(requestedHeading);
  const matches = pdf.lines.filter(line => normalizeText(line.text) === normalizedHeading);
  if (matches.length !== 1 || matches[0].cells.length !== 1) return undefined;
  const headingLine = matches[0];
  const headingIndex = pdf.lines.indexOf(headingLine);
  const nextHeading = pdf.lines.slice(headingIndex + 1).find(line =>
    line.cells.length === 1 && /^(?:section\s+)?\d+[a-z]?(?:[.)]|\s{1,2})\s*\S/i.test(line.text)
  );
  const selectedLines = pdf.lines.slice(headingIndex, nextHeading ? pdf.lines.indexOf(nextHeading) : undefined);
  const text = selectedLines.map(line => line.text).join('\n').trim();
  return text ? {
    text,
    locator: {
      sourceType: 'PDF',
      heading: headingLine.text,
      pageNumber: headingLine.pageNumber,
      pageCount: pdf.pageCount,
      tableStructure: pdf.tableStructure
    },
    exactBoundary: !pdf.hasEmptyPageText && pdf.tableStructure !== 'AMBIGUOUS',
    heading: headingLine.text,
    pageNumber: headingLine.pageNumber,
    substantive: selectedLines.slice(1).some(line => line.cells.some(cell => cell.trim().length > 0))
  } : undefined;
}

function parseSourceDate(value: string): string | undefined {
  const trimmed = value.trim();
  let year: string | undefined;
  let month: string | undefined;
  let day: string | undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) [year, month, day] = trimmed.split('-');
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
    const parts = trimmed.split('/');
    [day, month, year] = parts;
  } else {
    const textDate = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i.exec(trimmed);
    if (!textDate) return undefined;
    day = textDate[1];
    month = MONTH_NUMBER[textDate[2].toLowerCase()];
    year = textDate[3];
  }
  if (!year || !month || !day) return undefined;
  const normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : undefined;
}

function extractApplicabilityDates(sourceText: string): ApplicabilityDates {
  const cue = String.raw`(?:effective|applicable|in\s+force)\s+from|with\s+effect\s+from|comes?\s+into\s+force\s+on|takes\s+effect\s+on`;
  const cueMatches = [...sourceText.matchAll(new RegExp(String.raw`\b${cue}\b`, 'gi'))];
  const startMatches = [...sourceText.matchAll(new RegExp(String.raw`\b(?:${cue})\s+(${DATE_PATTERN})\b`, 'gi'))];
  if (cueMatches.length !== startMatches.length) return { invalid: true };

  const ranges: Array<{ validFrom: string; validTo: string }> = [];
  const standaloneStarts: string[] = [];
  for (const match of startMatches) {
    const validFrom = parseSourceDate(match[1]);
    if (!validFrom) return { invalid: true };
    const tail = sourceText.slice((match.index ?? 0) + match[0].length);
    const connector = /^\s+(?:to|until|through|up\s+to)\b/i.exec(tail);
    if (!connector) {
      standaloneStarts.push(validFrom);
      continue;
    }
    const endText = /^\s+(?:to|until|through|up\s+to)\s+([^.;,\n]+)/i.exec(tail)?.[1]?.trim();
    const endDateText = endText ? new RegExp(String.raw`^(${DATE_PATTERN})\b`, 'i').exec(endText)?.[1] : undefined;
    const validTo = endDateText ? parseSourceDate(endDateText) : undefined;
    if (!validTo || validFrom > validTo) return { invalid: true };
    ranges.push({ validFrom, validTo });
  }

  const distinctRanges = new Set(ranges.map(range => `${range.validFrom}/${range.validTo}`));
  const distinctStarts = new Set(standaloneStarts);
  if (distinctRanges.size > 1 || distinctStarts.size > 1 || (ranges.length > 0 && standaloneStarts.length > 0)) {
    return { invalid: true };
  }
  const range = ranges[0];
  if (range) return { effectiveDate: range.validFrom, ...range };
  const validFrom = standaloneStarts[0];
  return validFrom ? { effectiveDate: validFrom, validFrom } : {};
}

function hasSupportedHistoricalDate(sourceText: string, requestedDate: string, range: ApplicabilityDates): boolean {
  if (!range.validFrom || !range.validTo) return false;
  const requested = parseSourceDate(requestedDate);
  return Boolean(requested && requested >= range.validFrom && requested <= range.validTo && sourceText.length > 0);
}

function topicMatches(text: string, expectation: TopicContentExpectation): boolean {
  const normalized = normalizeText(text);
  const terms = [...new Set(expectation.topicTerms.map(normalizeText).filter(term => term.length > 2))];
  const matchedTerms = terms.filter(term => normalized.includes(term));
  return matchedTerms.length >= (expectation.minimumTopicTermMatches ?? 1);
}

function identityMatches(text: string, expectation: TopicContentExpectation): boolean {
  const normalized = normalizeText(text);
  return expectation.standardIdentifiers.some(identifier => {
    const target = normalizeText(identifier);
    return target.length > 0 && normalized.includes(target);
  });
}

function actualDocumentTitle(text: string, htmlTitle: string | undefined, expectedTitles: string[]): string | undefined {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const titleLine = lines.find(line => expectedTitles.some(title => normalizeText(line).includes(normalizeText(title))));
  return titleLine || (htmlTitle && matchesAnyText(text, expectedTitles) ? htmlTitle : undefined);
}

function htmlTitle(html: string): string | undefined {
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html)?.[1];
  const pageTitle = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];
  return cleanHtmlText(heading || pageTitle || '') || undefined;
}

function buildRecord(
  request: OfficialDocumentExtractionRequest,
  fetchedAt: string,
  finalUrl: string,
  publisher: PublisherInfo,
  documentTitle: string,
  sourceText: string,
  locator: SourceLocator,
  extractionStatus: 'EXACT' | 'PARTIAL',
  isVerbatimText: boolean,
  documentHash: string,
  contentType: string,
  pageCount?: number,
  topicIds: string[] = []
): AuthoritativeSourceRecord {
  const paragraphOrSection = request.legislation?.section || request.relevantSection || request.sectionHeading ||
    (pageCount ? `Whole document, ${pageCount} pages` : 'Whole document');
  const provisionHash = computeProvisionHash(request.standardOrActCode, paragraphOrSection, sourceText);
  const validDates = extractApplicabilityDates(sourceText);
  const version = `sha256:${documentHash}:${provisionHash}`;
  return {
    id: `LIVE_${request.authority}_${documentHash.slice(0, 12)}_${provisionHash.slice(0, 12)}`,
    authority: request.authority,
    authorityName: AUTHORITY_NAMES[request.authority] || request.authority,
    sourcePublisher: publisher.publisher,
    legalOrStandardInstrument: request.legislation?.actTitle || request.legalOrStandardInstrument,
    documentTitle,
    standardOrActCode: request.legislation?.actCode || request.standardOrActCode,
    paragraphOrSection,
    sourceText,
    principleSummary: '',
    ...(validDates.effectiveDate ? { effectiveDate: validDates.effectiveDate } : {}),
    ...(validDates.validFrom ? { validFrom: validDates.validFrom } : {}),
    ...(validDates.validTo ? { validTo: validDates.validTo } : {}),
    officialSourceUrl: finalUrl,
    canonicalSourceUrl: finalUrl,
    domain: request.domain,
    jurisdiction: 'Singapore',
    tags: [...new Set(request.expectedTopic.topicTerms.map(term => term.trim()).filter(Boolean))],
    sourceStatus: 'NEEDS_REVIEW',
    sourceType: request.legislation ? 'AUTHORITATIVE_SOURCE' : 'OFFICIAL_GUIDANCE',
    evidenceTier: request.legislation ? 'PRIMARY_SOURCE' : 'OFFICIAL_GUIDANCE',
    isVerbatimText,
    lifecycleState: 'CANDIDATE',
    version,
    documentHash,
    provisionHash,
    contentHash: provisionHash,
    extractionStatus,
    sourceLocator: {
      ...locator,
      documentHash,
      mediaType: contentType,
      ...(pageCount ? { pageCount } : {})
    },
    provenance: 'LIVE_EXTERNAL',
    recordRole: 'EVIDENCE',
    groundingEligible: false,
    sourceAuthority: publisher.sourceAuthority,
    retrievedAt: fetchedAt,
    relatedTopicIds: topicIds,
    verificationMethod: 'OFFICIAL_DOCUMENT_BODY_EXTRACTION_CANDIDATE'
  };
}

/** Fetches, validates and extracts a bounded official document into an unadmitted review candidate. */
export async function extractOfficialDocument(
  request: OfficialDocumentExtractionRequest,
  retriever: ControlledWebRetriever = defaultControlledWebRetriever,
  retrievedDocument?: ControlledFetchResult
): Promise<OfficialDocumentExtractionResult> {
  const invalidRequest = validateRequest(request);
  if (invalidRequest) return reject('INVALID_REQUEST', invalidRequest);

  const isSsoRequest = request.documentKind === 'SSO_LEGISLATION' || Boolean(request.legislation);
  let registeredAct: { actTitle: string; authorityName: string } | undefined;
  if (isSsoRequest) {
    registeredAct = supportedAct(request);
    if (!registeredAct) return reject('ACT_IDENTITY_MISMATCH', 'Act code, title, and governing authority do not match the approved statutory identity registry');
    let requestedUrl: URL;
    try { requestedUrl = new URL(request.url); } catch { return reject('INVALID_URL', 'The SSO document URL is invalid'); }
    if (requestedUrl.hostname.toLowerCase() !== 'sso.agc.gov.sg' ||
        requestedUrl.pathname.toLowerCase() !== `/act/${request.legislation?.actCode}`.toLowerCase()) {
      return reject('ACT_URL_MISMATCH', 'SSO URL must identify the exact registered Act code');
    }
    const expectedSection = request.legislation?.section.trim();
    if (!expectedSection || (request.relevantSection && normalizeText(request.relevantSection) !== normalizeText(expectedSection))) {
      return reject('SECTION_MISMATCH', 'SSO retrieval requires one exact requested section');
    }
    if (!request.expectedTopic.expectedTitles.some(title => normalizeText(title) === normalizeText(registeredAct?.actTitle || '')) ||
        !request.expectedTopic.standardIdentifiers.some(identifier => normalizeText(identifier) === normalizeText(request.legislation?.actCode || '') || normalizeText(identifier) === normalizeText(registeredAct?.actTitle || ''))) {
      return reject('ACT_EXPECTATION_MISMATCH', 'Topic expectations must bind to the registered Act title and code');
    }
  }

  const fetched = retrievedDocument || await retriever.fetchOfficialDocument(request.url, {
    timeoutMs: request.timeoutMs,
    maxResponseBytes: request.maxResponseBytes
  });
  if (fetched.status !== 'SUCCESS' || !fetched.contentBytes) {
    return reject(`FETCH_${fetched.status}`, fetched.error || 'Official document retrieval failed');
  }
  const requestedUrl = normalizedRequestUrl(request.url);
  const sourceUrl = normalizedRequestUrl(fetched.sourceUrl);
  if (!requestedUrl || !sourceUrl) return reject('SOURCE_URL_MISMATCH', 'Fetched source URL does not correspond to the requested official URL');
  for (const [label, url] of [['requested', request.url], ['source', fetched.sourceUrl], ['final', fetched.finalUrl || fetched.sourceUrl]] as const) {
    const security = defaultExternalSourceValidator.validateUrlSecurity(url);
    if (!security.isValid) return reject('URL_SECURITY_REJECTED', `The ${label} document URL failed security validation: ${security.reason || 'invalid URL'}`);
  }
  if (!Number.isInteger(fetched.httpStatus) || (fetched.httpStatus || 0) < 200 || (fetched.httpStatus || 0) >= 300) {
    return reject('HTTP_STATUS_REJECTED', 'Retrieved document does not have a successful HTTP status');
  }
  const responseMime = fetched.contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (!responseMime || !['application/pdf', 'text/html', 'application/xhtml+xml', 'text/plain'].includes(responseMime)) {
    return reject('UNSUPPORTED_CONTENT_TYPE', 'Retrieved document has an unsupported or missing content type');
  }
  if (fetched.contentBytes.byteLength === 0 || fetched.contentBytes.byteLength > (request.maxResponseBytes ?? MAX_OFFICIAL_DOCUMENT_BYTES)) {
    return reject('INVALID_DOCUMENT_SIZE', 'Retrieved document bytes are empty or exceed the configured response limit');
  }
  const finalUrl = fetched.finalUrl || fetched.sourceUrl;
  let parsedFinalUrl: URL;
  try { parsedFinalUrl = new URL(finalUrl); } catch { return reject('INVALID_FINAL_URL', 'The final source URL is invalid'); }
  const finalHost = parsedFinalUrl.hostname.toLowerCase();
  if (finalHost === 'sso.agc.gov.sg' && !isSsoRequest) {
    return reject('SSO_LEGISLATION_REQUIRED', 'Singapore Statutes Online documents require an exact registered Act and section request');
  }
  if (isSsoRequest && (finalHost !== 'sso.agc.gov.sg' ||
      parsedFinalUrl.pathname.toLowerCase() !== `/act/${request.legislation?.actCode}`.toLowerCase())) {
    return reject('ACT_URL_MISMATCH', 'The final SSO URL must retain the exact requested Act code and path');
  }
  if (requestedUrl !== sourceUrl) return reject('SOURCE_URL_MISMATCH', 'Fetched source URL does not correspond to the requested official URL');
  const publisher = resolvePublisher(finalUrl, request.authority);
  if (!publisher) return reject('PUBLISHER_MISMATCH', 'Final source host is not a recognized publisher for the requested authority');
  const bytes = fetched.contentBytes;
  const documentHash = computeSha256Bytes(bytes);
  const responseType = fetched.contentType;
  // The final URL and MIME type are derived by the controlled fetch result; use
  // the response bytes' signature as an independent PDF format check.
  const looksLikePdf = bytes.byteLength >= 5 && new TextDecoder('ascii').decode(bytes.subarray(0, 5)) === '%PDF-';
  const mimeIsPdf = responseType?.split(';', 1)[0]?.trim().toLowerCase() === 'application/pdf';
  if (mimeIsPdf !== looksLikePdf) return reject('DOCUMENT_FORMAT_MISMATCH', 'PDF content type and actual document signature do not agree');
  const detectedKind = looksLikePdf ? 'PDF' : responseType?.toLowerCase().includes('text/plain') ? 'TEXT' : 'HTML';
  if (request.documentKind && request.documentKind !== 'AUTO' && request.documentKind !== 'SSO_LEGISLATION' && request.documentKind !== detectedKind) {
    return reject('DOCUMENT_KIND_MISMATCH', `Expected ${request.documentKind}, received ${detectedKind}`);
  }

  let sourceText = '';
  let documentTitle = '';
  let locator: SourceLocator = {};
  let extractionStatus: 'EXACT' | 'PARTIAL' = 'PARTIAL';
  let isVerbatimText = false;
  let pageCount: number | undefined;
  let textForIdentity = '';
  let documentBodyText = '';

  if (detectedKind === 'PDF') {
    let pdf: PdfTextExtraction;
    try { pdf = await extractPdfDocumentText(bytes); }
    catch (error) {
      return reject('PDF_EXTRACTION_FAILED', error instanceof PdfDocumentExtractionError ? error.message : 'PDF extraction failed');
    }
    const selected = selectPdfText(pdf, request);
    if (!selected) return reject('SECTION_BOUNDARY_UNVERIFIED', 'Requested PDF section was absent, duplicated, or lacked a verifiable end boundary');
    sourceText = selected.text;
    locator = selected.locator;
    textForIdentity = pdf.pageTexts.join('\n');
    documentBodyText = textForIdentity;
    documentTitle = actualDocumentTitle(pdf.pageTexts[0] || '', undefined, request.expectedTopic.expectedTitles) || '';
    pageCount = pdf.pageCount;
    extractionStatus = selected.exactBoundary ? 'EXACT' : 'PARTIAL';
    isVerbatimText = extractionStatus === 'EXACT';
    if (pdf.tableStructure === 'AMBIGUOUS' || pdf.hasEmptyPageText) {
      extractionStatus = 'PARTIAL';
      isVerbatimText = false;
    }
    locator = { ...locator, pageCount, tableStructure: pdf.tableStructure, documentHash };
  } else {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return reject('INVALID_TEXT_ENCODING', 'Official HTML or text body is not valid UTF-8'); }
    if (detectedKind === 'HTML') {
      const validation = defaultExternalSourceValidator.validateTopicContent(text, request.expectedTopic);
      const bodyMarkup = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(text)?.[1] || text;
      documentBodyText = cleanHtmlText(bodyMarkup.replace(/<(script|style|noscript|svg|template|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' '));
      textForIdentity = validation.substantiveText || documentBodyText;
      const visibleTitle = htmlTitle(text);
      documentTitle = actualDocumentTitle(documentBodyText, visibleTitle, request.expectedTopic.expectedTitles) || '';
      const selected = isSsoRequest
        ? extractSsoSection(text, request, registeredAct?.actTitle || '')
        : selectHtmlText(text, request);
      if (!selected) return reject('HTML_SECTION_UNVERIFIED', 'Requested HTML section was absent, duplicated, or lacked an exact structural boundary');
      sourceText = selected.text;
      locator = { ...selected.locator };
      if (selected.substantive === false) return reject('HTML_SECTION_NOT_SUBSTANTIVE', 'The selected HTML boundary contains only headings, navigation, or non-substantive content');
      extractionStatus = selected.exactBoundary ? 'EXACT' : 'PARTIAL';
      isVerbatimText = extractionStatus === 'EXACT';
      if (isSsoRequest) {
        if (!matchesAnyText(documentBodyText, [registeredAct?.actTitle || '']) ||
            !matchesAnyText(documentTitle, [registeredAct?.actTitle || '']) ||
            !topicMatches(sourceText, request.expectedTopic)) {
          return reject('SSO_BODY_IDENTITY_MISMATCH', 'SSO body title, Act identity, or requested section topic did not verify');
        }
      }
    } else {
      const lines = text.split(/\r?\n/);
      const titleIndex = lines.findIndex(line => line.trim().length > 0);
      documentTitle = titleIndex >= 0 ? lines[titleIndex].trim() : '';
      textForIdentity = text.trim();
      documentBodyText = textForIdentity;
      if (request.elementId || request.sectionHeading || request.relevantSection) {
        return reject('TEXT_SECTION_UNSUPPORTED', 'Plain-text source has no structural locator for the requested section');
      }
      sourceText = textForIdentity;
      locator = { sourceType: 'TEXT' };
      extractionStatus = 'PARTIAL';
      isVerbatimText = false;
    }
  }

  if (!documentTitle || !matchesAnyText(documentTitle, request.expectedTopic.expectedTitles)) {
    return reject('DOCUMENT_TITLE_MISMATCH', 'Extracted document title does not match the expected title');
  }
  const identityInBody = isSsoRequest
    ? matchesAnyText(documentBodyText, [registeredAct?.actTitle || ''])
    : identityMatches(documentBodyText, request.expectedTopic);
  if (!identityInBody || !topicMatches(textForIdentity, request.expectedTopic) || !topicMatches(sourceText, request.expectedTopic)) {
    return reject('DOCUMENT_BODY_TOPIC_MISMATCH', 'Actual document body and selected passage do not independently support the requested identity and topic');
  }
  if (sourceText.trim().length < 20) return reject('EMPTY_EXTRACT', 'The selected source passage is empty or too short');

  const dates = extractApplicabilityDates(sourceText);
  const hasHistoricalMarker = /\b(?:superseded|repealed|revoked|rescinded|expired)\b/i.test(sourceText);
  if (dates.invalid) return reject('APPLICABILITY_DATES_CONTRADICTORY', 'The passage contains malformed or contradictory explicit applicability dates');
  if (request.asOfDate && !hasSupportedHistoricalDate(sourceText, request.asOfDate, dates)) {
    return reject('HISTORICAL_DATE_UNVERIFIED', 'The source text does not establish a bounded effective interval containing the requested date');
  }
  if (hasHistoricalMarker && (!dates.validFrom || !dates.validTo)) {
    return reject('SUPERSEDED_SOURCE_UNBOUNDED', 'The passage describes superseded or repealed information without a bounded applicability interval');
  }

  const record = buildRecord(
    request,
    fetched.retrievedAt,
    finalUrl,
    publisher,
    documentTitle,
    sourceText,
    { ...locator, sourceType: detectedKind === 'TEXT' ? 'TEXT' : detectedKind },
    extractionStatus,
    isVerbatimText,
    documentHash,
    responseType || (detectedKind === 'PDF' ? 'application/pdf' : detectedKind === 'TEXT' ? 'text/plain' : 'text/html'),
    pageCount,
    request.topicIds || []
  );
  return { status: 'SUCCESS', record };
}

function normalizedRequestUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch { return undefined; }
}

/** Extracts a previously retrieved bounded document without repeating network I/O. */
export async function extractOfficialDocumentFromRetrieved(
  request: OfficialDocumentExtractionRequest,
  retrievedDocument: ControlledFetchResult
): Promise<OfficialDocumentExtractionResult> {
  return extractOfficialDocument(request, defaultControlledWebRetriever, retrievedDocument);
}
