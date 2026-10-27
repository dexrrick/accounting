import { hasIrasCpfExpansionContradiction, selectIrasCpfExpansionQuotes, supportIrasCpfExpansionRule } from './irasCpfExpansionRules';
import { hasMomAcraMasExpansionContradiction, selectMomAcraMasExpansionQuotes, supportMomAcraMasExpansionRule } from './momAcraMasExpansionRules';
import { hasAcraMomPracticalContradiction, selectAcraMomPracticalQuotes, supportAcraMomPracticalRule } from './acraMomPracticalRules20261027';
import { IRAS_CPF_MAS_PRACTICAL_RULES_20261027, hasIrasCpfMasPracticalContradiction, selectIrasCpfMasPracticalQuotes, supportIrasCpfMasPracticalRule } from './irasCpfMasPracticalRules20261027';

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
  return supportIrasCpfExpansionRule(request) ?? supportMomAcraMasExpansionRule(request)
    ?? supportAcraMomPracticalRule(request) ?? supportIrasCpfMasPracticalRule(request);
}

export function selectPracticalExpansionQuotes(request: PracticalExpansionRequest): string[] {
  return [...new Set([
    ...selectIrasCpfExpansionQuotes(request), ...selectMomAcraMasExpansionQuotes(request),
    ...selectAcraMomPracticalQuotes(request), ...selectIrasCpfMasPracticalQuotes(request)
  ])];
}

export function hasPracticalExpansionContradiction(request: PracticalExpansionRequest): boolean {
  return hasIrasCpfExpansionContradiction(request) || hasMomAcraMasExpansionContradiction(request)
    || hasAcraMomPracticalContradiction(request) || hasIrasCpfMasPracticalContradiction(request);
}

// Retrieval pointers are not evidence or source activation. Bodies, dates and
// every selected premise must pass the existing admission/verification path.
const CURRENT_POINTERS = IRAS_CPF_MAS_PRACTICAL_RULES_20261027.map(rule => ({
  authority: rule.authority, topicIds: rule.topicIds, url: rule.officialUrl, title: rule.title
}));

export function practicalExpansionPointers(request: PracticalExpansionRequest): typeof CURRENT_POINTERS {
  return CURRENT_POINTERS.filter(pointer => pointer.authority === request.authority && pointer.topicIds.includes(request.topicId)
    && supportPracticalExpansionRule({ ...request, officialUrl: pointer.url }) !== undefined);
}
