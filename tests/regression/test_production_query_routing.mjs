import assert from 'node:assert/strict';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { updateCommittedJournalScenario } from '../../src/services/committedJournal.ts';
import { extractAccountingContext } from '../../src/services/conversationAccountingState.ts';
import { defaultSourceCache } from '../../src/retrieval/sourceCache.ts';
import { validateJournalGroups } from '../../src/verification/journalIntegrity.ts';
import { completeVisibleEvidenceListSpan } from '../../src/utils/evidenceTextBoundaries.ts';
import { hasExplicitPriorFactReference, startsNewAccountingScenario } from '../../src/services/conversationBoundary.ts';
import { isShortSemanticFollowUp } from '../../src/services/semanticQuestionUnderstanding.ts';

const equity = {
  query: 'Our holding company just injected SGD 500,000 cash via bank transfer into a newly incorporated operating subsidiary for 100% of its ordinary shares. How do we book this in the holding company’s standalone ledger?',
  paraphrase: 'We transferred SGD 500,000 from the parent’s bank account to subscribe for all the ordinary shares in its new subsidiary. What goes in the parent’s own books?',
  debit: 'Investment in Subsidiary',
  amount: 500_000,
  subject: 'holding company accounting for cash subscription for subsidiary shares',
  treatment: 'Assuming the parent uses cost accounting in its separate financial statements, recognize the investment at the amount paid.',
  ownershipContext: 'external_investment'
};
const loan = {
  query: 'We wired SGD 200,000 from our bank account to fund working capital for Subsidiary B on an open-account intercompany loan (repayable on demand). How should this be recorded?',
  paraphrase: 'Our company sent SGD 200,000 by bank to Subsidiary B as repayable-on-demand funding. Which accounts in our books change?',
  debit: 'Amount Due from Subsidiary B',
  amount: 200_000,
  subject: 'lender accounting for an on-demand intercompany loan paid by bank',
  treatment: 'The lender recognizes a receivable for the funds advanced to Subsidiary B on demand.',
  ownershipContext: 'not_applicable'
};
const gst = {
  query: 'Does our company need to register for GST if annual taxable turnover reaches SGD 1.2 million?',
  paraphrase: 'At S$1.2 million of taxable sales for the year, would GST registration become compulsory for our business?',
  subject: 'compulsory GST registration based on taxable turnover'
};
const standard = 'SFRS_I';
const model = 'gemini-3.5-flash-lite';
const provider = { activeProvider: 'gemini', gemini: { model, apiKey: 'offline-test-key-for-gemini' } };
const registrationUrl = 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-registration-deregistration/do-i-need-to-register-for-gst';
const officialPage = `<!doctype html><html><head><title>Do I need to register for GST | IRAS</title></head><body><main><article>
<h1>Do I need to register for GST</h1>
<p>Your business must register for GST if taxable turnover exceeds $1 million for the completed calendar year, or if it is reasonably expected to exceed $1 million in the next 12 months.</p>
<h2>Retrospective view</h2>
<p>If taxable turnover for the calendar year exceeds $1 million, apply for registration from 1 January to 30 January of the following year. Registration takes effect on 1 March.</p>
<h2>Prospective view</h2>
<p>If you can reasonably expect your taxable turnover to exceed $1 million in the next 12 months, apply within 30 days of the forecast. The forecast must be supported by documents such as signed contracts or confirmed orders.</p>
<h2>Exceptions</h2>
<p>You will not be required to register for GST if:</p>
<p>a. You may apply for exemption where your taxable turnover is derived wholly or mainly from zero-rated supplies.</p>
<p>b. If you are liable to register under the retrospective view only, all the following conditions must be met:</p>
<ul>
<li>You are certain that taxable turnover will not exceed S$1 million in the next 12 months</li>
<li>A qualifying change in your business explains the lower forecast</li>
<li>You have supporting documentation for your forecast</li>
</ul>
<p>Continue monitoring taxable turnover at the end of the next calendar year.</p>
</article></main></body></html>`;
const gstIssue = {
  subject: gst.subject, population: 'COMPANY', domain: 'IRAS_GST', governingAuthorities: ['IRAS'], contextualAuthorities: [],
  operation: 'CHECK_ELIGIBILITY', evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
  mappedTopicIds: ['gst_compulsory_registration', 'iras-gst-turnover-tests'], confidence: 0.98
};

function modelReply(payload, streaming = false) {
  const data = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
  return streaming ? new Response(`data: ${data}`, { headers: { 'content-type': 'text/event-stream' } })
    : new Response(data, { headers: { 'content-type': 'application/json' } });
}

function interpretation(accountingCase, asksGst, genericRegistrationIssue) {
  const accountingIssue = accountingCase ? {
    subject: accountingCase.subject, population: 'COMPANY', domain: 'ACCOUNTING', governingAuthorities: ['ACCOUNTING_STANDARDS'],
    contextualAuthorities: [], operation: 'PREPARE_JOURNAL', mappedTopicIds: [], evidenceRequirement: 'CASE_FACTS',
    confidence: 0.98
  } : undefined;
  const mixed = accountingIssue && asksGst;
  const statutoryIssue = genericRegistrationIssue
    ? { ...gstIssue, subject: 'GST registration eligibility', mappedTopicIds: [] } : gstIssue;
  const issues = [accountingIssue, asksGst && statutoryIssue].filter(Boolean);
  return {
    schemaVersion: 2, jurisdiction: ['Singapore'], authorityCandidates: mixed ? ['UNKNOWN'] : issues[0].governingAuthorities,
    contextualAuthorities: [], domain: mixed ? 'UNKNOWN' : issues[0].domain, population: 'COMPANY',
    primarySubject: issues.map(issue => issue.subject).join(' and '),
    concepts: issues.map(issue => ({ concept: issue.subject, role: 'PRIMARY' })),
    requestedOperation: mixed ? 'OTHER' : issues[0].operation, factsExplicitlyProvided: [], confidence: 0.98, issues
  };
}

function accountingFacts(accountingCase) {
  return {
    reportingEntity: { type: 'company', description: 'The company transferring funds' },
    counterparty: { role: 'other', description: 'Subsidiary receiving funds' },
    transactionType: accountingCase === equity ? 'equity_investment_acquisition' : 'unclassified_transaction',
    subject: accountingCase.debit, instrument: accountingCase === equity ? 'financial_asset_equity' : 'debt_instrument',
    ownershipContext: accountingCase.ownershipContext, paymentStatus: 'paid', amount: accountingCase.amount,
    currency: { value: 'SGD', source: 'explicit', confidence: 1, rationale: 'Currency as stated' },
    transactionDate: null, jurisdiction: 'SG', factsMissing: [], assumptions: [], confidence: 0.98,
    isHypothetical: false
  };
}

function journalPayload(accountingCase) {
  return {
    transactionNature: accountingCase.debit, treatment: accountingCase.treatment,
    requiredAccounts: [
      { accountName: accountingCase.debit, category: 'ASSET', debitCredit: 'DEBIT' },
      { accountName: 'Bank', category: 'ASSET', debitCredit: 'CREDIT' }
    ]
  };
}

function gstClaims(packet) {
  const hasBothTests = text => /calendar year/i.test(text) && /(?:next|period of) 12 months/i.test(text);
  const threshold = packet.evidencePassages.find(passage => hasBothTests(passage.completeAdmittedPassage));
  const exemption = packet.evidencePassages.find(passage => /wholly or mainly from zero-rated supplies/i.test(passage.completeAdmittedPassage));
  const retrospectiveException = packet.evidencePassages.find(passage =>
    /retrospective view only/i.test(passage.completeAdmittedPassage) && /qualifying change/i.test(passage.completeAdmittedPassage));
  assert.ok(threshold, `the synthesis packet includes a verified passage supporting both timing tests: ${packet.evidencePassages
    .map(passage => passage.completeAdmittedPassage).join(' | ')}`);
  assert.ok(exemption, 'the synthesis packet includes the admitted zero-rating exception');
  assert.ok(retrospectiveException, 'the synthesis packet includes the admitted retrospective-only exception');
  assert.ok(!/tax invoice|business purpose of the purchase/i.test(JSON.stringify(packet.missingFactsAndEvidenceGaps)),
    'registration inputs never request purchase documentation');
  const rule = (id, passage) => ({
    id, kind: 'RULE', text: passage.completeAdmittedPassage, supportIds: [passage.id], factRefs: [], issueId: passage.issueId
  });
  return [rule('threshold-and-tests', threshold), ...[...new Set([exemption, retrospectiveException])]
    .map((passage, index) => rule(`exception-${index}`, passage)), {
      id: 'conditional-registration', kind: 'APPLICATION',
      text: 'Registration is generally required if the stated taxable turnover is the completed calendar-year amount, or if it is a reasonably supported forecast for the next twelve months, subject to any applicable exception.',
      supportIds: [threshold.id], factRefs: ['fact-current-question'], issueId: threshold.issueId
    }];
}

const unmockedFetch = globalThis.fetch;
let active;
let recordedError;
globalThis.fetch = async (input, init) => {
  const url = new URL(input?.url || String(input));
  if (decodeURI(url.origin + url.pathname) === registrationUrl) {
    active.stages.push('IRAS');
    return new Response(officialPage, { headers: { 'content-type': 'text/html' } });
  }
  if (url.hostname !== 'generativelanguage.googleapis.com') return new Response('', { status: 404 });
  const body = JSON.parse(init.body);
  const system = body.systemInstruction?.parts?.[0]?.text || '';
  const prompt = body.contents.at(-1).parts[0].text;
  const streaming = url.pathname.endsWith(':streamGenerateContent');
  try {
    if (system.startsWith('EVIDENCE_GROUNDED_SYNTHESIS')) {
      active.stages.push('synthesis');
      if (active.rejectClaims) return modelReply({ claims: [{ id: 'unadmitted', kind: 'RULE',
        text: 'Registration is always compulsory for this company.', supportIds: ['invented'], factRefs: [] }] });
      const payload = JSON.parse(prompt);
      return modelReply({ claims: gstClaims(payload.packet || payload) });
    }
    if (system.startsWith('EVIDENCE_GROUNDED_SUPPORT_VERIFICATION')) {
      active.stages.push('support');
      return modelReply({ verdicts: JSON.parse(prompt).claims.map(claim => ({
        claimId: claim.claimId, support: 'SUPPORTED',
        claimType: claim.kind === 'APPLICATION' ? 'CONDITIONAL_APPLICATION' : 'RULE'
      })) });
    }
    if (prompt.includes('Interpret this question:')) {
      active.stages.push('interpretation');
      if (active.semanticUnavailable) return new Response(null, { status: 503 });
      return modelReply(interpretation(active.accounting, active.asksGst, active.genericRegistrationIssue));
    }
    if (system.includes('professional Singapore accounting and statutory advisory assistant')) {
      active.stages.push('advisory');
      return modelReply({ requestedOperation: active.asksGst ? 'GOVERNED_STATUTORY' : 'PREPARE_JOURNAL' });
    }
    if (prompt.startsWith('Analyze the following commercial query and extract structured economic facts:')) {
      active.stages.push('facts');
      assert.ok(active.accounting, 'the standalone GST question skips transaction fact extraction');
      if (active.semanticUnavailable) return new Response(null, { status: 503 });
      if (active.asksGst) assert.doesNotMatch(prompt, /annual taxable turnover|SGD 1\.2 million/i);
      return modelReply({ ...accountingFacts(active.accounting), ...(active.amountOverride !== undefined
        ? { amount: active.amountOverride } : {}) });
    }
    if (prompt.startsWith('Extract chronological accounting EVENT FACTS')) {
      active.stages.push('events');
      return modelReply({ events: [] });
    }
    active.stages.push('accounting');
    const journal = active.accounting ? journalPayload(active.accounting) : {};
    if (active.unrequestedTaxClaim) {
      if (active.unrequestedTaxClaim === 'reasoning') {
        journal.reasoning = 'The company must pay GST on the loan today. GST is 70%.';
      } else {
        journal.singaporeTaxImpact = 'The company must pay GST on the loan today.';
        journal.treatment += ' Singapore GST is 70%.';
      }
    }
    if (active.unsafeAccountLabel) journal.requiredAccounts[1].accountName = 'Bank <GST is 70%>';
    return modelReply(journal, streaming);
  } catch (error) {
    recordedError = error;
    throw error;
  }
};

async function run(query, {
  accounting, asksGst = false, rejectClaims = false, journal = false, unrequestedTaxClaim = false, amountOverride,
  genericRegistrationIssue = false, unsafeAccountLabel = false, semanticUnavailable = false
} = {}, priorTurns = [], priorScenario = null) {
  active = { accounting, asksGst, rejectClaims, unrequestedTaxClaim, amountOverride, genericRegistrationIssue, unsafeAccountLabel, semanticUnavailable, stages: [] };
  recordedError = undefined;
  const trace = [];
  let groundedClassification;
  const turns = [...priorTurns, { id: `user-${priorTurns.length}`, sender: 'user', text: query, timestamp: '' }];
  const response = await processAccountingQuery(query, priorScenario, standard, provider, model, turns, journal ? { journal: true } : undefined, {
    onProcessingOutcome: value => trace.push(value),
    onGroundedContext: context => { groundedClassification = context.classification; }
  });
  if (recordedError) throw recordedError;
  return {
    response, stages: active.stages, trace, groundedClassification,
    turns: [...turns, { id: `assistant-${turns.length}`, sender: 'assistant', text: response.messageText, timestamp: '' }]
  };
}

function assertProposed(result, accountingCase) {
  const groups = result.response.scenarioState.directGroups || [];
  assert.deepEqual(groups.flatMap(group => group.lines.map(line => [line.accountName, line.debit, line.credit])),
    [[accountingCase.debit, accountingCase.amount, 0], ['Bank', 0, accountingCase.amount]],
    `Journal result for ${accountingCase.debit} through ${result.stages.join(', ')}: ${result.response.messageText}`);
  const integrity = validateJournalGroups(groups, { rawQuery: accountingCase.query });
  assert.ok(integrity.isValid, JSON.stringify(integrity.issues));
  assert.equal(result.response.scenarioState.functionalCurrency, 'SGD');
  assert.ok(groups.every(group => group.authorityStatus === 'AI_PROPOSED' || group.authorityStatus === 'CONDITIONAL'));
  assert.ok(!result.response.scenarioState.committedDirectGroups?.length);
  assert.ok(!result.response.scenarioState.actualEvents?.length, 'a proposal does not create a committed accounting event');
  const accountingContext = extractAccountingContext(result.response.scenarioState);
  assert.equal(accountingContext.actualEvents.length, 0, 'a later turn cannot treat the proposal as an actual event');
  assert.equal(accountingContext.outstandingBalances.length, 0, 'a proposed loan does not open a receivable balance');
  assert.equal(updateCommittedJournalScenario(null, result.response.scenarioState, standard), null,
    'a model-proposed entry does not become the active committed journal');
}

function assertRegistration(result, queryMode = 'STATUTORY_ADVISORY') {
  assert.equal(result.response.answerPath, 'AI_GROUNDED_SYNTHESIS');
  assert.deepEqual(result.trace, [{ queryMode, processingPath: 'GROUNDED_SYNTHESIS' }]);
  assert.match(result.response.messageText, /(?:\$1 million|\$1,000,000)/i);
  assert.match(result.response.messageText, /calendar.year/i);
  assert.match(result.response.messageText, /(?:next|period of) (?:12|twelve) months/i);
  assert.match(result.response.messageText, /zero-rated supplies/i);
  assert.match(result.response.messageText, /retrospective view only/i);
  assert.doesNotMatch(result.response.messageText, /business purpose of the purchase|tax invoice|provider could not/i);
  assert.ok(result.response.scenarioState.officialAnswerLinks.some(link => link.url === registrationUrl));
}

const extractedList = [
  'Two exceptions apply:', 'a. Apply for an exemption.', 'b. Meet all these conditions:',
  '•', '• A lower forecast', '•', '• Supporting documents', 'Continue monitoring your turnover.'
];
assert.match(completeVisibleEvidenceListSpan(extractedList, 0)?.quote || '', /A lower forecast[\s\S]*Supporting documents/);
assert.equal(completeVisibleEvidenceListSpan(extractedList.slice(0, -1), 0), undefined,
  'an unpunctuated nested list cut off at the end of an excerpt is still rejected');

try {
  for (const transaction of [equity, loan]) {
    const result = await run(transaction.query, { accounting: transaction });
    assertProposed(result, transaction);
    assert.deepEqual(result.trace, [{ queryMode: 'TRANSACTION', processingPath: 'ACCOUNTING_ENGINE' }]);
    assert.doesNotMatch(result.response.messageText, /statutory evidence unresolved/i);
    assert.ok(!result.stages.includes('synthesis'), 'a journal-only request does not enter statutory synthesis');
    assertProposed(await run(transaction.query, { accounting: transaction, journal: true }), transaction);
  }
  const standalone = await run(gst.query, { asksGst: true });
  assertRegistration(standalone);
  assert.ok(!standalone.response.scenarioState.directGroups?.some(group => group.lines.length));
  assertRegistration(await run(gst.query, { asksGst: true, genericRegistrationIssue: true }));

  let result = await run(equity.query, { accounting: equity });
  const degradedLoan = await run(loan.query, { accounting: loan, semanticUnavailable: true },
    result.turns, result.response.scenarioState);
  assertProposed(degradedLoan, loan);
  assert.deepEqual(degradedLoan.trace, [{ queryMode: 'TRANSACTION', processingPath: 'ACCOUNTING_ENGINE' }]);
  result = await run(loan.query, { accounting: loan }, result.turns, result.response.scenarioState);
  assertProposed(result, loan);
  result = await run(gst.query, { asksGst: true }, result.turns, result.response.scenarioState);
  assertRegistration(result);
  assert.ok(!result.response.scenarioState.directGroups?.some(group => group.lines.length),
    'an independent GST turn does not inherit the loan proposal');

  for (const transaction of [equity, loan]) {
    assertProposed(await run(transaction.paraphrase, { accounting: transaction }), transaction);
  }
  assertRegistration(await run(gst.paraphrase, { asksGst: true }));

  result = await run(loan.query, { accounting: loan, unrequestedTaxClaim: true });
  assertProposed(result, loan);
  assert.doesNotMatch(result.response.messageText, /must pay GST|GST is 70%|statutory evidence unresolved/i);

  result = await run('Explain the accounting treatment after we paid SGD 200,000 as a loan to Subsidiary B. Do not provide a journal entry.', {
    accounting: loan
  });
  assert.ok(!result.response.scenarioState.directGroups?.length,
    'an incorrect semantic journal interpretation cannot override the user’s explicit opt-out');
  assert.doesNotMatch(result.response.messageText, /double entry journal|\*\*debit\*\*:|\*\*credit\*\*:/i,
    'the journal is also absent from the visible answer after opting out');

  result = await run(`${gst.query} Separately, ${loan.query}`, { accounting: loan, asksGst: true });
  assertProposed(result, loan);
  assertRegistration(result, 'HYBRID');

  result = await run(`${gst.query} Separately, ${loan.query}`, {
    accounting: loan, asksGst: true, amountOverride: 1_200_000
  });
  assert.ok(!result.response.scenarioState.directGroups?.some(group => group.totalDebit > 0 || group.totalCredit > 0),
    'a number from the statutory issue cannot establish the loan amount');
  result = await run('Given SGD 1.2 million in taxable turnover and a SGD 200,000 loan to Subsidiary B, can you check our GST registration obligation and prepare the loan journal?', {
    accounting: { ...loan, subject: 'loan to Subsidiary B' }, asksGst: true, amountOverride: 1_200_000
  });
  assert.ok(!result.response.scenarioState.directGroups?.some(group => group.totalDebit === 1_200_000),
    'co-located amounts cannot turn the turnover into a loan balance');

  result = await run(`${loan.query} Separately, ${gst.query}`, {
    accounting: loan, asksGst: true, rejectClaims: true
  });
  assertProposed(result, loan);
  assert.deepEqual(result.trace, [{
    queryMode: 'HYBRID', processingPath: 'GROUNDED_EVIDENCE_FALLBACK',
    rejectionReason: 'EVIDENCE_CLAIMS_REJECTED', rejectionCodes: ['PACKET_REFERENCE_INVALID']
  }]);
  assert.doesNotMatch(result.response.messageText, /Registration is always compulsory/);
  result = await run(`${loan.query} Separately, ${gst.query}`, {
    accounting: loan, asksGst: true, rejectClaims: true, unsafeAccountLabel: true
  });
  assert.doesNotMatch(JSON.stringify(result.response), /Bank <|GST is 70%/i,
    'structural balance does not make an unsafe model account label safe to display');

  const priorLoan = await run(loan.query, { accounting: loan, journal: true });
  assertProposed(priorLoan, loan);
  const amountFreeJournalFollowUp = 'Regarding the earlier transaction, please prepare the accounting entry again and explain the debit and credit.';
  assert.doesNotMatch(amountFreeJournalFollowUp, /\d/);
  result = await run(amountFreeJournalFollowUp, { accounting: loan, journal: true },
    priorLoan.turns, priorLoan.response.scenarioState);
  assertProposed(result, loan);
  assert.notEqual(result.response.answerPath, 'AI_GROUNDED_SYNTHESIS_FALLBACK',
    'an ACRA accounting standard-setter label alone does not route an accounting-only follow-up to statutory fallback');
  assert.deepEqual(result.trace, [{ queryMode: 'TRANSACTION', processingPath: 'ACCOUNTING_ENGINE' }]);
  assert.equal(result.groundedClassification.intent, 'TRANSACTION');
  assert.ok(result.groundedClassification.authorities.includes('ACRA'),
    'production classification retains ACRA as accounting-standard retrieval metadata');
  assert.ok(!result.groundedClassification.domains.some(domain => domain.startsWith('ACRA_')),
    'the retained ACRA label has no ACRA statutory domain for this accounting-only follow-up');
  assert.match(result.response.messageText, /Amount Due from Subsidiary B/);
  assert.match(result.response.messageText, /SGD 200,000/);

  const sameLoanFollowUp = 'Regarding the earlier transaction, how should we record the advance to Subsidiary B?';
  const cleanLoanFollowUp = await run(sameLoanFollowUp, { accounting: loan, journal: true },
    priorLoan.turns, priorLoan.response.scenarioState);
  assertProposed(cleanLoanFollowUp, loan);
  result = await run(sameLoanFollowUp, { accounting: loan, journal: true, unrequestedTaxClaim: 'reasoning' },
    priorLoan.turns, priorLoan.response.scenarioState);
  assertProposed(result, loan);
  assert.doesNotMatch(JSON.stringify(result.response), /GST is 70%|must pay GST on the loan/i,
    'unrequested statutory prose in provider reasoning is removed while the verified amount context preserves the AI proposal');
  assert.deepEqual(result.response.scenarioState.directGroups.map(group => ({
    id: group.id,
    authorityStatus: group.authorityStatus,
    lines: group.lines.map(line => [line.accountName, line.debit, line.credit])
  })), cleanLoanFollowUp.response.scenarioState.directGroups.map(group => ({
    id: group.id,
    authorityStatus: group.authorityStatus,
    lines: group.lines.map(line => [line.accountName, line.debit, line.credit])
  })), 'removing an unsolicited statutory claim preserves the same validated loan journal');

  const separateLoanFollowUp = 'Also, can you check the GST treatment and prepare a journal for a separate loan to Subsidiary C?';
  assert.equal(hasExplicitPriorFactReference(separateLoanFollowUp, priorLoan.response.scenarioState), false);
  assert.equal(isShortSemanticFollowUp(separateLoanFollowUp, priorLoan.response.scenarioState), true);
  assert.equal(startsNewAccountingScenario(separateLoanFollowUp, priorLoan.response.scenarioState), false);
  const separateLoan = await run(separateLoanFollowUp, {
    accounting: loan, asksGst: true, rejectClaims: true, journal: true
  }, priorLoan.turns, priorLoan.response.scenarioState);
  assert.doesNotMatch(separateLoanFollowUp, /\d/);
  assert.deepEqual(separateLoan.response.scenarioState.directGroups, [],
    'a new loan without its own amount cannot inherit the unrelated prior loan journal');
} finally {
  globalThis.fetch = unmockedFetch;
  defaultSourceCache.clear();
}

console.log('Production query routing P1 regression passed.');
