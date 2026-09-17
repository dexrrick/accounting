import type { AccountingEventSequence, AccountingStandard, JournalEntryGroup, JournalLine, MissingFieldInfo, NormalizedAccountingEvent } from '../types/accounting';
import { getCitation } from '../standards/standardsKnowledge';
import { formatSingaporeDate } from '../utils/dateUtils';

type EventType = NormalizedAccountingEvent['type'];
type Block = { date: string; body: string; type: EventType };
const number = (value: string | undefined): number | undefined => value ? Number(value.replace(/,/g, '')) : undefined;
const find = (text: string, pattern: RegExp): number | undefined => number(text.match(pattern)?.[1]);
const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const cash = '(?:SGD|S\\$|\\$)\\s*([\\d,]+(?:\\.\\d+)?)';

function splitInvestmentEvents(text: string): Block[] {
  const headings = [...text.matchAll(/\bTransaction\s+\d+\s*\((\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})[\s\S]{0,200}?\)\s*:/gi)];
  return headings.map((heading, index) => {
    const body = text.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? text.length).split(/\bTask\s*:/i)[0];
    const lower = `${heading[0]} ${body}`.toLowerCase();
    let type: EventType = 'other';
    if (/distribution in specie|dividend in specie/.test(lower)) type = 'investment_distribution';
    else if (/(?:fvoci|unquoted|private equity|\bstake\b)/.test(lower) && /valuation|valued|fair value of/.test(lower)) type = 'fvoci_equity_valuation';
    else if (/fvoci|fair value through other comprehensive income/.test(lower) && /invested|acquir/.test(lower)) type = 'fvoci_equity_acquisition';
    else if (/fvtpl|fair value through profit or loss/.test(lower) && /portfolio/.test(lower) && /management fee|performance fee|incentive fee/.test(lower)) type = 'fvtpl_portfolio_valuation';
    return { date: heading[1], body, type };
  });
}

/** Resolve a linked financial-investment ledger without allowing model-generated journal lines. */
export function resolveInvestmentEventSequence(text: string, standard: AccountingStandard, aiCandidate?: AccountingEventSequence): { sequence: AccountingEventSequence; groups: JournalEntryGroup[]; clarifications: MissingFieldInfo[] } | undefined {
  const blocks = splitInvestmentEvents(text);
  if (blocks.length < 2 || !blocks.some(block => block.type !== 'other')) return undefined;
  const acquisitionIndex = blocks.findIndex(block => block.type === 'fvoci_equity_acquisition');
  const events: NormalizedAccountingEvent[] = blocks.map((block, index) => ({
    id: `event-${index + 1}`, date: block.type === 'fvtpl_portfolio_valuation' ? block.body.match(/\b(?:on|as of)\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i)?.[1] || block.date : block.date, type: block.type, lifecycle: 'actual', description: block.body.trim(), currency: 'SGD',
    relatesTo: (block.type === 'fvoci_equity_valuation' || block.type === 'investment_distribution') && acquisitionIndex >= 0 ? [`event-${acquisitionIndex + 1}`] : [],
    evidence: [{ source: 'user_text', field: 'eventText', value: block.body.trim(), confidence: aiCandidate?.events[index] ? 0.9 : 0.95 }], uncertainties: []
  }));
  const groups: JournalEntryGroup[] = [];
  const clarifications: MissingFieldInfo[] = [];
  const noGst = /exempt or out of scope for GST|GST[- ]exempt|not subject to GST|no GST/i.test(text);
  let fvociCarrying: number | undefined;
  let investmentName = 'Unquoted Equity Investment';
  const clarify = (event: NormalizedAccountingEvent, detail: string): void => {
    clarifications.push({ fieldKey: `${event.id}-investment-facts`, fieldName: `Transaction ${event.id.split('-')[1]} facts`, prompt: `For transaction ${event.id.split('-')[1]}, please confirm ${detail}.`, whyNeeded: 'A linked investment entry cannot be measured or classified safely without these facts.' });
  };
  const post = (event: NormalizedAccountingEvent, title: string, date: string, lines: JournalLine[], citationKeys: string[]): void => {
    const totalDebit = cents(lines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = cents(lines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > 0.005) { clarify(event, 'the journal measurement and rounding'); return; }
    groups.push({ id: `journal-${event.id}`, accountingEventId: event.id, relatedEventIds: event.relatesTo, eventDate: formatSingaporeDate(date), title, summary: event.description, lines, totalDebit, totalCredit, isBalanced: true, citations: citationKeys.map(key => getCitation(key, standard)), rationalePoints: ['Measured from identified event facts; linked carrying amounts and classifications were reconciled.'], authorityStatus: 'DETERMINISTIC', taxSummary: noGst ? 'GST exempt or out of scope as expressly stated; no GST posting.' : undefined });
  };
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const body = blocks[index].body;
    const line = (suffix: string, accountName: string, category: JournalLine['category'], debit: number, credit: number): JournalLine => ({ id: `${event.id}-${suffix}`, accountCode: 'SEQ', accountName, category, debit: cents(debit), credit: cents(credit), lineExplanation: accountName });
    if (event.type === 'other') { clarify(event, 'the event type and treatment; this investment event is not yet supported'); continue; }
    if (event.type === 'fvoci_equity_acquisition') {
      if (!noGst) { clarify(event, 'the GST treatment of directly attributable acquisition fees'); continue; }
      const price = find(body, new RegExp(`\\bInvested\\s+${cash}`, 'i'));
      const costs = find(body, /(?:incurred and paid|paid)\s+SGD\s*([\d,]+(?:\.\d+)?)/i) ?? find(body, new RegExp(`(?:fees|costs)[^.!?]{0,100}?${cash}`, 'i'));
      if (!price || costs === undefined || !/directly attributable/i.test(body) || !/irrevocably designated/i.test(body) || !/fvoci|fair value through other comprehensive income/i.test(body) || !/paid|bank transfer/i.test(body)) { clarify(event, 'the price, directly attributable paid costs, and initial FVOCI election'); continue; }
      investmentName = body.match(/(?:firm|company),\s*([^,]+),\s*acquiring/i)?.[1]?.trim() || investmentName;
      fvociCarrying = cents(price + costs);
      post(event, 'Acquire unquoted FVOCI equity investment', event.date!, [line('1', `Financial Asset at FVOCI — ${investmentName}`, 'ASSET', fvociCarrying, 0), line('2', 'Cash at Bank', 'ASSET', 0, fvociCarrying)], ['IFRS9_INITIAL_MEASUREMENT', 'IFRS9_EQUITY_CLASSIFICATION']);
    } else if (event.type === 'fvtpl_portfolio_valuation') {
      if (!noGst) { clarify(event, 'the GST treatment of management and performance fee invoices'); continue; }
      const initial = find(body, new RegExp(`\\bfrom\\s+${cash}`, 'i'));
      const ending = find(body, new RegExp(`\\bto\\s+${cash}`, 'i'));
      const managementRate = find(body, /(?:management fee|fixed annual management fee)\s+of\s+(\d+(?:\.\d+)?)\s*%/i);
      const performanceRate = find(body, /(?:performance incentive fee|performance fee)\s+of\s+(\d+(?:\.\d+)?)\s*%/i);
      if (!initial || !ending || managementRate === undefined || performanceRate === undefined || !/unpaid|accrued/i.test(body)) { clarify(event, 'the opening and closing portfolio values, both fee rates, and unpaid/accrued status'); continue; }
      const change = cents(ending - initial), management = cents(ending * managementRate / 100), performance = cents(Math.max(change, 0) * performanceRate / 100);
      const valuationLines = change >= 0 ? [line('1', 'Financial Asset at FVTPL — Managed Portfolio', 'ASSET', change, 0), line('2', 'Fair Value Gain — FVTPL Portfolio', 'REVENUE', 0, change)] : [line('1', 'Fair Value Loss — FVTPL Portfolio', 'EXPENSE', -change, 0), line('2', 'Financial Asset at FVTPL — Managed Portfolio', 'ASSET', 0, -change)];
      post(event, 'FVTPL portfolio valuation and manager fee accruals', event.date!, [...valuationLines, line('3', 'Management Fee Expense', 'EXPENSE', management, 0), line('4', 'Management Fees Payable', 'LIABILITY', 0, management), line('5', 'Performance Fee Expense', 'EXPENSE', performance, 0), line('6', 'Performance Fees Payable', 'LIABILITY', 0, performance)].filter(item => item.debit > 0 || item.credit > 0), ['IFRS9_FVTPL_SUBSEQUENT', 'IAS1_EXPENSE_RECOGNITION']);
    } else if (event.type === 'fvoci_equity_valuation') {
      const fairValue = find(body, new RegExp(`\\bfair value of\\s+${cash}`, 'i'));
      if (fvociCarrying === undefined || !fairValue) { clarify(event, 'the linked FVOCI acquisition and independently determined fair value'); continue; }
      const change = cents(fairValue - fvociCarrying);
      const lines = change >= 0 ? [line('1', `Financial Asset at FVOCI — ${investmentName}`, 'ASSET', change, 0), line('2', 'FVOCI Fair Value Reserve (OCI)', 'EQUITY', 0, change)] : [line('1', 'FVOCI Fair Value Reserve (OCI)', 'EQUITY', -change, 0), line('2', `Financial Asset at FVOCI — ${investmentName}`, 'ASSET', 0, -change)];
      if (change === 0) { clarify(event, 'whether a zero-change valuation entry is required'); continue; }
      post(event, 'Remeasure unquoted FVOCI equity investment', event.date!, lines, ['IFRS9_EQUITY_CLASSIFICATION']);
      fvociCarrying = fairValue;
    } else if (event.type === 'investment_distribution') {
      const fairValue = find(body, new RegExp(`\\bfair value of\\s+${cash}`, 'i'));
      const isCostRecovery = /(?:represents|constitutes|is)\s+(?:a\s+)?(?:liquidation recovery|recovery of (?:part of )?(?:the )?cost)/i.test(body) && !/rather than a liquidation recovery/i.test(body);
      if (fvociCarrying === undefined || !fairValue || !/received/i.test(body) || !/dividend/i.test(body) || !/fvtpl/i.test(body) || isCostRecovery) { clarify(event, 'the linked investment, dividend-versus-cost-recovery treatment, treasury-bill fair value, and FVTPL classification'); continue; }
      post(event, 'Receive non-cash dividend in treasury bills', event.date!, [line('1', 'Financial Asset at FVTPL — Treasury Bills', 'ASSET', fairValue, 0), line('2', 'Dividend Income', 'REVENUE', 0, fairValue)], ['IFRS9_EQUITY_DIVIDENDS', 'IFRS9_INITIAL_MEASUREMENT']);
    }
  }
  return { sequence: { events, source: 'user_text' }, groups, clarifications };
}
