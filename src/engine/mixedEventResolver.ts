import type { AccountingEventSequence, AccountingStandard, JournalEntryGroup, JournalLine, MissingFieldInfo, NormalizedAccountingEvent } from '../types/accounting';
import { getCitation } from '../standards/standardsKnowledge';

type EventType = NormalizedAccountingEvent['type'];
type Block = { date: string; body: string; type: EventType };
const amount = (value: string | undefined): number | undefined => value ? Number(value.replace(/,/g, '')) : undefined;
const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const find = (body: string, pattern: RegExp): number | undefined => amount(body.match(pattern)?.[1]);
const money = '(?:SGD|S\\$|\\$)\\s*([\\d,]+(?:\\.\\d+)?)';
const journalLine = (id: string, accountName: string, category: JournalLine['category'], debit: number, credit: number): JournalLine => ({ id, accountCode: 'SEQ', accountName, category, debit: cents(debit), credit: cents(credit), lineExplanation: accountName });

function blocksFrom(text: string): Block[] {
  const headers = [...text.matchAll(/\bTransaction\s+\d+\s*\((\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})[\s\S]{0,200}?\)\s*:/gi)];
  return headers.map((header, index) => {
    const body = text.slice(header.index! + header[0].length, headers[index + 1]?.index ?? text.length).split(/\n\s*Task\s*:/i)[0];
    const lower = `${header[0]} ${body}`.toLowerCase();
    let type: EventType = 'other';
    if (/re-?issu|resell/.test(lower) && /treasury shares?/.test(lower)) type = 'treasury_share_reissue';
    else if (/right of return|expected? to be returned|refund liability/.test(lower) && /sold|sale/.test(lower)) type = 'sale_with_right_of_return';
    else if (/revalu|remeasur|closing rate|spot exchange rate/.test(lower) && /liabilit|payable|receivable/.test(lower)) type = 'fx_remeasurement';
    else if (/purchased?|import/.test(lower) && /\b(?:usd|eur|gbp|jpy|aud)\b/.test(lower) && /credit|payable/.test(lower)) type = 'foreign_currency_purchase';
    return { date: header[1], body, type };
  });
}

/** Mixed-domain sequence route. It claims only the four supported event kinds and validates every input before posting. */
export function resolveMixedEventSequence(text: string, standard: AccountingStandard, aiCandidate?: AccountingEventSequence): { sequence: AccountingEventSequence; groups: JournalEntryGroup[]; clarifications: MissingFieldInfo[] } | undefined {
  const blocks = blocksFrom(text);
  if (blocks.length < 2 || !blocks.some(block => block.type !== 'other')) return undefined;
  const events: NormalizedAccountingEvent[] = blocks.map((block, index) => ({
    id: `event-${index + 1}`, date: block.date, type: block.type, lifecycle: 'actual', description: block.body.trim(),
    currency: block.type === 'foreign_currency_purchase' || block.type === 'fx_remeasurement' ? (block.body.match(/\b(USD|EUR|GBP|JPY|AUD)\b/i)?.[1] || 'SGD').toUpperCase() : 'SGD',
    relatesTo: block.type === 'fx_remeasurement' ? [ `event-${blocks.findIndex(item => item.type === 'foreign_currency_purchase') + 1}` ] : [],
    evidence: [{ source: 'user_text', field: 'eventText', value: block.body.trim(), confidence: aiCandidate?.events[index] ? 0.9 : 0.95 }], uncertainties: []
  }));
  const groups: JournalEntryGroup[] = [];
  const clarifications: MissingFieldInfo[] = [];
  let foreignPayable: { currency: string; foreignAmount: number; carrying: number } | undefined;
  const addClarification = (event: NormalizedAccountingEvent, detail: string): void => {
    clarifications.push({ fieldKey: `${event.id}-facts`, fieldName: `Transaction ${event.id.split('-')[1]} facts`, prompt: `For transaction ${event.id.split('-')[1]}, please confirm ${detail}.`, whyNeeded: 'The event cannot be measured safely from the supplied facts.' });
  };
  const post = (event: NormalizedAccountingEvent, title: string, lines: JournalLine[], citationKeys: string[], taxSummary?: string): void => {
    const totalDebit = cents(lines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = cents(lines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > 0.005) { addClarification(event, 'the amounts and rounding basis'); return; }
    groups.push({ id: `journal-${event.id}`, accountingEventId: event.id, relatedEventIds: event.relatesTo, eventDate: event.date!, title, summary: event.description, lines, totalDebit, totalCredit, isBalanced: true, citations: citationKeys.map(key => getCitation(key, standard)), rationalePoints: ['Amounts calculated from the identified event facts and linked balances.'], authorityStatus: 'DETERMINISTIC', taxSummary });
  };
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const body = blocks[index].body;
    const l = (suffix: string, name: string, category: JournalLine['category'], debit: number, credit: number): JournalLine => journalLine(`${event.id}-${suffix}`, name, category, debit, credit);
    if (event.type === 'other') {
      addClarification(event, 'the accounting event type and treatment; this event is not yet supported by the mixed-domain resolver');
    } else if (event.type === 'foreign_currency_purchase') {
      const foreign = find(body, /\b(?:USD|EUR|GBP|JPY|AUD)\s*([\d,]+(?:\.\d+)?)/i);
      const rate = find(body, /\b(?:USD|EUR|GBP|JPY|AUD)\s*1(?:\.0+)?\s*=\s*SGD\s*(\d+(?:\.\d+)?)/i);
      const base = find(body, /(?:CIF value|customs.assessed[^\n]*?value)\s+of\s+SGD\s*([\d,]+(?:\.\d+)?)/i);
      const gstRate = find(body, /(?:at|based on[^\n]*?at)\s*(\d+(?:\.\d+)?)\s*%/i) ?? find(text, /GST[^\n]*?(\d+(?:\.\d+)?)\s*%/i);
      if (!foreign || !rate || !base || gstRate === undefined || !/import GST/i.test(body) || !/paid|bank transfer/i.test(body)) { addClarification(event, 'the foreign amount, transaction-date rate, customs GST base/rate and payment'); continue; }
      const carrying = cents(foreign * rate);
      const gst = cents(base * gstRate / 100);
      foreignPayable = { currency: event.currency, foreignAmount: foreign, carrying };
      post(event, 'Foreign-currency inventory import and import GST', [l('1', 'Inventory', 'ASSET', carrying, 0), l('2', 'Trade Payable', 'LIABILITY', 0, carrying), l('3', 'Input GST receivable', 'ASSET', gst, 0), l('4', 'Cash at Bank', 'ASSET', 0, gst)], ['IAS21_INITIAL_FOREIGN_CURRENCY', 'IRAS_IMPORT_GST'], `Import GST paid to Customs: SGD ${gst.toFixed(2)}.`);
    } else if (event.type === 'treasury_share_reissue') {
      const shares = find(body, /re-?issues?\s+([\d,]+)\s+(?:of these )?treasury shares?/i);
      const costPerShare = find(body, /cost of\s+SGD\s*([\d.]+)\s+per share/i);
      const proceedsPerShare = find(body, /for\s+SGD\s*([\d.]+)\s+cash\s+per share/i);
      const reserve = find(body, /(?:Capital Reserve[^"\n]*?account[^\n]*?|reserve[^\n]*?)\s+is\s+SGD\s*([\d,]+(?:\.\d+)?)/i);
      if (!shares || !costPerShare || !proceedsPerShare || reserve === undefined) { addClarification(event, 'the reissued quantity, original unit cost, proceeds per share and available treasury-share reserve'); continue; }
      const cost = cents(shares * costPerShare); const proceeds = cents(shares * proceedsPerShare); const deficit = cents(cost - proceeds);
      if (deficit < 0) { addClarification(event, 'the equity treatment for the above-cost reissue'); continue; }
      const reserveUsed = Math.min(reserve, deficit);
      post(event, 'Reissue treasury shares below cost', [l('1', 'Cash at Bank', 'ASSET', proceeds, 0), l('2', 'Capital Reserve — Treasury Shares', 'EQUITY', reserveUsed, 0), l('3', 'Retained Earnings', 'EQUITY', cents(deficit - reserveUsed), 0), l('4', 'Treasury Shares', 'EQUITY', 0, cost)].filter(line => line.debit > 0 || line.credit > 0), ['IAS32_TREASURY_SHARES'], 'Own-equity transaction; no GST.');
    } else if (event.type === 'sale_with_right_of_return') {
      const units = find(body, /sold\s+([\d,]+)\s+\w+/i);
      const price = find(body, new RegExp(`for\\s+${money}\\s+each`, 'i'));
      const costPerUnit = find(body, /cost of each\s+\w+\s+is\s+SGD\s*([\d,]+(?:\.\d+)?)/i) ?? find(body, /cost[^\n]*?SGD\s*([\d,]+(?:\.\d+)?)\s*(?:per|each)/i);
      const returnRate = find(body, /(?:estimates? that|expect(?:ed)?)[^\n]*?(\d+(?:\.\d+)?)\s*%/i);
      const gstRate = find(body, /plus\s*(\d+(?:\.\d+)?)\s*%\s*GST/i) ?? find(text, /GST[^\n]*?(\d+(?:\.\d+)?)\s*%/i);
      if (!units || !price || !costPerUnit || returnRate === undefined || gstRate === undefined || returnRate > 100) { addClarification(event, 'the quantity, selling price, unit cost, expected returns and GST rate'); continue; }
      const gross = cents(units * price), refund = cents(gross * returnRate / 100), revenue = cents(gross - refund), gst = cents(gross * gstRate / 100);
      const cost = cents(units * costPerUnit), recovery = cents(cost * returnRate / 100);
      post(event, 'Credit sale with expected returns', [l('1', 'Trade Receivable', 'ASSET', gross + gst, 0), l('2', 'Sales Revenue', 'REVENUE', 0, revenue), l('3', 'Refund Liability', 'LIABILITY', 0, refund), l('4', 'Output GST payable', 'LIABILITY', 0, gst), l('5', 'Cost of Sales', 'EXPENSE', cents(cost - recovery), 0), l('6', 'Right to Recover Returned Goods', 'ASSET', recovery, 0), l('7', 'Inventory', 'ASSET', 0, cost)], ['IFRS15_RIGHT_OF_RETURN', 'IRAS_OUTPUT_GST'], `Output GST on invoiced consideration: SGD ${gst.toFixed(2)}.`);
    } else if (event.type === 'fx_remeasurement') {
      const rate = find(body, /(?:spot exchange rate|closing rate)[^\n]*?\b(?:USD|EUR|GBP|JPY|AUD)\s*1(?:\.0+)?\s*=\s*SGD\s*(\d+(?:\.\d+)?)/i);
      if (!foreignPayable || !rate || !/unpaid|outstanding/i.test(body) || !body.includes(foreignPayable.currency)) { addClarification(event, 'the linked outstanding foreign-currency payable and closing rate'); continue; }
      const closing = cents(foreignPayable.foreignAmount * rate), change = cents(closing - foreignPayable.carrying);
      if (change === 0) { addClarification(event, 'whether a zero-change remeasurement journal is required'); continue; }
      post(event, 'Remeasure foreign-currency trade payable', change > 0 ? [l('1', 'Foreign Exchange Loss', 'EXPENSE', change, 0), l('2', 'Trade Payable', 'LIABILITY', 0, change)] : [l('1', 'Trade Payable', 'LIABILITY', -change, 0), l('2', 'Foreign Exchange Gain', 'REVENUE', 0, -change)], ['IAS21_MONETARY_ITEMS']);
      foreignPayable.carrying = closing;
    }
  }
  return { sequence: { events, source: 'user_text' }, groups, clarifications };
}
