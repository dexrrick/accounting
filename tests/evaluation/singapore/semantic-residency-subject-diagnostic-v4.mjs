import { createHash } from 'node:crypto';

export const RESIDENCY_SUBJECT_CONCEPT_ORDER = Object.freeze([
  'COMPANY',
  'TAX',
  'RESIDENCE',
  'NON_RESIDENT',
  'SINGAPORE',
  'CONTROL_MANAGEMENT',
  'CERTIFICATE_RESIDENCE'
]);

export const RESIDENCY_SUBJECT_REASON_CODES = Object.freeze([
  'EXACT_ANCHOR_HIT',
  'NO_EXACT_ANCHOR',
  'COMPANY_MISSING',
  'TAX_MISSING',
  'RESIDENCE_MISSING',
  'JURISDICTION_MISSING',
  'CONCEPT_EQUIVALENT_CANDIDATE',
  'MATERIAL_CONCEPT_MISSING'
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function has(text, pattern) {
  return pattern.test(text);
}

/** Returns only the fixed allowlisted subject features; the input is never returned. */
export function deriveResidencySubjectFeatures(subject) {
  const text = typeof subject === 'string' ? subject : '';
  const nonResident = has(text, /\bnon[\s-]?resident\b/i);
  const residenceWord = has(text, /\b(?:resident|residency|residence)\b/i);
  const features = {
    COMPANY: has(text, /\b(?:company|companies|corporate|corporation)\b/i) || has(text, /\bbusiness\s+entity\b/i),
    TAX: has(text, /\b(?:tax|taxation)\b/i),
    RESIDENCE: residenceWord,
    NON_RESIDENT: nonResident,
    SINGAPORE: has(text, /\b(?:singapore|sg)\b/i),
    CONTROL_MANAGEMENT: (has(text, /\bcontrol\b/i) && has(text, /\bmanagement\b/i)) ||
      has(text, /\bstrategic\s+decisions?\b/i) ||
      has(text, /\bboard\s+(?:of\s+directors?\s+)?(?:management|decisions?)\b/i),
    CERTIFICATE_RESIDENCE: has(text, /\bcertificate\s+of\s+residence\b/i) ||
      (residenceWord && has(text, /\bCOR\b/))
  };
  const bitVector = RESIDENCY_SUBJECT_CONCEPT_ORDER.map(id => features[id] ? '1' : '0').join('');
  return {
    concepts: features,
    conceptBitVectorSha256: sha256(bitVector)
  };
}

/** Uses subject text alone; jurisdiction may only come from the frozen question design. */
export function diagnoseResidencySubject({ subject, exactMatcherPass, jurisdictionFixed = false }) {
  const { concepts, conceptBitVectorSha256 } = deriveResidencySubjectFeatures(subject);
  const exactPass = exactMatcherPass === true;
  const reasonCodes = [];
  if (exactPass) {
    reasonCodes.push('EXACT_ANCHOR_HIT');
  } else {
    reasonCodes.push('NO_EXACT_ANCHOR');
    if (!concepts.COMPANY) reasonCodes.push('COMPANY_MISSING');
    if (!concepts.TAX) reasonCodes.push('TAX_MISSING');
    if (!concepts.RESIDENCE) reasonCodes.push('RESIDENCE_MISSING');
    const coreConceptsPresent = concepts.COMPANY && concepts.TAX && concepts.RESIDENCE;
    const jurisdictionPresent = concepts.SINGAPORE || jurisdictionFixed === true;
    if (!jurisdictionPresent) reasonCodes.push('JURISDICTION_MISSING');
    if (coreConceptsPresent && jurisdictionPresent) {
      reasonCodes.push('CONCEPT_EQUIVALENT_CANDIDATE');
    } else {
      reasonCodes.push('MATERIAL_CONCEPT_MISSING');
    }
  }
  return {
    exactMatcherPass: exactPass,
    concepts,
    conceptBitVectorSha256,
    reasonCodes
  };
}
