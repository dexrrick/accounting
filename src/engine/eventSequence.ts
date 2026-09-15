import type { AccountingEventSequence, AccountingStandard, ExtractedEvidence, JournalEntryGroup, JournalLine, MissingFieldInfo, NormalizedAccountingEvent } from '../types/accounting';
import { formatSingaporeDate } from '../utils/dateUtils';
import { getCitation } from '../standards/standardsKnowledge';

const money = (value: string): number | undefined => {
  const parsed = Number(value.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
const dateFrom = (value: string): string | undefined => value.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i)?.[0];
const amountFrom = (value: string): number | undefined => money(value.match(/(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1] || '');
const quantityFrom = (value: string): number | undefined => money(value.match(/\b([\d,]+)\s+units?\b/i)?.[1] || '');
const rateFrom = (value: string): number | undefined => money(value.match(/(?:at|for|allowance\s+of)\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:each|per unit)?/i)?.[1] || '');
const gstRateFrom = (value: string): number | undefined => money(value.match(/\b(\d+(?:\.\d+)?)\s*%\s*GST/i)?.[1] || '');
const partyFrom = (value: string, role: 'supplier' | 'customer'): string | undefined =>
  value.match(new RegExp(`\\b${role}(?:\\s+name)?\\s+([A-Z][\\w&.' -]+?)(?=\\s+(?:at|for|on|via|,|\\.|$))`, 'i'))?.[1]?.trim();
const evidence = (field: string, value: string | number): ExtractedEvidence[] => [{ source: 'user_text', field, value, confidence: 0.95 }];

/** Extracts an ordered factual ledger; it does not decide accounting treatment. */
export function extractEventSequence(text: string): AccountingEventSequence | undefined {
  const clauses = text.split(/(?:\r?\n|;|(?<=\.)\s+(?=(?:on\s+)?\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b))/).map(x => x.trim()).filter(Boolean);
  const events: NormalizedAccountingEvent[] = [];
  const documentGstRate = gstRateFrom(text);
  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    let type: NormalizedAccountingEvent['type'] | undefined;
    if (/\b(return(?:ed)?|purchase return)\b/.test(lower)) type = 'purchase_return';
    else if (/\b(allowance|credit allowance)\b/.test(lower)) type = 'credit_note';
    else if (/\b(sold|sale)\b/.test(lower)) type = 'sale';
    else if (/\b(settle[ds]?|paid|payment)\b/.test(lower) && /supplier|payable|vendor|invoice|purchase/.test(lower)) type = 'supplier_settlement';
    else if (/\b(discount|rebate)\b/.test(lower)) type = 'purchase_discount';
    else if (/\b(purchased?|bought|acquired)\b/.test(lower)) type = 'purchase';
    if (!type) continue;
    const quantity = quantityFrom(clause);
    const unitPrice = rateFrom(clause);
    const amount = quantity && unitPrice ? quantity * unitPrice : amountFrom(clause);
    const priorRelated = [...events].reverse().find(event => event.type === 'purchase' || event.type === 'sale');
    const uncertainties: MissingFieldInfo[] = [];
    const canUseLinkedValue = type === 'purchase_return' || type === 'credit_note' || (type === 'supplier_settlement' && /full outstanding|full balance/i.test(lower));
    if (!amount && !canUseLinkedValue) uncertainties.push({ fieldKey: 'amount', fieldName: 'Amount', prompt: `What is the amount for this ${type.replace('_', ' ')} event?`, whyNeeded: 'A measured amount is required before a balanced journal can be prepared.' });
    if (type !== 'purchase' && type !== 'sale' && !priorRelated) uncertainties.push({ fieldKey: 'relatedEvent', fieldName: 'Related transaction', prompt: `Which original transaction does this ${type.replace('_', ' ')} relate to?`, whyNeeded: 'The outstanding balance must be reconciled before posting.' });
    const id = `event-${events.length + 1}`;
    events.push({ id, date: dateFrom(clause), type, lifecycle: 'actual', description: clause, parties: { supplier: partyFrom(clause, 'supplier'), customer: partyFrom(clause, 'customer') }, paymentTerms: clause.match(/\b\d+\/\d+\s*,?\s*n\/\d+\b/i)?.[0], currency: /\bUSD\b/i.test(clause) ? 'USD' : 'SGD', amount, quantity, unitPrice, tax: { rate: gstRateFrom(clause) ?? documentGstRate }, relatesTo: priorRelated && type !== 'purchase' && type !== 'sale' ? [priorRelated.id] : [], evidence: evidence('eventText', clause), uncertainties });
  }
  return events.length >= 2 ? { events, source: 'user_text' } : undefined;
}

const line = (id: string, accountName: string, category: JournalLine['category'], debit: number, credit: number, explanation: string): JournalLine => ({ id, accountCode: 'SEQ', accountName, category, debit, credit, lineExplanation: explanation });
const group = (event: NormalizedAccountingEvent, title: string, lines: JournalLine[], summary: string, standard: AccountingStandard): JournalEntryGroup => {
  const totalDebit = lines.reduce((sum, item) => sum + item.debit, 0);
  const totalCredit = lines.reduce((sum, item) => sum + item.credit, 0);
  return { id: `journal-${event.id}`, accountingEventId: event.id, relatedEventIds: event.relatesTo, eventDate: event.date || formatSingaporeDate(new Date()), title, summary, lines, totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 0.005, citations: [getCitation('SFRS_I_1_2_INVENTORIES', standard)], rationalePoints: ['Generated from normalized event facts; linked balances were deterministically reconciled.'], authorityStatus: 'DETERMINISTIC' };
};

/**
 * Resolves the reusable goods-on-credit lifecycle.  Extraction is deliberately
 * independent of this function; other event families can add their own
 * treatment without changing how facts, evidence, or relationships are read.
 */
export function resolveCommercialEventSequence(sequence: AccountingEventSequence, standard: AccountingStandard = 'SFRS_I'): { groups: JournalEntryGroup[]; clarifications: MissingFieldInfo[] } {
  let payable = 0;
  let receivable = 0;
  let inventoryUnitCost = 0;
  let defaultGstRate = 0;
  const eventsById = new Map(sequence.events.map(event => [event.id, event]));
  const groups: JournalEntryGroup[] = [];
  const clarifications: MissingFieldInfo[] = [];
  for (const event of sequence.events) {
    if (event.uncertainties.length) { clarifications.push(...event.uncertainties); continue; }
    const linked = event.relatesTo[0] ? eventsById.get(event.relatesTo[0]) : undefined;
    const gstRate = event.tax?.rate ?? linked?.tax?.rate ?? defaultGstRate;
    const amount = event.amount ?? (event.quantity && linked?.unitPrice ? event.quantity * linked.unitPrice : undefined);
    if (event.currency !== 'SGD') { clarifications.push({ fieldKey: 'fxRate', fieldName: 'Transaction-date FX rate', prompt: `Please provide the SGD transaction-date rate for ${event.id}.`, whyNeeded: 'Foreign-currency amounts must be measured before the payable can be reconciled.' }); continue; }
    if (event.type === 'purchase') {
      const gst = amount! * gstRate / 100; defaultGstRate = gstRate; inventoryUnitCost = event.unitPrice || inventoryUnitCost; payable += amount! + gst;
      groups.push(group(event, 'Inventory purchase on credit', [line(`${event.id}-1`, 'Inventory', 'ASSET', amount!, 0, 'Inventory acquired.'), line(`${event.id}-2`, 'Input GST receivable', 'ASSET', gst, 0, 'Claimable input GST.'), line(`${event.id}-3`, 'Accounts Payable', 'LIABILITY', 0, amount! + gst, 'Supplier obligation recognised.')], event.description, standard));
    }
    else if (event.type === 'purchase_return') {
      const net = amount!; const gst = net * gstRate / 100; if (net + gst > payable) { clarifications.push({ fieldKey: 'returnAmount', fieldName: 'Return amount', prompt: `The return for ${event.id} exceeds the linked outstanding payable of SGD ${payable.toFixed(2)}. Please confirm the original purchase or amount.`, whyNeeded: 'A return cannot derecognise more than the linked purchase balance.' }); continue; }
      payable -= net + gst; groups.push(group(event, 'Return of inventory to supplier', [line(`${event.id}-1`, 'Accounts Payable', 'LIABILITY', net + gst, 0, 'Supplier obligation reduced by the credit note.'), line(`${event.id}-2`, 'Inventory', 'ASSET', 0, net, 'Returned inventory derecognised.'), line(`${event.id}-3`, 'Input GST receivable', 'ASSET', 0, gst, 'Input GST reversed.')], event.description, standard));
    } else if (event.type === 'supplier_settlement') {
      const settling = amount ?? payable; if (settling > payable) { clarifications.push({ fieldKey: 'settlementAmount', fieldName: 'Settlement amount', prompt: `The settlement for ${event.id} exceeds the linked outstanding payable of SGD ${payable.toFixed(2)}. Please confirm the payment allocation.`, whyNeeded: 'A payable cannot be settled beyond its outstanding balance.' }); continue; }
      const purchaseTerms = sequence.events.find(item => item.type === 'purchase')?.paymentTerms || '';
      const discountRate = /\b(\d+(?:\.\d+)?)\/\d+\b/.exec(purchaseTerms)?.[1] && /qualifying|taking/i.test(event.description)
        ? Number(/\b(\d+(?:\.\d+)?)\/\d+\b/.exec(purchaseTerms)![1]) / 100 : 0;
      const discountNet = (settling / (1 + gstRate / 100)) * discountRate; const discountGst = discountNet * gstRate / 100; const cash = settling - discountNet - discountGst;
      payable -= settling; groups.push(group(event, 'Settlement of supplier payable', [line(`${event.id}-1`, 'Accounts Payable', 'LIABILITY', settling, 0, 'Supplier obligation settled.'), line(`${event.id}-2`, 'Cash at Bank', 'ASSET', 0, cash, 'Payment to supplier.'), line(`${event.id}-3`, 'Inventory', 'ASSET', 0, discountNet, 'Gross-method purchase discount reduces inventory cost.'), line(`${event.id}-4`, 'Input GST receivable', 'ASSET', 0, discountGst, 'Input GST adjusted for the discount.')], event.description, standard));
    } else if (event.type === 'sale') {
      const net = amount!; const gst = net * gstRate / 100; const cost = (event.quantity || 0) * inventoryUnitCost; receivable += net + gst;
      groups.push(group(event, 'Credit sale of inventory', [line(`${event.id}-1`, 'Accounts Receivable', 'ASSET', net + gst, 0, 'Customer invoice including GST.'), line(`${event.id}-2`, 'Sales Revenue', 'REVENUE', 0, net, 'Revenue recognised on sale.'), line(`${event.id}-3`, 'Output GST payable', 'LIABILITY', 0, gst, 'Output GST on taxable supply.'), line(`${event.id}-4`, 'Cost of Sales', 'EXPENSE', cost, 0, 'FIFO cost of goods sold.'), line(`${event.id}-5`, 'Inventory', 'ASSET', 0, cost, 'Inventory derecognised.')], event.description, standard));
    } else if (event.type === 'credit_note') {
      const net = amount!; const gst = net * gstRate / 100; if (net + gst > receivable) { clarifications.push({ fieldKey: 'allowanceAmount', fieldName: 'Allowance amount', prompt: `The allowance for ${event.id} exceeds the linked receivable. Please confirm the invoice or allowance.`, whyNeeded: 'A credit allowance cannot exceed the outstanding customer balance.' }); continue; }
      receivable -= net + gst; groups.push(group(event, 'Sales allowance credit note', [line(`${event.id}-1`, 'Sales Allowances', 'REVENUE', net, 0, 'Reduction of sales consideration.'), line(`${event.id}-2`, 'Output GST payable', 'LIABILITY', gst, 0, 'Output GST adjusted.'), line(`${event.id}-3`, 'Accounts Receivable', 'ASSET', 0, net + gst, 'Customer balance reduced.')], event.description, standard));
    }
  }
  return { groups, clarifications };
}

/** @deprecated Use resolveCommercialEventSequence. Kept for existing callers. */
export const resolveInventoryEventSequence = resolveCommercialEventSequence;
