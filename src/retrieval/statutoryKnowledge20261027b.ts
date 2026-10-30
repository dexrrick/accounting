import { ACRA_MOM_KNOWLEDGE_RULES_20261027B, getAcraMomKnowledgeEvidence,
  hasAcraMomKnowledgeContradiction, selectAcraMomKnowledgeQuotes, supportAcraMomKnowledgeRule } from './acraMomKnowledge20261027b';
import { IRAS_MAS_KNOWLEDGE_RULES_20261027B, getIrasMasKnowledgeEvidence,
  hasIrasMasKnowledgeContradiction, selectIrasMasKnowledgeQuotes, supportIrasMasKnowledgeRule } from './irasMasKnowledge20261027b';
import { CPF_PAYROLL_KNOWLEDGE_RULES_20261027B, getCpfPayrollKnowledgeEvidence,
  hasCpfPayrollKnowledgeContradiction, selectCpfPayrollKnowledgeQuotes, supportCpfPayrollKnowledgeRule } from './cpfPayrollKnowledge20261027b';
import { STATUTORY_WORKFLOW_RULES_20261029, getStatutoryWorkflowEvidence,
  hasStatutoryWorkflowContradiction, selectStatutoryWorkflowQuotes,
  supportStatutoryWorkflowRule } from './statutoryWorkflows20261029';
import type { PracticalExpansionRequest } from './practicalStatutoryExpansion';
import { TargetDateResolver } from './targetDateResolver';
import { supportMomAcraMasExpansionRule } from './momAcraMasExpansionRules';

export { getAcraMomKnowledgeEvidence, getIrasMasKnowledgeEvidence, getCpfPayrollKnowledgeEvidence };
export { getStatutoryWorkflowEvidence };

export const STATUTORY_KNOWLEDGE_RULES_20261027B = [
  ...ACRA_MOM_KNOWLEDGE_RULES_20261027B, ...IRAS_MAS_KNOWLEDGE_RULES_20261027B,
  ...CPF_PAYROLL_KNOWLEDGE_RULES_20261027B, ...STATUTORY_WORKFLOW_RULES_20261029
] as const;

const VCFM_NIL_FAQ_POINTER = {
  authority: 'MAS' as const, topicIds: ['mas-regulatory-reporting'],
  url: 'https://www.mas.gov.sg/-/media/mas/regulations-and-financial-stability/regulations-guidance-and-licensing/financial-advisers/faq/faqs-on-misconduct-reporting-notices-under-the-faa-ia-and-sfa.pdf',
  title: 'FAQs on the Misconduct Reporting Requirements under the FAA, IA and SFA',
  expectedTitles: ['FREQUENTLY ASKED QUESTIONS', 'THE MISCONDUCT REPORTING REQUIREMENTS'],
  standardIdentifiers: ['SFA', 'FAA'],
  contentTerms: ['nil return', '31 December 2026', '1 January 2027'], documentKind: 'PDF' as const
};

export const STATUTORY_KNOWLEDGE_POINTERS_20261027B = [...STATUTORY_KNOWLEDGE_RULES_20261027B.map(rule => ({
  authority: rule.authority, topicIds: rule.topicIds, url: rule.officialUrl, title: rule.title,
  expectedTitles: rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027' ? ['NOTICE ON REPORTING']
    : rule.id === 'MAS_LFMC_KEY_APPOINTMENTS' ? [rule.title, 'Licensed Fund Management Companies']
      : rule.id === 'MAS_VCFM_CHANGE_NOTIFICATIONS' || rule.id === 'MAS_VCFM_BUSINESS_CESSATION'
        ? [rule.title, 'Venture Capital Fund Managers']
      : rule.id === 'MAS_LFMC_TOOLKIT_SCOPE' ? [rule.title, 'COMPLIANCE TOOLKIT FOR LICENSED FUND MANAGEMENT COMPANIES', 'Licensed Fund Management Companies'] : [rule.title],
  standardIdentifiers: rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027' ? ['SFA 04-N24'] : [rule.authority],
  contentTerms: rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027' ? ['CMS licence', 'representatives', 'misconduct']
    : rule.id === 'MAS_VCFM_CHANGE_NOTIFICATIONS' ? ['Form 23A', 'particulars']
      : rule.id === 'MAS_VCFM_BUSINESS_CESSATION' ? ['Form 7', 'cessation', 'commenced']
    : rule.id === 'MAS_LFMC_TOOLKIT_SCOPE' ? ['not exhaustive', 'outside the SFA', 'fund-level requirements'] : undefined,
  documentKind: /\.pdf$/i.test(new URL(rule.officialUrl).pathname) || rule.id === 'CPF_2026_ADDITIONAL_WAGE_CEILING'
    ? 'PDF' as const : 'HTML' as const
})), VCFM_NIL_FAQ_POINTER];

export function supportStatutoryKnowledgeRule(request: PracticalExpansionRequest): boolean | undefined {
  return supportAcraMomKnowledgeRule(request) ?? supportIrasMasKnowledgeRule(request) ?? supportCpfPayrollKnowledgeRule(request)
    ?? supportStatutoryWorkflowRule(request)
    ?? (request.authority === 'MAS' && request.officialUrl === VCFM_NIL_FAQ_POINTER.url
      ? supportMomAcraMasExpansionRule(request) : undefined);
}

export function selectStatutoryKnowledgeQuotes(request: PracticalExpansionRequest): string[] {
  return [...new Set([...selectAcraMomKnowledgeQuotes(request), ...selectIrasMasKnowledgeQuotes(request),
    ...selectCpfPayrollKnowledgeQuotes(request), ...selectStatutoryWorkflowQuotes(request)])];
}

export function hasStatutoryKnowledgeContradiction(request: PracticalExpansionRequest): boolean {
  return hasAcraMomKnowledgeContradiction(request) || hasIrasMasKnowledgeContradiction(request)
    || hasCpfPayrollKnowledgeContradiction(request) || hasStatutoryWorkflowContradiction(request);
}

/** Explicit commencement prose, never a source-map or retrieval-date inference. */
export function sourceProvesKnowledgeDate(request: PracticalExpansionRequest, targetDate: string | undefined): boolean {
  if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)
      || !Number.isFinite(Date.parse(`${targetDate}T00:00:00Z`))
      || new Date(`${targetDate}T00:00:00Z`).toISOString().slice(0, 10) !== targetDate
      || targetDate > TargetDateResolver.CURRENT_SYSTEM_DATE) return false;
  const cpfRateTable = CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(item =>
    item.id === 'CPF_2026_CONTRIBUTION_TABLES' && item.authority === request.authority
    && item.topicIds.includes(request.topicId) && item.officialUrl === request.officialUrl);
  if (cpfRateTable && targetDate >= '2026-01-01' && targetDate <= '2026-12-31'
      && supportCpfPayrollKnowledgeRule(request) === true && selectCpfPayrollKnowledgeQuotes(request).length > 0) return true;
  const rule = ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(item => item.authority === request.authority
    && item.topicIds.includes(request.topicId) && item.officialUrl === request.officialUrl && item.effectiveFrom);
  return Boolean(rule?.effectiveFrom && targetDate >= rule.effectiveFrom
    && supportAcraMomKnowledgeRule(request) === true && selectAcraMomKnowledgeQuotes(request).length > 0);
}

/** Routing permission is bounded to rules that subsequently prove their date in the source body. */
export function knowledgePointerCoversDate(request: PracticalExpansionRequest, targetDate: string | undefined): boolean {
  return Boolean(targetDate && targetDate <= TargetDateResolver.CURRENT_SYSTEM_DATE
    && (CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.some(rule => rule.id === 'CPF_2026_CONTRIBUTION_TABLES'
      && rule.authority === request.authority && rule.topicIds.includes(request.topicId)
      && rule.officialUrl === request.officialUrl && targetDate >= '2026-01-01' && targetDate <= '2026-12-31'
      && supportCpfPayrollKnowledgeRule(request) !== undefined)
    || ACRA_MOM_KNOWLEDGE_RULES_20261027B.some(rule => rule.authority === request.authority
      && rule.topicIds.includes(request.topicId) && rule.officialUrl === request.officialUrl
      && rule.effectiveFrom && targetDate >= rule.effectiveFrom
      && supportAcraMomKnowledgeRule(request) !== undefined)));
}
