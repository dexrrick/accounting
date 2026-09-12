import type { QueryDomain, StatutoryAuthority } from '../types/accounting';

export type CoveragePriority = 'P1' | 'P2' | 'P3';
export type CoverageStatus = 'PLANNED' | 'IMPLEMENTING' | 'VALIDATED';

/**
 * Phase 7 coverage contract. A topic progresses to VALIDATED only after its
 * source, retrieval, scenario, uncertainty, and regression requirements pass.
 */
export interface SingaporeCoverageTopic {
  id: string;
  title: string;
  priority: CoveragePriority;
  status: CoverageStatus;
  domains: QueryDomain[];
  authorities: StatutoryAuthority[];
  sourceRecordIds: string[];
  requiredChecks: Array<
    'SOURCE_PROVENANCE' |
    'RETRIEVAL_EVALUATION' |
    'TEMPORAL_VALIDITY' |
    'ACCOUNTING_OR_CALCULATION_RULE' |
    'MISSING_FACT_GUARD' |
    'REGRESSION_TEST'
  >;
}

const fullTopicPackChecks: SingaporeCoverageTopic['requiredChecks'] = [
  'SOURCE_PROVENANCE',
  'RETRIEVAL_EVALUATION',
  'TEMPORAL_VALIDITY',
  'ACCOUNTING_OR_CALCULATION_RULE',
  'MISSING_FACT_GUARD',
  'REGRESSION_TEST'
];

export const SINGAPORE_COVERAGE_REGISTRY: SingaporeCoverageTopic[] = [
  {
    id: 'corporate-tax-adjustments',
    title: 'Corporate tax deductibility and tax adjustments',
    priority: 'P1',
    status: 'IMPLEMENTING',
    domains: ['IRAS_TAX'],
    authorities: ['IRAS'],
    sourceRecordIds: ['ITA_SEC14_GENERAL_DEDUCTION', 'ITA_SEC15_PROHIBITED_DEDUCTIONS', 'ITA_SEC19_19A_CAPITAL_ALLOWANCES'],
    requiredChecks: fullTopicPackChecks
  },
  {
    id: 'gst-registration-and-input-tax',
    title: 'GST registration and input-tax eligibility',
    priority: 'P1',
    status: 'IMPLEMENTING',
    domains: ['IRAS_GST'],
    authorities: ['IRAS'],
    sourceRecordIds: ['GST_REGISTRATION_COMPULSORY_THRESHOLD', 'GST_REG26_BLOCKED_INPUT_TAX', 'GST_SEC14_REVERSE_CHARGE'],
    requiredChecks: fullTopicPackChecks
  },
  {
    id: 'cpf-and-sdl-payroll',
    title: 'CPF contributions, wage ceilings, and Skills Development Levy',
    priority: 'P1',
    status: 'IMPLEMENTING',
    domains: ['CPF_BOARD'],
    authorities: ['CPF'],
    sourceRecordIds: ['CPF_RATES_BY_AGE_2026', 'CPF_WAGE_CEILINGS_2026', 'CPF_SDL_SKILLS_DEVELOPMENT_LEVY'],
    requiredChecks: fullTopicPackChecks
  },
  {
    id: 'revenue-recognition',
    title: 'Revenue recognition and contract balances',
    priority: 'P2',
    status: 'PLANNED',
    domains: ['ACCOUNTING_SFRS'],
    authorities: ['ACRA'],
    sourceRecordIds: ['SFRS_I_15_REVENUE'],
    requiredChecks: fullTopicPackChecks
  },
  {
    id: 'lease-accounting',
    title: 'Lease accounting and subsequent measurement',
    priority: 'P2',
    status: 'PLANNED',
    domains: ['ACCOUNTING_SFRS'],
    authorities: ['ACRA'],
    sourceRecordIds: ['IFRS16_LEASE_INCEPTION', 'IFRS16_SUBSEQUENT_MEASUREMENT'],
    requiredChecks: fullTopicPackChecks
  },
  {
    id: 'share-capital-and-corporate-records',
    title: 'Share capital and corporate recordkeeping',
    priority: 'P2',
    status: 'IMPLEMENTING',
    domains: ['ACRA_CORP'],
    authorities: ['ACRA'],
    sourceRecordIds: ['ACRA_SEC68_NO_PAR_VALUE_SHARES', 'ACRA_SEC199_RECORD_RETENTION', 'ACRA_SEC78B_CAPITAL_REDUCTION'],
    requiredChecks: fullTopicPackChecks
  }
];

export function getCoverageTopicsByPriority(priority: CoveragePriority): SingaporeCoverageTopic[] {
  return SINGAPORE_COVERAGE_REGISTRY.filter(topic => topic.priority === priority);
}
