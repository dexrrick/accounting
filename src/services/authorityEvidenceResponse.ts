import type { AuthorityEvidencePresentation, AuthorityPresentedWorkstream } from '../utils/authorityEvidencePresentation';
import { hasCompleteRequestRepresentation } from '../utils/authorityEvidencePresentation';
import { formatSingaporeDate } from '../utils/dateUtils';
import { getMomSalaryPaymentRuleEvidence } from '../retrieval/momSalaryPaymentRule';
import { getIrasAcraPracticalRuleEvidence } from '../retrieval/irasAcraPracticalRules';
import { getCpfMasPracticalRuleEvidence } from '../retrieval/cpfMasPracticalRules';
import { getIrasCpfCoverageEvidence } from '../retrieval/irasCpfCoverageRules';
import { getMomAcraMasCoverageEvidence } from '../retrieval/momAcraMasCoverageRules';
import { getIrasCpfExpansionEvidence } from '../retrieval/irasCpfExpansionRules';
import { getMomAcraMasExpansionEvidence } from '../retrieval/momAcraMasExpansionRules';
import { getAcraMomPracticalEvidence } from '../retrieval/acraMomPracticalRules20261027';
import { getIrasCpfMasPracticalEvidence } from '../retrieval/irasCpfMasPracticalRules20261027';
import { TargetDateResolver } from '../retrieval/targetDateResolver';
import { getAcraMomKnowledgeEvidence, getIrasMasKnowledgeEvidence, getCpfPayrollKnowledgeEvidence,
  getStatutoryWorkflowEvidence } from '../retrieval/statutoryKnowledge20261027b';

function statusText(stream: AuthorityPresentedWorkstream): string {
  if (stream.evidenceStatus === 'INSUFFICIENT') return 'Evidence incomplete';
  return stream.applicationStatus === 'UNRESOLVED'
    ? 'Verified evidence; case application unresolved'
    : 'Evidence verified';
}

function practicalRuleForIssue(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityEvidencePresentation['workstreams'][number]['issues'][number]
) {
  return getAcraMomKnowledgeEvidence(query, stream, issue) ||
    getIrasMasKnowledgeEvidence(query, stream, issue) ||
    getCpfPayrollKnowledgeEvidence(query, stream, issue) ||
    getStatutoryWorkflowEvidence(query, stream, issue) ||
    getAcraMomPracticalEvidence(query, stream, issue) ||
    getIrasCpfMasPracticalEvidence(query, stream, issue) ||
    getIrasCpfExpansionEvidence(query, stream, issue) ||
    getMomAcraMasExpansionEvidence(query, stream, issue) ||
    getIrasAcraPracticalRuleEvidence(query, stream, issue) ||
    getCpfMasPracticalRuleEvidence(query, stream, issue) ||
    getIrasCpfCoverageEvidence(query, stream, issue) ||
    getMomAcraMasCoverageEvidence(query, stream, issue);
}

/** Renders only verified source excerpts, reviewed summaries, and explicit gaps. */
export function renderAuthorityEvidenceResponseText(
  presentation: AuthorityEvidencePresentation,
  hasBalancedJournal: boolean
): string {
  const requestComplete = hasCompleteRequestRepresentation(presentation);
  const evidenceVerified = presentation.evidenceStatus === 'VERIFIED';
  const issueExplanations = presentation.workstreams.map(stream => ({
    stream,
    issues: stream.issues.map(issue => ({
      issue,
      practicalRule: practicalRuleForIssue(presentation.query, stream, issue),
      momSalaryRule: getMomSalaryPaymentRuleEvidence(presentation.query, stream, issue)
    }))
  }));
  const hasVerifiedGeneralGuidance = issueExplanations.some(({ issues }) =>
    issues.some(({ practicalRule, momSalaryRule }) => Boolean(practicalRule || momSalaryRule)));
  const generalGuidancePrefix = hasVerifiedGeneralGuidance && presentation.status !== 'VERIFIED'
    ? 'Verified general guidance is available. ' : '';
  const overall = presentation.status === 'INSUFFICIENT'
    ? `${generalGuidancePrefix}Evidence is incomplete for one or more material issues.`
    : !requestComplete && evidenceVerified
      ? `${generalGuidancePrefix}Evidence verified for mapped issues; full request coverage unconfirmed${presentation.applicationStatus === 'UNRESOLVED' ? ', and application to the case remains unresolved' : '.'}`
      : presentation.status === 'CONDITIONAL'
      ? `${generalGuidancePrefix}Source coverage is verified, but application to the case remains unresolved.`
      : 'The resolved material issues have verified evidence.';
  const lines = [
    '### Statutory Compliance & Legal Authority',
    '',
    `**Whole-question status:** ${overall}`,
    ...(hasBalancedJournal ? ['', 'The deterministic journal remains available in the Double Entry Journal tab.'] : [])
  ];

  const requestedYears = [...new Set([...presentation.query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]))]
    .filter(year => year !== TargetDateResolver.CURRENT_SYSTEM_DATE.slice(0, 4));
  if (requestedYears.length > 0 && presentation.workstreams.length > 0 &&
      presentation.workstreams.every(stream => stream.evidenceStatus === 'INSUFFICIENT')) {
    lines.push('', `**Applicability limitation:** The available evidence does not establish the requested rule for ${requestedYears.join(', ')}. An official source whose legal applicability covers that period is needed. A current page, its retrieval date, or a document's original issue date alone cannot establish the requirements for an earlier or later period.`);
    if (presentation.workstreams.some(stream => stream.authority === 'CPF')) {
      lines.push('A CPF amount would also require the contribution table applicable to that payroll period, citizenship or PR status and year, age, and relevant wages.');
    }
    if (presentation.workstreams.some(stream => stream.authority === 'ACRA')) {
      lines.push('An ACRA filing deadline would also require the applicable financial year end, company and listing status, AGM facts and any relevant statutory exception.');
    }
  }
  for (const { stream, issues: explainedIssues } of issueExplanations) {
    lines.push('', `#### ${stream.authorityLabel} — ${stream.domainLabel}`, '', `**Status:** ${statusText(stream)}`);
    for (const { issue, practicalRule, momSalaryRule } of explainedIssues) {
      lines.push('', `**${issue.subject}** (party in scope: ${issue.population})`);
      if (practicalRule) {
        lines.push(`- **${practicalRule.authority} rule explanation:** ${practicalRule.text} [${practicalRule.title}](${practicalRule.officialUrl})`);
      }
      if (momSalaryRule?.kind === 'REGULAR_SALARY') {
        lines.push(`- **MOM rule explanation:** For employees covered by the Employment Act, regular salary must be paid at least once a month and within 7 days after the salary period ends. [${momSalaryRule.title}](${momSalaryRule.officialUrl})`);
      } else if (momSalaryRule?.kind === 'OVERTIME_SALARY') {
        lines.push(`- **MOM rule explanation:** For employees covered by the Employment Act, overtime pay must be paid within 14 days after the salary period ends. This explains the payment deadline only; overtime eligibility depends on separate rules. [${momSalaryRule.title}](${momSalaryRule.officialUrl})`);
      }
      if (issue.applicationReason) lines.push(`- **Application${issue.applicationStatus === 'VERIFIED' ? '' : ' unresolved'}:** ${issue.applicationReason}`);
      for (const gap of issue.gaps) lines.push(`- **Evidence gap:** ${gap}`);
    }
    for (const gap of stream.gaps) lines.push(`- **Evidence gap:** ${gap}`);
    for (const source of stream.sources) {
      const scope = [
        source.provenance.replaceAll('_', ' ').toLowerCase(),
        ...(source.validFrom ? [`from ${formatSingaporeDate(source.validFrom)}`] : []),
        ...(source.validTo ? [`through ${formatSingaporeDate(source.validTo)}`] : [])
      ].join('; ');
      lines.push('', `**Source:** ${source.title} (${scope})`);
      for (const claim of source.claims) {
        const label = claim.supportKind === 'EXACT_SOURCE_QUOTE' ? 'Verified official source excerpt' : 'Reviewed local summary';
        const issueNames = claim.issueIds.map(id => stream.issues.find(issue => issue.id === id)?.subject || id);
        lines.push(`- **${label}** (supports ${issueNames.join('; ')}): ${claim.text}`);
      }
      if (source.officialUrl) lines.push(`- Official source: [${source.title}](${source.officialUrl})`);
    }
  }

  if (presentation.workstreams.length === 0) lines.push('', 'No material workstream has verified source coverage.');
  if (presentation.gaps.length > 0) {
    lines.push('', '**Whole-question gaps:**', ...presentation.gaps.map(gap => `- ${gap}`));
  }
  return lines.join('\n');
}
