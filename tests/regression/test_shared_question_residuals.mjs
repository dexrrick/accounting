import assert from 'node:assert/strict';
import { defaultQueryTopicResolver } from '../../src/retrieval/queryTopicResolver.ts';

const cases = [
  {
    id: 'acra',
    query: 'Under ACRA guidance, must Singapore-incorporated companies file annual returns? Explain the general filing duty using official ACRA guidance. Do not calculate a deadline or create journal entries.'
  },
  {
    id: 'cpf',
    query: 'Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Explain the general definition using official CPF Board guidance. Do not calculate contribution rates or amounts and do not create journal entries.'
  },
  {
    id: 'mom',
    query: 'Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance. Do not calculate pay or create journal entries.'
  },
  {
    id: 'mas',
    query: 'Under MAS guidance, what is a Capital Markets Services Licence and when is it generally required? Explain the general licensing requirement using official MAS guidance. Do not assess a particular business or create journal entries.'
  },
  {
    id: 'iras-residency',
    query: 'For Singapore corporate income tax, is incorporation in Singapore alone enough to make a company tax resident? Explain the general control-and-management test using IRAS guidance. Do not calculate tax or create journal entries.'
  },
  {
    id: 'iras-relief',
    query: 'Under IRAS rules, can cash top-ups to my own CPF Special Account or Retirement Account qualify for tax relief? Explain the general eligibility conditions and relief limits using official IRAS guidance. This is a general rules question; do not calculate my personal tax or create journal entries.'
  },
  {
    id: 'iras-gst',
    query: 'A Singapore GST-registered business purchases a private passenger motor car for business use. Is the GST on the purchase generally claimable as input tax? Explain the general IRAS restriction and relevant exceptions. Do not calculate amounts or create journal entries.'
  }
];

for (const testCase of cases) {
  const standalone = defaultQueryTopicResolver.decomposeQuery(testCase.query);
  assert.deepEqual(standalone.unresolvedTopics, [],
    `${testCase.id}: excluded outputs and same-topic explanatory clauses do not create unresolved residuals.`);

  const mixedQuery = `${testCase.query} And what widget registry reporting obligations apply?`;
  const mixed = defaultQueryTopicResolver.decomposeQuery(mixedQuery);
  assert.ok(mixed.unresolvedTopics.some(fragment => /widget registry reporting obligations/i.test(fragment)),
    `${testCase.id}: an independent unsupported question remains unresolved after the excluded instructions.`);
}

const compositeCases = [
  ['ACRA and CPF', `${cases[0].query} ${cases[1].query}`],
  ['MOM and MAS', `${cases[2].query} ${cases[3].query}`],
  ['IRAS residency, relief and GST', `${cases[4].query} ${cases[5].query} ${cases[6].query}`]
];
for (const [label, query] of compositeCases) {
  assert.deepEqual(defaultQueryTopicResolver.decomposeQuery(query).unresolvedTopics, [],
    `${label}: adjacent supported questions remain complete as a standalone composite.`);
  const mixed = defaultQueryTopicResolver.decomposeQuery(`${query} What widget registry reporting obligations apply?`);
  assert.ok(mixed.unresolvedTopics.some(fragment => /widget registry reporting obligations/i.test(fragment)),
    `${label}: an unsupported ask appended to the composite remains unresolved.`);
}

const frozenMixedCases = [
  ['frozen ACRA and CPF', `${cases[0].query} Separately, ${cases[1].query}`],
  ['frozen MOM and MAS', `${cases[2].query} Separately, ${cases[3].query}`],
  ['frozen IRAS residency, relief and GST', `${cases[4].query} Separately, ${cases[5].query} Separately, ${cases[6].query}`]
];
for (const [label, query] of frozenMixedCases) {
  assert.deepEqual(defaultQueryTopicResolver.decomposeQuery(query).unresolvedTopics, [],
    `${label}: the frozen mixed wording remains complete standalone.`);
  const mixed = defaultQueryTopicResolver.decomposeQuery(`${query} What widget registry reporting obligations apply?`);
  assert.ok(mixed.unresolvedTopics.some(fragment => /widget registry reporting obligations/i.test(fragment)),
    `${label}: an unsupported ask appended to the frozen composite remains unresolved.`);
}

const unknownBetweenSupported = defaultQueryTopicResolver.decomposeQuery(
  `${cases[0].query} What widget registry reporting obligations apply? ${cases[1].query}`
);
assert.ok(unknownBetweenSupported.unresolvedTopics.some(fragment => /widget registry reporting obligations/i.test(fragment)),
  'An unsupported ask between two supported agency questions remains unresolved.');

const unsupportedStandalone = defaultQueryTopicResolver.decomposeQuery(
  'What widget registry reporting obligations apply?'
);
assert.ok(unsupportedStandalone.unresolvedTopics.some(fragment => /widget registry reporting obligations/i.test(fragment)),
  'An unsupported standalone question remains unresolved.');

const independentPersonalTaxAsk = defaultQueryTopicResolver.decomposeQuery(
  'What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company? And what is the director\'s personal income-tax treatment?'
);
assert.ok(independentPersonalTaxAsk.unresolvedTopics.some(fragment => /director\'s personal income-tax treatment/i.test(fragment)),
  'A separate personal-population tax request remains unresolved after a GST business-purchase question.');

const genuineAskAfterNegative = defaultQueryTopicResolver.decomposeQuery(
  'Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Do not calculate contribution rates or create journal entries. What widget registry reporting obligations apply?'
);
assert.ok(genuineAskAfterNegative.unresolvedTopics.some(fragment => /widget registry reporting obligations/i.test(fragment)),
  'A genuine follow-up question after negative calculation and journal instructions remains unresolved.');

const positiveOutputsAfterNegative = defaultQueryTopicResolver.decomposeQuery(
  'Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Do not calculate contribution rates or create journal entries. Also calculate the widget registry reporting total and prepare a journal entry for it.'
);
assert.ok(positiveOutputsAfterNegative.unresolvedTopics.some(fragment => /calculate the widget registry reporting total/i.test(fragment)),
  'A positive calculation request after a negative calculation instruction remains unresolved.');
assert.ok(positiveOutputsAfterNegative.unresolvedTopics.some(fragment => /prepare a journal entry/i.test(fragment)),
  'A positive journal request after a negative journal instruction remains unresolved.');

const newObjectContinuationControls = [
  ['CPF definition', cases[1].query, 'Explain the widget registry definition.', /widget registry definition/i],
  ['MOM coverage', cases[2].query, 'Explain university coverage.', /university coverage/i],
  ['ACRA filing', cases[0].query, 'Explain foreign register filing requirements.', /foreign register filing requirements/i],
  ['IRAS relief limits', cases[5].query, 'Explain housing relief limits.', /housing relief limits/i]
];
for (const [label, antecedent, newObjectAsk, expected] of newObjectContinuationControls) {
  const result = defaultQueryTopicResolver.decomposeQuery(`${antecedent} ${newObjectAsk}`);
  assert.ok(result.unresolvedTopics.some(fragment => expected.test(fragment)),
    `${label}: an explanatory phrase introducing a new object remains unresolved.`);
}

const conflictingAuthority = defaultQueryTopicResolver.decomposeQuery(
  'Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Explain the general definition using official MAS guidance.'
);
assert.ok(conflictingAuthority.unresolvedTopics.some(fragment => /definition using official mas guidance/i.test(fragment)),
  'A continuation that names an authority conflicting with the local antecedent remains unresolved.');

const incompatibleDefinitionObjects = [
  [
    'Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Explain the general definition of control and management.',
    /definition of control and management/i,
    'Control-and-management remains a distinct definition request following a CPF question.'
  ],
  [
    'For Singapore corporate income tax, is incorporation in Singapore alone enough to make a company tax resident? Explain the general definition of ordinary wages.',
    /definition of ordinary wages/i,
    'Ordinary wages remains a distinct definition request following an IRAS residency question.'
  ],
  [
    'Under ACRA guidance, must Singapore-incorporated companies file annual returns? Explain the general eligibility conditions for CPF Special Account.',
    /eligibility conditions for cpf special account/i,
    'CPF Special Account remains a distinct subject following an ACRA filing question.'
  ]
];
for (const [query, expected, message] of incompatibleDefinitionObjects) {
  assert.ok(defaultQueryTopicResolver.decomposeQuery(query).unresolvedTopics.some(fragment => expected.test(fragment)), message);
}

const declarativePhraseAsSubject = defaultQueryTopicResolver.decomposeQuery(
  'What does the phrase "This is a general rules question" mean in an organization policy?'
);
assert.ok(declarativePhraseAsSubject.unresolvedTopics.some(fragment => /general rules question/i.test(fragment)),
  'The general-rules phrase is preserved when it is part of a genuine question rather than a standalone declarative clause.');

const paraphrases = [
  'Under ACRA guidance, must Singapore-incorporated companies file annual returns? Outline the general filing obligation using official ACRA guidance. Do not calculate a due date or create journal entries.',
  'Under CPF Board guidance, what defines ordinary wages for CPF contributions? Describe the general definition using official CPF Board guidance. Do not calculate contribution rates or create journal entries.',
  'Under MOM guidance, which staff fall within Part IV? Summarize the general coverage using official MOM guidance. Do not calculate pay or create journal entries.',
  'Under MAS guidance, what is a Capital Markets Services Licence and under what circumstances is it usually needed? Describe the general licensing requirement using official MAS guidance. Do not assess a particular business or create journal entries.',
  'Under IRAS rules, can cash top-ups to my CPF Special Account qualify for tax relief? State the eligibility requirements and maximum relief cap using official IRAS guidance. Do not calculate personal tax or create journal entries.',
  'A Singapore GST-registered business purchases a private passenger motor car. Is the GST generally claimable as input tax? Set out the general restriction and applicable exceptions using official IRAS guidance. Do not calculate amounts or create journal entries.'
];
for (const [index, query] of paraphrases.entries()) {
  assert.deepEqual(defaultQueryTopicResolver.decomposeQuery(query).unresolvedTopics, [],
    `Bounded paraphrase ${index + 1}: a same-topic facet continuation does not become an unresolved ask.`);
}

console.log('Shared whole-question residual regression passed.');
