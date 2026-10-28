import { ACRA_MOM_KNOWLEDGE_RULES_20261027B, getAcraMomKnowledgeEvidence,
  hasAcraMomKnowledgeContradiction, selectAcraMomKnowledgeQuotes, supportAcraMomKnowledgeRule } from './acraMomKnowledge20261027b';
import { IRAS_MAS_KNOWLEDGE_RULES_20261027B, getIrasMasKnowledgeEvidence,
  hasIrasMasKnowledgeContradiction, selectIrasMasKnowledgeQuotes, supportIrasMasKnowledgeRule } from './irasMasKnowledge20261027b';
import { CPF_PAYROLL_KNOWLEDGE_RULES_20261027B, getCpfPayrollKnowledgeEvidence,
  hasCpfPayrollKnowledgeContradiction, selectCpfPayrollKnowledgeQuotes, supportCpfPayrollKnowledgeRule } from './cpfPayrollKnowledge20261027b';
import type { PracticalExpansionRequest } from './practicalStatutoryExpansion';
import { TargetDateResolver } from './targetDateResolver';

export { getAcraMomKnowledgeEvidence, getIrasMasKnowledgeEvidence, getCpfPayrollKnowledgeEvidence };

export const STATUTORY_KNOWLEDGE_RULES_20261027B = [
  ...ACRA_MOM_KNOWLEDGE_RULES_20261027B, ...IRAS_MAS_KNOWLEDGE_RULES_20261027B,
  ...CPF_PAYROLL_KNOWLEDGE_RULES_20261027B
] as const;

export const STATUTORY_KNOWLEDGE_POINTERS_20261027B = STATUTORY_KNOWLEDGE_RULES_20261027B.map(rule => ({
  authority: rule.authority, topicIds: rule.topicIds, url: rule.officialUrl, title: rule.title,
  expectedTitles: rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027' ? ['NOTICE ON REPORTING'] : [rule.title],
  standardIdentifiers: rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027' ? ['SFA 04-N24'] : [rule.authority],
  contentTerms: rule.id === 'MAS_SFA_MISCONDUCT_REPORTING_2027' ? ['CMS licence', 'representatives', 'misconduct'] : undefined,
  documentKind: /\.pdf$/i.test(new URL(rule.officialUrl).pathname) || rule.id === 'CPF_2026_ADDITIONAL_WAGE_CEILING'
    ? 'PDF' as const : 'HTML' as const
}));

export function supportStatutoryKnowledgeRule(request: PracticalExpansionRequest): boolean | undefined {
  return supportAcraMomKnowledgeRule(request) ?? supportIrasMasKnowledgeRule(request) ?? supportCpfPayrollKnowledgeRule(request);
}

export function selectStatutoryKnowledgeQuotes(request: PracticalExpansionRequest): string[] {
  return [...new Set([...selectAcraMomKnowledgeQuotes(request), ...selectIrasMasKnowledgeQuotes(request),
    ...selectCpfPayrollKnowledgeQuotes(request)])];
}

export function hasStatutoryKnowledgeContradiction(request: PracticalExpansionRequest): boolean {
  return hasAcraMomKnowledgeContradiction(request) || hasIrasMasKnowledgeContradiction(request)
    || hasCpfPayrollKnowledgeContradiction(request);
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
