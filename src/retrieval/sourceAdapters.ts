import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import type { RegulatoryUpdatePackage, AmendmentSummary } from './liveRegulatoryFeed';
import type { ControlledWebRetriever } from './controlledWebRetriever';
import type { StatutoryAuthority } from '../types/accounting';
import { computeSha256 } from '../standards/sourceVersioning';

/**
 * Universal interface for official Singapore regulatory update discovery adapters.
 */
export interface IOfficialSourceAdapter {
  readonly authority: StatutoryAuthority;
  readonly sourceName: string;
  readonly canonicalBaseUrl: string;

  /**
   * Proactively checks the remote official source for new statutory amendments or revisions.
   * Returns a candidate RegulatoryUpdatePackage if new updates are discovered, or null if up to date.
   */
  checkForUpdates(
    retriever: ControlledWebRetriever,
    currentSources?: AuthoritativeSourceRecord[]
  ): Promise<RegulatoryUpdatePackage | null>;
}

/**
 * Singapore Statutes Online (SSO / AGC) Update Discovery Adapter.
 * Monitors official legislation on sso.agc.gov.sg (e.g., Companies Act 1967, Income Tax Act 1947).
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

    // Check if remote hash matches any existing local source for CoA1967
    const existingCoa = currentSources.find(
      (s) => s.standardOrActCode === 'CoA1967' || s.id.startsWith('COA_')
    );

    const isDifferent = !existingCoa || (existingCoa.contentHash && existingCoa.contentHash !== res.contentHash);
    if (!isDifferent) {
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
      sourceText: res.content.length > 500 ? res.content.slice(0, 500) + '...' : res.content,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
      provenance: 'LIVE_PATCH',
      version: packageId,
      contentHash: res.contentHash
    };

    const amendment: AmendmentSummary = {
      recordId: updateRecord.id,
      title: 'Companies Act Legislative Revision',
      changeType: 'TEXT_CHANGE',
      summary: `Proactive revision detected from Singapore Statutes Online (content hash: ${res.contentHash?.slice(0, 12)}...)`
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
 * Monitors official corporate tax rebate circulars and GST rate updates on iras.gov.sg.
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

    const existingIras = currentSources.find(
      (s) => s.authority === 'IRAS' && s.standardOrActCode === 'ITA1947'
    );

    const isDifferent = !existingIras || (existingIras.contentHash && existingIras.contentHash !== res.contentHash);
    if (!isDifferent) {
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
      sourceText: res.content.length > 500 ? res.content.slice(0, 500) + '...' : res.content,
      isVerbatimText: false,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
      provenance: 'LIVE_PATCH',
      version: packageId,
      contentHash: res.contentHash
    };

    const amendment: AmendmentSummary = {
      recordId: updateRecord.id,
      title: 'Corporate Income Tax Rebate Circular',
      changeType: 'RATE_CHANGE',
      summary: `Proactive tax rebate guidance detected from IRAS (content hash: ${res.contentHash?.slice(0, 12)}...)`
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
 * Monitors small company audit thresholds and filing directives on acra.gov.sg.
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

    const existingAcra = currentSources.find(
      (s) => s.authority === 'ACRA' && s.standardOrActCode === 'CoA1967'
    );

    const isDifferent = !existingAcra || (existingAcra.contentHash && existingAcra.contentHash !== res.contentHash);
    if (!isDifferent) {
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
      sourceText: res.content.length > 500 ? res.content.slice(0, 500) + '...' : res.content,
      isVerbatimText: false,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
      provenance: 'LIVE_PATCH',
      version: packageId,
      contentHash: res.contentHash
    };

    const amendment: AmendmentSummary = {
      recordId: updateRecord.id,
      title: 'ACRA Regulatory Directive Update',
      changeType: 'THRESHOLD_CHANGE',
      summary: `Proactive ACRA statutory directive update detected (content hash: ${res.contentHash?.slice(0, 12)}...)`
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
 * Monitors Employment Act mandatory payroll items, leave entitlements, and retrenchment guidelines.
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

    const existingMom = currentSources.find(
      (s) => s.authority === 'MOM' || s.standardOrActCode === 'EA1968'
    );

    const isDifferent = !existingMom || (existingMom.contentHash && existingMom.contentHash !== res.contentHash);
    if (!isDifferent) {
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
      sourceText: res.content.length > 500 ? res.content.slice(0, 500) + '...' : res.content,
      isVerbatimText: false,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
      provenance: 'LIVE_PATCH',
      version: packageId,
      contentHash: res.contentHash
    };

    const amendment: AmendmentSummary = {
      recordId: updateRecord.id,
      title: 'MOM Employment Act Amendment',
      changeType: 'TEXT_CHANGE',
      summary: `Proactive statutory employment update detected from MOM (content hash: ${res.contentHash?.slice(0, 12)}...)`
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
 * Monitors Ordinary Wage (OW) ceilings ($6,800 -> $7,400 -> $8,000) and contribution schedule revisions.
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

    const existingCpf = currentSources.find(
      (s) => s.authority === 'CPF' || s.standardOrActCode === 'CPFA1953'
    );

    const isDifferent = !existingCpf || (existingCpf.contentHash && existingCpf.contentHash !== res.contentHash);
    if (!isDifferent) {
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
      sourceText: res.content.length > 500 ? res.content.slice(0, 500) + '...' : res.content,
      isVerbatimText: false,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
      provenance: 'LIVE_PATCH',
      version: packageId,
      contentHash: res.contentHash
    };

    const amendment: AmendmentSummary = {
      recordId: updateRecord.id,
      title: 'CPF Ordinary Wage Ceiling Revision',
      changeType: 'THRESHOLD_CHANGE',
      summary: `Proactive contribution schedule revision detected from CPF Board (content hash: ${res.contentHash?.slice(0, 12)}...)`
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
 * Fetches verified multi-currency spot exchange rates with SGD base for international reporting.
 */
export class FrankfurterReferenceAdapter implements IOfficialSourceAdapter {
  public readonly authority = 'REFERENCE_API' as const;
  public readonly sourceName = 'Frankfurter ECB FX Reference API';
  public readonly canonicalBaseUrl = 'https://api.frankfurter.dev';

  public async checkForUpdates(
    retriever: ControlledWebRetriever,
    _currentSources: AuthoritativeSourceRecord[] = []
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
      sourceText: res.content,
      isVerbatimText: true,
      lastVerifiedDate: res.retrievedAt.split('T')[0],
      sourceStatus: 'NEEDS_REVIEW',
      evidenceTier: 'PRIMARY_SOURCE',
      provenance: 'LIVE_PATCH',
      version: packageId,
      contentHash: res.contentHash
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
