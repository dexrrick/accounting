function normalizeEvidenceText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True only when the text states an operative company annual-return filing duty. */
export function supportsAcraAnnualReturnFilingRule(text: string): boolean {
  const companySubject = String.raw`(?:(?:all|each|every|local|private|registered|incorporated|singapore(?:an)?)\s+)*(?:a\s+)?compan(?:y|ies)(?:\s+registered\s+in\s+singapore)?`;
  const obligation = String.raw`(?:must|shall|need to|needs to|have to|has to|are required to|is required to|are to|is to)`;
  const annualReturn = String.raw`(?:(?:the|an?|their|its)\s+)?annual returns?`;
  const activeFilingRule = new RegExp(String.raw`^${companySubject}(?:\s+in\s+singapore)?\s+${obligation}\s+(?:file|lodge|submit)\s+${annualReturn}\b`);
  const passiveFilingRule = new RegExp(String.raw`^${annualReturn}\s+(?:${obligation}\s+)?be\s+(?:filed|lodged|submitted)\s+by\s+${companySubject}\b`);
  return text.split(/(?<=[.!?;])\s+|[\r\n]+/).some(sentence => {
    const trimmed = sentence.trim();
    if (!trimmed || trimmed.endsWith('?')) return false;
    const normalized = normalizeEvidenceText(sentence);
    if (/\b(?:vccs?|variable capital compan(?:y|ies))\b/.test(normalized)) return false;
    return activeFilingRule.test(normalized) || passiveFilingRule.test(normalized);
  });
}
