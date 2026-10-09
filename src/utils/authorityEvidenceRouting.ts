import type { QuestionClassificationResult } from '../classification/questionClassifier';
import type { SemanticIssueReconciliation } from '../services/semanticQuestionUnderstanding';
import { planAuthorityWorkstreams } from '../services/authorityWorkstreams';

function requestedScopeCount(issuePlan: SemanticIssueReconciliation): number {
  // Canonical domains are retained even for unmapped issues when their
  // authority/population are known; these must reach the generic gap view.
  return planAuthorityWorkstreams(issuePlan).filter(workstream =>
    workstream.authority !== 'UNKNOWN' && workstream.domain !== 'UNKNOWN'
  ).length;
}

function classifierIncludesAuthority(classification: QuestionClassificationResult, authority: string): boolean {
  const classified = new Set(classification.authorities.map(item => item.toUpperCase()));
  if (authority === 'ACCOUNTING_STANDARDS') return classified.has('ACCOUNTING_STANDARDS') || classified.has('ACRA') || classified.has('ASC');
  if (authority === 'IFRS_FOUNDATION') return classified.has('IFRS_FOUNDATION') || classified.has('ACRA') || classified.has('ASC');
  if (authority === 'SSO') return classified.has('SSO') || classified.has('AGC');
  return classified.has(authority);
}

function scopesAgreeWithClassification(issuePlan: SemanticIssueReconciliation, classification: QuestionClassificationResult): boolean {
  const classifiedDomains = new Set<string>(classification.domains);
  const planned = planAuthorityWorkstreams(issuePlan).filter(workstream =>
    workstream.authority !== 'UNKNOWN' && workstream.domain !== 'UNKNOWN'
  );
  return planned.length > 1 && planned.every(workstream =>
    classifierIncludesAuthority(classification, workstream.authority) &&
    [workstream.domain, ...workstream.sourceSections].some(domain => classifiedDomains.has(domain))
  );
}

/** Guards the additive runtime so classifier fallback metadata alone cannot reroute ordinary journals. */
export function shouldUseAuthorityEvidenceRuntime(input: {
  issuePlan: SemanticIssueReconciliation;
  classification: QuestionClassificationResult;
  explicitIrasEvidenceRequest: boolean;
  hasImages: boolean;
}): boolean {
  const { issuePlan, classification } = input;
  if (input.hasImages) return false;

  // Validated semantic issue decomposition is the strongest signal that the
  // user requested independently governed material questions. Keep the
  // generic path when any additional material issue is unresolved, even if
  // its authority/topic cannot be grouped into a second canonical stream.
  if (issuePlan.source === 'SEMANTIC_ISSUES') {
    return issuePlan.issues.length > 1 && (
      requestedScopeCount(issuePlan) > 1 || issuePlan.hasUnmappedResidual ||
      issuePlan.issues.some(issue => issue.status !== 'MAPPED' || issue.domain === 'UNKNOWN')
    );
  }

  // When fallback taxonomy resolves one non-IRAS workstream but cannot
  // account for the full explicitly requested tax question, show that known
  // workstream alongside the unresolved residual. This exposes uncertainty
  // without inventing the missing authority or topic.
  const plannedScopes = planAuthorityWorkstreams(issuePlan).filter(workstream =>
    workstream.authority !== 'UNKNOWN' && workstream.domain !== 'UNKNOWN'
  );
  const classifiedDomains = new Set<string>(classification.domains);
  const singleKnownScope = plannedScopes.length === 1 ? plannedScopes[0] : undefined;
  if (issuePlan.hasUnmappedResidual && singleKnownScope &&
      singleKnownScope.authority !== 'IRAS' && input.explicitIrasEvidenceRequest &&
      classification.intent === 'STATUTORY_ADVISORY' &&
      !classification.accountingAnalysisRequired && !classification.journalEntryRequired &&
      classifierIncludesAuthority(classification, singleKnownScope.authority) &&
      [singleKnownScope.domain, ...singleKnownScope.sourceSections].some(domain => classifiedDomains.has(domain))) {
    return true;
  }

  // A taxonomy fallback is only eligible when a separate statutory question
  // is explicit; inferred GST on an ordinary journal is not enough.
  if (requestedScopeCount(issuePlan) < 2) return false;
  if (!scopesAgreeWithClassification(issuePlan, classification)) return false;
  if (input.explicitIrasEvidenceRequest) return true;
  return classification.intent === 'STATUTORY_ADVISORY' &&
    classification.regulatoryAnalysisRequired &&
    !classification.authorities.includes('IRAS') &&
    classification.authorities.length > 1 &&
    classification.domains.length > 1;
}
