import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { evaluateRepresentation, parseQuestion } from './prototype.mjs';
import { cases, subjectTextByIdentity } from './oracle.mjs';

const require = createRequire(import.meta.url);
const fullyParsedCases = cases.filter((c) => (c.state ?? 'COMPLETE') === 'COMPLETE');

function signature(outcome) {
  return {
    operation: outcome.operation,
    identity: outcome.subject.identity,
    population: outcome.population,
    scope: outcome.scope,
    facets: [...outcome.facets],
    participants: [...outcome.participants],
  };
}

function staticSignature(outcome) {
  return {
    operation: outcome.operation,
    identity: outcome.identity,
    population: outcome.population,
    scope: outcome.scope,
    facets: [...outcome.facets],
    participants: outcome.participants ?? [],
  };
}

function subjectTextFor(outcome) {
  if (outcome.identity === 'cpf_relief') {
    if (outcome.facets.includes('COMPULSORY')) return 'personal tax relief on compulsory CPF contributions';
    if (outcome.population === 'EMPLOYEE' || outcome.population === 'INDIVIDUAL') return 'CPF relief for employees';
    return 'CPF relief';
  }
  return subjectTextByIdentity[outcome.identity];
}

function staticSpan(raw, spanText) {
  const start = raw.indexOf(spanText);
  assert.notEqual(start, -1, `static oracle span not found: ${spanText}`);
  return { start, end: start + spanText.length };
}

// Deliberately generated only from independent, hand-labelled descriptors.
function semanticFromLabels(raw, outcomes) {
  return {
    issues: outcomes.map((expected, index) => ({
      id: `issue-${index + 1}`,
      bindings: [{
        outcomeId: `o${index + 1}`,
        span: staticSpan(raw, expected.spanText),
        subjectText: subjectTextFor(expected),
        operation: expected.operation,
        population: expected.population,
        scope: expected.scope,
        facets: [...expected.facets],
      }],
    })),
  };
}

function semanticFromOracle(testCase) {
  return semanticFromLabels(testCase.raw, testCase.outcomes);
}

function bindingFor(testCase, semantic, outcomeId) {
  return semantic.issues.flatMap((issue) => issue.bindings)
    .find((binding) => binding.outcomeId === outcomeId);
}

test('all 28 raw questions are independently parsed against the static labels and literal spans', async (t) => {
  assert.equal(cases.length, 28);
  for (const testCase of cases) {
    await t.test(`case ${testCase.id}`, () => {
      const parsed = parseQuestion(testCase.raw);
      assert.equal(parsed.state, testCase.state ?? 'COMPLETE');
      assert.deepEqual(parsed.outcomes.map(signature), testCase.outcomes.map(staticSignature));
      assert.deepEqual(parsed.outcomes.map((o) => o.id), testCase.outcomes.map((_, i) => `o${i + 1}`));
      for (const [index, expected] of testCase.outcomes.entries()) {
        const span = parsed.outcomes[index].requestSpans[0];
        const expectedSpan = staticSpan(testCase.raw, expected.spanText);
        assert.equal(span.start, expectedSpan.start);
        assert.ok(span.end === expectedSpan.end
          || (span.end === expectedSpan.end + 1 && /[.?]/.test(testCase.raw[expectedSpan.end])),
        `span must locate the labelled literal request for case ${testCase.id}`);
        assert.ok(span.start < span.end);
      }
      for (const expectedFact of testCase.facts ?? []) {
        const fact = parsed.facts.find((candidate) => candidate.kind === expectedFact.kind);
        assert.ok(fact, `expected context fact ${expectedFact.kind}`);
        assert.deepEqual(fact.span, staticSpan(testCase.raw, expectedFact.spanText));
      }
      if (testCase.id === '26') assert.ok(parsed.findings.some((f) => f.code === 'NEGATED_INSTRUCTION'));
    });
  }
});

test('static positive observations represent all fully parsed oracle cases', () => {
  for (const testCase of fullyParsedCases) {
    const result = evaluateRepresentation(testCase.raw, semanticFromOracle(testCase));
    assert.equal(result.status, 'COMPLETE', `case ${testCase.id}: ${JSON.stringify(result.findings)}`);
    assert.equal(result.inventory.outcomes.length, testCase.outcomes.length);
    assert.equal(result.primaryFinding, null);
  }
});

test('case 03 keeps salary as context and both requested outcomes as independent bindings', () => {
  const testCase = cases.find((c) => c.id === '03');
  const semantic = semanticFromOracle(testCase);
  const result = evaluateRepresentation(testCase.raw, semantic);
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.inventory.facts.length, 1);
  assert.deepEqual(result.inventory.outcomes.map((o) => o.population), ['INDIVIDUAL', 'EMPLOYER']);
  assert.deepEqual(semantic.issues.map((issue) => issue.bindings[0].span), [
    staticSpan(testCase.raw, testCase.outcomes[0].spanText),
    staticSpan(testCase.raw, testCase.outcomes[1].spanText),
  ]);
});

test('the declared personal CPF relief “for” alias is bounded, qualified, and usable in semantic subject text', () => {
  const labels = [
    { spanText: 'Can I claim personal tax relief for my compulsory CPF contributions', operation: 'ELIGIBLE', identity: 'cpf_relief', population: 'INDIVIDUAL', scope: 'SPECIFIC', facets: ['COMPULSORY'] },
  ];
  const raw = `${labels[0].spanText}?`;
  assert.equal(parseQuestion(raw).state, 'COMPLETE');
  const observation = semanticFromLabels(raw, labels);
  bindingFor({ raw }, observation, 'o1').subjectText = 'personal tax relief for compulsory CPF contributions';
  assert.equal(evaluateRepresentation(raw, observation).status, 'COMPLETE');

  const explanation = 'Explain personal tax relief for compulsory CPF contributions.';
  const explainLabels = [
    { spanText: 'Explain personal tax relief for compulsory CPF contributions', operation: 'EXPLAIN', identity: 'cpf_relief', population: 'INDIVIDUAL', scope: 'SPECIFIC', facets: ['COMPULSORY'] },
  ];
  const explainObservation = semanticFromLabels(explanation, explainLabels);
  bindingFor({ raw: explanation }, explainObservation, 'o1').subjectText = 'personal tax relief for compulsory CPF contributions';
  assert.equal(evaluateRepresentation(explanation, explainObservation).status, 'COMPLETE');

  const original = cases.find((candidate) => candidate.id === '01');
  const forAlias = semanticFromOracle(original);
  bindingFor(original, forAlias, 'o1').subjectText = 'personal tax relief for compulsory CPF contributions';
  assert.equal(evaluateRepresentation(original.raw, forAlias).status, 'COMPLETE');
});

test('cases 26-28 retain uncertainty and any independently recognized partial request', () => {
  for (const testCase of cases.filter((c) => c.state === 'UNCERTAIN')) {
    const result = evaluateRepresentation(testCase.raw, semanticFromOracle(testCase));
    assert.equal(result.status, 'UNCERTAIN', `case ${testCase.id}`);
    assert.equal(result.inventory.outcomes.length, testCase.outcomes.length);
  }
  assert.deepEqual(parseQuestion(cases.find((c) => c.id === '27').raw).outcomes, []);
});

test('each required outcome and facet omission is an incomplete representation', () => {
  for (const testCase of fullyParsedCases) {
    const baseline = semanticFromOracle(testCase);
    for (let index = 0; index < testCase.outcomes.length; index += 1) {
      const expected = testCase.outcomes[index];
      if (expected.facets.length === 0) {
        const omitted = structuredClone(baseline);
        omitted.issues = omitted.issues.filter((issue) => issue.bindings[0]?.outcomeId !== `o${index + 1}`);
        const result = evaluateRepresentation(testCase.raw, omitted);
        assert.equal(result.status, 'INCOMPLETE', `case ${testCase.id}, omitted outcome ${index + 1}`);
        assert.ok(result.findings.some((f) => f.code === 'MISSING_OUTCOME'));
      } else {
        const noOutcome = structuredClone(baseline);
        noOutcome.issues = noOutcome.issues.filter((issue) => issue.bindings[0]?.outcomeId !== `o${index + 1}`);
        const outcomeResult = evaluateRepresentation(testCase.raw, noOutcome);
        assert.equal(outcomeResult.status, 'INCOMPLETE', `case ${testCase.id}, omitted outcome ${index + 1}`);
        assert.ok(outcomeResult.findings.some((f) => f.code === 'MISSING_OUTCOME'));
        for (const facet of expected.facets) {
          const omitted = structuredClone(baseline);
          bindingFor(testCase, omitted, `o${index + 1}`).facets = expected.facets.filter((candidate) => candidate !== facet);
          const result = evaluateRepresentation(testCase.raw, omitted);
          assert.equal(result.status, 'INCOMPLETE', `case ${testCase.id}, omitted ${facet}`);
          assert.ok(result.findings.some((f) => f.code === 'MISSING_FACET' && f.outcomeId === `o${index + 1}` && f.facet === facet));
        }
      }
    }
  }
});

test('wrong dimensions and invalid spans cannot cover required facets', () => {
  const testCase = cases[0];
  for (const [field, value] of [
    ['operation', 'CALCULATE'], ['population', 'EMPLOYER'], ['scope', 'OVERVIEW'], ['subjectText', 'annual revenue'],
  ]) {
    const semantic = semanticFromOracle(testCase);
    bindingFor(testCase, semantic, 'o1')[field] = value;
    const result = evaluateRepresentation(testCase.raw, semantic);
    assert.equal(result.status, 'INCOMPLETE', field);
    assert.ok(result.findings.some((f) => f.code === 'DIMENSION_MISMATCH'));
    assert.ok(result.findings.some((f) => f.code === 'MISSING_FACET' && f.facet === 'COMPULSORY'));
  }

  const outside = semanticFromOracle(cases.find((c) => c.id === '04'));
  const wholeQuestion = { start: 0, end: cases.find((c) => c.id === '04').raw.length };
  outside.issues.forEach((issue) => { issue.bindings[0].span = wholeQuestion; });
  const spanResult = evaluateRepresentation(cases.find((c) => c.id === '04').raw, outside);
  assert.equal(spanResult.status, 'INCOMPLETE');
  assert.ok(spanResult.findings.some((f) => f.code === 'SPAN_OUTSIDE_REQUEST'));
});

test('zero-width and out-of-range spans are malformed, while one-request whole-query spans are valid', () => {
  const single = cases.find((c) => c.id === '02');
  const semantic = semanticFromOracle(single);
  bindingFor(single, semantic, 'o1').span = { start: 0, end: single.raw.length };
  assert.equal(evaluateRepresentation(single.raw, semantic).status, 'COMPLETE');

  for (const span of [{ start: 0, end: 0 }, { start: 0, end: single.raw.length + 1 }]) {
    const malformed = semanticFromOracle(single);
    bindingFor(single, malformed, 'o1').span = span;
    const result = evaluateRepresentation(single.raw, malformed);
    assert.equal(result.status, 'UNCERTAIN');
    assert.ok(result.findings.some((f) => f.code === 'INVALID_SPAN'));
  }
});

test('multi-binding observations can represent multiple outcomes and overview facets can split across issues', () => {
  const two = cases.find((c) => c.id === '04');
  const combined = semanticFromOracle(two);
  combined.issues = [{ id: 'combined', bindings: combined.issues.flatMap((issue) => issue.bindings) }];
  assert.equal(evaluateRepresentation(two.raw, combined).status, 'COMPLETE');

  const overview = cases.find((c) => c.id === '06');
  const start = staticSpan(overview.raw, overview.outcomes[0].spanText);
  const split = { issues: ['OVERVIEW', 'CPF_EXAMPLE'].map((facet, index) => ({
    id: `split-${index}`,
    bindings: [{
      outcomeId: 'o1', span: start, subjectText: 'individual tax relief categories',
      operation: 'EXPLAIN', population: 'INDIVIDUAL', scope: 'OVERVIEW', facets: [facet],
    }],
  })) };
  assert.equal(evaluateRepresentation(overview.raw, split).status, 'COMPLETE');
});

test('overview, relation, decision, and filing facets cannot be inferred from child topics', () => {
  const overview = cases.find((c) => c.id === '06');
  const childOnly = semanticFromOracle(overview);
  childOnly.issues[0].bindings[0].facets = ['CPF_EXAMPLE'];
  assert.ok(evaluateRepresentation(overview.raw, childOnly).findings.some((f) => f.facet === 'OVERVIEW' && f.code === 'MISSING_FACET'));

  const interaction = cases.find((c) => c.id === '22');
  const inverse = semanticFromOracle(interaction);
  bindingFor(interaction, inverse, 'o1').facets = ['PERSONAL_RELIEF_AFFECTS_EMPLOYER_CONTRIBUTIONS'];
  assert.equal(evaluateRepresentation(interaction.raw, inverse).status, 'INCOMPLETE');
  assert.ok(evaluateRepresentation(interaction.raw, inverse).findings.some((f) => f.code === 'MISSING_FACET' && f.facet === 'EMPLOYER_CONTRIBUTIONS_AFFECT_PERSONAL_RELIEF'));

  for (const [caseId, required] of [['19', 'DECISION_RELATION'], ['18', 'DEADLINE'], ['18', 'OBLIGATION']]) {
    const c = cases.find((candidate) => candidate.id === caseId);
    const altered = semanticFromOracle(c);
    const target = altered.issues.flatMap((issue) => issue.bindings).find((b) => b.facets.includes(required));
    target.facets = target.facets.filter((facet) => facet !== required);
    assert.equal(evaluateRepresentation(c.raw, altered).status, 'INCOMPLETE', `${caseId} ${required}`);
  }
});

test('subject qualifiers and actor aliases are validated independently of claimed IDs', () => {
  const coordinated = cases.find((c) => c.id === '10');
  const actorMismatch = semanticFromOracle(coordinated);
  const employerBinding = bindingFor(coordinated, actorMismatch, 'o2');
  employerBinding.subjectText = 'employee CPF contributions';
  const actorResult = evaluateRepresentation(coordinated.raw, actorMismatch);
  assert.ok(actorResult.findings.some((f) => f.code === 'DIMENSION_MISMATCH' && f.dimensions.includes('subject_population')));

  const individualEmployeeTitle = cases.find((c) => c.id === '05');
  const titleObservation = semanticFromOracle(individualEmployeeTitle);
  bindingFor(individualEmployeeTitle, titleObservation, 'o2').subjectText = 'CPF relief for employees';
  assert.equal(evaluateRepresentation(individualEmployeeTitle.raw, titleObservation).status, 'COMPLETE');

  const qualified = cases.find((c) => c.id === '14');
  const omittedQualifier = semanticFromOracle(qualified);
  bindingFor(qualified, omittedQualifier, 'o1').facets = ['GENERAL', 'ROYALTY', 'SINGAPORE'];
  assert.equal(evaluateRepresentation(qualified.raw, omittedQualifier).status, 'INCOMPLETE');
  assert.ok(evaluateRepresentation(qualified.raw, omittedQualifier).findings.some((f) => f.facet === 'NONRESIDENT'));

  const broad = cases.find((c) => c.id === '23');
  const overqualified = semanticFromOracle(broad);
  const royalty = bindingFor(broad, overqualified, 'o2');
  royalty.subjectText = 'non-resident royalty withholding tax';
  royalty.facets.push('NONRESIDENT');
  assert.equal(evaluateRepresentation(broad.raw, overqualified).status, 'INCOMPLETE');
  assert.ok(evaluateRepresentation(broad.raw, overqualified).findings.some((f) => f.code === 'UNREQUESTED_FACET'));

  const privateCase = cases.find((c) => c.id === '11');
  const missingPrivate = semanticFromOracle(privateCase);
  bindingFor(privateCase, missingPrivate, 'o1').subjectText = 'director expense tax treatment';
  assert.equal(evaluateRepresentation(privateCase.raw, missingPrivate).status, 'INCOMPLETE');

  const gstCase = cases.find((c) => c.id === '15');
  const populationMismatch = semanticFromOracle(gstCase);
  const gstBinding = bindingFor(gstCase, populationMismatch, 'o1');
  gstBinding.subjectText = 'company input tax recovery on business purchases';
  gstBinding.population = 'UNKNOWN';
  assert.ok(evaluateRepresentation(gstCase.raw, populationMismatch).findings.some((f) => f.code === 'DIMENSION_MISMATCH'));
});

test('declared nonresident/non-resident spelling equivalence preserves payer population and qualifier', () => {
  const original = cases.find((c) => c.id === '14');
  const undashedRaw = original.raw.replace('non-resident company', 'nonresident company');
  const labels = [{ ...original.outcomes[0], spanText: original.outcomes[0].spanText.replace('non-resident company', 'nonresident company') }];
  assert.deepEqual(parseQuestion(undashedRaw).outcomes.map(signature), [staticSignature(labels[0])]);
  const undashedSemantic = semanticFromLabels(undashedRaw, labels);
  bindingFor({ raw: undashedRaw }, undashedSemantic, 'o1').subjectText = 'nonresident royalty withholding tax';
  assert.equal(evaluateRepresentation(undashedRaw, undashedSemantic).status, 'COMPLETE');
  assert.equal(parseQuestion(undashedRaw.replace('nonresident', 'resident')).state, 'UNCERTAIN');

  const residentText = semanticFromOracle(original);
  bindingFor(original, residentText, 'o1').subjectText = 'resident royalty withholding tax';
  assert.equal(evaluateRepresentation(original.raw, residentText).status, 'INCOMPLETE');
});

test('directional interaction cannot be assembled from separate participant rules', () => {
  const interaction = cases.find((candidate) => candidate.id === '22');
  const span = staticSpan(interaction.raw, interaction.outcomes[0].spanText);
  const separateRules = {
    issues: [
      { id: 'employer-rule', bindings: [{ outcomeId: 'o1', span, subjectText: 'employer CPF contributions', operation: 'EXPLAIN', population: 'INDIVIDUAL', scope: 'INTERACTION', facets: [] }] },
      { id: 'personal-rule', bindings: [{ outcomeId: 'o1', span, subjectText: 'CPF relief', operation: 'EXPLAIN', population: 'INDIVIDUAL', scope: 'INTERACTION', facets: [] }] },
    ],
  };
  const result = evaluateRepresentation(interaction.raw, separateRules);
  assert.equal(result.status, 'INCOMPLETE');
  assert.ok(result.findings.some((f) => f.code === 'MISSING_FACET' && f.facet === 'EMPLOYER_CONTRIBUTIONS_AFFECT_PERSONAL_RELIEF'));
});

test('amount context accepts correctly grouped nonnegative decimals and rejects malformed grouping', () => {
  const good = 'For someone earning SGD 1,234.50 a month, what can they claim for personal tax relief on compulsory CPF, and what does the employer have to pay into CPF?';
  assert.equal(parseQuestion(good).state, 'COMPLETE');
  assert.equal(parseQuestion(good.replace('1,234.50', '12,34.50')).state, 'UNCERTAIN');
});

test('duplicates, invented bindings, malformed output, provider failure, and legacy V2 fail closed', () => {
  const c = cases[0];
  const duplicateId = semanticFromOracle(c);
  duplicateId.issues.push(structuredClone(duplicateId.issues[0]));
  assert.equal(evaluateRepresentation(c.raw, duplicateId).status, 'UNCERTAIN');
  assert.ok(evaluateRepresentation(c.raw, duplicateId).findings.some((f) => f.code === 'DUPLICATE_ISSUE_ID'));

  const duplicateFacet = semanticFromOracle(c);
  duplicateFacet.issues.push({ id: 'duplicate', bindings: [structuredClone(duplicateFacet.issues[0].bindings[0])] });
  assert.equal(evaluateRepresentation(c.raw, duplicateFacet).status, 'INCOMPLETE');
  assert.ok(evaluateRepresentation(c.raw, duplicateFacet).findings.some((f) => f.code === 'DUPLICATE_FACET_REPRESENTATION'));

  const invented = semanticFromOracle(c);
  invented.issues.push({ id: 'invented', bindings: [{ ...structuredClone(invented.issues[0].bindings[0]), outcomeId: 'o999' }] });
  assert.equal(evaluateRepresentation(c.raw, invented).status, 'INCOMPLETE');
  assert.ok(evaluateRepresentation(c.raw, invented).findings.some((f) => f.code === 'UNKNOWN_OUTCOME_BINDING'));

  const multi = cases.find((candidate) => candidate.id === '03');
  const promotedFact = semanticFromOracle(multi);
  promotedFact.issues.push({ id: 'fact-as-issue', bindings: [{ ...structuredClone(promotedFact.issues[0].bindings[0]), outcomeId: 'f1' }] });
  const promotedResult = evaluateRepresentation(multi.raw, promotedFact);
  assert.equal(promotedResult.status, 'INCOMPLETE');
  assert.ok(promotedResult.findings.some((f) => f.code === 'UNKNOWN_OUTCOME_BINDING'));

  for (const malformed of [null, 42, {}, { issues: [{ id: 'x', bindings: [{}] }] }, { issues: [{ id: 'x', bindings: 'bad' }] }]) {
    assert.equal(evaluateRepresentation(c.raw, malformed).status, 'UNCERTAIN');
  }
  assert.equal(evaluateRepresentation(c.raw, { providerFailure: true }).status, 'UNCERTAIN');
  assert.equal(evaluateRepresentation(c.raw, { status: 'provider_failure' }).status, 'UNCERTAIN');
  assert.equal(evaluateRepresentation(c.raw, { schemaVersion: 'V2', coverageEstablished: true, topics: ['CPF'] }).status, 'UNCERTAIN');
  assert.equal(evaluateRepresentation(null, semanticFromOracle(c)).status, 'UNCERTAIN');
  assert.equal(evaluateRepresentation(42, semanticFromOracle(c)).status, 'UNCERTAIN');
  const precedence = evaluateRepresentation('Unrecognized question.', { issues: [{ id: 'bad' }] });
  assert.equal(precedence.status, 'UNCERTAIN');
  assert.equal(precedence.primaryFinding.stage, 'INVENTORY');
  assert.ok(precedence.findings.some((f) => f.stage === 'STRUCTURE'));

  for (const facets of ['COMPULSORY', ['NOT_A_DECLARED_FACET']]) {
    const badFacet = semanticFromOracle(c);
    bindingFor(c, badFacet, 'o1').facets = facets;
    assert.equal(evaluateRepresentation(c.raw, badFacet).status, 'UNCERTAIN');
  }
  const emptyBindings = { issues: [{ id: 'empty', bindings: [] }] };
  const emptyResult = evaluateRepresentation(c.raw, emptyBindings);
  assert.equal(emptyResult.status, 'INCOMPLETE');
  assert.ok(emptyResult.findings.some((f) => f.code === 'EMPTY_ISSUE_BINDINGS'));

  const facetless = cases.find((candidate) => candidate.id === '09');
  const redundantCore = semanticFromOracle(facetless);
  redundantCore.issues.push({ id: 'redundant', bindings: [structuredClone(redundantCore.issues[0].bindings[0])] });
  assert.equal(evaluateRepresentation(facetless.raw, redundantCore).status, 'INCOMPLETE');
  assert.ok(evaluateRepresentation(facetless.raw, redundantCore).findings.some((f) => f.code === 'DUPLICATE_CORE_BINDING'));
});

test('routing, support, and application metadata do not change request representation', () => {
  const c = cases.find((candidate) => candidate.id === '16');
  const semantic = semanticFromOracle(c);
  const baseline = evaluateRepresentation(c.raw, semantic);
  for (const routing of [undefined, { parent: 'standards', child: 'sfrsi6' }, { topics: [] }, { topics: ['unrelated'] }]) {
    assert.deepEqual(evaluateRepresentation(c.raw, semantic, routing), baseline);
  }
  const metadataCarryingObservation = { ...semantic, support: 'INSUFFICIENT', application: 'UNVERIFIED' };
  const withMetadata = evaluateRepresentation(c.raw, metadataCarryingObservation);
  assert.equal(withMetadata.status, 'COMPLETE');
  assert.equal(withMetadata.support, undefined);
  assert.equal(withMetadata.application, undefined);
});

test('unknown prefixes, infixes, suffixes, qualifiers, private/business changes, and foreign/domestic changes stay uncertain', () => {
  const known = 'Explain CPF relief for employees';
  for (const raw of [
    `Possibly ${known}.`,
    'Explain CPF relief for employees that also depends on the unfamiliar zorb levy.',
    `${known} under age 65.`,
    `For resident workers, ${known}.`,
    `Explain personal tax relief categories including CPF relief for employees and donation relief.`,
    'What about that and the other treatment?',
    'Our Singapore company paid SGD 900 for the director\'s business holiday and recorded it as travel expense. What is its corporate income-tax treatment?',
    "Our Singapore company received a dividend from its Singapore subsidiary in the current year. Explain the company's Singapore corporate income-tax treatment for this receipt.",
    'Explain personal tax reliefsñand explain personal tax reliefs.',
  ]) {
    assert.equal(parseQuestion(raw).state, 'UNCERTAIN', raw);
    assert.equal(evaluateRepresentation(raw, { issues: [] }).status, 'UNCERTAIN', raw);
  }

  const unicodePrefix = `😀 ${known}.`;
  const parsed = parseQuestion(unicodePrefix);
  assert.equal(parsed.state, 'UNCERTAIN');
  assert.equal(parsed.outcomes.length, 0);

  for (const raw of ['Explain personal tax reliefsand explain personal tax reliefs.', 'Explain personal tax reliefs and', 'Explain personal tax reliefs plus']) {
    assert.equal(parseQuestion(raw).state, 'UNCERTAIN', raw);
  }

  assert.equal(parseQuestion('x'.repeat(2001)).findings[0].code, 'INPUT_LIMIT');
  assert.notEqual(parseQuestion('😀'.repeat(1000)).findings[0]?.code, 'INPUT_LIMIT');
  assert.equal(parseQuestion('😀'.repeat(1001)).findings[0].code, 'INPUT_LIMIT');
  const thirteen = Array.from({ length: 13 }, () => 'Explain personal tax reliefs').join(' plus ') + '.';
  const limited = parseQuestion(thirteen);
  assert.equal(limited.state, 'UNCERTAIN');
  assert.ok(limited.findings.some((f) => f.code === 'OUTCOME_LIMIT'));
});

test('held-out connector compositions and meaning-preserving reorderings stay compositional', () => {
  const connectors = ['. ', '? ', ', and ', ' and ', ', plus ', ' plus '];
  const heldOutLabels = [
    { spanText: 'Explain personal tax reliefs', operation: 'EXPLAIN', identity: 'individual_tax_relief_overview', population: 'INDIVIDUAL', scope: 'OVERVIEW', facets: ['OVERVIEW'] },
    { spanText: 'Explain CPF relief for employees', operation: 'EXPLAIN', identity: 'cpf_relief', population: 'EMPLOYEE', scope: 'SPECIFIC', facets: [] },
  ];
  for (const connector of connectors) {
    const raw = `Explain personal tax reliefs${connector}Explain CPF relief for employees.`;
    const parsed = parseQuestion(raw);
    assert.equal(parsed.state, 'COMPLETE', `${connector}: ${JSON.stringify(parsed.findings)}`);
    assert.deepEqual(parsed.outcomes.map((o) => `${o.subject.identity}:${o.population}`), [
      'individual_tax_relief_overview:INDIVIDUAL', 'cpf_relief:EMPLOYEE',
    ]);
    assert.equal(evaluateRepresentation(raw, semanticFromLabels(raw, heldOutLabels)).status, 'COMPLETE');
  }

  const reorderPairs = [['05', '07'], ['23', '24']];
  for (const [leftId, rightId] of reorderPairs) {
    const left = cases.find((c) => c.id === leftId);
    const right = cases.find((c) => c.id === rightId);
    const normalize = (raw) => parseQuestion(raw).outcomes.map((o) => JSON.stringify(signature(o))).sort();
    assert.deepEqual(normalize(left.raw), normalize(right.raw));
  }

  const changedCoordination = 'How much CPF must the employer contribute and Can I claim CPF relief for employees.';
  const changed = parseQuestion(changedCoordination);
  assert.equal(changed.state, 'COMPLETE');
  assert.deepEqual(changed.outcomes.map((o) => o.population), ['EMPLOYER', 'INDIVIDUAL']);
  const changedLabels = [
    { spanText: 'How much CPF must the employer contribute', operation: 'CALCULATE', identity: 'cpf_contributions', population: 'EMPLOYER', scope: 'SPECIFIC', facets: [] },
    { spanText: 'Can I claim CPF relief for employees', operation: 'ELIGIBLE', identity: 'cpf_relief', population: 'INDIVIDUAL', scope: 'SPECIFIC', facets: [] },
  ];
  assert.equal(evaluateRepresentation(changedCoordination, semanticFromLabels(changedCoordination, changedLabels)).status, 'COMPLETE');

  const novelComposition = 'How much CPF must the employer contribute plus Explain personal tax reliefs.';
  const novelLabels = [
    { spanText: 'How much CPF must the employer contribute', operation: 'CALCULATE', identity: 'cpf_contributions', population: 'EMPLOYER', scope: 'SPECIFIC', facets: [] },
    { spanText: 'Explain personal tax reliefs', operation: 'EXPLAIN', identity: 'individual_tax_relief_overview', population: 'INDIVIDUAL', scope: 'OVERVIEW', facets: ['OVERVIEW'] },
  ];
  assert.equal(parseQuestion(novelComposition).state, 'COMPLETE');
  assert.equal(evaluateRepresentation(novelComposition, semanticFromLabels(novelComposition, novelLabels)).status, 'COMPLETE');

  const amountHead = 'For someone earning SGD 6,000 a month, how much personal tax relief can I claim for compulsory CPF contributions, and what does the employer have to pay into CPF?';
  const amountLabels = [
    { spanText: 'how much personal tax relief can I claim for compulsory CPF contributions', operation: 'CALCULATE', identity: 'cpf_relief', population: 'INDIVIDUAL', scope: 'SPECIFIC', facets: ['COMPULSORY'] },
    { spanText: 'what does the employer have to pay into CPF', operation: 'CALCULATE', identity: 'cpf_contributions', population: 'EMPLOYER', scope: 'SPECIFIC', facets: [] },
  ];
  assert.equal(parseQuestion(amountHead).state, 'COMPLETE');
  assert.equal(evaluateRepresentation(amountHead, semanticFromLabels(amountHead, amountLabels)).status, 'COMPLETE');
});

test('returned inventories are independent across calls and caller mutation', () => {
  const raw = cases[0].raw;
  const first = parseQuestion(raw);
  first.outcomes[0].facets.push('GENERAL');
  first.outcomes[0].subject.identity = 'mutated';
  const second = parseQuestion(raw);
  assert.deepEqual(second.outcomes[0].facets, ['COMPULSORY']);
  assert.equal(second.outcomes[0].subject.identity, 'cpf_relief');

  const fixedProductionRaw = cases.find((candidate) => candidate.id === '25').raw;
  const fixedFirst = parseQuestion(fixedProductionRaw);
  fixedFirst.outcomes[0].facets.push('PRIVATE');
  fixedFirst.outcomes[0].participants.push('EMPLOYER');
  const fixedSecond = parseQuestion(fixedProductionRaw);
  assert.deepEqual(fixedSecond.outcomes[0].facets, ['OVERVIEW']);
  assert.deepEqual(fixedSecond.outcomes[0].participants, []);
});

test('guard preload blocks transport imports and fetch remains unused', async () => {
  const stats = globalThis.__requestCompletenessGuardStats;
  const transports = globalThis.__requestCompletenessGuardedTransports;
  const before = stats.blockedAttempts;
  stats.guardSelfTests += 1;
  assert.throws(() => require('node:http'), /Blocked evaluation dependency/);
  stats.guardSelfTests += 1;
  assert.throws(() => require('node:dgram'), /Blocked evaluation dependency/);
  stats.guardSelfTests += 1;
  assert.throws(() => require('node:http2'), /Blocked evaluation dependency/);
  stats.guardSelfTests += 1;
  assert.throws(() => process.getBuiltinModule('http'), /Blocked evaluation builtin/);
  stats.guardSelfTests += 1;
  assert.throws(() => process.getBuiltinModule('child_process'), /Blocked evaluation builtin/);
  stats.guardSelfTests += 1;
  assert.throws(() => globalThis.fetch('https://example.invalid'), /Blocked evaluation transport/);
  for (const invoke of [
    () => transports.http.request('http://example.invalid'),
    () => transports.https.get('https://example.invalid'),
    () => transports.http2.connect('http://example.invalid'),
    () => transports.net.connect(80, 'example.invalid'),
    () => transports.tls.connect(443, 'example.invalid'),
    () => transports.dns.lookup('example.invalid'),
    () => transports.dns.lookupService('127.0.0.1', 80),
    () => transports.dnsPromises.lookup('example.invalid'),
    () => transports.dgram.createSocket('udp4'),
    () => transports.childProcess.spawn('not-launched'),
  ]) {
    stats.guardSelfTests += 1;
    assert.throws(invoke, /Blocked evaluation transport/);
  }
  for (const [label, prototype] of [
    ['dns', transports.dns],
    ['dns.promises', transports.dnsPromises],
  ]) {
    const queryMethods = Object.getOwnPropertyNames(prototype)
      .filter((name) => /^(?:lookup.*|resolve.*|reverse)$/.test(name) && typeof prototype[name] === 'function');
    assert.ok(queryMethods.length > 0, `${label} exposes query methods`);
    for (const name of queryMethods) {
      stats.guardSelfTests += 1;
      assert.throws(
        () => prototype[name].call(prototype, 'example.invalid'),
        /Blocked evaluation transport/,
        `${label}.${name} must block before DNS execution`,
      );
    }
  }
  for (const [label, prototype] of [
    ['dns.Resolver', transports.dns.Resolver?.prototype],
    ['dns.promises.Resolver', transports.dnsPromises.Resolver?.prototype],
  ]) {
    assert.ok(prototype, `${label} is available for prototype hardening`);
    const queryMethods = Object.getOwnPropertyNames(prototype)
      .filter((name) => /^(?:lookup.*|resolve.*|reverse)$/.test(name));
    assert.ok(queryMethods.length > 0, `${label} exposes query methods`);
    for (const name of queryMethods) {
      stats.guardSelfTests += 1;
      assert.throws(
        () => prototype[name].call({}, 'example.invalid'),
        /Blocked evaluation transport/,
        `${label}.${name} must block before resolver execution`,
      );
    }
  }
  const childSpawn = transports.childProcess.ChildProcess?.prototype?.spawn;
  assert.equal(typeof childSpawn, 'function', 'ChildProcess.prototype.spawn is available');
  stats.guardSelfTests += 1;
  assert.throws(() => childSpawn.call({}, 'not-launched'), /Blocked evaluation transport/);
  stats.guardSelfTests += 1;
  await assert.rejects(import('node:https'), /Blocked evaluation import/);
  await assert.rejects(import('node:dgram'), /Blocked evaluation import/);
  await assert.rejects(import('node:http2'), /Blocked evaluation import/);
  if (typeof globalThis.WebSocket === 'function') {
    stats.guardSelfTests += 1;
    assert.throws(() => new globalThis.WebSocket('wss://example.invalid'), /Blocked evaluation transport/);
  }
  assert.ok(stats.blockedAttempts > before);
  assert.ok(stats.guardSelfTests >= 15);
  assert.equal(stats.actualRequests, 0);
  assert.equal(evaluateRepresentation(cases[0].raw, semanticFromOracle(cases[0])).status, 'COMPLETE');
  assert.equal(stats.actualRequests, 0);
});
