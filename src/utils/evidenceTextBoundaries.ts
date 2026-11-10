const ATTACHED_QUALIFICATION_START = /^(?:however\b|except(?:ions?)?\b|provided\b|unless\b|but\b|subject to\b|notwithstanding\b|nevertheless\b|in contrast\b)/i;

export function normalizeEvidenceText(value: string): string {
  return value.normalize('NFC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function startsAttachedEvidenceQualification(value: string): boolean {
  return ATTACHED_QUALIFICATION_START.test(normalizeEvidenceText(value));
}
