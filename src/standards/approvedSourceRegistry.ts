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
  }
];

export function isAskGovSingaporeUrl(url?: string): boolean {
  try {
    return new URL(url || '').hostname.toLowerCase() === 'ask.gov.sg';
  } catch {
    return false;
  }
}
