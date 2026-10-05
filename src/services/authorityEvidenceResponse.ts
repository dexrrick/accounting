import type { AuthorityEvidencePresentation, AuthorityPresentedWorkstream } from '../utils/authorityEvidencePresentation';
import { formatSingaporeDate } from '../utils/dateUtils';

function statusText(stream: AuthorityPresentedWorkstream): string {
  if (stream.evidenceStatus === 'INSUFFICIENT') return 'Evidence incomplete';
  return stream.applicationStatus === 'UNRESOLVED'
    ? 'Verified evidence; case application unresolved'
    : 'Evidence verified';
}

/** Renders only verified source excerpts, reviewed summaries, and explicit gaps. */
export function renderAuthorityEvidenceResponseText(
  presentation: AuthorityEvidencePresentation,
  hasBalancedJournal: boolean
): string {
  const overall = presentation.status === 'INSUFFICIENT'
    ? 'Evidence is incomplete for one or more material issues.'
    : presentation.status === 'CONDITIONAL'
      ? 'Source coverage is verified, but application to the case remains unresolved.'
      : 'The resolved material issues have verified evidence.';
  const lines = [
    '### Statutory Compliance & Legal Authority',
    '',
    `**Whole-question status:** ${overall}`,
    ...(hasBalancedJournal ? ['', 'The deterministic journal remains available in the Double Entry Journal tab.'] : [])
  ];

  for (const stream of presentation.workstreams) {
    lines.push('', `#### ${stream.authorityLabel} — ${stream.domainLabel}`, '', `**Status:** ${statusText(stream)}`);
    for (const issue of stream.issues) {
      lines.push('', `**${issue.subject}** (party in scope: ${issue.population})`);
      if (issue.applicationReason) lines.push(`- **Application unresolved:** ${issue.applicationReason}`);
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
