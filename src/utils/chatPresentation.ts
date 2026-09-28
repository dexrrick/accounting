import type { AccountingScenarioState, MissingFieldInfo } from '../types/accounting';
import { hasCurrentIrasEvidencePresentation } from './irasEvidencePresentation';

export interface OfficialAnswerLink {
  title: string;
  url: string;
}

// The legacy response footer is retained for API consumers. The chat displays
// a concise answer, while its official links remain accessible in the side tab.
export function extractOfficialAnswerLinks(messageText: string): OfficialAnswerLink[] {
  const footer = messageText.split(/Official Statutory & Regulatory Verification Sources|Official Verification Sources/i)[1];
  if (!footer) return [];
  const links: OfficialAnswerLink[] = [];
  for (const match of footer.matchAll(/\[\*\*([^\]]+)\*\*\]\((https:\/\/[^\s)]+)\)/g)) {
    try {
      const url = new URL(match[2]);
      if (!['sso.agc.gov.sg', 'www.cpf.gov.sg', 'cpf.gov.sg', 'www.acra.gov.sg', 'acra.gov.sg', 'www.mom.gov.sg', 'mom.gov.sg', 'www.iras.gov.sg', 'iras.gov.sg'].includes(url.hostname)) continue;
      if (!links.some(link => link.url === url.href)) links.push({ title: match[1], url: url.href });
    } catch { /* Ignore malformed provider links. */ }
  }
  return links;
}

export function createChatPreview(
  messageText: string,
  scenario: AccountingScenarioState,
  clarifications?: MissingFieldInfo[]
): string {
  const currentIrasPresentation = hasCurrentIrasEvidencePresentation(
    scenario.irasEvidencePresentation, scenario.rawQuery, scenario.primaryDomain, scenario.queryIntent
  ) ? scenario.irasEvidencePresentation : undefined;
  const group = scenario.projectedGroups?.at(-1) || scenario.directGroups?.at(-1);
  const hasBalancedGroup = Boolean(group?.lines?.length && group.isBalanced);
  const journalPreview = () => {
    if (!group) return '';
    const amount = `${scenario.functionalCurrency} ${group.totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    const prefix = scenario.isHypothetical ? 'For this hypothetical change, ' : '';
    const payrollGross = scenario.scenarioType === 'PAYROLL_CPF_SALARY'
      ? scenario.keyParameters?.find(fact => fact.label === 'Gross Prorated Salary')?.value
      : undefined;
    const detail = payrollGross
      ? `the prorated gross salary is ${payrollGross}. The CPF and SDL breakdown and balanced journal are in the tabs.`
      : `I prepared the balanced ${group.title.toLowerCase()} journal (${amount} on each side).`;
    return `${prefix}${detail}${scenario.isHypothetical ? ' The original transaction remains unchanged.' : ''}`;
  };

  if (currentIrasPresentation && !(scenario.queryIntent === 'HYBRID' && hasBalancedGroup)) {
    return currentIrasPresentation.chatAnswer;
  }

  const question = clarifications?.[0] || scenario.missingFields?.[0];
  if (question && !scenario.isComplete) return `I need one detail to continue: ${question.prompt}`;
  if (hasBalancedGroup) return journalPreview();
  if (currentIrasPresentation) return currentIrasPresentation.chatAnswer;

  const clean = messageText
    .split(/Official Statutory & Regulatory Verification Sources|Official Verification Sources/i)[0]
    .split('\n')
    .map(line => line.trim())
    .find(line => line && !/^(?:#|---|\*|[-•]|>|🏛️)/.test(line) && !/^\*\*/.test(line) &&
      !/^(?:admitted source evidence(?: and reviewed summaries)?|information still needed to complete the question|official sources?|supporting official guidance|verified guidance|application conclusions|application status|professional advisory caveat)\s*:?$/i.test(line)) ||
    scenario.accountingTreatmentSummary || 'I need more information to give a supportable answer.';
  const concise = clean.length > 350 ? `${clean.slice(0, 347).trimEnd()}…` : clean;
  return concise;
}
