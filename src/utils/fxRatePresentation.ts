export function formatFxRateEquation(rate: number, transactionCurrency: string, functionalCurrency: string): string {
  const amount = String(rate);
  const [whole, fraction = ''] = amount.split('.');
  const displayAmount = amount.includes('e') ? amount : `${whole}.${fraction.padEnd(2, '0')}`;
  return `1 ${transactionCurrency} = ${functionalCurrency} ${displayAmount}`;
}
