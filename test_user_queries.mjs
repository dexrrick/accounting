import { processAccountingQuery } from './src/services/geminiService.ts';
import { parseAccountingQuery } from './src/engine/scenarioParser.ts';

async function runTests() {
  console.log('=== TEST 1: ACRA Small Company Audit Exemption ===');
  const q1 = 'What are the ACRA requirements for small company audit exemption under Section 205C?';
  const res1 = await processAccountingQuery(q1, null, 'SFRS_I');
  console.log('Q1 ScenarioType:', res1.scenarioState.scenarioType);
  console.log('Q1 AuthorityStatus:', res1.scenarioState.authorityStatus);
  console.log('Q1 DirectGroups count:', res1.scenarioState.directGroups?.length);
  console.log('Q1 Citations:', JSON.stringify(res1.scenarioState.directGroups?.[0]?.citations, null, 2));
  console.log('Q1 Statutory Advisory:', JSON.stringify(res1.scenarioState.statutoryAdvisory, null, 2));
  console.log('Q1 MessageText (first 600 chars):\n', res1.messageText.slice(0, 600));
  const ssoIdx = res1.messageText.indexOf('Official Statutory Sources');
  if (ssoIdx !== -1) {
    console.log('Q1 Official Statutory Sources section:\n', res1.messageText.slice(ssoIdx));
  }

  console.log('\n=== TEST 2: Staff salary and CPF calculation for resignation on 16/9/2026 ===');
  const q2 = `a staff is earning sgd3200 a month
he is a singaporean, 32 years old
his last day is 16/9/2026
calculate his september salary and employer employee cpf`;
  
  const parsed2 = await parseAccountingQuery(q2);
  console.log('Q2 Parsed ScenarioType:', parsed2.scenarioType);
  console.log('Q2 Parsed isComplete:', parsed2.isComplete);
  console.log('Q2 Parsed directGroups count:', parsed2.directGroups?.length);
  console.log('Q2 Parsed lines:', parsed2.directGroups?.[0]?.lines);
  console.log('Q2 Parsed keyParameters:', parsed2.keyParameters);
  console.log('Q2 Parsed missingFields:', parsed2.missingFields);

  const res2 = await processAccountingQuery(q2, null, 'SFRS_I');
  console.log('Q2 Full Response ScenarioType:', res2.scenarioState.scenarioType);
  console.log('Q2 Full Response AuthorityStatus:', res2.scenarioState.authorityStatus);
  console.log('Q2 Full Response DirectGroups:', res2.scenarioState.directGroups?.length);
  console.log('Q2 Full Response MessageText:\n', res2.messageText);
}

runTests().catch(console.error);
