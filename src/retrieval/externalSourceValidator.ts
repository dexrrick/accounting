import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import {
  ACRA_2022_ANNUAL_RETURN_TIMELINES_URL,
  supportsAcraAnnualReturnDeadlineTable
} from './acraAnnualReturnFilingRule';
import {
  isBoundedStatutoryAdvisoryRequest,
  supportBoundedStatutoryAdvisory,
  type BoundedStatutoryAdvisoryRequest
} from './statutoryAdvisorySupport';
import { cleanHtmlText, cleanHtmlTextPreservingTableCells } from './sourceAdapters';
import {
  isAcraAuditExemptionContextRequest,
  type AcraAuditExemptionContextRequest
} from './acraMomKnowledge20261027b';

/**
 * Strict allowlist of authorized Singapore statutory authorities and verified reference APIs.
 */
export const ALLOWED_REGULATORY_HOSTNAMES = new Set([
  'sso.agc.gov.sg',
  'iras.gov.sg',
  'www.iras.gov.sg',
  'acra.gov.sg',
  'www.acra.gov.sg',
  'mom.gov.sg',
  'www.mom.gov.sg',
  'cpf.gov.sg',
  'www.cpf.gov.sg',
  'mas.gov.sg',
  'www.mas.gov.sg',
  // Ask.gov.sg publishes first-party FAQs for MAS, IRAS, CPF and other
  // Singapore agencies. It is guidance, not a substitute for legislation.
  'ask.gov.sg',
  'ifrs.org',
  'www.ifrs.org',
  'asc.acra.gov.sg'
]);

export const ALLOWED_REFERENCE_HOSTNAMES = new Set([
  'api.frankfurter.dev'
]);

export const ALL_ALLOWED_HOSTNAMES = new Set([
  ...ALLOWED_REGULATORY_HOSTNAMES,
  ...ALLOWED_REFERENCE_HOSTNAMES
]);

export type ExternalValidationErrorCode =
  | 'INVALID_URL'
  | 'INSECURE_PROTOCOL'
  | 'NON_STANDARD_PORT'
  | 'CREDENTIALS_DISALLOWED'
  | 'UNAUTHORIZED_DOMAIN_ACCESS'
  | 'REDIRECT_REJECTED'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'MALFORMED_DOCUMENT_STRUCTURE'
  | 'CANONICAL_URL_MISMATCH'
  | 'PROVENANCE_MISMATCH'
  | 'INVALID_VERBATIM_CLAIM'
  | 'PROVISION_MAPPING_MISMATCH'
  | 'EXTRACTION_FAILED'
  | 'PARTIAL_PROVISION';

export interface ExternalValidationResult {
  isValid: boolean;
  errorCode?: ExternalValidationErrorCode;
  reason?: string;
}

export interface TopicContentExpectation {
  /** Isomer government banners may contain an article before the page's main. */
  preferMainContent?: boolean;
  standardIdentifiers: string[];
  expectedTitles: string[];
  topicTerms: string[];
  minimumTopicTermMatches?: number;
  /** Allows strict all-token source wording equivalence for IRAS topic validation only. */
  allowIrasTopicTokenEquivalence?: boolean;
  /** Requires topic evidence in substantive paragraphs, list items, or table cells, excluding page metadata. */
  requireSubstantiveBody?: boolean;
  /** Preserves and requires one complete, qualified ACRA annual-return deadline table. */
  requireAcraAnnualReturnDeadlineTable?: boolean;
  /** Enables one native CPF wage-definition card only for the exact bounded request. */
  cpfOrdinaryWageDefinitionRequest?: BoundedStatutoryAdvisoryRequest;
  /** Enables the native Additional Wages definition card only for its bounded request. */
  cpfAdditionalWageDefinitionRequest?: BoundedStatutoryAdvisoryRequest;
  /** Preserves the one registered ACRA audit-exemption conditional heading for its bounded request. */
  acraAuditExemptionContextRequest?: AcraAuditExemptionContextRequest;
}

export interface TopicContentValidationResult extends ExternalValidationResult {
  pageTitle?: string;
  substantiveText?: string;
}

/** Flatten balanced HTML list items into visible, individually marked blocks. */
function preserveListItemBoundaries(markup: string): string {
  // These are the same elements that cleanHtmlText turns into paragraph
  // boundaries. Consume them here so an item's marker stays attached to its
  // text even when the source nests headings, sections, or table rows inside
  // the list item. Table cells are consumed too: cleanHtmlText otherwise adds
  // an inline separator which can split formatting around the item marker.
  const structuralTag = /<\/?(?:ul|ol|li|h[1-6]|p|div|section|tr|table|td|th)\b[^>]*>/gi;
  const containers: string[] = [];
  const itemContainerDepths: number[] = [];
  let output = '';
  let cursor = 0;
  let malformed = false;
  const markerForCurrentItem = () => {
    const depth = itemContainerDepths.length;
    return depth === 1 ? '• ' : depth === 2 ? '◦ ' : '▪ ';
  };

  for (const match of markup.matchAll(structuralTag)) {
    const tag = match[0];
    const tagName = tag.match(/^<\/?(ul|ol|li|h[1-6]|p|div|section|tr|table|td|th)\b/i)?.[1]?.toLowerCase();
    if (!tagName) continue;
    const closing = /^<\//.test(tag);
    const index = match.index ?? 0;
    output += markup.slice(cursor, index);

    if (tagName === 'ul' || tagName === 'ol') {
      if (closing) {
        if (itemContainerDepths.some(depth => depth >= containers.length)) malformed = true;
        if (containers.pop() !== tagName) malformed = true;
        output += tag;
        if (itemContainerDepths.length > 0) output += `<p>${markerForCurrentItem()}`;
      } else {
        containers.push(tagName);
        output += tag;
      }
    } else if (tagName === 'li') {
      if (closing) {
        if (itemContainerDepths.length === 0 || itemContainerDepths[itemContainerDepths.length - 1] !== containers.length) malformed = true;
        else itemContainerDepths.pop();
        output += '</p>';
      } else {
        if (containers.length === 0 || (itemContainerDepths.length > 0 && containers.length <= itemContainerDepths[itemContainerDepths.length - 1])) malformed = true;
        itemContainerDepths.push(containers.length);
        output += `<p>${markerForCurrentItem()}`;
      }
    } else if (itemContainerDepths.length > 0) {
      // Keep the same block and cell boundaries as cleanHtmlText. Prefix each
      // resulting text block with its active list depth so none of the blocks
      // can escape a colon-ended list skip as an unmarked paragraph.
      output += tag;
      if (!closing || !['td', 'th'].includes(tagName)) output += markerForCurrentItem();
    } else {
      output += tag;
    }
    cursor = index + tag.length;
  }
  output += markup.slice(cursor);

  // Malformed list nesting makes item boundaries unknowable. Fail closed at
  // page validation rather than allowing unmarked child text into evidence.
  if (malformed || containers.length > 0 || itemContainerDepths.length > 0) return '';
  return output;
}

/** Isomer semantic navigation may use nested divs instead of a nav element. */
function removeCorporateNavigationMarkup(document: string): string {
  let output = document;
  const containers = /<(div|section)\b([^>]*)>/gi;
  for (const match of [...document.matchAll(containers)].reverse()) {
    const attributes = match[2];
    if (!/\b(?:aria-label\s*=\s*["'](?:Breadcrumb|Table of Contents)["']|role\s*=\s*["']navigation["'])/i.test(attributes)) continue;
    const tag = match[1];
    const boundaries = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
    boundaries.lastIndex = match.index! + match[0].length;
    let depth = 1;
    let end = document.length;
    for (let boundary = boundaries.exec(document); boundary; boundary = boundaries.exec(document)) {
      depth += boundary[0].startsWith('</') ? -1 : /\/>$/.test(boundary[0]) ? 0 : 1;
      if (depth === 0) { end = boundaries.lastIndex; break; }
    }
    output = output.slice(0, match.index) + ' '.repeat(end - match.index!) + output.slice(end);
  }
  // Unlabelled breadcrumbs contain short anchor/span labels (and icons), with
  // no prose outside them. Do not remove ordered statutory instructions.
  return output.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol\s*>/gi, (list, contents: string) => {
    if (/<ol\b/i.test(contents) || !/<a\b/i.test(contents)) return list;
    const items = [...contents.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)];
    if (items.length === 0) return list;
    const labelsOnly = items.every(item => {
      const text = cleanHtmlText(item[1].replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, ' '));
      if (text.split(/\s+/).length > 16 || /\b(?:must|shall|file|submit|prepare|ensure|comply|need to)\b/i.test(text)) return false;
      const residual = item[1].replace(/<(a|span|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
      return cleanHtmlText(residual).trim().length === 0;
    });
    return labelsOnly ? ' ' : list;
  });
}

const RULE_METADATA_CONTAINER_MARKER = /\b(?:cards?|tiles?|teasers?|quick[-_ ]?links?|related[-_ ]?(?:content|links?)|popular[-_ ]?(?:content|links?)|featured[-_ ]?(?:content|links?)|link[-_ ]?list|page[-_ ]?index)\b/i;

function simpleTableCellText(cellHtml: string): string {
  return cleanHtmlText(cellHtml
    .replace(/<li\b[^>]*>/gi, ' ')
    .replace(/<\/li\s*>/gi, '; ')
    .replace(/<\/?(?:ul|ol)\b[^>]*>/gi, ' '))
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s+/g, ' ')
    .replace(/;$/, '')
    .trim();
}

function tableSpanAttributesAreSimple(attributes: string): boolean {
  for (const name of ['colspan', 'rowspan']) {
    const attributePattern = new RegExp(`(?:^|\\s)${name}(?=\\s|=|$)`, 'gi');
    const matches = [...attributes.matchAll(attributePattern)];
    if (matches.length === 0) continue;
    if (matches.length !== 1) return false;
    const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    if (!match || (match[1] ?? match[2] ?? match[3]) !== '1') return false;
  }
  return true;
}

function simpleTableMarkupIsBalanced(rawTable: string): boolean {
  const allowedTags = new Set([
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'p', 'ul', 'ol', 'li',
    'b', 'strong', 'i', 'em', 'u', 'sub', 'sup', 'a', 'span', 'br'
  ]);
  const stack: string[] = [];
  for (const match of rawTable.matchAll(/<\/?([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const token = match[0];
    const closing = token.startsWith('</');
    const tagName = match[1].toLowerCase();
    if (!allowedTags.has(tagName) || !tableSpanAttributesAreSimple(match[2])) return false;
    if (tagName === 'br') {
      if (closing) return false;
      continue;
    }
    if (closing) {
      if (stack.pop() !== tagName) return false;
    } else if (!/\/\s*>$/.test(token)) {
      stack.push(tagName);
    }
  }
  return stack.length === 0;
}

function parseSimpleAcraDeadlineTable(rawTable: string): string | undefined {
  const tableOpen = /^<table\b([^>]*)>/i.exec(rawTable);
  const tableClose = /<\/table\s*>$/i.exec(rawTable);
  if (!tableOpen || !tableClose || !simpleTableMarkupIsBalanced(rawTable)) return undefined;
  const inner = rawTable.slice(tableOpen[0].length, tableClose.index);
  if (/<table\b/i.test(inner)) return undefined;

  const rows = [...inner.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr\s*>/gi)];
  if (rows.length !== 5 || !tableSpanAttributesAreSimple(tableOpen[1])) return undefined;
  const withoutRows = inner.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, ' ')
    .replace(/<\/?(?:thead|tbody)\b[^>]*>/gi, ' ');
  if (cleanHtmlText(withoutRows).trim()) return undefined;

  const textRows: string[][] = [];
  for (const [rowIndex, row] of rows.entries()) {
    if (!tableSpanAttributesAreSimple(row[1])) return undefined;
    const rowHtml = row[2];
    const cells = [...rowHtml.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)];
    if (cells.length !== 2 || cells.some(cell => !tableSpanAttributesAreSimple(cell[2]) ||
        /<(?:table|tr|td|th)\b/i.test(cell[3]))) return undefined;
    const residual = rowHtml.replace(/<(th|td)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
    if (cleanHtmlText(residual).trim()) return undefined;
    const expectedCellTag = rowIndex === 0 ? 'th' : 'td';
    if (cells.some(cell => cell[1].toLowerCase() !== expectedCellTag)) return undefined;
    const textCells = cells.map(cell => simpleTableCellText(cell[3]));
    if (textCells.some(cell => !cell)) return undefined;
    textRows.push(textCells);
  }

  const text = textRows.map(row => row.join(' | ')).join('\n');
  return supportsAcraAnnualReturnDeadlineTable(text) ? text : undefined;
}

function findSimpleAcraDeadlineTable(markup: string): { rawHtml: string[]; text: string } | undefined {
  const tables = [...markup.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)];
  const matching: Array<{ rawHtml: string; text: string }> = [];
  for (const table of tables) {
    const firstRow = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/i.exec(table[0])?.[1];
    if (!firstRow) continue;
    const headerCells = [...firstRow.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)].map(cell => simpleTableCellText(cell[1]));
    const isDeadlineHeader = headerCells.length === 2 &&
      normalizeVisibleText(headerCells[0]) === 'company type' && normalizeVisibleText(headerCells[1]) === 'filing deadline';
    if (!isDeadlineHeader) continue;
    const text = parseSimpleAcraDeadlineTable(table[0]);
    if (!text) return undefined;
    matching.push({ rawHtml: table[0], text });
  }
  if (matching.length === 0 || matching.some(table => table.text !== matching[0].text)) return undefined;
  return { rawHtml: matching.map(table => table.rawHtml), text: matching[0].text };
}

function hasAcraDeadlineTableHeader(markup: string): boolean {
  return [...markup.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)].some(table => {
    const firstRow = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/i.exec(table[0])?.[1];
    if (!firstRow) return false;
    const headerCells = [...firstRow.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)]
      .map(cell => simpleTableCellText(cell[1]));
    return headerCells.length === 2 && normalizeVisibleText(headerCells[0]) === 'company type' &&
      normalizeVisibleText(headerCells[1]) === 'filing deadline';
  });
}

function hasRuleMetadataClassOrId(attributes: string): boolean {
  return [...attributes.matchAll(/(?:^|\s)(?:class|id)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .some(match => RULE_METADATA_CONTAINER_MARKER.test(match[1] || match[2] || match[3] || ''));
}

/** Remove card and link-list containers without relying on a single non-greedy closing-tag match. */
function removeRuleMetadataContainers(markup: string): string {
  const containerTags = /<(\/)?(div|section|ul|ol|li|article)\b([^>]*)>/gi;
  const stack: Array<{ tagName: string; start: number; excluded: boolean }> = [];
  const excludedRanges: Array<{ start: number; end: number }> = [];

  for (const match of markup.matchAll(containerTags)) {
    const tagName = match[2].toLowerCase();
    const closing = Boolean(match[1]);
    const start = match.index ?? 0;
    if (closing) {
      let openIndex = stack.length - 1;
      while (openIndex >= 0 && stack[openIndex].tagName !== tagName) openIndex -= 1;
      if (openIndex < 0) continue;
      const [opening] = stack.splice(openIndex, 1);
      if (opening.excluded) excludedRanges.push({ start: opening.start, end: start + match[0].length });
      continue;
    }

    const excluded = stack.some(parent => parent.excluded) || hasRuleMetadataClassOrId(match[3]);
    if (/\/\s*>$/.test(match[0])) {
      if (excluded) excludedRanges.push({ start, end: start + match[0].length });
    } else {
      stack.push({ tagName, start, excluded });
    }
  }

  for (const opening of stack) {
    if (opening.excluded) excludedRanges.push({ start: opening.start, end: markup.length });
  }

  if (excludedRanges.length === 0) return markup;
  excludedRanges.sort((left, right) => left.start - right.start);
  let output = '';
  let cursor = 0;
  for (const range of excludedRanges) {
    if (range.start < cursor) {
      cursor = Math.max(cursor, range.end);
      continue;
    }
    output += markup.slice(cursor, range.start);
    cursor = range.end;
  }
  return output + markup.slice(cursor);
}

/** Links that wrap block content act as cards, not inline legal references. */
function removeBlockWrappingLinks(markup: string): string {
  return markup.replace(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi, (link, inner: string) =>
    /<(?:h[1-6]|p|div|section|article|ul|ol|li|table|thead|tbody|tfoot|tr|td|th)\b/i.test(inner) ? ' ' : link);
}

/** A link-only label is metadata; inline links stay when they are part of prose. */
function removeLinkOnlyRuleBlocks(markup: string): string {
  return markup.replace(/<(p|li|td|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (block, _tagName: string, inner: string) => {
    const visibleText = cleanHtmlText(inner);
    if (!visibleText) return block;
    const unlinkedText = cleanHtmlText(inner.replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, ' '));
    return /[\p{L}\p{N}]/u.test(unlinkedText) ? block : block.replace(inner, '');
  });
}

/** Keep text only from rule-bearing paragraphs, list items, and table cells. */
function extractRuleBearingMarkup(markup: string): string {
  const tagPattern = /<(\/)?([a-z][\w:-]*)\b[^>]*>/gi;
  const ruleBlocks = new Set(['p', 'li', 'td', 'th']);
  const listContainers = new Set(['ul', 'ol']);
  const tableContainers = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr']);
  let output = '';
  let cursor = 0;
  let ruleBlockDepth = 0;
  let listContainerDepth = 0;
  let tableDepth = 0;

  for (const match of markup.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    if (ruleBlockDepth > 0) output += markup.slice(cursor, index);
    const tagName = match[2].toLowerCase();
    const closing = Boolean(match[1]);

    if (ruleBlocks.has(tagName)) {
      if (!closing) ruleBlockDepth += 1;
      if (ruleBlockDepth > 0) output += match[0];
      if (closing) ruleBlockDepth = Math.max(0, ruleBlockDepth - 1);
    } else if (listContainers.has(tagName)) {
      if (!closing) listContainerDepth += 1;
      if (ruleBlockDepth > 0 || listContainerDepth > 0) output += match[0];
      if (closing) listContainerDepth = Math.max(0, listContainerDepth - 1);
    } else if (tableContainers.has(tagName)) {
      if (tagName === 'table' && !closing) tableDepth += 1;
      if (ruleBlockDepth > 0 || tableDepth > 0) output += match[0];
      if (tagName === 'table' && closing) tableDepth = Math.max(0, tableDepth - 1);
    } else if (ruleBlockDepth > 0) {
      output += match[0];
    }
    cursor = index + match[0].length;
  }
  if (ruleBlockDepth > 0) output += markup.slice(cursor);
  return output;
}

interface BalancedMarkupElement {
  tagName: string;
  attributes: string;
  start: number;
  contentStart: number;
  contentEnd?: number;
  end?: number;
  parent?: BalancedMarkupElement;
}

const HTML_VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Fail closed when malformed nesting makes a native rule-card boundary uncertain. */
function parseBalancedMarkupElements(markup: string, allowOpenAncestors = false): BalancedMarkupElement[] | undefined {
  const elements: BalancedMarkupElement[] = [];
  const stack: BalancedMarkupElement[] = [];
  const tagPattern = /<(\/)?([a-z][\w:-]*)\b([^>]*)>/gi;

  for (const match of markup.matchAll(tagPattern)) {
    const tagName = match[2].toLowerCase();
    const start = match.index ?? 0;
    if (match[1]) {
      const opening = stack.pop();
      if (!opening || opening.tagName !== tagName) return undefined;
      opening.contentEnd = start;
      opening.end = start + match[0].length;
      continue;
    }

    const element: BalancedMarkupElement = {
      tagName,
      attributes: match[3],
      start,
      contentStart: start + match[0].length,
      parent: stack.at(-1)
    };
    elements.push(element);
    if (HTML_VOID_TAGS.has(tagName) || /\/\s*>$/.test(match[0])) {
      element.contentEnd = element.contentStart;
      element.end = element.contentStart;
    } else {
      stack.push(element);
    }
  }

  return stack.length === 0 || allowOpenAncestors ? elements : undefined;
}

function findBalancedDivContainerEnd(markup: string, start: number): number | undefined {
  const tagPattern = /<(\/)?div\b[^>]*>/gi;
  tagPattern.lastIndex = start;
  let depth = 0;
  for (const match of markup.matchAll(tagPattern)) {
    if (match[1]) {
      depth -= 1;
      if (depth === 0) return (match.index ?? 0) + match[0].length;
      if (depth < 0) return undefined;
    } else if (!/\/\s*>$/.test(match[0])) {
      depth += 1;
    }
  }
  return undefined;
}

function markupAttribute(attributes: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function hasMarkupClass(element: BalancedMarkupElement, className: string): boolean {
  return markupAttribute(element.attributes, 'class').split(/\s+/).includes(className);
}

function isHiddenMarkupElement(element: BalancedMarkupElement): boolean {
  return isHiddenMarkupAttributes(element.attributes);
}

function removeHiddenAcraAuditMarkup(
  markup: string,
  request: AcraAuditExemptionContextRequest
): string | undefined {
  if (!isAcraAuditExemptionContextRequest(request)) return markup;
  const elements = parseBalancedMarkupElements(markup);
  if (!elements) return undefined;
  const hiddenSubtrees = elements.filter(isHiddenMarkupElement).filter(element => {
    for (let parent = element.parent; parent; parent = parent.parent) {
      if (isHiddenMarkupElement(parent)) return false;
    }
    return true;
  });
  if (hiddenSubtrees.some(element => element.end === undefined)) return undefined;
  const filteredMarkup = hiddenSubtrees.sort((left, right) => right.start - left.start).reduce((currentMarkup, element) => {
    const end = element.end;
    return end === undefined ? currentMarkup : currentMarkup.slice(0, element.start) + currentMarkup.slice(end);
  }, markup);
  return filteredMarkup;
}

function isHiddenMarkupAttributes(attributes: string): boolean {
  return /(?:^|\s)hidden(?:\s|=|\/|$)/i.test(attributes)
    || /(?:^|\s)aria-hidden\s*=\s*(?:"true"|'true'|true)(?:\s|$)/i.test(attributes)
    || /\bdisplay\s*:\s*none\b|\bvisibility\s*:\s*hidden\b/i.test(markupAttribute(attributes, 'style'))
    || /\b(?:sr-only|visually-hidden|d-none)\b/i.test(markupAttribute(attributes, 'class'));
}

function isInsideElement(element: BalancedMarkupElement, ancestor: BalancedMarkupElement): boolean {
  for (let current = element.parent; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

/**
 * Restores only the official CPF page's visible native action-card description,
 * and only when its complete criteria satisfy the bounded request. The source
 * card is replaced in place so body order and the source wording stay intact.
 */
function preserveSupportedCpfWageCard(
  mainMarkup: string,
  request: BoundedStatutoryAdvisoryRequest
): string {
  if (!isBoundedStatutoryAdvisoryRequest(request)) return mainMarkup;
  const markupWithoutComments = mainMarkup.replace(/<!--[\s\S]*?-->/g, ' ');
  // Parse only a bounded native card and its enclosing path. This keeps the
  // extraction scoped to the real action-card description and avoids relying
  // on unrelated CMS wrappers elsewhere in main.
  const actionCardPattern = /<div\b([^>]*)>/gi;
  let inspectedCards = 0;
  for (const match of markupWithoutComments.matchAll(actionCardPattern)) {
    const cardStart = match.index ?? 0;
    const attributes = match[1];
    const classes = markupAttribute(attributes, 'class').split(/\s+/);
    if (!classes.includes('action-card') || !classes.includes('carousel')) continue;
    inspectedCards += 1;
    if (inspectedCards > 32) break;

    const cardEnd = findBalancedDivContainerEnd(markupWithoutComments, cardStart);
    if (!cardEnd) continue;
    const cardMarkup = markupWithoutComments.slice(cardStart, cardEnd);
    const cardElements = parseBalancedMarkupElements(cardMarkup);
    const actionCard = cardElements?.find(element => element.start === 0 && element.tagName === 'div');
    if (!cardElements || !actionCard) continue;

    const prefixElements = parseBalancedMarkupElements(markupWithoutComments.slice(0, cardStart), true);
    const openAncestors = prefixElements?.filter(element => element.end === undefined) || [];
    if (!prefixElements || openAncestors.some(ancestor => {
      const identity = markupAttribute(ancestor.attributes, 'class') + ' ' + markupAttribute(ancestor.attributes, 'id');
      return !['div', 'section', 'article'].includes(ancestor.tagName) || isHiddenMarkupElement(ancestor) ||
        RULE_METADATA_CONTAINER_MARKER.test(identity) ||
        /\b(?:navigation|navbar|breadcrumb|menu|sidebar|quick[-_ ]?link|related|page[-_ ]?index)\b/i.test(identity);
    })) continue;

    const description = cardElements.find(element => element.tagName === 'div' && hasMarkupClass(element, 'cmp-teaser__description'));
    const content = description?.parent;
    const teaser = content?.parent;
    const actionTeaser = teaser?.parent;
    if (!description || !content || !teaser || !actionTeaser ||
        content.tagName !== 'div' || !hasMarkupClass(content, 'cmp-teaser__content') ||
        teaser.tagName !== 'div' || !hasMarkupClass(teaser, 'cmp-teaser') ||
        actionTeaser.tagName !== 'div' || !hasMarkupClass(actionTeaser, 'teaser') || !hasMarkupClass(actionTeaser, 'cmp-action-card') ||
        actionTeaser.parent !== actionCard) continue;

    const cardAncestors: BalancedMarkupElement[] = [];
    for (let current: BalancedMarkupElement | undefined = description; current; current = current.parent) {
      cardAncestors.push(current);
      if (current === actionCard) break;
    }
    if (cardAncestors.at(-1) !== actionCard || cardAncestors.some(isHiddenMarkupElement) ||
        cardAncestors.some(element => element.tagName === 'a')) continue;
    const descendants = cardElements.filter(element => isInsideElement(element, description));
    if (descendants.some(element => element.tagName === 'a' || isHiddenMarkupElement(element) ||
        ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'object'].includes(element.tagName))) continue;

    const descriptionMarkup = cardMarkup.slice(description.contentStart, description.contentEnd);
    if (/<(?:table|thead|tbody|tfoot|tr|td|th)\b/i.test(descriptionMarkup)) continue;
    const ruleMarkup = extractRuleBearingMarkup(descriptionMarkup).trim();
    if (!/<(?:p|li)\b/i.test(ruleMarkup) ||
        supportBoundedStatutoryAdvisory({ ...request, sourceText: cleanHtmlText(ruleMarkup) }) !== true) continue;
    return markupWithoutComments.slice(0, cardStart) + '<div>' + ruleMarkup + '</div>' + markupWithoutComments.slice(cardEnd);
  }
  return mainMarkup;
}

const ACRA_AUDIT_CONTEXT_HEADING = 'If your company is newly incorporated (less than two years old)';
const ACRA_AUDIT_CONTEXT_ELIGIBILITY = 'You qualify for audit exemption if you meet the criteria in the current financial year.';
const ACRA_AUDIT_GROUP_CONTEXT_HEADING = 'If your company is part of a group';
const ACRA_AUDIT_GROUP_CRITERIA = 'Your entire group (including foreign entities) meets at least two of these quantitative criteria for the immediate past two consecutive financial years:';
const ACRA_AUDIT_SECTION_BOUNDARIES = [
  'Maintaining your exemption status',
  'Frequently asked questions (FAQs)'
] as const;

/** Retain only the exact native section labels needed by the complete ACRA audit proof. */
function preserveAcraAuditExemptionContext(
  mainMarkup: string,
  request: AcraAuditExemptionContextRequest
): string {
  if (!isAcraAuditExemptionContextRequest(request)) return mainMarkup;
  const elements = parseBalancedMarkupElements(mainMarkup);
  if (!elements) return mainMarkup;

  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const summaryLabels = [ACRA_AUDIT_CONTEXT_HEADING, ACRA_AUDIT_GROUP_CONTEXT_HEADING];
  for (const label of summaryLabels) {
    const matches = elements.filter(element => element.tagName === 'summary' && element.contentEnd !== undefined &&
      cleanHtmlText(mainMarkup.slice(element.contentStart, element.contentEnd)
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi, ' ')).trim() === label);
    if (matches.length !== 1) continue;
    const summary = matches[0];
    const details = summary.parent?.tagName === 'details' ? summary.parent : undefined;
    if (!details || summary.end === undefined || !isVisibleAcraAuditContextPath(summary, details) ||
        !hasOnlyVisibleAcraAuditContextDescendants(summary, elements)) continue;
    if (label === ACRA_AUDIT_CONTEXT_HEADING) {
      const eligibility = elements.filter(element => element.tagName === 'p' && isInsideElement(element, details) &&
        cleanHtmlText(mainMarkup.slice(element.contentStart, element.contentEnd)).trim() === ACRA_AUDIT_CONTEXT_ELIGIBILITY &&
        isVisibleAcraAuditContextPath(element, details) && hasOnlyVisibleAcraAuditContextDescendants(element, elements));
      if (eligibility.length !== 1 || eligibility[0].start <= summary.end) continue;
    } else {
      const criteria = elements.filter(element => element.tagName === 'p' && isInsideElement(element, details) &&
        cleanHtmlText(mainMarkup.slice(element.contentStart, element.contentEnd)).trim() === ACRA_AUDIT_GROUP_CRITERIA &&
        isVisibleAcraAuditContextPath(element, details));
      if (criteria.length !== 1) continue;
    }
    replacements.push({ start: summary.start, end: summary.end, text: `<p>${mainMarkup.slice(summary.contentStart, summary.contentEnd)}</p>` });
  }

  for (const label of ACRA_AUDIT_SECTION_BOUNDARIES) {
    const matches = elements.filter(element => element.tagName === 'h2' && element.contentEnd !== undefined &&
      cleanHtmlText(mainMarkup.slice(element.contentStart, element.contentEnd)).trim() === label &&
      isVisibleAcraAuditContextPath(element) && hasOnlyVisibleAcraAuditContextDescendants(element, elements));
    if (matches.length === 1) {
      const heading = matches[0];
      if (heading.end !== undefined) replacements.push({
        start: heading.start, end: heading.end,
        text: `<p>${mainMarkup.slice(heading.contentStart, heading.contentEnd)}</p>`
      });
    }
  }

  return replacements.sort((left, right) => right.start - left.start).reduce((markup, replacement) =>
    markup.slice(0, replacement.start) + replacement.text + markup.slice(replacement.end), mainMarkup);
}

function hasOnlyVisibleAcraAuditContextDescendants(
  element: BalancedMarkupElement,
  elements: readonly BalancedMarkupElement[]
): boolean {
  return !elements.some(descendant => isInsideElement(descendant, element) &&
    (descendant.tagName === 'a' || (descendant.tagName !== 'svg' && isHiddenMarkupElement(descendant))));
}

function isVisibleAcraAuditContextPath(element: BalancedMarkupElement, stopAt?: BalancedMarkupElement): boolean {
  let foundStop = stopAt === undefined;
  for (let current: BalancedMarkupElement | undefined = element; current; current = current.parent) {
    const identity = `${markupAttribute(current.attributes, 'class')} ${markupAttribute(current.attributes, 'id')}`;
    if (isHiddenMarkupElement(current) || current.tagName === 'a' || RULE_METADATA_CONTAINER_MARKER.test(identity) ||
        /\b(?:navigation|navbar|breadcrumb|menu|sidebar|carousel|teaser|quick[-_ ]?link|related|page[-_ ]?index)\b/i.test(identity)) {
      return false;
    }
    if (current === stopAt) foundStop = true;
  }
  return foundStop;
}
interface MarkupElementContext {
  tagName: string;
  blockLinkCardStarts: number[];
}

/**
 * Find a page-index link collection: at least three sibling links, each wrapping
 * both a heading and a summary paragraph. A cluster like this is navigation,
 * even when its cards sit inside an otherwise ordinary main element.
 */
function findBlockLinkCollectionStart(markup: string): number | undefined {
  const tagPattern = /<(\/)?([a-z][\w:-]*)\b[^>]*>/gi;
  const collectionContainers = new Set(['div', 'section', 'article', 'ul', 'ol']);
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack: MarkupElementContext[] = [];
  const elements: MarkupElementContext[] = [];
  const links: Array<{ parent: MarkupElementContext | undefined; start: number; contentStart: number }> = [];

  for (const match of markup.matchAll(tagPattern)) {
    const tagName = match[2].toLowerCase();
    const closing = Boolean(match[1]);
    const index = match.index ?? 0;

    if (tagName === 'a') {
      if (closing) {
        const link = links.pop();
        if (link?.parent && collectionContainers.has(link.parent.tagName)) {
          const inner = markup.slice(link.contentStart, index);
          if (/<h[2-6]\b/i.test(inner) && /<p\b/i.test(inner)) link.parent.blockLinkCardStarts.push(link.start);
        }
      } else {
        links.push({ parent: stack[stack.length - 1], start: index, contentStart: index + match[0].length });
      }
    }

    if (closing) {
      let openIndex = stack.length - 1;
      while (openIndex >= 0 && stack[openIndex].tagName !== tagName) openIndex -= 1;
      if (openIndex >= 0) stack.splice(openIndex);
    } else if (!voidTags.has(tagName) && !/\/\s*>$/.test(match[0])) {
      const element: MarkupElementContext = { tagName, blockLinkCardStarts: [] };
      elements.push(element);
      stack.push(element);
    }
  }

  const collectionStarts = elements
    .filter(element => collectionContainers.has(element.tagName) && element.blockLinkCardStarts.length >= 3)
    .flatMap(element => element.blockLinkCardStarts);
  return collectionStarts.length > 0 ? Math.min(...collectionStarts) : undefined;
}

function normalizeVisibleText(value: string): string {
  return cleanHtmlText(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function getPageDescriptionMetadata(rawDocument: string): string[] {
  const descriptions = new Set<string>();
  for (const match of rawDocument.matchAll(/<meta\b([^>]*)>/gi)) {
    const attributes = match[1];
    const name = attributes.match(/(?:^|\s)name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const property = attributes.match(/(?:^|\s)property\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const kind = (name?.[1] ?? name?.[2] ?? name?.[3] ?? property?.[1] ?? property?.[2] ?? property?.[3] ?? '').toLowerCase();
    if (!['description', 'og:description', 'twitter:description'].includes(kind)) continue;
    const content = attributes.match(/(?:^|\s)content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const value = content?.[1] ?? content?.[2] ?? content?.[3];
    const normalized = value ? normalizeVisibleText(value) : '';
    if (normalized) descriptions.add(normalized);
  }
  return [...descriptions];
}

/**
 * Remove a duplicated page-description lead only for an index-style main:
 * the title-styled lead immediately follows the h1, a later sibling collection
 * contains heading-and-summary cards, and no rule-bearing article content
 * remains after those cards are removed. Related cards cannot hide article prose.
 */
function removeNavigationalSummaryLead(markup: string, rawDocument: string): string {
  const descriptions = getPageDescriptionMetadata(rawDocument);
  if (descriptions.length === 0) return markup;

  const collectionStart = findBlockLinkCollectionStart(markup);
  if (collectionStart === undefined) return markup;

  const heading = /<h1\b[^>]*>[\s\S]*?<\/h1\s*>/i.exec(markup);
  if (!heading) return markup;
  const headingEnd = (heading.index ?? 0) + heading[0].length;

  const firstLead = /<p\b[^>]*>[\s\S]*?<\/p\s*>/i.exec(markup.slice(headingEnd, collectionStart));
  if (!firstLead) return markup;
  const leadText = firstLead[0].replace(/^<p\b[^>]*>|<\/p\s*>$/gi, ' ');
  if (/<a\b/i.test(leadText) || !descriptions.includes(normalizeVisibleText(leadText))) return markup;
  const leadAttributes = /^<p\b([^>]*)>/i.exec(firstLead[0])?.[1] || '';
  const leadClass = leadAttributes.match(/(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!/\bprose-title(?:-[\w-]+)?\b/i.test(leadClass?.[1] ?? leadClass?.[2] ?? leadClass?.[3] ?? '')) return markup;

  const leadStart = headingEnd + (firstLead.index ?? 0);
  if (cleanHtmlText(markup.slice(headingEnd, leadStart)).trim()) return markup;

  const withoutLead = `${markup.slice(0, leadStart)}${' '.repeat(firstLead[0].length)}${markup.slice(leadStart + firstLead[0].length)}`;
  const remainingRuleMarkup = removeLinkOnlyRuleBlocks(removeRuleMetadataContainers(removeBlockWrappingLinks(withoutLead)))
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]\s*>/gi, ' ');
  if (cleanHtmlText(extractRuleBearingMarkup(remainingRuleMarkup)).trim()) return markup;
  return withoutLead;
}

/** Remove page chrome before topic matching so menu labels cannot act as evidence. */
function extractVisiblePageText(
  rawDocument: string,
  options: {
    preferMainContent?: boolean;
    requireSubstantiveBody?: boolean;
    requireAcraAnnualReturnDeadlineTable?: boolean;
    acraAuditExemptionContextRequest?: AcraAuditExemptionContextRequest;
    cpfOrdinaryWageDefinitionRequest?: BoundedStatutoryAdvisoryRequest;
    cpfAdditionalWageDefinitionRequest?: BoundedStatutoryAdvisoryRequest;
  } = {}
): string {
  const withoutChrome = (options.preferMainContent ? removeCorporateNavigationMarkup(rawDocument) : rawDocument)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|script|style|noscript|svg|template|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(div|section|ul)\b(?=[^>]*(?:id|class)\s*=\s*["'][^"']*(?:navigation|navbar|breadcrumb|menu|sidebar|site-search|cookie|utility-links|social-links)[^"']*["'])[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  // Prefer the page's main even when an unrelated article or banner precedes it.
  const contentMatch = withoutChrome.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i) ||
    withoutChrome.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i);
  const bodyMatch = withoutChrome.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  let visibleMarkup = contentMatch?.[1] || bodyMatch?.[1] || withoutChrome;
  const cpfWageDefinitionRequest = options.cpfAdditionalWageDefinitionRequest || options.cpfOrdinaryWageDefinitionRequest;
  if (contentMatch && /^<main\b/i.test(contentMatch[0]) && cpfWageDefinitionRequest &&
      !/<\/?main\b/i.test(contentMatch[1])) {
    const mainMarkup = rawDocument
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(head|script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
    const mainOpenings = [...mainMarkup.matchAll(/<main\b([^>]*)>/gi)];
    const mainClosings = [...mainMarkup.matchAll(/<\/main\s*>/gi)];
    const mainOpen = mainOpenings[0];
    const mainOpenIndex = mainOpen?.index ?? -1;
    const mainCloseIndex = mainClosings[0]?.index ?? -1;
    const mainPrefix = mainOpen
      ? parseBalancedMarkupElements(mainMarkup.slice(0, mainOpenIndex), true)
      : undefined;
    const outerAncestors = mainPrefix?.filter(element => element.end === undefined) || [];
    let visibleMain = Boolean(mainOpen && mainOpenings.length === 1 && mainClosings.length === 1 &&
      mainCloseIndex > mainOpenIndex && mainPrefix && !isHiddenMarkupAttributes(mainOpen[1]));
    for (const ancestor of outerAncestors) {
      const identity = `${markupAttribute(ancestor.attributes, 'class')} ${markupAttribute(ancestor.attributes, 'id')}`;
      if (!['html', 'body', 'div', 'section', 'article'].includes(ancestor.tagName) ||
          isHiddenMarkupElement(ancestor) || ['nav', 'aside', 'header', 'footer', 'a'].includes(ancestor.tagName) ||
          RULE_METADATA_CONTAINER_MARKER.test(identity) ||
          /\b(?:navigation|navbar|breadcrumb|menu|sidebar|quick[-_ ]?link|related|page[-_ ]?index)\b/i.test(identity)) {
        visibleMain = false;
        break;
      }
    }
    if (visibleMain && mainOpen && mainClosings[0]) {
      const mainContentStart = mainOpenIndex + mainOpen[0].length;
      const originalMainContent = mainMarkup.slice(mainContentStart, mainCloseIndex);
      visibleMarkup = preserveSupportedCpfWageCard(originalMainContent, cpfWageDefinitionRequest)
        .replace(/<(head|script|style|noscript|svg|template|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(/<(div|section|ul)\b(?=[^>]*(?:id|class)\s*=\s*["'][^"']*(?:navigation|navbar|breadcrumb|menu|sidebar|site-search|cookie|utility-links|social-links)[^"']*["'])[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
    }
  }
  const deadlineTable = options.requireAcraAnnualReturnDeadlineTable
    ? findSimpleAcraDeadlineTable(visibleMarkup) : undefined;
  if (options.requireAcraAnnualReturnDeadlineTable && !deadlineTable && hasAcraDeadlineTableHeader(visibleMarkup)) return '';
  const tableMarker = '\uE100ACRA_DEADLINE_TABLE\uE101';
  if (deadlineTable) {
    for (const tableMarkup of deadlineTable.rawHtml) {
      visibleMarkup = visibleMarkup.replace(tableMarkup, `<p>${tableMarker}</p>`);
    }
  }
  if (options.acraAuditExemptionContextRequest) {
    const visibleAuditMarkup = removeHiddenAcraAuditMarkup(visibleMarkup, options.acraAuditExemptionContextRequest);
    if (visibleAuditMarkup === undefined) return '';
    visibleMarkup = visibleAuditMarkup;
  }
  if (options.requireSubstantiveBody) {
    visibleMarkup = removeNavigationalSummaryLead(visibleMarkup, rawDocument);
    visibleMarkup = removeLinkOnlyRuleBlocks(removeRuleMetadataContainers(removeBlockWrappingLinks(visibleMarkup)));
    if (options.acraAuditExemptionContextRequest) visibleMarkup = preserveAcraAuditExemptionContext(
      visibleMarkup, options.acraAuditExemptionContextRequest
    );
    visibleMarkup = extractRuleBearingMarkup(visibleMarkup);
  }
  // Keep nested list-item identity after HTML cleanup so evidence-only fallback
  // can exclude a dangling introduction and every child item. Bullet markers
  // are visible list formatting, not added tax-rule text.
  const listAwareMarkup = preserveListItemBoundaries(visibleMarkup);
  const visibleText = cleanHtmlText(listAwareMarkup);
  return deadlineTable ? visibleText.replaceAll(tableMarker, deadlineTable.text) : visibleText;
}

const TOPIC_TERM_STOPWORDS = new Set(['a', 'an', 'and', 'of', 'the']);

function normalizeTopicTerm(value: string): string {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(token => token && !TOPIC_TERM_STOPWORDS.has(token))
    .join(' ');
}

function containsTopicTerm(content: string, term: string): boolean {
  const normalizedContent = normalizeTopicTerm(content);
  const normalizedTerm = normalizeTopicTerm(term);
  return Boolean(normalizedTerm && ` ${normalizedContent} `.includes(` ${normalizedTerm} `));
}

function canonicalIrasTopicToken(token: string): string {
  if (token === 'royalty' || token === 'royalties') return 'royalty';
  if (token === 'expense' || token === 'expenses') return 'expense';
  return token;
}

/**
 * Match an exact topic phrase first. IRAS may opt into a bounded fallback that
 * requires every token from a multiword term to appear in the visible text,
 * allowing word-order changes and only the reviewed royalty/expense number forms.
 */
export function matchesTopicContentTerm(
  content: string,
  term: string,
  allowIrasTopicTokenEquivalence = false
): boolean {
  if (containsTopicTerm(content, term)) return true;
  if (!allowIrasTopicTokenEquivalence) return false;

  const termTokens = normalizeTopicTerm(term).split(/\s+/).filter(Boolean);
  if (termTokens.length < 2) return false;
  const hasReviewedIrasVariant = termTokens.some(token =>
    token === 'expense' || token === 'expenses' || token === 'royalty' || token === 'royalties');
  if (!hasReviewedIrasVariant) return false;
  const contentTokens = new Set(normalizeTopicTerm(content).split(/\s+/).filter(Boolean).map(canonicalIrasTopicToken));
  return termTokens.every(token => contentTokens.has(canonicalIrasTopicToken(token)));
}

/**
 * Deterministic mapping between full legislative titles and statutory short codes.
 */
export const CANONICAL_ACT_MAP: Record<string, string> = {
  'Companies Act 1967': 'CoA1967',
  'CoA1967': 'CoA1967',
  'Income Tax Act 1947': 'ITA1947',
  'ITA1947': 'ITA1947',
  'Employment Act 1968': 'EA1968',
  'EA1968': 'EA1968',
  'Central Provident Fund Act 1953': 'CPFA1953',
  'CPFA1953': 'CPFA1953',
  'Goods and Services Tax Act 1993': 'GSTA1993',
  'GSTA1993': 'GSTA1993',
  'Variable Capital Companies Act 2018': 'VCCA2018',
  'VCCA2018': 'VCCA2018',
  'FX_OBSERVATION': 'FX_OBSERVATION'
};

export function getCanonicalActCode(actOrCode?: string): string | undefined {
  if (!actOrCode) return undefined;
  const trimmed = actOrCode.trim();
  return CANONICAL_ACT_MAP[trimmed] || trimmed;
}

/**
 * External Source Validator.
 * Enforces security gates, exact hostname checks, HTTPS/port 443 enforcement,
 * redirect validation, and document structural checks.
 */
export class ExternalSourceValidator {
  /**
   * Validates URL security, protocol, port, credentials, and exact hostname.
   */
  public validateUrlSecurity(rawUrl: string): ExternalValidationResult {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { isValid: false, errorCode: 'INVALID_URL', reason: `Malformed URL: '${rawUrl}'` };
    }

    // 1. Protocol: HTTPS only
    if (parsed.protocol !== 'https:') {
      return { isValid: false, errorCode: 'INSECURE_PROTOCOL', reason: `Protocol '${parsed.protocol}' is forbidden; HTTPS on port 443 is strictly required` };
    }

    // 2. Port: 443 or default HTTPS port only
    if (parsed.port !== '' && parsed.port !== '443') {
      return { isValid: false, errorCode: 'NON_STANDARD_PORT', reason: `Port '${parsed.port}' is forbidden; only default HTTPS port 443 is permitted` };
    }

    // 3. Exact hostname matching
    const hostname = parsed.hostname.toLowerCase();
    if (!ALL_ALLOWED_HOSTNAMES.has(hostname)) {
      return {
        isValid: false,
        errorCode: 'UNAUTHORIZED_DOMAIN_ACCESS',
        reason: `Hostname '${hostname}' is not in the authorized statutory or reference domain allowlist`
      };
    }

    // 4. Credentials in URL: strictly rejected
    if (parsed.username || parsed.password) {
      return { isValid: false, errorCode: 'CREDENTIALS_DISALLOWED', reason: 'Embedded username or password in URL is strictly forbidden' };
    }

    return { isValid: true };
  }

  /**
   * Validates domain specifically against the allowlist
   */
  public validateDomain(url: string): boolean {
    return this.validateUrlSecurity(url).isValid;
  }

  /**
   * Validates protocol (HTTPS only)
   */
  public validateProtocol(url: string): boolean {
    try {
      const u = new URL(url);
      return u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Validates redirect destinations against the same strict domain allowlist.
   */
  public validateRedirect(originalUrl: string, targetUrl: string): ExternalValidationResult {
    const origCheck = this.validateUrlSecurity(originalUrl);
    if (!origCheck.isValid) return origCheck;

    const targetCheck = this.validateUrlSecurity(targetUrl);
    if (!targetCheck.isValid) {
      return {
        isValid: false,
        errorCode: 'REDIRECT_REJECTED',
        reason: `Redirect to unauthorized destination '${targetUrl}' was rejected: ${targetCheck.reason}`
      };
    }

    return { isValid: true };
  }

  /**
   * Validates HTTP content type
   */
  public validateContentType(contentType?: string): boolean {
    if (!contentType) return false;
    const lower = contentType.toLowerCase();
    return (
      lower.includes('application/json') ||
      lower.includes('text/plain') ||
      lower.includes('text/html') ||
      lower.includes('application/xml') ||
      lower.includes('text/xml')
    );
  }

  /** Reject official but unrelated pages and generic portals before use as evidence. */
  public validateTopicContent(
    rawDocument: string,
    expectation: TopicContentExpectation
  ): TopicContentValidationResult {
    if (!rawDocument || typeof rawDocument !== 'string') {
      return { isValid: false, errorCode: 'MALFORMED_DOCUMENT_STRUCTURE', reason: 'Fetched page has no document content' };
    }

    const titleMatch = rawDocument.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch ? cleanHtmlText(titleMatch[1]) : '';
    const cpfWageDefinitionRequest = expectation.cpfAdditionalWageDefinitionRequest ||
      expectation.cpfOrdinaryWageDefinitionRequest;
    const substantiveText = extractVisiblePageText(rawDocument, {
      preferMainContent: expectation.preferMainContent,
      requireSubstantiveBody: expectation.requireSubstantiveBody,
      requireAcraAnnualReturnDeadlineTable: expectation.requireAcraAnnualReturnDeadlineTable,
      acraAuditExemptionContextRequest: expectation.acraAuditExemptionContextRequest,
      cpfOrdinaryWageDefinitionRequest: expectation.cpfOrdinaryWageDefinitionRequest,
      cpfAdditionalWageDefinitionRequest: expectation.cpfAdditionalWageDefinitionRequest
    });
    if (cpfWageDefinitionRequest &&
        (!isBoundedStatutoryAdvisoryRequest(cpfWageDefinitionRequest) ||
         supportBoundedStatutoryAdvisory({
           ...cpfWageDefinitionRequest,
           sourceText: substantiveText
         }) !== true)) {
      return {
        isValid: false,
        errorCode: 'MALFORMED_DOCUMENT_STRUCTURE',
        reason: 'Fetched CPF wage-definition page does not contain both complete source-stated ordinary-wage conditions',
        pageTitle,
        substantiveText
      };
    }
    if (!pageTitle || /^(?:home(?:page)?|search(?: results)?|sign in|log in|login|access denied|not found|error)(?:\s*[-|:].*)?$/i.test(pageTitle)) {
      return { isValid: false, errorCode: 'MALFORMED_DOCUMENT_STRUCTURE', reason: 'Fetched page has a generic, unavailable, or login title', pageTitle, substantiveText };
    }

    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const normalizedTitle = normalize(pageTitle);
    const normalizedContent = normalize(substantiveText);
    const visibleWords = normalizedContent.split(/\s+/).filter(Boolean);
    const distinctVisibleWords = new Set(visibleWords);
    if (visibleWords.length < 10 || distinctVisibleWords.size < 8 || substantiveText.length < 55) {
      return { isValid: false, errorCode: 'MALFORMED_DOCUMENT_STRUCTURE', reason: 'Fetched page has too little visible body content to substantiate a topic; navigation or page chrome is not evidence', pageTitle, substantiveText };
    }
    const titleSpecificity = expectation.expectedTitles
      .map(normalize)
      .filter(value => value.length > 0)
      .some(value => normalizedTitle.includes(value));
    const identityMatched = expectation.standardIdentifiers.some(identifier => {
      const key = normalize(identifier);
      return key.length > 0 && (normalizedTitle.includes(key) || normalizedContent.includes(key));
    });
    if (!titleSpecificity || !identityMatched) {
      return { isValid: false, errorCode: 'MALFORMED_DOCUMENT_STRUCTURE', reason: 'Fetched page title or content does not identify the mapped standard/source', pageTitle, substantiveText };
    }

    if (expectation.requireAcraAnnualReturnDeadlineTable && !supportsAcraAnnualReturnDeadlineTable(substantiveText)) {
      return { isValid: false, errorCode: 'MALFORMED_DOCUMENT_STRUCTURE', reason: 'Fetched ACRA annual-return page does not contain one complete, unambiguous deadline table', pageTitle, substantiveText };
    }

    const terms = [...new Set(expectation.topicTerms.map(normalize).filter(term => term.length > 2))];
    if (expectation.requireSubstantiveBody === true) {
      const hasSubstantiveTopicBlock = substantiveText.split(/\n+/).some(block => {
        const normalizedBlock = normalize(block);
        const wordCount = normalizedBlock.split(/\s+/).filter(Boolean).length;
        return normalizedBlock.length >= 55 && wordCount >= 10 && terms.some(term => matchesTopicContentTerm(
          block,
          term,
          expectation.allowIrasTopicTokenEquivalence === true
        ));
      });
      if (!hasSubstantiveTopicBlock) {
        return { isValid: false, errorCode: 'MALFORMED_DOCUMENT_STRUCTURE', reason: 'Fetched page does not contain a substantive paragraph, list item, or table cell that states the requested topic', pageTitle, substantiveText };
      }
    }
    const matchingTerms = terms.filter(term => matchesTopicContentTerm(
      substantiveText,
      term,
      expectation.allowIrasTopicTokenEquivalence === true
    ));
    const minimumMatches = expectation.minimumTopicTermMatches ?? 1;
    if (matchingTerms.length < minimumMatches) {
      return { isValid: false, errorCode: 'MALFORMED_DOCUMENT_STRUCTURE', reason: 'Fetched page does not contain enough topic-specific terms to support the mapped topic', pageTitle, substantiveText };
    }

    return { isValid: true, pageTitle, substantiveText };
  }

  /**
   * Validates candidate document structure before allowing candidate registration.
   */
  public validateDocumentStructure(doc: any): ExternalValidationResult {
    if (!doc || typeof doc !== 'object') {
      return { isValid: false, errorCode: 'MALFORMED_DOCUMENT_STRUCTURE', reason: 'Document payload is empty or not an object' };
    }

    const requiredFields = ['standardOrActCode', 'paragraphOrSection', 'sourceText', 'documentTitle'];
    for (const field of requiredFields) {
      if (!doc[field] || typeof doc[field] !== 'string' || doc[field].trim().length === 0) {
        return {
          isValid: false,
          errorCode: 'MALFORMED_DOCUMENT_STRUCTURE',
          reason: `Required statutory field '${field}' is missing or empty`
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Validates canonical URL aligns with statutory authority.
   */
  public validateCanonicalUrl(url: string, authority: string): ExternalValidationResult {
    const secCheck = this.validateUrlSecurity(url);
    if (!secCheck.isValid) return secCheck;

    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    if (authority === 'AGC' || authority === 'SSO') {
      if (host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `AGC/SSO statutory law must point to sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'IRAS') {
      if (host !== 'iras.gov.sg' && host !== 'www.iras.gov.sg' && host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `IRAS guidance must point to iras.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'ACRA') {
      if (host !== 'acra.gov.sg' && host !== 'www.acra.gov.sg' && host !== 'asc.acra.gov.sg' && host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `ACRA directives must point to acra.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'MOM') {
      if (host !== 'mom.gov.sg' && host !== 'www.mom.gov.sg' && host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `MOM statutory guidance must point to mom.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'CPF') {
      if (host !== 'cpf.gov.sg' && host !== 'www.cpf.gov.sg' && host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `CPF statutory guidance must point to cpf.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'MAS') {
      if (host !== 'mas.gov.sg' && host !== 'www.mas.gov.sg' && host !== 'sso.agc.gov.sg') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `MAS statutory guidance must point to mas.gov.sg or sso.agc.gov.sg, found '${host}'` };
      }
    } else if (authority === 'REFERENCE_API') {
      if (host !== 'api.frankfurter.dev') {
        return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `Reference API must point to api.frankfurter.dev, found '${host}'` };
      }
    } else {
      return { isValid: false, errorCode: 'CANONICAL_URL_MISMATCH', reason: `Unrecognized authority '${authority}' for canonical URL validation` };
    }

    return { isValid: true };
  }

  /**
   * Validates source provenance.
   * Proves that external content does not falsely claim local static provenance or unverified primary tier.
   */
  public validateProvenance(record: AuthoritativeSourceRecord, sourceUrl: string): ExternalValidationResult {
    const urlCheck = this.validateUrlSecurity(sourceUrl);
    if (!urlCheck.isValid) return urlCheck;

    // External fetched content cannot declare itself LOCAL_STATIC
    if (record.provenance === 'LOCAL_STATIC') {
      return {
        isValid: false,
        errorCode: 'PROVENANCE_MISMATCH',
        reason: 'Externally retrieved candidate cannot declare provenance as LOCAL_STATIC'
      };
    }

    return { isValid: true };
  }

  /**
   * Validates that candidate sourceText can be deterministically tied back to the recorded source boundary in the raw document.
   */
  public validateSourceBoundary(record: AuthoritativeSourceRecord, rawDocument: string): ExternalValidationResult {
    if (!rawDocument || typeof rawDocument !== 'string' || rawDocument.length === 0) {
      return {
        isValid: false,
        errorCode: 'MALFORMED_DOCUMENT_STRUCTURE',
        reason: 'Raw document is required to validate source boundary'
      };
    }

    if (record.extractionStatus === 'FAILED') {
      return {
        isValid: false,
        errorCode: 'EXTRACTION_FAILED',
        reason: `Extraction failed: could not locate provision '${record.paragraphOrSection}' in source '${record.standardOrActCode}'`
      };
    }

    if (record.extractionStatus === 'PARTIAL') {
      if (record.isVerbatimText) {
        return {
          isValid: false,
          errorCode: 'INVALID_VERBATIM_CLAIM',
          reason: 'Partial extraction cannot be declared as isVerbatimText = true'
        };
      }
      return {
        isValid: false,
        errorCode: 'PARTIAL_PROVISION',
        reason: `Partial extraction is not eligible for authoritative verification for '${record.id}'`
      };
    }

    const locator = record.sourceLocator;
    if (!locator) {
      return {
        isValid: false,
        errorCode: 'PROVISION_MAPPING_MISMATCH',
        reason: 'Missing source locator for source boundary verification'
      };
    }

    const startOffset = locator.boundary?.startOffset ?? locator.startOffset;
    const endOffset = locator.boundary?.endOffset ?? locator.endOffset;

    if (
      startOffset === undefined ||
      endOffset === undefined ||
      typeof startOffset !== 'number' ||
      typeof endOffset !== 'number' ||
      startOffset < 0 ||
      endOffset > rawDocument.length ||
      startOffset >= endOffset
    ) {
      return {
        isValid: false,
        errorCode: 'PROVISION_MAPPING_MISMATCH',
        reason: `Invalid provision boundaries: startOffset=${startOffset}, endOffset=${endOffset}, docLength=${rawDocument.length}`
      };
    }

    const rawSlice = rawDocument.slice(startOffset, endOffset);

    // If source format is JSON or authority is REFERENCE_API
    if (record.authority === 'REFERENCE_API' || locator.sourceType === 'JSON') {
      let parsedSlice: any;
      try {
        parsedSlice = JSON.parse(rawSlice);
        if (!parsedSlice || typeof parsedSlice !== 'object') {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: 'Source boundary does not contain a valid JSON object'
          };
        }
      } catch {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: 'Source boundary does not parse as valid JSON'
        };
      }

      // JSON payload must deterministically correspond to fxObservation
      if (record.fxObservation) {
        const obs = record.fxObservation;
        if (obs.date && parsedSlice.date !== obs.date) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `JSON boundary payload date mismatch: expected '${obs.date}', got '${parsedSlice.date}'`
          };
        }
        if (obs.base && parsedSlice.base !== obs.base) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `JSON boundary payload base mismatch: expected '${obs.base}', got '${parsedSlice.base}'`
          };
        }
        if (obs.rates && typeof obs.rates === 'object') {
          if (!parsedSlice.rates || typeof parsedSlice.rates !== 'object') {
            return {
              isValid: false,
              errorCode: 'PROVISION_MAPPING_MISMATCH',
              reason: 'JSON boundary payload is missing rates object required by fxObservation'
            };
          }
          for (const [sym, rate] of Object.entries(obs.rates)) {
            if (parsedSlice.rates[sym] !== rate) {
              return {
                isValid: false,
                errorCode: 'PROVISION_MAPPING_MISMATCH',
                reason: `JSON boundary payload rate mismatch for currency '${sym}': expected ${rate}, got ${parsedSlice.rates[sym]}`
              };
            }
          }
        }
      } else if (record.authority === 'REFERENCE_API') {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: 'Reference API record is missing fxObservation payload for boundary verification'
        };
      }

      return { isValid: true };
    }

    // Preserve native table cells only for locators whose extraction recorded
    // an unambiguous table structure. Other HTML/text records retain the
    // existing whitespace-normalized boundary contract.
    const visibleRawSlice = rawSlice.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
      .replace(/<(script|style|noscript|svg|template|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
    const reconstructed = locator.tableStructure === 'PRESERVED'
      ? cleanHtmlTextPreservingTableCells(visibleRawSlice)
      : cleanHtmlText(rawSlice);
    if (reconstructed.trim() !== record.sourceText.trim()) {
      return {
        isValid: false,
        errorCode: 'PROVISION_MAPPING_MISMATCH',
        reason: `Source text mismatch: candidate sourceText does not match content reconstructed from raw document boundary offsets [${startOffset}, ${endOffset}]`
      };
    }

    return { isValid: true };
  }

  /**
   * Validates exact provision extraction, anti-truncation verbatim integrity,
   * and structural section/provision mapping with affirmative canonical Act and section identity.
   */
  public validateProvisionMapping(doc: AuthoritativeSourceRecord): ExternalValidationResult {
    // 1. Extraction Status Check
    if (doc.extractionStatus === 'FAILED') {
      return {
        isValid: false,
        errorCode: 'EXTRACTION_FAILED',
        reason: `Extraction failed: could not locate provision '${doc.paragraphOrSection}' in source '${doc.standardOrActCode}'`
      };
    }

    if (doc.extractionStatus === 'PARTIAL') {
      if (doc.isVerbatimText) {
        return {
          isValid: false,
          errorCode: 'INVALID_VERBATIM_CLAIM',
          reason: 'Partial extraction cannot be declared as isVerbatimText = true'
        };
      }
      return {
        isValid: false,
        errorCode: 'PARTIAL_PROVISION',
        reason: `Partial extraction is not eligible for authoritative verification for '${doc.id}'`
      };
    }

    // 2. Anti-truncation Verbatim Check
    if (doc.isVerbatimText) {
      if (!doc.sourceText || doc.sourceText.trim().length === 0) {
        return {
          isValid: false,
          errorCode: 'INVALID_VERBATIM_CLAIM',
          reason: 'Verbatim record has empty sourceText'
        };
      }

      // Check for truncation markers
      const truncationMarkers = ['...', '…', '[truncated]', '[abridged]', '[content truncated]', '[continued]'];
      for (const marker of truncationMarkers) {
        if (doc.sourceText.includes(marker)) {
          return {
            isValid: false,
            errorCode: 'INVALID_VERBATIM_CLAIM',
            reason: `Verbatim record contains truncation marker '${marker}'. Verbatim text must be complete and unabridged.`
          };
        }
      }

      // Assert source locator presence
      if (!doc.sourceLocator || (!doc.sourceLocator.heading && !doc.sourceLocator.elementId && !doc.sourceLocator.sourceNode)) {
        return {
          isValid: false,
          errorCode: 'INVALID_VERBATIM_CLAIM',
          reason: 'Verbatim record must have a populated sourceLocator with heading, elementId, or sourceNode'
        };
      }
    }

    // 3. Deterministic Source Mapping & Affirmative Identity Verification
    if (doc.sourceLocator) {
      // Affirmative Canonical Act Mapping
      if (doc.sourceLocator.act) {
        const docActCanonical = getCanonicalActCode(doc.standardOrActCode);
        const locActCanonical = getCanonicalActCode(doc.sourceLocator.act);
        if (docActCanonical && locActCanonical && docActCanonical !== locActCanonical) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `Canonical Act mismatch: document '${doc.standardOrActCode}' (${docActCanonical}) contradicts locator act '${doc.sourceLocator.act}' (${locActCanonical})`
          };
        }
      }

      // Affirmative Section Check
      if (doc.sourceLocator.section) {
        const claimedSecNum = doc.paragraphOrSection.match(/(?:Section|Sec\.?|S\.?)\s*(\d+)/i)?.[1];
        const locSecNum = doc.sourceLocator.section.match(/\d+/)?.[0];
        if (claimedSecNum && locSecNum && claimedSecNum !== locSecNum) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `Provision mapping mismatch: claimed section '${doc.paragraphOrSection}' contradicts locator section '${doc.sourceLocator.section}'`
          };
        }

        // Check schedule / part identity if non-numeric
        const claimedSchedule = doc.paragraphOrSection.match(/((?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth|Thirteenth|Part\s+[IVXLCDM]+)\s*(?:Schedule|Part)?)/i)?.[1];
        const locSchedule = doc.sourceLocator.section.match(/((?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth|Eleventh|Twelfth|Thirteenth|Part\s+[IVXLCDM]+)\s*(?:Schedule|Part)?)/i)?.[1];
        if (claimedSchedule && locSchedule) {
          const normClaimed = claimedSchedule.toLowerCase().replace(/\s+/g, '');
          const normLocator = locSchedule.toLowerCase().replace(/\s+/g, '');
          if (normClaimed !== normLocator) {
            return {
              isValid: false,
              errorCode: 'PROVISION_MAPPING_MISMATCH',
              reason: `Provision mapping mismatch: claimed schedule/part '${doc.paragraphOrSection}' contradicts locator section '${doc.sourceLocator.section}'`
            };
          }
        }
      }

      // Affirmative Subsection Check
      if (doc.sourceLocator.subsection) {
        const claimedSub = doc.paragraphOrSection.match(/\((\d+[a-zA-Z]?)\)/)?.[1];
        const locSub = doc.sourceLocator.subsection.replace(/[()]/g, '').trim();
        if (claimedSub && locSub && claimedSub !== locSub) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `Provision mapping mismatch: claimed subsection '(${claimedSub})' contradicts locator subsection '${doc.sourceLocator.subsection}'`
          };
        }
      }

      // Explicit contradiction in heading check
      const sectionNormalized = doc.paragraphOrSection.toLowerCase().replace(/[\s\-_(),.]/g, '');
      const headingNormalized = (doc.sourceLocator.heading || '').toLowerCase().replace(/[\s\-_(),.]/g, '');

      if (headingNormalized && headingNormalized.includes('section') && sectionNormalized.includes('section')) {
        const claimedNum = sectionNormalized.match(/\d+/)?.[0];
        const headingNum = headingNormalized.match(/\d+/)?.[0];
        if (claimedNum && headingNum && claimedNum !== headingNum) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `Provision mapping mismatch: claimed section '${doc.paragraphOrSection}' contradicts locator heading '${doc.sourceLocator.heading}'`
          };
        }

        const claimedSub = doc.paragraphOrSection.match(/\((\d+)\)/)?.[1];
        const headingSub = (doc.sourceLocator.heading || '').match(/\((\d+)\)/)?.[1];
        if (claimedSub && headingSub && claimedSub !== headingSub) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: `Provision mapping mismatch: claimed section '${doc.paragraphOrSection}' contradicts locator heading '${doc.sourceLocator.heading}'`
          };
        }
      }

      // Check boundary offsets if provided
      if (doc.sourceLocator.boundary) {
        if (doc.sourceLocator.boundary.endOffset <= doc.sourceLocator.boundary.startOffset || doc.sourceLocator.boundary.startOffset < 0) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: 'Invalid provision boundaries: boundary offsets are invalid (endOffset must be strictly greater than startOffset)'
          };
        }
      }

      if (doc.sourceLocator.startOffset !== undefined && doc.sourceLocator.endOffset !== undefined) {
        if (doc.sourceLocator.endOffset <= doc.sourceLocator.startOffset || doc.sourceLocator.startOffset < 0) {
          return {
            isValid: false,
            errorCode: 'PROVISION_MAPPING_MISMATCH',
            reason: 'Invalid provision boundaries: boundary offsets are invalid (endOffset must be strictly greater than startOffset)'
          };
        }
      }
    }

    // 4. Guidance vs Primary Source Enforcement
    const isGuidanceAuthority = ['IRAS', 'ACRA', 'MOM', 'CPF'].includes(doc.authority);
    const isAgcSource = doc.officialSourceUrl && doc.officialSourceUrl.includes('sso.agc.gov.sg');

    if (isGuidanceAuthority && !isAgcSource) {
      if (doc.evidenceTier === 'PRIMARY_SOURCE' || doc.sourceType === 'AUTHORITATIVE_SOURCE') {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: `Administrative guidance portal from '${doc.authority}' cannot claim PRIMARY_SOURCE or AUTHORITATIVE_SOURCE statutory status; must be modeled as OFFICIAL_GUIDANCE`
        };
      }

      // Verify structural node identifies guidance topic
      const nodeIdentifier = `${doc.sourceLocator?.sourceNode || ''} ${doc.sourceLocator?.elementId || ''}`.toLowerCase();
      if (doc.authority === 'IRAS' && !nodeIdentifier.includes('cit-rate') && !nodeIdentifier.includes('cit-rebate')) {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: `IRAS guidance structural node must identify tax rate/rebate topic (e.g. cit-rate), found '${nodeIdentifier}'`
        };
      }
      const verifiedAcraAnnualReturnSection = doc.authority === 'ACRA' &&
        doc.officialSourceUrl === ACRA_2022_ANNUAL_RETURN_TIMELINES_URL &&
        doc.domain === 'ACRA_CORP' &&
        doc.paragraphOrSection === 'Reminder to file Annual Returns (AR)' &&
        doc.acraFyeCohortApplicability?.kind === 'ACRA_FYE_ON_OR_AFTER' &&
        supportsAcraAnnualReturnDeadlineTable(doc.sourceText);
      if (doc.authority === 'ACRA' && !nodeIdentifier.includes('small-company') && !verifiedAcraAnnualReturnSection) {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: `ACRA guidance structural node must identify small-company topic, found '${nodeIdentifier}'`
        };
      }
      if (doc.authority === 'MOM' && !nodeIdentifier.includes('itemised-payslips') && !nodeIdentifier.includes('payslip')) {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: `MOM guidance structural node must identify itemised-payslip topic, found '${nodeIdentifier}'`
        };
      }
      if (doc.authority === 'CPF' && !nodeIdentifier.includes('ow-ceiling')) {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: `CPF guidance structural node must identify ow-ceiling topic, found '${nodeIdentifier}'`
        };
      }
    }

    // 5. Reference API & FX Observation Validation
    if (doc.authority === 'REFERENCE_API' || doc.standardOrActCode === 'FX_OBSERVATION') {
      if (doc.isVerbatimText) {
        return {
          isValid: false,
          errorCode: 'INVALID_VERBATIM_CLAIM',
          reason: 'Reference API observations cannot claim isVerbatimText = true because summary text is generated/curated'
        };
      }

      if (!doc.fxObservation || !doc.fxObservation.rates || !doc.fxObservation.base || !doc.fxObservation.date) {
        return {
          isValid: false,
          errorCode: 'PROVISION_MAPPING_MISMATCH',
          reason: 'Reference API observation is missing structured fxObservation payload'
        };
      }
    }

    return { isValid: true };
  }
}

/**
 * Singleton instance of ExternalSourceValidator.
 */
export const defaultExternalSourceValidator = new ExternalSourceValidator();
