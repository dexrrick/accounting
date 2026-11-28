import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { buildAuthorityWorkstreams } from '../../src/services/authorityWorkstreams.ts';
import { getRequestedQuestionConcepts, reconcileQuestionUnderstanding } from '../../src/services/semanticQuestionUnderstanding.ts';

const referenceDate = '2026-10-23';
const query = 'Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance.';
const sharedReplayQuery = 'Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance. Do not calculate pay or create journal entries.';
const issueSubject = 'Part IV Employment Act coverage criteria for working hours and overtime';
// Exact 2,577-character quote retained and reviewed in the MOM source replay.
const momCoveragePassage = `Note: Part 4 of the Employment Act does not cover managers and executives.

If you are not covered under Part 4 of the Employment Act, your terms and conditions of employment will be according to your employment contract.

Use this self-assessment tool to assess your coverage under Part 4 of the Employment Act.

Week &ndash; A continuous period of 7 days starting from Monday and ending on Sunday.

Hours of work &ndash; The period during which employees are expected to carry out the duties assigned by their employers. It does not include any intervals allowed for rest and meals.

Employers are not required to pay for rest and meal hours.

You are generally not required to work more than 6 consecutive hours without a break.

However, if the nature of the work requires continuous work for up to 8 hours, breaks must be provided for meals. The breaks should be at least 45 minutes long.

Contractual working hours are the hours that you and your employer have agreed to in the contract of service.

For common work arrangements, your contractual hours of work are as follows:

 If you work  |  Your contractual hours of work are

 5 days or less a week  |  Up to 9 hours per day or 44 hours a week

 More than 5 days a week  |  Up to 8 hours a day or 44 hours a week

For other work arrangements, your contractual hours of work are as follows:

 If you work  |  Your contractual hours of work are

 Less than 44 hours every alternate week\u0020\u0020

Up to 48 hours a week, but capped at 88 hours in any continuous 2-week period.

Example:

If week 1 = 40 hours; week 2 = 48 hours; week 3 = 40 hours:

• Average for weeks 1 and 2 = 44 hours

• Average for weeks 2 and 3 = 44 hours

Shifts of up to 12 hours a day\u0020

Up to an average of 44 hours over a continuous 3-week period.

Example:

If week 1 = 40 hours; week 2 = 44 hours; week 3 = 48 hours; week 4 = 40 hours:

• Average for weeks 1, 2 and 3 = 44 hours

• Average for weeks 2, 3 and 4 = 44 hours

Note: If you are not a shift worker but agree to work up to 12 hours a day, and not exceeding an average of 44 hours over any 3 continuous weeks, you must:

• Give your consent in writing.

• Have the provisions of Sections 38 and 40 of the Employment Act explained to you.

• Be informed of your daily working hours, number of working days in each week and weekly rest day.

Overtime work is all work in excess of the normal hours of work (excluding breaks).

You can claim overtime if you are:

• A non-workman earning a monthly basic salary of $2,600 or less.

• A workman earning a monthly basic salary of $4,500 or less.`;
const overtimeRuleOnly = 'Overtime work is all work in excess of the normal hours of work (excluding breaks).';
const sourceId = 'TEST_MOM_PART_IV_COVERAGE';
const sourceUrl = 'https://www.mom.gov.sg/employment-practices/hours-of-work-overtime-and-rest-days';
assert.equal(momCoveragePassage.length, 2577, 'The fixture is the exact full MOM quote retained in the reviewed replay.');

function issue(overrides = {}) {
  return {
    id: 'mom-part-iv-coverage',
    subject: issueSubject,
    population: 'EMPLOYEE',
    domain: 'MOM_EMPLOYMENT',
    governingAuthorities: ['MOM'],
    contextualAuthorities: [],
    operation: 'EXPLAIN_RULE',
    mappedTopicIds: ['mom-part-iv-overtime'],
    evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    confidence: 0.98,
    status: 'MAPPED',
    ...overrides
  };
}

function semanticIssue(item) {
  return {
    subject: item.subject,
    population: item.population,
    domain: item.domain,
    governingAuthorities: item.governingAuthorities,
    contextualAuthorities: item.contextualAuthorities,
    operation: item.operation,
    mappedTopicIds: item.mappedTopicIds,
    evidenceRequirement: item.evidenceRequirement,
    confidence: item.confidence
  };
}

function understanding(concepts = ['Part IV coverage'], overrides = {}) {
  const resolvedIssues = overrides.issues || [semanticIssue(issue(overrides.issue))];
  return {
    mode: 'SEMANTIC_INTERPRETATION',
    assessmentStatus: 'PASSED',
    interpretation: {
      jurisdiction: ['Singapore'],
      authorityCandidates: overrides.authorityCandidates || ['MOM'],
      contextualAuthorities: [],
      domain: overrides.domain || 'MOM_EMPLOYMENT',
      population: overrides.population || 'EMPLOYEE',
      primarySubject: resolvedIssues[0].subject,
      concepts: concepts.map(concept => ({ concept, role: 'RELATED' })),
      requestedOperation: 'EXPLAIN_RULE',
      requiresUserSpecificFacts: false,
      calculationRequested: false,
      factsExplicitlyProvided: [],
      confidence: 0.98,
      issues: resolvedIssues
    }
  };
}

function liveRecord(sourceText = momCoveragePassage, overrides = {}) {
  return {
    id: sourceId,
    authority: 'MOM',
    authorityName: 'Ministry of Manpower',
    sourceAuthority: 'MOM',
    sourcePublisher: 'Ministry of Manpower (MOM)',
    legalOrStandardInstrument: 'Employment Act 1968',
    documentTitle: 'Hours of work, overtime and rest days',
    standardOrActCode: 'EMPLOYMENT_ACT',
    paragraphOrSection: 'Hours of work and overtime',
    sourceText,
    principleSummary: 'MOM guidance on Part IV employee coverage.',
    officialSourceUrl: sourceUrl,
    canonicalSourceUrl: sourceUrl,
    domain: 'MOM_EMPLOYMENT',
    jurisdiction: 'Singapore',
    tags: ['mom-part-iv-overtime'],
    relatedTopicIds: ['mom-part-iv-overtime'],
    sourceMapTopicIds: [],
    retrievalHints: [],
    sourceStatus: 'NEEDS_REVIEW',
    sourceType: 'OFFICIAL_GUIDANCE',
    evidenceTier: 'OFFICIAL_GUIDANCE',
    isVerbatimText: false,
    provenance: 'LIVE_EXTERNAL',
    lifecycleState: 'CANDIDATE',
    extractionStatus: 'PARTIAL',
    verificationMethod: 'LIVE_OFFICIAL_TOPIC_VERIFIED',
    urlVerificationStatus: 'VERIFIED',
    documentHash: createHash('sha256').update(sourceText).digest('hex'),
    retrievedAt: '2026-10-23T00:00:00.000Z',
    lastVerifiedDate: referenceDate,
    recordRole: 'EVIDENCE',
    groundingEligible: true,
    ...overrides
  };
}

function retrievalTrace(record) {
  return {
    path: 'DISCOVERED_SOURCE',
    sourceMapIds: [],
    selectedRecordIds: [record.id],
    finalVerifiedUrls: [record.officialSourceUrl],
    candidateOnly: true,
    attempts: [{
      topicId: 'mom-part-iv-overtime',
      fetchStatus: 'SUCCESS',
      finalUrl: record.officialSourceUrl,
      pageTitle: record.documentTitle,
      titleMatched: true,
      contentMatched: true
    }]
  };
}

async function run({
  queryText = query,
  concepts = ['Part IV coverage'],
  issues = [issue()],
  sourceText = momCoveragePassage,
  claimQuotes = [sourceText],
  semanticOverrides = {},
  semanticIssues,
  suppliedQuestionUnderstanding,
  suppliedIssuePlan,
  candidateRecord,
  extraProviders = {},
  requestLog = []
} = {}) {
  const record = candidateRecord || liveRecord(sourceText);
  const issuePlan = suppliedIssuePlan || {
    source: 'SEMANTIC_ISSUES', issues, coverageEstablished: true, hasUnmappedResidual: false
  };
  return buildAuthorityWorkstreams(queryText, issuePlan, {
    referenceDate,
    questionUnderstanding: suppliedQuestionUnderstanding || understanding(concepts, {
      issues: semanticIssues || issues.map(semanticIssue), ...semanticOverrides
    }),
    providers: {
      ...extraProviders,
      MOM: {
        authority: 'MOM',
        async retrieve(request) {
          requestLog.push(request);
          return {
            candidates: [record],
            claims: claimQuotes.map(quote => ({ text: quote, quote, recordId: record.id })),
            evidenceQualityTrace: retrievalTrace(record)
          };
        }
      }
    }
  });
}

const complete = await run();
assert.ok(getRequestedQuestionConcepts(query, understanding()).some(concept => concept.label === 'Part IV coverage'),
  'The standalone regression reaches the semantic concept support path.');
const completeIssue = complete.workstreams[0].issues[0];
assert.equal(completeIssue.evidenceStatus, 'VERIFIED',
  'The complete official MOM coverage passage supports the generic Part IV coverage concept.');
assert.equal(completeIssue.lifecycle.admitted, true);
assert.equal(completeIssue.lifecycle.covered, true);
assert.ok(completeIssue.verifiedClaims.some(claim => claim.quote === momCoveragePassage),
  'The exact complete source quote remains attached to the verified claim.');
assert.equal(completeIssue.gaps.some(gap => gap.code === 'ISSUE_CONCEPT_UNCOVERED'), false);

const sharedReplayUnderstanding = {
  mode: 'SEMANTIC_INTERPRETATION',
  assessmentStatus: 'PASSED',
  interpretation: {
    jurisdiction: ['Singapore'],
    authorityCandidates: ['MOM'],
    contextualAuthorities: [],
    domain: 'MOM_EMPLOYMENT',
    population: 'EMPLOYEE',
    primarySubject: issueSubject,
    concepts: [
      { concept: issueSubject, role: 'PRIMARY' },
      { concept: 'Part IV coverage', role: 'RELATED' }
    ],
    requestedOperation: 'EXPLAIN_RULE',
    requiresUserSpecificFacts: false,
    calculationRequested: false,
    factsExplicitlyProvided: [],
    confidence: 0.98,
    issues: [semanticIssue(issue())]
  }
};
const sharedReplayReconciliation = reconcileQuestionUnderstanding(
  sharedReplayQuery,
  classifyQuestion(sharedReplayQuery),
  sharedReplayUnderstanding
);
const sharedReplayIssuePlan = sharedReplayReconciliation.issuePlan;
assert.deepEqual(sharedReplayIssuePlan.issues[0].mappedTopicIds, ['mom-part-iv-overtime', 'mom_overtime'],
  'The frozen raw question reconciles both canonical and legacy MOM topic IDs.');
const canonicalRelatedTopicRecord = liveRecord(momCoveragePassage, {
  tags: [],
  relatedTopicIds: ['mom-part-iv-overtime'],
  sourceMapTopicIds: [],
  retrievalHints: []
});
const sharedReplay = await run({
  queryText: sharedReplayQuery,
  suppliedIssuePlan: sharedReplayIssuePlan,
  suppliedQuestionUnderstanding: sharedReplayUnderstanding,
  candidateRecord: canonicalRelatedTopicRecord
});
assert.equal(sharedReplay.evidenceStatus, 'VERIFIED',
  'Evidence covers the legacy MOM alias through its canonical concept metadata.');
assert.notEqual(sharedReplay.requestCompletenessContext.evaluation.status, 'COMPLETE');
assert.equal(sharedReplay.status, 'CONDITIONAL',
  'Whole-question status remains conditional while request completeness is unconfirmed.');
assert.equal(sharedReplay.workstreams[0].issues[0].lifecycle.covered, true);
assert.equal(sharedReplay.workstreams[0].issues[0].gaps.some(gap => gap.code === 'ISSUE_CONCEPT_UNCOVERED'), false);
assert.equal(sharedReplay.workstreams[0].issues[0].verifiedClaims[0].recordId, canonicalRelatedTopicRecord.id,
  'Alias coverage preserves the original verified source record identity.');
assert.deepEqual(canonicalRelatedTopicRecord.relatedTopicIds, ['mom-part-iv-overtime']);
assert.deepEqual(canonicalRelatedTopicRecord.tags, [], 'Coverage does not synthesize an alias tag on the source record.');

const momMasQuery = 'What Part IV coverage applies to employees working overtime, and what is the general licensing requirement for a Capital Markets Services Licence?';
const momMasMomIssue = issue();
const momMasMasIssue = {
  id: 'mas-cms-general-rule',
  subject: 'Capital Markets Services Licence general licensing requirement',
  population: 'COMPANY',
  domain: 'MAS_FUNDS',
  governingAuthorities: ['MAS'],
  contextualAuthorities: [],
  operation: 'EXPLAIN_RULE',
  mappedTopicIds: ['mas-cms-licence'],
  evidenceRequirement: 'AUTHORITATIVE_SOURCE',
  confidence: 0.98,
  status: 'MAPPED'
};
const momMasIssues = [momMasMomIssue, momMasMasIssue];
const momMasUnderstanding = understanding(['Part IV coverage', 'licensing requirement'], {
  issues: momMasIssues.map(semanticIssue), authorityCandidates: ['MOM', 'MAS'], domain: 'UNKNOWN', population: 'UNKNOWN'
});
assert.ok(getRequestedQuestionConcepts(momMasQuery, momMasUnderstanding).some(concept => concept.label === 'Part IV coverage'),
  'The mixed regression exposes a valid topicless MOM concept with multiple global authority candidates.');
const momMasRequests = [];
let momMasWrongOwnerRequest;
const momMas = await run({
  queryText: momMasQuery,
  concepts: ['Part IV coverage', 'licensing requirement'],
  issues: momMasIssues,
  semanticOverrides: { authorityCandidates: ['MOM', 'MAS'], domain: 'UNKNOWN', population: 'UNKNOWN' },
  requestLog: momMasRequests,
  extraProviders: {
    MAS: {
      authority: 'MAS',
      async retrieve(request) {
        momMasWrongOwnerRequest = request;
        const wronglyOwnedRecord = liveRecord();
        return {
          candidates: [wronglyOwnedRecord],
          claims: [{ text: momCoveragePassage, quote: momCoveragePassage, recordId: wronglyOwnedRecord.id }],
          evidenceQualityTrace: {
            path: 'DISCOVERED_SOURCE', sourceMapIds: [], selectedRecordIds: [wronglyOwnedRecord.id],
            finalVerifiedUrls: [wronglyOwnedRecord.officialSourceUrl], candidateOnly: true,
            attempts: [{ topicId: 'mas-cms-licence', fetchStatus: 'SUCCESS', finalUrl: wronglyOwnedRecord.officialSourceUrl,
              pageTitle: wronglyOwnedRecord.documentTitle, titleMatched: true, contentMatched: true }]
          }
        };
      }
    }
  }
});
const momMasWorkstreams = new Map(momMas.workstreams.map(workstream => [workstream.authority, workstream]));
const momMasVerifiedIssue = momMasWorkstreams.get('MOM').issues[0];
const momMasUnsupportedIssue = momMasWorkstreams.get('MAS').issues[0];
assert.equal(momMasVerifiedIssue.evidenceStatus, 'VERIFIED',
  'A mixed MOM and MAS question keeps the complete Part IV coverage support with MOM.');
assert.deepEqual(momMasRequests[0].retrievalIntent.requestedConcepts.map(concept => concept.label), ['Part IV coverage']);
assert.equal(momMasWrongOwnerRequest.retrievalIntent.requestedConcepts.some(concept => concept.label === 'Part IV coverage'), false,
  'The MOM-only Part IV concept is not requested under the MAS workstream.');
assert.deepEqual(momMasUnsupportedIssue.verifiedClaims, [],
  'A complete MOM quote offered to the MAS issue fails the separate authority and topic admission checks.');
assert.equal(momMasUnsupportedIssue.evidenceStatus, 'INSUFFICIENT');
assert.equal(momMas.status, 'INSUFFICIENT', 'The unsupported MAS licensing issue keeps the whole mixed question incomplete.');

const scopeMismatchCases = [
  {
    label: 'authority',
    issues: [issue()],
    semanticOverrides: { authorityCandidates: ['CPF'], domain: 'CPF_PAYROLL', population: 'EMPLOYEE' },
    semanticIssues: [semanticIssue(issue())]
  },
  {
    label: 'domain',
    issues: [issue({ domain: 'CPF_PAYROLL' })],
    semanticOverrides: { authorityCandidates: ['MOM'], domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE' },
    semanticIssues: [semanticIssue(issue())]
  },
  {
    label: 'population',
    issues: [issue({ population: 'EMPLOYER' })],
    semanticOverrides: { authorityCandidates: ['MOM'], domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE' },
    semanticIssues: [semanticIssue(issue())]
  }
];
for (const mismatch of scopeMismatchCases) {
  const mismatchResult = await run(mismatch);
  assert.ok(mismatchResult.gaps.some(gap => gap.code === 'UNROUTED_MATERIAL_CONCEPT'),
    `A MOM coverage concept with an incompatible ${mismatch.label} remains an explicit whole-question gap.`);
  assert.equal(mismatchResult.status, 'INSUFFICIENT');
}

const paymentRuleOnlyClaim = await run({ claimQuotes: [overtimeRuleOnly] });
const paymentRuleOnlyIssue = paymentRuleOnlyClaim.workstreams[0].issues[0];
assert.equal(paymentRuleOnlyIssue.lifecycle.admitted, true,
  'The complete source may be admitted independently of a short claim quote.');
assert.deepEqual(paymentRuleOnlyIssue.verifiedClaims, [],
  'An overtime calculation/payment rule by itself is filtered out as a coverage claim.');
assert.equal(paymentRuleOnlyIssue.evidenceStatus, 'INSUFFICIENT');

const incompleteSource = momCoveragePassage.replace('• A workman earning a monthly basic salary of $4,500 or less.', '• Workmen are listed without a salary threshold.');
const incomplete = await run({ sourceText: incompleteSource });
assert.equal(incomplete.workstreams[0].issues[0].lifecycle.admitted, false,
  'A source missing a qualified employee category still fails the existing source admission check.');

const negatedSource = momCoveragePassage.replace(
  '• A workman earning a monthly basic salary of $4,500 or less.',
  '• A workman earning a monthly basic salary of $4,500 or less is not covered under Part 4 for overtime.'
);
const negated = await run({ sourceText: negatedSource });
assert.equal(negated.workstreams[0].issues[0].lifecycle.admitted, false,
  'A negated employee coverage statement cannot satisfy the complete-source gate.');

const extraDefinition = await run({
  queryText: `${query} Separately, define overtime pay.`,
  concepts: ['Part IV coverage', 'overtime pay definition'],
  issues: [
    issue({ mappedTopicIds: ['mom-part-iv-overtime', 'mom_overtime'] }),
    issue({ id: 'mom-overtime-pay-definition', subject: 'overtime pay definition' })
  ],
  candidateRecord: canonicalRelatedTopicRecord
});
const coverageAndDefinitionIssues = extraDefinition.workstreams[0].issues;
assert.equal(coverageAndDefinitionIssues[0].lifecycle.covered, true,
  'The source still supports the standalone Part IV coverage issue in a mixed question.');
assert.equal(coverageAndDefinitionIssues[1].evidenceStatus, 'INSUFFICIENT',
  'Coverage support does not satisfy the separate overtime pay definition issue.');
assert.equal(extraDefinition.status, 'INSUFFICIENT');
assert.ok(coverageAndDefinitionIssues[1].gaps.some(gap => gap.code === 'ISSUE_CONCEPT_UNCOVERED' || gap.code === 'NO_ADMITTED_EVIDENCE'),
  'The independent definition request remains explicitly unsupported.');

process.stdout.write('MOM Part IV concept support regressions passed.\n');
