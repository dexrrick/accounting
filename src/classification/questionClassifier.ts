import { getCoverageTopicsByIds, type SingaporeKnowledgeDomain } from '../standards/coverageRegistry';
import { defaultQueryTopicResolver } from '../retrieval/queryTopicResolver';

export type CanonicalDomain =
  | 'ACCOUNTING'
  | 'TAX'
  | 'GST'
  | 'CORPORATE_REGULATORY'
  | 'EMPLOYMENT'
  | 'PAYROLL'
  | 'MAS_FUNDS'
  | 'MIXED'
  | 'GENERAL';

export interface QuestionClassificationResult {
  primaryDomain: CanonicalDomain;
  /** Fine-grained topic domains from the master Singapore coverage registry. */
  domains: SingaporeKnowledgeDomain[];
  /** Canonical topic IDs shared with retrieval and the coverage catalog. */
  topicIds: string[];
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
  const decomposition = defaultQueryTopicResolver.decomposeQuery(query);
  const allTopicIds = decomposition.topics.map(topic => topic.id);
  const allTopicMetadata = getCoverageTopicsByIds(allTopicIds);
  const explicitAccountingIntent = /\b(?:accounting|journal|bookkeeping|debit|balance sheet|financial statements?|p&l|sfrs|ifrs|capitalis\w*)\b/i.test(q) ||
    /\bdouble entr\w*/i.test(q);
  const taxCreditWithoutAccountingIntent = /\b(?:foreign tax credit|tax credit|double tax relief foreign tax credit)\b/i.test(q) && !explicitAccountingIntent;
  const passengerCarTaxOnlyContext = /\b(?:s-plate|passenger (?:motor )?car)\b/i.test(q) &&
    /\b(?:deduct\w*|running costs?|capital allowances?|income tax|corporate tax)\b/i.test(q) &&
    !explicitAccountingIntent;
  const employmentTaxAssessmentContext = /\b(?:bonus|directors?(?:['’]s)? fees?)\b/i.test(q) &&
    /\b(?:employee tax|employment income|tax assessment|assessment year|year of assessment|taxable year)\b/i.test(q) &&
    !/\b(?:acra|companies act|annual return|agm|audit exemption|director duties|conflict of interest|section 156)\b/i.test(q);
  const withholdingDueDateOnlyContext = /\b(?:wht|withholding tax)\b/i.test(q) &&
    /\b(?:treated as paid|deemed payment|deemed paid|deemed date|filing due|payment due|due date|deadline)\b/i.test(q) &&
    !/\b(?:rates?|payment categor(?:y|ies)|types? of payment|subject to (?:wht|withholding tax)|whether (?:wht|withholding tax) applies)\b/i.test(q);
  const topicMetadata = allTopicMetadata.filter(topic =>
    !(passengerCarTaxOnlyContext && topic.domainId.startsWith('ACCOUNTING_')) &&
    !(employmentTaxAssessmentContext && topic.domainId.startsWith('ACRA_')) &&
    !(withholdingDueDateOnlyContext && topic.id === 'iras-withholding-tax')
  );
  const topicIds = topicMetadata.map(topic => topic.id);

  // 1. Domain Indicator Detection
  const hasAccounting =
    q.includes('capitalis') ||
    q.includes('capitaliz') ||
    q.includes('sfrs') ||
    q.includes('ifrs') ||
    /\bias\s*\d*\b/i.test(q) ||
    q.includes('intangible asset') ||
    (q.includes('depreciat') && !passengerCarTaxOnlyContext) ||
    q.includes('amorti') ||
    q.includes('debit') ||
    (/\bcredit\b/i.test(q) && !taxCreditWithoutAccountingIntent) ||
    q.includes('journal') ||
    q.includes('double entr') ||
    q.includes('bookkeeping') ||
    q.includes('accrual') ||
    /\bleases?\b/i.test(q) ||
    q.includes('rou asset') ||
    q.includes('fvtpl') ||
    q.includes('fvtoci') ||
    q.includes('financial asset') ||
    q.includes('trade discount') ||
    q.includes('balance sheet') ||
    q.includes('p&l') ||
    q.includes('financial statement') ||
    q.includes('financial statements') ||
    q.includes('statement of profit') ||
    q.includes('statement of comprehensive income') ||
    q.includes('restatement') ||
    q.includes('restate') ||
    q.includes('reclassif') ||
    q.includes('presentation of income') ||
    q.includes('revenue presentation') ||
    topicMetadata.some(topic => topic.domainId.startsWith('ACCOUNTING_'));

  const hasTaxAcronym = /\b(ir21|ir8a|ir8s|ais|absd|bsd|tpd|crs|fatca|eci)\b/i.test(q);
  const hasNonGstTaxTopic = topicMetadata.some(topic => topic.domainId.startsWith('IRAS_') && topic.domainId !== 'IRAS_GST');

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
    /\bsute\b/i.test(q) ||
    q.includes('partial tax exempt') ||
    q.includes('form c') ||
    /\beis\b/i.test(q) ||
    q.includes('enterprise innovation') ||
    q.includes('add-back') ||
    q.includes('tax treatment') ||
    q.includes('withholding tax') ||
    hasTaxAcronym ||
    hasNonGstTaxTopic;

  const hasGst =
    /\bgst\b/i.test(q) ||
    q.includes('goods and services tax') ||
    q.includes('input tax') ||
    q.includes('output tax') ||
    q.includes('regulation 26') ||
    q.includes('blocked input') ||
    q.includes('taxable turnover') ||
    q.includes('compulsory registration') ||
    q.includes('register for gst') ||
    topicMetadata.some(topic => topic.domainId === 'IRAS_GST');

  // References to an investee's directors can be evidence in an accounting
  // control/significant-influence assessment. They should not independently
  // route the question into company-law coverage unless corporate context is
  // explicit or the question is not framed as an investee accounting issue.
  const hasInvesteeAccountingGovernanceContext =
    /\b(?:investee|associate|subsidiary)\b/i.test(q) &&
    /\b(?:control|significant influence|relevant operating decisions|policy decisions)\b/i.test(q);

  const hasCorporate =
    q.includes('acra') ||
    q.includes('companies act') ||
    q.includes('audit exemption') ||
    q.includes('small company') ||
    q.includes('section 205c') ||
    q.includes('section 201') ||
    q.includes('annual return') ||
    /\bagm\b/i.test(q) ||
    (q.includes('director') && !hasInvesteeAccountingGovernanceContext && !employmentTaxAssessmentContext) ||
    q.includes('share capital') ||
    topicMetadata.some(topic => topic.domainId.startsWith('ACRA_'));

  const hasPayroll =
    /\bcpf\b/i.test(q) ||
    q.includes('central provident fund') ||
    q.includes('ordinary wage') ||
    q.includes('ow ceiling') ||
    q.includes('additional wage') ||
    q.includes('aw ceiling') ||
    q.includes('medisave') ||
    q.includes('employer contribution') ||
    q.includes('employee contribution') ||
    q.includes('skills development levy') ||
    /\bsdl\b/i.test(q) ||
    /\b(shg|sinda|cdac|mbmf|ecf)\b/i.test(q) ||
    topicMetadata.some(topic => topic.domainId.startsWith('CPF_'));

  const hasEmploymentContext =
    q.includes('ministry of manpower') ||
    q.includes('employment act') ||
    q.includes('annual leave') ||
    q.includes('sick leave') ||
    q.includes('hospitalisation leave') ||
    q.includes('overtime') ||
    q.includes('part iv') ||
    q.includes('working hours') ||
    q.includes('rest day') ||
    q.includes('retrenchment') ||
    q.includes('progressive wage') ||
    /\bpwm\b/i.test(q) ||
    /\btadm\b/i.test(q) ||
    q.includes('flexible work arrangement') ||
    /\bfwa\b/i.test(q) ||
    q.includes('work permit') ||
    q.includes('employment pass') ||
    /\bs pass\b/i.test(q) ||
    q.includes('foreign worker') ||
    /\bdrc\b|\bfwl\b/i.test(q);

  const hasMomAcronymInEmploymentContext =
    /\bmom\b/i.test(q) &&
    /\b(employment|work pass|employee|worker|salary|leave|overtime|quota|levy|retrenchment|pwms?)\b/i.test(q);

  const hasEmployment =
    hasEmploymentContext || hasMomAcronymInEmploymentContext || topicMetadata.some(topic => topic.domainId.startsWith('MOM_'));

  const hasMasFunds =
    /\bmas\b/i.test(q) ||
    q.includes('family office') ||
    q.includes('single family office') ||
    q.includes('fund manager') ||
    q.includes('fund management company') ||
    q.includes('fund management') ||
    q.includes('fund admin') ||
    q.includes('fund administrator') ||
    q.includes('13o') || q.includes('13u') || q.includes('cms licence') ||
    topicMetadata.some(topic => topic.domainId.startsWith('MAS_'));

  const hasPayrollCalculation =
    (q.includes('salary') || q.includes('earning') || q.includes('earns') || q.includes('payroll') || q.includes('wages') || q.includes('wage')) &&
    (q.includes('cpf') || q.includes('last day') || q.includes('resignation') || q.includes('prorat') || q.includes('staff') || q.includes('employee')) &&
    (q.includes('calculat') || q.includes('compute') || q.includes('how much') || /\d+/.test(q));

  // 2. Map Authorities
  const authorities: string[] = [];
  if (hasAccounting) authorities.push('ACRA'); // ACRA ASC sets accounting standards
  if (hasTax || hasGst || hasPayrollCalculation) authorities.push('IRAS');
  if (hasCorporate && !authorities.includes('ACRA')) authorities.push('ACRA');
  if (hasPayroll || hasPayrollCalculation) authorities.push('CPF');
  if (hasEmployment || hasPayrollCalculation) authorities.push('MOM');
  if (hasMasFunds) authorities.push('MAS');

  // Topic metadata routes authorities for registered topics (including multiple authorities).
  for (const authority of topicMetadata.flatMap(topic => topic.authorities)) {
    if (!authorities.includes(authority)) authorities.push(authority);
  }

  const multiAuthority = authorities.length > 1;
  const domains = [...new Set(topicMetadata.map(topic => topic.domainId))];
  const addDomainIfMissing = (domain: SingaporeKnowledgeDomain) => {
    if (!domains.includes(domain)) domains.push(domain);
  };
  if (hasAccounting && !domains.some(domain => domain.startsWith('ACCOUNTING_'))) addDomainIfMissing('ACCOUNTING_SFRS');
  if (hasGst && !domains.includes('IRAS_GST')) addDomainIfMissing('IRAS_GST');
  if (hasCorporate && !domains.some(domain => domain.startsWith('ACRA_'))) addDomainIfMissing('ACRA_COMPANIES');
  if (hasEmployment && !domains.some(domain => domain.startsWith('MOM_'))) addDomainIfMissing('MOM_EMPLOYMENT');
  if (hasPayroll && !domains.some(domain => domain.startsWith('CPF_'))) addDomainIfMissing('CPF_CONTRIBUTIONS');
  if (hasMasFunds && !domains.some(domain => domain.startsWith('MAS_'))) addDomainIfMissing('MAS_FUND_MANAGEMENT');
  if (hasTax) {
    if (/\b(ir21|ir8a|ir8s|ais|benefits-in-kind|benefits in kind)\b/i.test(q)) addDomainIfMissing('IRAS_EMPLOYER_TAX');
    else if (/\b(personal tax|individual tax|tax residency|tax resident|183[- ]day|personal relief)\b/i.test(q)) addDomainIfMissing('IRAS_INDIVIDUAL_TAX');
    else if (/\b(property tax|annual value)\b/i.test(q)) addDomainIfMissing('IRAS_PROPERTY_TAX');
    else if (/\b(stamp duty|bsd|absd|ssd)\b/i.test(q)) addDomainIfMissing('IRAS_STAMP_DUTY');
    else if (/\b(crs|fatca)\b/i.test(q)) addDomainIfMissing('IRAS_CRS_FATCA');
    else if (/\b(corporate tax|company tax|income tax|tax deduct\w*|deductib\w*|capital allowance|form c|sute|pte|section 14|section 15|section 19|transfer pricing|tax loss|group relief|withholding tax|eci)\b/i.test(q)) addDomainIfMissing('IRAS_CORPORATE_TAX');
  }
  if (multiAuthority) domains.push('MULTI_AUTHORITY');

  // 3. Determine Primary Domain
  let primaryDomain: CanonicalDomain = 'GENERAL';
  if (multiAuthority) {
    primaryDomain = 'MIXED';
  } else if (hasAccounting) {
    primaryDomain = 'ACCOUNTING';
  } else if (hasTax && (!hasGst || hasNonGstTaxTopic || /\b(corporate tax|income tax|withholding tax|tax deduct|deductib|capital allowance|sute|form c|eci)\b/i.test(q))) {
    primaryDomain = 'TAX';
  } else if (hasGst) {
    primaryDomain = 'GST';
  } else if (hasMasFunds) {
    primaryDomain = 'MAS_FUNDS';
  } else if (hasCorporate) {
    primaryDomain = 'CORPORATE_REGULATORY';
  } else if (hasPayroll) {
    primaryDomain = 'PAYROLL';
  } else if (hasEmployment) {
    primaryDomain = 'EMPLOYMENT';
  }

  // 4. Time-Sensitive Current Information Check
  // Guard against false positives like "depreciation rate" or "burn rate"
  const hasYear = /\b(202[4-9]|203\d)\b/.test(q);
  const asksCurrentStatus = /\b(current|currently|latest|prevailing|recent|new rate|effective date|now)\b/i.test(q);
  const asksStatutoryCeilingOrThreshold =
    (hasGst && (q.includes('register') || q.includes('threshold') || q.includes('turnover') || q.includes('rate') || q.includes('exceeds') || q.includes('million'))) ||
    (hasPayroll && (q.includes('ceiling') || q.includes('rate') || q.includes('tier') || q.includes('ow'))) ||
    (hasTax && (q.includes('tax rate') || q.includes('corporate rate') || q.includes('sute') || q.includes('pte'))) ||
    (hasCorporate && (q.includes('audit exemption') && (q.includes('qualify') || q.includes('threshold') || q.includes('criteria'))));

  const currentInformationRequired = hasYear || asksCurrentStatus || asksStatutoryCeilingOrThreshold;

  // 5. Intent and Calculation / Journal Requirements
  // Guard against numbers in statutory advisory queries falsely triggering journal entries
  const asksForEntries =
    q.includes('double entr') ||
    q.includes('journal') ||
    q.includes('accounting entr') ||
    q.includes('how to record') ||
    q.includes('how do i record') ||
    q.includes('debit and credit') ||
    q.includes('dr and cr') ||
    q.includes('show entries') ||
    q.includes('bookkeeping entry') ||
    q.includes('post entry');

  const isConceptualOrAdvisory =
    /^(what is|what are|explain|define|definition|describe|overview|difference between|how does|summarise|summarize|can i|can we|do we qualify|does it qualify|is it allowed|is it deductible|is it claimable|must we|must i|guidance on|requirements for|criteria for)\b/i.test(q.trim()) ||
    q.includes('do we qualify') ||
    q.includes('is it deductible') ||
    q.includes('is it claimable') ||
    q.includes('can i claim') ||
    q.includes('can we claim');

  const hasTransactionAction =
    (q.includes('bought') || q.includes('sold') || q.includes('purchased') || q.includes('acquired') || q.includes('invested') || q.includes('disposed of')) &&
    (asksForEntries || q.includes('shares') || q.includes('usd') || q.includes('asset') || q.includes('goods'));

  let intent: 'TRANSACTION' | 'STATUTORY_ADVISORY' | 'HYBRID' = 'STATUTORY_ADVISORY';
  if (asksForEntries && isConceptualOrAdvisory) {
    intent = 'HYBRID';
  } else if (asksForEntries || hasTransactionAction || hasPayrollCalculation) {
    intent = 'TRANSACTION';
  } else {
    intent = 'STATUTORY_ADVISORY';
  }

  // Journal entry is required if user asked for entries, active transaction, or payroll calculation
  const journalEntryRequired = asksForEntries || hasPayrollCalculation || (hasTransactionAction && !isConceptualOrAdvisory);

  // Calculation required ONLY if quantitative computation requested or active quantitative transaction
  const calculationRequired =
    q.includes('calculat') ||
    q.includes('compute') ||
    q.includes('how much') ||
    q.includes('what is the amount') ||
    q.includes('fx gain') ||
    q.includes('foreign exchange') ||
    q.includes('tax payable') ||
    hasPayrollCalculation ||
    (intent === 'TRANSACTION' && /\d+/.test(q) && !isConceptualOrAdvisory);

  // 6. Missing Facts Identification
  const missingFacts: string[] = [];
  const isPureConceptualQuery =
    /^(what is|what are|explain|define|definition|describe|overview|difference between|how does|summarise|summarize)\b/i.test(q.trim());

  // Capitalisation missing facts (only for scenario/transactional evaluation, not pure conceptual definitions)
  if (!isPureConceptualQuery && (q.includes('capitalis') || q.includes('capitaliz') || q.includes('development cost') || q.includes('r&d'))) {
    if (!q.includes('research') && !q.includes('development')) {
      missingFacts.push('Separation between research phase (expensed) and development phase');
    }
    if (!q.includes('criteria') && !q.includes('feasible') && !q.includes('feasibility')) {
      missingFacts.push('Confirmation of all 6 cumulative recognition criteria under SFRS(I) 1-38 §57');
    }
    if (!/\d+/.test(q)) {
      missingFacts.push('Specific expenditure amounts attributable to development activities');
    }
  }

  // Vehicle purchase missing facts (only when assessing a specific acquisition or claim)
  if (!isPureConceptualQuery && (q.includes('car') || q.includes('vehicle')) && (q.includes('bought') || q.includes('purchas') || q.includes('claim') || q.includes('deduct') || q.includes('entry'))) {
    if (!q.includes('s-plate') && !q.includes('g-plate') && !q.includes('passenger') && !q.includes('commercial')) {
      missingFacts.push('Vehicle registration classification (S-plate passenger car vs commercial goods vehicle)');
    }
  }

  // Scenario-specific tax conclusions need the facts that determine the
  // applicable IRAS treatment. Keep general explain/definition requests clear.
  const asksAboutSpecificTaxCase = !isPureConceptualQuery &&
    /\b(?:our|my|this|we|company|paid|paying|claim|file)\b/i.test(q);
  if (asksAboutSpecificTaxCase && hasTax && /\b(?:deductib\w*|deduct\w*|tax deduction)\b/i.test(q) &&
      /\b(?:expense|cost|payment|fee|meal|entertainment|renovat\w*|fit.out|machinery|equipment|car|vehicle|asset)\b/i.test(q)) {
    if (!/\b(?:business purpose|for the business|for our business|wholly and exclusively|private use|personal use)\b/i.test(q)) {
      missingFacts.push('Business purpose and any private element of the expense');
    }
    if (!/\b(?:capital|revenue expense|operating expense)\b/i.test(q)) {
      missingFacts.push('Whether the expenditure is capital or revenue in nature');
    }
  }
  if (/\b(?:renovat\w*|refurbish\w*|section 14n)\b/i.test(q) &&
      /\b(?:ya|year of assessment)\s*(20\d{2})\b/i.test(q) &&
      /\b(?:[0-3]?\d[/-][01]?\d[/-]20\d{2}|20\d{2}-[01]\d-[0-3]\d|[0-3]?\d\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+20\d{2})\b/i.test(q)) {
    const yaYear = /\b(?:ya|year of assessment)\s*(20\d{2})\b/i.exec(q)?.[1];
    const expenditureYear = /\b[0-3]?\d[/-][01]?\d[/-](20\d{2})\b/.exec(q)?.[1] ||
      /\b(20\d{2})-[01]\d-[0-3]\d\b/.exec(q)?.[1] ||
      /\b[0-3]?\d\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(20\d{2})\b/i.exec(q)?.[1];
    if (yaYear && expenditureYear && yaYear !== expenditureYear) {
      missingFacts.push('Company financial year end and YA basis period containing the renovation expenditure');
    }
  }
  if (asksAboutSpecificTaxCase && hasGst && /\b(?:claim|recover|charge|zero.rate|exempt)\b/i.test(q)) {
    if (!/\b(?:gst.registered|registered for gst|not registered for gst)\b/i.test(q)) {
      missingFacts.push('Supplier and customer GST registration status, where relevant');
    }
    if (!/\b(?:business use|private use|personal use|tax invoice)\b/i.test(q) && /\b(?:input tax|input gst|claim|recover)\b/i.test(q)) {
      missingFacts.push('Business or private use and supporting tax invoice for the GST claim');
    }
  }
  if (asksAboutSpecificTaxCase && /\b(?:withholding tax|\bwht\b)\b/i.test(q)) {
    if (!/\b(?:non.resident|resident in|tax resident in)\b/i.test(q)) {
      missingFacts.push('Recipient tax residence');
    }
    if (!/\b(?:performed in singapore|performed outside singapore|services in singapore|services outside singapore)\b/i.test(q) &&
        /\b(?:service|management|technical|consult)\b/i.test(q)) {
      missingFacts.push('Where the services were physically performed');
    }
    if (/\b(?:service|management|technical|consult)\b/i.test(q) &&
        !/\b(?:services? (?:were |was )?(?:provided|performed|rendered) (?:in|during) (?:19|20)\d{2}|service (?:year|period) (?:19|20)\d{2})\b/i.test(q)) {
      missingFacts.push('Year or period when the services were provided');
    }
    if (!/\b(?:paid on|payment date|due on|credited on|deemed paid)\b/i.test(q)) {
      missingFacts.push('Payment or deemed-payment date');
    }
  }
  if (asksAboutSpecificTaxCase && /\bir21\b|tax clearance/i.test(q)) {
    if (!/\b(?:citizen|permanent resident|\bspr\b|foreign employee)\b/i.test(q)) {
      missingFacts.push('Employee citizenship or permanent-resident status');
    }
    if (!/\b(?:departure|departing|leaving singapore|overseas posting|cessation date|last day)\b/i.test(q)) {
      missingFacts.push('Employment cessation, departure or overseas-posting details');
    }
  }

  // Lease missing facts (only for active lease scenarios, not conceptual questions like "What is a lease under SFRS(I) 16?")
  if (!isPureConceptualQuery && (q.includes('rental agreement') || q.includes('lease agreement') || q.includes('renting') || q.includes('paying') || (q.includes('lease') && (/\d+/.test(q) || q.includes('term') || asksForEntries)))) {
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
    domains,
    topicIds,
    authorities,
    multiAuthority,
    currentInformationRequired,
    accountingAnalysisRequired: hasAccounting,
    taxAnalysisRequired: hasTax || hasGst,
    regulatoryAnalysisRequired: hasCorporate || hasPayroll || hasEmployment || topicMetadata.some(topic => !topic.domainId.startsWith('ACCOUNTING_')),
    calculationRequired,
    journalEntryRequired,
    missingFacts,
    intent,
    reasoning
  };
}
