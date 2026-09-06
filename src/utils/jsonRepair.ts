/**
 * Robust JSON repair and extraction utility for AI / LLM responses.
 * Handles common LLM output anomalies:
 * - Unescaped quotes inside long markdown strings
 * - LaTeX math backslashes (\text, \times, \frac, \le, \ge, \checkmark, \mathbf)
 * - Literal newlines/tabs inside string literals
 * - Trailing commas before } or ]
 * - Markdown code fences (```json ... ```)
 */

export function repairAndParseAIJson(rawJsonText: string): any {
  if (!rawJsonText || !rawJsonText.trim()) {
    throw new Error('No content returned by AI provider.');
  }

  let text = rawJsonText.trim();

  // 1. Strip markdown code fences
  if (text.startsWith('```json')) {
    text = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  } else if (text.startsWith('```')) {
    text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  text = text.trim();

  // 2. Direct JSON.parse fast path
  try {
    return JSON.parse(text);
  } catch (_fastErr) {
    // Continue to repair pipeline
  }

  // 3. Slice to outermost object { ... }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(text);
  } catch (_sliceErr) {}

  // 4. Fix invalid escape sequences (especially LaTeX backslashes like \text, \times, \frac, \le, \checkmark)
  // In standard JSON, only \", \\, \/, \b, \f, \n, \r, \t, \uXXXX are valid.
  // Any other backslash must be doubled into \\
  let repaired = text.replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1');

  // 5. Remove trailing commas before } or ]
  repaired = repaired.replace(/,\s*([\}\]])/g, '$1');

  try {
    return JSON.parse(repaired);
  } catch (_repairErr) {}

  // 6. Repair unescaped quotes inside "messageText"
  // E.g. "messageText": "Under Section 205C, a "small company" is..."
  const mtStart = repaired.indexOf('"messageText"');
  if (mtStart !== -1) {
    const quoteStart = repaired.indexOf('"', mtStart + 13);
    const nextKeyMatch = repaired.search(/,\s*"(?:keyParameters|directGroups|statutoryAdvisory)"/);
    if (quoteStart !== -1 && nextKeyMatch !== -1 && nextKeyMatch > quoteStart) {
      let rawMsg = repaired.slice(quoteStart + 1, nextKeyMatch);
      // Remove trailing quote if present right before the comma
      if (rawMsg.endsWith('"')) {
        rawMsg = rawMsg.slice(0, -1);
      }
      // Re-encode msg as valid JSON string contents
      const safeMsg = JSON.stringify(rawMsg).slice(1, -1);
      const reconstructed = repaired.slice(0, quoteStart + 1) + safeMsg + '"' + repaired.slice(nextKeyMatch);
      try {
        return JSON.parse(reconstructed);
      } catch (_reconstructErr) {}
    }
  }

  // 7. Resilient Schema Extractor Fallback (Guaranteed to succeed)
  return extractAccountingSchemaFallback(text);
}

/**
 * Fallback parser that extracts known schema fields independently
 * even if JSON has broken commas or unbalanced brackets.
 */
function extractAccountingSchemaFallback(text: string): any {
  const result: any = {
    scenarioType: 'UNIVERSAL',
    queryIntent: 'TRANSACTION',
    transactionTitle: 'Accounting Transaction',
    functionalCurrency: 'SGD',
    transactionCurrency: 'SGD',
    messageText: '',
    keyParameters: [],
    directGroups: [],
    statutoryAdvisory: []
  };

  // scenarioType
  const stMatch = text.match(/"scenarioType"\s*:\s*"([^"]+)"/);
  if (stMatch) result.scenarioType = stMatch[1];

  // queryIntent
  const qiMatch = text.match(/"queryIntent"\s*:\s*"([^"]+)"/);
  if (qiMatch) result.queryIntent = qiMatch[1];

  // transactionTitle
  const ttMatch = text.match(/"transactionTitle"\s*:\s*"([^"]+)"/);
  if (ttMatch) result.transactionTitle = ttMatch[1];

  // functionalCurrency
  const fcMatch = text.match(/"functionalCurrency"\s*:\s*"([^"]+)"/);
  if (fcMatch) result.functionalCurrency = fcMatch[1];

  // transactionCurrency
  const tcMatch = text.match(/"transactionCurrency"\s*:\s*"([^"]+)"/);
  if (tcMatch) result.transactionCurrency = tcMatch[1];

  // Extract arrays using balanced bracket parser
  result.directGroups = extractJsonArray(text, 'directGroups');
  result.keyParameters = extractJsonArray(text, 'keyParameters');
  result.statutoryAdvisory = extractJsonArray(text, 'statutoryAdvisory');

  // Extract messageText
  const mtIndex = text.indexOf('"messageText"');
  if (mtIndex !== -1) {
    const colonIdx = text.indexOf(':', mtIndex);
    const startQuote = text.indexOf('"', colonIdx);
    const nextBoundary = text.search(/",\s*"(?:keyParameters|directGroups|statutoryAdvisory)"/);
    if (startQuote !== -1 && nextBoundary !== -1 && nextBoundary > startQuote) {
      result.messageText = text.slice(startQuote + 1, nextBoundary)
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }

  if (!result.messageText) {
    // Clean whatever text exists
    result.messageText = text
      .replace(/^\{[\s\S]*?"messageText"\s*:\s*"/, '')
      .replace(/",\s*"(?:keyParameters|directGroups)[\s\S]*$/, '')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"');
  }

  return result;
}

/**
 * Extracts a balanced JSON array from text for a given key,
 * correctly handling nested brackets and strings.
 */
function extractJsonArray(text: string, keyName: string): any[] {
  const keyIdx = text.indexOf(`"${keyName}"`);
  if (keyIdx === -1) return [];
  const startBracket = text.indexOf('[', keyIdx);
  if (startBracket === -1) return [];

  let depth = 0;
  let inString = false;
  let escape = false;
  let endBracket = -1;

  for (let i = startBracket; i < text.length; i++) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '[') {
        depth++;
      } else if (char === ']') {
        depth--;
        if (depth === 0) {
          endBracket = i;
          break;
        }
      }
    }
  }

  if (endBracket !== -1) {
    const rawSlice = text.slice(startBracket, endBracket + 1);
    try {
      const cleaned = rawSlice
        .replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1')
        .replace(/,\s*([\}\]])/g, '$1');
      return JSON.parse(cleaned);
    } catch (_e) {
      return [];
    }
  }
  return [];
}
