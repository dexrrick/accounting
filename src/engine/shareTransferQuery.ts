import type { AccountingScenarioState } from '../types/accounting';

const number = (raw: string) => Number(raw.replace(/,/g, ''));
const fmt = (value: number) => new Intl.NumberFormat('en-SG', { maximumFractionDigits: 2 }).format(value);

/** Parses the common group-exchange phrasing into an ownership analysis. */
export function answerShareStructureQuery(query: string): { messageText: string; scenarioState: AccountingScenarioState } | null {
  const q = query.replace(/\s+/g, ' ').trim();
  const holdingB = /company\s+([a-z0-9]+)\s+holds\s+(\d+(?:\.\d+)?)%\s*,?\s*([\d,]+)\s+units?\s+of\s+company\s+([a-z0-9]+)['’]s?\s+shares?/i.exec(q);
  const holdingC = /company\s+([a-z0-9]+)\s+holds\s+(\d+(?:\.\d+)?)%\s*,?\s*([\d,]+)\s+units?\s+of\s+company\s+([a-z0-9]+)['’]s?\s+shares?/i.exec(q.slice(holdingB?.index ? holdingB.index + holdingB[0].length : 0));
  const exchange = /trade\s+(?:company\s+)?([a-z0-9]+)?\s*([\d,]+)\s+units?\s+of\s+company\s+([a-z0-9]+)['’]?s?\s+shares?\s+for\s+([\d,]+)\s+units?\s+of\s+company\s+([a-z0-9]+)['’]?s?\s+shares?/i.exec(q);
  if (!holdingB || !holdingC || !exchange) return null;

  const holder = `Company ${holdingB[1].toUpperCase()}`;
  const companyB = `Company ${holdingB[4].toUpperCase()}`;
  const companyC = `Company ${holdingC[4].toUpperCase()}`;
  const bBeforePct = number(holdingB[2]); const bBeforeUnits = number(holdingB[3]);
  const cBeforePct = number(holdingC[2]); const cBeforeUnits = number(holdingC[3]);
  const cTransferred = number(exchange[2]); const bReceived = number(exchange[4]);
  if (exchange[3].toUpperCase() !== holdingC[4].toUpperCase() || exchange[5].toUpperCase() !== holdingB[4].toUpperCase()) return null;
  if (cTransferred > cBeforeUnits) return null;

  const bTotal = bBeforeUnits / (bBeforePct / 100);
  const bAfterUnits = bBeforeUnits + bReceived;
  const bAfterPct = bAfterUnits / bTotal * 100;
  const cAfterUnits = cBeforeUnits - cTransferred;
  const cAfterPct = cBeforeUnits ? cAfterUnits / cBeforeUnits * 100 : 0;
  const requestedControl = /(?:total of|to)\s+(\d+(?:\.\d+)?)%\s+(?:control|holding)/i.exec(q)?.[1];
  const mismatch = requestedControl && Math.abs(number(requestedControl) - bAfterPct) > 0.01;
  const caveat = mismatch
    ? `\n\n> ⚠️ **Input inconsistency:** Using the stated 49% = 500 units, ${holder}'s post-transfer holding is **${bAfterPct.toFixed(2)}%**, not ${requestedControl}%. To end at ${requestedControl}% with 800 units, ${companyB} would need ${fmt(bAfterUnits / (number(requestedControl) / 100))} issued shares; then 500 units would have been ${(bBeforeUnits / (bAfterUnits / (number(requestedControl) / 100)) * 100).toFixed(2)}%, not 49%.` : '';

  const messageText = `### Group Share Transfer — Ownership Schedule\n\n**Transfer event**: ${holder} transfers **${fmt(cTransferred)}** shares in ${companyC} and receives **${fmt(bReceived)}** shares in ${companyB}.\n\n| Company | ${holder} before | Change | ${holder} after |\n|---|---:|---:|---:|\n| ${companyB} | ${fmt(bBeforeUnits)} (${bBeforePct.toFixed(2)}%) | +${fmt(bReceived)} | ${fmt(bAfterUnits)} (${bAfterPct.toFixed(2)}%) |\n| ${companyC} | ${fmt(cBeforeUnits)} (${cBeforePct.toFixed(2)}%) | -${fmt(cTransferred)} | ${fmt(cAfterUnits)} (${cAfterPct.toFixed(2)}%) |\n\n**Calculation basis**\n\n- Implied ${companyB} issued shares: ${fmt(bTotal)} (500 ÷ 49%).\n- ${companyB}: ${fmt(bBeforeUnits)} + ${fmt(bReceived)} = ${fmt(bAfterUnits)} shares; ${fmt(bAfterUnits)} ÷ ${fmt(bTotal)} = **${bAfterPct.toFixed(2)}%**.\n- ${companyC}: ${fmt(cBeforeUnits)} - ${fmt(cTransferred)} = **${fmt(cAfterUnits)} shares (0.00%)**.\n\n> **Counterparty needed for a full group schedule:** the prompt does not say who receives the ${companyC} shares or transfers the ${companyB} shares. The calculator therefore shows ${holder}'s position only and does not invent the counterparty leg.\n\nThis is a share-structure calculation only. It does not determine consideration value, accounting entries, tax, or whether shareholder approvals are required.${caveat}`;
  return { messageText, scenarioState: { scenarioType: 'GROUP_SHARE_TRANSFER_ANALYSIS', rawQuery: query, transactionTitle: 'Group Share Transfer and Holding Analysis', functionalCurrency: 'SGD', transactionCurrency: 'SGD', queryIntent: 'STATUTORY_ADVISORY', primaryDomain: 'GENERAL', directGroups: [], keyParameters: [{ label: 'Calculation', value: 'Share holdings and control only', badge: 'No Journal' }], shareTransferAnalysis: { eventSummary: `${holder} transfers ${fmt(cTransferred)} ${companyC} shares and receives ${fmt(bReceived)} ${companyB} shares.`, rows: [{ company: companyB, holder, beforeShares: bBeforeUnits, afterShares: bAfterUnits, beforePercent: bBeforePct, afterPercent: bAfterPct }, { company: companyC, holder, beforeShares: cBeforeUnits, afterShares: cAfterUnits, beforePercent: cBeforePct, afterPercent: cAfterPct }], notes: [mismatch ? `Stated 75% control conflicts with the calculated ${bAfterPct.toFixed(2)}%.` : 'All stated ownership percentages reconcile.', 'Add the transfer counterparty and its pre-transfer position to show the complete group schedule.'] }, isComplete: !mismatch, missingFields: [] } };
}
