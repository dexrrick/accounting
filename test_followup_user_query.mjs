import { processAccountingQuery } from './src/services/geminiService.ts';

async function main() {
  // Simulate Turn 1 result where AI provided the correct journal entry for unpaid share capital
  const r1ScenarioState = {
    scenarioType: 'UNIVERSAL',
    queryIntent: 'TRANSACTION',
    primaryDomain: 'ACCOUNTING_SFRS',
    rawQuery: "shareholder has invested in own company share capital of $1 but unpaid what's the double entry",
    transactionTitle: "Issuance of Unpaid Share Capital",
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    authorityStatus: 'AI_PROPOSED',
    amount: 1,
    isComplete: true,
    directGroups: [
      {
        id: 'grp-1',
        eventDate: '11/09/2026',
        title: 'Initial Share Capital Allotment (Unpaid)',
        summary: 'Allotment of $1 ordinary share capital unpaid',
        lines: [
          {
            id: 'l-1',
            accountCode: '1150',
            accountName: 'Amount Due from Shareholder (Receivable)',
            category: 'ASSET',
            debit: 1,
            credit: 0,
            lineExplanation: 'Allotment receivable under Companies Act §63(1)'
          },
          {
            id: 'l-2',
            accountCode: '3000',
            accountName: 'Share Capital (Ordinary Shares)',
            category: 'EQUITY',
            debit: 0,
            credit: 1,
            lineExplanation: 'Credited to share capital under Companies Act §68'
          }
        ],
        totalDebit: 1,
        totalCredit: 1,
        isBalanced: true,
        citations: [],
        rationalePoints: [],
        authorityStatus: 'AI_PROPOSED'
      }
    ],
    keyParameters: [
      { label: 'Share Capital Outlay', value: 'SGD 1.00', badge: 'Stated Fact' },
      { label: 'Payment Status', value: 'UNPAID', badge: 'Settlement' }
    ]
  };

  console.log('\n--- TESTING TURN 2 FOLLOW-UP ---');
  const q2 = "what if the shareholder did paid to company bank account what will be the journal entry";
  const r2 = await processAccountingQuery(q2, r1ScenarioState, 'SFRS_I');
  console.log('T2 ScenarioType:', r2.scenarioState.scenarioType);
  console.log('T2 DirectGroups count:', r2.scenarioState.directGroups?.length);
  console.log('T2 Lines:', JSON.stringify(r2.scenarioState.directGroups?.[0]?.lines, null, 2));
  console.log('\nT2 Message (first 600 chars):\n', r2.messageText.slice(0, 600));
}

main().catch(console.error);
