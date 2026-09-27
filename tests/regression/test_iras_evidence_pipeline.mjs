import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { evaluateEvidenceQuality } from '../../src/retrieval/evidenceQualityGate.ts';
import { formatGroundedSystemPrompt, postProcessAIResponse, buildGroundedReasoningContext } from '../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse, usesIrasEvidencePolicy } from '../../src/services/irasEvidencePolicy.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';
import { IRAS_SOURCE_MAP_DEFINITIONS } from '../../src/standards/coverageRegistry.ts';

const fixture = JSON.parse(await readFile(new URL('../evaluation/singapore/iras-answer-e2e.json', import.meta.url), 'utf8'));
const datedCase = fixture.cases.find(item => item.id === 'gst-historical-standard-rated-supply-2023');
const query = datedCase.question;
const classification = classifyQuestion(query);
const rate = UNIFIED_SOURCE_REGISTRY.GST_RATE_8_PERCENT_2023;
const timing = UNIFIED_SOURCE_REGISTRY.GST_SEC11_TIME_OF_SUPPLY;
const evidenceQuality = evaluateEvidenceQuality({query, topicIds: classification.topicIds, records:[rate,timing], missingFacts:[]});
assert.ok(evidenceQuality.eligibleRecords.some(record => record.id === rate.id));
const context = { classification, userFacts:[query], missingFacts:[], assumptions:[], primaryEvidence:[rate,timing], officialGuidance:[], curatedSummaries:[], applicationRules:[], currentInformationRequired:false, evidenceQuality };
assert.ok(!/[.!?]$/.test(rate.sourceText.trim()), 'Reviewed historical rate text is a complete local source record without sentence punctuation.');
const localRateFallback = renderIrasEvidenceResponse({}, context, query, null, 'SFRS_I', 'LOCAL');
assert.ok(localRateFallback.claimVerification.accepted.some(claim => claim.recordId === rate.id && claim.text === rate.sourceText),
  'The live-page prose filter must not suppress an exact reviewed local rate source.');
const dated2024Case = fixture.cases.find(item => item.id === 'gst-historical-standard-rated-supply-2024');
const rate2024 = UNIFIED_SOURCE_REGISTRY.GST_RATE_9_PERCENT;
const classification2024 = classifyQuestion(dated2024Case.question);
assert.ok(rate2024.sourceText.length < 40 && !/[.!?]$/.test(rate2024.sourceText.trim()),
  'The current reviewed 9% rate source is short and has no terminal punctuation.');
const evidenceQuality2024 = evaluateEvidenceQuality({
  query: dated2024Case.question, topicIds: classification2024.topicIds, records: [rate2024], missingFacts: []
});
assert.ok(evidenceQuality2024.eligibleRecords.some(record => record.id === rate2024.id));
const context2024 = {
  ...context, classification: classification2024, userFacts: [dated2024Case.question],
  primaryEvidence: [rate2024], evidenceQuality: evidenceQuality2024
};
const localRate2024Fallback = renderIrasEvidenceResponse({}, context2024, dated2024Case.question, null, 'SFRS_I', 'LOCAL');
assert.ok(localRate2024Fallback.claimVerification.accepted.some(claim => claim.recordId === rate2024.id && claim.text === rate2024.sourceText),
  'The exact short 9% local rate source remains selectable and verifiable in source-only fallback.');
assert.ok(usesIrasEvidencePolicy({...classification,authorities:['IRAS','MAS'],domains:['IRAS_CORPORATE_TAX','MAS_FUNDS']},'Can this fund claim a Singapore income tax exemption?'));
assert.ok(usesIrasEvidencePolicy({...classification,authorities:['ACRA'],domains:['ACRA_COMPANIES']},'Can we claim GST on this expense?'),'Explicit tax question fails closed even when classification is incomplete');
assert.equal(usesIrasEvidencePolicy({...classification,authorities:['MOM'],domains:['MOM_EMPLOYMENT']},'What is annual leave entitlement?'),false);
for (const item of fixture.cases) assert.ok(usesIrasEvidencePolicy(classifyQuestion(item.question),item.question),item.id);
for (const narrative of [
  'what if the employee resigned; can you calculate prorated payroll and CPF?',
  'Prepare journal entries for equipment purchased at SGD 200 plus stated 9% GST.',
  'Assume all investments are exempt or out of scope for GST. Prepare all journal entries.'
]) assert.equal(usesIrasEvidencePolicy(classifyQuestion(narrative),narrative),false,'Stated facts do not request new tax advice');
assert.ok(classifyQuestion('A company supplies consulting services overseas. Is the income zero-rated or out of scope?').missingFacts.some(fact=>/customer|service category/i.test(fact)),
  'Overseas-services eligibility must ask for contractual and customer facts even without the word GST.');
assert.ok(classifyQuestion('Can Section 13W apply to a preference-share disposal by our group?').missingFacts.some(fact=>/share|holding|group/i.test(fact)),
  'Section 13W cannot be applied from share labels and an unspecified group holding alone.');
assert.ok(classifyQuestion('Can we use Form C-S (Lite) if we claim a foreign tax credit?').missingFacts.some(fact=>/eligibility conditions/i.test(fact)),
  'A conditional Form C-S (Lite) question must retain the required return eligibility facts.');
assert.ok(classifyQuestion('Can the company use prior-year losses?').missingFacts.some(fact=>/trade loss|capital allowance/i.test(fact)),
  'Loss carry-forward assessment must distinguish the nature of the unutilised item.');
assert.ok(classifyQuestion('What Section 14N options apply for YA 2026 to our refurbishment costs?').missingFacts.some(fact=>/commencement/i.test(fact)),
  'A later-period Section 14N question must not skip commencement facts.');
const prompt = formatGroundedSystemPrompt(context,'SFRS_I');
assert.match(prompt,/taxClaims/);
assert.match(prompt,/Do not paraphrase tax rules/);
assert.doesNotMatch(prompt,/General model knowledge may be used/);

// Correct URL + shared vocabulary does not validate an altered tax proposition.
const bad = postProcessAIResponse({taxClaims:[{text:'Output GST is 15%.',quote:rate.sourceText,recordId:rate.id,kind:'RULE'}],directAnswer:'15% applies.',effectiveDateOrTiming:'17%; 30 November',statuteReferences:[{standard:'VCCA2018'}]},null,query,context);
assert.doesNotMatch(JSON.stringify(bad.scenarioState),/15%|17%|30 November|VCCA/);
assert.doesNotMatch(bad.messageText,/15%|17%|30 November|VCCA/);
assert.equal(bad.answerPath,'PROVIDER_CLAIMS_REJECTED');
assert.ok(!bad.claimVerification.accepted.some(claim => /15%|17%|30 November|VCCA/.test(claim.text)),
  'Source-only fallback cannot admit an unsupported provider proposition.');
const good = postProcessAIResponse({taxClaims:[{text:rate.sourceText,quote:rate.sourceText,recordId:rate.id,kind:'RULE'}]},null,query,context);
assert.match(good.messageText,/8%/);
assert.match(good.messageText,/Goods and Services Tax Act 1993/);
assert.doesNotMatch(good.messageText,/Income Tax Act/);
assert.doesNotMatch(good.messageText,/\]\(<https:/,
  'Validated local evidence remains usable while its unverified URL is omitted from clickable output.');
assert.equal(good.calculation.verification,'DETERMINISTIC_SOURCE_BACKED_CALCULATION');
assert.equal(good.calculation.outputTax,80,'Calculation comes from dated evidence and explicit facts, not model arithmetic');
const verifiedRate = {
  ...rate,
  urlVerificationStatus:'VERIFIED',
  urlVerifiedDate:'2026-09-26',
  urlVerificationMethod:'TESTED_EXACT_SOURCE_MAP_MATCH'
};
const verifiedUrlContext = {
  ...context,
  primaryEvidence:[verifiedRate,timing],
  evidenceQuality:{...evidenceQuality,eligibleRecords:[verifiedRate,timing]}
};
const linkedEvidence = renderIrasEvidenceResponse({},verifiedUrlContext,query,null,'SFRS_I','LOCAL');
assert.ok(linkedEvidence.messageText.includes(`(<${verifiedRate.canonicalSourceUrl}>)`),
  'A separately verified exact URL is available for clickable source rendering.');
const unrelatedFact=renderIrasEvidenceResponse({}, {...context,missingFacts:['Useful life for the separate equipment purchase']},query,null,'SFRS_I','LOCAL');
assert.equal(unrelatedFact.calculation.outputTax,80,'An unrelated accounting fact must not suppress an established GST calculation');
assert.equal(unrelatedFact.scenarioState.isComplete,false);
const unresolvedGst=renderIrasEvidenceResponse({}, {...context,missingFacts:['GST registration status']},query,null,'SFRS_I','LOCAL');
assert.equal(unresolvedGst.calculation,undefined,'Unresolved GST facts still block the calculation');

// The same missing-fact boundary applies across topics, not only meals.
for (const id of ['gst-invoice-december-2022-payment-january-2023','employer-bonus-reporting-timing','cit-prior-year-loss-carry-forward']) {
  const item=fixture.cases.find(row=>row.id===id); const cl=classifyQuestion(item.question);
  const scoped={...context,classification:cl,missingFacts:cl.missingFacts,evidenceQuality:{...evidenceQuality,missingFacts:cl.missingFacts,status:'LIMITED'}};
  const response=postProcessAIResponse({taxClaims:[{text:rate.sourceText,quote:rate.sourceText,recordId:rate.id,kind:'APPLICATION'}],directAnswer:'Yes, all conditions are met.'},null,item.question,scoped);
  assert.doesNotMatch(response.messageText,/all conditions are met/);
  assert.deepEqual(response.scenarioState.missingFacts,cl.missingFacts);
  assert.equal(response.scenarioState.isComplete,false);
}

// Mixed answers retain accounting and balanced engine journals, without accepting tax metadata.
const mixedQuery='We paid SGD 200 for a customer lunch. What is the accounting entry, and can we claim the GST?';
const mixedClassification=classifyQuestion(mixedQuery);
const mixedContext={...context,classification:mixedClassification,userFacts:[mixedQuery],missingFacts:['GST registration status'],evidenceQuality:{...evidenceQuality,status:'LIMITED',missingFacts:['GST registration status']}};
const journal={id:'meal',eventDate:'26/09/2026',title:'Customer lunch',summary:'Paid lunch',lines:[{id:'a',accountCode:'5000',accountName:'Entertainment Expense',category:'EXPENSE',debit:200,credit:0,lineExplanation:''},{id:'b',accountCode:'1000',accountName:'Cash',category:'ASSET',debit:0,credit:200,lineExplanation:''}],totalDebit:200,totalCredit:200,isBalanced:true,citations:[],rationalePoints:[]};
const scenario={scenarioType:'OPERATING_EXPENSE',rawQuery:mixedQuery,transactionTitle:'Customer lunch',functionalCurrency:'SGD',transactionCurrency:'SGD',directGroups:[journal],isComplete:true};
const mixed=renderIrasEvidenceResponse({treatment:'Recognize the customer lunch as an operating expense. GST is always claimable.',taxClaims:[],effectiveDateOrTiming:'30 November'},mixedContext,mixedQuery,scenario);
assert.match(mixed.messageText,/operating expense/);
assert.doesNotMatch(mixed.messageText,/always claimable|30 November/);
assert.deepEqual(mixed.scenarioState.directGroups[0].lines.map(line=>[line.accountName,line.debit,line.credit]),journal.lines.map(line=>[line.accountName,line.debit,line.credit]));
const actualMixedContext=await buildGroundedReasoningContext(mixedQuery,null,{
  retrieveSources:async()=>[],getSourceById:()=>undefined,findSourcesByStandardOrAct:()=>[]
},undefined,{discoveryAdapter:{discoverOfficialSourceCandidates:async()=>[]}});
const proposedAccounting=renderIrasEvidenceResponse({
  treatment:'Entertainment is an operating expense, recorded at the total amount paid including GST if claimable.',
  requiredAccounts:[
    {accountName:'Entertainment Expense',category:'EXPENSE',debitCredit:'DEBIT',rationale:'Customer lunch expense'},
    {accountName:'Cash / Bank / Accounts Payable',category:'ASSET',debitCredit:'CREDIT',rationale:'Paid in cash'}
  ],taxClaims:[]
},actualMixedContext,mixedQuery,await parseAccountingQuery(mixedQuery));
assert.match(proposedAccounting.messageText,/operating expense/i);
assert.doesNotMatch(proposedAccounting.messageText,/always claimable/i);
assert.equal(proposedAccounting.scenarioState.directGroups[0]?.totalDebit,200,
  'The existing assembler may retain a balanced accounting proposal while rejecting an unsupported GST claim.');
assert.equal(proposedAccounting.scenarioState.directGroups[0]?.totalCredit,200);
assert.ok(!proposedAccounting.scenarioState.directGroups[0]?.lines.some(line=>/accounts payable/i.test(line.accountName)),
  'A completed payment must not retain a model-proposed payable alternative.');
const inventedJournal=renderIrasEvidenceResponse({directGroups:[{...journal,lines:journal.lines.map(line=>({...line,debit:line.debit?999:0,credit:line.credit?999:0})),totalDebit:999,totalCredit:999}]},mixedContext,mixedQuery,null);
assert.ok(!inventedJournal.scenarioState.directGroups.some(group=>group.lines.some(line=>line.debit===999||line.credit===999)),'Balance alone cannot validate model-generated monetary amounts');

// Local sufficient evidence resolves before any provider or network call, even with a configured provider.
const originalFetch=globalThis.fetch;
let fetchCalls=0;
globalThis.fetch=async()=>{fetchCalls++;throw new Error('No network permitted in local-first regression');};
try {
  const local=await processAccountingQuery(query,null,'SFRS_I',{activeProvider:'gemini',gemini:{apiKey:'non-secret-test-placeholder',model:'gemini-3.5-flash-lite'}});
  assert.equal(fetchCalls,0,'Local answer must precede Gemini semantic extraction and source retrieval');
  assert.match(local.messageText,/8%/);
  assert.doesNotMatch(local.messageText,/Income Tax Act|Offline Mode/);
  let gateObserved=false;
  globalThis.fetch=async(input)=>{
    if(String(input).includes('generativelanguage.googleapis.com')) assert.ok(gateObserved,'Mixed journal requests must evaluate evidence before a provider call');
    throw new Error('No network permitted in gate-order regression');
  };
  await processAccountingQuery(mixedQuery,null,'SFRS_I',{activeProvider:'gemini',gemini:{apiKey:'non-secret-test-placeholder',model:'gemini-3.5-flash-lite'}},'gemini-3.5-flash-lite',[],{journal:true,statutory:true},{onGroundedContext:()=>{gateObserved=true;}});
  assert.ok(gateObserved,'IRAS journal early returns must also apply evidence quality and missing-fact governance');
  const insufficient=await buildGroundedReasoningContext('Can we claim GST for a customer lunch?',null,{
    retrieveSources:async()=>[],getSourceById:()=>undefined,findSourcesByStandardOrAct:()=>[]
  },undefined,{discoveryAdapter:{discoverOfficialSourceCandidates:async()=>[]}});
  assert.equal(insufficient.evidenceQuality.status,'INSUFFICIENT');
} finally {globalThis.fetch=originalFetch;}

const ir21Map = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_IR21_SOURCE_MAP');
const bonusMap = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_EMPLOYMENT_INCOME_TIMING_SOURCE_MAP');
const aisMap = IRAS_SOURCE_MAP_DEFINITIONS.find(item => item.id === 'IRAS_AIS_IR8A_SOURCE_MAP');
assert.ok(ir21Map && bonusMap && aisMap);
const ir21LeadIn = 'If tax clearance is required for your employee, you must file the Form IR21 at least one month before:';
const ir21ListItemOne = 'The employee ceases to work for you in Singapore;';
const ir21ListItemTwo = 'The employee starts an overseas posting; or';
const ir21ListItemThree = 'The employee leaves Singapore for any period exceeding three months.';
const ir21IncompleteListClaim = `${ir21LeadIn}\n\n• ${ir21ListItemOne}`;
const ir21Overview = 'Generally, when your non-Singapore Citizen employee ceases employment with you in Singapore, goes on an overseas posting or plans to leave Singapore for more than three months, you must notify IRAS at least one month in advance and withhold all monies due to the employee from the date you are aware of his impending cessation of employment or departure from Singapore.';
const ir21SpecificNoticeExample = 'Regardless of the notice period, you should start withholding monies at the point of resignation (in this scenario, 2 Mar this year). You are also required to file the Form IR21 at least one month before the employee’s employment cessation date, and report his employment income up to his last day of employment therein. Where there are adjustments to be made to the income after filing an Original Form IR21, you can file an Amended Form IR21.';
const ir21GardeningLeaveFaq = 'Yes. You should seek tax clearance for your employee at the start of the gardening leave. Where there are adjustments to be made to the income after filing an Original Form IR21, you can file an Amended Form IR21.';
const bonusExamplesLeadIn = 'A contractual bonus is paid in accordance with the terms of a contract of service and cannot be withdrawn by the employer without legal consequences. Examples of a contractual bonus are:';
const bonusExampleItemOne = '13th month payment or annual wage supplement; and';
const bonusExampleItemTwo = 'bonus paid under a "deferred bonus plan" or "retention bonus plan".';
const bonusContractual = 'For contractual bonus, you are entitled to such bonus in the year specified in the contract or bonus plan. This is usually the year in which you render service.';
const bonusContingent = "If the employer's obligation to pay bonus is contingent upon conditions to be met in the future, you will only become entitled to the bonus when these conditions are met.";
const bonusExampleTwoLeadIn = 'Employer A implemented a contractual bonus plan for its employees for the year ended 31 Dec 2024. The following conditions are set out in the employee bonus plan:';
const bonusExampleTwoItemOne = 'The bonus will be paid on 31 Mar 2025; and';
const bonusExampleTwoItemTwo = 'The bonus will not be paid to an employee who tenders his resignation before 31 Mar 2025.';
const bonusExampleTwoFacts = 'An employee, Mr Tan, gave notice of his resignation on 15 Jan 2025. Hence, he is not entitled to the bonus. The other employees are entitled to the bonus when they satisfy both conditions.';
const bonusExampleTwoConclusion = 'This contractual bonus will be taxable in Year of Assessment 2026 because the conditions were only met in 2025.';
const bonusAdvance = 'However, if such bonuses are paid in advance before the conditions are met, the bonuses are taxable at the time of payment. Subsequently, if the conditions are not met and the employee returns the bonus in full or in part, the amount returned is considered as an adjustment of income in the year the amount is returned.';
const bonusDiscretionary = 'For discretionary bonuses that subsequently become legally binding, such bonuses are taxable at the time when the employer contractually binds himself to pay the bonuses and the employees become entitled to the bonuses.';
const bonusExampleOneOutcome = 'This contractual bonus will be taxable in Year of Assessment 2026 because the bonus was paid for your services in 2025.';
const bonusExampleThreeHeading = 'Example 3: Contractual bonus paid in advance, subject to future conditions';
const bonusExampleThreeFacts = 'Employer B has an existing contract to pay their employees an inducement bonus on 1 Jan 2024, with the condition that the employee returns the sum to Employer B on a pro-rata basis if he leaves employment before 31 Dec 2026.';
const bonusExampleThreeOutcome = 'In this example, the bonus is considered part of the employee’s income for 2024 and is taxed in the Year of Assessment 2025.';
const bonusExampleThreeAdjustment = 'If the employee left the company in 2025 and returns 50% of the inducement bonus in that year, the amount returned will be deducted against his employment income earned in 2025 (i.e. Year of Assessment 2026).';
const bonusExampleFiveHeading = 'Example 5: Taxable non-contractual bonus';
const bonusExampleFiveFacts = 'Employer D informs his employees on 1 Dec 2024 of his decision to pay non-contractual bonuses for the year ending 31 Dec 2024 on 1 Feb 2025.';
const bonusExampleFiveOutcome = 'The employees become entitled to such non-contractual bonuses on 1 Feb 2025 when the bonuses are paid. The employees will be taxed in Year of Assessment 2026.';
const bonusNonContractual = 'On the other hand, non-contractual bonus means the employer can withdraw or cancel it at any time before the actual payment of the bonus without legal consequences. It is taxable when the employee becomes entitled to the payment. Generally, this bonus is taxed based on the date on which the bonus is paid.';
const ir8aDeadline = 'Employers specified under paragraph 4 of the gazette must submit their employees’ income information to IRAS electronically by 1 Mar of the year after the year the income is derived by the employee.';
const pageHtml = (title, paragraphs) => `<html><head><title>IRAS | ${title}</title></head><body><main><h1>IRAS | ${title}</h1>${paragraphs.map(text => `<p>${text}</p>`).join('')}</main></body></html>`;
let ir21SourceRecordId = '';
let ir21GroundedContext;

// A provider HTTP 200 with no Gemini candidate is a provider failure, not an
// evidence failure. The application shows only bounded, verified source
// paragraphs and keeps the missing IR21 facts visible.
globalThis.fetch = async input => {
  const url = String(input);
  if (url === ir21Map.canonicalSourceUrl) {
  const ir21Html = `<html><head><title>IRAS | ${ir21Map.pageTitle}</title></head><body><main>
      <h1>IRAS | ${ir21Map.pageTitle}</h1><p>Share:</p><ul><li>•</li></ul><p>${ir21Overview}</p><p>On this page:</p><h2>When is Tax Clearance Not Required</h2>
      <p>When to File the Form IR21</p><p>${ir21LeadIn}</p><ul><li><p>${ir21ListItemOne}</p></li><li><p>${ir21ListItemTwo}</p></li><li><p>${ir21ListItemThree}</p></li></ul>
      <p>${ir21SpecificNoticeExample}</p><p>${ir21GardeningLeaveFaq}</p>
      </main></body></html>`;
    return new Response(ir21Html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  if (url.includes('streamGenerateContent')) {
    const incompleteClaim = { text: ir21IncompleteListClaim, quote: ir21IncompleteListClaim, recordId: ir21SourceRecordId, kind: 'RULE' };
    const event = { candidates: [{ content: { parts: [{ text: JSON.stringify({ taxClaims: [incompleteClaim] }) }] } }] };
    return new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  throw new Error(`Unexpected provider or source request: ${url}`);
};
try {
  const ir21Fallback = await processAccountingQuery('When do we need to file IR21?', null, 'SFRS_I', {
    activeProvider: 'gemini',
    gemini: { apiKey: 'test-placeholder-key', model: 'gemini-3.5-flash-lite' }
  }, undefined, [], undefined, { onGroundedContext: ctx => {
    ir21GroundedContext = ctx;
    ir21SourceRecordId = ctx.evidenceQuality.eligibleRecords.find(record => record.provenance === 'LIVE_EXTERNAL').id;
  } });
  assert.equal(ir21Fallback.providerStatus, 'SUCCEEDED');
  assert.equal(ir21Fallback.answerPath, 'PROVIDER_CLAIMS_REJECTED');
  assert.equal(ir21Fallback.evidenceQuality.status, 'LIMITED', 'Evidence coverage is reported independently from provider failure.');
  assert.ok(ir21Fallback.claimVerification.accepted.some(claim => claim.text === ir21Overview));
  assert.ok(ir21Fallback.claimVerification.rejected.some(claim => claim.text === ir21IncompleteListClaim && claim.reason === 'QUOTE_NOT_WHOLE_SENTENCE_OR_PARAGRAPH'),
    'A provider quote that combines the IR21 lead-in with only one list item remains rejected.');
  assert.ok(!ir21Fallback.claimVerification.accepted.some(claim => claim.text === ir21LeadIn));
  assert.ok(!ir21Fallback.claimVerification.accepted.some(claim => [ir21ListItemOne, ir21ListItemTwo, ir21ListItemThree].includes(claim.text)),
    'Neither parent nor nested list items are promoted as standalone rules after a colon-ended lead-in.');
  assert.match(ir21Fallback.messageText, /provider claims did not pass verification/i);
  assert.match(ir21Fallback.messageText, /at least one month in advance/);
  assert.doesNotMatch(ir21Fallback.messageText, /at least one month before:/i, 'A colon-ended lead-in is not shown without its complete list.');
  assert.doesNotMatch(ir21Fallback.messageText, /The employee ceases to work for you in Singapore|The employee starts an overseas posting|The employee leaves Singapore for any period exceeding three months/i,
    'No parent or nested IR21 list item is presented without its lead-in and full list.');
  assert.ok(!ir21Fallback.claimVerification.accepted.some(claim => [ir21SpecificNoticeExample, ir21GardeningLeaveFaq].includes(claim.text)),
    'Dated FAQ and gardening-leave examples do not qualify as general IR21 source fallback.');
  assert.match(ir21Fallback.messageText, /Employee citizenship or permanent-resident status/);
  assert.doesNotMatch(ir21Fallback.messageText, /IR21 is always required/i);

  const ir21LiveRecord = ir21GroundedContext.evidenceQuality.eligibleRecords.find(record => record.id === ir21SourceRecordId);
  const unknownColonRecord = {
    ...ir21LiveRecord,
    tags: ir21LiveRecord.tags.filter(tag => tag !== 'iras-employer-ir21'),
    sourceText: `Unrecognized section:\n\n${ir21Overview}`
  };
  const unknownColonContext = {
    ...ir21GroundedContext,
    evidenceQuality: { ...ir21GroundedContext.evidenceQuality, eligibleRecords: [unknownColonRecord] }
  };
  const unknownColonFallback = renderIrasEvidenceResponse({ taxClaims: [] }, unknownColonContext,
    'When do we need to file IR21?', null, 'SFRS_I', 'PROVIDER');
  assert.equal(unknownColonFallback.claimVerification.accepted.length, 0,
    'An unknown colon-ended introduction still stops fallback before later prose when no visible list follows.');
  assert.doesNotMatch(unknownColonFallback.messageText, /Generally, when your non-Singapore Citizen employee/i);
  const unanchoredTopicRecord = { ...ir21LiveRecord, sourceText: 'A separately dated IR21 FAQ says to withhold at the point of resignation on 2 Mar this year.' };
  const unanchoredTopicContext = {
    ...ir21GroundedContext,
    evidenceQuality: { ...ir21GroundedContext.evidenceQuality, eligibleRecords: [unanchoredTopicRecord] }
  };
  const unanchoredTopicFallback = renderIrasEvidenceResponse({ taxClaims: [] }, unanchoredTopicContext,
    'When do we need to file IR21?', null, 'SFRS_I', 'PROVIDER');
  assert.equal(unanchoredTopicFallback.claimVerification.accepted.length, 0,
    'IR21 source text without the general opening anchor fails closed even when it contains relevant terms.');

  // A successful provider response with an empty taxClaims array uses the
  // same exact-quotation fallback for the mapped bonus and IR8A pages. It
  // retains the source's distinct bonus timing passages and missing facts.
  const bonusQuestion = 'Employee received a bonus in April for June payroll. When should it be reported?';
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === bonusMap.canonicalSourceUrl) {
      const bonusHtml = `<html><head><title>IRAS | ${bonusMap.pageTitle}</title></head><body><main>
        <h1>IRAS | ${bonusMap.pageTitle}</h1><p>Share:</p><ul><li>•</li></ul><p>On this page:</p>
        <p>Taxes on bonuses</p><p>The bonus you have received from your employment is taxable. Bonuses may be contractual or non-contractual.</p>
        <p>A. Contractual bonus</p><p>${bonusExamplesLeadIn}</p><ul><li><p>${bonusExampleItemOne}</p></li><li><p>${bonusExampleItemTwo}</p></li></ul>
        <p>${bonusContractual}</p><p>Example 1: Taxable contractual bonus</p>
        <p>You receive a contractual bonus (e.g. 13th-month bonus) for the year ended 31 Dec 2025 as stated in your employment contract, which is paid in Feb 2026.</p>
        <p>This contractual bonus will be taxable in Year of Assessment 2026 because the bonus was paid for your services in 2025.</p>
        <p>${bonusContingent}</p><p>Example 2: Contractual bonus contingent upon future conditions</p><p>${bonusExampleTwoLeadIn}</p>
        <ul><li><p>${bonusExampleTwoItemOne}</p></li><li><p>${bonusExampleTwoItemTwo}</p></li></ul><p>${bonusExampleTwoFacts}</p>
        <p>${bonusExampleTwoConclusion}</p><p>${bonusAdvance}</p>
        <p>${bonusExampleThreeHeading}</p><p>${bonusExampleThreeFacts}</p><p>${bonusExampleThreeOutcome}</p><p>${bonusExampleThreeAdjustment}</p>
        <p>${bonusDiscretionary}</p><p>Example 4: Discretionary bonus that subsequently becomes legally binding</p>
        <p>Employer C has no legal obligation to pay bonuses for 2024. On 31 Jan 2025, the employer legally binds itself to pay a bonus within 60 days from 31 Dec 2024.</p>
        <p>In this example, the bonus is the employees’ income for 2025 and is taxed in Year of Assessment 2026.</p>
        <p>B. Non-contractual bonus</p><p>${bonusNonContractual}</p><p>${bonusExampleFiveHeading}</p><p>${bonusExampleFiveFacts}</p><p>${bonusExampleFiveOutcome}</p>
        </main></body></html>`;
      return new Response(bonusHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url === aisMap.canonicalSourceUrl) {
      return new Response(pageHtml(aisMap.pageTitle, [
        'Auto-Inclusion Scheme (AIS) for Employment Income', ir8aDeadline
      ]), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.includes('streamGenerateContent')) {
      const event = { candidates: [{ content: { parts: [{ text: JSON.stringify({ taxClaims: [] }) }] } }] };
      return new Response(`data: ${JSON.stringify(event)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    throw new Error(`Unexpected provider or source request: ${url}`);
  };
  const bonusFallback = await processAccountingQuery(bonusQuestion, null, 'SFRS_I', {
    activeProvider: 'gemini',
    gemini: { apiKey: 'test-placeholder-key', model: 'gemini-3.5-flash-lite' }
  });
  assert.equal(bonusFallback.providerStatus, 'SUCCEEDED');
  assert.equal(bonusFallback.answerPath, 'PROVIDER_NO_CLAIMS');
  const acceptedBonusClaims = bonusFallback.claimVerification.accepted.map(claim => claim.text);
  const completeExampleAndAdvance = `${bonusExampleTwoConclusion} ${bonusAdvance}`;
  for (const rule of [bonusContractual, bonusContingent, bonusDiscretionary, bonusNonContractual, ir8aDeadline]) {
    assert.ok(acceptedBonusClaims.includes(rule), `The exact fetched source paragraph is admitted: ${rule.slice(0, 64)}`);
  }
  const rejectedExampleSpans = [bonusExamplesLeadIn, bonusExampleOneOutcome, ...[bonusExampleItemOne, bonusExampleItemTwo, bonusExampleTwoItemOne, bonusExampleTwoItemTwo],
    bonusExampleTwoFacts, bonusExampleTwoConclusion, bonusAdvance, completeExampleAndAdvance, bonusExampleThreeFacts,
    bonusExampleThreeOutcome, bonusExampleThreeAdjustment, bonusExampleFiveFacts, bonusExampleFiveOutcome];
  assert.ok(!acceptedBonusClaims.some(claim => rejectedExampleSpans.some(example => claim.includes(example))),
    'List entries, dated YA outcomes, example facts, and an advance qualification attached to an example outcome are omitted.');
  assert.ok(!acceptedBonusClaims.includes(`${bonusContractual} ${bonusContingent}`),
    'Separate general source paragraphs are not reconstructed across intervening examples.');
  assert.match(bonusFallback.messageText, /contractual bonus/i);
  assert.match(bonusFallback.messageText, /non-contractual bonus/i);
  assert.doesNotMatch(bonusFallback.messageText, /paid in advance/i,
    'The advance qualification attached to an example-specific YA outcome is not detached into a general rule.');
  assert.match(bonusFallback.messageText, /no verifiable tax claims/i);
  for (const missingFact of classifyQuestion(bonusQuestion).missingFacts) {
    assert.ok(bonusFallback.scenarioState.missingFacts.includes(missingFact));
  }
  assert.ok(!bonusFallback.messageText.includes('The June payroll determines the taxable year'),
    'The response does not infer timing from payroll labels or missing dates.');
} finally {globalThis.fetch=originalFetch;}

console.log('IRAS evidence policy pipeline regressions passed.');
