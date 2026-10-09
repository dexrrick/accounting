import { readFile, writeFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding, getRequestedQuestionConcepts } from '../../src/services/semanticQuestionUnderstanding.ts';
import { readV4Contract, scoreSemanticV4 } from '../../tests/evaluation/singapore/iras-first-targeted-acceptance-v4.mjs';

const runUrl = new URL('./live-rerun-2026-10-09/', import.meta.url);
const summary = JSON.parse(await readFile(new URL('summary.json', runUrl), 'utf8'));
const contract = await readV4Contract();
const rows = summary.cases.filter(row => row.status === 'FAILED').map(row => {
  const expected = contract.cases.find(item => item.caseId === row.caseId);
  const understanding = { mode: 'SEMANTIC_INTERPRETATION', interpretation: row.interpretation };
  const reconciled = reconcileQuestionUnderstanding(expected.question, classifyQuestion(expected.question), understanding);
  return { caseId: row.caseId, question: expected.question, expectedIssues: expected.semantic.expectedIssues,
    actualIssues: row.interpretation.issues, suppliedFacts: row.interpretation.factsExplicitlyProvided,
    concepts: row.interpretation.concepts,
    semanticScoring: scoreSemanticV4(expected, row.interpretation, reconciled.issuePlan),
    reconciledIssuePlan: reconciled.issuePlan,
    requestedConcepts: getRequestedQuestionConcepts(expected.question, understanding),
    failedStages: Object.entries(row.stageVerdicts).filter(([, passed]) => !passed).map(([stage]) => stage),
    failureDiagnostics: row.failureDiagnostics, evidenceRequests: row.evidenceRequests,
    governedStatus: row.productionDiagnostics.governed.status,
    topLevelGaps: row.productionDiagnostics.governed.topLevelGaps,
    ruleEvidence: row.productionDiagnostics.governed.workstreams?.flatMap(stream => stream.issues.map(issue => ({
      subject: issue.subject, evidenceStatus: issue.evidenceStatus, applicationStatus: issue.applicationStatus,
      gaps: issue.gaps, lifecycle: issue.lifecycle
    }))) };
});
await writeFile(new URL('failure-analysis.json', runUrl), JSON.stringify({
  profile: 'GEMINI_LIVE_RERUN_OFFLINE_FAILURE_ANALYSIS', newProviderCalls: 0, newSourceRequests: 0,
  observations: rows
}, null, 2) + '\n');
console.log(JSON.stringify(rows.map(row => ({caseId: row.caseId,
  attribution: row.semanticScoring.subjectAttribution, pairs: row.semanticScoring.pairs,
  concepts: row.requestedConcepts, topLevelGaps: row.topLevelGaps,
  blockedEvidence: row.evidenceRequests.filter(request => !request.captured), ruleEvidence: row.ruleEvidence
})), null, 2));
