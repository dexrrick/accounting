import { readFile, writeFile } from 'node:fs/promises';
import { classifyQuestion } from 'file:///D:/Accounting/src/classification/questionClassifier.ts';
import { isAiFirstAdvisoryEligible } from 'file:///D:/Accounting/src/services/aiFirstAdvisory.ts';
const cases = JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
const provider = { activeProvider: 'gemini', gemini: { apiKey: 'diagnostic-placeholder-no-network', model: 'gemini-3.5-flash-lite' }, azure: {}, openai: {} };
const rows = cases.slice(0, 2).map(item => {
  const withoutNegativeJournalDirective = item.id === 'accounting-accrual'
    ? item.question.replace('I am not asking for a journal entry.', '')
    : item.question.replace('No journal amounts are needed.', '');
  return { caseId: item.id, variants: [item.question, withoutNegativeJournalDirective].map(question => ({
    question, classification: classifyQuestion(question),
    aiFirstEligible: isAiFirstAdvisoryEligible(question, provider, false, null, { journal: false, statutory: false })
  })) };
});
await writeFile(new URL('./routing-diagnostic.json', import.meta.url), JSON.stringify({
  scope: 'No model or network calls. Direct observation of current production classification and eligibility functions; not another answer-quality sample.', rows
}, null, 2));
console.log(JSON.stringify(rows.map(row => ({ caseId: row.caseId, variants: row.variants.map(v => ({ journalEntryRequired: v.classification.journalEntryRequired, calculationRequired: v.classification.calculationRequired, aiFirstEligible: v.aiFirstEligible })) })), null, 2));
