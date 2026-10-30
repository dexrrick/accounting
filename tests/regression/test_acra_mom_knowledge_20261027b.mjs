import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ACRA_MOM_KNOWLEDGE_RULES_20261027B,
  ACRA_MOM_KNOWLEDGE_SOURCE_CATALOG_20261027B,
  acraMomKnowledgePointers,
  getAcraMomKnowledgeEvidence,
  hasAcraMomKnowledgeContradiction,
  selectAcraMomKnowledgeQuotes,
  supportAcraMomKnowledgeRule
} from '../../src/retrieval/acraMomKnowledge20261027b.ts';
import { hasPracticalExpansionContradiction, practicalExpansionPointers, supportPracticalExpansionRule } from '../../src/retrieval/practicalStatutoryExpansion.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';

const fixtureDir = new URL('../fixtures/statutoryKnowledge20261027b/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('acra-mom-source-manifest.json', fixtureDir), 'utf8'));
const fixtures = Object.fromEntries(manifest.sources.map(source => [source.fixture,
  readFileSync(new URL(source.fixture, fixtureDir), 'utf8')]));
const legacySalaryHtml = readFileSync(new URL('../statutoryCoverageSources/mom-final-salary.html', fixtureDir), 'utf8');

const cases = [
  {
    id: 'acra-officer-particulars', authority: 'ACRA', topicId: 'acra-annual-return-officer-particulars',
    query: 'From 20 October 2026, what officer particulars and CEO details must a company confirm when it files its annual returns?',
    subject: 'Annual returns officer particulars and CEO confirmation', source: 'acra-officer-particulars.txt',
    operation: 'FILING_REQUIREMENT', expected: ['20 October 2026', 'directors', 'chief executive officers', 'identification details', 'CEO role', 'companies limited by guarantee', 'member count']
  },
  {
    id: 'acra-annual-return-process', authority: 'ACRA', topicId: 'acra_annual-returns',
    query: 'How do I file a local company annual return in Bizfile and what should I check first?',
    subject: 'Annual return process and pre-filing checklist', source: 'acra-annual-return-steps.txt',
    operation: 'FILING_REQUIREMENT', expected: ['Corppass', 'registered office', 'officers', 'XBRL', 'AGM', 'overdue annual returns']
  },
  {
    id: 'acra-xbrl', authority: 'ACRA', topicId: 'acra_xbrl',
    query: 'Which XBRL template and financial statement attachments apply to smaller companies from 19 October 2026 onwards?',
    subject: 'XBRL filing template requirements by company type and size', source: 'acra-xbrl-requirements.txt',
    operation: 'FILING_REQUIREMENT', expected: ['Simplified XBRL', '$500,000', 'Full XBRL', 'section 201A', '19 October 2026', 'XBRL FSH']
  },
  {
    id: 'mom-annual-leave', authority: 'MOM', topicId: 'mom_annual_leave',
    query: 'How many days of statutory annual leave do Employment Act employees receive and how is leave prorated?',
    subject: 'Annual leave eligibility, minimum entitlement and pro-rating', source: 'mom-annual-leave.txt',
    operation: 'EXPLAIN_RULE', expected: ['3 months', '7 days', '14 days', 'completed months', 'one-half', 'unpaid leave', 'notice period']
  },
  {
    id: 'mom-sick-leave', authority: 'MOM', topicId: 'mom_sick_leave',
    query: 'What are the outpatient and hospitalisation leave limits and eligibility rules for an employee?',
    subject: 'Sick leave eligibility and annual entitlement by service period', source: 'mom-sick-leave.txt',
    operation: 'EXPLAIN_RULE', expected: ['3 months', '48 hours', '5 days', '15 days', '14 days', '60 days', 'includes']
  },
  {
    id: 'mom-public-holiday', authority: 'MOM', topicId: 'mom-public-holidays',
    query: 'What public holiday pay does an employee receive if required to work on the holiday?',
    subject: 'Public holiday entitlements, replacement days and pay for holiday work', source: 'mom-public-holidays.txt',
    operation: 'EXPLAIN_RULE', expected: ['11 paid public holidays', 'gross rate', 'basic rate', 'rest day', 'non-working day', 'without consent', 'approved unpaid leave', 'Part IV']
  },
  {
    id: 'mom-final-salary', authority: 'MOM', topicId: 'mom-salary-payment',
    query: 'When must employers pay final salary when employees resign, are dismissed, or their employment is terminated?',
    subject: 'Final salary deadlines for resignation, dismissal and employer termination', source: 'mom-final-salary.txt',
    operation: 'EXPLAIN_RULE', expected: ['last day of employment', 'within 7 days', '3 working days', 'tax clearance']
  }
];

assert.equal(ACRA_MOM_KNOWLEDGE_RULES_20261027B.length, 7);
assert.equal(ACRA_MOM_KNOWLEDGE_SOURCE_CATALOG_20261027B.length, 7);
assert.equal(manifest.sources.length, 8, 'The new source package also includes the current ACRA secretary page for the existing secretary family.');

for (const row of cases) {
  const sourceText = fixtures[row.source];
  const manifestSource = manifest.sources.find(source => source.fixture === row.source);
  assert.ok(manifestSource, `${row.id}: source fixture has an official-source record`);
  assert.match(manifestSource.url, /^https:\/\/(?:www\.)?(?:acra|mom)\.gov\.sg\//);
  assert.equal(createHash('sha256').update(sourceText).digest('hex'), manifestSource.fixtureSha256,
    `${row.id}: selected excerpt bytes match the retained fixture digest`);
  assert.equal(manifestSource.retrievedOnSingaporeDate, '27/10/2026', `${row.id}: retrieval date is recorded`);
  assert.ok(manifestSource.effectiveDateEvidence, `${row.id}: applicability evidence is recorded`);
  const input = { authority: row.authority, topicId: row.topicId, query: row.query, subject: row.subject,
    sourceText, officialUrl: manifestSource.url };
  assert.equal(supportAcraMomKnowledgeRule(input), true, `${row.id}: the complete official-source excerpt proves the rule`);
  assert.equal(hasAcraMomKnowledgeContradiction(input), false,
    `${row.id}: a correct official-source excerpt does not trigger the fallback contradiction veto`);
  const quotes = selectAcraMomKnowledgeQuotes(input);
  assert.ok(quotes.length >= 1, `${row.id}: selected rule passages support the answer`);
  if (row.id === 'mom-annual-leave') {
    const selectedText = quotes.join('\n').toLowerCase();
    const probationRow = sourceText.split(/\r?\n/).find(value => /^3 to 12 months\s*\|/i.test(value));
    assert.ok(probationRow, 'The retained source contains the 3-to-12-month probation row.');
    assert.ok(quotes.includes(probationRow), 'The selected quotes preserve the exact visible completed-months/probation row.');
    assert.ok(selectedText.includes('(number of completed months of service ÷ 12 months) × number of days of annual leave entitlement'),
      'Annual leave quotations retain the exact 12-month calculation formula.');
    assert.ok(selectedText.includes('if the fraction of a day is less than one-half, round it down.'),
      'Annual leave quotations retain the lower rounding rule.');
    assert.ok(selectedText.includes('if it is half or more, round it up to one day.'),
      'Annual leave quotations retain the half-up rounding rule.');
  }
  if (row.id === 'acra-annual-return-process') {
    assert.ok(quotes.some(quote => /Fees:\s*\$60\./.test(quote)), 'The selected annual-return process quotes retain the exact S$60 fee.');
  }
  assert.equal(supportAcraMomKnowledgeRule({ ...input, sourceText: quotes.join('\n') }), true,
    `${row.id}: the returned source quotes alone preserve every required rule premise`);
  assert.deepEqual(acraMomKnowledgePointers(input), [manifestSource.url]);
  assert.equal(supportAcraMomKnowledgeRule({ ...input, sourceText: '' }), false,
    `${row.id}: missing source evidence fails closed`);
  assert.equal(supportAcraMomKnowledgeRule({ ...input, officialUrl: 'https://example.com/not-official' }), false,
    `${row.id}: unrelated domain cannot prove an owned rule`);
  assert.deepEqual(selectAcraMomKnowledgeQuotes({ ...input, officialUrl: undefined }), [],
    `${row.id}: displayed quotations require exact official-source identity`);
  assert.ok(ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === row.id.toUpperCase().replaceAll('-', '_'))
    || ACRA_MOM_KNOWLEDGE_RULES_20261027B.some(rule => rule.topicIds.includes(row.topicId)),
  `${row.id}: the question is exposed through topic metadata`);
  const answer = ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(rule => rule.topicIds.includes(row.topicId));
  for (const expected of row.expected) assert.match(answer.rule + ' ' + answer.conditions.join(' ') + ' ' + answer.exceptions.join(' '),
    new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `${row.id}: rendered rule covers ${expected}`);
}

for (const [row, boundary] of [[cases[0], '20 October 2026'], [cases[2], '19 October 2026']]) {
  const source = manifest.sources.find(item => item.fixture === row.source);
  assert.equal(supportAcraMomKnowledgeRule({ ...row, query: `${row.query} (subject repeats ${boundary})`,
    sourceText: fixtures[row.source], officialUrl: source.url }), true,
  `${row.id}: a repeated identical commencement date remains valid`);
}

const secretaryFixture = fixtures['acra-company-secretary.txt'];
const secretarySource = manifest.sources.find(source => source.fixture === 'acra-company-secretary.txt');
assert.equal(secretarySource.topicIds[0], 'acra_company-secretary');
assert.equal(createHash('sha256').update(secretaryFixture).digest('hex'), secretarySource.fixtureSha256);
for (const phrase of ['within six months of successful registration', 'position cannot be empty for more than six months',
  'fine of up to $1,000', 'Be a real person (not a company)', 'Not be the same person as the sole director']) {
  assert.ok(secretaryFixture.includes(phrase), `The refreshed ACRA secretary source includes: ${phrase}`);
}
assert.match(secretarySource.url, /appointing-company-directors-other-key-officers\/$/);

assert.equal(supportAcraMomKnowledgeRule({ ...cases[0], sourceText: fixtures[cases[0].source], officialUrl: undefined }), true,
  'Source validation may be used before canonical-URL metadata is attached; rendering separately requires the canonical URL.');
for (const [row, oldQuery] of [
  [cases[0], 'What annual return officer particulars applied before 20 October 2026?'],
  [cases[1], 'How did a company file its annual return in 2025?'],
  [cases[2], 'Which XBRL requirements applied before 19 October 2026?'],
  [cases[3], 'What was the statutory annual leave entitlement in 2025?'],
  [cases[4], 'What sick leave entitlement applied in 2025?'],
  [cases[5], 'What public holiday pay rules applied in 2025?'],
  [cases[6], 'When must final salary be paid in 2025?']
]) {
  const sourceText = fixtures[row.source];
  const source = manifest.sources.find(item => item.fixture === row.source);
  assert.equal(supportAcraMomKnowledgeRule({ ...row, query: oldQuery, sourceText, officialUrl: source.url }), false,
    `${row.id}: the current source excerpt cannot establish an unsupported historical period`);
}

for (const [row, conflictingQuery] of [
  [cases[0], 'From 20 October 2026, what officer particulars must be confirmed on an annual return filed on 19 October 2026?'],
  [cases[2], 'Which XBRL rules apply from 19 October 2026 for financial statements filed on 18 October 2026?']
]) {
  const source = manifest.sources.find(item => item.fixture === row.source);
  assert.equal(supportAcraMomKnowledgeRule({ ...row, query: conflictingQuery, sourceText: fixtures[row.source], officialUrl: source.url }), false,
    `${row.id}: an additional conflicting filing date cannot inherit the rule's commencement boundary`);
}

const wrongFacts = [
  [cases[0], '20 October 2026', '20 October 2025'],
  [cases[0], 'will need to confirm', 'will not need to confirm'],
  [cases[1], 'At least two directors', 'one director'],
  [cases[1], 'Fees: $60.', 'Fees: $600.'],
  [cases[1], 'Fees: $60.', 'Fees: $60.50.'],
  [cases[2], 'Revenue for the current financial year does not exceed $500,000.', 'Revenue for the current financial year exceeds $500,000.'],
  [cases[2], 'Revenue for the current financial year does not exceed $500,000.', 'Revenue for the current financial year does not exceed $500,0000.'],
  [cases[2], 'Total assets for the current financial year do not exceed $500,000.', 'Total assets for the current financial year do not exceed $500,000.50.'],
  [cases[3], '1st | 7', '1st | 9'],
  [cases[3], '÷ 12 months', '÷ 10 months'],
  [cases[3], 'If it is half or more, round it up to one day.', 'If it is half or more, round it down to zero days.'],
  [cases[4], '3 | 13 May | 5 | 15', '3 | 13 May | 14 | 60'],
  [cases[4], '6 and thereafter | 13 August | 14 | 60', '6 and thereafter | 13 August | 14 | 600'],
  [cases[4], '6 and thereafter | 13 August | 14 | 60', '6 and thereafter | 13 August | 140 | 60'],
  [cases[5], '11 paid public holidays', '12 paid public holidays'],
  [cases[5], 'were not absent on the working day immediately before or after a holiday without consent or a reasonable excuse.', 'were absent on the working day immediately before or after a holiday with consent and a reasonable excuse.'],
  [cases[6], 'Employee resigns and serves the required notice period | On the last day of employment.', 'Employee resigns and serves the required notice period | Within 7 days of the last day of employment.'],
  [cases[6], 'Employee resigns and does not serve the notice period | Within 7 days of the last day of employment.', 'Employee resigns and does not serve the notice period | Within 5 days of the last day of employment.'],
  [cases[6], 'Dismissal on grounds of misconduct | On the last day of employment. If this is not possible, then within 3 working days from date of dismissal.', 'Dismissal on grounds of misconduct | On the last day of employment. If this is not possible, then within 5 working days from date of dismissal.'],
  [cases[6], 'Employer terminates the contract | On the last day of employment. If this is not possible, then within 3 working days from date of termination.', 'Employer terminates the contract | On the last day of employment. If this is not possible, then within 5 working days from date of termination.']
];
for (const [row, expected, incorrect] of wrongFacts) {
  const sourceText = fixtures[row.source].replaceAll(expected, incorrect);
  assert.notEqual(sourceText, fixtures[row.source], `${row.id}: the negative-control mutation changes the source text`);
  const source = manifest.sources.find(item => item.fixture === row.source);
  const input = { ...row, sourceText, officialUrl: source.url };
  assert.equal(supportAcraMomKnowledgeRule(input), false, `${row.id}: wrong changed numeric/date rule is rejected`);
  assert.deepEqual(selectAcraMomKnowledgeQuotes(input), [], `${row.id}: contradictory sources cannot supply rendered rule quotations`);
  assert.equal(hasAcraMomKnowledgeContradiction(input), true, `${row.id}: fallback veto recognizes explicit contradiction ${expected} -> ${incorrect}`);
  assert.equal(supportPracticalExpansionRule(input), false, `${row.id}: an explicit changed fact vetoes older broad statutory fallbacks`);
}

for (const [row, expected, incorrect] of [
  [cases[3], 'If it is half or more, round it up to one day.', ''],
  [cases[5], 'You are not entitled to holiday pay if the holiday falls on your approved unpaid leave.', '']
]) {
  const sourceText = fixtures[row.source].replace(expected, incorrect);
  assert.notEqual(sourceText, fixtures[row.source], `${row.id}: the incomplete-source mutation changes the source text`);
  const source = manifest.sources.find(item => item.fixture === row.source);
  const input = { ...row, sourceText, officialUrl: source.url };
  assert.equal(supportAcraMomKnowledgeRule(input), false, `${row.id}: incomplete source cannot prove every stated rule condition`);
  assert.deepEqual(selectAcraMomKnowledgeQuotes(input), [], `${row.id}: incomplete source yields no complete-family quotes`);
}

for (const row of cases) {
  const source = manifest.sources.find(item => item.fixture === row.source);
  assert.equal(supportAcraMomKnowledgeRule({ ...row, sourceText: fixtures[row.source], authority: 'IRAS', officialUrl: source.url }), undefined,
    `${row.id}: the module does not claim another authority’s issue`);
  assert.equal(supportAcraMomKnowledgeRule({ ...row, sourceText: fixtures[row.source], subject: 'Unrelated accounting disclosure', officialUrl: source.url }), undefined,
    `${row.id}: unrelated semantic issues remain outside the owned family`);
}

const employeeRule = ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'MOM_SICK_LEAVE_ENTITLEMENT');
const noFactsIssue = {
  id: 'general-sick-leave', subject: employeeRule.title, population: 'Employee', operation: 'EXPLAIN_RULE',
  evidenceStatus: 'VERIFIED', applicationStatus: 'UNRESOLVED', claims: [], gaps: []
};
const source = manifest.sources.find(item => item.fixture === 'mom-sick-leave.txt');
const issueSource = {
  key: 'mom-sick-leave', title: source.pageTitle, publisher: 'MOM', documentTitle: source.pageTitle,
  officialUrl: source.url, provenance: 'LIVE_EXTERNAL', validTo: undefined,
  claims: [{ text: fixtures[source.fixture], issueIds: ['general-sick-leave'], supportKind: 'EXACT_SOURCE_QUOTE', provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: { recordId: 'record-mom-sick-leave', documentHash: 'b'.repeat(64), canonicalUrl: source.url, retrievedAt: '2026-10-27T00:00:00Z' } }]
};
const stream = {
  authority: 'MOM', domain: 'MOM_EMPLOYMENT', issues: [noFactsIssue], sources: [issueSource]
};
const explanation = getAcraMomKnowledgeEvidence(cases[4].query, stream, noFactsIssue);
assert.ok(explanation);
assert.match(explanation.text, /case-specific conclusion requires:.*Employment Act coverage/i);
assert.equal(getAcraMomKnowledgeEvidence('What sick-leave table applied in 2025?', stream, noFactsIssue), undefined,
  'The general explanation cannot present current entitlement as a historic answer.');
assert.equal(getAcraMomKnowledgeEvidence(cases[4].query, { ...stream, sources: [{ ...issueSource, officialUrl: 'https://example.com' }] }, noFactsIssue), undefined,
  'A general rendered explanation requires exact source identity and issue-bound source claims.');

const annualLeaveQuery = 'What is the minimum annual leave entitlement and how does it increase?';
const annualLeaveRule = ACRA_MOM_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'MOM_ANNUAL_LEAVE_ENTITLEMENT');
const annualLeaveSource = manifest.sources.find(item => item.fixture === 'mom-annual-leave.txt');
const annualLeaveSourceText = fixtures['mom-annual-leave.txt'];
const annualLeaveProofInput = {
  authority: 'MOM', topicId: 'mom_annual_leave', query: annualLeaveQuery,
  subject: 'Annual leave eligibility, minimum entitlement and pro-rating',
  sourceText: annualLeaveSourceText, officialUrl: annualLeaveSource.url
};
const probationQualification = 'This applies even if you’re still on probation.';
assert.ok(annualLeaveSourceText.includes(probationQualification));
const straightApostropheProbationInput = {
  ...annualLeaveProofInput,
  sourceText: annualLeaveSourceText.replace('you’re', "you're")
};
assert.equal(supportAcraMomKnowledgeRule(straightApostropheProbationInput), true,
  'The exact probation qualification remains provable if an extractor normalizes only the apostrophe glyph.');
const missingProbationQualification = {
  ...annualLeaveProofInput,
  sourceText: annualLeaveSourceText.replace(probationQualification, '')
};
assert.equal(supportAcraMomKnowledgeRule(missingProbationQualification), undefined,
  'A source with all prior premises but no probation qualification does not activate the expanded rule.');
assert.deepEqual(selectAcraMomKnowledgeQuotes(missingProbationQualification), [],
  'The expanded rule cannot display a complete quote set without the probation qualification.');
assert.notEqual(supportPracticalExpansionRule(missingProbationQualification), false,
  'With no contradiction, the pre-existing narrower fallback remains available.');

const reversedProbationCondition = {
  ...annualLeaveProofInput,
  sourceText: annualLeaveSourceText.replace(probationQualification,
    'Employees on probation are not entitled to annual leave.')
};
assert.equal(hasAcraMomKnowledgeContradiction(reversedProbationCondition), true,
  'An explicit source statement reversing the probation qualification is recognized as contradictory.');
assert.equal(supportPracticalExpansionRule(reversedProbationCondition), false,
  'An explicit reversed probation condition vetoes the older aggregate fallback.');

const appendedProbationContradiction = {
  ...annualLeaveProofInput,
  sourceText: `${annualLeaveSourceText}\nEmployees on probation are not entitled to annual leave.`
};
assert.equal(hasPracticalExpansionContradiction(appendedProbationContradiction), true,
  'A contradictory probation restriction appended to a valid full excerpt reaches the aggregate veto.');
assert.equal(supportPracticalExpansionRule(appendedProbationContradiction), false,
  'A valid full excerpt cannot override a same-source contradictory probation restriction.');
const annualLeaveIssue = {
  id: 'general-annual-leave-unknown-population',
  subject: 'Employment Act annual leave eligibility, entitlement, and proration',
  population: 'Not established', operation: 'CHECK_ELIGIBILITY', evidenceStatus: 'VERIFIED',
  applicationStatus: 'UNRESOLVED', claims: [], gaps: []
};
const annualLeaveIssueSource = {
  key: 'mom-annual-leave', title: annualLeaveSource.pageTitle, publisher: 'MOM',
  documentTitle: annualLeaveSource.pageTitle, officialUrl: annualLeaveSource.url,
  provenance: 'LIVE_EXTERNAL', validTo: undefined,
  claims: [{ text: fixtures['mom-annual-leave.txt'], issueIds: [annualLeaveIssue.id],
    supportKind: 'EXACT_SOURCE_QUOTE', provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: { recordId: 'record-mom-annual-leave',
      documentHash: createHash('sha256').update(fixtures['mom-annual-leave.txt']).digest('hex'),
      canonicalUrl: annualLeaveSource.url, retrievedAt: '2026-10-27T00:00:00Z' } }]
};
const annualLeaveStream = {
  authority: 'MOM', domain: 'MOM_EMPLOYMENT', issues: [annualLeaveIssue], sources: [annualLeaveIssueSource]
};
const annualLeaveExplanation = getAcraMomKnowledgeEvidence(annualLeaveQuery, annualLeaveStream, annualLeaveIssue);
assert.ok(annualLeaveExplanation, 'A verified conditional general rule can render when requester population is not established.');
assert.match(annualLeaveExplanation.text, /Employment Act-covered employee becomes entitled.*at least 3 months/i);
assert.equal(annualLeaveIssue.applicationStatus, 'UNRESOLVED',
  'A general rule explanation does not assert this unknown requester’s eligibility.');
assert.equal(getAcraMomKnowledgeEvidence(annualLeaveQuery,
  { ...annualLeaveStream, authority: 'CPF' }, annualLeaveIssue), undefined,
'The unknown-population general rule cannot render under the wrong authority.');
assert.equal(getAcraMomKnowledgeEvidence(annualLeaveQuery,
  { ...annualLeaveStream, domain: 'CPF_PAYROLL' }, annualLeaveIssue), undefined,
'The unknown-population general rule cannot render under the wrong domain.');
assert.equal(getAcraMomKnowledgeEvidence(annualLeaveQuery, annualLeaveStream,
  { ...annualLeaveIssue, population: 'Company' }), undefined,
'An established but incompatible population cannot use the conditional employee rule.');
for (const operation of ['CALCULATE', 'PREPARE_JOURNAL']) {
  assert.equal(getAcraMomKnowledgeEvidence(annualLeaveQuery, annualLeaveStream,
    { ...annualLeaveIssue, operation }), undefined,
  `An unknown-population ${operation} cannot use the conditional general-rule renderer.`);
}
assert.equal(getAcraMomKnowledgeEvidence(annualLeaveQuery, annualLeaveStream,
  { ...annualLeaveIssue, applicationStatus: 'VERIFIED' }), undefined,
'The general rule cannot promote an unresolved eligibility check to verified case application.');
assert.equal(annualLeaveRule?.authority, 'MOM');

const legacySalaryRequest = {
  authority: 'MOM', topicId: 'mom-salary-payment',
  query: 'What timing applies to final salary after dismissal for misconduct?',
  subject: 'Final salary deadline after dismissal for misconduct',
  officialUrl: 'https://www.mom.gov.sg/employment-practices/salary/paying-salary',
  sourceText: legacySalaryHtml
};
assert.equal(supportAcraMomKnowledgeRule(legacySalaryRequest), true,
  'The original HTML table preserves final salary label-to-deadline rows without an adapted delimiter.');
const legacySalaryQuotes = selectAcraMomKnowledgeQuotes(legacySalaryRequest);
const misconductRowQuote = legacySalaryQuotes.find(quote => /Dismissal on grounds of misconduct/i.test(quote));
assert.ok(misconductRowQuote);
assert.match(misconductRowQuote, /Dismissal on grounds of misconduct\s+On the last day of employment\.[\s\S]*?within 3 working days from date of dismissal/i,
  'The source-visible misconduct row binds both default and fallback deadlines to its own label.');
assert.doesNotMatch(misconductRowQuote, /Employer terminates the contract|resigns and serves/i);
assert.doesNotMatch(legacySalaryQuotes.join('\n'), /\|/,
  'Selected HTML-source quotations do not contain synthesized table delimiters.');
const changedLegacyDismissal = legacySalaryHtml.replace('within 3 working days from date of dismissal', 'within 5 working days from date of dismissal');
assert.equal(supportAcraMomKnowledgeRule({ ...legacySalaryRequest, sourceText: changedLegacyDismissal }), false);
assert.equal(hasAcraMomKnowledgeContradiction({ ...legacySalaryRequest, sourceText: changedLegacyDismissal }), true,
  'An altered deadline in the HTML table still vetoes fallback support.');
assert.deepEqual(selectAcraMomKnowledgeQuotes({ ...legacySalaryRequest, sourceText: changedLegacyDismissal }), []);

const finalSalaryPointerRequest = {
  authority: 'MOM', topicId: 'mom-salary-payment',
  query: 'When is final salary due after an employee resigns and serves notice?',
  subject: 'Final salary payment deadlines after resignation', sourceText: ''
};
assert.ok(practicalExpansionPointers(finalSalaryPointerRequest).some(pointer => pointer.url === legacySalaryRequest.officialUrl),
  'A final-salary query still selects its own paying-salary source pointer.');
const salaryDeductionPointerRequest = {
  authority: 'MOM', topicId: 'mom-salary-payment',
  query: 'Can an employer deduct a staff shortage from salary?',
  subject: 'Employment Act salary deduction grounds and limits', sourceText: ''
};
assert.ok(!practicalExpansionPointers(salaryDeductionPointerRequest).some(pointer => pointer.url === legacySalaryRequest.officialUrl),
  'The final-salary source pointer is not selected for a salary-deduction question merely because both use the broad salary topic.');

const graduatedSickLeaveApplicationCases = [
  {
    id: 'four-month sick leave',
    query: 'An employee covered by the Employment Act has completed four months of service, supplied the required medical certificate and informed us within twenty-four hours. Is the statutory entitlement already fourteen outpatient sick-leave days plus sixty hospitalisation days?',
    expected: [/8\/30 at 4 months/i],
    wrongFourMonthFullEntitlement: /(?:at|after) four months[^.\n]{0,100}(?:14|fourteen)[^.\n]{0,100}(?:60|sixty)|(?:14|fourteen) outpatient[^.\n]{0,100}(?:60|sixty) hospitalisation days[^.\n]{0,100}(?:at|after) four months/i
  },
  {
    id: 'five-month sick leave',
    query: 'An employee covered by the Employment Act has completed five months of service, supplied the required medical certificate and informed us within twenty-four hours. Is the statutory entitlement already fourteen outpatient sick-leave days plus sixty hospitalisation days?',
    expected: [/11\/45 at 5 months/i],
    wrongFiveMonthFullEntitlement: /(?:at|after) five months[^.\n]{0,100}(?:14|fourteen)[^.\n]{0,100}(?:60|sixty)|(?:14|fourteen) outpatient[^.\n]{0,100}(?:60|sixty) hospitalisation days[^.\n]{0,100}(?:at|after) five months/i
  }
];
for (const sample of graduatedSickLeaveApplicationCases) {
  const response = await processAccountingQuery(sample.query, null, 'SFRS_I', undefined, undefined, [], undefined, {});
  assert.equal(response.scenarioState.scenarioType, 'SINGAPORE_STATUTORY_ADVISORY',
    `${sample.id}: the complete question uses the normal statutory advisory path`);
  for (const expected of sample.expected) assert.match(response.messageText, expected,
    `${sample.id}: the rendered statutory schedule states the applicable outpatient and hospitalisation allowance`);
  assert.match(response.messageText, /eligible for paid annual leave after at least 3 months of service/i,
    `${sample.id}: the bundled rule gives the correct annual-leave eligibility threshold`);
  assert.match(response.messageText, /60-day maximum includes outpatient sick leave|hospitalisation days include.*outpatient/i,
    `${sample.id}: hospitalisation leave includes outpatient leave rather than adding a separate allowance`);
  assert.match(response.messageText, /leave already taken|after leave already taken/i,
    `${sample.id}: remaining leave depends on prior leave use`);
  assert.doesNotMatch(response.messageText,
    /Employees who have served for at least 12 months are entitled to statutory paid annual leave|Minimum 7 days after 1 year of service/i,
    `${sample.id}: the answer does not repeat the incorrect 12-month annual-leave eligibility claim`);
  assert.doesNotMatch(response.messageText, sample.wrongFourMonthFullEntitlement || sample.wrongFiveMonthFullEntitlement,
    `${sample.id}: the applicable graduated entitlement is not replaced by the full 14/60 schedule`);
}

console.log('ACRA/MOM statutory knowledge rules passed (7 complete source families, transition-date guards and numeric/polarity mutations).');
