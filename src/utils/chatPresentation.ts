import type { AccountingScenarioState, MissingFieldInfo } from '../types/accounting';
import { hasCurrentIrasEvidencePresentation } from './irasEvidencePresentation';
import { hasCurrentAuthorityEvidencePresentation } from './authorityEvidencePresentation';

export interface OfficialAnswerLink {
  title: string;
  url: string;
}

function findAdmittedRule(
  presentation: NonNullable<AccountingScenarioState['irasEvidencePresentation']>,
  requiredPhrases: readonly string[]
): { text: string; sourceReference: string } | undefined {
  for (const [groupIndex, group] of presentation.sourceGroups.entries()) {
    if (!group.canonicalUrl) continue;
    for (const passage of group.passages) {
      if (passage.supportKind !== 'EXACT_SOURCE_QUOTE') continue;
      const normalized = passage.text.toLowerCase().replace(/\s+/g, ' ');
      if (requiredPhrases.every(phrase => normalized.includes(phrase))) {
        return { text: passage.text, sourceReference: `[${groupIndex + 1}]` };
      }
    }
  }
  return undefined;
}

function conciseSecondmentAnswer(
  presentation: NonNullable<AccountingScenarioState['irasEvidencePresentation']>
): string | undefined {
  if (presentation.status === 'INSUFFICIENT' || !/\b(?:overseas|secondment)\b/i.test(presentation.query)) return undefined;
  const whollyOverseas = findAdmittedRule(presentation, [
    'full employment services wholly outside singapore', 'not liable to tax in singapore'
  ]);
  const incidentalEmployment = findAdmittedRule(presentation, [
    'your overseas employment is incidental to your singapore employment',
    'travel overseas', 'fully taxable in singapore'
  ]);
  const foreignTaxCredit = findAdmittedRule(presentation, [
    'anyone claiming ftc must satisfy all of the following conditions',
    'tax resident in singapore for the relevant basis year',
    'tax has been paid or is payable on the same income in the foreign country',
    'the income is taxable in singapore'
  ]);
  const dtaBenefits = findAdmittedRule(presentation, [
    'derive income from a foreign country/jurisdiction',
    'may claim dta benefits',
    'reduced tax rate or tax exemption in that jurisdiction'
  ]);
  const dtaGeneralRelief = findAdmittedRule(presentation, [
    'double taxation agreements (dtas)', 'depending on the provisions of the dta'
  ]);
  const dtaRelief = dtaBenefits || dtaGeneralRelief;
  if (!whollyOverseas || !incidentalEmployment || !foreignTaxCredit || !dtaRelief) return undefined;
  const employmentSources = whollyOverseas.sourceReference === incidentalEmployment.sourceReference
    ? whollyOverseas.sourceReference
    : `${whollyOverseas.sourceReference}, ${incidentalEmployment.sourceReference}`;
  const conditionalDetail = presentation.status === 'CONDITIONAL'
    ? ', and application remains conditional on the secondment facts; see Supporting Official Guidance for the full admitted wording'
    : '';
  const dtaSentence = dtaBenefits
    ? `For foreign-country income that may be taxed there, a Singapore tax resident may claim DTA benefits for a reduced rate or exemption in that jurisdiction ${dtaBenefits.sourceReference}${conditionalDetail}.`
    : `DTA protection from double taxation depends on the applicable agreement's provisions ${dtaRelief.sourceReference}${conditionalDetail}.`;
  return [
    `IRAS says employment income is not liable to Singapore tax when the employee is contracted to provide full services wholly outside Singapore; overseas travel incidental to Singapore employment is fully taxable ${employmentSources}.`,
    `A foreign tax credit requires Singapore tax residency for the relevant basis year, foreign tax paid or payable on the same income, and the income to be taxable in Singapore ${foreignTaxCredit.sourceReference}.`,
    dtaSentence
  ].join(' ');
}

function conciseIrasPreview(presentation: NonNullable<AccountingScenarioState['irasEvidencePresentation']>): string {
  if (presentation.calculationLead) {
    return `${presentation.calculationLead} ${irasPanelPointer(presentation.status)}`;
  }
  return conciseSecondmentAnswer(presentation) || irasPanelPointer(presentation.status);
}

function irasPanelPointer(status: NonNullable<AccountingScenarioState['irasEvidencePresentation']>['status']): string {
  if (status === 'INSUFFICIENT') {
    return 'The verified IRAS evidence is incomplete for this question; see Supporting Official Guidance for covered sources and gaps.';
  }
  if (status === 'CONDITIONAL') {
    return 'The verified IRAS rules depend on facts not established here; see Supporting Official Guidance for admitted passages and facts to confirm.';
  }
  return 'The complete admitted IRAS passages are in Supporting Official Guidance.';
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
  const currentAuthorityPresentation = hasCurrentAuthorityEvidencePresentation(
    scenario.authorityEvidencePresentation, scenario.rawQuery
  ) ? scenario.authorityEvidencePresentation : undefined;
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

  if (currentAuthorityPresentation) {
    if (scenario.queryIntent === 'HYBRID' && hasBalancedGroup) {
      return `${journalPreview()} The whole-question evidence review and any open gaps are in Supporting Official Guidance.`;
    }
    const authorityClarification = clarifications?.[0] || scenario.missingFields?.[0];
    if (authorityClarification && !scenario.isComplete) {
      return `I need one detail to continue: ${authorityClarification.prompt} The whole-question evidence review is in Supporting Official Guidance.`;
    }
    if (currentAuthorityPresentation.status === 'INSUFFICIENT') {
      return 'The whole-question evidence is incomplete for one or more material workstreams; see Supporting Official Guidance for issue-level sources and gaps.';
    }
    if (currentAuthorityPresentation.status === 'CONDITIONAL') {
      return 'Verified source coverage is available, but application remains unresolved for one or more workstreams; see Supporting Official Guidance.';
    }
    return 'Verified evidence covers the resolved material workstreams; see Supporting Official Guidance for issue scopes and source excerpts.';
  }

  if (currentIrasPresentation && !(scenario.queryIntent === 'HYBRID' && hasBalancedGroup)) {
    return conciseIrasPreview(currentIrasPresentation);
  }

  const question = clarifications?.[0] || scenario.missingFields?.[0];
  if (question && !scenario.isComplete) return `I need one detail to continue: ${question.prompt}`;
  if (hasBalancedGroup) return journalPreview();
  if (currentIrasPresentation) return conciseIrasPreview(currentIrasPresentation);

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
