export type CorporateTaxTreatment =
  | 'DEDUCTIBLE_SUBJECT_TO_EVIDENCE'
  | 'NON_DEDUCTIBLE_ADD_BACK'
  | 'CAPITAL_ALLOWANCE_REVIEW';

export interface CorporateTaxAssessment {
  treatment: CorporateTaxTreatment;
  summary: string;
  reviewNotice?: string;
  sourceRecordIds: string[];
}

/**
 * Conservative, explainable first-pass assessment for a corporate expense.
 * It never converts an accounting journal into an unconditional tax conclusion.
 */
export function assessCorporateTaxTreatment(query: string): CorporateTaxAssessment {
  const normalized = query.toLowerCase();

  if (/\b(fine|penalt(?:y|ies)|private|personal|director(?:'s)? expense|shareholder(?:'s)? expense)\b/.test(normalized)) {
    return {
      treatment: 'NON_DEDUCTIBLE_ADD_BACK',
      summary: 'This appears to be private, domestic, or penalty expenditure. It should be added back in the corporate tax computation rather than claimed as a Section 14 deduction.',
      reviewNotice: 'Confirm the beneficiary and business purpose. A director/shareholder payment may also require separate accounting and corporate-governance review.',
      sourceRecordIds: ['ITA_SEC15_PROHIBITED_DEDUCTIONS']
    };
  }

  if (/\b(depreciation|capital expenditure|capital asset|plant|machinery|equipment|computer|renovation|refurbishment)\b/.test(normalized)) {
    return {
      treatment: 'CAPITAL_ALLOWANCE_REVIEW',
      summary: 'Accounting depreciation and capital expenditure are not a direct Section 14 deduction. Review whether the asset qualifies for capital allowances and apply the relevant statutory rules.',
      reviewNotice: 'Confirm asset type, business use, acquisition date, and any exclusion before claiming capital allowances.',
      sourceRecordIds: ['ITA_SEC15_PROHIBITED_DEDUCTIONS', 'ITA_SEC19_19A_CAPITAL_ALLOWANCES']
    };
  }

  return {
    treatment: 'DEDUCTIBLE_SUBJECT_TO_EVIDENCE',
    summary: 'The expense may be deductible under Section 14(1) only if it was wholly and exclusively incurred in producing business income and is supported by records.',
    reviewNotice: 'Retain invoices and evidence of business purpose; private, capital, and prohibited expenditure must be added back.',
    sourceRecordIds: ['ITA_SEC14_GENERAL_DEDUCTION', 'ITA_SEC15_PROHIBITED_DEDUCTIONS']
  };
}
