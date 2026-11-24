import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(outputDir, '../..');
const balancedDir = join(repositoryRoot, 'artifacts/statutory-balanced-expansion-20261103');
const whtDir = join(repositoryRoot, 'artifacts/statutory-review-wht-scope-20261103');
const originalDir = join(repositoryRoot, 'artifacts/statutory-review-three-findings-20261103');

const baseCommit = '24102c38d1b081f786cf22a643bc16747986eb3d';
const codeCommit = '4129caa5f611073aeecf87d3ac95b5d32a79f274';
const gitExecutable = process.env.TASK_GIT_EXE || 'git';

const corpusDefinitions = [
  { name: 'final75', field: 'answer' },
  { name: 'final60', field: 'answer' },
  { name: 'fresh15', field: 'answer' },
  { name: 'fixed100-original', field: 'response' },
  { name: 'fixed100-enriched', field: 'response' },
];

const copiedJson = [
  ['balanced', 'summary.json', 'summary.json'],
  ['balanced', 'final-code-hashes.json', 'final-code-hashes.json'],
  ['balanced', 'validation-results.json', 'validation-results.json'],
  ['balanced', 'full-results.json', 'full-results.json'],
  ['balanced', 'preservation.json', 'preservation.json'],
  ['balanced', 'changed-answers.json', 'changed-answers.json'],
  ['balanced', 'final-acceptance.json', 'final-acceptance.json'],
  ['balanced', 'acceptance-cases.json', 'acceptance-cases.json'],
  ['balanced', 'independent-review-final.json', 'independent-review-final.json'],
  ['balanced', 'starting-input-hashes.json', 'starting-input-hashes.json'],
  ['balanced', 'mas-vcfm-branch-proof-diagnostic.json', 'mas-vcfm-branch-proof-diagnostic.json'],
  ['wht', 'review-cases.json', 'wht-review-cases.json'],
  ['wht', 'review-before-app.json', 'wht-review-before-app.json'],
  ['wht', 'review-after-app.json', 'wht-review-after-app.json'],
  ['wht', 'current-preservation.json', 'wht-current-preservation.json'],
  ['wht', 'summary.json', 'wht-summary.json'],
  ['wht', 'independent-review.json', 'wht-independent-review.json'],
];

const copiedLogs = [
  ['full.log', 'full.txt'],
  ['smoke.log', 'smoke.txt'],
  ['maintained-lint.log', 'maintained-lint.txt'],
  ['typecheck.log', 'typecheck.txt'],
  ['vite-build.log', 'vite-build.txt'],
  ['worker-build.log', 'worker-build.txt'],
  ['mom-polarity-final.log', 'mom-polarity-final.txt'],
  ['wht-final.log', 'wht-final.txt'],
  ['locator-final.log', 'locator-final.txt'],
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonicalLf = (bytes) => Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

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

function copyExact(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

function corpusOutput(root, definition) {
  assert(Array.isArray(root.outcomes), 'Expected corpus outcomes array');
  return root.outcomes.map((outcome) => {
    const answer = outcome[definition.field];
    assert(typeof outcome.id === 'string', `Missing id in ${definition.name}`);
    assert(typeof outcome.question === 'string', `Missing question in ${definition.name}/${outcome.id}`);
    assert(typeof answer === 'string', `Missing ${definition.field} in ${definition.name}/${outcome.id}`);
    return { id: outcome.id, question: outcome.question, answer };
  });
}

function checkCommitIdentity(expectedPaths) {
  const parents = git(['rev-list', '--parents', '-n', '1', codeCommit], { encoding: 'utf8' }).trim().split(/\s+/);
  assert(parents[0] === codeCommit && parents[1] === baseCommit && parents.length === 2,
    `Expected ${codeCommit} to be a single-parent commit directly after ${baseCommit}`);

  const committedPaths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', codeCommit], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean).sort();
  assert(JSON.stringify(committedPaths) === JSON.stringify([...expectedPaths].sort()),
    'The reviewed code commit does not contain exactly the 19 frozen source/test paths');
}

function buildSourcePublicationHashes(finalCodeHashes, review) {
  const files = finalCodeHashes.files;
  assert(Array.isArray(files) && files.length === 19, 'Expected exactly 19 frozen source/test hashes');
  const reviewed = review.reviewedFileHashes;
  assert(Array.isArray(reviewed) && reviewed.length === files.length, 'Independent review must bind all 19 frozen files');

  const expectedPaths = files.map((entry) => entry.path);
  assert(new Set(expectedPaths).size === expectedPaths.length, 'Frozen source paths must be unique');
  checkCommitIdentity(expectedPaths);

  const publicationFiles = files.map((entry, index) => {
    assert(reviewed[index]?.path === entry.path, `Independent review order differs at ${entry.path}`);
    assert(reviewed[index]?.sha256 === entry.sha256 && reviewed[index]?.actualSha256 === entry.sha256 && reviewed[index]?.matches === true,
      `Independent review hash mismatch for ${entry.path}`);

    const sourcePath = resolve(repositoryRoot, entry.path);
    assert(sourcePath.startsWith(`${repositoryRoot}/`) || sourcePath.startsWith(`${repositoryRoot}\\`),
      `Source path escaped repository: ${entry.path}`);
    const worktree = readFileSync(sourcePath);
    const worktreeHash = sha256(worktree);
    const worktreeLfHash = sha256(canonicalLf(worktree));
    const blob = git(['cat-file', 'blob', `${codeCommit}:${entry.path}`]);
    const blobLfHash = sha256(canonicalLf(blob));

    assert(worktreeLfHash === blobLfHash, `Published commit and working tree differ beyond CRLF normalization for ${entry.path}`);
    assert(worktreeHash === entry.sha256,
      `Working-tree bytes do not match the frozen source hash for ${entry.path}`);

    return {
      path: entry.path,
      validatedWorktreeSha256: entry.sha256,
      gitCanonicalLfSha256: blobLfHash,
    };
  });

  return {
    codeCommit,
    baseCommit,
    canonicalization: 'SHA-256 after replacing CRLF with LF for both committed blobs and working-tree text.',
    files: publicationFiles,
  };
}

function buildCompactAnswerFiles() {
  const baselineLedger = readJson(join(originalDir, 'answer-preservation-hashes.json'));
  const intermediate = readJson(join(whtDir, 'current-preservation.json'));
  const finalPreservation = readJson(join(balancedDir, 'preservation.json'));
  const oldRows = baselineLedger.rows;
  const intermediateRows = intermediate.rows;
  const finalRows = finalPreservation.rows;

  assert(baselineLedger.codeHead === '847fdad2cfeea3e2d222ea4c4e1ce22ce7d46323', 'Unexpected original baseline head');
  assert(oldRows.length === 350 && intermediateRows.length === 350 && finalRows.length === 350,
    'Expected 350 baseline, WHT-intermediate, and final preservation rows');
  assert(intermediate.totals.answers === 350 && intermediate.totals.unchanged === 350 && intermediate.totals.drift.length === 0,
    'The WHT intermediate must preserve all 350 baseline answers');

  const outputFiles = [];
  let rowIndex = 0;
  for (const definition of corpusDefinitions) {
    const beforeRoot = readJson(join(originalDir, `${definition.name}.json`));
    const afterRoot = readJson(join(balancedDir, `${definition.name}.json`));
    const before = corpusOutput(beforeRoot, definition);
    const after = corpusOutput(afterRoot, definition);
    assert(before.length === after.length, `Answer count changed in ${definition.name}`);

    const rows = before.map((old, index) => {
      const next = after[index];
      const baseline = oldRows[rowIndex];
      const wht = intermediateRows[rowIndex];
      const final = finalRows[rowIndex];
      rowIndex += 1;

      assert(old.id === next.id && old.question === next.question, `Question order/id changed in ${definition.name} at ${index}`);
      assert(baseline?.corpus === definition.name && baseline.id === old.id, `Original baseline order mismatch for ${definition.name}/${old.id}`);
      assert(wht?.corpus === definition.name && wht.id === old.id, `WHT preservation order mismatch for ${definition.name}/${old.id}`);
      assert(final?.corpus === definition.name && final.id === old.id, `Final preservation order mismatch for ${definition.name}/${old.id}`);

      const questionSha256 = sha256(Buffer.from(old.question, 'utf8'));
      const beforeSha256 = sha256(Buffer.from(old.answer, 'utf8'));
      const afterSha256 = sha256(Buffer.from(next.answer, 'utf8'));
      const priorCorrect = baseline.priorGrade === 'CORRECT';

      assert(baseline.questionSha256 === questionSha256 && baseline.afterAnswerSha256 === beforeSha256,
        `Original answer does not match its preserved baseline hash for ${definition.name}/${old.id}`);
      assert(wht.questionSha256 === questionSha256 && wht.beforeSha256 === beforeSha256 && wht.afterSha256 === beforeSha256 && wht.unchanged === true,
        `WHT intermediate is not identical to the original baseline for ${definition.name}/${old.id}`);
      assert(final.questionSha256 === questionSha256 && final.beforeSha256 === beforeSha256 && final.afterSha256 === afterSha256,
        `Final preservation hashes do not match exact answer strings for ${definition.name}/${old.id}`);
      assert(final.priorCorrect === priorCorrect, `Prior correctness grade changed for ${definition.name}/${old.id}`);
      assert(final.unchanged === (beforeSha256 === afterSha256), `Incorrect changed/unchanged status for ${definition.name}/${old.id}`);

      return {
        id: old.id,
        question: old.question,
        before: old.answer,
        after: next.answer,
        questionSha256,
        beforeSha256,
        afterSha256,
        priorCorrect,
      };
    });

    const filename = `${definition.name}-answer-strings.json`;
    writeJson(join(outputDir, filename), { corpus: definition.name, rows });
    outputFiles.push(filename);
  }

  assert(rowIndex === 350, `Expected 350 answers, received ${rowIndex}`);
  assert(finalPreservation.totals.answers === 350 && finalPreservation.totals.unchanged === 347 &&
    finalPreservation.totals.changed === 3 && finalPreservation.totals.priorCorrect === 213 &&
    finalPreservation.totals.priorCorrectUnchanged === 213 && finalPreservation.totals.networkRequests === 0 &&
    finalPreservation.totals.modelRequests === 0 && finalPreservation.totals.drift.length === 0,
  'Final preservation totals or offline-call counts differ from the reviewed record');

  return outputFiles;
}

function writeCaptureInstructions() {
  const contents = `Reproduction notes\n\nThe evidence was captured offline through the application entry point processAccountingQuery(question, null, IFRS, undefined) for 150 natural-language cases and through the statutory coverage replay for 200 fixture-plan cases. Both runs recorded zero network and model requests.\n\nThe original capture command used local source-manifest directories and an external-fetch guard. Those machine-specific paths and the capture script are not included. The corpus and source-fixture identity hashes are in starting-input-hashes.json; the source fixtures remain in the repository. To reproduce, use the same tracked corpora and source fixtures with the project scripts scripts/evaluate_statutory_natural_20261027.mjs and scripts/replay_statutory_coverage.mjs, then compare answer strings with the five *-answer-strings.json files and preservation.json.\n\nThe compact files preserve the exact UTF-8 question and before/after answer strings. They omit the broader per-answer retrieval and evidence trace, which remains available in the original local capture artifacts.\n`;
  writeFileSync(join(outputDir, 'capture-method.txt'), contents, 'utf8');
}

function writeEvidenceHashManifest() {
  const manifestPath = join(outputDir, 'evidence-hashes.json');
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path !== manifestPath) {
        const bytes = readFileSync(path);
        files.push({
          path: relative(outputDir, path).replace(/\\/g, '/'),
          sha256: sha256(bytes),
          canonicalLfSha256: sha256(canonicalLf(bytes)),
        });
      }
    }
  };
  walk(outputDir);
  files.sort((left, right) => left.path.localeCompare(right.path));
  writeJson(manifestPath, {
    algorithm: 'SHA-256',
    canonicalization: 'canonicalLfSha256 replaces CRLF with LF; sha256 binds exact prepared bytes.',
    excludes: ['evidence-hashes.json'],
    files,
  });
}

function main() {
  mkdirSync(outputDir, { recursive: true });
  const balanced = (name) => join(balancedDir, name);
  const wht = (name) => join(whtDir, name);

  for (const [sourceRoot, sourceName, targetName] of copiedJson) {
    copyExact(sourceRoot === 'balanced' ? balanced(sourceName) : wht(sourceName), join(outputDir, targetName));
  }
  for (const [sourceName, targetName] of copiedLogs) {
    copyExact(balanced(sourceName), join(outputDir, targetName));
  }

  const review = readJson(join(outputDir, 'independent-review-final.json'));
  const finalCodeHashes = readJson(join(outputDir, 'final-code-hashes.json'));
  const sourcePublicationHashes = buildSourcePublicationHashes(finalCodeHashes, review);
  writeJson(join(outputDir, 'source-publication-hashes.json'), sourcePublicationHashes);
  const compactAnswerFiles = buildCompactAnswerFiles();
  writeCaptureInstructions();

  const summary = readJson(join(outputDir, 'summary.json'));
  assert(summary.baseHead === baseCommit, 'Summary base commit differs from the publication base');
  assert(compactAnswerFiles.length === 5, 'Expected five compact answer files');
  writeEvidenceHashManifest();

  const fileCount = readdirSync(outputDir, { withFileTypes: true }).filter((entry) => entry.isFile()).length;
  process.stdout.write(`Prepared ${fileCount} package files; 350 exact answer pairs; 19 source hashes.\n`);
}

main();
