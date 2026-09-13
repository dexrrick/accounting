import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
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
const links = extractOfficialAnswerLinks(followUp.messageText);
assert.ok(links.length > 0, 'source links remain available outside the chat preview');
const citationsMarkup = renderToStaticMarkup(React.createElement(ComplianceRationale, {
  citations: [], advisories: [], standard: 'SFRS_I', officialAnswerLinks: links
}));
assert.ok(citationsMarkup.includes(links[0].title), 'footer-only official links appear in the citations tab');

const factsMarkup = renderToStaticMarkup(React.createElement(InputHandlerPanel, {
  scenario: state, onResetToDefaults: () => {}
}));
assert.match(factsMarkup, /Show facts/);
assert.match(factsMarkup, /aria-expanded="false"/);
assert.doesNotMatch(factsMarkup, /Basic Monthly Salary/,
  'facts grid is hidden until the user expands it');

console.log('✓ conversational payroll routing, clarification, projection, compact chat, source retention, and collapsed facts passed');
