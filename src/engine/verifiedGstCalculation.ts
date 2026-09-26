import type { AuthoritativeSourceRecord } from '../standards/unifiedSourceModel';

export interface VerifiedStandardGstCalculation {
  netAmount: number;
  rate: number;
  outputTax: number;
  invoiceTotal: number;
  currency: 'SGD';
  sourceRecordId: string;
  effectiveDate: string;
}

type ParsedDateMention = { date: string; index: number; end: number };

const MONTH_NUMBERS: Record<string, string> = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', sept: '09', september: '09', oct: '10',
  october: '10', nov: '11', november: '11', dec: '12', december: '12'
};

function isoDate(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDateMentions(query: string): ParsedDateMention[] {
  const mentions: ParsedDateMention[] = [];
  const patterns: Array<{ regex: RegExp; convert: (match: RegExpExecArray) => string | undefined }> = [
    {
      regex: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
      convert: match => isoDate(Number(match[1]), Number(match[2]), Number(match[3]))
    },
    {
      regex: /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/gi,
      convert: match => isoDate(Number(match[3]), Number(MONTH_NUMBERS[match[2].toLowerCase()]), Number(match[1]))
    },
    {
      regex: /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/gi,
      convert: match => isoDate(Number(match[3]), Number(MONTH_NUMBERS[match[1].toLowerCase()]), Number(match[2]))
    },
    {
      // The application uses Singapore date conventions, so numeric dates are day/month/year.
      regex: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
      convert: match => isoDate(Number(match[3]), Number(match[2]), Number(match[1]))
    }
  ];

  for (const { regex, convert } of patterns) {
    for (const match of query.matchAll(regex)) {
      const date = convert(match);
      if (date && match.index !== undefined) mentions.push({ date, index: match.index, end: match.index + match[0].length });
    }
  }
  return mentions.sort((left, right) => left.index - right.index);
}

function parseTaxExclusiveSgdCents(query: string): bigint | undefined {
  if (/\b(?:USD|EUR|GBP|AUD|NZD|JPY|CNY|MYR|foreign currency)\b/i.test(query)) return undefined;
  if (/\b(?:GST|tax)[\s-]*inclusive\b|\bincluding\s+(?:GST|tax)\b|\bGST-inclusive\b/i.test(query)) return undefined;

  const amounts = [...query.matchAll(/(?:\bSGD\s*|S\$\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d.,])/gi)];
  if (amounts.length !== 1 || amounts[0].index === undefined) return undefined;
  const [amountText] = amounts[0];
  const rawAmount = amounts[0][1];
  const start = amounts[0].index;
  const end = start + amountText.length;
  const surroundingText = query.slice(Math.max(0, start - 36), Math.min(query.length, end + 40));
  if (!/(?:tax[\s-]*exclusive|exclusive\s+of\s+(?:GST|tax)|excluding\s+(?:GST|tax)|before\s+(?:GST|tax))/i.test(surroundingText)) {
    return undefined;
  }

  const [whole, fraction = ''] = rawAmount.replace(/,/g, '').split('.');
  try {
    const cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
    return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? cents : undefined;
  } catch {
    return undefined;
  }
}

function datesAreAligned(query: string, targetDate?: string): string | undefined {
  if (targetDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return undefined;
  const mentions = extractDateMentions(query);
  if (!mentions.length) return undefined;
  const uniqueDates = [...new Set(mentions.map(mention => mention.date))];
  if (uniqueDates.length !== 1 || (targetDate && targetDate !== uniqueDates[0])) return undefined;
  const transactionDate = uniqueDates[0];

  const supplyDateWasStated = mentions.some(mention => {
    const aroundDate = query.slice(Math.max(0, mention.index - 100), Math.min(query.length, mention.end + 40));
    return /\b(?:supply|supplied|provid(?:e|ed))\b/i.test(aroundDate);
  });
  if (!supplyDateWasStated || !/\binvoice\b/i.test(query) || !/\bpayment\b/i.test(query)) return undefined;

  const sameDateReference = /\binvoice\b[\s\S]{0,100}\bpayment\b[\s\S]{0,70}\b(?:on\s+(?:that|the\s+same|that\s+same)\s+date|same\s+date|same\s+day)\b/i.test(query) ||
    /\bpayment\b[\s\S]{0,100}\binvoice\b[\s\S]{0,70}\b(?:on\s+(?:that|the\s+same|that\s+same)\s+date|same\s+date|same\s+day)\b/i.test(query);
  const explicitlySharedDate = mentions.some(mention => {
    const clauseStart = Math.max(query.lastIndexOf(';', mention.index), query.lastIndexOf('.', mention.index), query.lastIndexOf(',', mention.index)) + 1;
    const clauseEndCandidates = [query.indexOf(';', mention.end), query.indexOf('.', mention.end), query.indexOf(',', mention.end)]
      .filter(index => index >= 0);
    const clauseEnd = clauseEndCandidates.length ? Math.min(...clauseEndCandidates) : query.length;
    const clause = query.slice(clauseStart, clauseEnd + 1);
    return /\binvoice\b/i.test(clause) && /\bpayment\b/i.test(clause);
  });
  if (!sameDateReference && !explicitlySharedDate) return undefined;
  if (/\b(?:invoice|payment)\b[^.;]{0,100}\b(?:not|different|separate)\b[^.;]{0,60}\b(?:same|that|the)\s+(?:date|day)\b/i.test(query) ||
      /\b(?:invoice|payment)\b[^.;]{0,100}\b(?:not\s+aligned|do\s+not\s+match|does\s+not\s+match)\b/i.test(query) ||
      /\b(?:different|separate|not\s+aligned|do\s+not\s+match|does\s+not\s+match)\b/i.test(query)) return undefined;
  return transactionDate;
}

function getSourceRatePercent(record: AuthoritativeSourceRecord): string | undefined {
  const matches = [...record.sourceText.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*%(?!\w)/g)];
  if (matches.length !== 1) return undefined;
  const percentage = Number(matches[0][1]);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return undefined;
  return matches[0][1];
}

function isEligibleSection16RateRecord(record: AuthoritativeSourceRecord): boolean {
  if (record.authority !== 'IRAS' || record.domain !== 'IRAS_GST' ||
      !/^goods\s+and\s+services\s+tax\s+act\s+1993$/i.test(record.legalOrStandardInstrument.trim()) ||
      !/\bsection\s*16\b/i.test(record.paragraphOrSection) ||
      record.sourceStatus !== 'VERIFIED' && record.sourceStatus !== 'HISTORICAL' ||
      record.sourceType !== 'AUTHORITATIVE_SOURCE' || record.evidenceTier !== 'PRIMARY_SOURCE' ||
      !record.isVerbatimText || record.provenance !== 'LOCAL_STATIC' ||
      record.lifecycleState !== 'ACTIVE' || record.recordRole === 'SOURCE_MAP_POINTER' ||
      record.groundingEligible === false || !record.validFrom ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.validFrom) || !getSourceRatePercent(record)) {
    return false;
  }
  if (record.sourceStatus === 'HISTORICAL' && !record.validTo) return false;
  if (record.validTo && (!/^\d{4}-\d{2}-\d{2}$/.test(record.validTo) || record.validTo < record.validFrom)) return false;
  return true;
}

function roundRatioToInteger(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function calculateOutputTaxCents(netCents: bigint, percentageText: string): bigint | undefined {
  const [whole, fraction = ''] = percentageText.split('.');
  try {
    const rateNumerator = BigInt(whole + fraction);
    const rateDenominator = 100n * (10n ** BigInt(fraction.length));
    const outputTaxCents = roundRatioToInteger(netCents * rateNumerator, rateDenominator);
    const invoiceTotalCents = netCents + outputTaxCents;
    if (outputTaxCents < 0n || outputTaxCents > BigInt(Number.MAX_SAFE_INTEGER) ||
        invoiceTotalCents > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    return outputTaxCents;
  } catch {
    return undefined;
  }
}

/**
 * Calculates output GST only when the query states all material conditions and
 * a unique admitted Section 16 source record establishes the applicable rate.
 */
export function computeVerifiedStandardGst(
  query: string,
  records: AuthoritativeSourceRecord[],
  targetDate?: string,
  missingFacts: string[] = []
): VerifiedStandardGstCalculation | undefined {
  if (typeof query !== 'string' || !query.trim() || !Array.isArray(records) ||
      !Array.isArray(missingFacts) || missingFacts.length > 0) return undefined;
  const text = query.normalize('NFC');

  if (/\binput[\s-]*tax\b|\b(?:customer|supplier)\s+(?:meal|lunch|dinner|entertainment)\b|\bpassenger\s+(?:car|motor\s+vehicle)\b/i.test(text)) {
    return undefined;
  }
  if (/\b\d+(?:\.\d+)?\s*%|\brate\s+override\b/i.test(text)) return undefined;
  if (!/\b(?:output\s+(?:GST|tax)|GST\s+amount|invoice\s+total|GST\s+to\s+charge)\b/i.test(text)) return undefined;

  const registeredSupplier = /\bGST[\s-]*registered\s+(?:Singapore\s+)?supplier\b|\bsupplier\s+(?:is\s+)?GST[\s-]*registered\b|\bsupplier\s+is\s+registered\s+for\s+GST\b/i.test(text);
  if (!registeredSupplier ||
      /\b(?:non|not)[\s-]*GST[\s-]*registered\s+(?:Singapore\s+)?supplier\b|\b(?:supplier|seller)\b[^.;]{0,35}\b(?:not|non|unregistered)\b[^.;]{0,25}\bGST\b|\bunregistered\s+(?:Singapore\s+)?supplier\b/i.test(text) ||
      /\b(?:supplier|seller)\s+(?:is\s+)?(?:not|isn't)\s+GST[\s-]*registered\b|\b(?:if|whether|assuming|provided\s+that)\s+(?:the\s+)?supplier\b[^.;]{0,50}\bGST[\s-]*registered\b/i.test(text)) {
    return undefined;
  }
  if (/\b(?:might|may|could|possibly|whether|if|assuming|not\s+yet\s+confirmed|unknown|unclear)\b[^.;]{0,70}\b(?:GST[\s-]*registered|standard[\s-]*rated)\b/i.test(text)) {
    return undefined;
  }

  const standardRatedSupply = /\bstandard[\s-]*rated\s+(?:domestic\s+)?(?:taxable\s+)?supply\b/i.test(text);
  const domesticSupply = /\bdomestic\b|\b(?:in|within)\s+Singapore\b/i.test(text);
  if (!standardRatedSupply || !domesticSupply ||
      /\b(?:not|non)[\s-]*(?:an?\s+)?standard[\s-]*rated\b|\bstandard[\s-]*rated\s+supply\s+(?:is\s+)?not\b/i.test(text) ||
      /\b(?:if|whether|assuming|provided\s+that)\b[^.;]{0,75}\bstandard[\s-]*rated\b/i.test(text)) return undefined;

  const transactionDate = datesAreAligned(text, targetDate);
  const netCents = parseTaxExclusiveSgdCents(text);
  if (!transactionDate || netCents === undefined) return undefined;

  const applicableRecords = records.filter(record => {
    if (!isEligibleSection16RateRecord(record)) return false;
    return record.validFrom! <= transactionDate && (!record.validTo || transactionDate <= record.validTo);
  });
  if (applicableRecords.length !== 1) return undefined;
  const sourceRecord = applicableRecords[0];
  const percentageText = getSourceRatePercent(sourceRecord);
  if (!percentageText) return undefined;
  const outputTaxCents = calculateOutputTaxCents(netCents, percentageText);
  if (outputTaxCents === undefined) return undefined;
  const invoiceTotalCents = netCents + outputTaxCents;

  return {
    netAmount: Number(netCents) / 100,
    rate: Number(percentageText) / 100,
    outputTax: Number(outputTaxCents) / 100,
    invoiceTotal: Number(invoiceTotalCents) / 100,
    currency: 'SGD',
    sourceRecordId: sourceRecord.id,
    effectiveDate: sourceRecord.validFrom!
  };
}
