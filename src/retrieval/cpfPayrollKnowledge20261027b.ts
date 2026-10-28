import type {
  AuthorityPresentedIssue,
  AuthorityPresentedSource,
  AuthorityPresentedWorkstream
} from '../utils/authorityEvidencePresentation';
import { groupExactIssueClaimsByDocument } from '../utils/authorityEvidencePresentation';
import { TargetDateResolver } from './targetDateResolver';
import { isIrasCpfQualitativeRateFactorRequest } from './irasCpfCoverageRules';

const CPF_RATE_TABLE_URL =
  'https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf';
const CPF_COMPUTATION_URL =
  'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay';
const CPF_OW_CEILING_URL =
  'https://www.cpf.gov.sg/service/article/what-is-the-ordinary-wage-ow-ceiling-mbr';
const CPF_AW_CEILING_URL =
  'https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000KUuZCYA1';
const CPF_PR_STATUS_URL =
  'https://www.cpf.gov.sg/service/article/i-have-successfully-applied-for-a-new-re-entry-permit-and-retained-my-singapore-permanent-resident-status-how-will-this-impact-my-cpf-contributions';

export interface CpfPayrollKnowledgeRequest {
  authority: string;
  topicId: string;
  query: string;
  subject: string;
  sourceText: string;
  officialUrl?: string;
}

export type CpfPayrollKnowledgeRuleId =
  | 'CPF_2026_CONTRIBUTION_TABLES'
  | 'CPF_CONTRIBUTION_METHOD'
  | 'CPF_ORDINARY_WAGE_CEILINGS'
  | 'CPF_2026_ADDITIONAL_WAGE_CEILING'
  | 'CPF_PERMANENT_RESIDENT_YEAR';

export interface CpfPayrollKnowledgeRule {
  id: CpfPayrollKnowledgeRuleId;
  authority: 'CPF';
  topicIds: readonly string[];
  officialUrl: string;
  title: string;
  fixtureFile: string;
  fixtureKind: 'WEB_READ_OFFICIAL_VISIBLE_TEXT_EXCERPT' | 'NATIVE_OFFICIAL_PDF';
  excerptFile: string;
  population: string;
  rule: string;
  provisions: readonly string[];
  conditions: readonly string[];
  exceptions: readonly string[];
  requiredFacts: readonly string[];
  effectiveDateEvidence: string;
  limitations: readonly string[];
}

export interface CpfPayrollKnowledgeEvidence {
  authority: 'CPF';
  ruleId: CpfPayrollKnowledgeRuleId;
  text: string;
  title: string;
  officialUrl: string;
}

const RATE_TOPICS = [
  'cpf_contribution_rates',
  'cpf-pr-contribution-rates',
  'cpf-contribution-computation',
  'cpf-contribution-rounding'
] as const;

/**
 * Source text retained from official CPF Board web-visible HTML/PDF content.
 * Each file is a transparently labelled excerpt, not a claim to be the
 * underlying server response or original PDF bytes.
 */
export const CPF_PAYROLL_KNOWLEDGE_RULES_20261027B: readonly CpfPayrollKnowledgeRule[] = Object.freeze([
  {
    id: 'CPF_2026_CONTRIBUTION_TABLES', authority: 'CPF', topicIds: RATE_TOPICS,
    officialUrl: CPF_RATE_TABLE_URL, title: 'CPF Contribution Rate Table from 1 January 2026',
    fixtureFile: 'cpf-rates-native-2026.pdf', fixtureKind: 'NATIVE_OFFICIAL_PDF',
    excerptFile: 'cpf-rate-tables-2026-extract.txt',
    population: 'Employees of private-sector employers and non-pensionable employees of ministries, statutory bodies and aided schools who are Singapore Citizens or Permanent Residents',
    rule: 'The official 2026 table has five schedules: full rates for Singapore Citizens and third-year-onward SPRs; graduated employer/graduated employee rates for first- and second-year SPRs; and, after CPF Board approval, full employer/graduated employee schedules for first- and second-year SPRs. Each schedule varies by the table’s age bands and monthly total-wage bands, with Ordinary Wages capped at S$8,000 and Additional Wages capped separately.',
    provisions: ['CPF Act 1953 First Schedule contribution rates, as presented in CPF Board’s Tables 1–5; this module does not independently interpret the Schedule text.'],
    conditions: ['The retained table states rates from 1 January 2026.', 'Use the first-year or second-year PR schedule only within the corresponding PR-status year.', 'Full employer/graduated employee or full employer/full employee options for first/second year require a joint higher-rate application and CPF Board approval.', 'The PDF expressly scopes its tables to private-sector and non-pensionable employees.'],
    exceptions: ['Pensionable public-service employees, platform workers, self-employed persons, wages not classified as CPF-payable OW/AW, and rates outside the 2026 table are not calculated by this module.', 'The 2027 update notice means 2026 rates must not be reused for 2027 payroll.'],
    requiredFacts: ['Contribution month in 2026.', 'Singapore Citizen or SPR status; for an SPR, conversion date and applicable table/election.', 'Date of birth, since an age-group rate changes from the first day of the month after a 55th, 60th, 65th or 70th birthday.', 'Private-sector or non-pensionable employment scope.', 'The classified OW and AW amounts payable for the month.'],
    effectiveDateEvidence: 'The document titles all five tables “from 1 January 2026”. CPF Board’s computation page, retained separately, states that senior-employee rates increase from 1 January 2027. The source does not establish a single end date for every age group.',
    limitations: ['Only the 2026 tables are retained. Do not apply them to 2025 or 2027.', 'The retained text excerpt is extracted from the retained original official PDF bytes; its digest is recorded separately from the PDF digest.']
  },
  {
    id: 'CPF_CONTRIBUTION_METHOD', authority: 'CPF', topicIds: RATE_TOPICS,
    officialUrl: CPF_COMPUTATION_URL, title: 'How much CPF contributions to pay',
    fixtureFile: 'cpf-computation-guidance-extract.txt', fixtureKind: 'WEB_READ_OFFICIAL_VISIBLE_TEXT_EXCERPT',
    excerptFile: 'cpf-computation-guidance-extract.txt',
    population: 'CPF-contributing employers and employees; private-sector / non-pensionable table computations',
    rule: 'Choose a contribution table from citizenship or SPR year, then age group and monthly wage band; compute on Total Wages made up of Ordinary Wages and Additional Wages, subject to their separate ceilings. Where monthly total wages are above S$50 and at or below S$500, the employee share is nil while the employer share is payable. Round the combined total contribution to the nearest dollar (50 cents rounds up), discard cents from the employee share, and calculate employer share as total less employee share.',
    provisions: ['CPF Board’s published employer computation sequence; the public page identifies the Central Provident Fund Act contribution framework but does not set out a paragraph number in the retained passage.'],
    conditions: ['The 2026 summary rate table applies to Singaporeans and SPRs from year three onward with monthly wages above S$750.', 'Select the correct full or graduated SPR table and age group before calculating.', 'When OW and AW are both payable, calculate and sum the contributions for both before applying the rounding rules.'],
    exceptions: ['An employee earning exactly S$50 or less is below the page’s contribution threshold.', 'The retained high-level page does not reproduce the full graduated rate schedules; consult the linked 2026 PDF for those rates.'],
    requiredFacts: ['Contribution period, status/PR year, birthday, wage components, applicable ceilings and whether an SPR higher-rate election was approved.'],
    effectiveDateEvidence: 'The page identifies the summary as rates from 1 January 2026 and separately reports that senior-worker contribution rates increase from 1 January 2027.',
    limitations: ['A general method explanation does not determine a company’s actual payroll without employee and wage facts.', 'This retained excerpt does not support historical rates or the detailed contribution amount for cases outside the linked 2026 tables.']
  },
  {
    id: 'CPF_ORDINARY_WAGE_CEILINGS', authority: 'CPF', topicIds: ['cpf-ordinary-wages', 'cpf-ordinary-wage-ceiling', 'cpf_wage_ceiling'],
    officialUrl: CPF_OW_CEILING_URL, title: 'What is the Ordinary Wage (OW) ceiling?',
    fixtureFile: 'cpf-ow-ceiling-extract.txt', fixtureKind: 'WEB_READ_OFFICIAL_VISIBLE_TEXT_EXCERPT',
    excerptFile: 'cpf-ow-ceiling-extract.txt',
    population: 'Employees subject to CPF contributions on Ordinary Wages',
    rule: 'The monthly Ordinary Wage ceiling is S$8,000 from 1 January 2026; the official table also gives prior dated ceilings and keeps the annual salary ceiling at S$102,000 through the listed periods.',
    provisions: ['CPF Board’s dated salary-ceiling table.'],
    conditions: ['Apply the dated value for the payroll period rather than using the current amount for another year.', 'The S$8,000 ceiling is monthly and applies to OW, not to the independent AW ceiling.'],
    exceptions: ['The retained page does not provide all possible exception or special-population rules for every public-service employment regime.'],
    requiredFacts: ['The payroll year or date, employee/employment coverage and the amount classified as OW.'],
    effectiveDateEvidence: 'The official table specifies S$7,400 for 1 January–31 December 2025 and S$8,000 from 1 January 2026.',
    limitations: ['It gives the ceiling, not the amount or rate of an individual contribution.', 'The page was last updated 14 August 2026; that retrieval/update date is not used as a legal effective date.']
  },
  {
    id: 'CPF_2026_ADDITIONAL_WAGE_CEILING', authority: 'CPF', topicIds: ['cpf-additional-wages', 'cpf-additional-wage-ceiling'],
    officialUrl: CPF_AW_CEILING_URL, title: 'Examples for computation of Additional Wage (AW) Ceiling',
    fixtureFile: 'cpf-aw-ceiling-native-2026.pdf', fixtureKind: 'NATIVE_OFFICIAL_PDF',
    excerptFile: 'cpf-aw-ceiling-2026-extract.txt',
    population: 'Singapore Citizens and Singapore Permanent Residents, for each employer and calendar year',
    rule: 'The annual AW ceiling equals S$102,000 minus Ordinary Wages subject to CPF for the year. At an AW payment, estimate the ceiling using the year’s expected OW, subtract AW already subject to CPF, and cap the current AW at the available remainder. Recalculate using actual OW in the last month of employment or December, whichever occurs first; adjust any shortfall and seek a refund for excess contributions.',
    provisions: ['CPF Board AW-ceiling computation examples and employer instructions.'],
    conditions: ['The ceiling is per employer, per year, and applies to Singapore Citizens and SPRs.', 'Use the year in which the AW is due and payable: a 2025 bonus payable in 2026 uses 2026 limits.', 'At non-final AW payments, use a supported estimate of OW expected for the whole year; at final settlement, use actual OW up through that payroll month.'],
    exceptions: ['First-/second-year SPRs use their applicable contribution-rate tables even though the AW ceiling formula is the same.', 'A refund or shortfall on prior payments requires review of the payroll already submitted; this calculator only determines current eligible AW and does not submit adjustments.'],
    requiredFacts: ['Due-and-payable year and date.', 'Current AW amount and prior AW already subject to CPF for this employer/year.', 'Actual prior OW subject to CPF and either the complete expected annual OW subject to CPF or an identified final month of employment/year.'],
    effectiveDateEvidence: 'The official examples state that the AW payable-date year controls and expressly show the 2026 ceiling calculation using S$102,000 and the S$8,000 monthly OW ceiling.',
    limitations: ['The retained text excerpt is extracted from the retained original official PDF bytes; its digest is recorded separately from the PDF digest.', 'A future OW estimate is a required input before final settlement and can change; a source retrieval date cannot supply it.']
  },
  {
    id: 'CPF_PERMANENT_RESIDENT_YEAR', authority: 'CPF', topicIds: ['cpf-pr-contribution-rates', 'cpf_contribution_rates'],
    officialUrl: CPF_PR_STATUS_URL, title: 'I have successfully applied for a new re-entry permit and retained my Singapore Permanent Resident status. How will this impact my CPF contributions?',
    fixtureFile: 'cpf-pr-year-status-extract.txt', fixtureKind: 'WEB_READ_OFFICIAL_VISIBLE_TEXT_EXCERPT',
    excerptFile: 'cpf-pr-year-status-extract.txt',
    population: 'Singapore Permanent Residents earning wages in Singapore',
    rule: 'First-year rates apply from the date PR status is obtained to the last day of the month of the first anniversary. Second-year rates apply from the following month through the last day of the month of the second anniversary. Third-year rates start in the month after that second anniversary.',
    provisions: ['CPF Board’s PR-year instructions, referring to the ICA Entry Permit Form 5/5A as the status-date evidence.'],
    conditions: ['Use the Entry Permit date as the date status was obtained.', 'The year transitions occur by calendar month; the second and third years begin on the first day of the month following the relevant anniversary.'],
    exceptions: ['The first calendar month may begin partway through the month on the actual PR-conversion date.', 'A jointly elected higher contribution basis during the first two years requires CPF Board approval; year calculation by itself does not prove an election.'],
    requiredFacts: ['Date PR status was obtained.', 'Contribution month.', 'Whether a higher contribution option was jointly requested and approved, if applicable.'],
    effectiveDateEvidence: 'The rule is described on a CPF Board page last updated 11 March 2026; the page does not identify a separate commencement date for the displayed PR-year method.',
    limitations: ['This rule selects the PR year only; rates still require the official table for the payroll year and a supported election.', 'The example date is illustrative and does not establish retroactive rates for any other historical period.']
  }
]);

export const CPF_PAYROLL_KNOWLEDGE_SOURCE_CATALOG_20261027B = Object.freeze(
  CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.map(rule => ({
    authority: rule.authority,
    topicIds: rule.topicIds,
    ruleId: rule.id,
    url: rule.officialUrl,
    title: rule.title,
    fixtureFile: rule.fixtureFile,
    fixtureKind: rule.fixtureKind,
    excerptFile: rule.excerptFile
  }))
);

export interface CpfPayrollCalculationInput {
  /** Only 2026 is calculated from this module’s retained rate tables. */
  contributionMonth: string;
  employmentScope: 'PRIVATE_SECTOR' | 'NON_PENSIONABLE_PUBLIC' | 'PENSIONABLE_PUBLIC' | 'OTHER';
  citizenship: 'SINGAPORE_CITIZEN' | 'PERMANENT_RESIDENT' | 'OTHER';
  dateOfBirth: string;
  permanentResidentStartDate?: string;
  /** Must be explicit for a first- or second-year SPR. */
  prRateElection?: 'GRADUATED_GG' | 'FULL_EMPLOYER_GRADUATED_EMPLOYEE_APPROVED' | 'FULL_EMPLOYER_FULL_EMPLOYEE_APPROVED';
  ordinaryWageCents: number;
  additionalWageCents: number;
  /** Previously-paid, CPF-subject 2026 OW for this employer, before this month. */
  priorYearToDateOrdinaryWageSubjectCents: number;
  /** Previously-paid, CPF-subject 2026 AW for this employer, before this payment. */
  priorYearToDateAdditionalWageSubjectCents: number;
  /** Expected full-year OW subject to CPF at a non-final AW payment. */
  estimatedFullYearOrdinaryWageSubjectCents: number;
  /** true if this is the employee’s last employment month in the year. December is always final. */
  isLastMonthOfEmployment: boolean;
  /** The wages above have already been classified as CPF-payable OW/AW by the employer. */
  wagesAreCpfClassified: true;
}

export type CpfPayrollCalculationResult =
  | {
    status: 'CALCULATED';
    period: string;
    prYear?: 1 | 2 | 3;
    ageBand: string;
    rateSchedule: string;
    ordinaryWageSubjectCents: number;
    additionalWageSubjectCents: number;
    remainingAwCeilingCents: number;
    projectedAnnualOwSubjectCents: number;
    totalContributionCents: number;
    employeeContributionCents: number;
    employerContributionCents: number;
    explanation: string;
  }
  | {
    status: 'REVIEW_REQUIRED';
    reason: string;
    period: string;
  }
  | {
    status: 'UNSUPPORTED';
    reason: string;
  };

type AgeRow = { ageBand: string; ceiling: number; lowerWageEmployerBps: number;
  lowerWageEmployeeRampBps: number; employerBps: number; employeeBps: number };
const RATE_SCHEDULES: Record<string, readonly AgeRow[]> = {
  SC_OR_PR3: [
    { ageBand: '55 and below', ceiling: 55, lowerWageEmployerBps: 1700, lowerWageEmployeeRampBps: 6000, employerBps: 1700, employeeBps: 2000 },
    { ageBand: 'above 55 to 60', ceiling: 60, lowerWageEmployerBps: 1600, lowerWageEmployeeRampBps: 5400, employerBps: 1600, employeeBps: 1800 },
    { ageBand: 'above 60 to 65', ceiling: 65, lowerWageEmployerBps: 1250, lowerWageEmployeeRampBps: 3750, employerBps: 1250, employeeBps: 1250 },
    { ageBand: 'above 65 to 70', ceiling: 70, lowerWageEmployerBps: 900, lowerWageEmployeeRampBps: 2250, employerBps: 900, employeeBps: 750 },
    { ageBand: 'above 70', ceiling: Number.POSITIVE_INFINITY, lowerWageEmployerBps: 750, lowerWageEmployeeRampBps: 1500, employerBps: 750, employeeBps: 500 }
  ],
  PR1_GG: [
    { ageBand: '55 and below', ceiling: 55, lowerWageEmployerBps: 400, lowerWageEmployeeRampBps: 1500, employerBps: 400, employeeBps: 500 },
    { ageBand: 'above 55 to 60', ceiling: 60, lowerWageEmployerBps: 400, lowerWageEmployeeRampBps: 1500, employerBps: 400, employeeBps: 500 },
    { ageBand: 'above 60 to 65', ceiling: 65, lowerWageEmployerBps: 350, lowerWageEmployeeRampBps: 1500, employerBps: 350, employeeBps: 500 },
    { ageBand: 'above 65', ceiling: Number.POSITIVE_INFINITY, lowerWageEmployerBps: 350, lowerWageEmployeeRampBps: 1500, employerBps: 350, employeeBps: 500 }
  ],
  PR2_GG: [
    { ageBand: '55 and below', ceiling: 55, lowerWageEmployerBps: 900, lowerWageEmployeeRampBps: 4500, employerBps: 900, employeeBps: 1500 },
    { ageBand: 'above 55 to 60', ceiling: 60, lowerWageEmployerBps: 600, lowerWageEmployeeRampBps: 3750, employerBps: 600, employeeBps: 1250 },
    { ageBand: 'above 60 to 65', ceiling: 65, lowerWageEmployerBps: 350, lowerWageEmployeeRampBps: 2250, employerBps: 350, employeeBps: 750 },
    { ageBand: 'above 65', ceiling: Number.POSITIVE_INFINITY, lowerWageEmployerBps: 350, lowerWageEmployeeRampBps: 1500, employerBps: 350, employeeBps: 500 }
  ],
  PR1_FG: [
    { ageBand: '55 and below', ceiling: 55, lowerWageEmployerBps: 1700, lowerWageEmployeeRampBps: 1500, employerBps: 1700, employeeBps: 500 },
    { ageBand: 'above 55 to 60', ceiling: 60, lowerWageEmployerBps: 1600, lowerWageEmployeeRampBps: 1500, employerBps: 1600, employeeBps: 500 },
    { ageBand: 'above 60 to 65', ceiling: 65, lowerWageEmployerBps: 1250, lowerWageEmployeeRampBps: 1500, employerBps: 1250, employeeBps: 500 },
    { ageBand: 'above 65 to 70', ceiling: 70, lowerWageEmployerBps: 900, lowerWageEmployeeRampBps: 1500, employerBps: 900, employeeBps: 500 },
    { ageBand: 'above 70', ceiling: Number.POSITIVE_INFINITY, lowerWageEmployerBps: 750, lowerWageEmployeeRampBps: 1500, employerBps: 750, employeeBps: 500 }
  ],
  PR2_FG: [
    { ageBand: '55 and below', ceiling: 55, lowerWageEmployerBps: 1700, lowerWageEmployeeRampBps: 4500, employerBps: 1700, employeeBps: 1500 },
    { ageBand: 'above 55 to 60', ceiling: 60, lowerWageEmployerBps: 1600, lowerWageEmployeeRampBps: 3750, employerBps: 1600, employeeBps: 1250 },
    { ageBand: 'above 60 to 65', ceiling: 65, lowerWageEmployerBps: 1250, lowerWageEmployeeRampBps: 2250, employerBps: 1250, employeeBps: 750 },
    { ageBand: 'above 65 to 70', ceiling: 70, lowerWageEmployerBps: 900, lowerWageEmployeeRampBps: 1500, employerBps: 900, employeeBps: 500 },
    { ageBand: 'above 70', ceiling: Number.POSITIVE_INFINITY, lowerWageEmployerBps: 750, lowerWageEmployeeRampBps: 1500, employerBps: 750, employeeBps: 500 }
  ]
};

const RATE_SCALE_BIGINT = 10_000n;
const CENTS_PER_DOLLAR = 100;
const CENTS_PER_DOLLAR_BIGINT = 100n;
const CPF_MAX_OW_CENTS = 800_000;
const CPF_ANNUAL_SALARY_CEILING_CENTS = 10_200_000;
const CPF_2026_MINIMUM_WAGE_CENTS = 5_000;
const CPF_2026_AW_CEILING_URL = CPF_AW_CEILING_URL;
const CPF_2026_OW_CEILING_URL = CPF_OW_CEILING_URL;

function isExactIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidMonth(value: string): boolean {
  return /^2026-(0[1-9]|1[0-2])$/.test(value);
}

function ageOnDate(dateOfBirth: string, date: Date): number {
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (date.getUTCMonth() < birth.getUTCMonth() ||
      (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

function ageForContributionMonth(dateOfBirth: string, month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  const previousMonthEnd = new Date(Date.UTC(year, monthNumber - 1, 0));
  return ageOnDate(dateOfBirth, previousMonthEnd);
}

function sprYearForMonth(startDate: string, month: string): 1 | 2 | 3 {
  const start = new Date(`${startDate}T00:00:00Z`);
  const [monthYear, monthNumber] = month.split('-').map(Number);
  const firstAnniversaryYear = start.getUTCFullYear() + 1;
  const firstAnniversaryMonth = start.getUTCMonth() + 1;
  const secondAnniversaryYear = start.getUTCFullYear() + 2;
  const secondAnniversaryMonth = start.getUTCMonth() + 1;
  const contributionIndex = monthYear * 12 + monthNumber - 1;
  const firstSecondYearIndex = firstAnniversaryYear * 12 + firstAnniversaryMonth;
  const secondThirdYearIndex = secondAnniversaryYear * 12 + secondAnniversaryMonth;
  if (contributionIndex < firstSecondYearIndex) return 1;
  if (contributionIndex < secondThirdYearIndex) return 2;
  return 3;
}

function ageRow(rows: readonly AgeRow[], age: number): AgeRow {
  return rows.find(row => age < row.ceiling) || rows[rows.length - 1];
}

function payrollSchedule(input: CpfPayrollCalculationInput): {
  rows: readonly AgeRow[];
  scheduleName: string;
  prYear?: 1 | 2 | 3;
  unsupported?: string;
} {
  if (input.citizenship === 'SINGAPORE_CITIZEN') {
    if (input.prRateElection !== undefined) return { rows: [], scheduleName: '', unsupported: 'A PR contribution election was supplied for a Singapore Citizen.' };
    return { rows: RATE_SCHEDULES.SC_OR_PR3, scheduleName: 'SC / third-year-onward SPR 2026 table' };
  }
  if (input.citizenship !== 'PERMANENT_RESIDENT') {
    return { rows: [], scheduleName: '', unsupported: 'The retained payroll tables cover Singapore Citizens and Permanent Residents.' };
  }
  if (!isExactIsoDate(input.permanentResidentStartDate)) {
    return { rows: [], scheduleName: '', unsupported: 'The Permanent Resident conversion date is required to choose the SPR year.' };
  }
  const prYear = sprYearForMonth(input.permanentResidentStartDate, input.contributionMonth);
  if (input.prRateElection !== undefined && input.prRateElection !== 'GRADUATED_GG' &&
      input.prRateElection !== 'FULL_EMPLOYER_GRADUATED_EMPLOYEE_APPROVED' &&
      input.prRateElection !== 'FULL_EMPLOYER_FULL_EMPLOYEE_APPROVED') {
    return { rows: [], scheduleName: '', prYear, unsupported: 'The supplied SPR contribution election is not recognized.' };
  }
  if (prYear === 3) {
    if (input.prRateElection === 'FULL_EMPLOYER_GRADUATED_EMPLOYEE_APPROVED') {
      return { rows: [], scheduleName: '', prYear, unsupported: 'The first- or second-year full-employer/graduated-employee election does not apply in the third year.' };
    }
    return { rows: RATE_SCHEDULES.SC_OR_PR3, scheduleName: 'third-year-onward SPR 2026 table', prYear };
  }
  if (!input.prRateElection) {
    return { rows: [], scheduleName: '', prYear, unsupported: 'The SPR contribution basis must be confirmed as graduated or as a CPF Board approved higher-rate election.' };
  }
  if (input.prRateElection === 'FULL_EMPLOYER_FULL_EMPLOYEE_APPROVED') {
    return { rows: RATE_SCHEDULES.SC_OR_PR3, scheduleName: 'CPF Board approved full/full 2026 table', prYear };
  }
  if (prYear === 1 && input.prRateElection === 'GRADUATED_GG') {
    return { rows: RATE_SCHEDULES.PR1_GG, scheduleName: 'first-year SPR graduated/graduated 2026 table', prYear };
  }
  if (prYear === 2 && input.prRateElection === 'GRADUATED_GG') {
    return { rows: RATE_SCHEDULES.PR2_GG, scheduleName: 'second-year SPR graduated/graduated 2026 table', prYear };
  }
  if (prYear === 1 && input.prRateElection === 'FULL_EMPLOYER_GRADUATED_EMPLOYEE_APPROVED') {
    return { rows: RATE_SCHEDULES.PR1_FG, scheduleName: 'first-year SPR approved full/graduated 2026 table', prYear };
  }
  if (prYear === 2 && input.prRateElection === 'FULL_EMPLOYER_GRADUATED_EMPLOYEE_APPROVED') {
    return { rows: RATE_SCHEDULES.PR2_FG, scheduleName: 'second-year SPR approved full/graduated 2026 table', prYear };
  }
  return { rows: [], scheduleName: '', prYear, unsupported: 'No 2026 rate schedule matches the provided SPR facts.' };
}

function centsNumerator(amountCents: number, rateBps: number): bigint {
  return BigInt(amountCents) * BigInt(rateBps);
}

function floorDollarsFromNumerator(numerator: bigint): number {
  return Number(numerator / (RATE_SCALE_BIGINT * CENTS_PER_DOLLAR_BIGINT));
}

function nearestDollarCentsFromNumerator(numerator: bigint): number {
  return Number((numerator + RATE_SCALE_BIGINT * CENTS_PER_DOLLAR_BIGINT / 2n) /
    (RATE_SCALE_BIGINT * CENTS_PER_DOLLAR_BIGINT) * CENTS_PER_DOLLAR_BIGINT);
}

function formatSgd(cents: number): string {
  return `S$${Math.floor(cents / CENTS_PER_DOLLAR)}.${String(cents % CENTS_PER_DOLLAR).padStart(2, '0')}`;
}

/** Exact-cent deterministic 2026 CPF contribution estimate for a complete, scoped payroll line. */
export function calculateCpfPayroll2026(input: CpfPayrollCalculationInput): CpfPayrollCalculationResult {
  if (!isValidMonth(input.contributionMonth)) return { status: 'UNSUPPORTED', reason: 'Only contribution periods from January through December 2026 are supported.' };
  if (!['PRIVATE_SECTOR', 'NON_PENSIONABLE_PUBLIC'].includes(input.employmentScope)) {
    return { status: 'UNSUPPORTED', reason: 'The retained 2026 tables cover private-sector and non-pensionable employees.' };
  }
  if (input.wagesAreCpfClassified !== true) return { status: 'UNSUPPORTED', reason: 'Confirm that each amount has been classified as CPF-payable Ordinary Wages or Additional Wages.' };
  if (!isExactIsoDate(input.dateOfBirth)) return { status: 'UNSUPPORTED', reason: 'A valid date of birth is needed to select the age-group rates.' };
  const [payrollYear, payrollMonth] = input.contributionMonth.split('-').map(Number);
  const payrollMonthEnd = new Date(Date.UTC(payrollYear, payrollMonth, 0)).toISOString().slice(0, 10);
  if (input.dateOfBirth > payrollMonthEnd) {
    return { status: 'UNSUPPORTED', reason: 'The supplied date of birth is after the end of the contribution month.' };
  }
  if (input.citizenship === 'PERMANENT_RESIDENT') {
    if (!isExactIsoDate(input.permanentResidentStartDate)) {
      return { status: 'UNSUPPORTED', reason: 'The Permanent Resident conversion date is required to choose the SPR year.' };
    }
    if (input.permanentResidentStartDate > payrollMonthEnd) {
      return { status: 'UNSUPPORTED', reason: 'The employee did not hold Permanent Resident status during the contribution month.' };
    }
    if (input.permanentResidentStartDate > `${input.contributionMonth}-01`) {
      return { status: 'REVIEW_REQUIRED', period: input.contributionMonth,
        reason: 'Permanent Resident status began during this payroll month; wages before and from the conversion date must be separated before contribution rates can be calculated.' };
    }
  }
  const amounts = [
    input.ordinaryWageCents,
    input.additionalWageCents,
    input.priorYearToDateOrdinaryWageSubjectCents,
    input.priorYearToDateAdditionalWageSubjectCents,
    input.estimatedFullYearOrdinaryWageSubjectCents
  ];
  if (amounts.some(amount => !Number.isSafeInteger(amount) || amount < 0)) {
    return { status: 'UNSUPPORTED', reason: 'All wage values must be non-negative integer cents.' };
  }
  if (typeof input.isLastMonthOfEmployment !== 'boolean') {
    return { status: 'UNSUPPORTED', reason: 'Confirm whether this is the final employment month in the calendar year.' };
  }
  const monthNumber = Number(input.contributionMonth.slice(5));
  const ordinaryWageSubjectCents = Math.min(input.ordinaryWageCents, CPF_MAX_OW_CENTS);
  const actualOwThroughPeriod = input.priorYearToDateOrdinaryWageSubjectCents + ordinaryWageSubjectCents;
  if (input.priorYearToDateOrdinaryWageSubjectCents > (monthNumber - 1) * CPF_MAX_OW_CENTS) {
    return { status: 'UNSUPPORTED', reason: 'Prior-year-to-date CPF-subject Ordinary Wages exceed the 2026 monthly OW ceiling for elapsed periods.' };
  }
  if (input.priorYearToDateAdditionalWageSubjectCents >
      Math.max(0, CPF_ANNUAL_SALARY_CEILING_CENTS - input.priorYearToDateOrdinaryWageSubjectCents)) {
    return { status: 'UNSUPPORTED', reason: 'The supplied year-to-date CPF-subject OW and AW exceed the S$102,000 annual salary ceiling.' };
  }
  const [year] = input.contributionMonth.split('-').map(Number);
  const expectedOwAnnual = input.estimatedFullYearOrdinaryWageSubjectCents;
  const atFinalPeriod = monthNumber === 12 || input.isLastMonthOfEmployment;
  const projectedAnnualOwSubjectCents = atFinalPeriod ? actualOwThroughPeriod : expectedOwAnnual;
  if (expectedOwAnnual > 12 * CPF_MAX_OW_CENTS ||
      (!atFinalPeriod && expectedOwAnnual < actualOwThroughPeriod) ||
      projectedAnnualOwSubjectCents > 12 * CPF_MAX_OW_CENTS) {
    return { status: 'UNSUPPORTED', reason: 'The annual OW estimate or prior AW subject to CPF is inconsistent with the 2026 ceilings.' };
  }
  if (year !== 2026) return { status: 'UNSUPPORTED', reason: 'The retained tables apply only to wages due and payable in 2026.' };
  const payroll = payrollSchedule(input);
  if (payroll.unsupported || !payroll.rows.length) return { status: 'UNSUPPORTED', reason: payroll.unsupported || 'Could not select a CPF rate table.' };
  const selectedAge = ageRow(payroll.rows, ageForContributionMonth(input.dateOfBirth, input.contributionMonth));
  let additionalWageSubjectCents = 0;
  const annualAwCeiling = Math.max(0, CPF_ANNUAL_SALARY_CEILING_CENTS - projectedAnnualOwSubjectCents);
  let remainingAwCeilingCents = Math.max(0, annualAwCeiling - input.priorYearToDateAdditionalWageSubjectCents);
  if (input.priorYearToDateAdditionalWageSubjectCents > annualAwCeiling) {
    return { status: 'REVIEW_REQUIRED', period: input.contributionMonth,
      reason: 'Prior CPF-subject AW already exceeds the recalculated ceiling; stop current AW contributions and review prior submissions for a refund or adjustment.' };
  }
  if (input.additionalWageCents > 0) {
    additionalWageSubjectCents = Math.min(input.additionalWageCents, remainingAwCeilingCents);
  }
  const totalSubjectCents = ordinaryWageSubjectCents + additionalWageSubjectCents;
  if (totalSubjectCents === 0 || totalSubjectCents <= CPF_2026_MINIMUM_WAGE_CENTS) {
    return {
      status: 'CALCULATED', period: input.contributionMonth, prYear: payroll.prYear, ageBand: selectedAge.ageBand,
      rateSchedule: payroll.scheduleName, ordinaryWageSubjectCents, additionalWageSubjectCents,
      remainingAwCeilingCents, projectedAnnualOwSubjectCents,
      totalContributionCents: 0, employeeContributionCents: 0, employerContributionCents: 0,
      explanation: 'CPF contributions are nil when total wages subject to CPF are S$50 or less.'
    };
  }
  let totalNumerator: bigint;
  let employeeNumerator: bigint;
  if (totalSubjectCents <= 75_000) {
    const lowerWageCents = Math.min(totalSubjectCents, 50_000);
    const excessWageCents = Math.max(0, totalSubjectCents - 50_000);
    totalNumerator = centsNumerator(lowerWageCents, selectedAge.lowerWageEmployerBps) +
      centsNumerator(excessWageCents, selectedAge.lowerWageEmployerBps + selectedAge.lowerWageEmployeeRampBps);
    employeeNumerator = centsNumerator(excessWageCents, selectedAge.lowerWageEmployeeRampBps);
  } else {
    totalNumerator = centsNumerator(ordinaryWageSubjectCents, selectedAge.employerBps) +
      centsNumerator(additionalWageSubjectCents, selectedAge.employerBps) +
      centsNumerator(ordinaryWageSubjectCents, selectedAge.employeeBps) +
      centsNumerator(additionalWageSubjectCents, selectedAge.employeeBps);
    employeeNumerator = centsNumerator(ordinaryWageSubjectCents, selectedAge.employeeBps) +
      centsNumerator(additionalWageSubjectCents, selectedAge.employeeBps);
  }
  const totalContributionCents = nearestDollarCentsFromNumerator(totalNumerator);
  const employeeContributionCents = floorDollarsFromNumerator(employeeNumerator) * CENTS_PER_DOLLAR;
  const employerContributionCents = totalContributionCents - employeeContributionCents;
  return {
    status: 'CALCULATED', period: input.contributionMonth, prYear: payroll.prYear, ageBand: selectedAge.ageBand,
    rateSchedule: payroll.scheduleName, ordinaryWageSubjectCents, additionalWageSubjectCents,
    remainingAwCeilingCents, projectedAnnualOwSubjectCents, totalContributionCents,
    employeeContributionCents, employerContributionCents,
    explanation: `2026 ${payroll.scheduleName}; ${selectedAge.ageBand}; Ordinary Wages subject to CPF ${formatSgd(ordinaryWageSubjectCents)}, Additional Wages subject to CPF ${formatSgd(additionalWageSubjectCents)}. The total is rounded to the nearest dollar; employee cents are discarded and the employer share is the residual.`
  };
}

function cleanSourceText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/[\t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function scopeRule(request: CpfPayrollKnowledgeRequest): CpfPayrollKnowledgeRule | undefined {
  if (request.authority !== 'CPF') return undefined;
  if (isIrasCpfQualitativeRateFactorRequest(request)) return undefined;
  if (!identifyEvidenceRule(request.query, request.subject)) return undefined;
  const text = `${request.query}\n${request.subject}`;
  const topic = request.topicId;
  if (request.officialUrl) {
    return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.officialUrl === request.officialUrl &&
      rule.topicIds.includes(topic as never));
  }
  if (topic === 'cpf-additional-wage-ceiling' &&
      /\b(?:ceiling|limit|formula|calculate|calculation|bonus|additional wages?)\b/i.test(text)) {
    return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_2026_ADDITIONAL_WAGE_CEILING');
  }
  if (['cpf-ordinary-wages', 'cpf_wage_ceiling'].includes(topic) && /\b(?:ceiling|limit|ordinary wages?|monthly salary cap)\b/i.test(text)) {
    return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_ORDINARY_WAGE_CEILINGS');
  }
  if (topic === 'cpf-pr-contribution-rates' &&
      /\b(?:first|1st|second|2nd|third|3rd|year of pr|year of spr|permanent resident|spr conversion|conversion date|anniversary)\b/i.test(text)) {
    return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_PERMANENT_RESIDENT_YEAR');
  }
  if (RATE_TOPICS.includes(topic as typeof RATE_TOPICS[number]) &&
      /\b(?:contribut\w*|rate table|rates?|rounding|calculat\w*|payroll|how much|ordinary wages?|additional wages?)\b/i.test(text)) {
    const sourceHint = cleanSourceText(request.sourceText).toLowerCase();
    if (/\btable\s+[1-5]\b[\s\S]*from 1 january 2026/.test(sourceHint)) {
      return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_2026_CONTRIBUTION_TABLES');
    }
    if (/the first year begins on the day of spr conversion/.test(sourceHint)) {
      return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_CONTRIBUTION_METHOD');
    }
    if (/please round off your total cpf contributions to the nearest dollar/.test(sourceHint)) {
      return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_CONTRIBUTION_METHOD');
    }
  }
  return undefined;
}

function currentOrExplicit2026Question(query: string, rule: CpfPayrollKnowledgeRule): boolean {
  const years = [...query.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => match[0]);
  if (rule.id === 'CPF_ORDINARY_WAGE_CEILINGS' && years.length > 0) {
    return years.every(year => Number(year) >= 2016 && Number(year) <= 2026);
  }
  if (rule.id === 'CPF_PERMANENT_RESIDENT_YEAR') {
    return !/\b(?:historical|historic|superseded|past rate|previous rate|former rate)\b/i.test(query);
  }
  if (years.some(year => year !== '2026')) return false;
  if (/\b(?:historical|historic|past|previous|prior|former|superseded|last year|next year|future)\b/i.test(query)) return false;
  const currentYear = TargetDateResolver.CURRENT_SYSTEM_DATE.slice(0, 4);
  return years.includes('2026') || (years.length === 0 && currentYear === '2026');
}

function requiredSourceFacts(rule: CpfPayrollKnowledgeRule, rawText: string, query = ''): boolean {
  const text = cleanSourceText(rawText).replace(/\s+/g, ' ').toLowerCase();
  switch (rule.id) {
    case 'CPF_2026_CONTRIBUTION_TABLES': {
      const tableNumber = requestedRateTableNumber(query);
      const tableText = extractRateTableText(rawText, tableNumber);
      if (!tableText) return false;
      const selected = cleanSourceText(tableText).replace(/\s+/g, ' ').toLowerCase();
      const tableHeaders: Record<number, RegExp[]> = {
        1: [/from 1 january 2026/, /singapore citizens or singapore permanent residents/],
        2: [/from 1 january 2026/, /singapore permanent residents \(spr\) during 1\s*st year/, /graduated contribution rates \(g\/g\)/],
        3: [/from 1 january 2026/, /singapore permanent residents \(spr\) during 2\s*nd year/, /graduated contribution rates \(g\/g\)/],
        4: [/from 1 january 2026/, /singapore permanent residents \(spr\) during 1\s*st year/, /full employer & graduated employee contribution rates/],
        5: [/from 1 january 2026/, /singapore permanent residents \(spr\) during 2\s*nd year/, /full employer & graduated employee contribution rates/]
      };
      if (!tableHeaders[tableNumber].every(fact => fact.test(selected))) return false;
      const firstOrSecondYearFullFull = tableNumber === 1 &&
        /\b(?:first|1st|second|2nd)\s*(?:year|spr)|\b(?:first|second)-year\b/i.test(query) &&
        /\b(?:full employer\s*(?:and|\+)\s*full employee|full employer\s*[-/]\s*full employee|full\/full|both at full rates)\b/i.test(query);
      if (firstOrSecondYearFullFull &&
          !/these rates are also applicable to 1st and 2nd year singapore permanent resident \(spr\) employees and their employers after cpf board approves their joint application to contribute to cpf at full employer- full employee rates/i.test(selected)) return false;
      const expectedRows: Record<number, Array<{
        label: string; base: string; ramp: string; total: string; employee: string; maxTotal: string; maxEmployee: string
      }>> = {
        1: [
          { label: '55 & below', base: '17', ramp: '0.6', total: '37', employee: '20', maxTotal: '2,960', maxEmployee: '1,600' },
          { label: 'above 55 - 60', base: '16', ramp: '0.54', total: '34', employee: '18', maxTotal: '2,720', maxEmployee: '1,440' },
          { label: 'above 60 - 65', base: '12.5', ramp: '0.375', total: '25', employee: '12.5', maxTotal: '2,000', maxEmployee: '1,000' },
          { label: 'above 65 - 70', base: '9', ramp: '0.225', total: '16.5', employee: '7.5', maxTotal: '1,320', maxEmployee: '600' },
          { label: 'above 70', base: '7.5', ramp: '0.15', total: '12.5', employee: '5', maxTotal: '1,000', maxEmployee: '400' }
        ],
        2: [
          { label: '55 & below', base: '4', ramp: '0.15', total: '9', employee: '5', maxTotal: '720', maxEmployee: '400' },
          { label: 'above 55 - 60', base: '4', ramp: '0.15', total: '9', employee: '5', maxTotal: '720', maxEmployee: '400' },
          { label: 'above 60 - 65', base: '3.5', ramp: '0.15', total: '8.5', employee: '5', maxTotal: '680', maxEmployee: '400' },
          { label: 'above 65', base: '3.5', ramp: '0.15', total: '8.5', employee: '5', maxTotal: '680', maxEmployee: '400' }
        ],
        3: [
          { label: '55 & below', base: '9', ramp: '0.45', total: '24', employee: '15', maxTotal: '1,920', maxEmployee: '1,200' },
          { label: 'above 55 - 60', base: '6', ramp: '0.375', total: '18.5', employee: '12.5', maxTotal: '1,480', maxEmployee: '1,000' },
          { label: 'above 60 - 65', base: '3.5', ramp: '0.225', total: '11', employee: '7.5', maxTotal: '880', maxEmployee: '600' },
          { label: 'above 65', base: '3.5', ramp: '0.15', total: '8.5', employee: '5', maxTotal: '680', maxEmployee: '400' }
        ],
        4: [
          { label: '55 & below', base: '17', ramp: '0.15', total: '22', employee: '5', maxTotal: '1,760', maxEmployee: '400' },
          { label: 'above 55 - 60', base: '16', ramp: '0.15', total: '21', employee: '5', maxTotal: '1,680', maxEmployee: '400' },
          { label: 'above 60 - 65', base: '12.5', ramp: '0.15', total: '17.5', employee: '5', maxTotal: '1,400', maxEmployee: '400' },
          { label: 'above 65 - 70', base: '9', ramp: '0.15', total: '14', employee: '5', maxTotal: '1,120', maxEmployee: '400' },
          { label: 'above 70', base: '7.5', ramp: '0.15', total: '12.5', employee: '5', maxTotal: '1,000', maxEmployee: '400' }
        ],
        5: [
          { label: '55 & below', base: '17', ramp: '0.45', total: '32', employee: '15', maxTotal: '2,560', maxEmployee: '1,200' },
          { label: 'above 55 - 60', base: '16', ramp: '0.375', total: '28.5', employee: '12.5', maxTotal: '2,280', maxEmployee: '1,000' },
          { label: 'above 60 - 65', base: '12.5', ramp: '0.225', total: '20', employee: '7.5', maxTotal: '1,600', maxEmployee: '600' },
          { label: 'above 65 - 70', base: '9', ramp: '0.15', total: '14', employee: '5', maxTotal: '1,120', maxEmployee: '400' },
          { label: 'above 70', base: '7.5', ramp: '0.15', total: '12.5', employee: '5', maxTotal: '1,000', maxEmployee: '400' }
        ]
      };
      const rows = expectedRows[tableNumber];
      const rowStarts = rows.map(row => selected.indexOf(row.label));
      if (rowStarts.some(start => start < 0) || rowStarts.some((start, index) => index > 0 && start <= rowStarts[index - 1])) return false;
      const rowText = rows.map((_, index) => selected.slice(rowStarts[index], rowStarts[index + 1] ?? selected.length));
      const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const checkedRows = rows.map((row, index) => {
        const rowPattern = new RegExp(
          `>\\s*\\$50 to \\$500\\s+${escape(row.base)}%\\s*\\(tw\\)\\s+nil` +
          `.*?>\\s*\\$500 to \\$750\\s+${escape(row.base)}%\\s*\\(tw\\)\\s*\\+\\s*${escape(row.ramp)}\\s*\\(tw\\s*-\\s*\\$500\\)\\s+${escape(row.ramp)}\\s*\\(tw\\s*-\\s*\\$500\\)` +
          `.*?>\\s*\\$750\\s+\\[${escape(row.total)}%\\s*\\(ow\\)\\]\\s*\\*\\s*\\+\\s*${escape(row.total)}%\\s*\\(aw\\)` +
          `.*?max\\.?\\s+of\\s+\\$${escape(row.maxTotal)}` +
          `.*?\\[${escape(row.employee)}%\\s*\\(ow\\)\\]\\s*\\*\\s*\\+\\s*${escape(row.employee)}%\\s*\\(aw\\)` +
          `.*?max\\.?\\s+of\\s+\\$${escape(row.maxEmployee)}`,
          'i'
        );
        return rowPattern.test(rowText[index]);
      });
      const ceilingProof = /ordinary wages \(capped at ow ceiling of \$8,000/.test(selected);
      if (checkedRows.every(Boolean)) return ceilingProof;
      if (!selected.includes('|')) return false;
      const countMatches = (pattern: string): number => [...selected.matchAll(new RegExp(pattern, 'gi'))].length;
      const lowBandsValid = rows.every(row => {
        const duplicateCount = rows.filter(candidate => candidate.base === row.base).length;
        const pattern = `>\\s*\\$50 to \\$500\\s*\\|\\s*${escape(row.base)}%\\s*\\(tw\\)\\s*\\|\\s*nil`;
        return countMatches(pattern) === duplicateCount;
      });
      const middleBandsValid = rows.every(row => {
        const duplicateCount = rows.filter(candidate => candidate.base === row.base && candidate.ramp === row.ramp).length;
        const pattern = `>\\s*\\$500 to \\$750\\s*\\|\\s*${escape(row.base)}%\\s*\\(tw\\)\\s*\\+\\s*${escape(row.ramp)}\\s*\\(tw\\s*-\\s*\\$500\\)\\s*\\|\\s*${escape(row.ramp)}\\s*\\(tw\\s*-\\s*\\$500\\)`;
        return countMatches(pattern) === duplicateCount;
      });
      const pdfJsHighBandsValid = rows.every((row, index) => {
        const pattern = new RegExp(
          `\\[${escape(row.total)}%\\s*\\(ow\\)\\]\\s*\\*\\s*\\+\\s*${escape(row.total)}%\\s*\\(aw\\)\\s*\\|\\s*` +
          `\\[${escape(row.employee)}%\\s*\\(ow\\)\\]\\s*\\*\\s*\\+\\s*${escape(row.employee)}%\\s*\\(aw\\)` +
          `\\s*>\\s*\\$750\\s+\\*?\\s*max\\.?\\s+of\\s+\\$${escape(row.maxTotal)}\\s*\\|\\s*\\*?\\s*max\\.?\\s+of\\s+\\$${escape(row.maxEmployee)}`,
          'i'
        );
        return pattern.test(rowText[index]);
      });
      return lowBandsValid && middleBandsValid && pdfJsHighBandsValid && ceilingProof;
    }
    case 'CPF_CONTRIBUTION_METHOD':
      return [/cpf contribution rates vary based on your employee[’']s citizenship status, age group, and total wages/,
        /first year begins on the day of spr conversion/,
        /second year begins on the first day of the month after the first anniversary of spr conversion/,
        /third year begins on the first day of the month after the second anniversary of spr conversion/,
        /new contribution rates apply from the first day of the month after the employee[’']s 55th, 60th, 65th or 70th birthday/,
        /total wages are made up of an employee[’']s ordinary wages and additional wages/,
        /different ceilings apply to ordinary wages and additional wages/,
        /above \$50 but not more than \$500 per month, there is no employee[’']s share/,
        /round off the total cpf contributions to the nearest dollar/,
        /cents should always be dropped for the employee[’']s share/,
        /increase to the cpf contribution rates from 1 jan 2027/].every(fact => fact.test(text));
    case 'CPF_ORDINARY_WAGE_CEILINGS':
      return [/ordinary wage \(ow\) ceiling sets the maximum amount of ow that attracts cpf contributions in a calendar month for all employees\./,
        /it was gradually raised and has reached \$8,000 in 2026\./,
        /the increase took place in four steps, as shown in the table below, to allow employers and employees to adjust to the changes\./,
        /table: changes in cpf salary ceilings/,
        /from 1 jan 2016 to 31 aug 2023\s*\|\s*\$6,000\s*\|\s*\$102,000 \(no change\)/,
        /from 1 sep to 31 dec 2023\s*\|\s*\$6,300 \(\+\$300\)/,
        /from 1 jan to 31 dec 2024\s*\|\s*\$6,800 \(\+\$500\)/,
        /from 1 jan to 31 dec 2025\s*\|\s*\$7,400 \(\+\$600\)/,
        /from 1 jan 2026\s*\|\s*\$8,000 \(\+\$600\)/].every(fact => fact.test(text));
    case 'CPF_2026_ADDITIONAL_WAGE_CEILING':
      return [/aw ceiling is computed on a per employer, per year basis/, /applies to all singapore citizens and singapore permanent residents/,
        /\$102,000 - total ordinary wages \(ow\) subject to cpf for the year/, /for the year 2026, the aw ceiling is/,
        /\$8,000.{0,12}x 12/, /due and payable date of the aw/, /last month of employment or end of the year in december \(whichever is earlier\)/,
        /first or second year of spr status, please use the applicable monthly contribution rates/].every(fact => fact.test(text));
    case 'CPF_PERMANENT_RESIDENT_YEAR':
      return [/as a singapore permanent resident \(spr\), you are required to make cpf contributions on wages earned in singapore\./,
        /cpf contributions are not payable for employees who are neither singapore citizens nor sprs\./,
        /your cpf contribution rates as an spr depend on how long you have held permanent resident status\./,
        /first-year rate: applies from the day you obtain your spr status, \[i\.e\. the date indicated on your entry permit \(form 5\/5a\) issued by the immigration & checkpoints authority \(ica\)\] until the last day of the month of your first anniversary of spr\./,
        /second-year rate: applies from the month following your first anniversary as an spr until the last day of the month of your second anniversary\./,
        /third-year rate: applies from the month following your second anniversary as an spr onwards\./,
        /if you have obtained your spr status on 15 january 2026, the start and end dates for first, second and third year of obtaining spr status are shown in the table below:/,
        /first year\s*\|\s*15 january 2026\s*\|\s*31 january 2027/,
        /second year\s*\|\s*1 february 2027\s*\|\s*31 january 2028/,
        /third year\s*\|\s*1 february 2028\s*\|\s*not applicable/].every(fact => fact.test(text));
  }
}

function requestedRateTableNumber(query: string): number {
  const text = query.toLowerCase();
  const first = /\b(?:first|1st)\s*(?:year|spr)|\bfirst-year\b/.test(text);
  const second = /\b(?:second|2nd)\s*(?:year|spr)|\bsecond-year\b/.test(text);
  const fullEmployerFullEmployee = /\b(?:full employer\s*(?:and|\+)\s*full employee|full employer\s*[-/]\s*full employee|full\/full|both at full rates)\b/.test(text);
  if ((first || second) && fullEmployerFullEmployee) return 1;
  const approvedFullEmployerGraduatedEmployee = /\b(?:approved|approval|higher rate|higher contribution|full employer|f\/g)\b/.test(text) &&
    /\b(?:graduated employee|employee.*graduated|f\/g|higher rate|higher contribution)\b/.test(text);
  if (first) return approvedFullEmployerGraduatedEmployee ? 4 : 2;
  if (second) return approvedFullEmployerGraduatedEmployee ? 5 : 3;
  return 1;
}

function extractRateTableText(sourceText: string, tableNumber: number): string | undefined {
  const clean = cleanSourceText(sourceText);
  const startMatch = new RegExp(`\\bTable\\s*${tableNumber}\\b`, 'i').exec(clean);
  if (!startMatch || startMatch.index === undefined) return undefined;
  const tail = clean.slice(startMatch.index + startMatch[0].length);
  const nextMatch = new RegExp(`\\bTable\\s*${tableNumber + 1}\\b`, 'i').exec(tail);
  const end = nextMatch?.index === undefined ? clean.length : startMatch.index + startMatch[0].length + nextMatch.index;
  return clean.slice(startMatch.index, end).trim();
}

/** Returns undefined for unrelated requests and false for a recognized rule with inadequate proof. */
export function supportCpfPayrollKnowledgeRule(request: CpfPayrollKnowledgeRequest): boolean | undefined {
  const rule = scopeRule(request);
  if (!rule) return undefined;
  if (request.officialUrl && request.officialUrl !== rule.officialUrl) return false;
  if (!currentOrExplicit2026Question(request.query, rule)) return false;
  return requiredSourceFacts(rule, request.sourceText, `${request.query}\n${request.subject}`);
}

export function selectCpfPayrollKnowledgeQuotes(request: CpfPayrollKnowledgeRequest): string[] {
  const rule = scopeRule(request);
  if (!rule || supportCpfPayrollKnowledgeRule(request) !== true) return [];
  if (rule.id === 'CPF_2026_CONTRIBUTION_TABLES') {
    const tableText = extractRateTableText(request.sourceText, requestedRateTableNumber(`${request.query}\n${request.subject}`));
    return tableText ? [tableText] : [];
  }
  return [request.sourceText.trim()];
}

function querySubjectMatches(rule: CpfPayrollKnowledgeRule, query: string, subject: string): boolean {
  const text = `${query}\n${subject}`;
  if (!/\b(?:cpf|central provident fund|permanent resident|\bspr\b)\b/i.test(text)) return false;
  if (rule.id === 'CPF_2026_ADDITIONAL_WAGE_CEILING') return /\b(?:aw|additional wages?|annual salary ceiling|bonus)\b/i.test(text);
  if (rule.id === 'CPF_ORDINARY_WAGE_CEILINGS') return /\b(?:ordinary wages?|\bow\b|monthly salary ceiling|salary ceiling)\b/i.test(text);
  if (rule.id === 'CPF_PERMANENT_RESIDENT_YEAR') return /\b(?:spr|permanent resident)\b/i.test(text);
  return /\b(?:contribut\w*|rate table|rates?|payroll|rounding|calculate|calculation|wage ceiling|\bow\b|\baw\b)\b/i.test(text);
}

function identifyEvidenceRule(query: string, subject: string): CpfPayrollKnowledgeRule | undefined {
  const text = `${query}\n${subject}`;
  if (/\b(?:employee cpf deduction|employee deduction|employee share|employer contribution|employer share)\b/i.test(text) &&
      /\b(?:low[- ]wage|(?:s\$|sgd|\$)\s*(?:50|[5-9]\d|[1-4]\d\d|500)\b|earning\s+(?:s\$|sgd|\$)?\s*(?:50|[5-9]\d|[1-4]\d\d|500)\b)/i.test(text)) {
    return undefined;
  }
  if (/\b(?:aw ceiling|additional wage ceiling|additional wages? limit|annual salary ceiling|bonus ceiling)\b/i.test(text)) {
    return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_2026_ADDITIONAL_WAGE_CEILING');
  }
  if (/\b(?:ordinary wage ceiling|monthly salary ceiling|ordinary wage limit)\b/i.test(text)) {
    return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_ORDINARY_WAGE_CEILINGS');
  }
  if (/\b(?:spr|permanent resident)\b/i.test(text) &&
      /\b(?:first|1st|second|2nd|third|3rd|year|anniversary|conversion|convert)\b/i.test(text) &&
      !/\b(?:rate table|rates by age|contribution rates?)\b/i.test(text)) {
    return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_PERMANENT_RESIDENT_YEAR');
  }
  if (/\b(?:rounding|round off|round off|drop cents|discard cents|employee share|employer share|calculate|calculation|compute)\b/i.test(text) &&
      !/\b(?:rate table|rates by age|contribution rates)\b/i.test(text)) {
    return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_CONTRIBUTION_METHOD');
  }
  if (/\b(?:cpf|central provident fund)\b/i.test(text) &&
      /\b(?:contribut\w*|rate table|rates?|payroll|age group)\b/i.test(text)) {
    return CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.id === 'CPF_2026_CONTRIBUTION_TABLES');
  }
  return undefined;
}

function generalAnswer(rule: CpfPayrollKnowledgeRule, query: string): string {
  switch (rule.id) {
    case 'CPF_2026_CONTRIBUTION_TABLES': {
      const tableNumber = requestedRateTableNumber(query);
      if (tableNumber === 1 &&
          /\b(?:first|1st|second|2nd)\s*(?:year|spr)|\b(?:first|second)-year\b/i.test(query) &&
          /\b(?:full employer\s*(?:and|\+)\s*full employee|full employer\s*[-/]\s*full employee|full\/full|both at full rates)\b/i.test(query)) {
        return 'For a first- or second-year SPR, CPF Board permits Table 1 full employer/full employee rates only after it approves the employer’s and employee’s joint application. Without that approval, use the applicable graduated SPR table. Confirm the SPR year, approval and age group before applying the 2026 rates; the 2026 table must not be used for another payroll year.';
      }
      if (tableNumber !== 1) {
        const schedule = tableNumber === 2 ? 'first-year SPR graduated employer/employee' :
          tableNumber === 3 ? 'second-year SPR graduated employer/employee' :
            tableNumber === 4 ? 'first-year SPR approved full-employer/graduated-employee' :
              'second-year SPR approved full-employer/graduated-employee';
        return `For 2026, use CPF Board Table ${tableNumber} for the ${schedule} schedule. It varies by age band and monthly wage band; apply it only to the relevant CPF-subject wages and after confirming the SPR conversion date and any CPF Board-approved election. The exact Table ${tableNumber} rates are included in the source passage. The contribution period must be in 2026.`;
      }
      return 'CPF Board’s 2026 contribution table applies from 1 January 2026 to Singapore Citizens or third-year-onward SPRs in private-sector or non-pensionable public-service employment. For monthly wages above S$750, the employer/employee rates are: age 55 and below 17%/20%; above 55 to 60, 16%/18%; above 60 to 65, 12.5%/12.5%; above 65 to 70, 9%/7.5%; above 70, 7.5%/5%. For an actual payroll case, identify the year, birth date, citizenship/PR conversion date and any approved PR-rate election before selecting a table. New age-group rates start on the first day of the month after the 55th, 60th, 65th or 70th birthday. Do not apply this 2026 table to another payroll year.';
    }
    case 'CPF_CONTRIBUTION_METHOD':
      return 'CPF Board selects the contribution table from citizenship or SPR year, age group and wage band. Total wages combine Ordinary Wages (OW) and Additional Wages (AW), which have separate ceilings. For wages above S$50 and up to S$500 in a month, the employee share is nil but the employer share remains due. Round the combined total contribution to the nearest dollar (50 cents rounds up); drop cents from the employee share and set the employer share to total less employee. To determine the actual amount, supply the payroll month, date of birth, status/PR conversion date, rate election, CPF-classified OW/AW, year-to-date contributions and expected annual OW where an AW ceiling applies.';
    case 'CPF_ORDINARY_WAGE_CEILINGS':
      return 'CPF Board’s dated ceiling table sets the monthly OW ceiling at S$8,000 from 1 January 2026. It shows S$7,400 for 2025, S$6,800 for 2024, S$6,300 from September through December 2023, and S$6,000 from 1 January 2016 through 31 August 2023. The ceiling is monthly and applies to Ordinary Wages. Select the row for the payroll period; this ceiling alone does not determine a contribution rate or payroll amount.';
    case 'CPF_2026_ADDITIONAL_WAGE_CEILING':
      return 'CPF Board sets the AW ceiling per employer, per year at S$102,000 less that employee’s Ordinary Wages subject to CPF for the year. The 2026 examples use an OW ceiling of S$8,000 per month and say the year in which an AW is due and payable controls the ceiling. At each AW payment, estimate OW for the year and account for AW already subject to CPF. Recalculate against actual OW in the last employment month or December, whichever is earlier; settle a shortfall or apply for a refund of excess. To compute the remaining limit, the employer must provide actual year-to-date OW/AW and either the expected full-year OW or confirm this is final settlement.';
    case 'CPF_PERMANENT_RESIDENT_YEAR':
      return 'CPF Board counts the first SPR contribution year from the actual PR-conversion date through the last day of the month containing the first anniversary. The second year starts on the first day of the next month and runs through the last day of the month containing the second anniversary; the third starts the following month. For example, a 15 January 2026 conversion has first-year rates through 31 January 2027, second-year rates from 1 February 2027 through 31 January 2028, then third-year rates. This timing selects the SPR year but does not establish a contribution rate without the applicable payroll-year table and any approved higher-rate election.';
  }
}

/** Show only an explanation backed by one current official source revision and issue-bound exact quotes. */
export function getCpfPayrollKnowledgeEvidence(
  query: string,
  stream: AuthorityPresentedWorkstream,
  issue: AuthorityPresentedIssue
): CpfPayrollKnowledgeEvidence | undefined {
  if (stream.authority !== 'CPF' || stream.domain !== 'CPF_PAYROLL' ||
      !['Employee', 'Employer'].includes(issue.population) ||
      !['NOT_REQUIRED', 'UNRESOLVED'].includes(issue.applicationStatus) ||
      issue.evidenceStatus !== 'VERIFIED' ||
      !['EXPLAIN_RULE', 'CHECK_ELIGIBILITY', 'FILING_REQUIREMENT', 'CALCULATE'].includes(issue.operation) ||
      !stream.issues.some(candidate => candidate.id === issue.id && candidate.evidenceStatus === 'VERIFIED')) return undefined;
  const rule = identifyEvidenceRule(query, issue.subject);
  if (!rule || !rule.topicIds.some(topicId => topicId.toLowerCase().includes('cpf'))) return undefined;
  if (!querySubjectMatches(rule, query, issue.subject) || !currentOrExplicit2026Question(query, rule)) return undefined;
  if (!rule) return undefined;
  const source = stream.sources.find(candidate => candidate.provenance === 'LIVE_EXTERNAL' &&
    !candidate.validTo && candidate.officialUrl === rule.officialUrl &&
    sourceSupportsRule(candidate, issue.id, rule, `${query}\n${issue.subject}`));
  if (!source) return undefined;
  return {
    authority: 'CPF', ruleId: rule.id, title: source.title || rule.title, officialUrl: rule.officialUrl,
    text: generalAnswer(rule, `${query}\n${issue.subject}`)
  };
}

/** Flags explicit unsupported years, source-family substitution, or negated rule conclusions. */
export function hasCpfPayrollKnowledgeContradiction(request: CpfPayrollKnowledgeRequest): boolean {
  if (request.authority !== 'CPF') return false;
  const knownSource = CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.find(rule => rule.officialUrl === request.officialUrl);
  if (request.officialUrl && !knownSource) return false;
  const rule = scopeRule(request);
  if (!rule) return false;
  const text = `${request.query}\n${request.subject}\n${cleanSourceText(request.sourceText)}`;
  if (!currentOrExplicit2026Question(request.query, rule)) return true;
  const hasContradictoryNegation = /\b(?:not S\$?8,?000|not 37%|not 20%)\b/i.test(text)
    || /cpf contributions are not payable for (?:singapore citizens|singapore permanent residents|sprs)\b/i.test(text);
  if (hasContradictoryNegation) return true;
  if (rule.id === 'CPF_ORDINARY_WAGE_CEILINGS') {
    return /(?:2026|from 1 jan 2026)[^\n]{0,80}(?:ow ceiling|ordinary wage ceiling)[^\n]{0,30}(?:S\$?8,?001|S\$?7,?400)/i.test(text);
  }
  return false;
}

function sourceSupportsRule(
  source: AuthorityPresentedSource,
  issueId: string,
  rule: CpfPayrollKnowledgeRule,
  query: string
): boolean {
  return groupExactIssueClaimsByDocument(source, issueId).some(group => {
    const text = group.map(claim => claim.text).join('\n\n');
    return requiredSourceFacts(rule, text, query) && rule.topicIds.length > 0;
  });
}

/**
 * Safe display helper: the calculator still needs all facts, so this function
 * renders a resolved amount only when the caller supplies the complete typed
 * input and has not claimed a mixed or special-case population.
 */
export function renderCpfPayrollCalculation(input: CpfPayrollCalculationInput): string {
  const result = calculateCpfPayroll2026(input);
  if (result.status === 'UNSUPPORTED') return `CPF amount not determined: ${result.reason}`;
  if (result.status === 'REVIEW_REQUIRED') return `CPF amount requires review: ${result.reason}`;
  return `For ${result.period}, CPF-subject Ordinary Wages are ${formatSgd(result.ordinaryWageSubjectCents)} and CPF-subject Additional Wages are ${formatSgd(result.additionalWageSubjectCents)}. Total CPF contribution is ${formatSgd(result.totalContributionCents)}, consisting of employee share ${formatSgd(result.employeeContributionCents)} and employer share ${formatSgd(result.employerContributionCents)}. ${result.explanation}`;
}

export const CPF_PAYROLL_KNOWLEDGE_POINTERS_20261027B = Object.freeze(
  CPF_PAYROLL_KNOWLEDGE_RULES_20261027B.map(rule => ({
    authority: rule.authority,
    topicIds: rule.topicIds,
    url: rule.officialUrl,
    title: rule.title,
    effectiveFrom: rule.id === 'CPF_2026_CONTRIBUTION_TABLES' ||
      rule.id === 'CPF_2026_ADDITIONAL_WAGE_CEILING' ? '2026-01-01' : undefined,
    fixtureFile: rule.fixtureFile,
    fixtureKind: rule.fixtureKind,
    documentKind: rule.fixtureKind === 'NATIVE_OFFICIAL_PDF' ? 'PDF' : 'HTML_OR_TEXT',
    excerptFile: rule.excerptFile
  }))
);

export const CPF_PAYROLL_CEILING_CONSTANTS_2026 = Object.freeze({
  ordinaryWageCeilingCents: CPF_MAX_OW_CENTS,
  annualSalaryCeilingCents: CPF_ANNUAL_SALARY_CEILING_CENTS,
  dueAndPayableYear: 2026,
  ordinaryWageCeilingSourceUrl: CPF_2026_OW_CEILING_URL,
  additionalWageCeilingSourceUrl: CPF_2026_AW_CEILING_URL
});
