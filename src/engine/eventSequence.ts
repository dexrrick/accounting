import type { AccountingEventSequence, AccountingStandard, ExtractedEvidence, JournalEntryGroup, JournalLine, MissingFieldInfo, NormalizedAccountingEvent } from '../types/accounting';
import { formatSingaporeDate } from '../utils/dateUtils';
import { getCitation } from '../standards/standardsKnowledge';

const money = (value: string): number | undefined => {
  const parsed = Number(value.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
const dateFrom = (value: string): string | undefined => value.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/)?.[0];
const amountFrom = (value: string): number | undefined => money(value.match(/(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1] || '');
const evidence = (field: string, value: string | number): ExtractedEvidence[] => [{ source: 'user_text', field, value, confidence: 0.95 }];

/** Extracts an ordered factual ledger; it does not decide accounting treatment. */
export function extractEventSequence(text: string): AccountingEventSequence | undefined {
  const clauses = text.split(/(?:\r?\n|;|(?<=\.)\s+(?=(?:on\s+)?\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b))/).map(x => x.trim()).filter(Boolean);
  const events: NormalizedAccountingEvent[] = [];
  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    let type: NormalizedAccountingEvent['type'] | undefined;
    if (/\b(return(?:ed)?|purchase return)\b/.test(lower)) type = 'purchase_return';
    else if (/\b(settle[ds]?|paid|payment)\b/.test(lower) && /supplier|payable|invoice|purchase/.test(lower)) type = 'supplier_settlement';
    else if (/\b(discount|rebate)\b/.test(lower)) type = 'purchase_discount';
    else if (/\b(purchased?|bought|acquired)\b/.test(lower)) type = 'purchase';
    if (!type) continue;
    const amount = amountFrom(clause);
    const priorPurchase = [...events].reverse().find(event => event.type === 'purchase');
    const uncertainties: MissingFieldInfo[] = [];
    if (!amount) uncertainties.push({ fieldKey: 'amount', fieldName: 'Amount', prompt: `What is the amount for this ${type.replace('_', ' ')} event?`, whyNeeded: 'A measured amount is required before a balanced journal can be prepared.' });
    if (type !== 'purchase' && !priorPurchase) uncertainties.push({ fieldKey: 'relatedEvent', fieldName: 'Related transaction', prompt: `Which original purchase does this ${type.replace('_', ' ')} relate to?`, whyNeeded: 'The outstanding payable and inventory balance must be reconciled before posting.' });
    const id = `event-${events.length + 1}`;
    events.push({ id, date: dateFrom(clause), type, lifecycle: 'actual', description: clause, currency: /\bUSD\b/i.test(clause) ? 'USD' : 'SGD', amount, relatesTo: priorPurchase && type !== 'purchase' ? [priorPurchase.id] : [], evidence: evidence('eventText', clause), uncertainties });
  }
  return events.length >= 2 ? { events, source: 'user_text' } : undefined;
}

const line = (id: string, accountName: string, category: JournalLine['category'], debit: number, credit: number, explanation: string): JournalLine => ({ id, accountCode: 'SEQ', accountName, category, debit, credit, lineExplanation: explanation });
const group = (event: NormalizedAccountingEvent, title: string, lines: JournalLine[], summary: string, standard: AccountingStandard): JournalEntryGroup => {
  const totalDebit = lines.reduce((sum, item) => sum + item.debit, 0);
  const totalCredit = lines.reduce((sum, item) => sum + item.credit, 0);
  return { id: `journal-${event.id}`, accountingEventId: event.id, relatedEventIds: event.relatesTo, eventDate: event.date || formatSingaporeDate(new Date()), title, summary, lines, totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 0.005, citations: [getCitation('SFRS_I_1_2_INVENTORIES', standard)], rationalePoints: ['Generated from normalized event facts; linked balances were deterministically reconciled.'], authorityStatus: 'DETERMINISTIC' };
};

/** Resolves only the initial inventory purchase lifecycle. Other event types remain facts until their owning engines are connected. */
export function resolveInventoryEventSequence(sequence: AccountingEventSequence, standard: AccountingStandard = 'SFRS_I'): { groups: JournalEntryGroup[]; clarifications: MissingFieldInfo[] } {
  let payable = 0;
  const groups: JournalEntryGroup[] = [];
  const clarifications: MissingFieldInfo[] = [];
  for (const event of sequence.events) {
    if (event.uncertainties.length) { clarifications.push(...event.uncertainties); continue; }
    const amount = event.amount!;
    if (event.currency !== 'SGD') { clarifications.push({ fieldKey: 'fxRate', fieldName: 'Transaction-date FX rate', prompt: `Please provide the SGD transaction-date rate for ${event.id}.`, whyNeeded: 'Foreign-currency amounts must be measured before the payable can be reconciled.' }); continue; }
    if (event.type === 'purchase') { payable += amount; groups.push(group(event, 'Inventory purchase on credit', [line(`${event.id}-1`, 'Inventory', 'ASSET', amount, 0, 'Inventory acquired.'), line(`${event.id}-2`, 'Accounts Payable', 'LIABILITY', 0, amount, 'Supplier obligation recognised.')], event.description, standard)); }
    else if (event.type === 'purchase_return') {
      if (amount > payable) { clarifications.push({ fieldKey: 'returnAmount', fieldName: 'Return amount', prompt: `The return for ${event.id} exceeds the linked outstanding payable of SGD ${payable.toFixed(2)}. Please confirm the original purchase or amount.`, whyNeeded: 'A return cannot derecognise more than the linked purchase balance.' }); continue; }
      payable -= amount; groups.push(group(event, 'Return of inventory to supplier', [line(`${event.id}-1`, 'Accounts Payable', 'LIABILITY', amount, 0, 'Supplier obligation reduced.'), line(`${event.id}-2`, 'Inventory', 'ASSET', 0, amount, 'Returned inventory derecognised.')], event.description, standard));
    } else if (event.type === 'supplier_settlement') {
      if (amount > payable) { clarifications.push({ fieldKey: 'settlementAmount', fieldName: 'Settlement amount', prompt: `The settlement for ${event.id} exceeds the linked outstanding payable of SGD ${payable.toFixed(2)}. Please confirm the payment allocation.`, whyNeeded: 'A payable cannot be settled beyond its outstanding balance.' }); continue; }
      payable -= amount; groups.push(group(event, 'Settlement of supplier payable', [line(`${event.id}-1`, 'Accounts Payable', 'LIABILITY', amount, 0, 'Supplier obligation settled.'), line(`${event.id}-2`, 'Cash at Bank', 'ASSET', 0, amount, 'Payment to supplier.')], event.description, standard));
    }
  }
  return { groups, clarifications };
}
