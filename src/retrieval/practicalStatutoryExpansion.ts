import { hasIrasCpfExpansionContradiction, selectIrasCpfExpansionQuotes, supportIrasCpfExpansionRule } from './irasCpfExpansionRules';
import { hasMomAcraMasExpansionContradiction, selectMomAcraMasExpansionQuotes, supportMomAcraMasExpansionRule } from './momAcraMasExpansionRules';
import { hasAcraMomPracticalContradiction, selectAcraMomPracticalQuotes, supportAcraMomPracticalRule } from './acraMomPracticalRules20261027';
import { IRAS_CPF_MAS_PRACTICAL_RULES_20261027, hasIrasCpfMasPracticalContradiction, selectIrasCpfMasPracticalQuotes, supportIrasCpfMasPracticalRule } from './irasCpfMasPracticalRules20261027';
import { STATUTORY_KNOWLEDGE_POINTERS_20261027B, hasStatutoryKnowledgeContradiction,
  selectStatutoryKnowledgeQuotes, supportStatutoryKnowledgeRule } from './statutoryKnowledge20261027b';

/** Additive full-family proofs; incomplete proofs do not replace narrower legacy rules. */
export interface PracticalExpansionRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  officialUrl?: string;
}

export function supportPracticalExpansionRule(request: PracticalExpansionRequest): boolean | undefined {
  const knowledge = supportStatutoryKnowledgeRule(request);
  if (knowledge === true) return true;
  if (hasStatutoryKnowledgeContradiction(request)) return false;
  return supportIrasCpfExpansionRule(request) ?? supportMomAcraMasExpansionRule(request)
    ?? supportAcraMomPracticalRule(request) ?? supportIrasCpfMasPracticalRule(request) ?? knowledge;
}

export function selectPracticalExpansionQuotes(request: PracticalExpansionRequest): string[] {
  const knowledgeQuotes = selectStatutoryKnowledgeQuotes(request);
  if (knowledgeQuotes.length > 0) return knowledgeQuotes;
  return [...new Set([
    ...selectIrasCpfExpansionQuotes(request), ...selectMomAcraMasExpansionQuotes(request),
    ...selectAcraMomPracticalQuotes(request), ...selectIrasCpfMasPracticalQuotes(request)
  ])];
}

export function hasPracticalExpansionContradiction(request: PracticalExpansionRequest): boolean {
  return hasStatutoryKnowledgeContradiction(request) || hasIrasCpfExpansionContradiction(request) || hasMomAcraMasExpansionContradiction(request)
    || hasAcraMomPracticalContradiction(request) || hasIrasCpfMasPracticalContradiction(request);
}

// Retrieval pointers are not evidence or source activation. Bodies, dates and
// every selected premise must pass the existing admission/verification path.
const CURRENT_POINTERS = [...IRAS_CPF_MAS_PRACTICAL_RULES_20261027.map(rule => ({
  authority: rule.authority, topicIds: rule.topicIds, url: rule.officialUrl, title: rule.title
})), ...STATUTORY_KNOWLEDGE_POINTERS_20261027B];
const STATUTORY_KNOWLEDGE_POINTER_SET = new Set<(typeof CURRENT_POINTERS)[number]>(STATUTORY_KNOWLEDGE_POINTERS_20261027B);

export function practicalExpansionPointers(request: PracticalExpansionRequest): typeof CURRENT_POINTERS {
  return CURRENT_POINTERS.filter(pointer => {
    if (pointer.authority !== request.authority || !pointer.topicIds.includes(request.topicId)) return false;
    const pointerRequest = { ...request, officialUrl: pointer.url };
    // A new knowledge pointer is useful only when its own rule family recognizes
    // the requested issue. Otherwise a legacy rule on the same broad topic may
    // return false for this URL and accidentally route an unrelated question to it.
    return STATUTORY_KNOWLEDGE_POINTER_SET.has(pointer)
      ? supportStatutoryKnowledgeRule(pointerRequest) !== undefined
      : supportPracticalExpansionRule(pointerRequest) !== undefined;
  });
}
