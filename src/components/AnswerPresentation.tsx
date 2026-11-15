import React from 'react';
import type { AccountingScenarioState } from '../types/accounting';
import { hasCompleteRequestRepresentation, hasCurrentAuthorityEvidencePresentation } from '../utils/authorityEvidencePresentation';
import { hasCurrentIrasEvidencePresentation } from '../utils/irasEvidencePresentation';
import { isCurrentRequestCompletenessContext } from '../services/requestCompleteness';
import { getCanonicalOfficialAnswerLinks, getOfficialAnswerAuthorityLabel } from '../utils/answerPresentation';
import { SafeChatAnswer } from './SafeChatAnswer';

interface AnswerPresentationProps {
  text: string;
  scenario?: AccountingScenarioState | null;
  compact?: boolean;
  bodyDisclosureLabel?: string;
}

interface VisibleCondition {
  text: string;
  subject?: string;
}

interface EvidenceSummary {
  summary?: string;
  gaps: string[];
  visibleConditions: VisibleCondition[];
  conditionsLabel?: string;
}

function authorityConditions(presentation: NonNullable<AccountingScenarioState['authorityEvidencePresentation']>): VisibleCondition[] {
  const seen = new Set<string>();
  const conditions: VisibleCondition[] = [];
  for (const stream of presentation.workstreams) {
    for (const issue of stream.issues) {
      const entries = [issue.applicationReason, ...issue.gaps].filter((text): text is string => Boolean(text?.trim()));
      for (const text of entries) {
        const identity = `${issue.subject}\u0000${text}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        conditions.push({ subject: issue.subject, text });
      }
    }
  }
  return conditions;
}

function currentVisibleConditions(
  authority: AccountingScenarioState['authorityEvidencePresentation'],
  irasFacts: readonly string[]
): VisibleCondition[] {
  const conditions = authority ? authorityConditions(authority) : [];
  const seenText = new Set(conditions.map(condition => condition.text.trim()));
  for (const fact of irasFacts) {
    const text = fact.trim();
    if (!text || seenText.has(text)) continue;
    seenText.add(text);
    conditions.push({ text });
  }
  return conditions;
}

function currentEvidenceSummary(scenario: AccountingScenarioState | null | undefined): {
  summary?: EvidenceSummary['summary'];
  gaps: EvidenceSummary['gaps'];
  visibleConditions: EvidenceSummary['visibleConditions'];
  conditionsLabel?: EvidenceSummary['conditionsLabel'];
} {
  if (!scenario) return { gaps: [], visibleConditions: [] };

  const authority = scenario.authorityEvidencePresentation;
  const iras = scenario.irasEvidencePresentation;
  const requestCompletenessContext = scenario.requestCompletenessContext;
  const currentIras = hasCurrentIrasEvidencePresentation(iras, scenario.rawQuery, scenario.primaryDomain, scenario.queryIntent) &&
      requestCompletenessContext && isCurrentRequestCompletenessContext(requestCompletenessContext, scenario.rawQuery)
    ? iras
    : undefined;
  const irasFacts = currentIras?.factsToConfirm || [];
  if (hasCurrentAuthorityEvidencePresentation(authority, scenario.rawQuery)) {
    const requestComplete = hasCompleteRequestRepresentation(authority);
    if (authority.evidenceStatus === 'INSUFFICIENT' || authority.status === 'INSUFFICIENT') {
      return {
        summary: 'Evidence is incomplete for some parts of the question.', gaps: authority.gaps,
        visibleConditions: currentVisibleConditions(authority, irasFacts), conditionsLabel: 'Conditions and evidence still needed'
      };
    }
    if (!requestComplete) {
      const application = authority.applicationStatus === 'UNRESOLVED' ? ' Whether it applies to this case has not been established.' : '';
      return {
        summary: `Evidence is verified for the identified issues, but coverage of the entire question is unconfirmed.${application}`,
        gaps: authority.gaps,
        visibleConditions: currentVisibleConditions(authority, irasFacts),
        conditionsLabel: 'Conditions and evidence still needed'
      };
    }
    if (authority.applicationStatus === 'UNRESOLVED' || authority.status === 'CONDITIONAL') {
      return {
        summary: 'Evidence is available, but whether it applies to this case has not been established.', gaps: authority.gaps,
        visibleConditions: currentVisibleConditions(authority, irasFacts), conditionsLabel: 'Conditions and evidence still needed'
      };
    }
    return {
      summary: 'Evidence is verified for all identified issues, and the entire question has been covered.', gaps: authority.gaps,
      visibleConditions: currentVisibleConditions(authority, irasFacts), conditionsLabel: 'Conditions and evidence still needed'
    };
  }

  if (currentIras) {
    // This legacy IRAS projection is query-bound but has no identity brand. Keep
    // its material fact prompts visible without promoting its scalar status.
    return {
      gaps: [],
      visibleConditions: currentVisibleConditions(undefined, irasFacts),
      conditionsLabel: 'Facts to confirm'
    };
  }

  if (authority || iras) {
    return { summary: 'Evidence status is unavailable for the current question. Cited links do not establish verification.', gaps: [], visibleConditions: [] };
  }
  return { gaps: [], visibleConditions: [] };
}

export const AnswerPresentation: React.FC<AnswerPresentationProps> = ({ text, scenario, compact = false, bodyDisclosureLabel }) => {
  const links = getCanonicalOfficialAnswerLinks(scenario?.officialAnswerLinks);
  const evidence = currentEvidenceSummary(scenario);

  return (
    <section aria-label="Assistant answer" className="space-y-4">
      <div className="font-normal">
        {bodyDisclosureLabel ? (
          <details className="rounded-lg border border-workspace-border px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-workspace-accent-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
              {bodyDisclosureLabel}
            </summary>
            <div className="mt-3">
              <SafeChatAnswer text={text} trustedLinks={links} />
            </div>
          </details>
        ) : (
          <SafeChatAnswer text={text} trustedLinks={links} />
        )}
      </div>
      {evidence.summary && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-100">
          <span className="font-semibold">Evidence status:</span> {evidence.summary}
        </p>
      )}
      {evidence.visibleConditions.length > 0 && (
        <section aria-label={evidence.conditionsLabel || 'Conditions and evidence still needed'} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-100">
          <h4 className="font-semibold">{evidence.conditionsLabel || 'Conditions and evidence still needed'}</h4>
          <ul className="mt-1.5 ml-5 list-disc space-y-1.5">
            {evidence.visibleConditions.map((condition, index) => (
              <li key={`visible-condition-${index}`}>
                {condition.subject && <span className="font-semibold">{condition.subject}: </span>}
                {condition.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!compact && evidence.gaps.length > 0 && (
        <details className="rounded-lg border border-workspace-border px-3 py-2 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-800 dark:text-workspace-secondary">Evidence details and open gaps</summary>
          <ul className="mt-2 ml-5 list-disc space-y-1.5 text-slate-700 dark:text-workspace-secondary">
            {evidence.gaps.map((gap, index) => <li key={`evidence-gap-${index}`}>{gap}</li>)}
          </ul>
        </details>
      )}
      {!compact && links.length > 0 && (
        <footer className="border-t border-workspace-border pt-3">
          <h4 className="text-xs font-semibold text-slate-900 dark:text-workspace-secondary">Cited sources</h4>
          <ul className="mt-2 list-inside list-disc space-y-1.5 text-xs">
            {links.map(link => {
              const authority = getOfficialAnswerAuthorityLabel(link.url);
              return (
                <li key={link.url}>
                  {authority && <span className="font-semibold">{authority}: </span>}
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-workspace-accent-text underline underline-offset-2">
                    {link.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </footer>
      )}
    </section>
  );
};
