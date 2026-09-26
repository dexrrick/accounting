import { SINGAPORE_STATUTORY_REPOSITORY, querySingaporeStatutes } from '../standards/singaporeStatutesKnowledge';
import { getAllAuthoritativeSources, type AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';
import type { StatutoryAuthority } from '../types/accounting';
import { isAskGovSingaporeUrl, isApprovedSingaporeSourceUrl, isVerifiedLegacyStandardUrl } from '../standards/approvedSourceRegistry';

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
  EA: { ssoCode: 'EmA1968', title: 'Employment Act 1968' },
  EMA: { ssoCode: 'EmA1968', title: 'Employment Act 1968' },
  EMA1968: { ssoCode: 'EmA1968', title: 'Employment Act 1968' },
  EMPLOYMENT_ACT: { ssoCode: 'EmA1968', title: 'Employment Act 1968' },
  PSA: { ssoCode: 'PSA2019', title: 'Payment Services Act 2019' },
  PAYMENT_SERVICES: { ssoCode: 'PSA2019', title: 'Payment Services Act 2019' },
  VCCA: { ssoCode: 'VCCA2018', title: 'Variable Capital Companies Act 2018' },
  VCCA2018: { ssoCode: 'VCCA2018', title: 'Variable Capital Companies Act 2018' },
  VARIABLE_CAPITAL_COMPANIES: { ssoCode: 'VCCA2018', title: 'Variable Capital Companies Act 2018' },
  MAS: { ssoCode: 'MASA1970', title: 'Monetary Authority of Singapore Act 1970' },
  MASA: { ssoCode: 'MASA1970', title: 'Monetary Authority of Singapore Act 1970' },
  CDCA: { ssoCode: 'CDCSA2001', title: 'Child Development Co-Savings Act 2001' },
  CDCSA: { ssoCode: 'CDCSA2001', title: 'Child Development Co-Savings Act 2001' },
  CDCA2001: { ssoCode: 'CDCSA2001', title: 'Child Development Co-Savings Act 2001' }
};

// ASC publishes SFRS(I) as an official annual collection rather than exposing
// a stable public URL for each individual standard. This is the closest
// official source for an SFRS(I) citation; it is intentionally not ACRA's
// general accounting-standards landing page.
export const SFRSI_2025_COLLECTION_URL = 'https://asc.acra.gov.sg/singapore-financial-reporting-standards-international/archives/effective-for-annual-reporting-period-beginning-on-1-january-2025';

type SourceRecordMetadata = { recordRole?: string; groundingEligible?: boolean; urlVerificationStatus?: string };

function normalizeRegisteredUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = decodeURIComponent(parsed.pathname).toLowerCase().replace(/\/+$/, '');
    return `${host}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return '';
  }
}

function isUsableSourceRecord(record: AuthoritativeSourceRecord): boolean {
  const metadata = record as unknown as SourceRecordMetadata;
  return metadata.recordRole !== 'SOURCE_MAP_POINTER' &&
    metadata.groundingEligible !== false &&
    record.lifecycleState !== 'CANDIDATE' &&
    record.lifecycleState !== 'STAGED' &&
    record.lifecycleState !== 'REJECTED' &&
    (record.sourceStatus as string) !== 'REJECTED' &&
    (record.sourceStatus === 'VERIFIED' || metadata.urlVerificationStatus === 'VERIFIED' || isVerifiedLegacyStandardUrl(record.officialSourceUrl, record.standardOrActCode)) &&
    Boolean(record.officialSourceUrl);
}

function normalizeTopicText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sectionMatches(recordSection: string, requestedSection: string): boolean {
  if (!requestedSection.trim()) return false;
  const clean = (value: string) => value.toLowerCase().replace(/\b(?:section|sec|paragraph|para|regulation|reg|schedule|sch|clause)\b/gi, '').replace(/[^a-z0-9]/g, '');
  const recordValue = clean(recordSection);
  const requestedValue = clean(requestedSection);
  return Boolean(recordValue && requestedValue && (recordValue === requestedValue || recordValue.startsWith(requestedValue) || requestedValue.startsWith(recordValue)));
}

function getUsableRegisteredRecords(verifiedEvidence: readonly AuthoritativeSourceRecord[] = []): AuthoritativeSourceRecord[] {
  const local = getAllAuthoritativeSources().filter(isUsableSourceRecord);
  const qualifiedLive = verifiedEvidence.filter(record => {
    const metadata = record as unknown as SourceRecordMetadata;
    return metadata.recordRole === 'DISCOVERED_EVIDENCE' &&
      metadata.groundingEligible === true &&
      metadata.urlVerificationStatus === 'VERIFIED' &&
      record.provenance === 'LIVE_EXTERNAL' &&
      record.lifecycleState === 'CANDIDATE' &&
      record.verificationMethod === 'LIVE_OFFICIAL_TOPIC_VERIFIED' &&
      Boolean(record.officialSourceUrl);
  });
  return [...qualifiedLive, ...local];
}

function findRegisteredRuleUrl(
  statuteOrAct?: string,
  sectionOrSchedule?: string
): string {
  if (!statuteOrAct) return '';
  const instrument = normalizeTopicText(statuteOrAct);
  const rules = Object.values(SINGAPORE_STATUTORY_REPOSITORY);
  const matchingRule = rules.find(rule => {
    const ruleNames = [rule.actTitle, rule.actCode, rule.ruleTitle].map(normalizeTopicText);
    const named = ruleNames.some(name => name && (instrument.includes(name) || name.includes(instrument)));
    return rule.sourceStatus === 'VERIFIED' && named && (!sectionOrSchedule || sectionMatches(rule.sectionOrSchedule, sectionOrSchedule));
  });
  return matchingRule?.canonicalUrl || '';
}

function isRuleExplicitlyIdentified(rule: (typeof SINGAPORE_STATUTORY_REPOSITORY)[string], text: string): boolean {
  const normalizeForPhrase = (value: string) => normalizeTopicText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map(token => token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token)
    .join(' ');
  const normalizedText = normalizeForPhrase(text);
  const explicitTerms = [rule.actTitle, rule.ruleTitle, rule.sectionOrSchedule, ...rule.tags]
    .filter((term): term is string => Boolean(term))
    .map(normalizeForPhrase)
    .filter(term => term.length >= 8 && term.split(/\s+/).filter(Boolean).length >= 2);
  return explicitTerms.some(term => normalizedText.includes(term));
}
/**
 * Looks up an exact SSO URL already stored for the requested Act section.
 * It never constructs a URL when the registry has no matching source record.
 */
export function buildSsoUrl(actCode: string, sectionNumber?: string): string {
  const normCode = actCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const mapped = Object.entries(ACT_CODE_TO_SSO).find(([key]) => normCode === key || normCode.includes(key));
  const wantedCode = mapped?.[1].ssoCode || normCode;
  const matchingRule = Object.values(SINGAPORE_STATUTORY_REPOSITORY).find(rule => {
    const ruleCode = rule.actCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const ruleMapped = Object.entries(ACT_CODE_TO_SSO).find(([key]) => ruleCode.includes(key))?.[1].ssoCode || ruleCode;
    return wantedCode === ruleMapped && (!sectionNumber || sectionMatches(rule.sectionOrSchedule, sectionNumber));
  });
  return matchingRule?.canonicalUrl || '';
}

/** Resolve any legacy SSO fragment through the verified registry equivalent. */
export function canonicalizeSsoUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'sso.agc.gov.sg') return url;
    const anchor = parsed.hash;
    if (!/^#(?:pr|Sc)/i.test(anchor)) return url;
    const matchingRule = Object.values(SINGAPORE_STATUTORY_REPOSITORY).find((rule) => {
      try {
        const canonical = new URL(rule.canonicalUrl);
        return canonical.hostname === parsed.hostname && canonical.pathname === parsed.pathname && canonical.hash.toLowerCase() === anchor.toLowerCase();
      } catch {
        return false;
      }
    });
    return matchingRule?.canonicalUrl || '';
  } catch {
    return url;
  }
}

/**
 * Resolves a URL only when it exactly matches a URL with trusted registry or
 * live-validation provenance. This synchronous helper does not fetch URLs;
 * live retrieval performs reachability and topic checks before adding evidence.
 */
export function getSafeOfficialUrl(
  rawUrl?: string,
  statuteOrAct?: string,
  sectionOrSchedule?: string,
  authority?: string,
  verifiedEvidence: readonly AuthoritativeSourceRecord[] = []
): string {
  const url = (rawUrl || '').trim();

  const records = getUsableRegisteredRecords(verifiedEvidence);
  const rawNormalized = normalizeRegisteredUrl(url);
  if (rawNormalized) {
    const exact = records.find(record => normalizeRegisteredUrl(record.officialSourceUrl) === rawNormalized);
    if (exact && isApprovedSingaporeSourceUrl(exact.officialSourceUrl)) return exact.officialSourceUrl;

  }

  // When a model supplies a known instrument and section, resolve only to an
  // exact URL already stored in the source registry. No URL is constructed.
  if (statuteOrAct && sectionOrSchedule) {
    const requestedInstrument = normalizeTopicText(statuteOrAct);
    const requestedAuthority = authority?.toUpperCase();
    const matchingRecord = records.find(record => {
      const identity = normalizeTopicText(`${record.standardOrActCode} ${record.legalOrStandardInstrument} ${record.documentTitle}`);
      const instrumentMatches = identity.includes(requestedInstrument) || requestedInstrument.includes(normalizeTopicText(record.standardOrActCode));
      const authorityMatches = !requestedAuthority || record.authority.toUpperCase() === requestedAuthority || (requestedAuthority === 'ASC' && record.authority === 'ACRA');
      return instrumentMatches && authorityMatches && sectionMatches(record.paragraphOrSection, sectionOrSchedule);
    });
    if (matchingRecord && isApprovedSingaporeSourceUrl(matchingRecord.officialSourceUrl)) return matchingRecord.officialSourceUrl;

    const registeredRuleUrl = findRegisteredRuleUrl(statuteOrAct, sectionOrSchedule);
    if (registeredRuleUrl && isApprovedSingaporeSourceUrl(registeredRuleUrl)) return registeredRuleUrl;
  }

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
 * Sanitizes markdown and bare URLs against exact registry or answer-scoped
 * live-validation provenance. Unsupported URLs are removed or rendered as
 * plain anchor text.
 */
function getRegisteredUrlForAnchor(anchorText: string, verifiedEvidence: readonly AuthoritativeSourceRecord[]): string {
  const anchor = normalizeTopicText(anchorText);
  const rule = Object.values(SINGAPORE_STATUTORY_REPOSITORY).find(candidate => {
    const section = normalizeTopicText(candidate.sectionOrSchedule);
    const actTokens = normalizeTopicText(candidate.actTitle).split(/\s+/).filter(token => token.length > 2 && !/^\d{4}$/.test(token));
    const identifiesAct = actTokens.filter(token => anchor.includes(token)).length >= Math.min(2, actTokens.length);
    const sectionTokens = section.split(/\s+/).filter(token => token.length > 0);
    const identifiesSection = sectionTokens.some(token => anchor.includes(token));
    return identifiesAct && identifiesSection;
  });
  if (rule) {
    return getSafeOfficialUrl(undefined, rule.actTitle, rule.sectionOrSchedule, rule.authority, verifiedEvidence);
  }
  return '';
}

export function sanitizeStatutoryLinks(markdownText: string, verifiedEvidence: readonly AuthoritativeSourceRecord[] = []): string {
  if (!markdownText) return '';

  // Parentheses are valid URL-path characters and are used by IRAS (for
  // example, `/goods-services-tax-(gst)/`). Percent-encode them only when a
  // URL is emitted inside Markdown so they cannot terminate its `(...)`
  // destination early. The decoded destination remains the same official URL.
  const toMarkdownSafeUrl = (url: string): string =>
    url.replace(/\(/g, '%28').replace(/\)/g, '%29');

  // 1. Isolate all existing markdown links so text replacements never corrupt their anchors or urls
  const linkPlaceholders: string[] = [];
  let sanitized = markdownText.replace(/\[([^\]]+)\]\((https?:\/\/\S+)\)/g, (_match, anchorText, url) => {
    const cleanUrl = getSafeOfficialUrl(url, undefined, undefined, undefined, verifiedEvidence) || getRegisteredUrlForAnchor(anchorText, verifiedEvidence);

    const placeholder = `___MD_LINK_${linkPlaceholders.length}___`;
    linkPlaceholders.push(cleanUrl ? `[${anchorText}](${toMarkdownSafeUrl(cleanUrl)})` : anchorText);
    return placeholder;
  });

  const addLink = (anchor: string, linkUrl: string): string => {
    const safeUrl = getSafeOfficialUrl(linkUrl, undefined, undefined, undefined, verifiedEvidence);
    if (!safeUrl) return anchor;
    const placeholder = `___MD_LINK_${linkPlaceholders.length}___`;
    linkPlaceholders.push(`[${anchor}](${toMarkdownSafeUrl(safeUrl)})`);
    return placeholder;
  };

  // 2. Replace unlinked statutory patterns in remaining plain text
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*205C(?:\s*(?:&|and)\s*Thirteenth\s*Schedule)?)/gi,
    () => addLink('Companies Act 1967 Section 205C & Thirteenth Schedule', buildSsoUrl('CoA1967', '205C'))
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*199(?:\(1\))?)/gi,
    () => addLink('Companies Act 1967 Section 199', buildSsoUrl('CoA1967', '199'))
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*145(?:\(1\))?)/gi,
    () => addLink('Companies Act 1967 Section 145', buildSsoUrl('CoA1967', '145'))
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?\s*(?:Section|§)\s*(?:175|197))/gi,
    () => addLink('Companies Act 1967 Section 175 & 197', buildSsoUrl('CoA1967', '197'))
  );
  sanitized = sanitized.replace(
    /(?:Companies Act\s*(?:1967)?)(?!\w)/gi,
    () => addLink('Companies Act 1967', 'https://sso.agc.gov.sg/Act/CoA1967')
  );
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*15\(1\)\(k\))/gi,
    () => addLink('Income Tax Act 1947 Section 15(1)(k)', buildSsoUrl('ITA1947', '15'))
  );
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*14(?:\(1\))?)/gi,
    () => addLink('Income Tax Act 1947 Section 14(1)', buildSsoUrl('ITA1947', '14(1)'))
  );
  sanitized = sanitized.replace(
    /(?:Income Tax Act\s*(?:1947)?\s*(?:Section|§)\s*19A)/gi,
    () => addLink('Income Tax Act 1947 Section 19A', buildSsoUrl('ITA1947', '19A'))
  );
  sanitized = sanitized.replace(
    /(?:GST Act\s*(?:1993)?\s*(?:Section|§)\s*21(?:\(3\))?)/gi,
    () => addLink('Goods and Services Tax Act 1993 Section 21(3)', buildSsoUrl('GSTA1993', '21'))
  );
  sanitized = sanitized.replace(
    /(?:CPF Act\s*(?:1953)?\s*(?:Section|§)\s*(\d+[A-Za-z]?))/gi,
    (_, sec) => addLink(`Central Provident Fund Act 1953 Section ${sec}`, buildSsoUrl('CPFA1953', sec))
  );
  sanitized = sanitized.replace(
    /(?:Employment Act\s*(?:1968)?\s*(?:Section|§)\s*(\d+[A-Za-z]?))/gi,
    (_, sec) => addLink(`Employment Act 1968 Section ${sec}`, buildSsoUrl('EmA1968', sec))
  );
  sanitized = sanitized.replace(
    /(?:CPF Act\s*(?:1953)?)(?!\w)/gi,
    () => addLink('Central Provident Fund Act 1953', 'https://sso.agc.gov.sg/Act/CPFA1953')
  );
  sanitized = sanitized.replace(
    /(?:Employment Act\s*(?:1968)?)(?!\w)/gi,
    () => addLink('Employment Act 1968', 'https://sso.agc.gov.sg/Act/EmA1968')
  );

  // Remove bare URLs unless they resolve to an exact trusted source record.
  // Markdown destinations were already isolated above, so this only handles
  // free-form model text and never upgrades a guessed URL into a citation.
  sanitized = sanitized.replace(/https?:\/\/[^\s<>"']+/gi, rawUrl => {
    const trailingPunctuation = rawUrl.match(/[),.;!?]+$/)?.[0] || '';
    const candidateUrl = trailingPunctuation ? rawUrl.slice(0, -trailingPunctuation.length) : rawUrl;
    const safeUrl = getSafeOfficialUrl(candidateUrl, undefined, undefined, undefined, verifiedEvidence);
    return `${safeUrl ? toMarkdownSafeUrl(safeUrl) : ''}${trailingPunctuation}`;
  });

  // 3. Restore all original/cleaned markdown links
  sanitized = sanitized.replace(/___MD_LINK_(\d+)___/g, (_, idx) => linkPlaceholders[parseInt(idx, 10)] || '');

  return sanitized;
}

/**
 * Appends source links only when the response has matching verified source
 * records; otherwise it sanitizes existing links and leaves citations unlinked.
 */
export function appendStatutorySourceFooter(
  messageText: string,
  scenarioState?: any,
  verifiedEvidence: readonly AuthoritativeSourceRecord[] = []
): string {
  if (!messageText) return '';

  // If already has an explicit source footer block, just sanitize links
  if (
    messageText.includes('Official Statutory & Regulatory Verification Sources') ||
    messageText.includes('Official Verification Sources')
  ) {
    return sanitizeStatutoryLinks(messageText, verifiedEvidence);
  }

  const links: { title: string; url: string; authority?: string; isAskGov?: boolean }[] = [];

  // 1. Extract from statutory advisory
  if (scenarioState?.statutoryAdvisory && scenarioState.statutoryAdvisory.length > 0) {
    for (const adv of scenarioState.statutoryAdvisory) {
      // A placeholder such as "Statutory Directives" identifies no legal
      // provision. Do not let it suppress the provision-specific sources
      // resolved from the answer's grounded subject matter below.
      const isGenericDirective = /^(?:singapore\s+)?statutory(?:\s+and\s+tax)?\s+directives?$/i.test(
        (adv.sectionOrSchedule || '').trim()
      );
      if (isGenericDirective && !adv.officialUrl) continue;

      const safeUrl = getSafeOfficialUrl(adv.officialUrl, adv.statuteOrAct, adv.sectionOrSchedule, adv.authority, verifiedEvidence);
      if (safeUrl && !links.some((l) => l.url === safeUrl)) {
        links.push({
          title: `${adv.statuteOrAct} — ${adv.sectionOrSchedule}`,
          url: safeUrl,
          authority: adv.authority,
          isAskGov: isAskGovSingaporeUrl(safeUrl)
        });
      }
    }
  }

  // 2. Extract from directGroups citations
  if (scenarioState?.directGroups) {
    for (const grp of scenarioState.directGroups) {
      for (const cite of grp.citations || []) {
        const safeUrl = getSafeOfficialUrl(cite.officialSourceUrl, cite.standard, cite.paragraph, cite.authority, verifiedEvidence);
        if (safeUrl && !links.some((l) => l.url === safeUrl)) {
          links.push({
            title: `${cite.standard} ${cite.paragraph || ''}`.trim(),
            url: safeUrl,
            authority: cite.authority,
            isAskGov: isAskGovSingaporeUrl(safeUrl)
          });
        }
      }
    }
  }

  const addContextualLink = (title: string, url: string, authority: string) => {
    const safeUrl = getSafeOfficialUrl(url, undefined, undefined, authority, verifiedEvidence);
    if (safeUrl && !links.some((link) => link.url === safeUrl)) links.push({ title, url: safeUrl, authority, isAskGov: isAskGovSingaporeUrl(safeUrl) });
  };

  // Infer sources from the free-form answer only when no actual advisory or
  // citation source was supplied. Otherwise an LLM's incidental wording
  // (for example, "tax" or "Section 14") can add unrelated legislation to a
  // MAS/VCC response and falsely imply it supports the conclusion.
  if (links.length === 0) {
    const matchedRules = querySingaporeStatutes(messageText)
      .filter(rule => rule.sourceStatus === 'VERIFIED' && isRuleExplicitlyIdentified(rule, messageText))
      .slice(0, 3);
    for (const rule of matchedRules) {
      addContextualLink(`${rule.actTitle} — ${rule.sectionOrSchedule}`, rule.canonicalUrl, rule.authority);
    }
  }

  if (links.length === 0) return sanitizeStatutoryLinks(messageText, verifiedEvidence);

  const sourceItems = links
    .map((l) => {
      const candidate = verifiedEvidence.some(record => record.officialSourceUrl === l.url && record.lifecycleState === 'CANDIDATE');
      const label = l.isAskGov
        ? '*(Official agency FAQ via Ask.gov.sg — guidance)*'
        : candidate
          ? '*(Official page live-fetched for this answer — candidate evidence, not locally validated)*'
          : l.authority ? `*(${l.authority} / Registered Official Source)*` : '';
      return `* 🔗 [**${l.title}**](${l.url}) ${label}`;
    })
    .join('\n');

  const footerBlock = `\n\n---\n\n🏛️ **Official Statutory & Regulatory Verification Sources**:\n${sourceItems}\n*(Click any link to verify directly on the official Singapore legislation, agency source, or Ask.gov.sg FAQ used)*`;

  return sanitizeStatutoryLinks(messageText + footerBlock, verifiedEvidence);
}
