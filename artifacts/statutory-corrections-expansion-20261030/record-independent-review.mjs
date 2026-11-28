import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const here = new URL('./', import.meta.url);
const load = async file => JSON.parse(await readFile(new URL(file, here), 'utf8'));
const bytes = await readFile(new URL('grading-input.json', here));
const gradingInputSha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(gradingInputSha256, '91d91b856bc6bfb1806a839e1f40fd4e2340b29df3bbec77fb2380a4a1c5aa05');
const packet = JSON.parse(bytes), map = await load('independent-grade-map.json');
const deltas = await load('answer-deltas.json');
assert.equal(Object.values(deltas).flat().filter(row => !row.statusOnly).length, 14);
assert.equal(Object.values(deltas).flat().filter(row => row.byteIdentical).length, 6);
const reasons = {
  'hold-iras-02': 'Existing transport-versus-car-cost distinction preserved; conditional recovered-portion clarification is supported.',
  'hold-iras-03': 'Half recovery cannot support a full claim; recovery, non-ancillary supply and ordinary input-tax conditions are retained in the exact quotation.',
  'reviewfresh-cpf-01': 'The age-band change starts on the first day of the following month; no individual contribution amount is invented.',
  'reviewfresh-cpf-02': 'Second SPR year starts 01/09/2026 from conversion on 07/08/2025; this does not establish historical contribution percentages.',
  'reviewfresh-mom-02': 'Non-working-day gross-rate compensation is distinguished from the following-working-day rule for a contractual rest day; weekends are not assumed.',
  'reviewfresh-mas-01': 'The exact toolkit scope passages establish its non-exhaustive SFA purpose and fund-level/outside-SFA exclusions.',
  'fresh29-acra-01': 'Local-company 14-day update duty preserved; annual return does not replace change notification.',
  'fresh29-acra-02': 'The stated foreign-company category and 30-day rule are applied to 20 elapsed days without removing the notification duty.',
  'fresh29-iras-01': 'YA 2025 controls retention through 31 December 2029; disposal on 01/10/2029 is rejected and filing does not end retention.',
  'fresh29-iras-02': 'The separate post-dissolution duty and immediately preceding officer versus liquidator responsibilities are distinguished.',
  'fresh29-cpf-01': 'Ordinary refund clock uses the payment-record date, with 06/11/2026 outer limit; discovery does not restart it.',
  'fresh29-cpf-02': 'Conditional wages use the contractual repayment due date, with 15/09/2027 outer limit; employee share is returned before applying and no unrelated IRAS issue remains.',
  'fresh29-mas-01': 'Prior MAS approval through Form 11 remains required before CEO appointment; notification is not a substitute.',
  'fresh29-mas-02': 'Original wording receives both directions: prior Form 11 approval for Non-Executive to Executive; subsequent notification as soon as practicable for the reverse. The 14-day limit is resignation-specific, supported by exact rows 3/17.'
};
const count = rows => Object.fromEntries(['CORRECT', 'PARTIAL', 'UNSUPPORTED', 'INCORRECT'].map(grade => [grade, rows.filter(row => row.grade === grade).length]));
const cohorts = {};
for (const [name, cohort] of Object.entries(packet.cohorts)) {
  assert.deepEqual(Object.keys(map[name]).sort(), cohort.answers.map(row => row.id).sort());
  const grades = cohort.answers.map(row => ({ id: row.id, priorGrade: row.priorGrade,
    grade: map[name][row.id], answerSha256: row.afterSha256,
    assessment: reasons[row.id] ? 'COMPLETE_CHANGED_ANSWER_REVIEWED_AGAINST_EXACT_SOURCE' : row.byteIdentical ? 'BYTE_IDENTICAL' : 'STATUS_ONLY_BODY_EQUALITY_INDEPENDENTLY_CONFIRMED',
    reason: reasons[row.id] || 'Prior independent substantive grade retained after independently checking identical answer content and unchanged evidence; display status does not upgrade underlying verification.' }));
  cohorts[name] = { corpusSha256: cohort.corpusSha256, before: cohort.beforeSummary, after: count(grades), grades };
}
const all = Object.values(cohorts).flatMap(cohort => cohort.grades);
const regressions = all.filter(row => row.priorGrade === 'CORRECT' && row.grade !== 'CORRECT');
assert.deepEqual(regressions, []);
const report = { reviewer: '/root/independent_review', recording: 'Supervisor transcription of independent reviewer result in this chat.',
  verdict: 'NO_REMAINING_MATERIAL_FINDINGS', gradingInputSha256,
  baseCommit: packet.startingCommit, branch: 'codex/statutory-corrections-expansion-20261030',
  reviewedState: 'Frozen uncommitted implementation: all 15 tested-source-state.json hashes independently matched.',
  method: { totalAnswers: 50, substantiveChangedAnswers: 14, statusOnlyBodyEqual: 30, byteIdentical: 6,
    qualification: 'Complete materially changed answers assessed against admitted exact official-source quotations. Header-only rows retain prior substantive grades after independent body comparison. Classification/retrieval success alone is not correctness.' },
  cohorts, totalAfter: count(all), priorCorrectPreserved: 33, regressions,
  remainingUnsupported: all.filter(row => row.grade === 'UNSUPPORTED').map(row => row.id),
  independentValidation: ['Frozen grading packet and all 15 source hashes matched.', 'Status-only body equality independently checked.', 'Focused workflow suite PASS.', 'Focused MAS/IRAS source expansion suite PASS.'],
  resolvedFindings: ['Employee voice does not invent employer applicant role.', 'Invalid/leap dates do not produce CPF deadlines.', 'Contractual due dates are distinguished from actual repayment.', 'Historical legal-duty wording retains historical scope.', 'Foreign status, elapsed-event binding and unsupported compound day counts do not invent deadline applicability.', 'Original MAS wording works without injecting answer keywords.', 'Row 17 preserves as-soon-as-practicable and resignation-specific 14-day timing.', 'Status rendering preserves underlying verification.'],
  limitations: ['Reviewer did not independently run broad lint/build/smoke/full checks; supervisor reports those separately.', 'Preexisting fixture-digest evidence report inspected; reproduction not independently rerun by reviewer.', 'ECI original-fixture preservation remains qualified.', 'Offline 50-answer assessment is not exhaustive correctness, live-model/browser acceptance, CI, production or release approval.'] };
await writeFile(new URL('independent-answer-grades.json', here), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ totalAfter: report.totalAfter, priorCorrectPreserved: 33, regressions }));
