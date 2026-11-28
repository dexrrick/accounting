import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const here = new URL('./', import.meta.url);
const previous = new URL('../statutory-review-corrections-20261028/finish-20261030/', here);
const load = async (file, root = here) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const hash = text => createHash('sha256').update(text).digest('hex');
const oldGrades = await load('baseline-independent-grades.json');
const files = { review30: 'review30-application.json', fresh10: 'fresh10-application.json', workflows10: 'fresh-workflows-after.json' };
const baseline = {};
try { Object.assign(baseline, await load('baseline-answers.json')); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  for (const [name, file] of Object.entries(files)) {
    const report = await load(file, previous);
    baseline[name] = { corpusSha256: report.corpusSha256,
      outcomes: report.outcomes.map(({ id, question, answer }) => ({ id, question, answer })) };
  }
  await writeFile(new URL('baseline-answers.json', here), JSON.stringify(baseline, null, 2) + '\n');
}
const packet = { startingCommit: '59cede9c83c27d8398a97a49ddb246a547e771a8', scope: 'Question-only full application offline replay. Grade complete rendered answers against exact retained official evidence. Status wording does not establish applicability or request completeness.', cohorts: {} };
for (const name of Object.keys(files)) {
  const before = baseline[name], after = await load(name + '.json');
  if (before.corpusSha256 !== after.corpusSha256) throw new Error('Changed frozen corpus: ' + name);
  const corpus = await load('corpora/' + name + '.json');
  packet.cohorts[name] = { corpusSha256: after.corpusSha256, beforeSummary: oldGrades.cohorts[name].summary, answers: after.outcomes.map(row => {
    const old = before.outcomes.find(item => item.id === row.id);
    const grade = oldGrades.cohorts[name].grades.find(item => item.id === row.id);
    const test = corpus.cases.find(item => item.id === row.id);
    return { id: row.id, question: row.question, expected: test.expected, forbidden: test.forbidden,
      priorGrade: grade.grade, before: old.answer, after: row.answer,
      beforeSha256: hash(old.answer), afterSha256: hash(row.answer), byteIdentical: old.answer === row.answer,
      evidenceStatus: row.authorityEvidencePresentation?.evidenceStatus,
      applicationStatus: row.authorityEvidencePresentation?.applicationStatus,
      evidence: row.authorityEvidencePresentation?.workstreams.map(stream => ({ authority: stream.authority,
        issues: stream.issues, sources: stream.sources })) || [],
      blockedModelEndpoints: row.blockedModelEndpoints };
  }) };
}
await writeFile(new URL('grading-input.json', here), JSON.stringify(packet, null, 2) + '\n');
// Only these display labels are removed for a status-only comparison. Every
// rule, applicability explanation, quotation and gap remains in the comparison.
const substance = text => text.split('\n').filter(line => !/^\*\*(?:Whole-question status|General statutory guidance|Individual applicability|Material evidence gaps):\*\*/.test(line)).filter(line => line.trim()).join('\n');
const changes = Object.fromEntries(Object.entries(packet.cohorts).map(([name, c]) => [name, c.answers.map(row => ({
  id: row.id, question: row.question, priorGrade: row.priorGrade,
  byteIdentical: row.byteIdentical, statusOnly: substance(row.before) === substance(row.after),
  beforeSha256: row.beforeSha256, afterSha256: row.afterSha256,
  beforeGuidance: row.before.split('\n').filter(line => /rule explanation/.test(line)),
  afterGuidance: row.after.split('\n').filter(line => /rule explanation/.test(line))
}))]));
await writeFile(new URL('answer-deltas.json', here), JSON.stringify(changes, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(packet.cohorts).map(([name, c]) => [name,
  { size: c.answers.length, byteIdentical: c.answers.filter(row => row.byteIdentical).length }]))));
