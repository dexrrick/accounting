import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderAuthorityEvidenceResponseText } from '../../src/services/authorityEvidenceResponse.ts';

const fixtureRoot = new URL('../fixtures/statutoryKnowledge20261027b/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('acra-mom-source-manifest.json', fixtureRoot), 'utf8'));
const fixture = manifest.sources.find(source => source.fixture === 'mom-sick-leave.txt');
const sourceText = readFileSync(new URL(fixture.fixture, fixtureRoot), 'utf8');
const sourceHash = createHash('sha256').update(sourceText).digest('hex');
const query = 'What are the outpatient and hospitalisation leave limits and eligibility rules for an employee?';
const subject = 'Sick leave eligibility and annual entitlement by service period';
const url = fixture.url;

function sickLeaveWorkstream({
  issueId = 'sick-leave', population = 'Employee', operation = 'EXPLAIN_RULE',
  applicationStatus = 'NOT_REQUIRED', issueEvidenceStatus = 'VERIFIED',
  claimText = sourceText, streamEvidenceStatus = 'VERIFIED'
} = {}) {
  const claim = {
    text: claimText, supportKind: 'EXACT_SOURCE_QUOTE', issueIds: [issueId], provenance: 'LIVE_EXTERNAL',
    fetchedSourceBinding: {
      recordId: 'mom-sick-leave-fixture', documentHash: sourceHash,
      canonicalUrl: url, retrievedAt: '2026-10-27T00:00:00Z'
    }
  };
  const issue = {
    id: issueId, subject, population, operation,
    evidenceStatus: issueEvidenceStatus, applicationStatus,
    ...(applicationStatus === 'UNRESOLVED' ? { applicationReason: 'Employment Act coverage and service facts remain to be confirmed.' } : {}),
    claims: [claim], gaps: []
  };
  return {
    id: 'mom-sick-leave-stream', authority: 'MOM', authorityLabel: 'Ministry of Manpower',
    domain: 'MOM_EMPLOYMENT', domainLabel: 'Employment requirements',
    evidenceStatus: streamEvidenceStatus, applicationStatus,
    issues: [issue], gaps: [],
    sources: [{
      key: 'mom-sick-leave-source', title: fixture.pageTitle, publisher: 'MOM', documentTitle: fixture.pageTitle,
      officialUrl: url, provenance: 'LIVE_EXTERNAL', claims: [claim]
    }]
  };
}

function presentation({
  status, evidenceStatus = status === 'INSUFFICIENT' ? 'INSUFFICIENT' : 'VERIFIED',
  applicationStatus = 'NOT_REQUIRED', workstreams, gaps = []
}) {
  return { query, status, evidenceStatus, applicationStatus, workstreams, gaps };
}

const completeGeneral = presentation({
  status: 'CONDITIONAL', workstreams: [sickLeaveWorkstream()]
});
const completeGeneralText = renderAuthorityEvidenceResponseText(completeGeneral, false);
assert.match(completeGeneralText, /MOM rule explanation:[\s\S]*case-specific conclusion requires/i,
  'The full general rule is rendered from the complete issue-bound MOM source.');
assert.match(completeGeneralText, /Verified general guidance is available[\s\S]*full request coverage unconfirmed/);
assert.doesNotMatch(completeGeneralText, /Whole-question status: The resolved material issues have verified evidence/);

const generalWithMissingFacts = presentation({
  status: 'CONDITIONAL', applicationStatus: 'UNRESOLVED',
  workstreams: [sickLeaveWorkstream({ population: 'Not established', operation: 'CHECK_ELIGIBILITY', applicationStatus: 'UNRESOLVED' })]
});
const missingFactsText = renderAuthorityEvidenceResponseText(generalWithMissingFacts, false);
assert.match(missingFactsText, /Verified general guidance is available[\s\S]*application to the case remains unresolved/i);
assert.match(missingFactsText, /\*\*Application unresolved:\*\* Employment Act coverage and service facts remain to be confirmed/);

const unsupportedTaxStream = {
  id: 'iras-gst-stream', authority: 'IRAS', authorityLabel: 'IRAS', domain: 'IRAS_GST', domainLabel: 'GST',
  evidenceStatus: 'INSUFFICIENT', applicationStatus: 'UNRESOLVED',
  issues: [{ id: 'gst-medical', subject: 'GST on employee medical examinations', population: 'Company',
    operation: 'CHECK_ELIGIBILITY', evidenceStatus: 'INSUFFICIENT', applicationStatus: 'UNRESOLVED',
    claims: [], gaps: ['The applicable medical-expense exception is not established.'] }],
  sources: [], gaps: ['GST on employee medical examinations: no verified rule covers this issue.']
};
const mixedUnsupported = presentation({
  status: 'INSUFFICIENT', applicationStatus: 'UNRESOLVED',
  workstreams: [sickLeaveWorkstream(), unsupportedTaxStream],
  gaps: ['GST on employee medical examinations: no verified rule covers this issue.']
});
const mixedText = renderAuthorityEvidenceResponseText(mixedUnsupported, false);
assert.match(mixedText, /Verified general guidance is available[\s\S]*Evidence is incomplete for one or more material issues/);
assert.match(mixedText, /Whole-question gaps:[\s\S]*GST on employee medical examinations/);
assert.match(mixedText, /#### IRAS — GST[\s\S]*Evidence incomplete/);

const entirelyUnsupported = presentation({
  status: 'INSUFFICIENT', applicationStatus: 'UNRESOLVED', workstreams: [],
  gaps: ['No material issue has verified source coverage.']
});
const unsupportedText = renderAuthorityEvidenceResponseText(entirelyUnsupported, false);
assert.match(unsupportedText, /Evidence is incomplete for one or more material issues/);
assert.doesNotMatch(unsupportedText, /Verified general guidance is available/);

const mereExcerpt = presentation({
  status: 'INSUFFICIENT',
  workstreams: [sickLeaveWorkstream({
    issueEvidenceStatus: 'VERIFIED', streamEvidenceStatus: 'INSUFFICIENT',
    claimText: 'An employee is entitled to paid outpatient and hospitalisation leave.'
  })],
  gaps: ['The eligibility and service-period schedule is incomplete.']
});
const excerptText = renderAuthorityEvidenceResponseText(mereExcerpt, false);
assert.match(excerptText, /Verified official source excerpt/);
assert.doesNotMatch(excerptText, /MOM rule explanation/);
assert.doesNotMatch(excerptText, /Verified general guidance is available/,
  'A verified excerpt without the complete rule premises is not general-rule coverage.');

console.log('Authority general-guidance status header regressions passed.');
