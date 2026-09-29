import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuestion } from '../../../src/classification/questionClassifier.ts';
import {
  interpretSemanticQuestion,
  reconcileQuestionUnderstanding,
  projectQuestionUnderstandingDiagnostics
} from '../../../src/services/semanticQuestionUnderstanding.ts';
import { buildGroundedReasoningContext } from '../../../src/services/groundingContextBuilder.ts';
import { defaultAdvancedSourceRetriever } from '../../../src/retrieval/advancedSourceRetriever.ts';
import { executeStructuredLlmCall } from '../../../src/services/aiTransport.ts';
import { setTimeout as pause } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.join(root, 'docs/evaluation/semantic-question-understanding');
const fixture = JSON.parse(await readFile(path.join(root, 'tests/evaluation/singapore/semantic-question-heldout.json'), 'utf8'));
const implementationSha256 = createHash('sha256').update(await readFile(path.join(root, 'src/services/semanticQuestionUnderstanding.ts'))).digest('hex');
const baseline = JSON.parse(await readFile(path.join(output, 'deterministic-baseline.json'), 'utf8'));
const live = process.argv.includes('--live');
const caseId = process.argv.find(argument => argument.startsWith('--case='))?.slice(7);
const replayPath = process.argv.find(argument => argument.startsWith('--replay-from='))?.slice(14);
const replayReport = replayPath ? JSON.parse(await readFile(path.resolve(root, replayPath), 'utf8')) : undefined;
const measured = live || Boolean(replayReport);
const paceMs = Number(process.argv.find(argument => argument.startsWith('--pace-ms='))?.slice(10) || (live ? 4500 : 0));
if (!Number.isFinite(paceMs) || paceMs < 0 || paceMs > 10_000) throw new Error('Invalid evaluation pacing interval.');
const apiKey = process.env.GEMINI_API_KEY?.trim();
if (live && !apiKey) throw new Error('Configure GEMINI_API_KEY locally before --live evaluation. No provider call was made.');

function expectedInterpretation(testCase) {
  const domain = testCase.domain === 'ACCOUNTING_SFRS' ? 'ACCOUNTING'
    : testCase.domain === 'CPF_CONTRIBUTIONS' ? 'CPF_PAYROLL'
      : testCase.domain === 'IRAS_UNKNOWN' ? 'IRAS_OTHER'
        : ['IRAS_INDIVIDUAL_TAX', 'IRAS_CORPORATE_TAX', 'IRAS_EMPLOYER_TAX'].includes(testCase.domain) ? 'IRAS_INCOME_TAX'
          : testCase.domain;
  return {
    jurisdiction: ['Singapore'],
    authorityCandidates: [domain === 'ACCOUNTING' ? 'ACCOUNTING_STANDARDS' : domain === 'CPF_PAYROLL' ? 'CPF' : 'IRAS'],
    contextualAuthorities: testCase.concepts.some(concept => /CPF relief/i.test(concept)) ? ['CPF'] : [],
    domain,
    population: testCase.population[0],
    primarySubject: testCase.subject,
    concepts: testCase.concepts.map((concept, index) => ({ concept, role: index === 0 ? 'PRIMARY' : 'RELATED' })),
    requestedOperation: testCase.operation[0],
    requiresUserSpecificFacts: testCase.requiresFacts,
    calculationRequested: testCase.operation[0] === 'CALCULATE',
    factsExplicitlyProvided: [],
    confidence: 0.95
  };
}

function authorityCorrect(testCase, classification) {
  if (testCase.domain.startsWith('IRAS')) return classification.authorities.length === 1 && classification.authorities[0] === 'IRAS';
  if (testCase.domain === 'CPF_CONTRIBUTIONS') return classification.authorities.includes('CPF') && !classification.authorities.includes('IRAS');
  return !classification.authorities.includes('IRAS') && classification.accountingAnalysisRequired;
}

function domainCorrect(testCase, classification) {
  if (testCase.domain === 'IRAS_UNKNOWN') return classification.authorities.includes('IRAS') &&
    !classification.domains.includes('IRAS_INDIVIDUAL_TAX') && !classification.domains.includes('IRAS_CORPORATE_TAX');
  return classification.domains.includes(testCase.domain);
}

function conceptScore(testCase, interpretation) {
  if (!interpretation) return { status: 'NO_INTERPRETATION' };
  const actual = interpretation.concepts.filter(concept => concept.role !== 'CONTEXT_ONLY').map(concept => concept.concept);
  const normalize = text => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const matched = testCase.concepts.filter(expected => actual.some(value => normalize(value).includes(normalize(expected))));
  return { status: matched.length === testCase.concepts.length ? 'EXACT_LABEL_MATCH' : 'MANUAL_SYNONYM_REVIEW_REQUIRED', matched, actual };
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const rows = [];
console.log = () => {};
console.warn = () => {};
console.error = () => {};
try {
  for (const testCase of fixture.cases.filter(item => !caseId || item.id === caseId)) {
    if (live && rows.length && paceMs) await pause(paceMs);
    let interpreterHttpStatus;
    const replayCase = replayReport?.cases.find(item => item.id === testCase.id);
    if (replayReport && !replayCase) throw new Error(`No interpreter checkpoint for ${testCase.id}.`);
    const interpretationStarted = performance.now();
    const understanding = replayReport
      ? replayCase.rawInterpretation
        ? { mode: 'SEMANTIC_INTERPRETATION', interpretation: replayCase.rawInterpretation }
        : { mode: 'DETERMINISTIC_FALLBACK', failure: replayCase.interpreterFailure || 'INVALID_RESPONSE' }
      : live
      ? await interpretSemanticQuestion(testCase.question, apiKey, async (...arguments_) => {
        try { return await executeStructuredLlmCall(...arguments_); }
        catch (error) { interpreterHttpStatus = /HTTP (\d+)/.exec(error instanceof Error ? error.message : '')?.[1]; throw error; }
      })
      : await interpretSemanticQuestion(testCase.question, 'fixture-provider-placeholder', async () => JSON.stringify(expectedInterpretation(testCase)));
    const interpretationDurationMs = live ? Math.round(performance.now() - interpretationStarted) : undefined;
    const reconciled = reconcileQuestionUnderstanding(testCase.question, classifyQuestion(testCase.question), understanding);
    const interpretation = understanding.interpretation;
    // Real local evidence and production evidence gates are exercised. External
    // discovery is deliberately offline and can never supply synthetic evidence.
    const context = await buildGroundedReasoningContext(testCase.question, null, defaultAdvancedSourceRetriever, undefined, {
      questionUnderstanding: reconciled.understanding,
      authorityLevelDiscovery: true,
      fetchOptions: { useCache: false, customFetch: async () => new Response('Offline evaluation: source unavailable', { status: 503 }) },
      discoveryAdapter: { discoverOfficialSourceCandidates: async () => [] },
      officialDomainSearchAdapter: { searchOfficialDomainCandidates: async () => [] }
    });
    const classification = context.classification;
    const old = baseline.find(item => item.id === testCase.id)?.classification;
    const isVehicle = /passenger car|motor car/i.test(testCase.subject);
    const inappropriateVehicleFacts = isVehicle ? [] : classification.missingFacts.filter(fact => /vehicle|s-plate|motor.car/i.test(fact));
    rows.push({
      id: testCase.id,
      question: testCase.question,
      interpretationSource: replayReport ? 'LIVE_PROVIDER_REPLAY' : live ? 'LIVE_PROVIDER' : 'INDEPENDENT_LABEL_ORACLE',
      modelUnderstandingMeasured: measured,
      rawInterpretation: measured ? interpretation : undefined,
      understanding: projectQuestionUnderstandingDiagnostics(reconciled.understanding),
      interpreterFailure: understanding.failure,
      interpreterHttpStatus,
      interpretationDurationMs,
      requiresUserSpecificFacts: interpretation?.requiresUserSpecificFacts,
      calculationRequested: interpretation?.calculationRequested,
      dimensions: {
        semanticInterpretation: measured ? Boolean(interpretation && testCase.population.includes(interpretation.population) && testCase.operation.includes(interpretation.requestedOperation) && interpretation.requiresUserSpecificFacts === testCase.requiresFacts) : 'NOT_MEASURED_ORACLE_INPUT',
        authority: authorityCorrect(testCase, classification),
        population: measured ? Boolean(interpretation && testCase.population.includes(interpretation.population)) : 'NOT_MEASURED_ORACLE_INPUT',
        concepts: measured ? conceptScore(testCase, interpretation) : 'NOT_MEASURED_ORACLE_INPUT',
        requestedOperation: measured ? Boolean(interpretation && testCase.operation.includes(interpretation.requestedOperation)) : 'NOT_MEASURED_ORACLE_INPUT',
        missingFactAppropriateness: inappropriateVehicleFacts.length === 0 &&
          (testCase.requiresFacts ? classification.missingFacts.length > 0 : context.missingFacts.length === 0),
        retrievalRouting: domainCorrect(testCase, classification) && (testCase.domain.startsWith('IRAS') === Boolean(context.evidenceQuality)),
        domain: domainCorrect(testCase, classification),
        finalEvidenceCoverage: context.evidenceQuality?.status || 'NON_IRAS_POLICY'
      },
      baseline: old ? { authority: authorityCorrect(testCase, old), retrievalRouting: domainCorrect(testCase, old), missingFacts: old.missingFacts } : undefined,
      classification: { authorities: classification.authorities, domains: classification.domains, topicIds: classification.topicIds, missingFacts: classification.missingFacts },
      evidence: {
        status: context.evidenceQuality?.status,
        eligibleRecordIds: context.evidenceQuality?.eligibleRecords.map(record => record.id) || [],
        uncoveredTopicIds: context.evidenceQuality?.uncoveredTopicIds || [],
        discoveryPath: context.sourceMapFallbackTrace?.path
      }
    });
    originalLog(`[${testCase.id}] authority=${rows.at(-1).dimensions.authority}; routing=${rows.at(-1).dimensions.retrievalRouting}; evidence=${rows.at(-1).dimensions.finalEvidenceCoverage}`);
  }
} finally {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
}
const count = selector => rows.filter(selector).length;
const durations = rows.map(row => row.interpretationDurationMs).filter(Number.isFinite).sort((a, b) => a - b);
const summary = {
  mode: replayReport ? 'LIVE_INTERPRETER_REPLAY_WITH_OFFLINE_EVIDENCE' : live ? 'LIVE_INTERPRETER_WITH_OFFLINE_EVIDENCE' : 'ORACLE_ROUTING_WITH_OFFLINE_EVIDENCE',
  evaluatedAt: new Date().toISOString(),
  runtime: process.version,
  model: measured ? replayReport?.summary.model || 'gemini-3.5-flash-lite' : 'NOT_MEASURED_ORACLE_INPUT',
  interpreterLatencyMs: durations.length ? { median: durations[Math.floor(durations.length / 2)], p95: durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)], max: durations.at(-1) } : undefined,
  implementationSha256,
  interpretationImplementationSha256: replayReport?.summary.implementationSha256 || implementationSha256,
  cases: rows.length,
  modelUnderstandingMeasured: measured,
  validModelInterpretations: measured ? count(row => Boolean(row.rawInterpretation) && !row.interpreterFailure) : 'NOT_MEASURED_ORACLE_INPUT',
  semanticInterpretationCorrect: measured ? count(row => row.dimensions.semanticInterpretation === true) : 'NOT_MEASURED_ORACLE_INPUT',
  populationCorrect: measured ? count(row => row.dimensions.population === true) : 'NOT_MEASURED_ORACLE_INPUT',
  requestedOperationCorrect: measured ? count(row => row.dimensions.requestedOperation === true) : 'NOT_MEASURED_ORACLE_INPUT',
  authorityCorrect: count(row => row.dimensions.authority),
  domainCorrect: count(row => row.dimensions.domain),
  retrievalScopeCorrect: count(row => row.dimensions.retrievalRouting),
  appropriateMissingFacts: count(row => row.dimensions.missingFactAppropriateness),
  baselineAuthorityCorrect: count(row => row.baseline?.authority),
  baselineDomainCorrect: count(row => row.baseline?.retrievalRouting),
  finalEvidenceCoverage: rows.reduce((counts, row) => { const status = row.dimensions.finalEvidenceCoverage; counts[status] = (counts[status] || 0) + 1; return counts; }, {}),
  limitations: ['Oracle inputs do not measure model extraction accuracy.', 'Offline official discovery measures existing evidence admission and coverage only; live source availability is not measured.', 'Concept labels with synonyms require independent manual review.', 'Case-specific fact policy is scored against independently authored strict labels; wording that asks for conditions may admit a general explanation without deciding the user’s case.', 'No tax conclusion is inferred from routing correctness.']
};
await mkdir(output, { recursive: true });
const report = { summary, cases: rows };
const serialized = JSON.stringify(report, null, 2);
if (apiKey && serialized.includes(apiKey)) throw new Error('Refusing to save credential-shaped evaluation output.');
await writeFile(path.join(output, `${replayReport ? 'replayed-live' : live ? 'live' : 'oracle'}${caseId ? `-${caseId}` : ''}-evaluation.json`), serialized);
console.log(JSON.stringify(summary, null, 2));
