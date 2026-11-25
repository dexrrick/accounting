import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JournalTable } from '../../src/components/JournalTable.tsx';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { updateCommittedJournalScenario } from '../../src/services/committedJournal.ts';
import { extractAccountingContext } from '../../src/services/conversationAccountingState.ts';
import { defaultTransactionUnderstandingService, validateAndNormalizeUnderstanding } from '../../src/services/transactionUnderstandingService.ts';
import { createChatPreview, extractOfficialAnswerLinks } from '../../src/utils/chatPresentation.ts';
import { InputHandlerPanel } from '../../src/components/InputHandlerPanel.tsx';
import { ComplianceRationale } from '../../src/components/ComplianceRationale.tsx';

const initialQuery = 'currently the company has one singaporean employees earning 60k a month he is 60 years old show me the relevant double entries';
const resignationQuery = 'what if the employee resigned on 15/10/2026 what will be his pro-rated payroll and CPF';
const initial = await parseAccountingQuery(initialQuery);
assert.equal(initial.scenarioType, 'PAYROLL_CPF_SALARY');
assert.equal(initial.amount, 60000);

const loanProposal={
  id:'uncommitted-intercompany-loan',transactionId:'loan-proposal',eventDate:'24/11/2026',title:'Intercompany loan advance',
  summary:'Proposed loan advance',lines:[
    {id:'receivable',accountCode:'1300',accountName:'Amount Due from Subsidiary B',category:'ASSET',debit:200,credit:0,lineExplanation:''},
    {id:'bank',accountCode:'1000',accountName:'Bank',category:'ASSET',debit:0,credit:200,lineExplanation:''}
  ],totalDebit:200,totalCredit:200,isBalanced:true,citations:[],rationalePoints:[],authorityStatus:'AI_PROPOSED'
};
const conditionalLoanProposal={...loanProposal,id:'conditional-loan',authorityStatus:'CONDITIONAL'};
const emptyCommitContext=extractAccountingContext({
  functionalCurrency:'SGD',transactionCurrency:'SGD',committedDirectGroups:[],
  directGroups:[loanProposal],actualEvents:[]
});
assert.deepEqual(emptyCommitContext.priorJournals,[],
  'an explicit empty committed journal list is authoritative over an uncommitted proposal');
assert.deepEqual(emptyCommitContext.actualEvents,[]);
assert.deepEqual(emptyCommitContext.outstandingBalances,[],
  'an uncommitted proposal cannot create a receivable balance');
const proposalOnlyContext=extractAccountingContext({
  functionalCurrency:'SGD',transactionCurrency:'SGD',directGroups:[loanProposal,conditionalLoanProposal]
});
assert.deepEqual(proposalOnlyContext.priorJournals,[],
  'legacy direct-group fallback excludes both AI-proposed and conditional journals');
assert.deepEqual(proposalOnlyContext.actualEvents,[]);
for (const legacyGroup of [
  {...loanProposal,id:'deterministic-legacy',authorityStatus:'DETERMINISTIC'},
  {...loanProposal,id:'statusless-legacy',authorityStatus:undefined}
]) {
  const legacyContext=extractAccountingContext({functionalCurrency:'SGD',transactionCurrency:'SGD',directGroups:[legacyGroup]});
  assert.equal(legacyContext.priorJournals.length,1,
    'legacy deterministic and status-less journals remain readable when no commit list exists');
  assert.equal(legacyContext.actualEvents.length,1);
  assert.equal(legacyContext.outstandingBalances[0]?.remainingAmount,200);
}
const explicitLoanEvent={
  id:'committed-loan-event',transactionId:'committed-loan',type:'initial_transaction',eventDate:'24/11/2026',
  amount:200,currency:'SGD',description:'Explicitly committed intercompany loan',journalLines:loanProposal.lines,
  affectedAccounts:loanProposal.lines.map(line=>line.accountName),isHypothetical:false
};
const explicitEventContext=extractAccountingContext({
  functionalCurrency:'SGD',transactionCurrency:'SGD',committedDirectGroups:[],directGroups:[loanProposal],
  actualEvents:[explicitLoanEvent]
});
assert.deepEqual(explicitEventContext.priorJournals,[]);
assert.deepEqual(explicitEventContext.actualEvents,[explicitLoanEvent],
  'valid explicit actual events remain authoritative even beside an uncommitted proposal');
assert.equal(explicitEventContext.outstandingBalances[0]?.remainingAmount,200);

const understanding = defaultTransactionUnderstandingService.understandTransactionSync(
  resignationQuery, 'SGD', 'SG', extractAccountingContext(initial)
);
assert.notEqual(understanding.followUpAnalysis?.eventType, 'settlement',
  'payroll is not a payment action');
const invalidAiRoute = validateAndNormalizeUnderstanding({
  ...understanding,
  followUpAnalysis: { eventType: 'settlement', isFollowUp: true, isHypothetical: true }
}, 'SG', 'ai', extractAccountingContext(initial), resignationQuery);
assert.equal(invalidAiRoute.isValid, false, 'an AI settlement label requires payment evidence in the query');

const followUp = await processAccountingQuery(resignationQuery, initial, 'SFRS_I');
const state = followUp.scenarioState;
assert.equal(state.scenarioType, 'PAYROLL_CPF_SALARY');
assert.equal(state.amount, 30000);
assert.equal(state.isHypothetical, true);
assert.equal(state.committedDirectGroups?.length, 1);
assert.equal(state.projectedGroups?.length, 1);
assert.equal(state.projectedGroups?.[0]?.isBalanced, true);
assert.equal(state.directGroups?.length, 2);
assert.equal(state.committedDirectGroups?.[0]?.totalDebit, initial.directGroups?.[0]?.totalDebit,
  'original payroll journal remains unchanged');
const committedJournal = updateCommittedJournalScenario(null, initial, 'SFRS_I');
assert.ok(committedJournal, 'the completed payroll produces a committed journal snapshot');
const journalAfterProjection = updateCommittedJournalScenario(committedJournal, state, 'SFRS_I');
assert.equal(journalAfterProjection?.amount, initial.amount,
  'a what-if result cannot replace actual payroll facts in the committed snapshot');
assert.deepEqual(journalAfterProjection?.directGroups, committedJournal.directGroups,
  'a what-if result cannot replace the committed journal lines');
assert.equal(journalAfterProjection?.directGroups?.some(group => group.isHypothetical), false,
  'the committed journal contains actual groups only');
const projectedJournalMarkup = renderToStaticMarkup(React.createElement(JournalTable, {
  groups: state.directGroups || [], standard: 'SFRS_I', functionalCurrency: state.functionalCurrency
}));
assert.match(projectedJournalMarkup, /Hypothetical projection/,
  'the current what-if journal visibly identifies its projected group as hypothetical');

const missingDate = await processAccountingQuery(
  'what if the employee resigned; can you calculate prorated payroll and CPF?', initial, 'SFRS_I'
);
assert.equal(missingDate.scenarioState.missingFields?.[0]?.fieldKey, 'resignationDate');
assert.equal(missingDate.scenarioState.directGroups?.length, 0);
const resumed = await processAccountingQuery('15/10/2026', missingDate.scenarioState, 'SFRS_I');
assert.equal(resumed.scenarioState.amount, 30000);
assert.equal(resumed.scenarioState.projectedGroups?.length, 1);
assert.equal(resumed.scenarioState.committedDirectGroups?.length, 1);

const invalidDate = await processAccountingQuery(
  'what if the employee resigned on 31/02/2026; calculate prorated payroll', initial, 'SFRS_I'
);
assert.equal(invalidDate.scenarioState.missingFields?.[0]?.fieldKey, 'resignationDate');
assert.equal(invalidDate.scenarioState.committedDirectGroups?.length, 1);
const correctedDate = await processAccountingQuery('15/10/2026', invalidDate.scenarioState, 'SFRS_I');
assert.equal(correctedDate.scenarioState.amount, 30000);
assert.equal(correctedDate.scenarioState.committedDirectGroups?.length, 1);

const preview = createChatPreview(followUp.messageText, state);
assert.match(preview, /prorated gross salary/i);
assert.doesNotMatch(preview, /Official Statutory & Regulatory Verification Sources|Employment Act 1968 — Section 22/);
const incompleteWithBalancedJournal = {
  ...state,
  rawQuery: 'An incomplete non-IRAS accounting scenario',
  primaryDomain: 'GENERAL',
  queryIntent: 'TRANSACTION',
  isComplete: false,
  missingFields: [{ fieldKey: 'period', fieldName: 'Period', prompt: 'Which reporting period applies?', whyNeeded: 'Needed to determine the period.' }]
};
assert.match(createChatPreview('A balanced journal already exists.', incompleteWithBalancedJournal),
  /^I need one detail to continue: Which reporting period applies\?$/,
  'An incomplete non-IRAS answer asks for its missing fact before showing an existing balanced journal preview.');
const links = extractOfficialAnswerLinks(followUp.messageText);
assert.deepEqual(links, [], 'Payroll and CPF calculations remain local while their unverified statutory URLs stay unlinked.');
const citationsMarkup = renderToStaticMarkup(React.createElement(ComplianceRationale, {
  citations: [], advisories: [], standard: 'SFRS_I', officialAnswerLinks: links
}));
assert.match(citationsMarkup, /Singapore Statutes Online/,
  'The statutory panel remains available for navigation when an answer has no verified source links.');
assert.doesNotMatch(citationsMarkup, /Official links supplied with this answer|Employment Act 1968 — Section 22/,
  'The citations panel does not invent an answer-specific link when no URL has verified provenance.');

const factsMarkup = renderToStaticMarkup(React.createElement(InputHandlerPanel, {
  scenario: state, onResetToDefaults: () => {}
}));
assert.match(factsMarkup, /Show facts/);
assert.match(factsMarkup, /aria-expanded="false"/);
assert.doesNotMatch(factsMarkup, /Basic Monthly Salary/,
  'facts grid is hidden until the user expands it');

console.log('✓ conversational payroll routing, clarification, projection, compact chat, source retention, and collapsed facts passed');
