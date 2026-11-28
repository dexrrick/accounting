import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { tryGenerateGroundedSynthesis } from '../../src/services/evidenceGroundedSynthesis.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';

// Scripted transport measurements, not legal grading or live-provider latency.
const examples = [
  ['IRAS', 'IRAS_GST', 'GST_REG26_BLOCKED_INPUT_TAX', 'What input tax restrictions should our business check?'],
  ['CPF', 'CPF_PAYROLL', 'CPFA_SEC7_FIRST_SCHEDULE', 'Who is responsible for paying CPF contributions?'],
  ['MOM', 'MOM_EMPLOYMENT', 'MOM_SEC21_SALARY_TIMELINES', 'When must salary and overtime be paid?'],
  ['ACRA', 'ACRA_CORPORATE', 'ACRA_SEC171_COMPANY_SECRETARY', 'Can a sole director also act as company secretary?'],
  ['MAS', 'MAS_FUNDS', 'MAS_FMC_CMS_LICENSING', 'What should a Singapore fund manager establish before starting?']
];
const results = [];
for (const [authority, domain, key, query] of examples) {
  const record = UNIFIED_SOURCE_REGISTRY[key];
  const issue = { issueId: 'issue-1', subject: query, domain, population: 'COMPANY', operation: 'EXPLAIN_RULE',
    evidenceRequirement: 'AUTHORITATIVE_SOURCE', governingAuthority: authority, sourceSections: [], lifecycle: {},
    evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED', sources: [record], gaps: [],
    verifiedClaims: [{ recordId: record.id, quote: record.sourceText, text: record.sourceText,
      supportKind: 'EXACT_SOURCE_QUOTE', canonicalUrl: record.canonicalSourceUrl }] };
  const calls = [];
  const started = performance.now();
  const result = await tryGenerateGroundedSynthesis({ query, standard: 'SFRS_I', history: [],
    provider: { activeProvider: 'openai', openai: { apiKey: 'scripted-comparison-only', model: 'mock' }, gemini: {}, azure: {} },
    response: { scenarioState: { scenarioType: 'UNRECOGNIZED', rawQuery: query, functionalCurrency: 'SGD',
      transactionCurrency: 'SGD', directGroups: [], missingFields: [], isComplete: true } },
    workstreams: { query, issuePlan: { issues: [{ id: issue.issueId, subject: query, domain, operation: issue.operation,
      evidenceRequirement: issue.evidenceRequirement }] }, requestCompletenessContext: {}, workstreams: [{
      id: 'stream-1', authority, domain, populations: ['COMPANY'], issues: [issue], sources: [record], verifiedClaims: issue.verifiedClaims,
      sourceSections: [], evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED', gaps: [] }],
      evidenceStatus: 'VERIFIED', applicationStatus: 'NOT_REQUIRED', status: 'VERIFIED', gaps: [] }
  }, { call: async (prompt, system) => {
    const packet = JSON.parse(prompt);
    calls.push({ stage: system.split('\n')[0], promptCharacters: prompt.length + system.length,
      estimatedInputTokens: Math.ceil(Buffer.byteLength(prompt + system) / 4) });
    if (system.startsWith('EVIDENCE_GROUNDED_REVIEW')) return JSON.stringify({ verdicts: packet.claims.map(claim => ({
      claimId: claim.id, verdict: 'SUPPORTED', supportingEvidenceIds: claim.supportIds, supportingFactRefs: claim.factRefs, reason: 'Scripted support.' })) });
    return JSON.stringify({ claims: [{ id: 'answer-1', kind: 'RULE', text: packet.evidencePassages[0].completeAdmittedPassage,
      supportIds: [packet.evidencePassages[0].id], factRefs: [], issueId: 'issue-1' }] });
  } });
  results.push({ authority, query, calls, elapsedScriptedMs: performance.now() - started,
    answer: result?.messageText, citations: result?.officialAnswerLinks, verification: result?.verification });
}
fs.writeFileSync(new URL(process.argv[2] || './comparison.json', import.meta.url), JSON.stringify({
  measurement: 'Scripted identical-question synthesis comparison; no live model, legal quality, billed tokens or network latency measured.', results
}, null, 2) + '\n');
console.log(JSON.stringify(results.map(({authority, calls, answer}) => ({authority, calls: calls.length,
  promptCharacters: calls.reduce((total, call) => total + call.promptCharacters, 0), answered: Boolean(answer)}))));
