export const MAS_LICENSING_RECORD_ID = 'MAS_FUND_MANAGEMENT_LICENSING_SUBSECTION_RECHECK';
export const MAS_LICENSING_HTML_URL = 'https://www.mas.gov.sg/regulation/capital-markets/apply-for-licensing-or-registration-of-capital-market-entities/fund-management-licensing';
export const MAS_LICENSING_COMPARISON_PROFILE_VERSION = 'MAS-LICENSING-HTML-DYNAMIC-V1';
export const MAS_LICENSING_MAX_DOCUMENT_BYTES = 1_500_000;

export interface MasLicensingComparisonPolicy {
  profileVersion: typeof MAS_LICENSING_COMPARISON_PROFILE_VERSION;
  originalBodyBase64: string;
  comparisonHash: string;
}

export interface MasLicensingComparisonResult {
  isValid: boolean;
  profileVersion: typeof MAS_LICENSING_COMPARISON_PROFILE_VERSION;
  comparisonHash?: string;
  baselineDocumentHash?: string;
  verificationDocumentHash?: string;
  reason?: string;
}

export type MasComparisonHashBytes = (bytes: Uint8Array) => string;

interface DynamicRange {
  start: number;
  length: number;
}

interface ScannedHtmlTag {
  name: string;
  start: number;
  end: number;
  raw: string;
  closing: boolean;
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

export function encodeMasDocumentBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export function decodeMasDocumentBytes(base64: string): Uint8Array | undefined {
  if (typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(MAS_LICENSING_MAX_DOCUMENT_BYTES / 3) * 4 ||
      base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    return undefined;
  }
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return encodeMasDocumentBytes(bytes) === base64 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

function identifierCount(text: string, identifier: string): number {
  return text.split(identifier).length - 1;
}

function findTagEnd(text: string, start: number): number {
  let quote = '';
  for (let index = start + 1; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return -1;
}

/** Tokenizes enough HTML to distinguish real tags from comments and raw text. */
function scanHtmlTags(text: string): ScannedHtmlTag[] | undefined {
  const tags: ScannedHtmlTag[] = [];
  const rawTextNames = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);
  let index = 0;
  let templateDepth = 0;
  while (index < text.length) {
    if (text[index] !== '<') {
      index++;
      continue;
    }
    if (text.startsWith('<!--', index)) {
      const commentEnd = text.indexOf('-->', index + 4);
      if (commentEnd < 0) return undefined;
      index = commentEnd + 3;
      continue;
    }
    if (/^<!\[CDATA\[/i.test(text.slice(index, index + 9))) {
      const cdataEnd = text.indexOf(']]>', index + 9);
      if (cdataEnd < 0) return undefined;
      index = cdataEnd + 3;
      continue;
    }
    if (text.startsWith('<!', index) || text.startsWith('<?', index)) {
      const declarationEnd = findTagEnd(text, index);
      if (declarationEnd < 0) return undefined;
      index = declarationEnd;
      continue;
    }
    const opener = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)\b/.exec(text.slice(index));
    if (!opener) {
      index++;
      continue;
    }
    const end = findTagEnd(text, index);
    if (end < 0) return undefined;
    const raw = text.slice(index, end);
    const name = opener[2].toLowerCase();
    const closing = opener[1] === '/';
    if (templateDepth === 0) tags.push({ name, start: index, end, raw, closing });
    if (name === 'template') {
      if (closing && templateDepth === 0) return undefined;
      templateDepth += closing ? -1 : 1;
      templateDepth = Math.max(0, templateDepth);
      index = end;
      continue;
    }
    if (!closing && rawTextNames.has(name)) {
      // HTML ignores the self-closing flag for non-void elements such as
      // script and textarea. Reject it instead of treating generated-looking
      // markup after it as real tags.
      if (/\/\s*>$/.test(raw)) return undefined;
      if (name === 'plaintext') return tags;
      const closePattern = new RegExp(`<\\/${name}\\s*>`, 'ig');
      closePattern.lastIndex = end;
      const close = closePattern.exec(text);
      if (!close) return undefined;
      index = close.index + close[0].length;
      continue;
    }
    index = end;
  }
  return templateDepth === 0 ? tags : undefined;
}

function byteRanges(bytes: Uint8Array): DynamicRange[] | undefined {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAS_LICENSING_MAX_DOCUMENT_BYTES) return undefined;

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  if (!byteEqual(new TextEncoder().encode(text), bytes)) return undefined;

  // These exact reviewed tags are the only mutable fields in this profile. The
  // whole-string identifier counts reject duplicates and lookalike additions.
  if (identifierCount(text, 'VIcurrentDateTime') !== 1 || identifierCount(text, '__RequestVerificationToken') !== 2) return undefined;

  const tags = scanHtmlTags(text);
  if (!tags) return undefined;
  const timestampPattern = /^<meta name="VIcurrentDateTime" content="([0-9]{18})" \/>$/;
  const tokenPattern = /^<input name="__RequestVerificationToken" type="hidden" value="([A-Za-z0-9_-]{108})" \/>$/;
  const timestampTags = tags.filter(tag => !tag.closing && tag.raw.includes('VIcurrentDateTime'));
  const tokenTags = tags.filter(tag => !tag.closing && tag.raw.includes('__RequestVerificationToken'));
  if (timestampTags.length !== 1 || tokenTags.length !== 2) return undefined;
  const timestamp = timestampPattern.exec(timestampTags[0].raw);
  if (!timestamp) return undefined;
  const matches: Array<{ index: number; tag: string; value: string }> = [{
    index: timestampTags[0].start,
    tag: timestampTags[0].raw,
    value: timestamp[1]
  }];
  const tokenMatches: Array<{ index: number; tag: string; value: string }> = [];
  for (const tag of tokenTags) {
    const token = tokenPattern.exec(tag.raw);
    if (!token) return undefined;
    tokenMatches.push({ index: tag.start, tag: tag.raw, value: token[1] });
  }

  const fields = [...matches, ...tokenMatches].sort((left, right) => left.index - right.index);
  return fields.map(({ index, tag, value }) => {
    const valueStart = index + tag.indexOf(value);
    return {
      start: new TextEncoder().encode(text.slice(0, valueStart)).byteLength,
      length: new TextEncoder().encode(value).byteLength
    };
  });
}

function maskedBytes(bytes: Uint8Array, ranges: DynamicRange[]): Uint8Array {
  const masked = new Uint8Array(bytes);
  for (const range of ranges) masked.fill(0, range.start, range.start + range.length);
  return masked;
}

/**
 * Compares complete raw HTML documents while allowing only the three exact,
 * equal-length MAS licensing page security/timestamp values reviewed in V1.
 * The comparison never returns or logs those field values.
 */
export function compareMasLicensingHtml(
  baselineBytes: Uint8Array,
  verificationBytes: Uint8Array,
  hashBytes: MasComparisonHashBytes
): MasLicensingComparisonResult {
  const baselineRanges = byteRanges(baselineBytes);
  const verificationRanges = byteRanges(verificationBytes);
  if (!baselineRanges || !verificationRanges || baselineRanges.length !== 3 || verificationRanges.length !== 3) {
    return {
      isValid: false,
      profileVersion: MAS_LICENSING_COMPARISON_PROFILE_VERSION,
      reason: 'The MAS licensing HTML does not match the exact reviewed dynamic-field structure'
    };
  }
  if (baselineBytes.byteLength !== verificationBytes.byteLength || baselineRanges.some((range, index) => {
    const freshRange = verificationRanges[index];
    return range.start !== freshRange.start || range.length !== freshRange.length;
  })) {
    return {
      isValid: false,
      profileVersion: MAS_LICENSING_COMPARISON_PROFILE_VERSION,
      reason: 'The MAS licensing HTML dynamic-field offsets or lengths changed'
    };
  }

  const baselineMasked = maskedBytes(baselineBytes, baselineRanges);
  const verificationMasked = maskedBytes(verificationBytes, verificationRanges);
  const comparisonHash = hashBytes(baselineMasked);
  if (!byteEqual(baselineMasked, verificationMasked)) {
    return {
      isValid: false,
      profileVersion: MAS_LICENSING_COMPARISON_PROFILE_VERSION,
      comparisonHash,
      baselineDocumentHash: hashBytes(baselineBytes),
      verificationDocumentHash: hashBytes(verificationBytes),
      reason: 'The MAS licensing HTML changed outside the three reviewed generated values'
    };
  }

  return {
    isValid: true,
    profileVersion: MAS_LICENSING_COMPARISON_PROFILE_VERSION,
    comparisonHash,
    baselineDocumentHash: hashBytes(baselineBytes),
    verificationDocumentHash: hashBytes(verificationBytes)
  };
}

export function createMasLicensingComparisonPolicy(
  bytes: Uint8Array,
  documentHash: string,
  hashBytes: MasComparisonHashBytes
): MasLicensingComparisonPolicy | undefined {
  if (hashBytes(bytes).toLowerCase() !== documentHash.toLowerCase()) return undefined;
  const comparison = compareMasLicensingHtml(bytes, bytes, hashBytes);
  if (!comparison.isValid || !comparison.comparisonHash) return undefined;
  return {
    profileVersion: MAS_LICENSING_COMPARISON_PROFILE_VERSION,
    originalBodyBase64: encodeMasDocumentBytes(bytes),
    comparisonHash: comparison.comparisonHash
  };
}
