import { matchIssues, scoreIssueDimensions } from './multi-authority-issue-scoring.mjs';
import evaluationConfig from './iras-first-evaluation-config-v1.json' with { type: 'json' };

export const IRAS_FIRST_PROFILE_VERSION = evaluationConfig.profileVersion;
export const AUTHORITY_COVERAGE_SCOPE = Object.freeze(Object.fromEntries(
  Object.entries(evaluationConfig.coverageStates).map(([authority, state]) => [authority, Object.freeze({ ...state })])
));

export const IRAS_FIRST_GAP_CODES = Object.freeze([
  'NO_COVERAGE_TOPIC', 'UNKNOWN_DOMAIN', 'UNASSIGNED_QUERY_TOPIC', 'CANONICAL_AREA_UNRESOLVED',
  'ISSUE_UNMAPPED', 'NO_GOVERNING_AUTHORITY', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTHORITY_MISMATCH',
  'PROVIDER_ERROR', 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL', 'ISSUE_PLAN_COVERAGE_UNESTABLISHED',
  'NO_CANDIDATE_EVIDENCE', 'CANDIDATE_REJECTED', 'NO_ADMITTED_EVIDENCE', 'NO_VERIFIED_CLAIM',
  'ISSUE_CONCEPT_UNCOVERED', 'IRAS_SCOPE_NOT_COVERED', 'EMPTY_ISSUE_PLAN',
  'UNROUTED_MATERIAL_CONCEPT', 'OTHER_GAP'
]);

const AUTHORITIES = new Set(Object.keys(AUTHORITY_COVERAGE_SCOPE));
const DOMAINS = new Set([
  'ACCOUNTING', 'IRAS_INCOME_TAX', 'IRAS_GST', 'IRAS_PROPERTY_TAX', 'IRAS_STAMP_DUTY', 'IRAS_OTHER',
  'CPF_PAYROLL', 'MOM_EMPLOYMENT', 'ACRA_CORPORATE', 'MAS_FUNDS', 'UNKNOWN'
]);
const POPULATIONS = new Set(['INDIVIDUAL', 'EMPLOYEE', 'EMPLOYER', 'COMPANY', 'SHAREHOLDER', 'FUND', 'PROPERTY_OWNER', 'UNKNOWN']);
const CANONICAL_WORKSTREAM_DOMAINS = new Set([
  ...DOMAINS,
  'IRAS_CORPORATE_TAX', 'IRAS_EMPLOYMENT_BENEFITS', 'IRAS_EMPLOYER_REPORTING', 'IRAS_INDIVIDUAL_TAX'
]);
const OPERATIONS = new Set([
  'EXPLAIN_RULE', 'EXPLAIN_INTERACTION', 'DETERMINE_TREATMENT', 'CHECK_ELIGIBILITY', 'CALCULATE',
  'PREPARE_JOURNAL', 'COMPARE', 'FILING_REQUIREMENT', 'OTHER'
]);
const PLAN_STATES = new Set(['MAPPED', 'UNRESOLVED']);
const UNRESOLVED_REASONS = new Set([
  'NO_COVERAGE_TOPIC', 'UNKNOWN_DOMAIN', 'UNASSIGNED_QUERY_TOPIC', 'CANONICAL_AREA_UNRESOLVED',
  'NO_GOVERNING_AUTHORITY', 'ISSUE_UNMAPPED'
]);
const EVIDENCE_STATUSES = new Set(['VERIFIED', 'INSUFFICIENT']);
const APPLICATION_STATUSES = new Set(['NOT_REQUIRED', 'UNRESOLVED']);
const EVIDENCE_REQUIREMENTS = new Set([
  'AUTHORITATIVE_SOURCE', 'CASE_FACTS', 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS', 'UNRESOLVED'
]);
const CASE_SPECIFIC_OPERATIONS = new Set(['CALCULATE', 'PREPARE_JOURNAL', 'CHECK_ELIGIBILITY', 'DETERMINE_TREATMENT']);
const GAP_SET = new Set(IRAS_FIRST_GAP_CODES);
const IRAS_BLOCKING_GAP_CODES = new Set(IRAS_FIRST_GAP_CODES.filter(code => code !== 'CANDIDATE_REJECTED'));
const UNSUPPORTED_GAP_CODES = new Set([
  'NO_COVERAGE_TOPIC', 'UNKNOWN_DOMAIN', 'UNASSIGNED_QUERY_TOPIC', 'CANONICAL_AREA_UNRESOLVED',
  'ISSUE_UNMAPPED', 'PROVIDER_UNAVAILABLE', 'NO_CANDIDATE_EVIDENCE', 'CANDIDATE_REJECTED',
  'NO_ADMITTED_EVIDENCE', 'NO_VERIFIED_CLAIM', 'ISSUE_CONCEPT_UNCOVERED'
]);
const PROVIDER_FAILURES = new Set(['NO_PROVIDER', 'INVALID_RESPONSE', 'LOW_CONFIDENCE', 'TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMITED', 'QUERY_TOO_LONG']);
const PROVIDER_TRANSPORT_FAILURES = new Set(['TIMEOUT', 'PROVIDER_ERROR', 'RATE_LIMITED']);
const REQUIRED_RUNTIME_GUARDS = Object.freeze([
  'operationsPreserved', 'incompletePlanNotVerified', 'contextualAuthorityNotRouted', 'residualHasNoWorkstream',
  'requiredApplicationStatusesUnresolved', 'unresolvedApplicationNotVerified'
]);
const COVERAGE_STATES = new Set(['RELEASE_REQUIRED', 'PARTIAL', 'NOT_YET_COVERED']);

function coverageScopeConfigurationValid() {
  const iras = AUTHORITY_COVERAGE_SCOPE.IRAS;
  const ifrs = AUTHORITY_COVERAGE_SCOPE.IFRS_FOUNDATION;
  return iras?.state === 'RELEASE_REQUIRED' &&
    Object.values(AUTHORITY_COVERAGE_SCOPE).every(item => COVERAGE_STATES.has(item?.state) && typeof item.providerSupported === 'boolean') &&
    ifrs?.state === 'PARTIAL' && ifrs.aliasOf === 'ACCOUNTING_STANDARDS' && ifrs.independentWorkstream === false &&
    AUTHORITY_COVERAGE_SCOPE.SSO?.state === 'NOT_YET_COVERED' && AUTHORITY_COVERAGE_SCOPE.SSO.providerSupported === false &&
    AUTHORITY_COVERAGE_SCOPE.UNKNOWN?.state === 'NOT_YET_COVERED' && AUTHORITY_COVERAGE_SCOPE.UNKNOWN.providerSupported === false;
}

function safeEnum(value, allowed, fallback = 'UNKNOWN') {
  return allowed.has(value) ? value : fallback;
}

function canonicalAccountingAuthorities(domain, authorities) {
  return authorities.map(authority => domain === 'ACCOUNTING' && authority === 'IFRS_FOUNDATION'
    ? 'ACCOUNTING_STANDARDS' : authority);
}

function countStatuses(items, selector, allowed) {
  const counts = Object.fromEntries([...allowed].map(value => [value, 0]));
  for (const item of items) {
    const status = selector(item);
    if (Object.hasOwn(counts, status)) counts[status] += 1;
  }
  return counts;
}

function gapCountsFor(gaps) {
  const counts = Object.fromEntries(IRAS_FIRST_GAP_CODES.map(code => [code, 0]));
  for (const gap of gaps) {
    const code = typeof gap?.code === 'string' && GAP_SET.has(gap.code) ? gap.code : 'OTHER_GAP';
    counts[code] += 1;
  }
  return counts;
}

function globalGapAppliesToIssue(gap, semantic, issueWorkstreams, semanticAuthorities) {
  const gapAuthority = safeEnum(gap?.authority, AUTHORITIES);
  const normalizedAuthority = canonicalAccountingAuthorities(semantic?.domain, [gapAuthority])[0];
  const gapDomain = safeEnum(gap?.domain, CANONICAL_WORKSTREAM_DOMAINS);
  const relevantDomains = new Set([safeEnum(semantic?.domain, DOMAINS), ...issueWorkstreams
    .filter(stream => semanticAuthorities.includes(canonicalAccountingAuthorities(semantic?.domain, [stream?.authority])[0]))
    .map(stream => safeEnum(stream?.domain, CANONICAL_WORKSTREAM_DOMAINS))]);
  const authorityKnownForIssue = semanticAuthorities.includes(normalizedAuthority);
  const domainMatches = gapDomain === 'UNKNOWN' || relevantDomains.has(gapDomain);
  return domainMatches && (authorityKnownForIssue || gapAuthority === 'UNKNOWN');
}

function isAccommodatedUnsupportedPlanGap(gap, semantic, issuePlanAccommodation) {
  const codes = new Set(['ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL', 'ISSUE_PLAN_COVERAGE_UNESTABLISHED']);
  const authority = safeEnum(gap?.authority, AUTHORITIES);
  const domain = safeEnum(gap?.domain, CANONICAL_WORKSTREAM_DOMAINS);
  const semanticAuthorities = canonicalAccountingAuthorities(semantic?.domain, semantic?.governingAuthorities || []);
  return issuePlanAccommodation && codes.has(gap?.code) && (authority === 'UNKNOWN') && domain === 'UNKNOWN' &&
    semanticAuthorities.includes('IRAS');
}

function runtimeAssignmentsConsistent(routing, diagnostics) {
  const counts = routing?.runtimeAssignmentCounts;
  if (!counts || routing?.runtimeAssignmentIntegrity !== true) return false;
  const runtimeIssueCount = diagnostics.reduce((sum, issue) => sum + issue.runtimeIssueCount, 0);
  return counts.semanticIssueCount === diagnostics.length && counts.plannedIssueCount === diagnostics.length &&
    counts.runtimeIssueCount === runtimeIssueCount && counts.runtimeIssueIdMismatchCount === 0 &&
    counts.duplicateRuntimeIssueIdCount === 0 && counts.unknownGapIssueIdCount === 0 &&
    counts.emptyWorkstreamCount === 0 && counts.unrepresentedResidualPlanIssueCount === 0 &&
    counts.unresolvedIrasPlanIssueCount === 0 &&
    counts.unresolvedPlanIssueCount === counts.knownUnsupportedNonIrasPlanIssueCount &&
    counts.issuePlanResidualAccommodation === (counts.unresolvedPlanIssueCount > 0);
}

/** Safe integrity summary for issue ownership and the narrow known-unsupported-plan exception. */
export function summarizeRuntimeIssueAssignments(semanticIssues, issuePlan, workstreams, runtimeGaps = []) {
  if (!Array.isArray(semanticIssues) || !Array.isArray(issuePlan?.issues) || !Array.isArray(workstreams) || !Array.isArray(runtimeGaps)) {
    return { runtimeAssignmentIntegrity: false, runtimeAssignmentCounts: undefined };
  }
  const plannedIssues = issuePlan.issues;
  const representedIssues = plannedIssues.slice(0, semanticIssues.length);
  const representedIds = new Set(representedIssues.map(issue => issue?.id).filter(id => typeof id === 'string'));
  const uniqueRepresentedIds = representedIds.size === semanticIssues.length;
  const runtimeRows = workstreams.flatMap(stream => Array.isArray(stream?.issues)
    ? stream.issues.map(item => ({ item, stream })) : []);
  const runtimeIssueIdMismatchCount = runtimeRows.filter(({ item }) => !representedIds.has(item?.issueId)).length;
  const runtimeCountsByIssueId = new Map();
  for (const { item } of runtimeRows) {
    if (representedIds.has(item?.issueId)) runtimeCountsByIssueId.set(item.issueId, (runtimeCountsByIssueId.get(item.issueId) || 0) + 1);
  }
  const duplicateRuntimeIssueIdCount = [...runtimeCountsByIssueId.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const knownPlanIds = new Set(plannedIssues.map(issue => issue?.id).filter(id => typeof id === 'string'));
  const allGaps = [
    ...runtimeGaps,
    ...workstreams.flatMap(stream => [
      ...(Array.isArray(stream?.gaps) ? stream.gaps : []),
      ...(Array.isArray(stream?.issues) ? stream.issues.flatMap(item => Array.isArray(item?.gaps) ? item.gaps : []) : [])
    ])
  ];
  const unknownGapIssueIdCount = allGaps.filter(gap => gap?.issueId !== undefined && gap?.issueId !== null &&
    gap.issueId !== 'issue-plan' && !knownPlanIds.has(gap.issueId)).length;
  const emptyWorkstreamCount = workstreams.filter(stream => !Array.isArray(stream?.issues) || stream.issues.length === 0).length;
  const unresolvedPlanIssues = plannedIssues.filter(issue => issue?.status === 'UNRESOLVED');
  const unrepresentedResidualPlanIssueCount = Math.max(0, plannedIssues.length - representedIssues.length);
  const unresolvedIrasPlanIssueCount = unresolvedPlanIssues.filter(issue =>
    (issue?.governingAuthorities || []).some(authority =>
      AUTHORITY_COVERAGE_SCOPE[canonicalAccountingAuthorities(issue?.domain, [authority])[0]]?.state === 'RELEASE_REQUIRED'))
    .length;
  const knownUnsupportedNonIrasPlanIssueCount = unresolvedPlanIssues.filter(issue => {
    const authorities = canonicalAccountingAuthorities(issue?.domain, issue?.governingAuthorities || []);
    return issue?.unresolvedReason === 'NO_COVERAGE_TOPIC' && DOMAINS.has(issue?.domain) && issue?.domain !== 'UNKNOWN' && authorities.length > 0 &&
      authorities.every(authority => authority !== 'UNKNOWN' && AUTHORITY_COVERAGE_SCOPE[authority] &&
        AUTHORITY_COVERAGE_SCOPE[authority].state !== 'RELEASE_REQUIRED');
  }).length;
  const onlyKnownUnsupportedSemanticIssues = unresolvedPlanIssues.length > 0 &&
    unresolvedPlanIssues.length === knownUnsupportedNonIrasPlanIssueCount &&
    unresolvedPlanIssues.every(issue => representedIssues.includes(issue)) && unrepresentedResidualPlanIssueCount === 0;
  const issuePlanResidualAccommodation = issuePlan.hasUnmappedResidual === true && onlyKnownUnsupportedSemanticIssues;
  const issuePlanCoverageConsistent = (issuePlan.coverageEstablished === true && issuePlan.hasUnmappedResidual === false &&
    unresolvedPlanIssues.length === 0) || issuePlanResidualAccommodation;
  const runtimeAssignmentIntegrity = uniqueRepresentedIds && issuePlanCoverageConsistent &&
    runtimeIssueIdMismatchCount === 0 && duplicateRuntimeIssueIdCount === 0 &&
    unknownGapIssueIdCount === 0 && emptyWorkstreamCount === 0;
  return {
    runtimeAssignmentIntegrity,
    runtimeAssignmentCounts: {
      semanticIssueCount: semanticIssues.length,
      plannedIssueCount: plannedIssues.length,
      runtimeIssueCount: runtimeRows.length,
      runtimeIssueIdMismatchCount,
      duplicateRuntimeIssueIdCount,
      unknownGapIssueIdCount,
      emptyWorkstreamCount,
      unresolvedPlanIssueCount: unresolvedPlanIssues.length,
      unresolvedIrasPlanIssueCount,
      knownUnsupportedNonIrasPlanIssueCount,
      unrepresentedResidualPlanIssueCount,
      issuePlanResidualAccommodation
    }
  };
}

/** Safe per-issue projection of the actual reconciled plan and runtime lifecycle. */
export function buildPerIssueScopeDiagnostics(semanticIssues, issuePlan, runtime) {
  if (!Array.isArray(semanticIssues) || !Array.isArray(issuePlan?.issues) || !Array.isArray(runtime?.workstreams)) return undefined;
  const assignmentSummary = summarizeRuntimeIssueAssignments(semanticIssues, issuePlan, runtime.workstreams, runtime.gaps || []);
  const issuePlanResidualAccommodation = assignmentSummary.runtimeAssignmentCounts?.issuePlanResidualAccommodation === true;
  return semanticIssues.map((semantic, issueIndex) => {
    const planned = issuePlan.issues[issueIndex];
    const plannedId = typeof planned?.id === 'string' ? planned.id : undefined;
    const issueRuntimeRows = plannedId ? runtime.workstreams.flatMap(stream =>
      (Array.isArray(stream?.issues) ? stream.issues : [])
        .filter(item => item?.issueId === plannedId)
        .map(item => ({ item, stream }))) : [];
    const issueRuntime = issueRuntimeRows.map(row => row.item);
    const issueWorkstreams = plannedId ? runtime.workstreams.filter(stream =>
      Array.isArray(stream?.issues) && stream.issues.some(item => item?.issueId === plannedId)) : [];
    const issueGapMap = new Map();
    const semanticAuthoritiesForGaps = canonicalAccountingAuthorities(semantic?.domain,
      Array.isArray(semantic?.governingAuthorities) ? semantic.governingAuthorities : []);
    const issueGaps = [
      ...(Array.isArray(runtime?.gaps) ? runtime.gaps.filter(gap => gap?.issueId === plannedId) : []),
      ...(Array.isArray(runtime?.gaps) ? runtime.gaps.filter(gap =>
        (gap?.issueId === undefined || gap?.issueId === null || gap?.issueId === 'issue-plan') &&
        !isAccommodatedUnsupportedPlanGap(gap, semantic, issuePlanResidualAccommodation) &&
        globalGapAppliesToIssue(gap, semantic, issueWorkstreams, semanticAuthoritiesForGaps)) : []),
      ...issueWorkstreams.flatMap(stream => Array.isArray(stream?.gaps)
        ? stream.gaps.filter(gap => gap?.issueId === plannedId ||
          (gap?.issueId === undefined || gap?.issueId === null || gap?.issueId === 'issue-plan') &&
          !isAccommodatedUnsupportedPlanGap(gap, semantic, issuePlanResidualAccommodation) &&
          globalGapAppliesToIssue(gap, semantic, issueWorkstreams, semanticAuthoritiesForGaps)) : []),
      ...issueRuntime.flatMap(item => Array.isArray(item?.gaps) ? item.gaps : [])
    ];
    for (const gap of issueGaps) {
      const stage = typeof gap?.stage === 'string' ? gap.stage : 'UNKNOWN';
      const code = typeof gap?.code === 'string' ? gap.code : 'OTHER_GAP';
      issueGapMap.set(`${stage}:${code}`, gap);
    }
    const lifecycleCounts = Object.fromEntries([
      'mapped', 'retrievalAttempted', 'evidenceFound', 'admitted', 'verified', 'covered'
    ].map(stage => [stage, issueRuntime.filter(item => item?.lifecycle?.[stage] === true).length]));
    const admittedRecordCount = issueRuntime.reduce((sum, item) => sum + (Array.isArray(item?.sources) ? item.sources.length : 0), 0);
    const verifiedClaimCount = issueRuntime.reduce((sum, item) => sum + (Array.isArray(item?.verifiedClaims) ? item.verifiedClaims.length : 0), 0);
    const evidenceFoundCount = lifecycleCounts.evidenceFound;
    const gapCounts = gapCountsFor([...issueGapMap.values()]);
    const semanticAuthorities = canonicalAccountingAuthorities(semantic?.domain, Array.isArray(semantic?.governingAuthorities)
      ? semantic.governingAuthorities : []);
    const runtimeMetadataMatches = issueRuntimeRows.map(({ item, stream }) => item?.domain === semantic?.domain &&
      item?.domain === planned?.domain && item?.operation === semantic?.operation && item?.operation === planned?.operation &&
      item?.population === semantic?.population && item?.population === planned?.population &&
      item?.evidenceRequirement === planned?.evidenceRequirement &&
      semanticAuthorities.includes(item?.governingAuthority) && item?.governingAuthority === stream?.authority);
    const runtimeMetadataConsistent = issueRuntimeRows.length > 0
      ? runtimeMetadataMatches.every(Boolean)
      : Boolean(planned && planned.status === 'UNRESOLVED' && issueRuntime.length === 0);
    return {
      issueIndex,
      presentInIssuePlan: Boolean(planned),
      governingAuthorities: Array.isArray(semantic?.governingAuthorities)
        ? semantic.governingAuthorities.map(authority => safeEnum(authority, AUTHORITIES))
        : [],
      contextualAuthorities: Array.isArray(semantic?.contextualAuthorities)
        ? semantic.contextualAuthorities.map(authority => safeEnum(authority, AUTHORITIES))
        : [],
      domain: safeEnum(semantic?.domain, DOMAINS),
      population: safeEnum(semantic?.population, POPULATIONS),
      operation: safeEnum(semantic?.operation, OPERATIONS),
      evidenceRequirement: safeEnum(planned?.evidenceRequirement, EVIDENCE_REQUIREMENTS),
      runtimeMetadataConsistent,
      runtimeMetadataMatchCount: runtimeMetadataMatches.filter(Boolean).length,
      runtimeMetadataMismatchCount: runtimeMetadataMatches.filter(matches => !matches).length,
      runtimeMetadataCounts: {
        domain: countStatuses(issueRuntime, item => item?.domain, DOMAINS),
        operation: countStatuses(issueRuntime, item => item?.operation, OPERATIONS),
        population: countStatuses(issueRuntime, item => item?.population, POPULATIONS),
        governingAuthority: countStatuses(issueRuntime, item => item?.governingAuthority, AUTHORITIES),
        evidenceRequirement: countStatuses(issueRuntime, item => item?.evidenceRequirement, EVIDENCE_REQUIREMENTS)
      },
      planStatus: safeEnum(planned?.status, PLAN_STATES),
      unresolvedReason: safeEnum(planned?.unresolvedReason, UNRESOLVED_REASONS, 'NONE'),
      mappedTopicCount: Array.isArray(planned?.mappedTopicIds) ? planned.mappedTopicIds.length : 0,
      canonicalWorkstreams: issueWorkstreams.map(stream => ({
        authority: safeEnum(stream?.authority, AUTHORITIES),
        domain: safeEnum(stream?.domain, CANONICAL_WORKSTREAM_DOMAINS)
      })),
      runtimeIssueCount: issueRuntime.length,
      lifecycleCounts,
      evidenceStatusCounts: countStatuses(issueRuntime, item => item?.evidenceStatus, EVIDENCE_STATUSES),
      applicationStatusCounts: countStatuses(issueRuntime, item => item?.applicationStatus, APPLICATION_STATUSES),
      evidenceFoundCount,
      admittedRecordCount,
      verifiedClaimCount,
      gapCounts
    };
  });
}

function allDimensionsCorrect(scoring) {
  return scoring?.matchedIssueCount > 0 && Object.keys(scoring.dimensionsCorrect || {}).length === 5 &&
    Object.values(scoring.dimensionsCorrect).every(count => count === scoring.matchedIssueCount);
}

function specificFlagPassed(testCase, interpretation) {
  return typeof testCase.expectedRequiresUserSpecificFacts === 'boolean' &&
    interpretation?.requiresUserSpecificFacts === testCase.expectedRequiresUserSpecificFacts;
}

function semanticDimensionsAllCorrect(issues, matched, expected) {
  return matched.length === expected.length && matched.every(({ actualIndex, expectedIndex }) => {
    const dimensions = scoreIssueDimensions(issues[actualIndex], expected[expectedIndex]);
    return ['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation']
      .every(key => dimensions[key] === true);
  });
}

function forbiddenProviderFailure(production, capture, routing) {
  return PROVIDER_FAILURES.has(production?.failure) || PROVIDER_TRANSPORT_FAILURES.has(capture?.transportCategory) ||
    routing?.runtimeTimedOut === true || (routing?.runtimeIssueScopeDiagnostics || []).some(issue => issue.gapCounts.PROVIDER_ERROR > 0);
}

export function diagnosticHasCompleteVerifiedSupport(issue) {
  return issue?.runtimeIssueCount > 0 && issue.evidenceStatusCounts?.VERIFIED === issue.runtimeIssueCount &&
    issue.lifecycleCounts?.admitted === issue.runtimeIssueCount && issue.lifecycleCounts?.verified === issue.runtimeIssueCount &&
    issue.lifecycleCounts?.covered === issue.runtimeIssueCount && issue.admittedRecordCount > 0 && issue.verifiedClaimCount > 0;
}

export function admittedEvidenceConsistent(routing) {
  const diagnostics = routing?.runtimeIssueScopeDiagnostics;
  if (!Array.isArray(diagnostics)) return false;
  const issueEvidenceIsConsistent = diagnostics.every(issue => {
    if (issue.evidenceStatusCounts?.VERIFIED > 0) return diagnosticHasCompleteVerifiedSupport(issue);
    const lifecycleVerified = issue.lifecycleCounts?.verified > 0;
    return !lifecycleVerified || issue.admittedRecordCount > 0 && issue.verifiedClaimCount > 0 &&
      issue.lifecycleCounts?.admitted > 0 && issue.lifecycleCounts?.verified > 0;
  });
  const admittedRecordCount = diagnostics.reduce((sum, issue) => sum + issue.admittedRecordCount, 0);
  const verifiedClaimCount = diagnostics.reduce((sum, issue) => sum + issue.verifiedClaimCount, 0);
  const runtimeVerified = routing?.status === 'VERIFIED' || routing?.evidenceStatus === 'VERIFIED';
  const allIssuesHaveVerifiedSupport = diagnostics.length > 0 && diagnostics.every(diagnosticHasCompleteVerifiedSupport);
  return issueEvidenceIsConsistent && (!runtimeVerified ||
    allIssuesHaveVerifiedSupport && admittedRecordCount > 0 && verifiedClaimCount > 0);
}

function requiredRuntimeGuardsPassed(routing) {
  const guards = routing?.guardChecks;
  return Boolean(guards) && REQUIRED_RUNTIME_GUARDS.every(name => guards[name] === true);
}

function overallStatusConsistentWithApplications(routing, diagnostics) {
  const hasUnresolvedApplication = diagnostics.some(issue => issue.applicationStatusCounts?.UNRESOLVED > 0);
  return !(routing?.status === 'VERIFIED' && (routing?.applicationStatus === 'UNRESOLVED' || hasUnresolvedApplication));
}

function applicationStatusConsistent(issue) {
  if (!EVIDENCE_REQUIREMENTS.has(issue.evidenceRequirement)) return false;
  if (issue.runtimeIssueCount === 0) {
    return issue.planStatus === 'UNRESOLVED' && ['NO_GOVERNING_AUTHORITY', 'NO_COVERAGE_TOPIC', 'UNKNOWN_DOMAIN'].includes(issue.unresolvedReason) &&
      (issue.gapCounts.NO_GOVERNING_AUTHORITY > 0 || issue.gapCounts.NO_COVERAGE_TOPIC > 0 || issue.gapCounts.UNKNOWN_DOMAIN > 0);
  }
  const requiresCaseFacts = issue.evidenceRequirement === 'CASE_FACTS' ||
    issue.evidenceRequirement === 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS' ||
    issue.evidenceRequirement === 'UNRESOLVED' && CASE_SPECIFIC_OPERATIONS.has(issue.operation);
  const expectedStatus = requiresCaseFacts ? 'UNRESOLVED' : 'NOT_REQUIRED';
  return issue.applicationStatusCounts?.[expectedStatus] === issue.runtimeIssueCount &&
    Object.entries(issue.applicationStatusCounts || {}).every(([status, count]) => status === expectedStatus || count === 0);
}

export function explicitUnsupported(issue) {
  const hasGap = Object.entries(issue.gapCounts || {}).some(([code, count]) => count > 0 && UNSUPPORTED_GAP_CODES.has(code));
  const insufficient = issue.evidenceStatusCounts?.VERIFIED === 0 && issue.lifecycleCounts?.covered === 0 &&
    (issue.runtimeIssueCount === 0 || issue.evidenceStatusCounts?.INSUFFICIENT > 0);
  return hasGap && insufficient && issue.admittedRecordCount === 0 && issue.verifiedClaimCount === 0;
}

function expectedNoTopicUnsupported(issue) {
  return issue?.planStatus === 'UNRESOLVED' && issue.unresolvedReason === 'NO_COVERAGE_TOPIC' &&
    issue.mappedTopicCount === 0 && issue.gapCounts?.NO_COVERAGE_TOPIC > 0 && explicitUnsupported(issue);
}

/** Accepts only an exact expected route set, with omissions for explicitly unsupported non-IRAS issues. */
export function scopeAwareWorkstreamSetAccuracy(testCase, diagnostics, expectedIssueIdsByDiagnostic) {
  if (!Array.isArray(diagnostics) || !Array.isArray(expectedIssueIdsByDiagnostic) ||
      diagnostics.length !== expectedIssueIdsByDiagnostic.length) return false;
  const diagnosticByExpectedId = new Map(expectedIssueIdsByDiagnostic.map((id, index) => [id, diagnostics[index]]));
  const actualPairs = new Set(diagnostics.flatMap(issue => (issue.canonicalWorkstreams || [])
    .map(stream => `${stream.authority}/${stream.domain}`)));
  return (testCase?.expectedWorkstreamsAnyOf || []).some(expectedSet => {
    if (!Array.isArray(expectedSet)) return false;
    const expectedPairs = new Set(expectedSet);
    const optionalPairs = new Set();
    for (const pair of expectedPairs) {
      const separator = pair.indexOf('/');
      if (separator < 0) return false;
      const authority = pair.slice(0, separator);
      const related = (testCase.expected || []).filter(issue =>
        canonicalAccountingAuthorities(Array.isArray(issue.domain) ? issue.domain[0] : undefined,
          issue.governingAuthorities || []).includes(authority));
      if (related.length === 0) continue;
      const allExplicitUnsupportedWithoutRoute = related.every(issue => {
        const diagnostic = diagnosticByExpectedId.get(issue.id);
        const entry = AUTHORITY_COVERAGE_SCOPE[authority];
        return entry?.state !== 'RELEASE_REQUIRED' && diagnostic && explicitUnsupported(diagnostic) &&
          diagnostic.runtimeIssueCount === 0 && diagnostic.canonicalWorkstreams.length === 0;
      });
      if (allExplicitUnsupportedWithoutRoute) optionalPairs.add(pair);
    }
    return [...actualPairs].every(pair => expectedPairs.has(pair)) &&
      [...expectedPairs].every(pair => actualPairs.has(pair) || optionalPairs.has(pair));
  });
}

/** Scope-aware per-row gate. Semantic scoring remains all-authority; evidence release checks are IRAS-only. */
export function evaluateIrasFirstCase({
  testCase, validInterpretation, scoring, interpretation, routing, production, capture,
  requestCount, sourceHashesConsistent, fixtureHashesConsistent
}) {
  const issues = Array.isArray(interpretation?.issues) ? interpretation.issues : [];
  const diagnostics = routing?.runtimeIssueScopeDiagnostics;
  const { expectedByActual } = matchIssues(testCase.expected, issues);
  const matched = [...expectedByActual.entries()].map(([actualIndex, expectedIndex]) => ({ actualIndex, expectedIndex }));
  const exactSemanticMatch = validInterpretation && scoring?.completeQuestionIssueCoverage === true &&
    scoring.matchedIssueCount === testCase.expected.length && scoring.predictedIssueCount === testCase.expected.length &&
    matched.length === testCase.expected.length && allDimensionsCorrect(scoring) &&
    semanticDimensionsAllCorrect(issues, matched, testCase.expected) &&
    scoring.operationCorrect === scoring.operationMatched && scoring.operationMatched === testCase.expected.length &&
    specificFlagPassed(testCase, interpretation);
  const diagnosticsComplete = Array.isArray(diagnostics) && diagnostics.length === issues.length &&
    diagnostics.every(item => item.presentInIssuePlan && Number.isInteger(item.issueIndex));
  const expectedIssueIdsByDiagnostic = issues.map((_, index) => {
    const expectedIndex = expectedByActual.get(index);
    return expectedIndex === undefined ? undefined : testCase.expected[expectedIndex]?.id;
  });
  const scopedWorkstreamSetAccuracy = diagnosticsComplete && scopeAwareWorkstreamSetAccuracy(
    testCase, diagnostics, expectedIssueIdsByDiagnostic
  );
  const runtimeIntegrity = coverageScopeConfigurationValid() && diagnosticsComplete &&
    scopedWorkstreamSetAccuracy &&
    runtimeAssignmentsConsistent(routing, diagnostics) &&
    diagnostics.every(item => item.runtimeMetadataConsistent === true) &&
    requiredRuntimeGuardsPassed(routing) && overallStatusConsistentWithApplications(routing, diagnostics) &&
    admittedEvidenceConsistent(routing) && !forbiddenProviderFailure(production, capture, routing) &&
    (requestCount === 1 && capture?.requestCount === 1 && capture?.responseReceived === true && !capture?.transportCategory);
  const matchedExpected = new Map(matched.map(item => [item.expectedIndex, diagnostics?.[item.actualIndex]]));
  const perIssueResults = testCase.expected.map((expected, expectedIndex) => {
    const diagnostic = matchedExpected.get(expectedIndex);
    const actualMatch = matched.find(item => item.expectedIndex === expectedIndex);
    const dimensions = actualMatch ? scoreIssueDimensions(issues[actualMatch.actualIndex], expected) : {};
    const expectedAuthorities = expected.governingAuthorities || [];
    const expectedDomain = Array.isArray(expected.domain) ? expected.domain[0] : undefined;
    const canonicalExpectedAuthorities = canonicalAccountingAuthorities(expectedDomain, expectedAuthorities);
    const authorityScopeEntries = canonicalExpectedAuthorities.map(authority => AUTHORITY_COVERAGE_SCOPE[authority]);
    const authorityScopeKnown = coverageScopeConfigurationValid() && authorityScopeEntries.every(entry => entry && COVERAGE_STATES.has(entry.state));
    const expectedReleaseRequired = authorityScopeKnown && authorityScopeEntries.some(entry => entry.state === 'RELEASE_REQUIRED');
    const actualAuthorities = canonicalAccountingAuthorities(diagnostic?.domain, diagnostic?.governingAuthorities || []);
    const authorityCorrect = Boolean(diagnostic) && canonicalExpectedAuthorities.some(authority => actualAuthorities.includes(authority)) &&
      actualAuthorities.every(authority => canonicalExpectedAuthorities.includes(authority));
    const falseIrasRoute = !expectedReleaseRequired && (diagnostic?.canonicalWorkstreams || []).some(stream => stream.authority === 'IRAS');
    const unexpectedAuthorityRoute = Boolean(diagnostic) && diagnostic.canonicalWorkstreams.some(stream =>
      !canonicalExpectedAuthorities.includes(stream.authority));
    const explicitUnsupportedState = diagnostic ? explicitUnsupported(diagnostic) : false;
    const expectedUnsupported = testCase.expectedCoverageOutcome === 'UNSUPPORTED';
    const expectedUnsupportedState = diagnostic && expectedUnsupported ? expectedNoTopicUnsupported(diagnostic) : false;
    const acceptedWorkstreamPairs = (testCase.expectedWorkstreamsAnyOf || []).flatMap(set => set.map(value => {
      const separator = value.indexOf('/');
      return separator < 0 ? undefined : {
        authority: value.slice(0, separator),
        domain: value.slice(separator + 1)
      };
    }).filter(Boolean)).filter(pair => canonicalExpectedAuthorities.includes(pair.authority));
    const canonicalWorkstreams = diagnostic?.canonicalWorkstreams || [];
    const canonicalWorkstreamCorrect = acceptedWorkstreamPairs.length > 0 && canonicalWorkstreams.length > 0 &&
      canonicalWorkstreams.every(actual => acceptedWorkstreamPairs.some(expectedPair =>
        actual.authority === expectedPair.authority && actual.domain === expectedPair.domain));
    const canonicalRoute = scopedWorkstreamSetAccuracy && canonicalWorkstreamCorrect;
    const issuePlanPresent = diagnostic?.presentInIssuePlan === true;
    const irasEvidenceComplete = !expectedReleaseRequired || Boolean(diagnostic && diagnostic.mappedTopicCount > 0 &&
      diagnostic.planStatus === 'MAPPED' && diagnostic.canonicalWorkstreams.some(stream => stream.authority === 'IRAS') &&
      canonicalWorkstreamCorrect &&
      diagnostic.runtimeMetadataConsistent === true &&
      diagnostic.runtimeIssueCount > 0 && diagnostic.lifecycleCounts.mapped > 0 &&
      diagnostic.lifecycleCounts.retrievalAttempted > 0 &&
      diagnostic.lifecycleCounts.admitted > 0 && diagnostic.lifecycleCounts.verified > 0 && diagnostic.lifecycleCounts.covered > 0 &&
      diagnostic.admittedRecordCount > 0 && diagnostic.verifiedClaimCount > 0 &&
      diagnostic.evidenceStatusCounts.VERIFIED > 0 &&
      Object.entries(diagnostic.gapCounts).every(([code, count]) => !count || ![
        'NO_COVERAGE_TOPIC', 'UNKNOWN_DOMAIN', 'UNASSIGNED_QUERY_TOPIC', 'CANONICAL_AREA_UNRESOLVED',
        'ISSUE_UNMAPPED', 'NO_GOVERNING_AUTHORITY', 'PROVIDER_UNAVAILABLE', 'PROVIDER_AUTHORITY_MISMATCH',
        'PROVIDER_ERROR', 'ISSUE_PLAN_HAS_UNMAPPED_RESIDUAL', 'ISSUE_PLAN_COVERAGE_UNESTABLISHED',
        'NO_CANDIDATE_EVIDENCE', 'NO_ADMITTED_EVIDENCE', 'NO_VERIFIED_CLAIM', 'ISSUE_CONCEPT_UNCOVERED',
        'EMPTY_ISSUE_PLAN', 'UNROUTED_MATERIAL_CONCEPT',
        'IRAS_SCOPE_NOT_COVERED', 'OTHER_GAP'
      ].includes(code)));
    const evidenceExplicitlyInsufficient = explicitUnsupportedState || Boolean(diagnostic &&
      diagnostic.evidenceStatusCounts?.VERIFIED === 0 && diagnostic.evidenceStatusCounts?.INSUFFICIENT > 0 &&
      Object.values(diagnostic.gapCounts || {}).some(count => count > 0));
    const nonIrasCoverageAcceptable = expectedReleaseRequired || (expectedUnsupported
      ? expectedUnsupportedState && (canonicalRoute || issuePlanPresent)
      : explicitUnsupportedState || canonicalRoute && evidenceExplicitlyInsufficient ||
        canonicalRoute && diagnostic?.evidenceStatusCounts?.VERIFIED > 0 && diagnostic.admittedRecordCount > 0 && diagnostic.verifiedClaimCount > 0);
    const blockingGapCount = diagnostic
      ? Object.entries(diagnostic.gapCounts).reduce((sum, [code, count]) => sum + (IRAS_BLOCKING_GAP_CODES.has(code) ? count : 0), 0)
      : 0;
    const issueApplicationStatusCorrect = diagnostic ? applicationStatusConsistent(diagnostic) : false;
    const evidenceSafeguardsPassed = diagnostic ? admittedEvidenceConsistent({ runtimeIssueScopeDiagnostics: [diagnostic] }) : false;
    const routeOrExplicitUnsupported = expectedReleaseRequired || canonicalWorkstreamCorrect ||
      explicitUnsupportedState && canonicalWorkstreams.length === 0;
    return {
      expectedAuthority: expectedAuthorities.length === 1 ? expectedAuthorities[0] : 'UNKNOWN',
      releaseRequired: expectedReleaseRequired,
      semanticIssueMatched: Boolean(diagnostic),
      semanticDimensionsCorrect: dimensions,
      authorityCorrect,
      authorityScopeKnown,
      noFalseIrasRoute: !falseIrasRoute,
      issuePlanPresent,
      irasEvidenceComplete,
      mappedTopicCount: diagnostic?.mappedTopicCount || 0,
      canonicalProviderPathReached: Boolean(diagnostic?.canonicalWorkstreams.some(stream => stream.authority === 'IRAS')),
      providerPathReached: Boolean(diagnostic?.canonicalWorkstreams.some(stream => stream.authority === 'IRAS') &&
        diagnostic.lifecycleCounts?.retrievalAttempted > 0),
      retrievalAttemptedCount: diagnostic?.lifecycleCounts?.retrievalAttempted || 0,
      blockingGapCount,
      issueApplicationStatusCorrect,
      evidenceSafeguardsPassed,
      explicitUnsupportedState,
      expectedUnsupportedState,
      canonicalRoute,
      canonicalWorkstreamCorrect,
      canonicalWorkstreamCount: canonicalWorkstreams.length,
      runtimeMetadataConsistent: diagnostic?.runtimeMetadataConsistent === true,
      nonIrasCoverageAcceptable,
      passed: Boolean(diagnostic) && authorityCorrect && !falseIrasRoute && !unexpectedAuthorityRoute && issuePlanPresent &&
        authorityScopeKnown && issueApplicationStatusCorrect && evidenceSafeguardsPassed &&
        diagnostic.runtimeMetadataConsistent === true && routeOrExplicitUnsupported && irasEvidenceComplete && nonIrasCoverageAcceptable
    };
  });
  const allExpectedIssuesRepresented = perIssueResults.length === testCase.expected.length && perIssueResults.every(item => item.semanticIssueMatched);
  const irasIssueResults = perIssueResults.filter(item => item.releaseRequired);
  const nonIrasIssueResults = perIssueResults.filter(item => !item.releaseRequired);
  const releaseCoveragePassed = irasIssueResults.every(item => item.passed) &&
    nonIrasIssueResults.every(item => item.passed) && runtimeIntegrity && scopedWorkstreamSetAccuracy && allExpectedIssuesRepresented;
  const passed = exactSemanticMatch && releaseCoveragePassed && sourceHashesConsistent === true && fixtureHashesConsistent === true;
  return {
    passed,
    semanticQualityPassed: exactSemanticMatch,
    releaseCoveragePassed,
    issueCountComplete: allExpectedIssuesRepresented,
    caseSpecificity: {
      expected: testCase.expectedRequiresUserSpecificFacts,
      actual: interpretation?.requiresUserSpecificFacts
    },
    caseSpecificityCorrect: specificFlagPassed(testCase, interpretation),
    runtimeIntegrity,
    sourceFingerprintsStable: sourceHashesConsistent === true,
    fixtureFingerprintsStable: fixtureHashesConsistent === true,
    irasIssueCount: irasIssueResults.length,
    scopeAwareWorkstreamSetAccuracy: scopedWorkstreamSetAccuracy,
    irasIssuesPassed: irasIssueResults.filter(item => item.passed).length,
    nonIrasIssueCount: nonIrasIssueResults.length,
    nonIrasIssuesSemanticallyRoutedOrExplicitlyUnsupported: nonIrasIssueResults.filter(item => item.passed).length,
    perIssueResults
  };
}

/** Separate all-authority semantic metrics, IRAS release metrics, and non-IRAS gap visibility. */
export function summarizeIrasFirstAcceptance(document, expectedCaseCount) {
  const rows = Array.isArray(document?.cases) ? document.cases : [];
  const expectedIssueCount = rows.reduce((sum, row) => sum + (row.scoring?.expectedIssueCount || 0), 0);
  const matchedIssueCount = rows.reduce((sum, row) => sum + (row.scoring?.matchedIssueCount || 0), 0);
  const predictedIssueCount = rows.reduce((sum, row) => sum + (row.scoring?.predictedIssueCount || 0), 0);
  const irasIssues = rows.flatMap(row => row.irasFirstAcceptance?.perIssueResults || []).filter(item => item.releaseRequired);
  const nonIrasIssues = rows.flatMap(row => row.irasFirstAcceptance?.perIssueResults || []).filter(item => !item.releaseRequired);
  const semanticDimensions = Object.fromEntries(['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation'].map(dimension => {
    const correct = rows.reduce((sum, row) => sum + (row.scoring?.dimensionsCorrect?.[dimension] || 0), 0);
    return [dimension, { correct, matched: matchedIssueCount, rate: matchedIssueCount ? Math.round(correct / matchedIssueCount * 10_000) / 10_000 : null }];
  }));
  const nonIrasDimensions = Object.fromEntries(['governingAuthority', 'contextualAuthority', 'domain', 'population', 'operation'].map(dimension => {
    const correct = nonIrasIssues.filter(issue => issue.semanticDimensionsCorrect?.[dimension] === true).length;
    return [dimension, { correct, matched: nonIrasIssues.length, rate: nonIrasIssues.length ? Math.round(correct / nonIrasIssues.length * 10_000) / 10_000 : null }];
  }));
  const perAuthorityNonIrasGaps = {};
  for (const row of rows) {
    for (const issue of row.routing?.runtimeIssueScopeDiagnostics || []) {
      const rawAuthority = (issue.governingAuthorities || []).find(item => item !== 'IRAS');
      const authority = rawAuthority === 'IFRS_FOUNDATION' && issue.domain === 'ACCOUNTING' ? 'ACCOUNTING_STANDARDS' : rawAuthority;
      if (!authority) continue;
      const entry = perAuthorityNonIrasGaps[authority] ||= { issueCount: 0, explicitUnsupportedCount: 0, gapCounts: Object.fromEntries(IRAS_FIRST_GAP_CODES.map(code => [code, 0])) };
      entry.issueCount += 1;
      if (explicitUnsupported(issue)) entry.explicitUnsupportedCount += 1;
      for (const [code, count] of Object.entries(issue.gapCounts || {})) entry.gapCounts[code] += count;
    }
  }
  const rowsPassed = rows.length === expectedCaseCount && rows.every(row => row.irasFirstAcceptance?.passed === true);
  return {
    passed: rowsPassed && document.requestCount === expectedCaseCount && document.sourceHashesConsistent === true && document.fixtureHashesConsistent === true,
    completedCases: rows.length,
    expectedCases: expectedCaseCount,
    semanticQuality: {
      validInterpretations: { count: rows.filter(row => row.validInterpretation).length, total: rows.length },
      issueRecall: { matched: matchedIssueCount, expected: expectedIssueCount },
      issuePrecision: { matched: matchedIssueCount, predicted: predictedIssueCount },
      dimensions: semanticDimensions,
      caseSpecificityCorrect: { correct: rows.filter(row => row.irasFirstAcceptance?.caseSpecificityCorrect).length, total: rows.length }
    },
    releaseRequiredCoverage: {
      irasIssues: irasIssues.length,
      topicMapped: irasIssues.filter(item => item.mappedTopicCount > 0).length,
      canonicalProviderPathReached: irasIssues.filter(item => item.canonicalProviderPathReached).length,
      providerPathReached: irasIssues.filter(item => item.providerPathReached).length,
      retrievalAttempted: irasIssues.filter(item => item.retrievalAttemptedCount > 0).length,
      evidenceSupported: irasIssues.filter(item => item.passed && item.evidenceSafeguardsPassed).length,
      blockingCases: rows.filter(row => (row.irasFirstAcceptance?.irasIssueCount || 0) > (row.irasFirstAcceptance?.irasIssuesPassed || 0) ||
        (row.irasFirstAcceptance?.perIssueResults || []).some(item => item.releaseRequired && item.blockingGapCount > 0)).length,
      blockingGapCount: irasIssues.reduce((sum, item) => sum + item.blockingGapCount, 0),
      evidenceSafeguardsPassed: rows.filter(row => row.irasFirstAcceptance?.runtimeIntegrity === true).length
    },
    nonIrasSemantic: {
      issues: nonIrasIssues.length,
      recognizedAndRoutedOrExplicitlyUnsupported: nonIrasIssues.filter(item => item.passed).length,
      dimensions: nonIrasDimensions
    },
    nonIrasCoverageGaps: perAuthorityNonIrasGaps
  };
}
