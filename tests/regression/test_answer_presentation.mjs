import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnswerPresentation } from '../../src/components/AnswerPresentation.tsx';
import { ChatPanel } from '../../src/components/ChatPanel.tsx';
import { JournalTable } from '../../src/components/JournalTable.tsx';
import { SafeChatAnswer } from '../../src/components/SafeChatAnswer.tsx';
import { createAuthorityEvidencePresentation } from '../../src/utils/authorityEvidencePresentation.ts';
import { getCanonicalOfficialAnswerLinks } from '../../src/utils/answerPresentation.ts';
import { createRequestCompletenessContext } from '../../src/services/requestCompleteness.ts';

const fixture = JSON.parse(await readFile(new URL('../fixtures/answerPresentation20261113.json', import.meta.url), 'utf8'));

assert.match(fixture.fixtureNote, /not establish current legal correctness or evidence verification/i);
for (const capture of fixture.captures) {
  assert.match(capture.origin, /^review-corrections-20261113\//, `${capture.caseId} has capture provenance`);
  assert.match(capture.originalCaptureSha256, /^[a-f0-9]{64}$/, `${capture.caseId} records the original capture hash`);
  assert.equal(createHash('sha256').update(capture.capturedText).digest('hex'), capture.capturedTextSha256,
    `${capture.caseId} stored excerpt hash is intact`);
  const capturedMarkup = renderToStaticMarkup(React.createElement(SafeChatAnswer, { text: capture.capturedText, trustedLinks: [] }));
  assert.ok(capturedMarkup.length > 0, `${capture.caseId} excerpt remains renderable as an escaped historical sample`);
}

const links = getCanonicalOfficialAnswerLinks(fixture.syntheticStructuredAnswer.links);
assert.equal(links.length, 5, 'only canonical HTTPS URLs from the supplied source list remain, with duplicates removed');
assert.deepEqual(links.map(link => new URL(link.url).hostname), [
  'www.iras.gov.sg', 'www.cpf.gov.sg', 'www.mom.gov.sg', 'www.acra.gov.sg', 'www.mas.gov.sg'
]);
assert.ok(links.every(link => new URL(link.url).protocol === 'https:'), 'source footer links are HTTPS');

const answerMarkup = renderToStaticMarkup(React.createElement(SafeChatAnswer, {
  text: fixture.syntheticStructuredAnswer.text,
  trustedLinks: links
}));
assert.ok(answerMarkup.indexOf('Direct Answer') < answerMarkup.indexOf('Opening context remains visible.'),
  'an existing explicit answer section is presented first without dropping the original preamble');
assert.ok(answerMarkup.indexOf('Direct Answer') < answerMarkup.indexOf('Practical steps'),
  'existing practical steps follow the direct answer');
assert.match(answerMarkup, /remains conditional if the stated condition is not met/, 'the material condition is preserved');
assert.match(answerMarkup, /Keep that limitation visible/, 'the qualifier is preserved');
assert.match(answerMarkup, /<ol\b/);
assert.match(answerMarkup, /<li value="3">Confirm any fact that could change the outcome\.<\/li>/,
  'explicit numbering gaps remain visible in the ordered list');
assert.match(answerMarkup, /<table aria-label="Answer details" class=/);
assert.match(answerMarkup, /<th scope="col" class="[^"]+">Item<\/th>/, 'Markdown tables render with semantic column headers');
assert.match(answerMarkup, /&lt;img src=x onerror=alert\(1\)&gt;/, 'HTML remains escaped text');
assert.doesNotMatch(answerMarkup, /<img\b/i, 'provider answer text cannot inject an element');
assert.match(answerMarkup, /\[Unlisted source\]\(https:\/\/attacker\.example\/source\)/,
  'a citation outside the exact source list remains visible as plain text');
assert.doesNotMatch(answerMarkup, /<a[^>]+href="https:\/\/attacker\.example/,
  'an unlisted HTTPS citation is not clickable');
assert.match(answerMarkup, /<a[^>]+href="https:\/\/www\.iras\.gov\.sg\/taxes"/,
  'a canonical citation link matching the source list stays clickable');

const footerMarkup = renderToStaticMarkup(React.createElement(AnswerPresentation, {
  text: fixture.syntheticStructuredAnswer.text,
  scenario: { officialAnswerLinks: fixture.syntheticStructuredAnswer.links, rawQuery: 'Synthetic presentation question' }
}));
assert.match(footerMarkup, /Cited sources/);
assert.equal((footerMarkup.match(/<a\b/g) || []).length, 6,
  'five unique source footer links and one in-answer citation are rendered');
for (const authority of ['IRAS', 'CPF', 'MOM', 'ACRA', 'MAS']) assert.match(footerMarkup, new RegExp(`>${authority}:`));
assert.doesNotMatch(footerMarkup, /href="http:\/\//, 'insecure URLs are rejected even when present in a malformed source list');
assert.doesNotMatch(footerMarkup, /role="status"|Evidence status:/,
  'cited links alone do not add a verification or failure warning');

function trustedAuthorityPresentation(query, options = {}) {
  const {
    evidenceStatus = 'VERIFIED', authority = 'IRAS', domain = 'IRAS_CORPORATE_TAX',
    applicationStatus = 'NOT_REQUIRED', applicationReason, gapReasons = [], coverageGaps = []
  } = options;
  const source = {
    id: 'presentation-source', authority, sourcePublisher: authority,
    legalOrStandardInstrument: 'Test-only source', documentTitle: 'Test-only source',
    officialSourceUrl: '', provenance: 'LOCAL_STATIC', validFrom: '2026-01-01'
  };
  const claim = {
    recordId: source.id, text: 'Synthetic admitted claim.', quote: 'Synthetic admitted passage.',
    supportKind: 'EXACT_SOURCE_QUOTE', issueIds: ['presentation-issue'], provenance: 'LOCAL_STATIC'
  };
  const issue = {
    issueId: 'presentation-issue', subject: 'Synthetic issue', population: 'Company',
    domain, operation: 'EXPLAIN_RULE', evidenceRequirement: 'AUTHORITATIVE_SOURCE',
    governingAuthority: authority, sourceSections: [],
    lifecycle: { requested: true, mapped: true, retrievalAttempted: true, evidenceFound: true, admitted: true, verified: true, covered: true },
    evidenceStatus, applicationStatus, ...(applicationReason ? { applicationReason } : {}),
    verifiedClaims: evidenceStatus === 'VERIFIED' ? [claim] : [], sources: [source],
    gaps: gapReasons.map(reason => ({ reason }))
  };
  const context = createRequestCompletenessContext(query);
  return createAuthorityEvidencePresentation({
    query,
    requestCompletenessContext: context,
    issuePlan: { source: 'SEMANTIC_ISSUES', coverageEstablished: true, hasUnmappedResidual: false,
      issues: [{ id: 'presentation-issue', governingAuthorities: [authority], domain, status: 'MAPPED' }] },
    workstreams: [{ id: `${authority}:${domain}`, authority, domain,
      sourceSections: [], populations: ['COMPANY'], issues: [issue], evidenceStatus,
      applicationStatus, verifiedClaims: issue.verifiedClaims, sources: [source], gaps: [] }],
    evidenceStatus, applicationStatus, status: evidenceStatus,
    gaps: coverageGaps.map(reason => ({ subject: 'Question coverage', reason }))
  });
}

const authorityQuery = 'Synthetic current authority question';
const mappedEvidence = trustedAuthorityPresentation(authorityQuery);
const mappedMarkup = renderToStaticMarkup(React.createElement(AnswerPresentation, {
  text: 'Retained answer with its original conditions.',
  scenario: { rawQuery: authorityQuery, authorityEvidencePresentation: mappedEvidence }
}));
assert.match(mappedMarkup, /Evidence is verified for the identified issues, but coverage of the entire question is unconfirmed/,
  'current verified mapped evidence is not promoted when request coverage is incomplete');
assert.doesNotMatch(mappedMarkup, /the entire question has been covered/);

const incompleteEvidence = trustedAuthorityPresentation(authorityQuery, { evidenceStatus: 'INSUFFICIENT' });
const incompleteMarkup = renderToStaticMarkup(React.createElement(AnswerPresentation, {
  text: 'The available answer and its limitations remain visible.',
  scenario: { rawQuery: authorityQuery, authorityEvidencePresentation: incompleteEvidence }
}));
assert.match(incompleteMarkup, /Evidence is incomplete for some parts of the question/);
assert.match(incompleteMarkup, /available answer and its limitations remain visible/);

const clonedEvidence = structuredClone(mappedEvidence);
const untrustedMarkup = renderToStaticMarkup(React.createElement(AnswerPresentation, {
  text: 'Answer text is still present.',
  scenario: { rawQuery: authorityQuery, authorityEvidencePresentation: clonedEvidence }
}));
assert.match(untrustedMarkup, /Evidence status is unavailable for the current question/,
  'a deserialized authority presentation fails the identity-based trust check');
assert.doesNotMatch(untrustedMarkup, /Evidence is verified for the identified issues/);

const cpfQuery = 'Synthetic conditional CPF setup question';
const conditionalCpfEvidence = trustedAuthorityPresentation(cpfQuery, {
  authority: 'CPF', domain: 'CPF_PAYROLL', applicationStatus: 'UNRESOLVED',
  applicationReason: 'Confirm the employee contribution category before applying this rule.',
  gapReasons: ['Employer registration evidence has not been established.', 'Employer registration evidence has not been established.'],
  coverageGaps: ['Some cited topics still need source review.']
});
const conditionalCpfMarkup = renderToStaticMarkup(React.createElement(AnswerPresentation, {
  text: 'The answer and its existing qualifications remain visible.',
  scenario: { rawQuery: cpfQuery, authorityEvidencePresentation: conditionalCpfEvidence }
}));
assert.match(conditionalCpfMarkup, /Conditions and evidence still needed/);
assert.match(conditionalCpfMarkup, />Synthetic issue: <\/span>Confirm the employee contribution category before applying this rule/);
assert.match(conditionalCpfMarkup, />Synthetic issue: <\/span>Employer registration evidence has not been established/);
assert.equal((conditionalCpfMarkup.match(/Employer registration evidence has not been established/g) || []).length, 1,
  'duplicate material conditions are deduplicated within their issue scope');
assert.ok(conditionalCpfMarkup.indexOf('Conditions and evidence still needed') < conditionalCpfMarkup.indexOf('<details'),
  'CPF application conditions remain visible outside collapsed technical gaps');

const irasQuery = 'Synthetic IRAS question';
const currentIras = {
  query: irasQuery, domainLabel: 'IRAS Income Tax', status: 'CONDITIONAL',
  chatAnswer: 'Synthetic IRAS answer.', overview: 'Synthetic scope.', applicationStatus: 'UNRESOLVED',
  factsToConfirm: ['Confirm the relevant facts before applying the rule.'], sourceGroups: []
};
const currentIrasMarkup = renderToStaticMarkup(React.createElement(AnswerPresentation, {
  text: 'The source-supported answer stays visible.',
  scenario: {
    rawQuery: irasQuery, primaryDomain: 'IRAS_TAX', queryIntent: 'STATUTORY_ADVISORY',
    requestCompletenessContext: createRequestCompletenessContext(irasQuery), irasEvidencePresentation: currentIras
  }
}));
assert.match(currentIrasMarkup, /<section aria-label="Facts to confirm"[^>]*>[\s\S]*Confirm the relevant facts before applying the rule/,
  'material IRAS facts to confirm remain visible');
assert.doesNotMatch(currentIrasMarkup, /Evidence status:|Current IRAS evidence is verified/,
  'the unbranded legacy IRAS projection does not assert an evidence status');
assert.doesNotMatch(currentIrasMarkup, /<details/, 'material IRAS facts are not placed only in collapsed diagnostic details');
const forgedIrasMarkup = renderToStaticMarkup(React.createElement(AnswerPresentation, {
  text: 'A raw IRAS status does not prove this answer.',
  scenario: {
    rawQuery: irasQuery, primaryDomain: 'IRAS_TAX', queryIntent: 'STATUTORY_ADVISORY',
    requestCompletenessContext: createRequestCompletenessContext(irasQuery),
    irasEvidencePresentation: { ...currentIras, status: 'VERIFIED', factsToConfirm: [], sourceGroups: [] }
  }
}));
assert.doesNotMatch(forgedIrasMarkup, /Evidence status:|IRAS evidence is verified/i,
  'a current query and completeness context cannot promote an unbranded IRAS scalar status');
const staleIrasMarkup = renderToStaticMarkup(React.createElement(AnswerPresentation, {
  text: 'A stale status must not replace the current answer.',
  scenario: {
    rawQuery: irasQuery, primaryDomain: 'IRAS_TAX', queryIntent: 'STATUTORY_ADVISORY',
    requestCompletenessContext: createRequestCompletenessContext(irasQuery),
    irasEvidencePresentation: { ...currentIras, query: 'An earlier question' }
  }
}));
assert.match(staleIrasMarkup, /Evidence status is unavailable for the current question/);
assert.doesNotMatch(staleIrasMarkup, /Current IRAS evidence is available/);

globalThis.localStorage = { getItem: () => null, setItem: () => undefined };
const acraCapture = fixture.captures.find(capture => capture.caseId === 'acra-sole-director-secretary');
const chatMarkup = renderToStaticMarkup(React.createElement(ChatPanel, {
  messages: [
    { id: 'user-markdown', sender: 'user', timestamp: '', text: '# User text stays plain', displayFullAnswer: true },
    {
      id: 'assistant-preview', sender: 'assistant', timestamp: '', text: 'Short visible summary.',
      fullText: '### Full response\n\nFull response retains the original conditional detail.',
      advisoryFailureStatus: acraCapture.failureStatus,
      scenarioSnapshot: { rawQuery: 'Synthetic preview question', officialAnswerLinks: links }
    }
  ],
  onSendMessage: () => undefined, onRetryMessage: () => undefined, onRetryAiAnswer: () => undefined,
  onSelectSuggestion: () => undefined, onResolveRelation: () => undefined,
  isLoading: false, isAwaitingRelation: false,
  outputPreference: { journal: false, statutory: false }, onOutputPreferenceChange: () => undefined
}));
assert.match(chatMarkup, /<div class="whitespace-pre-line font-normal"># User text stays plain<\/div>/,
  'user-supplied text is not parsed as assistant Markdown');
assert.match(chatMarkup, /<summary[^>]*>Open full response and source evidence<\/summary>/,
  'a previewed answer has an accessible expandable full-response control');
assert.match(chatMarkup, /Full response retains the original conditional detail/);
assert.match(chatMarkup, /Cited sources/);
assert.match(chatMarkup, /The available response is shown below/);
assert.doesNotMatch(chatMarkup, /provider secret|raw provider error/i);
const noDisclosureMarkup = renderToStaticMarkup(React.createElement(ChatPanel, {
  messages: [{
    id: 'assistant-complete-preview', sender: 'assistant', timestamp: '', text: 'The full answer is already visible.',
    fullText: 'The full answer is already visible.',
    scenarioSnapshot: { rawQuery: 'Synthetic complete preview', officialAnswerLinks: links }
  }],
  onSendMessage: () => undefined, onRetryMessage: () => undefined, onRetryAiAnswer: () => undefined,
  onSelectSuggestion: () => undefined, onResolveRelation: () => undefined,
  isLoading: false, isAwaitingRelation: false,
  outputPreference: { journal: false, statutory: false }, onOutputPreferenceChange: () => undefined
}));
assert.doesNotMatch(noDisclosureMarkup, /Open full response and source evidence/);
assert.match(noDisclosureMarkup, /Cited sources/,
  'when no separate full-response disclosure exists, cited sources remain visible with the answer');

const masCapture = fixture.captures.find(capture => capture.caseId === 'mas-fund-management-startup');
const masQuery = 'Synthetic MAS fund-management question';
const masCatalogEvidence = trustedAuthorityPresentation(masQuery, {
  authority: 'MAS', domain: 'MAS_FUNDS', applicationStatus: 'UNRESOLVED',
  applicationReason: 'Confirm which activities are performed before applying this guidance.',
  gapReasons: ['Some source support still needs review.'],
  coverageGaps: ['A technical evidence gap remains.']
});
const legacyCatalogText = `${masCapture.capturedText}\n\n#### Captured catalog remainder\nThe complete legacy evidence catalog remains available in this disclosure.`;
const catalogScenario = {
  rawQuery: masQuery, authorityEvidencePresentation: masCatalogEvidence, officialAnswerLinks: links
};
const legacyCatalogMarkup = renderToStaticMarkup(React.createElement(ChatPanel, {
  messages: [
    { id: 'mas-catalog-user', sender: 'user', timestamp: '', text: masQuery },
    {
      id: 'mas-catalog-failure', sender: 'assistant', timestamp: '', text: masCapture.capturedText,
      fullText: legacyCatalogText, displayFullAnswer: true, advisoryFailureStatus: masCapture.failureStatus,
      advisoryRetryPayload: { text: masQuery, scenarioSnapshot: catalogScenario, originalUserMessageId: 'mas-catalog-user' },
      scenarioSnapshot: catalogScenario
    }
  ],
  onSendMessage: () => undefined, onRetryMessage: () => undefined, onRetryAiAnswer: () => undefined,
  onSelectSuggestion: () => undefined, onResolveRelation: () => undefined,
  isLoading: false, isAwaitingRelation: false,
  outputPreference: { journal: false, statutory: false }, onOutputPreferenceChange: () => undefined
}));
const catalogDisclosureIndex = legacyCatalogMarkup.indexOf('<details');
const catalogDisclosureEnd = legacyCatalogMarkup.indexOf('</details>', catalogDisclosureIndex);
assert.match(legacyCatalogMarkup, /<details[^>]*><summary[^>]*>Available source evidence<\/summary>/,
  'the known legacy catalog is collapsed by default on the explicit fallback path');
assert.doesNotMatch(legacyCatalogMarkup.slice(catalogDisclosureIndex, catalogDisclosureIndex + 30), /open/,
  'the catalog disclosure is closed initially');
assert.ok(catalogDisclosureIndex > legacyCatalogMarkup.indexOf('AI answer could not be completed.'),
  'the provider-failure banner remains visible before the collapsed catalog');
assert.ok(catalogDisclosureEnd > catalogDisclosureIndex &&
  legacyCatalogMarkup.indexOf('complete legacy evidence catalog remains available') < catalogDisclosureEnd,
  'the complete response body remains available inside the disclosure');
assert.ok(legacyCatalogMarkup.indexOf('Conditions and evidence still needed') > catalogDisclosureEnd,
  'material applicability conditions remain visible outside the collapsed body');
assert.ok(legacyCatalogMarkup.indexOf('Cited sources') > catalogDisclosureEnd,
  'cited source links remain visible outside the collapsed body');
assert.match(legacyCatalogMarkup, /Confirm which activities are performed before applying this guidance/);
assert.match(legacyCatalogMarkup, /Retry AI answer/, 'the existing retry control remains visible');

const normalFullAnswerMarkup = renderToStaticMarkup(React.createElement(ChatPanel, {
  messages: [{
    id: 'normal-full-answer', sender: 'assistant', timestamp: '', text: '# Answer\n\nProvider partial content remains visible.',
    displayFullAnswer: true, advisoryFailureStatus: 'OTHER'
  }],
  onSendMessage: () => undefined, onRetryMessage: () => undefined, onRetryAiAnswer: () => undefined,
  onSelectSuggestion: () => undefined, onResolveRelation: () => undefined,
  isLoading: false, isAwaitingRelation: false,
  outputPreference: { journal: false, statutory: false }, onOutputPreferenceChange: () => undefined
}));
assert.match(normalFullAnswerMarkup, /<h3[^>]*>Answer<\/h3>/, 'normal Answer sections remain open');
assert.match(normalFullAnswerMarkup, /Provider partial content remains visible/);
assert.doesNotMatch(normalFullAnswerMarkup, /Available source evidence/,
  'the disclosure is limited to the known legacy heading plus an explicit failure status');

const journalMarkup = renderToStaticMarkup(React.createElement(JournalTable, {
  groups: [fixture.syntheticJournal.group], standard: 'SFRS_I',
  functionalCurrency: fixture.syntheticJournal.functionalCurrency
}));
assert.match(journalMarkup, /amounts are in SGD/);
assert.match(journalMarkup, /Debit in SGD/);
assert.match(journalMarkup, /Credit in SGD/);
assert.match(journalMarkup, /1,234\.50/);
assert.match(journalMarkup, /<th scope="col"/);

console.log('Answer presentation regressions passed: captured provenance, safe structured Markdown, cited-source allowlist, current evidence status, preview disclosure, and journal formatting.');
