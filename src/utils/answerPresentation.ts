import type { OfficialAnswerLink } from './chatPresentation';

const OFFICIAL_ANSWER_HOST_LABELS: Readonly<Record<string, string>> = {
  'sso.agc.gov.sg': 'Singapore Statutes Online',
  'cpf.gov.sg': 'CPF',
  'www.cpf.gov.sg': 'CPF',
  'mom.gov.sg': 'MOM',
  'www.mom.gov.sg': 'MOM',
  'acra.gov.sg': 'ACRA',
  'www.acra.gov.sg': 'ACRA',
  'iras.gov.sg': 'IRAS',
  'www.iras.gov.sg': 'IRAS',
  'mas.gov.sg': 'MAS',
  'www.mas.gov.sg': 'MAS'
};

export function canonicalizeOfficialAnswerLink(link: OfficialAnswerLink): OfficialAnswerLink | undefined {
  if (!link || typeof link.url !== 'string') return undefined;
  try {
    const url = new URL(link.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.href !== link.url) return undefined;
    return { title: typeof link.title === 'string' && link.title ? link.title : url.hostname, url: link.url };
  } catch {
    return undefined;
  }
}

export function getOfficialAnswerAuthorityLabel(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? OFFICIAL_ANSWER_HOST_LABELS[parsed.hostname.toLowerCase()] : undefined;
  } catch {
    return undefined;
  }
}

/** Canonical HTTPS destinations from the scenario's existing citation allowlist only. */
export function getCanonicalOfficialAnswerLinks(links: readonly OfficialAnswerLink[] | undefined): OfficialAnswerLink[] {
  const seen = new Set<string>();
  const canonical: OfficialAnswerLink[] = [];
  for (const link of links || []) {
    const allowed = canonicalizeOfficialAnswerLink(link);
    if (!allowed || seen.has(allowed.url)) continue;
    seen.add(allowed.url);
    canonical.push(allowed);
  }
  return canonical;
}

/** Move only an existing explicit Answer section. All other lines remain intact and in order. */
export function prioritizeExplicitAnswerSection(text: string): string {
  const lines = text.split(/\r?\n/);
  const headingAt = lines.findIndex(line => /^\s*(#{1,6})\s+(?:\*\*)?(?:direct answer|answer)(?:\*\*)?\s*#*\s*$/i.test(line));
  if (headingAt <= 0) return text;

  const heading = lines[headingAt].match(/^\s*(#{1,6})/);
  if (!heading) return text;
  const level = heading[1].length;
  let end = lines.length;
  for (let index = headingAt + 1; index < lines.length; index += 1) {
    const nextHeading = lines[index].match(/^\s*(#{1,6})\s+/);
    if (nextHeading && nextHeading[1].length <= level) {
      end = index;
      break;
    }
  }

  const answerSection = lines.slice(headingAt, end);
  const remaining = [...lines.slice(0, headingAt), ...lines.slice(end)];
  return [...answerSection, ...remaining].join('\n');
}
