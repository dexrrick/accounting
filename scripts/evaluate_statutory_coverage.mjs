import { readFile, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import { defaultQueryTopicResolver, QueryTopicResolver } from '../src/retrieval/queryTopicResolver.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'tests/evaluation/statutory_coverage_wave_2026-10-25.json');
const baselineCommit = '9f5f8a3309cf28b5dcf56eb3a78da6c693801208';

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return undefined;
    return `${url.origin.toLowerCase()}${url.pathname}`;
  } catch { return undefined; }
}

function validISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function answerHash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function validIndependentReview(review, expectedHash, testCase) {
  return ['HUMAN', 'INDEPENDENT_AGENT'].includes(review?.reviewer?.kind)
    && String(review?.reviewer?.identity || '').trim().length > 0
    && ['CORRECT', 'PARTIAL', 'UNSUPPORTED'].includes(review?.outcome)
    && String(review?.reason || '').trim().length > 0
    && review?.caseId === testCase.id
    && review?.questionSha256 === answerHash(testCase.question)
    && review?.answerSha256 === expectedHash;
}

function numericTokens(value) {
  return [...String(value || '').matchAll(/(?:(?:s\$|sgd|\$)\s*)?\d[\d,]*(?:\.\d+)?\s*(?:%|percent|dollars?|sgd|days?|hours?|employees?)?/gi)]
    .map(match => match[0].replace(/[^\d.]/g, ''));
}

function positiveAnswerText(value) {
  return String(value || '')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/\[(?:[^\]]*)\]\(https?:\/\/[^)]+\)/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[“"][^”"]*[”"]/g, ' ')
    .replace(/‘[^’]*’/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseHasExpectedPolarity(sentence, phrase, polarity = 'POSITIVE') {
  const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = new RegExp(escaped, 'i').exec(sentence);
  if (!match) return false;
  const before = sentence.slice(Math.max(0, match.index - 60), match.index);
  const negated = /\b(?:not|never|no|cannot|can't|unable|ineligible|without|doesn't|don't|isn't|aren't)\b/i.test(before);
  return polarity === 'NEGATIVE' ? negated : !negated;
}

function factGroupsSatisfied(answer, groups) {
  const text = positiveAnswerText(answer).toLowerCase();
  const sentences = text.split(/(?<=[.!?;])\s+|\n+/).map(item => item.trim())
    .filter(item => Boolean(item) && !/[?]$/.test(item) && !/^(?:what|when|where|why|who|which|how|can|could|does|do|is|are|should|would)\b/i.test(item));
  return groups.map(group => ({
    satisfied: sentences.some(sentence => group.anyOf.some(phrase => phraseHasExpectedPolarity(sentence, phrase, group.polarity))),
    anyOf: group.anyOf,
    polarity: group.polarity || 'POSITIVE'
  }));
}

function hasClarificationCue(answer) {
  return /\b(?:need|needs|required|requires|depends|cannot determine|can't determine|cannot calculate|can't calculate|please provide|please specify|not enough information|insufficient information|unknown|unclear)\b/i.test(positiveAnswerText(answer));
}

export function evaluateCapturedAnswer(testCase, captured) {
  if (!captured || !String(captured.answer || '').trim()) {
    return { outcome: 'NOT_RUN', answerStatus: 'NOT_EVALUATED', citationStatus: 'NOT_EVALUATED', temporalStatus: 'NOT_EVALUATED', calculationStatus: 'NOT_EVALUATED', reason: 'No captured application answer was supplied.' };
  }
  const answer = String(captured.answer);
  const groups = testCase.expected.disposition === 'CLARIFY'
    ? testCase.expected.missingFactGroups : testCase.expected.requiredFactGroups;
  const checks = factGroupsSatisfied(answer, groups);
  const satisfied = checks.filter(item => item.satisfied).length;
  const clarificationCue = hasClarificationCue(answer);
  const checklistStatus = testCase.expected.disposition === 'CLARIFY'
    ? (clarificationCue && satisfied === groups.length ? 'PASS' : satisfied > 0 || clarificationCue ? 'PARTIAL' : 'FAIL')
    : (satisfied === groups.length ? 'PASS' : satisfied > 0 ? 'PARTIAL' : 'FAIL');
  const answerTextForCalculation = positiveAnswerText(answer);
  const questionNumbers = new Set(numericTokens(testCase.question));
  const containsNumericResult = numericTokens(answerTextForCalculation).some(token => !questionNumbers.has(token));
  const expectedAnswerHash = answerHash(answer);
  const independentReviewValid = validIndependentReview(captured.independentReview, expectedAnswerHash, testCase);
  const adjudicatedCorrect = independentReviewValid && captured.independentReview.outcome === 'CORRECT';
  const adjudicatedUnsupported = independentReviewValid && captured.independentReview.outcome === 'UNSUPPORTED';
  const answerStatus = adjudicatedUnsupported ? 'UNSUPPORTED'
    : checklistStatus === 'PASS'
      ? adjudicatedCorrect && !(testCase.expected.disposition === 'CLARIFY' && testCase.operation === 'CALCULATE' && containsNumericResult) ? 'CORRECT' : 'PARTIAL'
      : checklistStatus === 'PARTIAL' ? 'PARTIAL' : 'UNSUPPORTED';

  const citations = Array.isArray(captured.citations) ? captured.citations : [];
  const citedUrls = citations.map(item => typeof item === 'string' ? item : item?.url).filter(Boolean);
  const accepted = new Set(testCase.officialSources.map(canonicalUrl).filter(Boolean));
  const citationStatus = citedUrls.some(url => accepted.has(canonicalUrl(url))) ? 'PASS' : 'FAIL';
  const targetDate = testCase.temporal?.targetDate;
  const temporalStatus = targetDate
    ? (validISODate(targetDate) && citations.some(item => {
      if (typeof item !== 'object' || !accepted.has(canonicalUrl(item.url)) || !validISODate(item.validFrom)) return false;
      if (item.validTo && !validISODate(item.validTo)) return false;
      if (item.validTo && item.validFrom > item.validTo) return false;
      return item.validFrom <= targetDate && (!item.validTo || item.validTo >= targetDate);
    }) ? 'PASS' : 'NOT_EVALUATED')
    : 'NOT_EVALUATED';
  const calculationReviewValid = validIndependentReview(captured.calculationReview, expectedAnswerHash, testCase)
    && captured.calculationReview.outcome === 'CORRECT';
  const calculationStatus = testCase.operation === 'CALCULATE'
    ? testCase.expected.disposition === 'CLARIFY' && checklistStatus === 'PASS' && !containsNumericResult
      ? 'NOT_APPLICABLE_NO_RESULT'
      : calculationReviewValid ? 'PASS' : 'NOT_EVALUATED'
    : 'NOT_APPLICABLE';
  let outcome = answerStatus;
  if (answerStatus !== 'UNSUPPORTED' && checklistStatus === 'PASS' && citationStatus !== 'PASS') outcome = 'CITATION_FAILURE';
  if (answerStatus === 'CORRECT' && targetDate && temporalStatus !== 'PASS') outcome = 'PARTIAL';
  if (answerStatus === 'CORRECT' && testCase.operation === 'CALCULATE' && calculationStatus !== 'PASS' && calculationStatus !== 'NOT_APPLICABLE_NO_RESULT') outcome = 'PARTIAL';
  const groupsMissing = checks.filter(item => !item.satisfied).map(item => item.anyOf);
  return {
    outcome,
    answerStatus,
    checklistStatus,
    independentReviewStatus: independentReviewValid ? `${captured.independentReview.reviewer.kind}_REVIEW_${captured.independentReview.outcome}` : captured.independentReview ? 'INVALID_OR_STALE_REVIEW' : 'PENDING',
    citationStatus,
    temporalStatus,
    calculationStatus,
    reason: adjudicatedUnsupported
      ? `Independent review found the captured answer unsupported: ${captured.independentReview.reason}`
      : answerStatus === 'CORRECT'
      ? targetDate && temporalStatus !== 'PASS' ? 'Answer checklist matched, but approved-source validity for the requested date was not established.'
        : testCase.operation === 'CALCULATE' && calculationStatus === 'NOT_EVALUATED' ? 'Answer checklist matched, but a numerical calculation was not independently evaluated.'
          : citationStatus === 'PASS' ? 'Required answer checklist matched outside quoted text and an approved official page was cited.' : 'Required answer checklist matched, but no approved official source citation was captured.'
      : checklistStatus === 'PASS' ? 'Answer checklist matched, but this case has no independent human adjudication.'
      : `${satisfied}/${groups.length} required fact groups matched; ${testCase.expected.disposition === 'CLARIFY' && !clarificationCue ? 'a clarification/uncertainty cue is missing.' : 'the expected answer or qualification is incomplete.'}`,
    missingFactGroups: groupsMissing,
    evidence: citations
  };
}

function topicCatalog(metadata) {
  return metadata.map(item => ({
    id: item.id,
    name: item.title,
    keywords: item.keywords || [],
    queryPatterns: item.queryPatterns,
    exclusionKeywords: item.exclusionKeywords || [],
    domainId: item.domainId,
    authorities: item.authorities || [],
    coverageStatus: item.status || 'MISSING',
    actOrStandard: item.actOrStandard,
    sectionMatch: item.sectionMatch
  }));
}

async function previousCommitRegistry() {
  const executable = process.env.TASK_GIT_EXE || 'git';
  const source = execFileSync(executable, ['show', `${baselineCommit}:src/standards/coverageRegistry.ts`], { cwd: root, encoding: 'utf8' });
  const transpiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
  return topicCatalog(module.SINGAPORE_COVERAGE_REGISTRY);
}

function route(testCase, resolver) {
  const found = resolver.decomposeQuery(testCase.question).topics.map(topic => topic.id);
  return { actualTopicIds: found, missingRequiredTopicIds: testCase.requiredTopicIds.filter(id => !found.includes(id)), status: testCase.requiredTopicIds.every(id => found.includes(id)) ? 'PASS' : 'MISS' };
}

export async function runStatutoryCoverageBenchmark({ answers = { cases: [] } } = {}) {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const oldCatalog = await previousCommitRegistry();
  const previousCurrentTopics = QueryTopicResolver.CANONICAL_TOPICS;
  let baseline;
  try {
    QueryTopicResolver.CANONICAL_TOPICS = oldCatalog;
    baseline = fixture.cases.map(testCase => ({ id: testCase.id, authority: testCase.authority, ...route(testCase, defaultQueryTopicResolver) }));
  } finally {
    QueryTopicResolver.CANONICAL_TOPICS = previousCurrentTopics;
  }
  const current = fixture.cases.map(testCase => ({ id: testCase.id, authority: testCase.authority, ...route(testCase, defaultQueryTopicResolver) }));

  const capturedCases = Array.isArray(answers.cases) ? answers.cases : [];
  const knownIds = new Set(fixture.cases.map(item => item.id));
  const answerById = new Map();
  for (const answer of capturedCases) {
    if (!knownIds.has(answer.id)) throw new Error(`Unknown benchmark answer ID: ${answer.id}`);
    if (answerById.has(answer.id)) throw new Error(`Duplicate benchmark answer ID: ${answer.id}`);
    const expected = fixture.cases.find(item => item.id === answer.id);
    if (answer.question !== expected.question) throw new Error(`Captured question does not match fixture for ${answer.id}`);
    answerById.set(answer.id, answer);
  }
  const evaluations = fixture.cases.map(testCase => {
    const captured = answerById.get(testCase.id);
    return { id: testCase.id, authority: testCase.authority, family: testCase.family,
      question: testCase.question, operation: testCase.operation,
      routing: current.find(item => item.id === testCase.id),
      answer: evaluateCapturedAnswer(testCase, captured),
      ...(captured ? { capturedAnswer: captured.answer, capturedEvidence: { citations: captured.citations || [], evidence: captured.evidence || [] } } : {}) };
  });
  const countBy = (items, selector) => Object.fromEntries([...new Set(items.map(selector))].map(key => [key, items.filter(item => selector(item) === key).length]));
  const routeSummary = routes => ({ total: routes.length, routed: routes.filter(item => item.status === 'PASS').length,
    byAuthority: Object.fromEntries(['IRAS', 'CPF', 'MOM', 'ACRA', 'MAS'].map(authority => [authority, {
      total: routes.filter(item => item.authority === authority).length,
      routed: routes.filter(item => item.authority === authority && item.status === 'PASS').length
    }])) });
  return {
    scope: 'Offline coverage benchmark. Topic routing, answer checklist, citations, applicability, and calculations are reported separately.',
    evaluatorLimit: 'Literal fact-group matches are heuristic. CORRECT requires an answer-, case-, and question-bound independent review and all applicable citation, date, and calculation checks; routing never counts as answer success.',
    liveAcceptance: 'NOT_RUN',
    questionCounts: fixture.authorityCounts,
    routing: { baselineCommit, baseline: routeSummary(baseline), current: routeSummary(current), additionalRoutedQuestions: current.filter(item => item.status === 'PASS' && baseline.find(prior => prior.id === item.id)?.status !== 'PASS').map(item => item.id) },
    answerOutcomes: countBy(evaluations, item => item.answer.outcome),
    outcomesByAuthority: Object.fromEntries(['IRAS', 'CPF', 'MOM', 'ACRA', 'MAS'].map(authority => [authority, countBy(evaluations.filter(item => item.authority === authority), item => item.answer.outcome)])),
    cases: evaluations
  };
}

async function main() {
  const answersArgument = process.argv.find(arg => arg.startsWith('--answers='));
  const outputArgument = process.argv.find(arg => arg.startsWith('--out='));
  const answers = answersArgument ? JSON.parse(await readFile(path.resolve(process.cwd(), answersArgument.slice('--answers='.length)), 'utf8')) : { cases: [] };
  const report = await runStatutoryCoverageBenchmark({ answers });
  if (outputArgument) {
    const outputPath = path.resolve(process.cwd(), outputArgument.slice('--out='.length));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote statutory coverage report to ${outputPath}`);
  } else console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
