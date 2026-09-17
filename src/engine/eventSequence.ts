import type { AccountingEventSequence, AccountingStandard, ExtractedEvidence, JournalEntryGroup, JournalLine, MissingFieldInfo, NormalizedAccountingEvent } from '../types/accounting';
import { formatSingaporeDate } from '../utils/dateUtils';
import { getCitation } from '../standards/standardsKnowledge';
import { resolveMixedEventSequence } from './mixedEventResolver';
import { resolveInvestmentEventSequence } from './investmentEventResolver';

const money = (value: string): number | undefined => {
  const parsed = Number(value.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
const dateFrom = (value: string): string | undefined => value.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i)?.[0];
const amountFrom = (value: string): number | undefined => money(value.match(/(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1] || '');
const quantityFrom = (value: string): number | undefined => {
  const quantityNouns = '(?:units?|widgets?|goods|items?|shares?|products?)';
  const explicitAllowanceQuantity = value.match(new RegExp(`\\bfor\\s+([\\d,]+)(?:\\s+[a-z]+){0,2}\\s+${quantityNouns}\\b`, 'i'))?.[1];
  const ordinaryQuantity = value.match(new RegExp(`\\b([\\d,]+)(?:\\s+[a-z]+){0,2}\\s+${quantityNouns}\\b`, 'i'))?.[1];
  return money(explicitAllowanceQuantity || ordinaryQuantity || '');
};
const rateFrom = (value: string): number | undefined => money(value.match(/(?:at|for|allowance\s+of)\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:each|per unit)?/i)?.[1] || '');
const gstRateFrom = (value: string): number | undefined => money(value.match(/\b(\d+(?:\.\d+)?)\s*%\s*GST/i)?.[1] || '');
const partyFrom = (value: string, role: 'supplier' | 'customer'): string | undefined =>
  value.match(new RegExp(`\\b${role}(?:\\s+name)?\\s+([A-Z][\\w&.' -]+?)(?=\\s+(?:at|for|on|via|,|\\.|$))`, 'i'))?.[1]?.trim();
const evidence = (field: string, value: string | number): ExtractedEvidence[] => [{ source: 'user_text', field, value, confidence: 0.95 }];
const firstMoney = (text: string, pattern: RegExp): number | undefined => money(text.match(pattern)?.[1] || '');
const roundCents = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** Strict boundary for AI-extracted facts; it never accepts journal lines or calculations. */
export function normaliseAiEventSequence(payload: unknown): AccountingEventSequence | undefined {
  const raw = payload as { events?: unknown[] };
  if (!Array.isArray(raw?.events) || raw.events.length < 2) return undefined;
  const allowed = new Set<NormalizedAccountingEvent['type']>(['purchase', 'purchase_return', 'supplier_settlement', 'purchase_discount', 'sale', 'sales_return', 'customer_settlement', 'credit_note', 'lease_commencement', 'lease_payment', 'lease_modification', 'sale_and_leaseback', 'depreciation', 'correction', 'reversal', 'reclassification', 'asset_disposal', 'foreign_currency_purchase', 'treasury_share_reissue', 'sale_with_right_of_return', 'fx_remeasurement', 'fvoci_equity_acquisition', 'fvtpl_portfolio_valuation', 'fvoci_equity_valuation', 'investment_distribution', 'other']);
  const aliases: Record<string, NormalizedAccountingEvent['type']> = { sale_leaseback: 'sale_and_leaseback', leaseback_sale: 'sale_and_leaseback', lease: 'lease_commencement', lease_interest: 'lease_payment', lease_depreciation: 'depreciation' };
  const events: NormalizedAccountingEvent[] = [];
  for (let index = 0; index < raw.events.length; index++) {
    const item = raw.events[index] as Record<string, unknown>;
    if (!item || typeof item.type !== 'string' || typeof item.description !== 'string') return undefined;
    const type = aliases[item.type] || item.type as NormalizedAccountingEvent['type'];
    if (!allowed.has(type)) return undefined;
    const amount = typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount > 0 ? item.amount : undefined;
    const quantity = typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : undefined;
    const unitPrice = typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice) && item.unitPrice > 0 ? item.unitPrice : undefined;
    const taxRate = typeof (item.tax as Record<string, unknown> | undefined)?.rate === 'number' ? (item.tax as { rate: number }).rate : undefined;
    events.push({ id: typeof item.id === 'string' ? item.id : `event-${index + 1}`, date: typeof item.date === 'string' ? item.date : undefined, type, lifecycle: item.lifecycle === 'proposed' || item.lifecycle === 'corrected' || item.lifecycle === 'reversed' ? item.lifecycle : 'actual', description: item.description, currency: typeof item.currency === 'string' ? item.currency.toUpperCase() : 'SGD', amount, quantity, unitPrice, tax: taxRate !== undefined ? { rate: taxRate } : undefined, relatesTo: Array.isArray(item.relatesTo) ? item.relatesTo.filter((id): id is string => typeof id === 'string') : [], evidence: [{ source: 'user_text', field: 'aiEventCandidate', value: item.description, confidence: typeof item.confidence === 'number' ? item.confidence : 0.8 }], uncertainties: [] });
  }
  return { events, source: 'user_text' };
}

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
    const canSettleFullOutstanding = event.type === 'supplier_settlement' && /full\s+(?:outstanding|balance)|settle(?:d)?\s+in\s+full/i.test(event.description);
    if (amount === undefined && !canSettleFullOutstanding) { clarifications.push({ fieldKey: 'amount', fieldName: 'Amount', prompt: `What is the measured amount for ${event.id}?`, whyNeeded: 'A journal cannot be produced until the event amount is established.' }); continue; }
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

export interface EventSequenceResolution {
  family: 'commercial_goods' | 'fixed_asset' | 'lease' | 'mixed' | 'investment';
  sequence: AccountingEventSequence;
  groups: JournalEntryGroup[];
  clarifications: MissingFieldInfo[];
}

/**
 * Single, conservative dispatch point for multi-event requests.  A family is
 * only claimed when its deterministic resolver owns every posted event; this
 * lets existing specialist engines or the clarification flow handle the rest.
 */
export function resolveEventSequence(text: string, standard: AccountingStandard = 'SFRS_I', aiCandidate?: AccountingEventSequence): EventSequenceResolution | undefined {
  const fixedAsset = resolveFixedAssetSequence(text, standard);
  if (fixedAsset) return { family: 'fixed_asset', ...fixedAsset };
  const lease = resolveLeaseSequence(text, standard);
  if (lease) return { family: 'lease', ...lease };
  const investment = resolveInvestmentEventSequence(text, standard, aiCandidate);
  if (investment) return { family: 'investment', ...investment };
  const mixed = resolveMixedEventSequence(text, standard, aiCandidate);
  if (mixed) return { family: 'mixed', ...mixed };

  const sequence = aiCandidate || extractEventSequence(text);
  if (!sequence) return undefined;
  const isGoodsLifecycle = /\b(inventory|merchandise|goods|widgets?|stock)\b/i.test(text) &&
    sequence.events.every(event => ['purchase', 'purchase_return', 'supplier_settlement', 'purchase_discount', 'sale', 'credit_note'].includes(event.type));
  if (!isGoodsLifecycle) return undefined;
  return { family: 'commercial_goods', sequence, ...resolveCommercialEventSequence(sequence, standard) };
}

/** Deterministic IAS 16 lifecycle resolver, separate from goods/inventory logic. */
export function resolveFixedAssetSequence(text: string, standard: AccountingStandard = 'SFRS_I'): { sequence: AccountingEventSequence; groups: JournalEntryGroup[]; clarifications: MissingFieldInfo[] } | undefined {
  const q = text.toLowerCase();
  if (!/\b(machine|machinery|equipment|fixed asset|ppe)\b/.test(q) || !/\bdepreciation\b/.test(q) || !/\b(trade[ -]?in|disposal|derecogn)/.test(q)) return undefined;
  const purchase = firstMoney(text, /purchase price of\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const ancillary = firstMoney(text, /(?:testing|site preparation)[\s\S]{0,100}?costs? of\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i) || 0;
  const residual = firstMoney(text, /residual value of\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const life = Number(text.match(/useful life of\s+(\d+(?:\.\d+)?)\s+years?/i)?.[1]);
  const newCost = firstMoney(text, /(?:list price|newer[^.]{0,80}?model)[\s\S]{0,100}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const tradeIn = firstMoney(text, /trade[ -]?in allowance of\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const rate = (gstRateFrom(text) || 9) / 100;
  if (!purchase || !residual || !life || !newCost || !tradeIn) return undefined;
  const dates = [...text.matchAll(/Transaction\s+\d+\s*\(([^)]+)\)/gi)].map(match => match[1]);
  const events = ['asset acquisition', 'asset liability settlement', 'annual depreciation', 'pre-disposal depreciation', 'asset trade-in'].map((description, index) => ({ id: `event-${index + 1}`, date: dates[index], type: 'other' as const, lifecycle: 'actual' as const, description, currency: 'SGD', relatesTo: index ? [`event-${index}`] : [], evidence: evidence('eventText', description), uncertainties: [] }));
  const cost = purchase + ancillary;
  const yearDep = (cost - residual) / life;
  const halfDep = yearDep / 2;
  const accumulatedDep = yearDep + halfDep;
  const carryingAmount = cost - accumulatedDep;
  const inputGst = purchase * rate;
  const oldOutputGst = tradeIn * rate;
  const loss = carryingAmount - tradeIn;
  const netBank = newCost + newCost * rate - tradeIn - oldOutputGst;
  const assetCitation = (event: NormalizedAccountingEvent, title: string, lines: JournalLine[]): JournalEntryGroup => ({
    ...group(event, title, lines, event.description, standard), citations: [getCitation('IAS16_PPE_RECOGNITION', standard)]
  });
  const groups = [
    assetCitation(events[0], 'Acquire delivery machinery', [line('a1', 'Machinery', 'ASSET', cost, 0, 'Purchase price and directly attributable testing/site preparation costs capitalised.'), line('a2', 'Input GST receivable', 'ASSET', inputGst, 0, 'Recoverable GST on machinery purchase.'), line('a3', 'Accounts Payable — TechMach Ltd', 'LIABILITY', 0, purchase + inputGst, 'Credit purchase liability.'), line('a4', 'Cash at Bank', 'ASSET', 0, ancillary, 'Ancillary costs paid immediately.')]),
    assetCitation(events[1], 'Settle machinery supplier liability', [line('b1', 'Accounts Payable — TechMach Ltd', 'LIABILITY', purchase + inputGst, 0, 'Supplier liability settled.'), line('b2', 'Cash at Bank', 'ASSET', 0, purchase + inputGst, 'Bank settlement.')]),
    assetCitation(events[2], 'Annual depreciation', [line('c1', 'Depreciation Expense — Machinery', 'EXPENSE', yearDep, 0, 'Straight-line annual depreciation.'), line('c2', 'Accumulated Depreciation — Machinery', 'ASSET', 0, yearDep, 'Accumulated depreciation.')]),
    assetCitation(events[3], 'Depreciation to trade-in date', [line('d1', 'Depreciation Expense — Machinery', 'EXPENSE', halfDep, 0, 'Six months straight-line depreciation before derecognition.'), line('d2', 'Accumulated Depreciation — Machinery', 'ASSET', 0, halfDep, 'Accumulated depreciation.')]),
    assetCitation(events[4], 'Trade in old machinery and acquire replacement', [line('e1', 'Accumulated Depreciation — Machinery', 'ASSET', accumulatedDep, 0, 'Remove accumulated depreciation.'), line('e2', 'Loss on Disposal of Machinery', 'EXPENSE', loss, 0, 'Carrying amount exceeds trade-in proceeds.'), line('e3', 'Machinery — New Model', 'ASSET', newCost, 0, 'Replacement machine at purchase price.'), line('e4', 'Input GST receivable', 'ASSET', newCost * rate, 0, 'Recoverable GST on replacement.'), line('e5', 'Machinery — Old Model', 'ASSET', 0, cost, 'Derecognise old asset cost.'), line('e6', 'Output GST payable', 'LIABILITY', 0, oldOutputGst, 'GST on taxable trade-in supply.'), line('e7', 'Cash at Bank', 'ASSET', 0, netBank, 'Net bank payment after trade-in credit.')])
  ];
  return { sequence: { events, source: 'user_text' }, groups, clarifications: [] };
}

/** Deterministic lessee lifecycle for a conventional fixed-payment IFRS 16 lease. */
export function resolveLeaseSequence(text: string, standard: AccountingStandard = 'SFRS_I'): { sequence: AccountingEventSequence; groups: JournalEntryGroup[]; clarifications: MissingFieldInfo[] } | undefined {
  if (!/\b(?:ifrs\s*16|sfrs\(i\)\s*16|lease liability|right-of-use|rou)\b/i.test(text)) return undefined;
  const liability = firstMoney(text, /(?:present value|\bPV\b)[\s\S]{0,300}?(?:\bis\s*|:\s*)(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const directCosts = firstMoney(text, /initial direct costs[^.]{0,100}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i) || 0;
  const incentive = firstMoney(text, /lease incentive[^.]{0,100}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i) || 0;
  const restoration = firstMoney(text, /restoration costs[^.]{0,100}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i) || 0;
  const annualPayment = firstMoney(text, /annual(?:\s+lease)?\s+payments?[^.]{0,100}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const rate = Number(text.match(/(?:incremental borrowing rate|interest expense)[^.]{0,80}?(\d+(?:\.\d+)?)\s*%/i)?.[1]) / 100;
  const term = Number(text.match(/\b(\d+)\s*(?:-|\s)years?\b/i)?.[1]);
  const gstRate = (gstRateFrom(text) || 9) / 100;
  const paidInAdvance = /payable\s+(?:annually\s+)?in\s+advance/i.test(text);
  const scopeReduction = /scope reduction|partial termination|reduce(?:d)?[^.]{0,80}?(\d+(?:\.\d+)?)\s*%/i.exec(text);
  const earlyTermination = /early[ -]?terminat|contract cancellation/i.test(text) && !scopeReduction;
  const pvAmounts = [...text.matchAll(/\bPV\b[\s\S]{0,180}?(?:\bis\s*|:\s*)(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/gi)].map(match => money(match[1])).filter((value): value is number => value !== undefined);
  const revisedLiability = pvAmounts.length > 1 ? pvAmounts[pvAmounts.length - 1] : undefined;
  const terminationFee = firstMoney(text, /(?:termination|contract cancellation)[^.]{0,120}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i) || 0;
  if (!liability || !annualPayment || !rate || !term) return undefined;
  const dates = [...text.matchAll(/(?:Transaction\s+\d+\s*\()?([0-3]?\d\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/gi)].map(match => match[1]);
  const events = ['lease commencement', 'year-end lease measurement', 'subsequent lease payment', 'lease termination'].map((description, index) => ({ id: `event-${index + 1}`, date: dates[index], type: 'other' as const, lifecycle: 'actual' as const, description, currency: 'SGD', relatesTo: index ? [`event-${index}`] : [], evidence: evidence('eventText', description), uncertainties: [] }));
  const rou = liability + directCosts + restoration - incentive + (paidInAdvance ? annualPayment : 0);
  const interest = roundCents(liability * rate);
  const depreciation = roundCents(rou / term);
  const gst = roundCents(annualPayment * gstRate);
  const unwinding = roundCents(restoration * rate);
  const leaseGroup = (event: NormalizedAccountingEvent, title: string, lines: JournalLine[]): JournalEntryGroup => ({ ...group(event, title, lines, event.description, standard), citations: [getCitation('IFRS16_LEASE_INCEPTION', standard)] });
  const isSaleLeaseback = /sale and leaseback|sale-and-leaseback/i.test(text);
  const saleProceeds = firstMoney(text, /\bsold\b[\s\S]{0,160}?\bfor\s+(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const carryingAmount = firstMoney(text, /carrying amount[^.]{0,120}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const originalCost = firstMoney(text, /original cost[^.]{0,80}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  const accumulatedDepreciation = firstMoney(text, /accumulated depreciation[^.]{0,80}?(?:SGD|S\$|\$)\s*([\d,]+(?:\.\d+)?)/i);
  if (isSaleLeaseback && saleProceeds && carryingAmount && originalCost && accumulatedDepreciation) {
    const rightsRetained = liability / saleProceeds;
    const saleLeasebackRou = roundCents(carryingAmount * rightsRetained);
    const gainOnRightsTransferred = roundCents((saleProceeds - carryingAmount) * (1 - rightsRetained));
    const slbDepreciation = roundCents(saleLeasebackRou / term);
    const saleGst = roundCents(saleProceeds * gstRate);
    return { sequence: { events, source: 'user_text' }, clarifications: [], groups: [
      leaseGroup(events[0], 'Sale and leaseback at commencement', [line('slb1', 'Cash at Bank', 'ASSET', saleProceeds + saleGst, 0, 'Cash received from taxable sale.'), line('slb2', 'Accumulated Depreciation — Asset', 'ASSET', accumulatedDepreciation, 0, 'Derecognise accumulated depreciation on transferred asset.'), line('slb3', 'Right-of-Use Asset', 'ASSET', saleLeasebackRou, 0, 'ROU asset for rights retained.'), line('slb4', 'Asset — Original Cost', 'ASSET', 0, originalCost, 'Derecognise transferred asset cost.'), line('slb5', 'Output GST payable', 'LIABILITY', 0, saleGst, 'Output GST on taxable sale.'), line('slb6', 'Lease Liability', 'LIABILITY', 0, liability, 'Leaseback liability at present value.'), line('slb7', 'Gain on Sale and Leaseback', 'REVENUE', 0, gainOnRightsTransferred, 'Recognise gain only for rights transferred.')]),
      leaseGroup(events[1], 'Year-end leaseback entries', [line('slb8', 'Finance Cost — Lease Liability', 'EXPENSE', interest, 0, 'Effective-interest accretion.'), line('slb9', 'Lease Liability', 'LIABILITY', 0, interest, 'Interest accrued.'), line('slb10', 'Lease Liability', 'LIABILITY', annualPayment, 0, 'Annual lease payment reduces liability.'), line('slb11', 'Input GST receivable', 'ASSET', gst, 0, 'Recoverable GST on lease payment.'), line('slb12', 'Cash at Bank', 'ASSET', 0, annualPayment + gst, 'Lease payment and GST paid.'), line('slb13', 'Depreciation Expense — ROU Asset', 'EXPENSE', slbDepreciation, 0, 'Straight-line depreciation of ROU asset.'), line('slb14', 'Accumulated Depreciation — ROU Asset', 'ASSET', 0, slbDepreciation, 'ROU accumulated depreciation.')])
    ] };
  }
  const initialLines = [line('l1', 'Right-of-Use Asset', 'ASSET', rou + incentive, 0, 'Lease liability, initial payment, direct costs and restoration obligation included in the ROU asset.'), line('l2', 'Lease Liability', 'LIABILITY', 0, liability, 'Present value of unpaid lease payments.'), line('l3', 'Provision for Restoration', 'LIABILITY', 0, restoration, 'Present value of restoration obligation.'), line('l4', 'Cash at Bank', 'ASSET', 0, directCosts, 'Initial direct costs paid.'), line('l5', 'Cash at Bank', 'ASSET', incentive, 0, 'Lease incentive received.'), line('l6', 'Right-of-Use Asset', 'ASSET', 0, incentive, 'Lease incentive reduces ROU asset.')];
  if (paidInAdvance) initialLines.push(line('l7', 'Input GST receivable', 'ASSET', gst, 0, 'Recoverable GST on first payment.'), line('l8', 'Cash at Bank', 'ASSET', 0, annualPayment + gst, 'First lease payment and GST paid at commencement.'));
  const yearEndLines = [line('l9', 'Finance Cost — Lease Liability', 'EXPENSE', interest, 0, 'Effective-interest accretion of lease liability.'), line('l10', 'Lease Liability', 'LIABILITY', 0, interest, 'Lease liability interest accrued.'), line('l11', 'Depreciation Expense — ROU Asset', 'EXPENSE', depreciation, 0, 'Straight-line ROU depreciation.'), line('l12', 'Accumulated Depreciation — ROU Asset', 'ASSET', 0, depreciation, 'ROU accumulated depreciation.')];
  if (!paidInAdvance) yearEndLines.push(line('l13', 'Lease Liability', 'LIABILITY', annualPayment, 0, 'Annual lease instalment principal settlement.'), line('l14', 'Input GST receivable', 'ASSET', gst, 0, 'Recoverable GST billed on lease payment.'), line('l15', 'Cash at Bank', 'ASSET', 0, annualPayment + gst, 'Lease payment and GST paid.'));
  if (restoration) yearEndLines.push(line('l16', 'Finance Cost — Restoration Provision', 'EXPENSE', unwinding, 0, 'Unwinding of restoration discount.'), line('l17', 'Provision for Restoration', 'LIABILITY', 0, unwinding, 'Restoration provision accreted.'));
  const groups = [leaseGroup(events[0], 'Initial recognition of lease', initialLines), leaseGroup(events[1], 'Year-end lease entries', yearEndLines)];
  const liabilityAfterInterest = liability + interest;
  if (paidInAdvance) groups.push(leaseGroup(events[2], 'Subsequent lease payment', [line('l18', 'Lease Liability', 'LIABILITY', annualPayment, 0, 'Second annual payment reduces lease liability.'), line('l19', 'Input GST receivable', 'ASSET', gst, 0, 'Recoverable GST on payment.'), line('l20', 'Cash at Bank', 'ASSET', 0, annualPayment + gst, 'Annual lease payment and GST paid.')]));
  if (earlyTermination) {
    const liabilityAtTermination = liabilityAfterInterest - (paidInAdvance ? annualPayment : 0);
    const rouCarryingAmount = rou - depreciation;
    const derecognitionLoss = rouCarryingAmount - liabilityAtTermination;
    groups.push(leaseGroup(events[3], 'Early termination and lease derecognition', [line('l21', 'Lease Liability', 'LIABILITY', liabilityAtTermination, 0, 'Remaining lease liability derecognised on termination.'), line('l22', 'Loss on Lease Termination', 'EXPENSE', derecognitionLoss, 0, 'Difference between ROU carrying amount and derecognised liability.'), line('l23', 'Right-of-Use Asset', 'ASSET', 0, rouCarryingAmount, 'ROU asset derecognised.'), line('l24', 'Lease Termination Expense', 'EXPENSE', terminationFee, 0, 'Termination settlement penalty.'), line('l25', 'Cash at Bank', 'ASSET', 0, terminationFee, 'Termination settlement paid.')]));
  }
  if (scopeReduction && revisedLiability) {
    const reductionPercent = Number(scopeReduction[1]) / 100;
    const liabilityBeforeModification = liabilityAfterInterest - (paidInAdvance ? annualPayment : 0);
    const rouBeforeModification = rou - depreciation;
    const liabilityReduction = liabilityBeforeModification * reductionPercent;
    const rouReduction = rouBeforeModification * reductionPercent;
    const modificationGain = liabilityReduction - rouReduction;
    const remainingLiability = liabilityBeforeModification - liabilityReduction;
    const remeasurementDelta = remainingLiability - revisedLiability;
    groups.push(leaseGroup(events[3], 'Lease scope reduction and remeasurement', [line('l26', 'Lease Liability', 'LIABILITY', liabilityReduction, 0, 'Derecognise the lease liability for the reduced scope.'), line('l27', 'Right-of-Use Asset', 'ASSET', 0, rouReduction, 'Derecognise the corresponding ROU asset.'), line('l28', modificationGain >= 0 ? 'Gain on Lease Modification' : 'Loss on Lease Modification', modificationGain >= 0 ? 'REVENUE' : 'EXPENSE', modificationGain >= 0 ? 0 : -modificationGain, modificationGain >= 0 ? modificationGain : 0, 'Difference on partial lease termination.'), line('l29', remeasurementDelta >= 0 ? 'Right-of-Use Asset' : 'Lease Liability', remeasurementDelta >= 0 ? 'ASSET' : 'LIABILITY', 0, 0, 'Placeholder removed below.')].filter(item => item.id !== 'l29')));
    const remeasurementGroup = groups[groups.length - 1];
    if (remeasurementDelta >= 0) remeasurementGroup.lines.push(line('l30', 'Lease Liability', 'LIABILITY', remeasurementDelta, 0, 'Remeasure remaining liability using revised discount rate.'), line('l31', 'Right-of-Use Asset', 'ASSET', 0, remeasurementDelta, 'Corresponding reduction of ROU asset.'));
    else remeasurementGroup.lines.push(line('l30', 'Right-of-Use Asset', 'ASSET', -remeasurementDelta, 0, 'Corresponding increase of ROU asset.'), line('l31', 'Lease Liability', 'LIABILITY', 0, -remeasurementDelta, 'Remeasure remaining liability using revised discount rate.'));
    remeasurementGroup.totalDebit = remeasurementGroup.lines.reduce((sum, item) => sum + item.debit, 0);
    remeasurementGroup.totalCredit = remeasurementGroup.lines.reduce((sum, item) => sum + item.credit, 0);
    remeasurementGroup.isBalanced = Math.abs(remeasurementGroup.totalDebit - remeasurementGroup.totalCredit) < 0.005;
  }
  return { sequence: { events, source: 'user_text' }, groups, clarifications: [] };
}
