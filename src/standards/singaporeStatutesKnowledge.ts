import type { StatutoryAuthority, StandardCitation, StatutoryAdvisoryInfo } from '../types/accounting';

export interface SingaporeStatuteRule {
  id: string;
  authority: StatutoryAuthority;
  authorityName: string;
  actTitle: string;
  actCode: string; // Short code for SSO, e.g. "ITA1947", "CA1967", "GSTA1993", "CPFA1953"
  sectionOrSchedule: string;
  ruleTitle: string;
  category: 'TAX_INCOME' | 'TAX_GST' | 'ACRA_COMPLIANCE' | 'CPF_PAYROLL' | 'MOM_LABOUR' | 'MAS_FINANCE' | 'CUSTOMS_TRADE';
  principle: string;
  application: string;
  practicalRules: string[];
  canonicalUrl: string;
  tags: string[];
}

export const SINGAPORE_STATUTORY_REPOSITORY: Record<string, SingaporeStatuteRule> = {
  // -------------------------------------------------------------
  // 1. IRAS & INCOME TAX ACT 1947
  // -------------------------------------------------------------
  ITA_SEC14_GENERAL_DEDUCTION: {
    id: 'ITA_SEC14_GENERAL_DEDUCTION',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore & AGC',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 14(1)',
    ruleTitle: 'General Tax Deductibility of Business Expenses ("Wholly & Exclusively")',
    category: 'TAX_INCOME',
    principle: 'For the purpose of ascertaining the income of any person for any period, there shall be deducted all outgoings and expenses wholly and exclusively incurred during that period by that person in the production of the income.',
    application: 'Operating expenses (rental, staff salaries, utilities, marketing, trade debt provisions) directly related to revenue generation are tax-deductible.',
    practicalRules: [
      'Must be wholly and exclusively incurred in the production of income.',
      'Must not be capital in nature (e.g. initial setup costs, asset purchases).',
      'Must not be prohibited under Section 15 of the Income Tax Act.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947#pr14-',
    tags: ['tax deduction', 'deductible expenses', 'section 14', 'business expenses', 'p&l deduction']
  },

  ITA_SEC15_PROHIBITED_DEDUCTIONS: {
    id: 'ITA_SEC15_PROHIBITED_DEDUCTIONS',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore & AGC',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 15(1)',
    ruleTitle: 'Prohibited Non-Deductible Business Expenses',
    category: 'TAX_INCOME',
    principle: 'Notwithstanding any other provisions of this Act, no deduction shall be allowed in respect of: domestic or private expenses; capital sums; improvements; fines and statutory penalties; and non-trade expenses.',
    application: 'Statutory fines (ACRA late filing fines, traffic fines), non-business private expenses paid via company funds, and capital acquisitions cannot be deducted against corporate tax.',
    practicalRules: [
      'Private or domestic expenses of directors/shareholders are disallowed.',
      'Fines and penalties imposed for violation of law are strictly non-deductible.',
      'Income tax paid or payable is non-deductible.',
      'Capital expenditure must be added back in tax computation (capital allowances claimed separately).'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947#pr15-',
    tags: ['non-deductible', 'prohibited expenses', 'fines', 'section 15', 'add-back']
  },

  ITA_SEC15_1_K_MOTOR_CAR: {
    id: 'ITA_SEC15_1_K_MOTOR_CAR',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 15(1)(k)',
    ruleTitle: 'Prohibition of Tax Deduction & Capital Allowances on Private Passenger Motor Cars (S-Plate)',
    category: 'TAX_INCOME',
    principle: 'No deduction shall be allowed for any outgoings and expenses incurred in respect of a motor car registered as a passenger car (whether private or company car, including RU and private hire cars used by staff), nor shall any capital allowance be granted.',
    application: 'Purchasing a private passenger car (S-plate) yields zero tax depreciation. Petrol, parking, road tax, repairs, and ERP incurred on company passenger cars are completely non-deductible.',
    practicalRules: [
      'Company passenger motor cars (S-plate cars) are completely disallowed for Section 14 deductions and Section 19/19A Capital Allowances.',
      'Commercial goods vehicles (G-plate, Y-plate vans, lorries, trucks) ARE 100% eligible for Section 19A Capital Allowances and running expenses are deductible.',
      'Strict add-back of car depreciation and operating expenses is mandatory in Form C-S Tax Computation.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947#pr15-',
    tags: ['car expenses', 'passenger car', 'motor car', 's-plate', 'car depreciation', 'section 15(1)(k)']
  },

  ITA_SEC19_19A_CAPITAL_ALLOWANCES: {
    id: 'ITA_SEC19_19A_CAPITAL_ALLOWANCES',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 19 & Section 19A',
    ruleTitle: 'Capital Allowances on Plant and Machinery in Lieu of Depreciation',
    category: 'TAX_INCOME',
    principle: 'Accounting depreciation is disallowed for tax. In its place, Capital Allowances (CA) are granted on qualifying plant and machinery used in trade or business.',
    application: 'Companies write off machinery, computers, and office equipment over 1 year (Section 19A(2) 100% write-off for computers & automation equipment, or low-value assets $\\le\\$5,000$ capped at $\\sim\\$30,000$ per YA) or over 3 years straight-line (Section 19A(1)).',
    practicalRules: [
      'Accounting depreciation is added back in tax computation.',
      'Section 19A(1): Accelerated 3-year write-off (33.33% per year).',
      'Section 19A(2): 1-year (100%) accelerated write-off for computers, software, and qualifying automation equipment.',
      'Low-Value Assets: Assets costing $\\le\\$5,000$ each can be fully written off in 1 year, subject to an aggregate limit of $\\$30,000$ per YA.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947#pr19A-',
    tags: ['capital allowance', 'depreciation add-back', 'section 19a', 'plant and machinery', 'computers']
  },

  ITA_SUTE_PTE_TAX_EXEMPTION: {
    id: 'ITA_SUTE_PTE_TAX_EXEMPTION',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 43 & Tax Exemption Schemes',
    ruleTitle: 'Corporate Income Tax (CIT) Rate & Tax Exemption Schemes (SUTE & PTE)',
    category: 'TAX_INCOME',
    principle: 'Headline corporate income tax rate in Singapore is a flat 17%. Qualifying companies enjoy Start-Up Tax Exemption (SUTE) or Partial Tax Exemption (PTE).',
    application: 'Reduces effective corporate tax significantly below 17%.',
    practicalRules: [
      'Headline Corporate Tax Rate: 17% on chargeable income.',
      'Start-Up Tax Exemption (SUTE) for qualifying new companies (first 3 consecutive YAs):\n  - 75% exemption on the first SGD 100,000 of normal chargeable income\n  - 50% exemption on the next SGD 100,000\n  - Maximum tax exemption of SGD 125,000 (Effective tax on first SGD 200k = ~8.92%).',
      'Partial Tax Exemption (PTE) for all other companies:\n  - 75% exemption on the first SGD 10,000\n  - 50% exemption on the next SGD 190,000\n  - Maximum tax exemption of SGD 102,500.',
      'SUTE Qualifying Conditions: Incorporated in Singapore, tax resident in Singapore, max 20 individual shareholders (or at least 1 individual holding $\\ge 10\\%$ of ordinary shares).'
    ],
    canonicalUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax/basics-of-corporate-income-tax/tax-rates-and-tax-exemption-schemes',
    tags: ['tax rate', 'sute', 'pte', 'corporate tax', 'tax exemption', '17%']
  },

  IRAS_FORM_CS_LITE_CRITERIA: {
    id: 'IRAS_FORM_CS_LITE_CRITERIA',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Income Tax Act 1947 & IRAS Filing Guidelines',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Form C-S / Form C-S (Lite) / Form C Guidelines',
    ruleTitle: 'Eligibility Criteria for Form C-S and Form C-S (Lite) Tax Filing',
    category: 'TAX_INCOME',
    principle: 'Small companies with straightforward tax affairs can file simplified tax returns (Form C-S or Form C-S Lite) without attaching financial statements or tax computations upfront.',
    application: 'SMEs can complete Form C-S online via myTax Portal in minutes.',
    practicalRules: [
      'Form C-S (Lite): Annual revenue $\\le\\$200,000$, company incorporated in Singapore, derives only 17% taxable income, not claiming group relief/investment allowance/foreign tax credit.',
      'Form C-S: Annual revenue $\\le\\$5,000,000$, company incorporated in Singapore, derives only 17% taxable income, not claiming group relief/investment allowance.',
      'Form C: For companies with annual revenue $>\$5,000,000$ or claiming complex incentives, foreign tax credits, or group relief. Mandatory to attach audited/unaudited accounts and tax computations.',
      'Filing Deadline: 30 November of the Year of Assessment (YA) via myTax Portal.'
    ],
    canonicalUrl: 'https://www.iras.gov.sg/taxes/corporate-income-tax/filing-your-corporate-income-tax-return-(form-c-s-form-c-s-(lite)-form-c)',
    tags: ['form c-s', 'form c-s lite', 'form c', 'tax filing deadline', 'annual revenue 5m']
  },

  // -------------------------------------------------------------
  // 2. IRAS & GOODS AND SERVICES TAX ACT 1993
  // -------------------------------------------------------------
  GST_REGISTRATION_COMPULSORY_THRESHOLD: {
    id: 'GST_REGISTRATION_COMPULSORY_THRESHOLD',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Goods and Services Tax Act 1993',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'First Schedule',
    ruleTitle: 'Compulsory GST Registration Threshold ($1,000,000 Turnover)',
    category: 'TAX_GST',
    principle: 'A business is legally liable to register for GST if its taxable turnover exceeds SGD 1,000,000 under either the retrospective or prospective basis.',
    application: 'SMEs must monitor taxable turnover at the end of each calendar year and projected 12 months.',
    practicalRules: [
      'Retrospective Basis: Taxable turnover at the end of the calendar year (31 Dec) exceeds SGD 1,000,000. Must apply for registration within 30 days (by 30 Jan).',
      'Prospective Basis: At any time, you reasonably expect taxable turnover in the next 12 months to exceed SGD 1,000,000. Must apply for registration within 30 days of the date of forecast.',
      'Voluntary Registration: Businesses below SGD 1M turnover may voluntarily register, but must remain registered for at least 2 years and maintain GIRO for payment/refunds.',
      'GST Rate: Standard rate is 9% (effective 1 January 2024).'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/GSTA1993#Sc1-',
    tags: ['gst registration', 'turnover 1m', 'compulsory gst', 'prospective', 'retrospective']
  },

  GST_REG26_BLOCKED_INPUT_TAX: {
    id: 'GST_REG26_BLOCKED_INPUT_TAX',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'GST (General) Regulations',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'Regulation 26 & 27',
    ruleTitle: 'Disallowed / Blocked Input Tax Claims under Singapore GST Law',
    category: 'TAX_GST',
    principle: 'Input tax incurred on certain specified business goods or services is strictly disallowed from recovery, even if incurred for business purposes.',
    application: 'A GST-registered company cannot claim back the 9% input GST paid on company cars, club fees, or employee family medical coverage.',
    practicalRules: [
      '1. Motor Cars: Input tax incurred on the purchase, hire, or running expenses (petrol, parking, repair) of a passenger motor car (S-plate) is strictly non-claimable.',
      '2. Club Subscription Fees: Entrance fees and subscription charges paid to sports, recreational, or social clubs.',
      '3. Medical and Accident Insurance: Medical expenses and insurance premiums for staff (unless mandatory under Work Injury Compensation Act [WICA] or collective agreement). Medical expenses for staff family members are 100% blocked.',
      '4. Family Benefits: Any expenses incurred on benefits provided to the family members of your employees.',
      '5. Betting & Lotteries: Transactions involving games of chance, lotteries, and betting.'
    ],
    canonicalUrl: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/claiming-gst-(input-tax)/conditions-for-claiming-input-tax',
    tags: ['blocked input tax', 'regulation 26', 'gst car claim', 'medical insurance gst', 'club subscriptions']
  },

  GST_SEC21_ZERO_RATED_EXPORTS: {
    id: 'GST_SEC21_ZERO_RATED_EXPORTS',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS)',
    actTitle: 'Goods and Services Tax Act 1993',
    actCode: 'GSTA1993',
    sectionOrSchedule: 'Section 21(3)',
    ruleTitle: 'Zero-Rating of International Services and Exported Goods (0% GST)',
    category: 'TAX_GST',
    principle: 'Supplies of goods exported out of Singapore and supplies of international services falling within Section 21(3) are zero-rated (taxed at 0%).',
    application: 'Singapore software companies exporting SaaS or advisory services to overseas clients bill at 0% GST and can still reclaim 9% input GST on business overheads.',
    practicalRules: [
      'Goods Export: Must maintain required export documentation (Bill of Lading, Air Waybill, export permits) within 60 days.',
      'International Services (Section 21(3)): Software, consulting, and management services provided under contract to overseas clients, directly benefiting an overseas person outside Singapore, qualify for 0% GST.',
      'Input Tax Benefit: Even though output tax is 0%, the business can claim 100% of input GST paid on qualifying business purchases.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/GSTA1993#pr21-',
    tags: ['zero rated', '0% gst', 'export of services', 'section 21(3)', 'international services']
  },

  // -------------------------------------------------------------
  // 3. ACRA & COMPANIES ACT 1967
  // -------------------------------------------------------------
  ACRA_SEC205C_SMALL_COMPANY_AUDIT_EXEMPTION: {
    id: 'ACRA_SEC205C_SMALL_COMPANY_AUDIT_EXEMPTION',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    actTitle: 'Companies Act 1967',
    actCode: 'CA1967',
    sectionOrSchedule: 'Section 205C & Thirteenth Schedule',
    ruleTitle: 'Small Company Audit Exemption Criteria (Revenue / Assets ≤ $10M, Staff ≤ 50)',
    category: 'ACRA_COMPLIANCE',
    principle: 'A company qualifies as a "small company" and is exempt from statutory audit if it is a private company and fulfills at least 2 of 3 criteria for the immediate past two consecutive financial years.',
    application: 'SMEs that meet the 2-out-of-3 test only need to prepare unaudited financial statements compliant with SFRS.',
    practicalRules: [
      'Criterion 1: Total annual revenue $\\le$ SGD 10,000,000.',
      'Criterion 2: Total gross assets $\\le$ SGD 10,000,000.',
      'Criterion 3: Total number of full-time employees at financial year-end $\\le 50$.',
      'Two Consecutive FYs Rule: Must satisfy at least 2 of 3 quantitative thresholds in each of the past 2 consecutive financial years.',
      'Group Requirement: If the company is part of a corporate group, the entire group must qualify as a "small group" on a consolidated basis to enjoy the audit exemption.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CA1967#pr205C-',
    tags: ['audit exemption', 'small company', 'section 205c', 'revenue 10m', 'assets 10m', 'employees 50']
  },

  ACRA_SEC175_197_AGM_ANNUAL_RETURN_TIMELINES: {
    id: 'ACRA_SEC175_197_AGM_ANNUAL_RETURN_TIMELINES',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    actTitle: 'Companies Act 1967',
    actCode: 'CA1967',
    sectionOrSchedule: 'Section 175, 175A & Section 197',
    ruleTitle: 'Annual General Meeting (AGM) and Annual Return (AR) Statutory Filing Deadlines',
    category: 'ACRA_COMPLIANCE',
    principle: 'Private companies must hold an AGM (unless dispensed with) within 6 months after the Financial Year End (FYE), and lodge their Annual Return (AR) via BizFile+ within 7 months after FYE.',
    application: 'For a company with FYE 31 December 2025: AGM by 30 June 2026; Annual Return lodged with ACRA by 31 July 2026.',
    practicalRules: [
      'Private Company AGM: Must be held within 6 months after FYE (Section 175).',
      'Dispensation of AGM: Private companies can dispense with holding an AGM if all members agree or if financial statements are sent to members within 5 months of FYE (Section 175A).',
      'Annual Return (AR) Lodgment: Must be filed on BizFile+ within 7 months after FYE (Section 197).',
      'Listed Companies: AGM within 4 months after FYE; Annual Return within 5 months after FYE.',
      'Late Lodgment Penalties: Minimum SGD 300 tier-escalating composition fine imposed by ACRA for late filing.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CA1967#pr197-',
    tags: ['agm deadline', 'annual return', 'bizfile', 'fye 6 months', 'fye 7 months', 'section 175', 'section 197']
  },

  ACRA_SEC199_RECORD_RETENTION: {
    id: 'ACRA_SEC199_RECORD_RETENTION',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    actTitle: 'Companies Act 1967',
    actCode: 'CA1967',
    sectionOrSchedule: 'Section 199(1)',
    ruleTitle: 'Mandatory 5-Year Accounting Records & Vouchers Retention',
    category: 'ACRA_COMPLIANCE',
    principle: 'Every company shall cause to be kept such accounting and other records as will sufficiently explain the transactions and financial position of the company. Records must be retained for at least 5 years.',
    application: 'All bank statements, supplier invoices, sales receipts, and journal entries must be kept for 5 years from the end of the financial year.',
    practicalRules: [
      'Retention Period: Minimum 5 years from the end of the financial year in which the transaction occurred.',
      'Location: Must be kept at the registered office or such other place in Singapore as the directors think fit.',
      'Electronic Storage: Electronic invoices and digital cloud archives are accepted provided they can be readily converted into readable form on demand.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CA1967#pr199-',
    tags: ['record retention', '5 years', 'accounting books', 'receipts', 'section 199']
  },

  ACRA_SEC145_RESIDENT_DIRECTOR: {
    id: 'ACRA_SEC145_RESIDENT_DIRECTOR',
    authority: 'ACRA',
    authorityName: 'Accounting and Corporate Regulatory Authority (ACRA)',
    actTitle: 'Companies Act 1967',
    actCode: 'CA1967',
    sectionOrSchedule: 'Section 145(1)',
    ruleTitle: 'Requirement for at Least One Ordinarily Resident Director in Singapore',
    category: 'ACRA_COMPLIANCE',
    principle: 'Every company must have at least one director who is ordinarily resident in Singapore.',
    application: 'Foreign business owners incorporating a Singapore private limited company must appoint at least one local Singapore resident director.',
    practicalRules: [
      'Eligible Resident Directors: Singapore Citizen, Singapore Permanent Resident (PR), or an EntrePass / Employment Pass (EP) holder holding a Letter of Consent (LOC) from MOM.',
      'Natural Person: Must be a natural person aged at least 18 years old and not disqualified under Section 148, 149, or 154 (e.g. not an undischarged bankrupt).',
      'Corporate Secretary (Section 171): Must appoint a resident company secretary within 6 months of incorporation. A sole director cannot act as company secretary.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/CA1967#pr145-',
    tags: ['resident director', 'section 145', 'company secretary', 'incorporation requirements']
  },

  // -------------------------------------------------------------
  // 4. CPF BOARD & CPF ACT 1953
  // -------------------------------------------------------------
  CPF_WAGE_CEILINGS_2026: {
    id: 'CPF_WAGE_CEILINGS_2026',
    authority: 'CPF',
    authorityName: 'Central Provident Fund Board (CPF)',
    actTitle: 'Central Provident Fund Act 1953',
    actCode: 'CPFA1953',
    sectionOrSchedule: 'First Schedule & Budget Statutory Ceilings',
    ruleTitle: 'Ordinary Wage (OW) Monthly Ceiling ($8,000 in 2026) & Additional Wage (AW) Ceiling',
    category: 'CPF_PAYROLL',
    principle: 'CPF contributions are payable on Ordinary Wages (OW) up to the statutory monthly wage ceiling, and on Additional Wages (AW) up to the annual ceiling formula.',
    application: 'Payroll calculations for Singapore Citizen and Permanent Resident employees.',
    practicalRules: [
      '2026 Ordinary Wage (OW) Ceiling: SGD 8,000 per month (effective 1 January 2026). Mandatory CPF is capped at SGD 8,000 of monthly basic salary.',
      'Historical Phased Ceilings: SGD 6,000 (pre-Sept 2023) -> SGD 6,800 (Jan 2024) -> SGD 7,400 (Jan 2025) -> SGD 8,000 (1 Jan 2026).',
      'Additional Wage (AW) Ceiling Formula: $$\\text{AW Ceiling} = \\text{SGD 102,000} - \\text{Total OW subject to CPF in the year}$$.',
      'Contribution Rates (Age $\\le 55$): Employer 17%, Employee 20% (Total 37%). For SGD 8,000 salary: Employer = SGD 1,360, Employee = SGD 1,600 (Total = SGD 2,960).',
      'Due Date: CPF contributions are due at the end of the calendar month and must be paid by the 14th of the following month.'
    ],
    canonicalUrl: 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay',
    tags: ['cpf ceiling', 'ordinary wage 8000', 'aw ceiling', 'cpf rates 2026', 'cpf contribution']
  },

  CPF_SDL_SKILLS_DEVELOPMENT_LEVY: {
    id: 'CPF_SDL_SKILLS_DEVELOPMENT_LEVY',
    authority: 'CPF',
    authorityName: 'SkillsFuture Singapore & CPF Board',
    actTitle: 'Skills Development Levy Act 1979',
    actCode: 'SDLA1979',
    sectionOrSchedule: 'Section 3',
    ruleTitle: 'Skills Development Levy (SDL) Calculation Formula (0.25%, Min $2, Max $11.25)',
    category: 'CPF_PAYROLL',
    principle: 'Employers must pay a monthly Skills Development Levy (SDL) for all employees rendering services in Singapore, collected by the CPF Board on behalf of SkillsFuture Singapore.',
    application: 'Calculated monthly alongside payroll and submitted together with monthly CPF returns.',
    practicalRules: [
      'Levy Rate: 0.25% of the total monthly remuneration of each employee.',
      'Minimum Monthly Cap: Minimum SGD 2.00 per employee earning less than SGD 800.',
      'Maximum Monthly Cap: Maximum SGD 11.25 per employee earning SGD 4,500 and above (0.25% of SGD 4,500).',
      'Applies to: All employees (Singapore Citizens, PRs, and foreign work pass holders [EP, S-Pass, Work Permit]).',
      'Tax Treatment: Employer SDL is an allowable business operating expense under Section 14 of the Income Tax Act.'
    ],
    canonicalUrl: 'https://www.cpf.gov.sg/employer/employer-obligations/skills-development-levy',
    tags: ['sdl', 'skills development levy', 'sdl formula', 'max 11.25', 'min 2.00']
  },

  CPF_EMPLOYER_TAX_DEDUCTIBILITY: {
    id: 'CPF_EMPLOYER_TAX_DEDUCTIBILITY',
    authority: 'IRAS',
    authorityName: 'Inland Revenue Authority of Singapore (IRAS) & AGC',
    actTitle: 'Income Tax Act 1947',
    actCode: 'ITA1947',
    sectionOrSchedule: 'Section 14(1)(e)',
    ruleTitle: 'Tax Deductibility of Statutory Employer CPF Contributions',
    category: 'TAX_INCOME',
    principle: 'Mandatory employer contributions made in respect of an employee to the CPF pursuant to the CPF Act are allowable as deductions in determining taxable corporate profit.',
    application: 'Company claims full tax deduction for the 17% employer CPF expense in P&L.',
    practicalRules: [
      'Mandatory CPF: Fully deductible up to the statutory limits (OW ceiling SGD 8,000 / AW ceiling formula).',
      'Voluntary CPF / Excess Contributions: Any employer CPF contribution exceeding the statutory ceiling is non-deductible for the employer and is taxable income in the hands of the employee.',
      'Self-Employed / Working Directors: Working directors who are employees of the company receive tax-deductible employer CPF under Section 14(1)(e).'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/ITA1947#pr14-',
    tags: ['cpf tax deduction', 'section 14(1)(e)', 'employer cpf', 'voluntary cpf']
  },

  // -------------------------------------------------------------
  // 5. MOM & EMPLOYMENT ACT 1968
  // -------------------------------------------------------------
  MOM_SEC21_SALARY_TIMELINES: {
    id: 'MOM_SEC21_SALARY_TIMELINES',
    authority: 'MOM',
    authorityName: 'Ministry of Manpower (MOM)',
    actTitle: 'Employment Act 1968',
    actCode: 'EA1968',
    sectionOrSchedule: 'Section 21 & Section 22',
    ruleTitle: 'Statutory Salary and Overtime Payment Timelines (Within 7 / 14 Days)',
    category: 'MOM_LABOUR',
    principle: 'An employer must pay salary to employees at least once a month and within 7 days after the end of the salary period. Overtime pay must be paid within 14 days after the salary period.',
    application: 'Companies paying monthly salary must ensure bank transfers settle by the 7th of the following calendar month.',
    practicalRules: [
      'Basic Salary: Must be disbursed within 7 calendar days after the end of the salary period.',
      'Overtime Pay: Must be paid within 14 calendar days after the end of the salary period.',
      'Termination of Service by Employer: All outstanding salary and accumulated benefits must be paid on the last day of employment, or within 3 working days if notice cannot be served.',
      'Itemised Pay Slips: Mandatory under Section 96 of the Employment Act to provide itemised pay slips with every salary payment.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/EA1968#pr21-',
    tags: ['salary deadline', '7 days', 'overtime pay', 'itemised payslip', 'section 21']
  },

  // -------------------------------------------------------------
  // 6. MAS & FINANCIAL REGULATIONS
  // -------------------------------------------------------------
  MAS_ZERO_EXCHANGE_CONTROLS: {
    id: 'MAS_ZERO_EXCHANGE_CONTROLS',
    authority: 'MAS',
    authorityName: 'Monetary Authority of Singapore (MAS)',
    actTitle: 'Monetary Authority of Singapore Act 1970 & Foreign Exchange Framework',
    actCode: 'MASA1970',
    sectionOrSchedule: 'Exchange Control Liberalisation Directive',
    ruleTitle: 'Absence of Foreign Exchange Controls & Free Capital Movement in Singapore',
    category: 'MAS_FINANCE',
    principle: 'Singapore has completely liberalised all foreign exchange controls. There are no restrictions on foreign currency exchange, cross-border remittances, or profit repatriation.',
    application: 'Companies can maintain multi-currency bank balances (USD, EUR, SGD) and freely remit capital without needing approval from MAS.',
    practicalRules: [
      'Zero Exchange Controls: Residents and non-residents are free to buy, hold, and sell any foreign currency.',
      'Repatriation: 100% of capital, dividends, and profits can be remitted overseas freely without withholding tax on dividends.',
      'SFRS Accounting: Foreign exchange transactions must be translated at spot rate in accordance with SFRS(I) 1-21 / IAS 21, and monetary items revalued at closing rates.'
    ],
    canonicalUrl: 'https://www.mas.gov.sg/regulation/acts/monetary-authority-of-singapore-act',
    tags: ['exchange control', 'capital controls', 'profit repatriation', 'mas policy', 'foreign currency']
  },

  MAS_PSA_DIGITAL_TOKENS_AML: {
    id: 'MAS_PSA_DIGITAL_TOKENS_AML',
    authority: 'MAS',
    authorityName: 'Monetary Authority of Singapore (MAS)',
    actTitle: 'Payment Services Act 2019',
    actCode: 'PSA2019',
    sectionOrSchedule: 'Section 6 & MAS Notice PSN02',
    ruleTitle: 'Payment Services Act (PSA) Licensing & Digital Payment Token (DPT) Framework',
    category: 'MAS_FINANCE',
    principle: 'Entities providing digital payment token (DPT) dealing or exchange services in Singapore must be licensed under the Payment Services Act and comply with mandatory AML/CFT guidelines under MAS Notice PSN02.',
    application: 'Fintech and crypto companies handling customer fiat or token transfers.',
    practicalRules: [
      'License Types: Standard Payment Institution (SPI) or Major Payment Institution (MPI) based on monthly transaction volume thresholds ($3M payment transactions / $5M DPT transactions).',
      'IRAS Tax Treatment on Tokens: Citing the IRAS e-Tax Guide on Income Tax Treatment of Digital Tokens:\n  - Payment Tokens (e.g. Bitcoin, Ethereum): Exchanged for goods/services are exempt from GST.\n  - Utility Tokens: Treated as prepayment vouchers.\n  - Capital Gains: Non-taxable if held as long-term investment; trading profits are subject to 17% corporate income tax.'
    ],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/PSA2019',
    tags: ['payment services act', 'crypto tax', 'digital tokens', 'mas notice psn02', 'psa 2019']
  }
};

/**
 * Search the statutory knowledge repository by keyword or category, ranked by relevance.
 */
export function querySingaporeStatutes(query: string): SingaporeStatuteRule[] {
  const q = query.toLowerCase().trim();
  const scoredResults: { rule: SingaporeStatuteRule; score: number }[] = [];

  const queryWords = q.split(/\s+/).filter(w => w.length >= 3 && !['what', 'when', 'where', 'which', 'how', 'the', 'for', 'and', 'are'].includes(w));

  for (const rule of Object.values(SINGAPORE_STATUTORY_REPOSITORY)) {
    let matchScore = 0;

    // Exact tag match
    for (const tag of rule.tags) {
      if (q.includes(tag)) {
        matchScore += 8;
      }
    }

    // Section match
    if (q.includes(rule.sectionOrSchedule.toLowerCase())) {
      matchScore += 10;
    }

    // Title match
    if (rule.ruleTitle.toLowerCase().includes(q)) {
      matchScore += 10;
    }

    // Keyword tokens
    for (const word of queryWords) {
      if (rule.ruleTitle.toLowerCase().includes(word)) matchScore += 3;
      if (rule.sectionOrSchedule.toLowerCase().includes(word)) matchScore += 4;
      if (rule.tags.some(t => t.includes(word))) matchScore += 2;
      if (rule.principle.toLowerCase().includes(word)) matchScore += 1;
      if (rule.practicalRules.some(r => r.toLowerCase().includes(word))) matchScore += 1;
    }

    if (matchScore > 0) {
      scoredResults.push({ rule, score: matchScore });
    }
  }

  scoredResults.sort((a, b) => b.score - a.score);
  return scoredResults.map(s => s.rule);
}

/**
 * Convert a SingaporeStatuteRule into standard citation format
 */
export function convertToCitation(rule: SingaporeStatuteRule): StandardCitation {
  return {
    standard: `${rule.actTitle} (${rule.authority})`,
    paragraph: rule.sectionOrSchedule,
    title: rule.ruleTitle,
    text: rule.principle,
    officialSourceUrl: rule.canonicalUrl,
    authority: rule.authority
  };
}

/**
 * Convert a SingaporeStatuteRule into structured StatutoryAdvisoryInfo
 */
export function convertToAdvisory(rule: SingaporeStatuteRule): StatutoryAdvisoryInfo {
  return {
    authority: rule.authority,
    statuteOrAct: rule.actTitle,
    sectionOrSchedule: rule.sectionOrSchedule,
    topic: rule.ruleTitle,
    summary: rule.principle,
    keyRules: rule.practicalRules,
    officialUrl: rule.canonicalUrl,
    isTaxDeductible: rule.id === 'ITA_SEC15_1_K_MOTOR_CAR' ? false : rule.id === 'ITA_SEC14_GENERAL_DEDUCTION' ? true : undefined,
    isGstClaimable: rule.id === 'GST_REG26_BLOCKED_INPUT_TAX' ? false : undefined
  };
}
