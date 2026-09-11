import type { AuthoritativeSourceRecord, SourceLocator } from '../standards/unifiedSourceModel';
import type { RegulatoryUpdatePackage, AmendmentSummary } from './liveRegulatoryFeed';
import type { ControlledWebRetriever } from './controlledWebRetriever';
import type { StatutoryAuthority } from '../types/accounting';
import { computeSha256, computeProvisionHash } from '../standards/sourceVersioning';

/**
 * Universal extraction result contract for source-specific provision parsing.
 */
export interface ProvisionExtraction {
  standardOrActCode: string;
  paragraphOrSection: string;
  text: string;
  extractionStatus: 'EXACT' | 'PARTIAL' | 'FAILED';
  sourceLocator: SourceLocator;
  extractionMethod: string;
  isVerbatimText?: boolean;
}

/**
 * Structured FX Observation for reference API separation.
 */
export interface FxObservation {
  sourceAuthority: 'REFERENCE_API';
  provider: 'FRANKFURTER';
  date: string;
  base: string;
  rates: Record<string, number>;
}

/**
 * Helper to clean HTML markup, decode entities, and normalize whitespace without truncation.
 */
export function cleanHtmlText(htmlSnippet: string): string {
  return htmlSnippet
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&sect;/g, '§')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface BalancedContainerResult {
  outerHtml: string;
  innerHtml: string;
  startOffset: number;
  endOffset: number;
  tagName: string;
  elementId?: string;
}

/**
 * Robust balanced HTML container extractor.
 * Locates an element by opening tag matching the target criteria (tag name and id/class/attribute)
 * and balances opening/closing tags using depth counting.
 *
 * Guarantees:
 * 1. Accurately matches nested tags without stopping prematurely at inner </tag>.
 * 2. Does not rely on statutory text phrasing to find the boundaries.
 * 3. Fails closed (returns null) if the opening tag is missing or container is unclosed / truncated.
 */
export function extractBalancedContainer(
  html: string,
  tagName: string,
  idOrAttrPattern: RegExp | string
): BalancedContainerResult | null {
  if (!html || typeof html !== 'string') return null;

  const idPattern = typeof idOrAttrPattern === 'string'
    ? new RegExp(`id=["']${idOrAttrPattern}["']`, 'i')
    : idOrAttrPattern;

  const tagOpenRegex = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
  let openMatch: RegExpExecArray | null;

  while ((openMatch = tagOpenRegex.exec(html)) !== null) {
    const attrString = openMatch[1];
    if (idPattern.test(attrString) || idPattern.test(openMatch[0])) {
      const startOffset = openMatch.index;
      const openTagLen = openMatch[0].length;
      const contentStart = startOffset + openTagLen;

      // Extract element id
      const idMatch = attrString.match(/id=["']([^"']+)["']/i);
      const elementId = idMatch ? idMatch[1] : undefined;

      // Match either <tagName ...> or </tagName>
      const tokenRegex = new RegExp(`(<${tagName}\\b[^>]*>)|(<\\/${tagName}\\s*>)`, 'gi');
      tokenRegex.lastIndex = contentStart;

      let depth = 1;
      let tokenMatch: RegExpExecArray | null;

      while ((tokenMatch = tokenRegex.exec(html)) !== null) {
        if (tokenMatch[1]) {
          // Self-closing check
          if (!/\/\s*>$/.test(tokenMatch[1])) {
            depth++;
          }
        } else if (tokenMatch[2]) {
          depth--;
          if (depth === 0) {
            const endOffset = tokenMatch.index + tokenMatch[0].length;
            const innerHtml = html.slice(contentStart, tokenMatch.index);
            const outerHtml = html.slice(startOffset, endOffset);
            return {
              outerHtml,
              innerHtml,
              startOffset,
              endOffset,
              tagName: tagName.toLowerCase(),
              elementId
            };
          }
        }
      }

      // If loop exited without depth === 0, container is unclosed / truncated -> fail closed
      return null;
    }
  }

  return null;
}

/**
 * Finds a balanced HTML container starting at an exact offset in raw unstripped HTML.
 */
export function findBalancedContainerFrom(
  html: string,
  startOffset: number,
  tagName: string
): BalancedContainerResult | null {
  if (!html || typeof html !== 'string' || startOffset < 0 || startOffset >= html.length) return null;

  const openTagMatch = new RegExp(`^<${tagName}\\b([^>]*)>`, 'i').exec(html.slice(startOffset));
  if (!openTagMatch) return null;

  const attrString = openTagMatch[1];
  const openTagLen = openTagMatch[0].length;
  const contentStart = startOffset + openTagLen;

  const idMatch = attrString.match(/id=["']([^"']+)["']/i);
  const elementId = idMatch ? idMatch[1] : undefined;

  const tokenRegex = new RegExp(`(<${tagName}\\b[^>]*>)|(<\\/${tagName}\\s*>)`, 'gi');
  tokenRegex.lastIndex = contentStart;

  let depth = 1;
  let tokenMatch: RegExpExecArray | null;

  while ((tokenMatch = tokenRegex.exec(html)) !== null) {
    if (tokenMatch[1]) {
      if (!/\/\s*>$/.test(tokenMatch[1])) {
        depth++;
      }
    } else if (tokenMatch[2]) {
      depth--;
      if (depth === 0) {
        const endOffset = tokenMatch.index + tokenMatch[0].length;
        return {
          outerHtml: html.slice(startOffset, endOffset),
          innerHtml: html.slice(contentStart, tokenMatch.index),
          startOffset,
          endOffset,
          tagName: tagName.toLowerCase(),
          elementId
        };
      }
    }
  }

  return null;
}

/**
 * SSO / AGC Provision Extractor.
 * Deterministically locates and extracts an unabridged statutory subsection from Singapore Statutes Online HTML
 * using structural subsection container matching.
 */
export function extractSSOProvision(
  html: string,
  actCode: string = 'CoA1967',
  section: string = 'Section 201(5)'
): ProvisionExtraction {
  if (!html || typeof html !== 'string') {
    return {
      standardOrActCode: actCode,
      paragraphOrSection: section,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'SSO_STRUCTURAL_CONTAINER_PARSER',
      isVerbatimText: false
    };
  }

  // Parse target section number (e.g. '201') and subsection (e.g. '5')
  const secMatch = section.match(/(?:Section|Sec\.?|S\.?)\s*(\d+)/i);
  const subMatch = section.match(/\((\d+[a-zA-Z]?)\)/);
  const targetSec = secMatch ? secMatch[1] : '201';
  const targetSub = subMatch ? subMatch[1] : '5';

  // Strategy 1: Check for discrete subsection container explicitly matching id (e.g. pr201-5- or pr201-5)
  const explicitSubRegex = new RegExp(`id=["'](?:pr${targetSec}-${targetSub}-?|sec${targetSec}-${targetSub}-?|pr${targetSec}_${targetSub})["']`, 'i');
  const explicitSubContainer = extractBalancedContainer(html, 'div', explicitSubRegex) ||
                               extractBalancedContainer(html, 'p', explicitSubRegex);

  if (explicitSubContainer) {
    const rawOuter = html.slice(explicitSubContainer.startOffset, explicitSubContainer.endOffset);
    const cleaned = cleanHtmlText(rawOuter);
    if (cleaned.length > 20 && (cleaned.startsWith(`(${targetSub})`) || new RegExp(`^\\s*\\(${targetSub}\\)\\s+`).test(cleaned))) {
      return {
        standardOrActCode: actCode,
        paragraphOrSection: section,
        text: cleaned,
        extractionStatus: 'EXACT',
        isVerbatimText: true,
        sourceLocator: {
          document: 'Companies Act 1967',
          act: 'CoA1967',
          section: targetSec,
          subsection: targetSub,
          sourceNode: `${explicitSubContainer.tagName}#${explicitSubContainer.elementId}`,
          elementId: explicitSubContainer.elementId,
          heading: `Section ${targetSec}(${targetSub})`,
          startOffset: explicitSubContainer.startOffset,
          endOffset: explicitSubContainer.endOffset,
          boundary: {
            startOffset: explicitSubContainer.startOffset,
            endOffset: explicitSubContainer.endOffset
          },
          sourceType: 'HTML',
          canonicalLocator: `Companies Act 1967 > Section ${targetSec} > Subsection (${targetSub})`
        },
        extractionMethod: 'SSO_STRUCTURAL_CONTAINER_PARSER'
      };
    }
  }

  // Strategy 2: Locate Section container (div#pr201- or div#sec201)
  const secContainer = extractBalancedContainer(html, 'div', new RegExp(`id=["'](?:pr${targetSec}-[^"']*|pr${targetSec}|sec${targetSec})["']`, 'i'));
  if (!secContainer) {
    return {
      standardOrActCode: actCode,
      paragraphOrSection: section,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'SSO_STRUCTURAL_CONTAINER_PARSER',
      isVerbatimText: false
    };
  }

  // Scan discrete child containers inside secContainer in the raw unstripped HTML
  const childTagRegex = /<(div|p)\b([^>]*)>/gi;
  const openTagMatch = /^<div\b([^>]*)>/i.exec(html.slice(secContainer.startOffset));
  const openTagLen = openTagMatch ? openTagMatch[0].length : 0;
  const innerStart = secContainer.startOffset + openTagLen;
  const innerEnd = secContainer.endOffset - 6;

  childTagRegex.lastIndex = innerStart;
  let childMatch: RegExpExecArray | null;
  let matchedChildContainer: BalancedContainerResult | null = null;

  while ((childMatch = childTagRegex.exec(html)) !== null) {
    if (childMatch.index >= innerEnd) break;

    const childStart = childMatch.index;
    const tagName = childMatch[1];
    const childContainer = findBalancedContainerFrom(html, childStart, tagName);
    if (childContainer && childContainer.endOffset <= secContainer.endOffset) {
      const rawChild = html.slice(childContainer.startOffset, childContainer.endOffset);
      const childCleaned = cleanHtmlText(rawChild);
      if (childCleaned.startsWith(`(${targetSub})`) || new RegExp(`^\\s*\\(${targetSub}\\)\\s+`).test(childCleaned)) {
        matchedChildContainer = {
          outerHtml: rawChild,
          innerHtml: childContainer.innerHtml,
          startOffset: childContainer.startOffset,
          endOffset: childContainer.endOffset,
          tagName: tagName.toLowerCase(),
          elementId: childMatch[2].match(/id=["']([^"']+)["']/i)?.[1]
        };
        break;
      }
      childTagRegex.lastIndex = childContainer.endOffset;
    }
  }

  if (matchedChildContainer) {
    const rawOuter = html.slice(matchedChildContainer.startOffset, matchedChildContainer.endOffset);
    const cleaned = cleanHtmlText(rawOuter);
    return {
      standardOrActCode: actCode,
      paragraphOrSection: section,
      text: cleaned,
      extractionStatus: 'EXACT',
      isVerbatimText: true,
      sourceLocator: {
        document: 'Companies Act 1967',
        act: 'CoA1967',
        section: targetSec,
        subsection: targetSub,
        sourceNode: `${matchedChildContainer.tagName}#${matchedChildContainer.elementId || `${secContainer.elementId || `pr${targetSec}-`}${targetSub}`}`,
        elementId: matchedChildContainer.elementId || secContainer.elementId,
        heading: `Section ${targetSec}(${targetSub})`,
        startOffset: matchedChildContainer.startOffset,
        endOffset: matchedChildContainer.endOffset,
        boundary: {
          startOffset: matchedChildContainer.startOffset,
          endOffset: matchedChildContainer.endOffset
        },
        sourceType: 'HTML',
        canonicalLocator: `Companies Act 1967 > Section ${targetSec} > Subsection (${targetSub})`
      },
      extractionMethod: 'SSO_STRUCTURAL_CONTAINER_PARSER'
    };
  }

  // Strictly constrained Strategy 3:
  // Invariant: A whole section container must NEVER masquerade as an exact subsection.
  // If secContainer itself is a discrete provision node (not a section wrapper), begins with (${targetSub}),
  // and does NOT contain other subsections (e.g. (6), (1), etc.), accept as discrete provision node.
  const isSectionWrapper = !secContainer.elementId || secContainer.elementId.toLowerCase().startsWith(`sec${targetSec}`);
  const rawOuter = html.slice(secContainer.startOffset, secContainer.endOffset);
  const cleaned = cleanHtmlText(rawOuter);
  const startsWithTarget = cleaned.startsWith(`(${targetSub})`) || new RegExp(`^\\s*\\(${targetSub}\\)\\s+`).test(cleaned);
  const containsOtherSubsections = new RegExp(`\\((?!${targetSub}\\b)\\d+[a-zA-Z]?\\)`).test(cleaned);

  if (!isSectionWrapper && startsWithTarget && !containsOtherSubsections && cleaned.length > 20) {
    return {
      standardOrActCode: actCode,
      paragraphOrSection: section,
      text: cleaned,
      extractionStatus: 'EXACT',
      isVerbatimText: true,
      sourceLocator: {
        document: 'Companies Act 1967',
        act: 'CoA1967',
        section: targetSec,
        subsection: targetSub,
        sourceNode: `div#${secContainer.elementId || `pr${targetSec}-`}`,
        elementId: secContainer.elementId || `pr${targetSec}-`,
        heading: `Section ${targetSec}(${targetSub})`,
        startOffset: secContainer.startOffset,
        endOffset: secContainer.endOffset,
        boundary: {
          startOffset: secContainer.startOffset,
          endOffset: secContainer.endOffset
        },
        sourceType: 'HTML',
        canonicalLocator: `Companies Act 1967 > Section ${targetSec} > Subsection (${targetSub})`
      },
      extractionMethod: 'SSO_STRUCTURAL_CONTAINER_PARSER'
    };
  }

  // If no discrete subsection container or child container matching the requested subsection is found, fail closed!
  return {
    standardOrActCode: actCode,
    paragraphOrSection: section,
    text: '',
    extractionStatus: 'FAILED',
    sourceLocator: {},
    extractionMethod: 'SSO_STRUCTURAL_CONTAINER_PARSER',
    isVerbatimText: false
  };
}

/**
 * IRAS Corporate Income Tax Directive Extractor.
 * Extracts the published corporate tax rate or rebate text via structural container matching.
 */
export function extractIRASProvision(html: string, target: string = 'Section 43'): ProvisionExtraction {
  if (!html || typeof html !== 'string') {
    return {
      standardOrActCode: 'ITA1947',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'IRAS_STRUCTURAL_CONTAINER_PARSER'
    };
  }

  // Structural extraction: Locate target structural container div#cit-rate or div#cit-rate-section
  const container =
    extractBalancedContainer(html, 'div', /id=["']cit-rate(?:-section)?["']/i) ||
    extractBalancedContainer(html, 'div', /id=["']cit-rate/i);

  if (!container) {
    return {
      standardOrActCode: 'ITA1947',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'IRAS_STRUCTURAL_CONTAINER_PARSER'
    };
  }

  const rawOuter = html.slice(container.startOffset, container.endOffset);
  const cleaned = cleanHtmlText(rawOuter);
  if (cleaned.length < 10) {
    return {
      standardOrActCode: 'ITA1947',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'IRAS_STRUCTURAL_CONTAINER_PARSER',
      isVerbatimText: false
    };
  }

  return {
    standardOrActCode: 'ITA1947',
    paragraphOrSection: target,
    text: cleaned,
    extractionStatus: 'EXACT',
    isVerbatimText: true,
    sourceLocator: {
      document: 'IRAS Corporate Income Tax Guidance',
      act: 'ITA1947',
      section: '43',
      subsection: '1',
      sourceNode: `div#${container.elementId || 'cit-rate'}`,
      elementId: container.elementId || 'cit-rate-section',
      heading: 'Corporate Income Tax Headline Rate & Directive',
      startOffset: container.startOffset,
      endOffset: container.endOffset,
      boundary: {
        startOffset: container.startOffset,
        endOffset: container.endOffset
      },
      sourceType: 'HTML',
      canonicalLocator: 'Income Tax Act 1947 > Section 43 > Subsection (1)'
    },
    extractionMethod: 'IRAS_STRUCTURAL_CONTAINER_PARSER'
  };
}

/**
 * ACRA Small Company Audit Exemption Criteria Extractor.
 * Extracts the published revenue, asset, and employee thresholds directly from the structural container.
 */
export function extractACRAProvision(html: string, target: string = 'Thirteenth Schedule'): ProvisionExtraction {
  if (!html || typeof html !== 'string') {
    return {
      standardOrActCode: 'CoA1967',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'ACRA_STRUCTURAL_CONTAINER_PARSER'
    };
  }

  // Structural extraction: Locate target structural container div#small-company-criteria or div#small-company-exemption or table
  const container =
    extractBalancedContainer(html, 'div', /id=["']small-company-(?:criteria|exemption)["']/i) ||
    extractBalancedContainer(html, 'table', /id=["']small-company(?:-criteria)?["']/i);

  if (!container) {
    return {
      standardOrActCode: 'CoA1967',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'ACRA_STRUCTURAL_CONTAINER_PARSER'
    };
  }

  const rawOuter = html.slice(container.startOffset, container.endOffset);
  const cleaned = cleanHtmlText(rawOuter);
  if (cleaned.length < 15) {
    return {
      standardOrActCode: 'CoA1967',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'ACRA_STRUCTURAL_CONTAINER_PARSER',
      isVerbatimText: false
    };
  }

  return {
    standardOrActCode: 'CoA1967',
    paragraphOrSection: target,
    text: cleaned,
    extractionStatus: 'EXACT',
    isVerbatimText: true,
    sourceLocator: {
      document: 'ACRA Small Company Guidance',
      act: 'CoA1967',
      section: 'Thirteenth Schedule',
      subsection: 'Paragraph 2',
      sourceNode: `${container.tagName}#${container.elementId || 'small-company-criteria'}`,
      elementId: container.elementId || 'small-company-exemption',
      heading: 'Small Company Audit Exemption Criteria',
      startOffset: container.startOffset,
      endOffset: container.endOffset,
      boundary: {
        startOffset: container.startOffset,
        endOffset: container.endOffset
      },
      sourceType: 'HTML',
      canonicalLocator: 'Companies Act 1967 > Thirteenth Schedule > Paragraph 2'
    },
    extractionMethod: 'ACRA_STRUCTURAL_CONTAINER_PARSER'
  };
}

/**
 * MOM Employment Act Part IV Provision Extractor.
 * Extracts mandatory itemised payslip or statutory employment clauses from structural containers.
 */
export function extractMOMProvision(html: string, target: string = 'Part IV'): ProvisionExtraction {
  if (!html || typeof html !== 'string') {
    return {
      standardOrActCode: 'EA1968',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'MOM_STRUCTURAL_CONTAINER_PARSER',
      isVerbatimText: false
    };
  }

  const container =
    extractBalancedContainer(html, 'div', /id=["']itemised-payslips(?:-section)?["']/i);

  if (!container) {
    return {
      standardOrActCode: 'EA1968',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'MOM_STRUCTURAL_CONTAINER_PARSER',
      isVerbatimText: false
    };
  }

  const rawOuter = html.slice(container.startOffset, container.endOffset);
  const cleaned = cleanHtmlText(rawOuter);
  if (cleaned.length < 15) {
    return {
      standardOrActCode: 'EA1968',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'MOM_STRUCTURAL_CONTAINER_PARSER',
      isVerbatimText: false
    };
  }

  return {
    standardOrActCode: 'EA1968',
    paragraphOrSection: target,
    text: cleaned,
    extractionStatus: 'EXACT',
    isVerbatimText: true,
    sourceLocator: {
      document: 'MOM Employment Act Guidance',
      act: 'EA1968',
      section: 'Part IV',
      subsection: 'Section 95A',
      sourceNode: `div#${container.elementId || 'itemised-payslips'}`,
      elementId: container.elementId || 'itemised-payslips-section',
      heading: 'MOM Employment Act Mandatory Itemised Payslips',
      startOffset: container.startOffset,
      endOffset: container.endOffset,
      boundary: {
        startOffset: container.startOffset,
        endOffset: container.endOffset
      },
      sourceType: 'HTML',
      canonicalLocator: 'Employment Act 1968 > Part IV > Section 95A'
    },
    extractionMethod: 'MOM_STRUCTURAL_CONTAINER_PARSER'
  };
}

/**
 * CPF Ordinary Wage Ceiling & Contribution Schedule Extractor.
 * Extracts the published OW ceiling schedule from structural tables or containers.
 */
export function extractCPFProvision(html: string, target: string = 'First Schedule'): ProvisionExtraction {
  if (!html || typeof html !== 'string') {
    return {
      standardOrActCode: 'CPFA1953',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'CPF_STRUCTURAL_CONTAINER_PARSER',
      isVerbatimText: false
    };
  }

  const container =
    extractBalancedContainer(html, 'table', /id=["']ow-ceiling(?:-table)?["']/i) ||
    extractBalancedContainer(html, 'div', /id=["']ow-ceiling(?:-schedule)?["']/i);

  if (!container) {
    return {
      standardOrActCode: 'CPFA1953',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'CPF_STRUCTURAL_CONTAINER_PARSER',
      isVerbatimText: false
    };
  }

  const rawOuter = html.slice(container.startOffset, container.endOffset);
  const cleaned = cleanHtmlText(rawOuter);
  if (cleaned.length < 15) {
    return {
      standardOrActCode: 'CPFA1953',
      paragraphOrSection: target,
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'CPF_STRUCTURAL_CONTAINER_PARSER',
      isVerbatimText: false
    };
  }

  return {
    standardOrActCode: 'CPFA1953',
    paragraphOrSection: target,
    text: cleaned,
    extractionStatus: 'EXACT',
    isVerbatimText: true,
    sourceLocator: {
      document: 'CPF Contribution Rate Guidance',
      act: 'CPFA1953',
      section: 'First Schedule',
      subsection: 'Table',
      sourceNode: `${container.tagName}#${container.elementId || 'ow-ceiling-table'}`,
      elementId: container.elementId || 'ow-ceiling-schedule',
      heading: 'CPF Ordinary Wage Ceiling and Contribution Schedule',
      startOffset: container.startOffset,
      endOffset: container.endOffset,
      boundary: {
        startOffset: container.startOffset,
        endOffset: container.endOffset
      },
      sourceType: 'HTML',
      canonicalLocator: 'Central Provident Fund Act 1953 > First Schedule > Table'
    },
    extractionMethod: 'CPF_STRUCTURAL_CONTAINER_PARSER'
  };
}

/**
 * Frankfurter ECB Foreign Exchange Reference Rate Extractor.
 * Strictly reference data API (SFRS(I) accounting rules remain separated in standards layer).
 * Produces structured FX_OBSERVATION reference data.
 */
export function extractFrankfurterProvision(
  jsonText: string,
  base: string = 'SGD',
  symbols: string[] = ['USD', 'EUR'],
  _date?: string
): ProvisionExtraction & { fxObservation?: FxObservation } {
  if (!jsonText || typeof jsonText !== 'string') {
    return {
      standardOrActCode: 'FX_OBSERVATION',
      paragraphOrSection: 'SPOT_RATES_SGD',
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'JSON_KEY_EXTRACTION'
    };
  }

  try {
    const data = JSON.parse(jsonText);
    if (!data || typeof data !== 'object' || !data.rates || !data.base || !data.date || (base && data.base !== base)) {
      return {
        standardOrActCode: 'FX_OBSERVATION',
        paragraphOrSection: 'SPOT_RATES_SGD',
        text: '',
        extractionStatus: 'FAILED',
        sourceLocator: {},
        extractionMethod: 'JSON_KEY_EXTRACTION'
      };
    }

    const filteredRates: Record<string, number> = {};
    for (const s of symbols) {
      if (typeof data.rates[s] === 'number') {
        filteredRates[s] = data.rates[s];
      }
    }

    if (Object.keys(filteredRates).length === 0) {
      return {
        standardOrActCode: 'FX_OBSERVATION',
        paragraphOrSection: 'SPOT_RATES_SGD',
        text: '',
        extractionStatus: 'FAILED',
        sourceLocator: {},
        extractionMethod: 'JSON_KEY_EXTRACTION'
      };
    }

    const ratesSummary = Object.entries(filteredRates)
      .map(([sym, r]) => `1 ${data.base} = ${r} ${sym}`)
      .join(', ');

    const text = `European Central Bank Reference Spot Exchange Rates (Base: ${data.base}, Date: ${data.date}): ${ratesSummary}`;

    const fxObservation: FxObservation = {
      sourceAuthority: 'REFERENCE_API',
      provider: 'FRANKFURTER',
      date: data.date,
      base: data.base,
      rates: filteredRates
    };

    return {
      standardOrActCode: 'FX_OBSERVATION',
      paragraphOrSection: 'SPOT_RATES_SGD',
      text,
      extractionStatus: 'EXACT',
      isVerbatimText: false,
      sourceLocator: {
        document: 'Frankfurter ECB Reference Rates',
        act: 'FX_OBSERVATION',
        section: 'SPOT_RATES_SGD',
        sourceNode: 'json.rates',
        elementId: `rates-${data.date}`,
        heading: 'ECB_SPOT_OBSERVATION',
        startOffset: 0,
        endOffset: jsonText.length,
        boundary: {
          startOffset: 0,
          endOffset: jsonText.length
        },
        sourceType: 'JSON',
        canonicalLocator: `Frankfurter > rates > ${data.base} > ${data.date}`
      },
      extractionMethod: 'JSON_KEY_EXTRACTION',
      fxObservation
    };
  } catch {
    return {
      standardOrActCode: 'FX_OBSERVATION',
      paragraphOrSection: 'SPOT_RATES_SGD',
      text: '',
      extractionStatus: 'FAILED',
      sourceLocator: {},
      extractionMethod: 'JSON_KEY_EXTRACTION'
    };
  }
}

/**
 * Universal interface for official Singapore regulatory update discovery adapters.
 */
export interface IOfficialSourceAdapter {
  readonly authority: StatutoryAuthority;
  readonly sourceName: string;
  readonly canonicalBaseUrl: string;

  checkForUpdates(
    retriever: ControlledWebRetriever,
    currentSources?: AuthoritativeSourceRecord[]
  ): Promise<RegulatoryUpdatePackage | null>;
}

/**
 * Singapore Statutes Online (SSO / AGC) Update Discovery Adapter.
 */
export class SSOUpdateAdapter implements IOfficialSourceAdapter {
  public readonly authority = 'AGC' as const;
  public readonly sourceName = 'Singapore Statutes Online (SSO)';
  public readonly canonicalBaseUrl = 'https://sso.agc.gov.sg';

  public async checkForUpdates(
    retriever: ControlledWebRetriever,
    currentSources: AuthoritativeSourceRecord[] = []
  ): Promise<RegulatoryUpdatePackage | null> {
    const targetUrl = `${this.canonicalBaseUrl}/Act/COA1967`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3000,
      useCache: true
    });

    if (res.status !== 'SUCCESS' || !res.content) {
      return null;
    }

    const documentHash = computeSha256(res.content);
    const extraction = extractSSOProvision(res.content, 'CoA1967', 'Section 201(5)');

    // Fail-closed: unextractable content cannot create an update
    if (extraction.extractionStatus !== 'EXACT') {
      return null;
    }

    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);

    // Precision update gating: compare against active baseline
    const existingCoa = currentSources.find(
      (s) => s.standardOrActCode === extraction.standardOrActCode && (s.paragraphOrSection === extraction.paragraphOrSection || s.paragraphOrSection.includes('201'))
    );

    const existingHash = existingCoa?.provisionHash || existingCoa?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      // Provision is unchanged! Do not generate spurious update even if documentHash changed.
      return null;
    }

    const packageId = `SSO-COA-REV-${new Date().getFullYear()}`;
    const updateRecord: AuthoritativeSourceRecord = {
      id: `COA_1967_UPDATE_${Date.now().toString(36).toUpperCase()}`,
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Section 201(5)',
      documentTitle: 'Companies Act 1967 — Financial Statements True and Fair Requirement',
      authority: 'ACRA',
      authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
      sourcePublisher: 'Singapore Statutes Online (SSO) / AGC',
      legalOrStandardInstrument: 'Companies Act 1967',
      principleSummary: 'Mandatory true and fair requirement for financial statements',
      domain: 'ACRA_CORP',
      jurisdiction: 'Singapore',
      tags: ['companies act', 'audit', 'financial statements'],
      sourceType: 'AUTHORITATIVE_SOURCE',
      officialSourceUrl: targetUrl,
      sourceText: extraction.text, // Unabridged extracted text
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
      provenance: 'LIVE_PATCH',
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash, // Backward-compatible alias
      extractionStatus: 'EXACT',
      sourceLocator: extraction.sourceLocator
    };

    const amendment: AmendmentSummary = {
      recordId: updateRecord.id,
      title: 'Companies Act Legislative Revision',
      changeType: 'TEXT_CHANGE',
      summary: `Proactive revision detected from Singapore Statutes Online (provision hash: ${provisionHash.slice(0, 12)}...)`
    };

    const pkgWithoutHash: Omit<RegulatoryUpdatePackage, 'packageHash'> = {
      packageId,
      releaseDate: res.retrievedAt.split('T')[0],
      authority: 'AGC',
      updates: [updateRecord],
      amendments: [amendment]
    };

    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join('|||');

    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
}

/**
 * Inland Revenue Authority of Singapore (IRAS) Update Discovery Adapter.
 */
export class IRASUpdateAdapter implements IOfficialSourceAdapter {
  public readonly authority = 'IRAS' as const;
  public readonly sourceName = 'Inland Revenue Authority of Singapore (IRAS)';
  public readonly canonicalBaseUrl = 'https://www.iras.gov.sg';

  public async checkForUpdates(
    retriever: ControlledWebRetriever,
    currentSources: AuthoritativeSourceRecord[] = []
  ): Promise<RegulatoryUpdatePackage | null> {
    const targetUrl = `${this.canonicalBaseUrl}/taxes/corporate-income-tax/basics-of-corporate-income-tax/corporate-income-tax-rate-and-rebates`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3000,
      useCache: true
    });

    if (res.status !== 'SUCCESS' || !res.content) {
      return null;
    }

    const documentHash = computeSha256(res.content);
    const extraction = extractIRASProvision(res.content, 'Section 43');

    if (extraction.extractionStatus !== 'EXACT') {
      return null;
    }

    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);

    const existingIras = currentSources.find(
      (s) => s.authority === 'IRAS' && s.standardOrActCode === extraction.standardOrActCode && (s.paragraphOrSection === extraction.paragraphOrSection || s.paragraphOrSection.includes('43'))
    );

    const existingHash = existingIras?.provisionHash || existingIras?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }

    const packageId = `IRAS-TAX-REBATE-${new Date().getFullYear()}`;
    const updateRecord: AuthoritativeSourceRecord = {
      id: `IRAS_CIT_REBATE_${Date.now().toString(36).toUpperCase()}`,
      standardOrActCode: 'ITA1947',
      paragraphOrSection: 'Section 43',
      documentTitle: 'IRAS Corporate Income Tax Rate and Rebate Directive',
      authority: 'IRAS',
      authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
      sourcePublisher: 'Inland Revenue Authority of Singapore',
      legalOrStandardInstrument: 'IRAS Administrative Tax Guidance',
      principleSummary: 'Corporate income tax headline rate and headline rebate directives',
      domain: 'IRAS_TAX',
      jurisdiction: 'Singapore',
      tags: ['income tax', 'corporate tax', 'rebate'],
      sourceType: 'OFFICIAL_GUIDANCE',
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'OFFICIAL_GUIDANCE',
      provenance: 'LIVE_PATCH',
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash,
      extractionStatus: 'EXACT',
      sourceLocator: extraction.sourceLocator
    };

    const amendment: AmendmentSummary = {
      recordId: updateRecord.id,
      title: 'Corporate Income Tax Rebate Circular',
      changeType: 'RATE_CHANGE',
      summary: `Proactive tax rebate guidance detected from IRAS (provision hash: ${provisionHash.slice(0, 12)}...)`
    };

    const pkgWithoutHash: Omit<RegulatoryUpdatePackage, 'packageHash'> = {
      packageId,
      releaseDate: res.retrievedAt.split('T')[0],
      authority: 'IRAS',
      updates: [updateRecord],
      amendments: [amendment]
    };

    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join('|||');

    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
}

/**
 * Accounting and Corporate Regulatory Authority (ACRA) Update Discovery Adapter.
 */
export class ACRAUpdateAdapter implements IOfficialSourceAdapter {
  public readonly authority = 'ACRA' as const;
  public readonly sourceName = 'Accounting and Corporate Regulatory Authority (ACRA)';
  public readonly canonicalBaseUrl = 'https://www.acra.gov.sg';

  public async checkForUpdates(
    retriever: ControlledWebRetriever,
    currentSources: AuthoritativeSourceRecord[] = []
  ): Promise<RegulatoryUpdatePackage | null> {
    const targetUrl = `${this.canonicalBaseUrl}/legislation/companies-act-1967`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3000,
      useCache: true
    });

    if (res.status !== 'SUCCESS' || !res.content) {
      return null;
    }

    const documentHash = computeSha256(res.content);
    const extraction = extractACRAProvision(res.content, 'Thirteenth Schedule');

    if (extraction.extractionStatus !== 'EXACT') {
      return null;
    }

    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);

    const existingAcra = currentSources.find(
      (s) => s.authority === 'ACRA' && s.standardOrActCode === extraction.standardOrActCode && (s.paragraphOrSection === extraction.paragraphOrSection || s.paragraphOrSection.includes('Thirteenth Schedule') || s.paragraphOrSection.includes('205C') || s.paragraphOrSection.includes('Small Company'))
    );

    const existingHash = existingAcra?.provisionHash || existingAcra?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }

    const packageId = `ACRA-DIRECTIVE-${new Date().getFullYear()}`;
    const updateRecord: AuthoritativeSourceRecord = {
      id: `ACRA_DIRECTIVE_${Date.now().toString(36).toUpperCase()}`,
      standardOrActCode: 'CoA1967',
      paragraphOrSection: 'Thirteenth Schedule',
      documentTitle: 'ACRA Small Company Audit Exemption Criteria and Filing Requirements',
      authority: 'ACRA',
      authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
      sourcePublisher: 'Accounting and Corporate Regulatory Authority',
      legalOrStandardInstrument: 'ACRA Practice Direction / Guidance',
      principleSummary: 'Small company audit exemption criteria and annual filing obligations',
      domain: 'ACRA_CORP',
      jurisdiction: 'Singapore',
      tags: ['companies act', 'small company', 'audit exemption'],
      sourceType: 'OFFICIAL_GUIDANCE',
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'OFFICIAL_GUIDANCE',
      provenance: 'LIVE_PATCH',
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash,
      extractionStatus: 'EXACT',
      sourceLocator: extraction.sourceLocator
    };

    const amendment: AmendmentSummary = {
      recordId: updateRecord.id,
      title: 'ACRA Regulatory Directive Update',
      changeType: 'THRESHOLD_CHANGE',
      summary: `Proactive ACRA statutory directive update detected (provision hash: ${provisionHash.slice(0, 12)}...)`
    };

    const pkgWithoutHash: Omit<RegulatoryUpdatePackage, 'packageHash'> = {
      packageId,
      releaseDate: res.retrievedAt.split('T')[0],
      authority: 'ACRA',
      updates: [updateRecord],
      amendments: [amendment]
    };

    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join('|||');

    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
}

/**
 * Ministry of Manpower (MOM) Update Discovery Adapter.
 */
export class MOMUpdateAdapter implements IOfficialSourceAdapter {
  public readonly authority = 'MOM' as const;
  public readonly sourceName = 'Ministry of Manpower (MOM)';
  public readonly canonicalBaseUrl = 'https://www.mom.gov.sg';

  public async checkForUpdates(
    retriever: ControlledWebRetriever,
    currentSources: AuthoritativeSourceRecord[] = []
  ): Promise<RegulatoryUpdatePackage | null> {
    const targetUrl = `${this.canonicalBaseUrl}/employment-practices/employment-act`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3000,
      useCache: true
    });

    if (res.status !== 'SUCCESS' || !res.content) {
      return null;
    }

    const documentHash = computeSha256(res.content);
    const extraction = extractMOMProvision(res.content, 'Part IV');

    if (extraction.extractionStatus !== 'EXACT') {
      return null;
    }

    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);

    const existingMom = currentSources.find(
      (s) => s.authority === 'MOM' && (s.paragraphOrSection === extraction.paragraphOrSection || s.paragraphOrSection.includes('Part IV') || s.paragraphOrSection.includes('Payslip'))
    );

    const existingHash = existingMom?.provisionHash || existingMom?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }

    const packageId = `MOM-EA-UPDATE-${new Date().getFullYear()}`;
    const updateRecord: AuthoritativeSourceRecord = {
      id: `MOM_EA_UPDATE_${Date.now().toString(36).toUpperCase()}`,
      standardOrActCode: 'EA1968',
      paragraphOrSection: 'Part IV',
      documentTitle: 'MOM Employment Act Statutory Requirements & Itemised Payslip Rules',
      authority: 'MOM',
      authorityName: 'Ministry of Manpower (MOM)',
      sourcePublisher: 'Ministry of Manpower',
      legalOrStandardInstrument: 'MOM Employment Practices Guidance',
      principleSummary: 'Statutory employment terms, mandatory itemised payslips and statutory leave',
      domain: 'MOM_EMPLOYMENT',
      jurisdiction: 'Singapore',
      tags: ['employment act', 'payslip', 'statutory leave'],
      sourceType: 'OFFICIAL_GUIDANCE',
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'OFFICIAL_GUIDANCE',
      provenance: 'LIVE_PATCH',
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash,
      extractionStatus: 'EXACT',
      sourceLocator: extraction.sourceLocator
    };

    const amendment: AmendmentSummary = {
      recordId: updateRecord.id,
      title: 'MOM Employment Act Amendment',
      changeType: 'TEXT_CHANGE',
      summary: `Proactive statutory employment update detected from MOM (provision hash: ${provisionHash.slice(0, 12)}...)`
    };

    const pkgWithoutHash: Omit<RegulatoryUpdatePackage, 'packageHash'> = {
      packageId,
      releaseDate: res.retrievedAt.split('T')[0],
      authority: 'MOM',
      updates: [updateRecord],
      amendments: [amendment]
    };

    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join('|||');

    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
}

/**
 * Central Provident Fund (CPF) Board Update Discovery Adapter.
 */
export class CPFUpdateAdapter implements IOfficialSourceAdapter {
  public readonly authority = 'CPF' as const;
  public readonly sourceName = 'Central Provident Fund Board (CPF)';
  public readonly canonicalBaseUrl = 'https://www.cpf.gov.sg';

  public async checkForUpdates(
    retriever: ControlledWebRetriever,
    currentSources: AuthoritativeSourceRecord[] = []
  ): Promise<RegulatoryUpdatePackage | null> {
    const targetUrl = `${this.canonicalBaseUrl}/employer/employer-obligations/cpf-contribution-rates`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3000,
      useCache: true
    });

    if (res.status !== 'SUCCESS' || !res.content) {
      return null;
    }

    const documentHash = computeSha256(res.content);
    const extraction = extractCPFProvision(res.content, 'First Schedule');

    if (extraction.extractionStatus !== 'EXACT') {
      return null;
    }

    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);

    const existingCpf = currentSources.find(
      (s) => s.authority === 'CPF' && (s.paragraphOrSection === extraction.paragraphOrSection || s.paragraphOrSection.includes('First Schedule') || s.paragraphOrSection.includes('Ceiling'))
    );

    const existingHash = existingCpf?.provisionHash || existingCpf?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }

    const packageId = `CPF-OW-CEILING-${new Date().getFullYear()}`;
    const updateRecord: AuthoritativeSourceRecord = {
      id: `CPF_CEILING_UPDATE_${Date.now().toString(36).toUpperCase()}`,
      standardOrActCode: 'CPFA1953',
      paragraphOrSection: 'First Schedule',
      documentTitle: 'CPF Ordinary Wage Ceiling and Contribution Rate Revision',
      authority: 'CPF',
      authorityName: 'Central Provident Fund Board (CPF)',
      sourcePublisher: 'Central Provident Fund Board',
      legalOrStandardInstrument: 'CPF Board Contribution Rate Guidance',
      principleSummary: 'Ordinary Wage ceiling and tiered contribution schedules',
      domain: 'CPF_BOARD',
      jurisdiction: 'Singapore',
      tags: ['cpf', 'wage ceiling', 'contributions'],
      sourceType: 'OFFICIAL_GUIDANCE',
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'OFFICIAL_GUIDANCE',
      provenance: 'LIVE_PATCH',
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash,
      extractionStatus: 'EXACT',
      sourceLocator: extraction.sourceLocator
    };

    const amendment: AmendmentSummary = {
      recordId: updateRecord.id,
      title: 'CPF Ordinary Wage Ceiling Revision',
      changeType: 'THRESHOLD_CHANGE',
      summary: `Proactive contribution schedule revision detected from CPF Board (provision hash: ${provisionHash.slice(0, 12)}...)`
    };

    const pkgWithoutHash: Omit<RegulatoryUpdatePackage, 'packageHash'> = {
      packageId,
      releaseDate: res.retrievedAt.split('T')[0],
      authority: 'CPF',
      updates: [updateRecord],
      amendments: [amendment]
    };

    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join('|||');

    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
}

/**
 * European Central Bank (ECB) / Frankfurter Foreign Exchange Reference Rate Adapter.
 * Strictly reference data API (SFRS(I) accounting rules remain separated in standards layer).
 */
export class FrankfurterReferenceAdapter implements IOfficialSourceAdapter {
  public readonly authority = 'REFERENCE_API' as const;
  public readonly sourceName = 'Frankfurter ECB FX Reference API';
  public readonly canonicalBaseUrl = 'https://api.frankfurter.dev';

  public async checkForUpdates(
    retriever: ControlledWebRetriever,
    currentSources: AuthoritativeSourceRecord[] = []
  ): Promise<RegulatoryUpdatePackage | null> {
    const targetUrl = `${this.canonicalBaseUrl}/v1/latest?base=SGD&symbols=USD,EUR,GBP,CNY`;
    const res = await retriever.fetchOfficialSource(targetUrl, {
      timeoutMs: 3000,
      ttlMs: 3_600_000, // 1 hour TTL
      useCache: true
    });

    if (res.status !== 'SUCCESS' || !res.content) {
      return null;
    }

    const documentHash = computeSha256(res.content);
    const extraction = extractFrankfurterProvision(res.content, 'SGD', ['USD', 'EUR', 'GBP', 'CNY']);

    if (extraction.extractionStatus !== 'EXACT') {
      return null;
    }

    const provisionHash = computeProvisionHash(extraction.standardOrActCode, extraction.paragraphOrSection, extraction.text);

    const existingFx = currentSources.find(
      (s) => s.authority === 'REFERENCE_API' && (s.id.startsWith('ECB_FX_SPOT_') || s.standardOrActCode === 'FX_OBSERVATION')
    );

    const existingHash = existingFx?.provisionHash || existingFx?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }

    const packageId = `ECB-FX-SGD-${new Date().toISOString().split('T')[0]}`;
    const updateRecord: AuthoritativeSourceRecord = {
      id: `ECB_FX_SPOT_${new Date().toISOString().split('T')[0].replace(/-/g, '')}`,
      standardOrActCode: 'FX_OBSERVATION',
      paragraphOrSection: 'SPOT_RATES_SGD',
      documentTitle: 'Frankfurter Official ECB Spot Foreign Exchange Rates (SGD Base)',
      authority: 'REFERENCE_API',
      authorityName: 'European Central Bank Reference Rate API',
      sourcePublisher: 'European Central Bank / Frankfurter API',
      legalOrStandardInstrument: 'ECB Foreign Exchange Reference Data',
      principleSummary: 'Daily spot exchange reference rates for SGD currency pairs',
      domain: 'ACCOUNTING_SFRS',
      jurisdiction: 'International / Singapore',
      tags: ['fx', 'exchange rate', 'spot rate'],
      sourceType: 'CURATED_SUMMARY',
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: false,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'CURATED_SUMMARY',
      provenance: 'LIVE_PATCH',
      version: packageId,
      documentHash,
      provisionHash,
      contentHash: provisionHash,
      extractionStatus: 'EXACT',
      sourceLocator: extraction.sourceLocator,
      fxObservation: extraction.fxObservation
    };

    const amendment: AmendmentSummary = {
      recordId: updateRecord.id,
      title: 'Daily Foreign Exchange Spot Rate Update',
      changeType: 'RATE_CHANGE',
      summary: `Proactive daily FX reference spot rates fetched from ECB via Frankfurter (SGD base)`
    };

    const pkgWithoutHash: Omit<RegulatoryUpdatePackage, 'packageHash'> = {
      packageId,
      releaseDate: res.retrievedAt.split('T')[0],
      authority: 'REFERENCE_API',
      updates: [updateRecord],
      amendments: [amendment]
    };

    const payload = [
      pkgWithoutHash.packageId,
      pkgWithoutHash.releaseDate,
      pkgWithoutHash.authority,
      ...pkgWithoutHash.updates.map((u) => `${u.id}:${u.standardOrActCode}:${u.paragraphOrSection}:${u.sourceText}`)
    ].join('|||');

    return {
      ...pkgWithoutHash,
      packageHash: computeSha256(payload)
    };
  }
}
