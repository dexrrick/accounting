import type { StandardCitation, StatutoryAdvisoryInfo } from '../types/accounting';
import { ACRA_STATUTE_RULES } from './statutes/acra';
import { CPF_STATUTE_RULES } from './statutes/cpf';
import { GST_STATUTE_RULES } from './statutes/gst';
import { IRAS_STATUTE_RULES } from './statutes/iras';
import { MAS_STATUTE_RULES } from './statutes/mas';
import { MOM_STATUTE_RULES } from './statutes/mom';
import type { SingaporeStatuteRule } from './statutes/types';

export type { SingaporeStatuteRule } from './statutes/types';

/** Stable public registry assembled from independently maintained rule packs. */
export const SINGAPORE_STATUTORY_REPOSITORY: Record<string, SingaporeStatuteRule> = {
  ...IRAS_STATUTE_RULES,
  ...GST_STATUTE_RULES,
  ...ACRA_STATUTE_RULES,
  ...CPF_STATUTE_RULES,
  ...MOM_STATUTE_RULES,
  ...MAS_STATUTE_RULES
};

/** Search the statutory repository by keyword or category, ranked by relevance. */
export function querySingaporeStatutes(query: string): SingaporeStatuteRule[] {
  const q = query.toLowerCase().trim();
  const queryWords = q.split(/\s+/).filter(word => word.length >= 3 && !['what', 'when', 'where', 'which', 'how', 'the', 'for', 'and', 'are'].includes(word));
  const scoredResults: { rule: SingaporeStatuteRule; score: number }[] = [];

  for (const rule of Object.values(SINGAPORE_STATUTORY_REPOSITORY)) {
    let matchScore = 0;
    for (const tag of rule.tags) if (q.includes(tag)) matchScore += 8;
    if (q.includes(rule.sectionOrSchedule.toLowerCase())) matchScore += 10;
    if (rule.ruleTitle.toLowerCase().includes(q)) matchScore += 10;
    for (const word of queryWords) {
      if (rule.ruleTitle.toLowerCase().includes(word)) matchScore += 3;
      if (rule.sectionOrSchedule.toLowerCase().includes(word)) matchScore += 4;
      if (rule.tags.some(tag => tag.includes(word))) matchScore += 2;
      if (rule.principle.toLowerCase().includes(word)) matchScore += 1;
      if (rule.practicalRules.some(practicalRule => practicalRule.toLowerCase().includes(word))) matchScore += 1;
    }
    const historical = rule.sourceStatus === 'HISTORICAL';
    const asksHistorical = q.includes('historical') || q.includes('prior') || q.includes('former') || q.includes('superseded');
    const year = q.match(/\b(19\d\d|20\d\d)\b/)?.[1];
    if (year) {
      const fromYear = rule.validFrom?.slice(0, 4);
      const toYear = rule.validTo?.slice(0, 4);
      if (fromYear && year >= fromYear && (!toYear || year <= toYear)) matchScore += 20;
      else if ((toYear && year > toYear) || (fromYear && year < fromYear)) matchScore -= 30;
    } else if (historical && !asksHistorical) matchScore -= 40;
    else if (rule.sourceStatus === 'VERIFIED') matchScore += 10;
    if (matchScore > 0) scoredResults.push({ rule, score: matchScore });
  }
  return scoredResults.sort((a, b) => b.score - a.score).map(result => result.rule);
}

export function convertToCitation(rule: SingaporeStatuteRule): StandardCitation {
  return { standard: `${rule.actTitle} (${rule.authority})`, paragraph: rule.sectionOrSchedule, title: rule.ruleTitle, text: rule.principle, officialSourceUrl: rule.canonicalUrl, authority: rule.authority };
}

export function convertToAdvisory(rule: SingaporeStatuteRule): StatutoryAdvisoryInfo {
  return {
    authority: rule.authority, statuteOrAct: rule.actTitle, sectionOrSchedule: rule.sectionOrSchedule, topic: rule.ruleTitle,
    summary: rule.principle, keyRules: rule.practicalRules, officialUrl: rule.canonicalUrl,
    isTaxDeductible: rule.id === 'ITA_SEC15_PROHIBITED_DEDUCTIONS' ? false : (rule.id === 'ITA_SEC14_GENERAL_DEDUCTION' || rule.id === 'ITA_SEC14C_EIS_INNOVATION') ? true : undefined,
    // Output zero-rating does not establish input-tax recovery. Leave the
    // latter undecided until the ordinary attribution and blocked-input rules
    // are assessed for the purchase.
  };
}
