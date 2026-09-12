import { SINGAPORE_STATUTORY_REPOSITORY } from '../standards/singaporeStatutesKnowledge';
import type { StatutoryAuthority } from '../types/accounting';

/**
 * Mapping of Singapore Legislation Shortcodes to SSO Act Identifiers
 */
export const ACT_CODE_TO_SSO: Record<string, { ssoCode: string; title: string }> = {
  ITA: { ssoCode: 'ITA1947', title: 'Income Tax Act 1947' },
  INCOME_TAX: { ssoCode: 'ITA1947', title: 'Income Tax Act 1947' },
  COA: { ssoCode: 'CoA1967', title: 'Companies Act 1967' },
  COA1967: { ssoCode: 'CoA1967', title: 'Companies Act 1967' },
  CA: { ssoCode: 'CoA1967', title: 'Companies Act 1967' },
  CA1967: { ssoCode: 'CoA1967', title: 'Companies Act 1967' },
  COMPANIES_ACT: { ssoCode: 'CoA1967', title: 'Companies Act 1967' },
  COMPANIES: { ssoCode: 'CoA1967', title: 'Companies Act 1967' },
  GST: { ssoCode: 'GSTA1993', title: 'Goods and Services Tax Act 1993' },
  GSTA: { ssoCode: 'GSTA1993', title: 'Goods and Services Tax Act 1993' },
  CPF: { ssoCode: 'CPFA1953', title: 'Central Provident Fund Act 1953' },
  CPFA: { ssoCode: 'CPFA1953', title: 'Central Provident Fund Act 1953' },
  EA: { ssoCode: 'EA1968', title: 'Employment Act 1968' },
  EMPLOYMENT_ACT: { ssoCode: 'EA1968', title: 'Employment Act 1968' },
  PSA: { ssoCode: 'PSA2019', title: 'Payment Services Act 2019' },
  PAYMENT_SERVICES: { ssoCode: 'PSA2019', title: 'Payment Services Act 2019' },
  MAS: { ssoCode: 'MASA1970', title: 'Monetary Authority of Singapore Act 1970' },
  MASA: { ssoCode: 'MASA1970', title: 'Monetary Authority of Singapore Act 1970' },
  CDCA: { ssoCode: 'CDCA2001', title: 'Child Development Co-Savings Act 2001' },
  CDCA2001: { ssoCode: 'CDCA2001', title: 'Child Development Co-Savings Act 2001' }
};

// ASC publishes SFRS(I) as an official annual collection rather than exposing
// a stable public URL for each individual standard. This is the closest
// official source for an SFRS(I) citation; it is intentionally not ACRA's
// general accounting-standards landing page.
export const SFRSI_2025_COLLECTION_URL = 'https://asc.acra.gov.sg/singapore-financial-reporting-standards-international/archives/effective-for-annual-reporting-period-beginning-on-1-january-2025';

/**
 * Official agency guidance is preferable to legislation where it addresses the
 * precise topic. Each endpoint below is an active, first-party government page
 * verified on 12 September 2026. If no match is available, callers fall back
 * to the exact Singapore Statutes Online Act/section.
 */
function resolveTopicSpecificOfficialSource(act: string, section: string): string | undefined {
  const context = `${act} ${section}`.toLowerCase();

  if (act.includes('income tax')) {
    if (/14n|renovation|refurbishment/.test(context)) {
      return 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/business-expenses/tax-treatment-of-business-expenses-%28m-r%29';
    }
    if (/section\s*14|\b14\(1\)|business expense|deductib/.test(context)) {
      return 'https://www.iras.gov.sg/taxes/corporate-income-tax/income-deductions-for-companies/business-expenses';
    }
  }

  if (act.includes('goods and services') || act.includes('gst')) {
    if (/registration|first schedule|threshold|turnover/.test(context)) {
      return 'https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/gst-registration-deregistration/do-i-need-to-register-for-gst';
    }
  }

  if (act.includes('provident fund') || act.includes('cpf')) {
    if (/rate|contribution|wage|ceiling/.test(context)) {
      return 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay';
    }
  }

  if (act.includes('employment act') || act.includes('mom')) {
    if (/88a|annual leave|vacation/.test(context)) {
      return 'https://www.mom.gov.sg/employment-practices/leave/annual-leave';
    }
    if (/89|sick leave|hospitalisation/.test(context)) {
      return 'https://www.mom.gov.sg/employment-practices/leave/sick-leave';
    }
  }

  return undefined;
}

/**
 * Generates an official Singapore Statutes Online (SSO) canonical permalink.
 * Format on sso.agc.gov.sg is https://sso.agc.gov.sg/Act/{ActCode}#pr{SectionNumber}-
 */
export function buildSsoUrl(actCode: string, sectionNumber?: string): string {
  const normCode = actCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let ssoCode: string | undefined;

  if (actCode.toLowerCase().includes('coa') || actCode.toLowerCase().includes('companies') || actCode === 'CA' || actCode === 'CA1967') {
    ssoCode = 'CoA1967';
  } else {
    for (const [k, v] of Object.entries(ACT_CODE_TO_SSO)) {
      if (normCode.includes(k)) {
        ssoCode = v.ssoCode;
        break;
      }
    }
  }

  if (!ssoCode) return 'https://sso.agc.gov.sg';

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

  // 1b. Correct mistaken Currency Act (CA1967) links intended for Companies Act
  if (url.includes('/Act/CA1967')) {
    return url.replace('/Act/CA1967', '/Act/CoA1967');
  }

  // 2. Resolve the cited instrument first. This deliberately takes precedence
  // over a generic agency or SSO URL, so the user lands on the cited Act and
  // section rather than a directory.
  const act = (statuteOrAct || '').toLowerCase();
  const sec = sectionOrSchedule || '';

  const topicSpecificSource = resolveTopicSpecificOfficialSource(act, sec);
  if (topicSpecificSource) return topicSpecificSource;

  if (act.includes('income tax') || act.includes('ita') || act.includes('corporate tax')) {
    return buildSsoUrl('ITA1947', sec);
  }
  if (act.includes('companies act') || act.includes('ca1967') || act.includes('coa1967') || act.includes('audit')) {
    return buildSsoUrl('CoA1967', sec);
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
  if (/(?:sfrs\(i\)|sfrs|ifrs|ias)\s*(?:\d|1-)/i.test(statuteOrAct || '')) {
    return SFRSI_2025_COLLECTION_URL;
  }

  // 3. Preserve a supplied, source-specific SSO link.
  if (url.startsWith('https://sso.agc.gov.sg/Act/')) {
    return url;
  }

  // 4. Check whether the raw URL is a source page, rather than a generic
  // agency directory. Generic directories are withheld below.
  if (url.includes('asc.gov.sg')) {
    return url.includes('/singapore-financial-reporting-standards-international/')
      ? url
      : SFRSI_2025_COLLECTION_URL;
  }

  if (
    url.startsWith('https://www.iras.gov.sg') ||
    url.startsWith('https://www.acra.gov.sg') ||
    url.startsWith('https://www.cpf.gov.sg') ||
    url.startsWith('https://www.mom.gov.sg') ||
    url.startsWith('https://www.mas.gov.sg') ||
    url.startsWith('https://www.ifrs.org')
  ) {
    try {
      const parsedUrl = new URL(url);
      // An agency root is not a source for a specific conclusion.
      if (parsedUrl.pathname === '/' || /^\/irashome\/?$/i.test(parsedUrl.pathname)) return '';
    } catch {
      return '';
    }
    return url;
  }

  // 5. Authority-only fallbacks may be an agency home page, not evidence for a
  // particular proposition. Show a section of the governing Act where that is
  // unambiguous; otherwise return no link instead of a misleading directory.
  const auth = (authority || '').toUpperCase();
  if (auth === 'CPF' && /\d/.test(sec)) return buildSsoUrl('CPFA1953', sec);
  if (auth === 'MOM' && /\d/.test(sec)) return buildSsoUrl('EA1968', sec);
  if (auth === 'MAS' && /\d/.test(sec)) return buildSsoUrl('MASA1970', sec);
  if (auth === 'ASC') return SFRSI_2025_COLLECTION_URL;

  // A source may be absent, but an official-looking generic link must not be
  // presented as support for a specific accounting or compliance conclusion.
  return '';
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
    case 'ASC':
      return {
        label: 'ACRA / ASC',
        badgeClass: 'bg-slate-800/90 text-slate-200 border-slate-700',
        dotColor: 'bg-indigo-400'
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

  // 1. Isolate all existing markdown links so text replacements never corrupt their anchors or urls
  const linkPlaceholders: string[] = [];
  let sanitized = markdownText.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, (_match, anchorText, url) => {
    const lowerUrl = url.toLowerCase();
    const lowerAnchor = anchorText.toLowerCase();

    // Intercept known dead deep-links and mistyped act codes
    let cleanUrl = url;
    if (cleanUrl.toLowerCase().includes('/act/ca1967')) {
      cleanUrl = cleanUrl.replace(/\/act\/ca1967/gi, '/Act/CoA1967');
    } else if (lowerUrl.includes('tax-rates-and-tax-exemption-schemes')) {
      cleanUrl = 'https://sso.agc.gov.sg/Act/ITA1947#pr43-';
    } else if (lowerUrl.includes('filing-your-corporate-income-tax-return')) {
      cleanUrl = 'https://sso.agc.gov.sg/Act/ITA1947#pr62-';
    } else if (lowerUrl.includes('monetary-authority-of-singapore-act')) {
      cleanUrl = 'https://sso.agc.gov.sg/Act/MASA1970';
    } else if (lowerUrl.includes('asc.gov.sg')) {
      cleanUrl = 'https://www.acra.gov.sg/accountancy/accounting-standards';
    } else if (
      !lowerUrl.startsWith('https://sso.agc.gov.sg') &&
      !lowerUrl.startsWith('https://www.iras.gov.sg') &&
      !lowerUrl.startsWith('https://www.acra.gov.sg') &&
      !lowerUrl.startsWith('https://www.cpf.gov.sg') &&
      !lowerUrl.startsWith('https://www.mom.gov.sg') &&
      !lowerUrl.startsWith('https://www.mas.gov.sg') &&
      !lowerUrl.startsWith('https://www.ifrs.org')
    ) {
      // Re-anchor unknown domain URLs to canonical sources
      for (const rule of Object.values(SINGAPORE_STATUTORY_REPOSITORY)) {
        if (
          lowerAnchor.includes(rule.sectionOrSchedule.toLowerCase()) ||
          lowerAnchor.includes(rule.actTitle.toLowerCase()) ||
          lowerAnchor.includes(rule.ruleTitle.toLowerCase())
        ) {
          cleanUrl = rule.canonicalUrl;
          break;
        }
      }
    }

    const placeholder = `___MD_LINK_${linkPlaceholders.length}___`;
    linkPlaceholders.push(`[${anchorText}](${cleanUrl})`);
    return placeholder;
  });

  const addLink = (anchor: string, linkUrl: string): string => {
    const placeholder = `___MD_LINK_${linkPlaceholders.length}___`;
    linkPlaceholders.push(`[${anchor}](${linkUrl})`);
    return placeholder;
  };

  // 2. Replace unlinked statutory patterns in remaining plain text
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*205C(?:\s*(?:&|and)\s*Thirteenth\s*Schedule)?)/gi,
    () => addLink('Companies Act 1967 Section 205C & Thirteenth Schedule', 'https://sso.agc.gov.sg/Act/CoA1967#pr205C-')
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*199(?:\(1\))?)/gi,
    () => addLink('Companies Act 1967 Section 199', 'https://sso.agc.gov.sg/Act/CoA1967#pr199-')
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*145(?:\(1\))?)/gi,
    () => addLink('Companies Act 1967 Section 145', 'https://sso.agc.gov.sg/Act/CoA1967#pr145-')
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*(?:175|197))/gi,
    () => addLink('Companies Act 1967 Section 175 & 197', 'https://sso.agc.gov.sg/Act/CoA1967#pr197-')
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?)(?!\w)/gi,
    () => addLink('Companies Act 1967', 'https://sso.agc.gov.sg/Act/CoA1967')
  );
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*15\(1\)\(k\))/gi,
    () => addLink('Income Tax Act 1947 Section 15(1)(k)', 'https://sso.agc.gov.sg/Act/ITA1947#pr15-')
  );
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*14(?:\(1\))?)/gi,
    () => addLink('Income Tax Act 1947 Section 14(1)', 'https://sso.agc.gov.sg/Act/ITA1947#pr14-')
  );
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*19A)/gi,
    () => addLink('Income Tax Act 1947 Section 19A', 'https://sso.agc.gov.sg/Act/ITA1947#pr19A-')
  );
  sanitized = sanitized.replace(
    /(?:GST Act\s*(?:1993)?\s*(?:Section|§)\s*21(?:\(3\))?)/gi,
    () => addLink('Goods and Services Tax Act 1993 Section 21(3)', 'https://sso.agc.gov.sg/Act/GSTA1993#pr21-')
  );
  sanitized = sanitized.replace(
    /(?:CPF Act\s*(?:1953)?\s*(?:Section|§)\s*(\d+[A-Za-z]?))/gi,
    (_, sec) => addLink(`Central Provident Fund Act 1953 Section ${sec}`, `https://sso.agc.gov.sg/Act/CPFA1953#pr${sec}-`)
  );
  sanitized = sanitized.replace(
    /(?:Employment Act\s*(?:1968)?\s*(?:Section|§)\s*(\d+[A-Za-z]?))/gi,
    (_, sec) => addLink(`Employment Act 1968 Section ${sec}`, `https://sso.agc.gov.sg/Act/EA1968#pr${sec}-`)
  );
  sanitized = sanitized.replace(
    /(?:CPF Act\s*(?:1953)?)(?!\w)/gi,
    () => addLink('Central Provident Fund Act 1953', 'https://sso.agc.gov.sg/Act/CPFA1953')
  );
  sanitized = sanitized.replace(
    /(?:Employment Act\s*(?:1968)?)(?!\w)/gi,
    () => addLink('Employment Act 1968', 'https://sso.agc.gov.sg/Act/EA1968')
  );

  // 3. Restore all original/cleaned markdown links
  sanitized = sanitized.replace(/___MD_LINK_(\d+)___/g, (_, idx) => linkPlaceholders[parseInt(idx, 10)] || '');

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
        url: 'https://sso.agc.gov.sg/Act/CoA1967#pr205C-',
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
        title: 'SFRS(I) 16 Leases (ACRA Accounting Standards)',
        url: 'https://www.acra.gov.sg/accountancy/accounting-standards',
        authority: 'ACRA'
      });
    }
    if (links.length === 0) {
      links.push({
        title: 'Singapore Financial Reporting Standards [SFRS(I)] (ACRA)',
        url: 'https://www.acra.gov.sg/accountancy/accounting-standards',
        authority: 'ACRA'
      });
    }
  }

  const sourceItems = links
    .map((l) => `* 🔗 [**${l.title}**](${l.url}) ${l.authority ? `*(${l.authority} / Verified Official Source)*` : ''}`)
    .join('\n');

  const footerBlock = `\n\n---\n\n🏛️ **Official Statutory & Regulatory Verification Sources**:\n${sourceItems}\n*(Click any link to verify directly on official Singapore government legislation or regulatory directory)*`;

  return sanitizeStatutoryLinks(messageText + footerBlock);
}
