const MAX_INPUT_CHARS = 200_000;
const MAX_SCANNED_BLOCKS = 10_000;
const MAX_REPORTED_BLOCKS = 32;
const MAX_COUNT = 10_000;

const STAGES = new Set([
  'DIRECT_PROBE_SOURCE_TEXT',
  'RENDER_CONTEXT_SOURCE_TEXT',
  'SELECTED_CLAIM_QUOTE',
  'SYNTHETIC_TEST'
]);

const SIGNAL_PATTERNS = Object.freeze({
  private_personal_expense_noun: /\b(?:(?:private|personal)\s+(?:business\s+)?expenses?|domestic(?:\s+or\s+private)?\s+expenses?|expenses?\s+(?:of|for)\s+(?:a\s+)?(?:private|personal)\s+(?:nature|purpose))\b/i,
  expense_disallowance_predicate: /\b(?:disallowed|non[\s-]?deductible|not\s+(?:tax\s+)?deductible|cannot\s+be\s+deducted|not\s+allowed\s+as\s+deduction)\b/i,
  disallowed_expense_heading: /\b(?:expenses?\s+(?:which\s+are\s+)?(?:not\s+deductible|disallowed)|non[\s-]?deductible\s+expenses?|disallowed\s+expenses?)\b/i,
  foreign_income: /\b(?:foreign(?:[\s-]+sourced)?\s+income|overseas\s+income)\b/i,
  dividend: /\bdividends?\b/i,
  singapore_receipt: /\b(?:received|receivable|remitted|brought)\s+(?:(?:in|into|to)\s+)?singapore\b/i,
  taxability_heading: /\b(?:taxability|taxable\s+status|tax\s+treatment\s+of\s+income)\b/i,
  exemption_heading: /\b(?:tax\s+)?exemptions?\b/i,
  withholding_tax: /\bwithholding\s+tax\b|\bwht\b/i,
  royalty: /\broyalt(?:y|ies)\b/i,
  non_resident: /\bnon[\s-]?residents?\b/i,
  subject_to: /\bsubject\s+to\b/i,
  withhold_verb: /\b(?:withhold|withholds|withholding|withheld)\b/i,
  wht_rate_table_shape: /[|\t].*(?:\brate\b|\bper\s*cent\b|%)/i,
  gst_input_tax: /\binput[\s-]+tax\b/i,
  gst_claim_or_recover_verb: /\b(?:claim(?:s|ed|ing)?|recover(?:s|ed|ing|y)?)\b/i,
  gst_make_claim_verb: /\b(?:make|makes|making)\s+(?:an?\s+)?(?:input[\s-]+tax\s+)?claim\b|\bmake\s+(?:an?\s+)?claim\s+(?:for|on)\s+input[\s-]+tax\b/i,
  gst_conditions_heading: /\b(?:conditions?|requirements?)\s+(?:for|to)\s+(?:claim(?:ing)?|recover(?:ing)?|input\s+tax)\b|\b(?:conditions?|requirements?)\s+for\s+input\s+tax\b/i,
  requirement_modal: /\b(?:must|required|requires?|necessary|only\s+if|only\s+when|subject\s+to)\b/i,
  business_use: /\b(?:business\s+(?:use|purpose|purchases?|expenses?)|used\s+(?:for|in)\s+(?:the\s+)?business|wholly\s+and\s+exclusively)\b/i,
  taxable_supplies: /\btaxable\s+supplies\b/i,
  tax_invoice: /\btax\s+invoices?\b/i,
  blocked_input_tax: /\bblocked\s+input\s+tax\b|\binput\s+tax\b.{0,60}\bblocked\b/i,
  exception: /\b(?:exceptions?|except(?:ed)?|unless|but\s+only|subject\s+to\s+the\s+exception)\b/i,
  negation_present: /\b(?:not|no|never|without|cannot|can['’]t|does\s+not|do\s+not|non[\s-]?deductible|disallowed)\b/i
});

const SIGNAL_IDS = Object.freeze(Object.keys(SIGNAL_PATTERNS));
const SHAPES = new Set(['PARAGRAPH', 'HEADING', 'COLON_HEADING', 'MARKED_LIST_ITEM', 'PIPE_TABLE_ROW']);

function capCount(value) {
  return Math.min(value, MAX_COUNT);
}

function isMarkedListItem(line) {
  return /^(?:[•◦▪‣*-]\s+|\(?\d{1,3}\)?[.)]\s+)/.test(line.trim());
}

function isPipeTableRow(line) {
  const trimmed = line.trim();
  return (trimmed.startsWith('|') || trimmed.endsWith('|')) && (trimmed.match(/\|/g) || []).length >= 2;
}

function isHeadingLike(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 180 || /[.!?]$/.test(trimmed)) return false;
  return /^(?:conditions?|requirements?|taxability|tax treatment|tax exemption|exemptions?|foreign income|withholding tax|input tax claims?|expenses? which are not deductible|non[\s-]?deductible expenses?|disallowed expenses?)\b/i.test(trimmed);
}

function classifyShape(line) {
  if (isPipeTableRow(line)) return 'PIPE_TABLE_ROW';
  if (isMarkedListItem(line)) return 'MARKED_LIST_ITEM';
  const text = line.trim();
  if (text.endsWith(':')) return 'COLON_HEADING';
  if (isHeadingLike(text)) return 'HEADING';
  return 'PARAGRAPH';
}

function sourceUnits(text) {
  const paragraphs = text.split(/\r?\n[\t ]*\r?\n+/).map(block => block.trim()).filter(Boolean);
  const units = [];
  for (const paragraph of paragraphs) {
    const lines = paragraph.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const structurallySplit = lines.length > 1 && lines.some(line =>
      isMarkedListItem(line) || isPipeTableRow(line) || line.endsWith(':') || isHeadingLike(line));
    const chunks = structurallySplit ? lines : [lines.join(' ')];
    for (const raw of chunks) {
      const line = raw.replace(/^(?:[•◦▪‣*-]\s+|\(?\d{1,3}\)?[.)]\s+)/, '').trim();
      if (line) units.push({ text: line, shape: classifyShape(raw) });
    }
  }
  return units;
}

function emptySignals() {
  return Object.fromEntries(SIGNAL_IDS.map(id => [id, false]));
}

/**
 * Projects only bounded structural presence flags from one public source-text
 * excerpt or selected quote. Flags report vocabulary presence, never rule
 * meaning, semantic support, quotation validity, or issue coverage.
 */
export function projectIrasSourceStructureFeaturesV6(sourceText, stage = 'SYNTHETIC_TEST') {
  const normalizedStage = STAGES.has(stage) ? stage : 'SYNTHETIC_TEST';
  const isString = typeof sourceText === 'string';
  const inputLength = isString ? sourceText.length : 0;
  const inspectedText = isString ? sourceText.slice(0, MAX_INPUT_CHARS) : '';
  const inputTruncated = inputLength > MAX_INPUT_CHARS;
  const allUnits = sourceUnits(inspectedText);
  const scanTruncated = allUnits.length > MAX_SCANNED_BLOCKS;
  const scannedUnits = allUnits.slice(0, MAX_SCANNED_BLOCKS);
  const aggregateCounts = Object.fromEntries(SIGNAL_IDS.map(id => [id, 0]));
  const signalBlocks = [];

  scannedUnits.forEach((unit, blockIndex) => {
    const shape = SHAPES.has(unit.shape) ? unit.shape : 'PARAGRAPH';
    const isHeading = shape === 'HEADING' || shape === 'COLON_HEADING';
    const signalPresence = emptySignals();
    for (const id of SIGNAL_IDS) {
      const headingOnly = id === 'disallowed_expense_heading' || id === 'taxability_heading' ||
        id === 'exemption_heading' || id === 'gst_conditions_heading';
      signalPresence[id] = (!headingOnly || isHeading) && SIGNAL_PATTERNS[id].test(unit.text);
      if (signalPresence[id]) aggregateCounts[id] += 1;
    }
    if (Object.values(signalPresence).some(Boolean)) {
      signalBlocks.push({ blockIndex, shape, signals: signalPresence });
    }
  });

  return {
    schema: 'IRAS_SOURCE_STRUCTURE_FEATURES_V6',
    interpretation: 'PRESENCE_ONLY_NOT_ENTAILMENT',
    stage: normalizedStage,
    sourceTextProvided: isString,
    sourceTextTruncated: inputTruncated,
    scanTruncated: inputTruncated || scanTruncated,
    scannedBlockCount: capCount(scannedUnits.length),
    signalBearingBlockCount: capCount(signalBlocks.length),
    reportedBlockCount: Math.min(signalBlocks.length, MAX_REPORTED_BLOCKS),
    reportedBlocksTruncated: signalBlocks.length > MAX_REPORTED_BLOCKS,
    signalCounts: Object.fromEntries(SIGNAL_IDS.map(id => [id, capCount(aggregateCounts[id])])),
    signalBlocks: signalBlocks.slice(0, MAX_REPORTED_BLOCKS)
  };
}

export const irasSourceStructureFeatureIdsV6 = SIGNAL_IDS;
