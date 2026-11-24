import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageDir, '../..');
const gitExecutable = process.env.TASK_GIT_EXE || 'git';
const codeCommit = '4129caa5f611073aeecf87d3ac95b5d32a79f274';
const baseCommit = '24102c38d1b081f786cf22a643bc16747986eb3d';
const baselineCaptureCommit = '847fdad2cfeea3e2d222ea4c4e1ce22ce7d46323';
const corpusNames = ['final75', 'final60', 'fresh15', 'fixed100-original', 'fixed100-enriched'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonicalLf = (bytes) => Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
const readPackageJson = (name) => JSON.parse(readFileSync(join(packageDir, name), 'utf8'));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
}

function git(args, options = {}) {
  try {
    return execFileSync(gitExecutable, args, {
      cwd: repositoryRoot,
      encoding: options.encoding ?? 'buffer',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error.stderr?.toString('utf8').trim();
    throw new Error(`Git command failed (${args.join(' ')}): ${stderr || error.message}`);
  }
}

function verifyPackageHashes() {
  const manifest = readPackageJson('evidence-hashes.json');
  assert(manifest.algorithm === 'SHA-256', 'Unexpected evidence hash algorithm');
  assert(JSON.stringify(manifest.excludes) === JSON.stringify(['evidence-hashes.json']), 'Unexpected evidence manifest exclusions');

  const listed = new Map(manifest.files.map((entry) => [entry.path, entry]));
  assert(listed.size === manifest.files.length, 'Evidence manifest contains duplicate paths');
  const actualPaths = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (relative(packageDir, path).replace(/\\/g, '/') !== 'evidence-hashes.json') {
        actualPaths.push(relative(packageDir, path).replace(/\\/g, '/'));
      }
    }
  };
  walk(packageDir);
  actualPaths.sort();
  const listedPaths = [...listed.keys()].sort();
  assert(JSON.stringify(actualPaths) === JSON.stringify(listedPaths), 'Package files do not exactly match the evidence manifest');

  for (const path of actualPaths) {
    const bytes = readFileSync(join(packageDir, path));
    const entry = listed.get(path);
    assert(entry.sha256 === sha256(bytes) || entry.canonicalLfSha256 === sha256(canonicalLf(bytes)),
      `Prepared bytes changed for ${path}`);
    assert(entry.canonicalLfSha256 === sha256(canonicalLf(bytes)), `Canonical-LF content changed for ${path}`);
  }
  return actualPaths.length;
}

function verifySourceCommitAndHashes() {
  const baselineDelta = git(['diff', '--name-only', baselineCaptureCommit, baseCommit], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
  assert(JSON.stringify(baselineDelta) === JSON.stringify(['.github/workflows/ci.yml']),
    'Before-answer capture code and review base differ beyond the CI workflow');
  const sourcePublication = readPackageJson('source-publication-hashes.json');
  const frozen = readPackageJson('final-code-hashes.json');
  const review = readPackageJson('independent-review-final.json');
  assert(sourcePublication.codeCommit === codeCommit && sourcePublication.baseCommit === baseCommit, 'Source publication commit identity changed');
  assert(sourcePublication.files.length === 19 && frozen.files.length === 19 && review.reviewedFileHashes.length === 19,
    'Expected 19 published source/test hashes');

  const parentLine = git(['rev-list', '--parents', '-n', '1', codeCommit], { encoding: 'utf8' }).trim().split(/\s+/);
  assert(parentLine[0] === codeCommit && parentLine[1] === baseCommit && parentLine.length === 2,
    'Source commit is not a direct child of the recorded base commit');
  const paths = frozen.files.map((entry) => entry.path);
  const commitPaths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', codeCommit], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean).sort();
  assert(JSON.stringify(commitPaths) === JSON.stringify([...paths].sort()), 'Source commit path set differs from the 19 frozen files');

  for (let index = 0; index < frozen.files.length; index += 1) {
    const expected = frozen.files[index];
    const publication = sourcePublication.files[index];
    const reviewed = review.reviewedFileHashes[index];
    assert(publication.path === expected.path && publication.validatedWorktreeSha256 === expected.sha256,
      `Publication hash mapping differs for ${expected.path}`);
    assert(reviewed.path === expected.path && reviewed.sha256 === expected.sha256 && reviewed.actualSha256 === expected.sha256 && reviewed.matches === true,
      `Independent reviewer hash differs for ${expected.path}`);

    const sourcePath = resolve(repositoryRoot, expected.path);
    const worktree = readFileSync(sourcePath);
    const worktreeCanonical = sha256(canonicalLf(worktree));
    const blob = git(['cat-file', 'blob', `${codeCommit}:${expected.path}`]);
    const blobCanonical = sha256(canonicalLf(blob));
    assert(worktreeCanonical === publication.gitCanonicalLfSha256 && blobCanonical === publication.gitCanonicalLfSha256,
      `Committed blob or working tree changed beyond CRLF normalization for ${expected.path}`);
  }
}

function answerRows() {
  return corpusNames.map((name) => readPackageJson(`${name}-answer-strings.json`));
}

function verifyPreservationAndExactAnswers() {
  const preservation = readPackageJson('preservation.json');
  const wht = readPackageJson('wht-current-preservation.json');
  const sourceReview = readPackageJson('wht-independent-review.json');
  const compact = answerRows();
  const flat = compact.flatMap((corpus) => corpus.rows.map((row) => ({ corpus: corpus.corpus, ...row })));
  assert(compact.length === 5 && compact.every((value, index) => value.corpus === corpusNames[index]), 'Compact corpus ordering changed');
  assert(flat.length === 350 && preservation.rows.length === 350 && wht.rows.length === 350, 'Expected 350 exact answer pairs');
  assert(preservation.totals.answers === 350 && preservation.totals.unchanged === 347 && preservation.totals.changed === 3 &&
    preservation.totals.priorCorrect === 213 && preservation.totals.priorCorrectUnchanged === 213 &&
    preservation.totals.networkRequests === 0 && preservation.totals.modelRequests === 0 && preservation.totals.drift.length === 0,
  'Final preservation totals differ from the published record');
  assert(wht.totals.answers === 350 && wht.totals.unchanged === 350 && wht.totals.priorCorrect === 213 &&
    wht.totals.priorCorrectUnchanged === 213 && wht.totals.networkRequests === 0 && wht.totals.modelRequests === 0 && wht.totals.drift.length === 0,
  'WHT intermediate preservation totals differ from the published record');
  assert(sourceReview.status === 'NO_REMAINING_MATERIAL_FINDINGS', 'WHT independent review status is unexpected');

  const changed = [];
  flat.forEach((item, index) => {
    const final = preservation.rows[index];
    const prior = wht.rows[index];
    const questionHash = sha256(Buffer.from(item.question, 'utf8'));
    const beforeHash = sha256(Buffer.from(item.before, 'utf8'));
    const afterHash = sha256(Buffer.from(item.after, 'utf8'));
    assert(final.corpus === item.corpus && final.id === item.id && final.questionSha256 === questionHash,
      `Final preservation order or question hash differs for ${item.corpus}/${item.id}`);
    assert(final.beforeSha256 === beforeHash && final.afterSha256 === afterHash && final.priorCorrect === item.priorCorrect,
      `Final answer strings or prior grade differ for ${item.corpus}/${item.id}`);
    assert(final.unchanged === (beforeHash === afterHash), `Final changed status differs for ${item.corpus}/${item.id}`);
    assert(prior.corpus === item.corpus && prior.id === item.id && prior.questionSha256 === questionHash &&
      prior.beforeSha256 === beforeHash && prior.afterSha256 === beforeHash && prior.unchanged === true,
    `Original/WHT baseline does not match the exact before-answer for ${item.corpus}/${item.id}`);
    if (beforeHash !== afterHash) changed.push({ corpus: item.corpus, id: item.id, beforeHash, afterHash, priorCorrect: item.priorCorrect });
  });
  assert(changed.length === 3, 'Expected exactly three changed answer strings');
  assert(changed.every((row) => row.priorCorrect === false), 'A prior-correct answer changed');
  const protectedAnswers = flat.filter((row) => row.priorCorrect);
  assert(protectedAnswers.length === 213 && protectedAnswers.every((row) => row.before === row.after),
    'All 213 prior-correct answer strings must remain identical');
  return { flat, changed };
}

function verifyReviewGrades(flatAnswers, changedAnswers) {
  const summary = readPackageJson('summary.json');
  const acceptance = readPackageJson('final-acceptance.json');
  const acceptanceCases = readPackageJson('acceptance-cases.json');
  const review = readPackageJson('independent-review-final.json');
  const changedArtifact = readPackageJson('changed-answers.json');
  assert(review.status === 'CLEAR_BOUNDED_OFFLINE_REVIEW' && review.findings.length === 0,
    'Final independent review has unresolved findings');

  assert(summary.acceptance.total === 10 && summary.acceptance.correctBoundedGuidance === 10 &&
    summary.acceptance.wholeQuestionComplete === false && summary.acceptance.networkRequests === 0 && summary.acceptance.modelRequests === 0,
  'Acceptance summary must retain ten bounded answers, no full-coverage claim, and zero calls');
  assert(acceptance.outcomes.length === 10 && acceptanceCases.cases.length === 10 && review.answerGrades.length === 10,
    'Expected ten final acceptance cases and independent grades');
  assert(acceptance.networkRequests === 0 && acceptance.modelRequests === 0, 'Final acceptance recorded network/model requests');
  assert(review.preservation.answers === 350 && review.preservation.unchanged === 347 && review.preservation.changed === 3 &&
    review.preservation.priorCorrect === 213 && review.preservation.priorCorrectUnchanged === 213 &&
    review.preservation.networkRequests === 0 && review.preservation.modelRequests === 0,
  'Independent review preservation totals differ from the final record');

  for (let index = 0; index < acceptance.outcomes.length; index += 1) {
    const outcome = acceptance.outcomes[index];
    const testCase = acceptanceCases.cases[index];
    const grade = review.answerGrades[index];
    const hash = sha256(Buffer.from(outcome.answer, 'utf8'));
    assert(testCase.id === outcome.id && testCase.question === outcome.question && grade.id === outcome.id,
      `Acceptance case/grade order differs at ${index}`);
    assert(grade.answerSha256 === hash && grade.matchesPreviouslyReviewedAnswer === true &&
      grade.grade === 'CORRECT_BOUNDED_GUIDANCE' && grade.wholeQuestionComplete === false,
    `Independent answer grade/hash or coverage boundary differs for ${outcome.id}`);
    assert(outcome.networkRequests === undefined || outcome.networkRequests === 0, `Acceptance outcome made a network request: ${outcome.id}`);
    assert(outcome.modelRequests === undefined || outcome.modelRequests === 0, `Acceptance outcome made a model request: ${outcome.id}`);
  }

  assert(review.changedAnswerGrades.length === 3 && changedArtifact.length === 3, 'Expected three independently graded changed answers');
  changedAnswers.forEach((changed, index) => {
    const grade = review.changedAnswerGrades[index];
    const artifact = changedArtifact[index];
    const answer = flatAnswers.find((row) => row.corpus === changed.corpus && row.id === changed.id);
    assert(grade?.corpus === changed.corpus && grade.id === changed.id && grade.answerSha256 === changed.afterHash &&
      grade.grade === 'CORRECT_BOUNDED_GUIDANCE' && grade.priorCorrect === false && grade.wholeQuestionComplete === false,
    `Changed answer independent grade/hash differs for ${changed.corpus}/${changed.id}`);
    assert(artifact?.corpus === changed.corpus && artifact.id === changed.id && artifact.before === answer.before && artifact.after === answer.after,
      `Detailed changed answer record differs for ${changed.corpus}/${changed.id}`);
    assert(sha256(Buffer.from(artifact.before, 'utf8')) === changed.beforeHash && sha256(Buffer.from(artifact.after, 'utf8')) === changed.afterHash,
      `Detailed changed answer strings do not match their hashes for ${changed.corpus}/${changed.id}`);
  });
}

function verifyNoAccidentalLocalCaptureScripts() {
  const method = readFileSync(join(packageDir, 'capture-method.txt'), 'utf8');
  assert(method.includes('machine-specific paths and the capture script are not included'), 'Capture limitation was not documented');
  assert(!method.includes('D:\\Accounting') && !method.includes('C:\\Users\\Admin'), 'Machine-specific capture paths were published');
}

function main() {
  const fileCount = verifyPackageHashes();
  verifySourceCommitAndHashes();
  const { flat, changed } = verifyPreservationAndExactAnswers();
  verifyReviewGrades(flat, changed);
  verifyNoAccidentalLocalCaptureScripts();
  process.stdout.write(`Verified ${fileCount} package files, 19 committed source hashes, 350 answer pairs, 10 review grades, and 3 changed-answer grades.\n`);
}

main();
