import { parseAccountingQuery } from './src/engine/scenarioParser.ts';
import { buildGroundedReasoningContext } from './src/services/groundingContextBuilder.ts';
import { processAccountingQuery } from './src/services/geminiService.ts';

async function main() {
  const q = 'What are the ACRA requirements for small company audit exemption under Section 205C?';
  const parsed = await parseAccountingQuery(q);
  console.log('--- PARSED DIRECT GROUPS CITATIONS ---');
  console.log(JSON.stringify(parsed.directGroups?.map(g => g.citations), null, 2));

  const ctx = await buildGroundedReasoningContext(q);
  console.log('--- GROUNDED CONTEXT SOURCES ---');
  console.log('Primary evidence:', ctx.primaryEvidence.map(s => ({ id: s.id, standard: s.standard, paragraph: s.paragraph, url: s.officialSourceUrl })));
  console.log('Official guidance:', ctx.officialGuidance.map(s => ({ id: s.id, standard: s.standard, paragraph: s.paragraph, url: s.officialSourceUrl })));
  console.log('Curated summaries:', ctx.curatedSummaries.map(s => ({ id: s.id, standard: s.standard, paragraph: s.paragraph, url: s.officialSourceUrl })));

  const res = await processAccountingQuery(q, null, 'SFRS_I');
  console.log('--- FINAL RESPONSE CITATIONS ---');
  console.log(JSON.stringify(res.scenarioState.directGroups?.[0]?.citations, null, 2));
  console.log('--- FINAL MESSAGE TEXT ---');
  console.log(res.messageText);
}

main().catch(console.error);
