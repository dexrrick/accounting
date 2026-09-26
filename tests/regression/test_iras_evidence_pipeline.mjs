import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyQuestion } from '../../src/classification/questionClassifier.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { evaluateEvidenceQuality } from '../../src/retrieval/evidenceQualityGate.ts';
import { formatGroundedSystemPrompt, postProcessAIResponse, buildGroundedReasoningContext } from '../../src/services/groundingContextBuilder.ts';
import { renderIrasEvidenceResponse, usesIrasEvidencePolicy } from '../../src/services/irasEvidencePolicy.ts';
import { processAccountingQuery } from '../../src/services/geminiService.ts';
import { parseAccountingQuery } from '../../src/engine/scenarioParser.ts';

const fixture = JSON.parse(await readFile(new URL('../evaluation/singapore/iras-answer-e2e.json', import.meta.url), 'utf8'));
const datedCase = fixture.cases.find(item => item.id === 'gst-historical-standard-rated-supply-2023');
const query = datedCase.question;
const classification = classifyQuestion(query);
const rate = UNIFIED_SOURCE_REGISTRY.GST_RATE_8_PERCENT_2023;
const timing = UNIFIED_SOURCE_REGISTRY.GST_SEC11_TIME_OF_SUPPLY;
const evidenceQuality = evaluateEvidenceQuality({query, topicIds: classification.topicIds, records:[rate,timing], missingFacts:[]});
assert.ok(evidenceQuality.eligibleRecords.some(record => record.id === rate.id));
const context = { classification, userFacts:[query], missingFacts:[], assumptions:[], primaryEvidence:[rate,timing], officialGuidance:[], curatedSummaries:[], applicationRules:[], currentInformationRequired:false, evidenceQuality };
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
assert.match(bad.messageText,/No generated tax claim passed/);
const good = postProcessAIResponse({taxClaims:[{text:rate.sourceText,quote:rate.sourceText,recordId:rate.id,kind:'RULE'}]},null,query,context);
assert.match(good.messageText,/8%/);
assert.match(good.messageText,/GSTA1993/);
assert.doesNotMatch(good.messageText,/Income Tax Act/);
assert.equal(good.calculation.verification,'DETERMINISTIC_SOURCE_BACKED_CALCULATION');
assert.equal(good.calculation.outputTax,80,'Calculation comes from dated evidence and explicit facts, not model arithmetic');
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
console.log('IRAS evidence policy pipeline regressions passed.');
