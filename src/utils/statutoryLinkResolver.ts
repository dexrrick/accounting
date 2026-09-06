import { SINGAPORE_STATUTORY_REPOSITORY } from '../standards/singaporeStatutesKnowledge';
import type { StatutoryAuthority } from '../types/accounting';

/**
 * Mapping of Singapore Legislation Shortcodes to SSO Act Identifiers
 */
export const ACT_CODE_TO_SSO: Record<string, { ssoCode: string; title: string }> = {
  ITA: { ssoCode: 'ITA1947', title: 'Income Tax Act 1947' },
  INCOME_TAX: { ssoCode: 'ITA1947', title: 'Income Tax Act 1947' },
  CA: { ssoCode: 'CA1967', title: 'Companies Act 1967' },
  COMPANIES_ACT: { ssoCode: 'CA1967', title: 'Companies Act 1967' },
  GST: { ssoCode: 'GSTA1993', title: 'Goods and Services Tax Act 1993' },
  GSTA: { ssoCode: 'GSTA1993', title: 'Goods and Services Tax Act 1993' },
  CPF: { ssoCode: 'CPFA1953', title: 'Central Provident Fund Act 1953' },
  CPFA: { ssoCode: 'CPFA1953', title: 'Central Provident Fund Act 1953' },
  EA: { ssoCode: 'EA1968', title: 'Employment Act 1968' },
  EMPLOYMENT_ACT: { ssoCode: 'EA1968', title: 'Employment Act 1968' },
  PSA: { ssoCode: 'PSA2019', title: 'Payment Services Act 2019' },
  PAYMENT_SERVICES: { ssoCode: 'PSA2019', title: 'Payment Services Act 2019' }
};

/**
 * Generates an official Singapore Statutes Online (SSO) canonical permalink.
 * Format on sso.agc.gov.sg is https://sso.agc.gov.sg/Act/{ActCode}#pr{SectionNumber}-
 */
export function buildSsoUrl(actCode: string, sectionNumber?: string): string {
  const normCode = actCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let ssoCode = 'ITA1947';

  for (const [k, v] of Object.entries(ACT_CODE_TO_SSO)) {
    if (normCode.includes(k)) {
      ssoCode = v.ssoCode;
      break;
    }
  }

  if (!sectionNumber) {
    return `https://sso.agc.gov.sg/Act/${ssoCode}`;
  }

  // Extract clean section digits / alphanumeric (e.g. "14(1)" -> "14", "205C" -> "205C", "19A" -> "19A")
  const secMatch = sectionNumber.match(/(\d+[A-Za-z]*)/);
  const secClean = secMatch ? secMatch[1] : '';

  return secClean 
    ? `https://sso.agc.gov.sg/Act/${ssoCode}#pr${secClean}-` 
    : `https://sso.agc.gov.sg/Act/${ssoCode}`;
}

/**
 * Resolves an authority badge color scheme and display name
 */
export function getAuthorityBadgeInfo(authority?: StatutoryAuthority | string): {
  label: string;
  badgeClass: string;
  dotColor: string;
} {
  const auth = (authority || '').toUpperCase();

  switch (auth) {
    case 'IRAS':
      return {
        label: 'IRAS Singapore',
        badgeClass: 'bg-emerald-950 text-emerald-300 border-emerald-800/80',
        dotColor: 'bg-emerald-400'
      };
    case 'ACRA':
      return {
        label: 'ACRA Singapore',
        badgeClass: 'bg-indigo-950 text-indigo-300 border-indigo-800/80',
        dotColor: 'bg-indigo-400'
      };
    case 'CPF':
      return {
        label: 'CPF Board',
        badgeClass: 'bg-blue-950 text-blue-300 border-blue-800/80',
        dotColor: 'bg-blue-400'
      };
    case 'MOM':
      return {
        label: 'MOM Singapore',
        badgeClass: 'bg-amber-950 text-amber-300 border-amber-800/80',
        dotColor: 'bg-amber-400'
      };
    case 'MAS':
      return {
        label: 'MAS Singapore',
        badgeClass: 'bg-purple-950 text-purple-300 border-purple-800/80',
        dotColor: 'bg-purple-400'
      };
    case 'CUSTOMS':
      return {
        label: 'Singapore Customs',
        badgeClass: 'bg-cyan-950 text-cyan-300 border-cyan-800/80',
        dotColor: 'bg-cyan-400'
      };
    default:
      return {
        label: 'Singapore Statutes',
        badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
        dotColor: 'bg-slate-400'
      };
  }
}

/**
 * Sanitizes markdown text by checking markdown URLs.
 * If a URL is a fabricated / hallucinated non-working URL or generic search link,
 * replaces it with a guaranteed canonical permalink from our registry or SSO.
 */
export function sanitizeStatutoryLinks(markdownText: string): string {
  if (!markdownText) return '';

  let sanitized = markdownText;

  // Replace common statutory patterns that lack links with verified SSO links
  // 1. Companies Act Section 205C
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*205C)/gi,
    '[Companies Act 1967 Section 205C](https://sso.agc.gov.sg/Act/CA1967#pr205C-)'
  );

  // 2. Income Tax Act Section 14 / Section 15 / Section 15(1)(k)
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*15\(1\)\(k\))/gi,
    '[Income Tax Act 1947 Section 15(1)(k)](https://sso.agc.gov.sg/Act/ITA1947#pr15-)'
  );
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*14(?:\(1\))?)/gi,
    '[Income Tax Act 1947 Section 14(1)](https://sso.agc.gov.sg/Act/ITA1947#pr14-)'
  );
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*19A)/gi,
    '[Income Tax Act 1947 Section 19A](https://sso.agc.gov.sg/Act/ITA1947#pr19A-)'
  );

  // 3. GST Act Section 21
  sanitized = sanitized.replace(
    /(?:GST Act\s*(?:1993)?\s*(?:Section|§)\s*21(?:\(3\))?)/gi,
    '[Goods and Services Tax Act 1993 Section 21(3)](https://sso.agc.gov.sg/Act/GSTA1993#pr21-)'
  );

  // 4. CPF Act & Ceilings
  sanitized = sanitized.replace(
    /(?:CPF Act\s*(?:1953)?)/gi,
    '[Central Provident Fund Act 1953](https://sso.agc.gov.sg/Act/CPFA1953)'
  );

  // Check existing markdown links [text](url)
  // If the url contains non-existent domains or random paths, re-anchor to official portals
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
  sanitized = sanitized.replace(linkRegex, (match, anchorText, url) => {
    const lowerUrl = url.toLowerCase();
    const lowerAnchor = anchorText.toLowerCase();

    // Preserve validated SSO, IRAS, ACRA, CPF, MAS, MOM, and ASC links
    if (
      lowerUrl.startsWith('https://sso.agc.gov.sg') ||
      lowerUrl.startsWith('https://www.iras.gov.sg') ||
      lowerUrl.startsWith('https://www.acra.gov.sg') ||
      lowerUrl.startsWith('https://www.cpf.gov.sg') ||
      lowerUrl.startsWith('https://www.mom.gov.sg') ||
      lowerUrl.startsWith('https://www.mas.gov.sg') ||
      lowerUrl.startsWith('https://www.asc.gov.sg') ||
      lowerUrl.startsWith('https://www.ifrs.org')
    ) {
      return match;
    }

    // Attempt to match anchor text to local statutory repository
    for (const rule of Object.values(SINGAPORE_STATUTORY_REPOSITORY)) {
      if (
        lowerAnchor.includes(rule.sectionOrSchedule.toLowerCase()) ||
        lowerAnchor.includes(rule.actTitle.toLowerCase()) ||
        lowerAnchor.includes(rule.ruleTitle.toLowerCase())
      ) {
        return `[${anchorText}](${rule.canonicalUrl})`;
      }
    }

    // Default: If anchor mentions Income Tax, route to ITA SSO
    if (lowerAnchor.includes('income tax') || lowerAnchor.includes('form c')) {
      return `[${anchorText}](https://sso.agc.gov.sg/Act/ITA1947)`;
    }
    if (lowerAnchor.includes('companies act') || lowerAnchor.includes('acra')) {
      return `[${anchorText}](https://sso.agc.gov.sg/Act/CA1967)`;
    }
    if (lowerAnchor.includes('gst')) {
      return `[${anchorText}](https://sso.agc.gov.sg/Act/GSTA1993)`;
    }
    if (lowerAnchor.includes('cpf')) {
      return `[${anchorText}](https://www.cpf.gov.sg)`;
    }
    if (lowerAnchor.includes('mas')) {
      return `[${anchorText}](https://www.mas.gov.sg/regulation/acts)`;
    }

    return match;
  });

  return sanitized;
}
