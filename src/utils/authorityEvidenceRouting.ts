import type { QuestionClassificationResult } from '../classification/questionClassifier';
import {
  isConservativeUnmappedAccountingRuleExplanationIntent,
  type SemanticAuthority,
  type SemanticIssueReconciliation,
  type SemanticQuestionOperation
} from '../services/semanticQuestionUnderstanding';
import { planAuthorityWorkstreams } from '../services/authorityWorkstreams';
import { getCoverageTopicsByIds } from '../standards/coverageRegistry';

const NON_IRAS_STATUTORY_AUTHORITIES = new Set(['ACRA', 'CPF', 'MOM', 'MAS']);

function isNonIrasStatutoryAuthority(authority: SemanticAuthority): authority is 'ACRA' | 'CPF' | 'MOM' | 'MAS' {
  return NON_IRAS_STATUTORY_AUTHORITIES.has(authority);
}

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

function hasMappedGovernedStatutoryWorkstream(
  issuePlan: SemanticIssueReconciliation,
  classification: QuestionClassificationResult
): boolean {
  const classifiedDomains = new Set<string>(classification.domains);
  return planAuthorityWorkstreams(issuePlan).some(workstream => {
    const authority = workstream.authority;
    if (!isNonIrasStatutoryAuthority(authority) ||
        workstream.domain === 'UNKNOWN' ||
        workstream.domain === 'ACCOUNTING' ||
        !classifierIncludesAuthority(classification, workstream.authority) ||
        ![workstream.domain, ...workstream.sourceSections].some(domain => classifiedDomains.has(domain))) {
      return false;
    }

    return issuePlan.issues.some(issue => issue.status === 'MAPPED' &&
      workstream.issueIds.includes(issue.id) &&
      issue.governingAuthorities.includes(authority) &&
      getCoverageTopicsByIds(issue.mappedTopicIds).some(topic =>
        topic.authorities.includes(authority) &&
        !topic.domainId.startsWith('ACCOUNTING_') &&
        workstream.sourceSections.includes(topic.domainId)));
  });
}

const FOCUSED_MAS_DOCUMENT_TOPICS = new Set([
  'mas-fund-management-licensing-admission-criteria',
  'mas-vcc-substantive-fund-management-activity'
]);

function hasFocusedMasDocumentIssue(issuePlan: SemanticIssueReconciliation): boolean {
  return issuePlan.issues.some(issue => issue.status === 'MAPPED' && issue.domain === 'MAS_FUNDS' &&
    issue.governingAuthorities.includes('MAS') &&
    issue.mappedTopicIds.some(topicId => FOCUSED_MAS_DOCUMENT_TOPICS.has(topicId)));
}

function hasMappedGeneralIrasRuleIssue(
  issuePlan: SemanticIssueReconciliation,
  classification: QuestionClassificationResult
): boolean {
  const irasIssues = issuePlan.issues.filter(issue => issue.status === 'MAPPED' &&
    issue.governingAuthorities.length === 1 && issue.governingAuthorities[0] === 'IRAS');
  if (irasIssues.length < 1) return false;
  const classifiedDomains = new Set<string>(classification.domains);
  const hasOtherRequestedIssue = issuePlan.issues.some(issue => !issue.governingAuthorities.includes('IRAS') &&
    !(issue.operation === 'OTHER' && issue.mappedTopicIds.length === 0 && (issue.contextualTopicIds?.length || 0) > 0));
  if (hasOtherRequestedIssue || !classification.authorities.includes('IRAS')) return false;
  return irasIssues.every(issue => {
    if (issue.operation !== 'EXPLAIN_RULE' || issue.population !== 'COMPANY' ||
        issue.domain !== 'IRAS_GST' && issue.domain !== 'IRAS_INCOME_TAX' ||
        !issue.mappedTopicIds.length) return false;
    const topics = getCoverageTopicsByIds(issue.mappedTopicIds);
    return topics.length === issue.mappedTopicIds.length && topics.every(topic =>
      topic.authorities.includes('IRAS') && ['IRAS_GST', 'IRAS_CORPORATE_TAX'].includes(topic.domainId) &&
      [topic.domainId, issue.domain, ...topic.legacyDomains].some(domain => classifiedDomains.has(domain))
    );
  });
}

function hasBoundedCpfCalculationAndRefundIssues(
  issuePlan: SemanticIssueReconciliation,
  classification: QuestionClassificationResult
): boolean {
  if (!classification.calculationRequired || classification.journalEntryRequired ||
      classification.accountingAnalysisRequired || classification.missingFacts.length === 0 ||
      !classification.authorities.includes('CPF')) return false;
  const calculation = issuePlan.issues.find(issue => issue.status === 'MAPPED' &&
    issue.domain === 'CPF_PAYROLL' && issue.operation === 'CALCULATE' &&
    issue.population === 'EMPLOYER' && issue.governingAuthorities.length === 1 &&
    issue.governingAuthorities[0] === 'CPF' &&
    issue.mappedTopicIds.some(topicId => ['cpf_contribution_rates', 'cpf-contribution-computation'].includes(topicId)));
  const refund = issuePlan.issues.find(issue => issue.status === 'MAPPED' &&
    issue.domain === 'CPF_PAYROLL' && issue.operation === 'EXPLAIN_RULE' &&
    issue.population === 'EMPLOYER' && issue.governingAuthorities.length === 1 &&
    issue.governingAuthorities[0] === 'CPF' &&
    issue.mappedTopicIds.includes('cpf-adjustments-refunds'));
  return Boolean(calculation && refund && calculation.id !== refund.id);
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

  // The narrowly bounded payroll calculation path presents its unresolved
  // inputs beside an independently requested, mapped employer refund rule.
  // Missing calculation facts are mandatory, and ordinary journal/accounting
  // requests remain on their established transaction path.
  if (hasBoundedCpfCalculationAndRefundIssues(issuePlan, classification)) return true;

  if (input.explicitIrasEvidenceRequest &&
      classification.intent === 'STATUTORY_ADVISORY' && classification.regulatoryAnalysisRequired &&
      classification.authorities.includes('IRAS') && !classification.accountingAnalysisRequired &&
      !classification.journalEntryRequired && !classification.calculationRequired &&
      hasMappedGeneralIrasRuleIssue(issuePlan, classification)) {
    return true;
  }

  // Standalone non-IRAS statutory questions can use the same evidence-backed
  // response path when both classification and a governed mapped topic agree.
  // This does not treat classifier metadata or contextual authorities as
  // sufficient evidence of a requested authority scope.
  if (!input.explicitIrasEvidenceRequest &&
      classification.intent === 'STATUTORY_ADVISORY' &&
      classification.regulatoryAnalysisRequired &&
      !classification.accountingAnalysisRequired &&
      !classification.journalEntryRequired &&
      hasMappedGovernedStatutoryWorkstream(issuePlan, classification)) {
    return true;
  }

  // These two manually reviewed document topics use the usual per-issue
  // evidence pipeline even when a question contains only one MAS workstream.
  // Let the existing workstream runtime surface other topic gaps beside these
  // scoped citations. It retains an insufficient result when the whole query
  // is not covered, while avoiding an unbound legacy answer for the mapped part.
  if (hasFocusedMasDocumentIssue(issuePlan) &&
      classification.intent === 'STATUTORY_ADVISORY' && classification.regulatoryAnalysisRequired &&
      !classification.accountingAnalysisRequired && !classification.journalEntryRequired &&
      classification.authorities.includes('MAS') && classification.domains.includes('MAS_FUND_MANAGEMENT')) {
    return true;
  }

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

/** Routes only one validated, unmapped accounting-standard rule explanation to the explicit gap renderer. */
export function shouldUseUnmappedAccountingRuleExplanationRuntime(input: {
  issuePlan: SemanticIssueReconciliation;
  classification: QuestionClassificationResult;
  rawQuery?: string;
  semanticRequestedOperation?: SemanticQuestionOperation;
  explicitIrasEvidenceRequest: boolean;
  explicitJournalRequest: boolean;
  outputJournalRequest: boolean;
  hasImages: boolean;
  isShortSemanticFollowUp: boolean;
}): boolean {
  const { issuePlan, classification } = input;
  const deterministicFallbackRuleRequest = issuePlan.source === 'TAXONOMY_FALLBACK' &&
    Boolean(input.rawQuery && isConservativeUnmappedAccountingRuleExplanationIntent(input.rawQuery));
  if ((input.semanticRequestedOperation !== 'EXPLAIN_RULE' && !deterministicFallbackRuleRequest) ||
      input.explicitIrasEvidenceRequest || input.explicitJournalRequest || input.outputJournalRequest ||
      input.hasImages || input.isShortSemanticFollowUp ||
      (issuePlan.source !== 'SEMANTIC_ISSUES' && !deterministicFallbackRuleRequest) ||
      issuePlan.coverageEstablished || !issuePlan.hasUnmappedResidual ||
      issuePlan.issues.length !== 1) {
    return false;
  }

  const issue = issuePlan.issues[0];
  if (!issue || issue.domain !== 'ACCOUNTING' || issue.operation !== 'EXPLAIN_RULE' ||
      issue.status !== 'UNRESOLVED' || issue.unresolvedReason !== 'NO_COVERAGE_TOPIC' || issue.mappedTopicIds.length !== 0 ||
      issue.governingAuthorities.length !== 1 ||
      !['ACCOUNTING_STANDARDS', 'IFRS_FOUNDATION'].includes(issue.governingAuthorities[0])) {
    return false;
  }

  const classifierConfirmsAccountingStandards = classification.primaryDomain === 'ACCOUNTING' &&
    classification.domains.length === 1 && classification.domains.includes('ACCOUNTING_SFRS') &&
    classification.authorities.length === 1 &&
    ['ACRA', 'ASC', 'ACCOUNTING_STANDARDS', 'IFRS_FOUNDATION'].includes(classification.authorities[0]);
  return classifierConfirmsAccountingStandards &&
    classification.intent === 'STATUTORY_ADVISORY' &&
    classification.accountingAnalysisRequired &&
    !classification.taxAnalysisRequired &&
    !classification.calculationRequired &&
    !classification.journalEntryRequired;
}
