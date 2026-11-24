import { removeNegatedOutputDirectives } from './journalRequestIntent';

/** Shared deterministic recognition for requested final-wage amount calculations. */
export function isFinalSalaryAmountRequest(query: string): boolean {
  const positiveIntentQuery = removeNegatedOutputDirectives(query);
  const finalPay = '(?:final|last)\\s+(?:salary|pay|wages?)';
  const amountIntent = '(?:how much|what amount|calculate|compute|estimate|work out)';
  const actionBeforeFinalPay = new RegExp('\\b' + amountIntent + '\\b[^.!?;]{0,80}\\b' + finalPay + '\\b', 'i');
  const amountAfterFinalPay = new RegExp('\\b' + finalPay + '\\b[^.!?;]{0,80}\\b(?:amount|calculate|compute|estimate|work out)\\b', 'i');
  return actionBeforeFinalPay.test(positiveIntentQuery) || amountAfterFinalPay.test(positiveIntentQuery);
}
