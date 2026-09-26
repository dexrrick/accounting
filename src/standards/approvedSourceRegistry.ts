/**
 * Source-selection policy for Singapore regulatory answers.
 *
 * This is a policy registry, not a collection of legal conclusions.  It lets
 * retrieval and presentation distinguish binding instruments from the
 * official explanatory FAQs hosted on Ask.gov.sg.
 */
export type ApprovedSourceTier = 'PRIMARY_LEGISLATION' | 'FORMAL_AGENCY_INSTRUMENT' | 'OFFICIAL_AGENCY_GUIDANCE';

export interface ApprovedSourceFamily {
  id: string;
  hosts: string[];
  tier: ApprovedSourceTier;
  presentationLabel: string;
  mustShowCanonicalLink: boolean;
  legalWeight: 'PRIMARY' | 'GUIDANCE';
}

export const APPROVED_SINGAPORE_SOURCE_FAMILIES: ApprovedSourceFamily[] = [
  {
    id: 'SINGAPORE_STATUTES_ONLINE',
    hosts: ['sso.agc.gov.sg'],
    tier: 'PRIMARY_LEGISLATION',
    presentationLabel: 'Singapore Statutes Online / AGC',
    mustShowCanonicalLink: true,
    legalWeight: 'PRIMARY'
  },
  {
    id: 'AGENCY_FORMAL_SOURCES',
    hosts: ['mas.gov.sg', 'www.mas.gov.sg', 'iras.gov.sg', 'www.iras.gov.sg', 'acra.gov.sg', 'www.acra.gov.sg', 'mom.gov.sg', 'www.mom.gov.sg', 'cpf.gov.sg', 'www.cpf.gov.sg'],
    tier: 'FORMAL_AGENCY_INSTRUMENT',
    presentationLabel: 'Official Singapore agency source',
    mustShowCanonicalLink: true,
    legalWeight: 'PRIMARY'
  },
  {
    id: 'ASK_GOV_SG_FAQS',
    hosts: ['ask.gov.sg'],
    tier: 'OFFICIAL_AGENCY_GUIDANCE',
    presentationLabel: 'Official agency FAQ via Ask.gov.sg',
    mustShowCanonicalLink: true,
    legalWeight: 'GUIDANCE'
  },
  {
    id: 'IFRS_FOUNDATION',
    hosts: ['ifrs.org', 'www.ifrs.org'],
    tier: 'FORMAL_AGENCY_INSTRUMENT',
    presentationLabel: 'IFRS Foundation',
    mustShowCanonicalLink: true,
    legalWeight: 'PRIMARY'
  },
  {
    id: 'SINGAPORE_ACCOUNTING_STANDARDS_COMMITTEE',
    hosts: ['asc.acra.gov.sg'],
    tier: 'FORMAL_AGENCY_INSTRUMENT',
    presentationLabel: 'Accounting Standards Committee / ACRA',
    mustShowCanonicalLink: true,
    legalWeight: 'PRIMARY'
  }
];

export function isAskGovSingaporeUrl(url?: string): boolean {
  try {
    return new URL(url || '').hostname.toLowerCase() === 'ask.gov.sg';
  } catch {
    return false;
  }
}

export function getApprovedSourceTierForUrl(url?: string): ApprovedSourceTier | undefined {
  try {
    const hostname = new URL(url || '').hostname.toLowerCase();
    for (const family of APPROVED_SINGAPORE_SOURCE_FAMILIES) {
      if (family.hosts.includes(hostname)) {
        return family.tier;
      }
    }
  } catch {
    // fall through
  }
  return undefined;
}

export function isApprovedSingaporeSourceUrl(url?: string): boolean {
  return getApprovedSourceTierForUrl(url) !== undefined;
}

/**
 * A narrow compatibility allowlist for the existing validated SFRS(I) 9 pack.
 * This is a standard-level public landing page, not paragraph-level evidence.
 */
const VERIFIED_LEGACY_STANDARD_URLS: ReadonlyArray<{ url: string; standardCodes: readonly string[] }> = [
  {
    url: 'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/',
    standardCodes: ['SFRS(I) 9', 'IFRS 9']
  }
];

export function isVerifiedLegacyStandardUrl(url: string | undefined, standardCode: string | undefined): boolean {
  if (!url || !standardCode) return false;
  try {
    const parsed = new URL(url);
    const normalized = `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${parsed.pathname.toLowerCase().replace(/\/+$/, '')}`;
    return VERIFIED_LEGACY_STANDARD_URLS.some(entry => {
      const candidate = new URL(entry.url);
      const candidateNormalized = `${candidate.hostname.toLowerCase().replace(/^www\./, '')}${candidate.pathname.toLowerCase().replace(/\/+$/, '')}`;
      return normalized === candidateNormalized && entry.standardCodes.some(code => code.toLowerCase() === standardCode.toLowerCase());
    });
  } catch {
    return false;
  }
}
