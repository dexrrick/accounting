/**
 * Labelled retrieval evaluation set.
 *
 * Keep cases realistic, deterministic, and traceable to an approved registry record.
 * Add a case whenever a retrieval defect is corrected.
 */
export const retrievalEvaluationCases = [
  {
    id: 'iras-general-deductibility',
    query: 'Are ordinary business expenses deductible for Singapore corporate income tax?',
    domain: 'IRAS_TAX',
    authorities: ['IRAS'],
    expectedRecordId: 'ITA_SEC14_GENERAL_DEDUCTION',
    expectedAuthority: 'IRAS'
  },
  {
    id: 'acra-record-retention',
    query: 'How long must a Singapore company keep its accounting records?',
    domain: 'ACRA_CORP',
    authorities: ['ACRA'],
    expectedRecordId: 'ACRA_SEC199_RECORD_RETENTION',
    expectedAuthority: 'ACRA'
  },
  {
    id: 'mom-annual-leave',
    query: 'What is the statutory annual leave entitlement under the Employment Act?',
    domain: 'MOM_EMPLOYMENT',
    authorities: ['MOM'],
    expectedRecordId: 'MOM_SEC88A_ANNUAL_LEAVE',
    expectedAuthority: 'MOM'
  },
  {
    id: 'cpf-wage-ceiling-2026',
    query: 'What is the CPF ordinary wage ceiling in 2026?',
    domain: 'CPF_BOARD',
    authorities: ['CPF'],
    targetDate: '2026-06-01',
    expectedRecordId: 'CPF_WAGE_CEILINGS_2026',
    expectedAuthority: 'CPF'
  },
  {
    id: 'gst-current-rate',
    query: 'What is the Singapore GST rate in 2026?',
    domain: 'IRAS_GST',
    authorities: ['IRAS'],
    targetDate: '2026-06-01',
    expectedRecordId: 'GST_RATE_9_PERCENT',
    expectedAuthority: 'IRAS',
    excludedRecordIds: ['GST_RATE_7_PERCENT', 'GST_RATE_8_PERCENT_2023']
  },
  {
    id: 'gst-historical-rate-2023',
    query: 'What was the Singapore GST rate in June 2023?',
    domain: 'IRAS_GST',
    authorities: ['IRAS'],
    targetDate: '2023-06-01',
    includeHistorical: true,
    expectedRecordId: 'GST_RATE_8_PERCENT_2023',
    expectedAuthority: 'IRAS',
    excludedRecordIds: ['GST_RATE_9_PERCENT']
  }
];

export const retrievalQualityThresholds = {
  minimumTopThreeRecall: 1,
  minimumAuthorityPrecisionAtOne: 1,
  minimumTemporalExclusionRate: 1,
  repetitionsForDeterminism: 3
};
