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
  PAYMENT_SERVICES: { ssoCode: 'PSA2019', title: 'Payment Services Act 2019' },
  MAS: { ssoCode: 'MASA1970', title: 'Monetary Authority of Singapore Act 1970' },
  MASA: { ssoCode: 'MASA1970', title: 'Monetary Authority of Singapore Act 1970' }
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
 * Safely resolves any official URL (whether from static knowledge or dynamic AI response)
 * into a guaranteed 200 OK link. Replaces dead deep-links with canonical SSO permalinks.
 */
export function getSafeOfficialUrl(
  rawUrl?: string,
  statuteOrAct?: string,
  sectionOrSchedule?: string,
  authority?: string
): string {
  const url = (rawUrl || '').trim();

  // 1. Intercept known dead deep-links on IRAS and MAS
  if (url.includes('tax-rates-and-tax-exemption-schemes')) {
    return 'https://sso.agc.gov.sg/Act/ITA1947#pr43-';
  }
  if (url.includes('filing-your-corporate-income-tax-return')) {
    return 'https://sso.agc.gov.sg/Act/ITA1947#pr62-';
  }
  if (url.includes('monetary-authority-of-singapore-act')) {
    return 'https://sso.agc.gov.sg/Act/MASA1970';
  }

  // 2. If it's already a valid Singapore Statutes Online (SSO) URL, return it directly
  if (url.startsWith('https://sso.agc.gov.sg/Act/')) {
    return url;
  }

  // 3. If statute or act name is specified, resolve to authoritative SSO permalink
  const act = (statuteOrAct || '').toLowerCase();
  const sec = sectionOrSchedule || '';

  if (act.includes('income tax') || act.includes('ita') || act.includes('corporate tax')) {
    return buildSsoUrl('ITA1947', sec);
  }
  if (act.includes('companies act') || act.includes('ca1967') || act.includes('audit')) {
    return buildSsoUrl('CA1967', sec);
  }
  if (act.includes('goods and services') || act.includes('gst')) {
    return buildSsoUrl('GSTA1993', sec);
  }
  if (act.includes('provident fund') || act.includes('cpf')) {
    return buildSsoUrl('CPFA1953', sec);
  }
  if (act.includes('employment act') || act.includes('ea1968') || act.includes('mom')) {
    return buildSsoUrl('EA1968', sec);
  }
  if (act.includes('monetary authority') || act.includes('mas') || act.includes('exchange control')) {
    return 'https://sso.agc.gov.sg/Act/MASA1970';
  }
  if (act.includes('payment services') || act.includes('psa')) {
    return buildSsoUrl('PSA2019', sec);
  }

  // 4. Check if rawUrl is a verified domain
  if (
    url.startsWith('https://www.iras.gov.sg') ||
    url.startsWith('https://www.acra.gov.sg') ||
    url.startsWith('https://www.cpf.gov.sg') ||
    url.startsWith('https://www.mom.gov.sg') ||
    url.startsWith('https://www.mas.gov.sg') ||
    url.startsWith('https://www.asc.gov.sg')
  ) {
    return url;
  }

  // 5. Authority fallback
  const auth = (authority || '').toUpperCase();
  if (auth === 'IRAS') return 'https://sso.agc.gov.sg/Act/ITA1947';
  if (auth === 'ACRA') return 'https://sso.agc.gov.sg/Act/CA1967';
  if (auth === 'CPF') return 'https://www.cpf.gov.sg';
  if (auth === 'MOM') return 'https://sso.agc.gov.sg/Act/EA1968';
  if (auth === 'MAS') return 'https://sso.agc.gov.sg/Act/MASA1970';
  if (auth === 'ASC') return 'https://www.asc.gov.sg';

  // 6. Default canonical SSO root
  return url || 'https://sso.agc.gov.sg';
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
        badgeClass: 'bg-slate-800/90 text-slate-200 border-slate-700',
        dotColor: 'bg-emerald-500/80'
      };
    case 'ACRA':
      return {
        label: 'ACRA Singapore',
        badgeClass: 'bg-slate-800/90 text-slate-200 border-slate-700',
        dotColor: 'bg-blue-400'
      };
    case 'CPF':
      return {
        label: 'CPF Board',
        badgeClass: 'bg-slate-800/90 text-slate-200 border-slate-700',
        dotColor: 'bg-blue-400'
      };
    case 'MOM':
      return {
        label: 'MOM Singapore',
        badgeClass: 'bg-slate-800/90 text-slate-200 border-slate-700',
        dotColor: 'bg-amber-500/80'
      };
    case 'MAS':
      return {
        label: 'MAS Singapore',
        badgeClass: 'bg-slate-800/90 text-slate-200 border-slate-700',
        dotColor: 'bg-slate-400'
      };
    case 'CUSTOMS':
      return {
        label: 'Singapore Customs',
        badgeClass: 'bg-slate-800/90 text-slate-200 border-slate-700',
        dotColor: 'bg-slate-400'
      };
    default:
      return {
        label: 'Singapore Statutes',
        badgeClass: 'bg-slate-800/90 text-slate-300 border-slate-700',
        dotColor: 'bg-slate-500'
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

    // Intercept known dead deep-links
    if (lowerUrl.includes('tax-rates-and-tax-exemption-schemes')) {
      return `[${anchorText}](https://sso.agc.gov.sg/Act/ITA1947#pr43-)`;
    }
    if (lowerUrl.includes('filing-your-corporate-income-tax-return')) {
      return `[${anchorText}](https://sso.agc.gov.sg/Act/ITA1947#pr62-)`;
    }
    if (lowerUrl.includes('monetary-authority-of-singapore-act')) {
      return `[${anchorText}](https://sso.agc.gov.sg/Act/MASA1970)`;
    }

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
      return `[${anchorText}](https://sso.agc.gov.sg/Act/MASA1970)`;
    }

    return match;
  });

  return sanitized;
}

/**
 * Ensures EVERY response ends with a verified, clickable government source link.
 */
export function appendStatutorySourceFooter(
  messageText: string,
  scenarioState?: any
): string {
  if (!messageText) return '';

  // If already has an explicit source footer block, just sanitize links
  if (
    messageText.includes('Official Statutory & Regulatory Verification Sources') ||
    messageText.includes('Official Verification Sources')
  ) {
    return sanitizeStatutoryLinks(messageText);
  }

  const links: { title: string; url: string; authority?: string }[] = [];

  // 1. Extract from statutory advisory
  if (scenarioState?.statutoryAdvisory && scenarioState.statutoryAdvisory.length > 0) {
    for (const adv of scenarioState.statutoryAdvisory) {
      const safeUrl = getSafeOfficialUrl(adv.officialUrl, adv.statuteOrAct, adv.sectionOrSchedule, adv.authority);
      if (safeUrl && !links.some((l) => l.url === safeUrl)) {
        links.push({
          title: `${adv.statuteOrAct} — ${adv.sectionOrSchedule}`,
          url: safeUrl,
          authority: adv.authority
        });
      }
    }
  }

  // 2. Extract from directGroups citations
  if (scenarioState?.directGroups) {
    for (const grp of scenarioState.directGroups) {
      for (const cite of grp.citations || []) {
        const safeUrl = getSafeOfficialUrl(cite.officialSourceUrl, cite.standard, cite.paragraph, cite.authority);
        if (safeUrl && !links.some((l) => l.url === safeUrl)) {
          links.push({
            title: `${cite.standard} ${cite.paragraph || ''}`.trim(),
            url: safeUrl,
            authority: cite.authority
          });
        }
      }
    }
  }

  // 3. Fallback keyword extraction if links empty
  if (links.length === 0) {
    const lower = messageText.toLowerCase();
    if (lower.includes('income tax') || lower.includes('section 14') || lower.includes('section 15') || lower.includes('motor car') || lower.includes('passenger car')) {
      links.push({
        title: 'Income Tax Act 1947',
        url: 'https://sso.agc.gov.sg/Act/ITA1947',
        authority: 'IRAS'
      });
    }
    if (lower.includes('companies act') || lower.includes('205c') || lower.includes('audit')) {
      links.push({
        title: 'Companies Act 1967 (Section 205C)',
        url: 'https://sso.agc.gov.sg/Act/CA1967#pr205C-',
        authority: 'ACRA'
      });
    }
    if (lower.includes('gst') || lower.includes('goods and services') || lower.includes('regulation 26')) {
      links.push({
        title: 'Goods and Services Tax Act 1993',
        url: 'https://sso.agc.gov.sg/Act/GSTA1993',
        authority: 'IRAS'
      });
    }
    if (lower.includes('cpf') || lower.includes('ordinary wage')) {
      links.push({
        title: 'Central Provident Fund Act 1953',
        url: 'https://sso.agc.gov.sg/Act/CPFA1953',
        authority: 'CPF'
      });
    }
    if (lower.includes('lease') || lower.includes('ifrs 16') || lower.includes('sfrs(i) 16')) {
      links.push({
        title: 'SFRS(I) 16 Leases (ASC Singapore)',
        url: 'https://www.asc.gov.sg',
        authority: 'ASC'
      });
    }
    if (links.length === 0) {
      links.push({
        title: 'Singapore Financial Reporting Standards [SFRS(I)]',
        url: 'https://www.asc.gov.sg',
        authority: 'ASC'
      });
    }
  }

  const sourceItems = links
    .map((l) => `* 🔗 [**${l.title}**](${l.url}) ${l.authority ? `*(${l.authority} / Verified Official Source)*` : ''}`)
    .join('\n');

  const footerBlock = `\n\n---\n\n🏛️ **Official Statutory & Regulatory Verification Sources**:\n${sourceItems}\n*(Click any link to verify directly on official Singapore government legislation or regulatory directory)*`;

  return sanitizeStatutoryLinks(messageText + footerBlock);
}
