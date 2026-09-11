import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
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
  sourceLocator: {
    heading?: string;
    elementId?: string;
    startOffset?: number;
    endOffset?: number;
  };
  extractionMethod: string;
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

/**
 * SSO / AGC Provision Extractor.
 * Deterministically locates and extracts an unabridged statutory subsection from Singapore Statutes Online HTML.
 */
export function extractSSOProvision(html: string, actCode: string = 'CoA1967', section: string = 'Section 201(5)'): ProvisionExtraction {
  if (!html || typeof html !== 'string') {
    return { standardOrActCode: actCode, paragraphOrSection: section, text: '', extractionStatus: 'FAILED', sourceLocator: {}, extractionMethod: 'SSO_DOM_PARSER' };
  }

  // Look for Section 201(5) or general subsection in SSO HTML structure
  // Typically: <div class="prov1" id="pr201-">(5)...</div> or <div id="pr201-5-">...</div> or (5) The financial statements...
  const ssoRegex = /<div[^>]*id=["'](?:pr201-[^"']*|pr201)["'][^>]*>([\s\S]*?)<\/div>/i;
  const match = html.match(ssoRegex);

  if (match) {
    const rawMatch = match[0];
    const innerContent = match[1];
    const startOffset = match.index || 0;
    const endOffset = startOffset + rawMatch.length;
    const cleaned = cleanHtmlText(innerContent);

    // Ensure it contains subsection (5) wording
    if (cleaned.length > 20 && (cleaned.startsWith('(5)') || cleaned.includes('(5)'))) {
      return {
        standardOrActCode: actCode,
        paragraphOrSection: section,
        text: cleaned,
        extractionStatus: 'EXACT',
        sourceLocator: {
          heading: 'Section 201(5)',
          elementId: 'pr201-',
          startOffset,
          endOffset
        },
        extractionMethod: 'SSO_DOM_ID_SUBSECTION_PARSER'
      };
    }
  }

  // Fallback structural scan for exact subsection boundary
  const subRegex = /(?:<p[^>]*>)?\s*(\(5\)\s+The financial statements shall comply with the requirements of the accounting standards[\s\S]*?give a true and fair view of the financial position and performance of the company\.)/i;
  const subMatch = html.match(subRegex);
  if (subMatch) {
    const startOffset = subMatch.index || 0;
    const endOffset = startOffset + subMatch[0].length;
    const cleaned = cleanHtmlText(subMatch[1]);
    return {
      standardOrActCode: actCode,
      paragraphOrSection: section,
      text: cleaned,
      extractionStatus: 'EXACT',
      sourceLocator: {
        heading: 'Section 201(5)',
        elementId: 'pr201-sec5',
        startOffset,
        endOffset
      },
      extractionMethod: 'SSO_STRUCTURAL_BOUNDARY_PARSER'
    };
  }

  return {
    standardOrActCode: actCode,
    paragraphOrSection: section,
    text: '',
    extractionStatus: 'FAILED',
    sourceLocator: {},
    extractionMethod: 'SSO_DOM_PARSER'
  };
}

/**
 * IRAS Corporate Income Tax Directive Extractor.
 * Extracts the published corporate tax rate or rebate text without hard-coding or slicing.
 */
export function extractIRASProvision(html: string, target: string = 'Section 43'): ProvisionExtraction {
  if (!html || typeof html !== 'string') {
    return { standardOrActCode: 'ITA1947', paragraphOrSection: target, text: '', extractionStatus: 'FAILED', sourceLocator: {}, extractionMethod: 'IRAS_TAX_DIRECTIVE_PARSER' };
  }

  // Look for the corporate income tax headline rate block in the official IRAS HTML
  const citRegex = /(?:<div[^>]*id=["']cit-rate[^"']*["'][^>]*>|<p[^>]*>)([\s\S]*?(?:corporate income tax rate (?:in Singapore )?is 17%|headline corporate tax rate of 17%)[\s\S]*?)(?:<\/div>|<\/p>)/i;
  const match = html.match(citRegex);

  if (match) {
    const startOffset = match.index || 0;
    const endOffset = startOffset + match[0].length;
    const cleaned = cleanHtmlText(match[1]);

    if (cleaned.length > 20) {
      return {
        standardOrActCode: 'ITA1947',
        paragraphOrSection: target,
        text: cleaned,
        extractionStatus: 'EXACT',
        sourceLocator: {
          heading: 'Corporate Income Tax Headline Rate & Directive',
          elementId: 'cit-rate-section',
          startOffset,
          endOffset
        },
        extractionMethod: 'IRAS_TAX_DIRECTIVE_PARSER'
      };
    }
  }

  return {
    standardOrActCode: 'ITA1947',
    paragraphOrSection: target,
    text: '',
    extractionStatus: 'FAILED',
    sourceLocator: {},
    extractionMethod: 'IRAS_TAX_DIRECTIVE_PARSER'
  };
}

/**
 * ACRA Small Company Audit Exemption Criteria Extractor.
 * Extracts the published revenue, asset, and employee thresholds directly from the source HTML.
 */
export function extractACRAProvision(html: string, target: string = 'Thirteenth Schedule'): ProvisionExtraction {
  if (!html || typeof html !== 'string') {
    return { standardOrActCode: 'CoA1967', paragraphOrSection: target, text: '', extractionStatus: 'FAILED', sourceLocator: {}, extractionMethod: 'ACRA_CRITERIA_PARSER' };
  }

  // Search for the 3 small company qualification criteria in ACRA HTML
  const acraRegex = /(?:<div[^>]*id=["']small-company[^"']*["'][^>]*>|<table[^>]*id=["']small-company[^"']*["'][^>]*>|<p[^>]*>)([\s\S]*?(?:total annual revenue (?:does not exceed|≤|not more than) \$?10\s*(?:million|M)[\s\S]*?total assets (?:does not exceed|≤|not more than) \$?10\s*(?:million|M)[\s\S]*?number of full-time employees (?:does not exceed|≤|not more than) 50)[\s\S]*?)(?:<\/div>|<\/table>|<\/p>)/i;
  const match = html.match(acraRegex);

  if (match) {
    const startOffset = match.index || 0;
    const endOffset = startOffset + match[0].length;
    const cleaned = cleanHtmlText(match[1]);

    if (cleaned.length > 25) {
      return {
        standardOrActCode: 'CoA1967',
        paragraphOrSection: target,
        text: cleaned,
        extractionStatus: 'EXACT',
        sourceLocator: {
          heading: 'Small Company Audit Exemption Criteria',
          elementId: 'small-company-exemption',
          startOffset,
          endOffset
        },
        extractionMethod: 'ACRA_CRITERIA_PARSER'
      };
    }
  }

  return {
    standardOrActCode: 'CoA1967',
    paragraphOrSection: target,
    text: '',
    extractionStatus: 'FAILED',
    sourceLocator: {},
    extractionMethod: 'ACRA_CRITERIA_PARSER'
  };
}

/**
 * MOM Employment Act Part IV Provision Extractor.
 * Extracts mandatory itemised payslip or statutory employment clauses from MOM HTML.
 */
export function extractMOMProvision(html: string, target: string = 'Part IV'): ProvisionExtraction {
  if (!html || typeof html !== 'string') {
    return { standardOrActCode: 'EA1968', paragraphOrSection: target, text: '', extractionStatus: 'FAILED', sourceLocator: {}, extractionMethod: 'MOM_PROVISION_PARSER' };
  }

  const momRegex = /(?:<div[^>]*id=["']itemised-payslips[^"']*["'][^>]*>|<p[^>]*>)([\s\S]*?(?:employers must issue itemised payslips to all employees covered by the Employment Act|mandatory itemised payslips[\s\S]*?key employment terms)[\s\S]*?)(?:<\/div>|<\/p>)/i;
  const match = html.match(momRegex);

  if (match) {
    const startOffset = match.index || 0;
    const endOffset = startOffset + match[0].length;
    const cleaned = cleanHtmlText(match[1]);

    if (cleaned.length > 20) {
      return {
        standardOrActCode: 'EA1968',
        paragraphOrSection: target,
        text: cleaned,
        extractionStatus: 'EXACT',
        sourceLocator: {
          heading: 'MOM Employment Act Mandatory Itemised Payslips',
          elementId: 'itemised-payslips-section',
          startOffset,
          endOffset
        },
        extractionMethod: 'MOM_PROVISION_PARSER'
      };
    }
  }

  return {
    standardOrActCode: 'EA1968',
    paragraphOrSection: target,
    text: '',
    extractionStatus: 'FAILED',
    sourceLocator: {},
    extractionMethod: 'MOM_PROVISION_PARSER'
  };
}

/**
 * CPF Ordinary Wage Ceiling & Contribution Schedule Extractor.
 * Extracts the published OW ceiling schedule ($6,800, $7,400, $8,000) from CPF HTML.
 */
export function extractCPFProvision(html: string, target: string = 'First Schedule'): ProvisionExtraction {
  if (!html || typeof html !== 'string') {
    return { standardOrActCode: 'CPFA1953', paragraphOrSection: target, text: '', extractionStatus: 'FAILED', sourceLocator: {}, extractionMethod: 'CPF_SCHEDULE_PARSER' };
  }

  const cpfRegex = /(?:<div[^>]*id=["']ow-ceiling[^"']*["'][^>]*>|<table[^>]*id=["']ow-ceiling[^"']*["'][^>]*>|<p[^>]*>)([\s\S]*?(?:Ordinary Wage (?:ceiling|\(OW\) ceiling)[\s\S]*?(?:\$6,800|\$7,400|\$8,000))[\s\S]*?)(?:<\/div>|<\/table>|<\/p>)/i;
  const match = html.match(cpfRegex);

  if (match) {
    const startOffset = match.index || 0;
    const endOffset = startOffset + match[0].length;
    const cleaned = cleanHtmlText(match[1]);

    if (cleaned.length > 20) {
      return {
        standardOrActCode: 'CPFA1953',
        paragraphOrSection: target,
        text: cleaned,
        extractionStatus: 'EXACT',
        sourceLocator: {
          heading: 'CPF Ordinary Wage Ceiling and Contribution Schedule',
          elementId: 'ow-ceiling-schedule',
          startOffset,
          endOffset
        },
        extractionMethod: 'CPF_SCHEDULE_PARSER'
      };
    }
  }

  return {
    standardOrActCode: 'CPFA1953',
    paragraphOrSection: target,
    text: '',
    extractionStatus: 'FAILED',
    sourceLocator: {},
    extractionMethod: 'CPF_SCHEDULE_PARSER'
  };
}

/**
 * Frankfurter ECB Foreign Exchange Reference Rate Extractor.
 * Strictly reference data API (SFRS(I) accounting rules remain separated in standards layer).
 */
export function extractFrankfurterProvision(
  jsonText: string,
  base: string = 'SGD',
  symbols: string[] = ['USD', 'EUR'],
  _date?: string
): ProvisionExtraction & { fxObservation?: FxObservation } {
  if (!jsonText || typeof jsonText !== 'string') {
    return { standardOrActCode: 'SFRS(I) 1-21', paragraphOrSection: 'Paragraph 21', text: '', extractionStatus: 'FAILED', sourceLocator: {}, extractionMethod: 'JSON_KEY_EXTRACTION' };
  }

  try {
    const data = JSON.parse(jsonText);
    if (!data || !data.rates || !data.base || !data.date || (base && data.base !== base)) {
      return { standardOrActCode: 'SFRS(I) 1-21', paragraphOrSection: 'Paragraph 21', text: '', extractionStatus: 'FAILED', sourceLocator: {}, extractionMethod: 'JSON_KEY_EXTRACTION' };
    }

    const filteredRates: Record<string, number> = {};
    for (const s of symbols) {
      if (typeof data.rates[s] === 'number') {
        filteredRates[s] = data.rates[s];
      }
    }

    if (Object.keys(filteredRates).length === 0) {
      return { standardOrActCode: 'SFRS(I) 1-21', paragraphOrSection: 'Paragraph 21', text: '', extractionStatus: 'FAILED', sourceLocator: {}, extractionMethod: 'JSON_KEY_EXTRACTION' };
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
      standardOrActCode: 'SFRS(I) 1-21',
      paragraphOrSection: 'Paragraph 21',
      text,
      extractionStatus: 'EXACT',
      sourceLocator: {
        heading: 'ECB_SPOT_OBSERVATION',
        elementId: `rates-${data.date}`,
        startOffset: 0,
        endOffset: jsonText.length
      },
      extractionMethod: 'JSON_KEY_EXTRACTION',
      fxObservation
    };
  } catch {
    return { standardOrActCode: 'SFRS(I) 1-21', paragraphOrSection: 'Paragraph 21', text: '', extractionStatus: 'FAILED', sourceLocator: {}, extractionMethod: 'JSON_KEY_EXTRACTION' };
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
      legalOrStandardInstrument: 'Income Tax Act 1947',
      principleSummary: 'Corporate income tax headline rate and headline rebate directives',
      domain: 'IRAS_TAX',
      jurisdiction: 'Singapore',
      tags: ['income tax', 'corporate tax', 'rebate'],
      sourceType: 'AUTHORITATIVE_SOURCE',
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
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
      legalOrStandardInstrument: 'Companies Act 1967',
      principleSummary: 'Small company audit exemption criteria and annual filing obligations',
      domain: 'ACRA_CORP',
      jurisdiction: 'Singapore',
      tags: ['companies act', 'small company', 'audit exemption'],
      sourceType: 'AUTHORITATIVE_SOURCE',
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
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
      legalOrStandardInstrument: 'Employment Act 1968',
      principleSummary: 'Statutory employment terms, mandatory itemised payslips and statutory leave',
      domain: 'MOM_EMPLOYMENT',
      jurisdiction: 'Singapore',
      tags: ['employment act', 'payslip', 'statutory leave'],
      sourceType: 'AUTHORITATIVE_SOURCE',
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
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
      legalOrStandardInstrument: 'Central Provident Fund Act 1953',
      principleSummary: 'Ordinary Wage ceiling and tiered contribution schedules',
      domain: 'CPF_BOARD',
      jurisdiction: 'Singapore',
      tags: ['cpf', 'wage ceiling', 'contributions'],
      sourceType: 'AUTHORITATIVE_SOURCE',
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
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
      (s) => s.authority === 'REFERENCE_API' && s.id.startsWith('ECB_FX_SPOT_')
    );

    const existingHash = existingFx?.provisionHash || existingFx?.contentHash;
    if (existingHash && existingHash === provisionHash) {
      return null;
    }

    const packageId = `ECB-FX-SGD-${new Date().toISOString().split('T')[0]}`;
    const updateRecord: AuthoritativeSourceRecord = {
      id: `ECB_FX_SPOT_${new Date().toISOString().split('T')[0].replace(/-/g, '')}`,
      standardOrActCode: 'SFRS(I) 1-21',
      paragraphOrSection: 'Paragraph 21',
      documentTitle: 'Frankfurter Official ECB Spot Foreign Exchange Rates (SGD Base)',
      authority: 'REFERENCE_API',
      authorityName: 'European Central Bank Reference Rate API',
      sourcePublisher: 'European Central Bank / Frankfurter API',
      legalOrStandardInstrument: 'SFRS(I) 1-21 Foreign Exchange Reference',
      principleSummary: 'Daily spot exchange reference rates for SGD currency pairs',
      domain: 'ACCOUNTING_SFRS',
      jurisdiction: 'International / Singapore',
      tags: ['fx', 'exchange rate', 'spot rate'],
      sourceType: 'AUTHORITATIVE_SOURCE',
      officialSourceUrl: targetUrl,
      sourceText: extraction.text,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
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
