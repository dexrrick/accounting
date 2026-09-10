export type CanonicalDomain =
  | 'ACCOUNTING'
  | 'TAX'
  | 'GST'
  | 'CORPORATE_REGULATORY'
  | 'EMPLOYMENT'
  | 'PAYROLL'
  | 'MIXED'
  | 'GENERAL';

export interface QuestionClassificationResult {
  primaryDomain: CanonicalDomain;
  authorities: string[];
  multiAuthority: boolean;
  currentInformationRequired: boolean;
  accountingAnalysisRequired: boolean;
  taxAnalysisRequired: boolean;
  regulatoryAnalysisRequired: boolean;
  calculationRequired: boolean;
  journalEntryRequired: boolean;
  missingFacts: string[];
  intent: 'TRANSACTION' | 'STATUTORY_ADVISORY' | 'HYBRID';
  reasoning: string;
}

/**
 * Deterministic Question Classifier for Singapore Accounting & Statutory domains.
 * Accurately detects multi-authority questions, time-sensitivity, and missing facts.
 */
export function classifyQuestion(query: string): QuestionClassificationResult {
  const q = query.toLowerCase();

  // 1. Domain Indicator Detection
  const hasAccounting =
    q.includes('capitalis') ||
    q.includes('capitaliz') ||
    q.includes('sfrs') ||
    q.includes('ifrs') ||
    q.includes('ias') ||
    q.includes('intangible asset') ||
    q.includes('depreciat') ||
    q.includes('amorti') ||
    q.includes('debit') ||
    q.includes('credit') ||
    q.includes('journal') ||
    q.includes('double entr') ||
    q.includes('bookkeeping') ||
    q.includes('accrual') ||
    q.includes('lease') ||
    q.includes('rou asset') ||
    q.includes('fvtpl') ||
    q.includes('fvtoci') ||
    q.includes('financial asset') ||
    q.includes('trade discount') ||
    q.includes('balance sheet') ||
    q.includes('p&l');

  const hasTax =
    q.includes('tax deduct') ||
    q.includes('deductib') ||
    q.includes('corporate tax') ||
    q.includes('income tax') ||
    q.includes('iras') ||
    q.includes('section 14') ||
    q.includes('section 15') ||
    q.includes('section 19a') ||
    q.includes('capital allowance') ||
    q.includes('sute') ||
    q.includes('partial tax exempt') ||
    q.includes('form c') ||
    q.includes('eis') ||
    q.includes('enterprise innovation') ||
    q.includes('add-back') ||
    q.includes('tax treatment') ||
    q.includes('withholding tax');

  const hasGst =
    q.includes('gst') ||
    q.includes('goods and services tax') ||
    q.includes('input tax') ||
    q.includes('output tax') ||
    q.includes('regulation 26') ||
    q.includes('blocked input') ||
    q.includes('taxable turnover') ||
    q.includes('compulsory registration') ||
    q.includes('register for gst');

  const hasCorporate =
    q.includes('acra') ||
    q.includes('companies act') ||
    q.includes('audit exemption') ||
    q.includes('small company') ||
    q.includes('section 205c') ||
    q.includes('section 201') ||
    q.includes('annual return') ||
    q.includes('agm') ||
    q.includes('director') ||
    q.includes('share capital');

  const hasPayroll =
    q.includes('cpf') ||
    q.includes('central provident fund') ||
    q.includes('ordinary wage') ||
    q.includes('ow ceiling') ||
    q.includes('additional wage') ||
    q.includes('aw ceiling') ||
    q.includes('medisave') ||
    q.includes('employer contribution') ||
    q.includes('employee contribution');

  const hasEmployment =
    q.includes('mom') ||
    q.includes('ministry of manpower') ||
    q.includes('employment act') ||
    q.includes('annual leave') ||
    q.includes('sick leave') ||
    q.includes('hospitalisation leave') ||
    q.includes('overtime') ||
    q.includes('part iv') ||
    q.includes('working hours') ||
    q.includes('rest day') ||
    q.includes('retrenchment');

  // 2. Map Authorities
  const authorities: string[] = [];
  if (hasAccounting) authorities.push('ACRA'); // ACRA ASC sets accounting standards
  if (hasTax || hasGst) authorities.push('IRAS');
  if (hasCorporate && !authorities.includes('ACRA')) authorities.push('ACRA');
  if (hasPayroll) authorities.push('CPF');
  if (hasEmployment) authorities.push('MOM');

  const multiAuthority = authorities.length > 1;

  // 3. Determine Primary Domain
  let primaryDomain: CanonicalDomain = 'GENERAL';
  if (multiAuthority) {
    primaryDomain = 'MIXED';
  } else if (hasAccounting) {
    primaryDomain = 'ACCOUNTING';
  } else if (hasTax) {
    primaryDomain = 'TAX';
  } else if (hasGst) {
    primaryDomain = 'GST';
  } else if (hasCorporate) {
    primaryDomain = 'CORPORATE_REGULATORY';
  } else if (hasPayroll) {
    primaryDomain = 'PAYROLL';
  } else if (hasEmployment) {
    primaryDomain = 'EMPLOYMENT';
  }

  // 4. Time-Sensitive Current Information Check
  const currentInformationRequired =
    q.includes('2024') ||
    q.includes('2025') ||
    q.includes('2026') ||
    q.includes('current') ||
    q.includes('rate') ||
    q.includes('ceiling') ||
    q.includes('threshold') ||
    q.includes('audit exemption') ||
    q.includes('gst');

  // 5. Intent and Calculation / Journal Requirements
  const hasNumbers = /\d+/.test(q);
  const asksForEntries =
    q.includes('double entr') ||
    q.includes('journal') ||
    q.includes('entries') ||
    q.includes('how to record') ||
    q.includes('accounting entry') ||
    q.includes('debit');

  const asksPureAdvisory =
    q.includes('can i') ||
    q.includes('what are the requirements') ||
    q.includes('is it allowed') ||
    q.includes('what is the ceiling') ||
    q.includes('entitled') ||
    q.includes('threshold');

  let intent: 'TRANSACTION' | 'STATUTORY_ADVISORY' | 'HYBRID' = 'STATUTORY_ADVISORY';
  if (hasNumbers && asksForEntries) {
    intent = asksPureAdvisory ? 'HYBRID' : 'TRANSACTION';
  } else if (hasNumbers && !asksPureAdvisory) {
    intent = 'TRANSACTION';
  }

  const calculationRequired = hasNumbers || q.includes('calculat') || q.includes('how much') || intent === 'TRANSACTION';
  const journalEntryRequired = asksForEntries || intent === 'TRANSACTION';

  // 6. Missing Facts Identification
  const missingFacts: string[] = [];

  // Capitalisation missing facts
  if (q.includes('capitalis') || q.includes('capitaliz') || q.includes('development cost') || q.includes('r&d')) {
    if (!q.includes('research') && !q.includes('development')) {
      missingFacts.push('Separation between research phase (expensed) and development phase');
    }
    if (!q.includes('criteria') && !q.includes('feasible') && !q.includes('feasibility')) {
      missingFacts.push('Confirmation of all 6 cumulative recognition criteria under SFRS(I) 1-38 §57');
    }
    if (!hasNumbers) {
      missingFacts.push('Specific expenditure amounts attributable to development activities');
    }
  }

  // Vehicle purchase missing facts
  if (q.includes('car') || q.includes('vehicle')) {
    if (!q.includes('s-plate') && !q.includes('g-plate') && !q.includes('passenger') && !q.includes('commercial')) {
      missingFacts.push('Vehicle registration classification (S-plate passenger car vs commercial goods vehicle)');
    }
  }

  // Lease missing facts
  if (q.includes('lease') || q.includes('rental')) {
    if (!q.includes('discount rate') && !q.includes('borrowing rate') && !q.includes('interest rate') && !q.includes('%')) {
      missingFacts.push('Incremental borrowing rate (IBR) or rate implicit in lease under SFRS(I) 16 §26');
    }
    if (!q.includes('term') && !q.includes('year') && !q.includes('month')) {
      missingFacts.push('Enforceable lease duration / term');
    }
  }

  // Reasoning formulation
  const reasoning = multiAuthority
    ? `Multi-authority question spanning ${authorities.join(' & ')}. Separating financial reporting from statutory tax/regulatory compliance.`
    : `Single-domain ${primaryDomain} question governed by ${authorities[0] || 'Singapore Law'}.`;

  return {
    primaryDomain,
    authorities,
    multiAuthority,
    currentInformationRequired,
    accountingAnalysisRequired: hasAccounting,
    taxAnalysisRequired: hasTax || hasGst,
    regulatoryAnalysisRequired: hasCorporate || hasPayroll || hasEmployment,
    calculationRequired,
    journalEntryRequired,
    missingFacts,
    intent,
    reasoning
  };
}
