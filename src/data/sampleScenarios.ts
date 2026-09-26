export interface SamplePrompt {
  id: string;
  title: string;
  standard: string;
  query: string;
  tag: string;
}

export const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    id: 'capitalisation-r-and-d',
    title: 'Software R&D Capitalisation (SFRS(I) 1-38 vs S14/EIS)',
    standard: 'SFRS(I) 1-38 & IRAS',
    query: 'Can software development expenditure be capitalised under SFRS(I) 1-38, and how does IRAS treat it for tax deduction?',
    tag: 'Intangibles & Tax'
  },
  {
    id: 'gst-compulsory-reg',
    title: 'GST Compulsory Registration ($1M Threshold)',
    standard: 'IRAS GST Act',
    query: 'Does our company need to register for GST if annual taxable turnover reaches SGD 1.2 million?',
    tag: 'GST Registration'
  },
  {
    id: 'entertainment-tax',
    title: 'Customer Entertainment Tax Deductibility',
    standard: 'IRAS Section 14 vs 15',
    query: 'Is customer entertainment expenditure tax-deductible for corporate tax in Singapore, and can we claim 9% input GST?',
    tag: 'Tax Deductibility'
  },
  {
    id: 'acra-small-company',
    title: 'ACRA Small Company Audit Exemption (§205C)',
    standard: 'Companies Act 1967',
    query: 'What are the ACRA requirements for small company audit exemption under Section 205C?',
    tag: 'ACRA Audit Exemption'
  },
  {
    id: 'cpf-ceilings-2026',
    title: '2026 CPF Ceilings ($8,000 OW) & Age Rates',
    standard: 'CPF Act 1953',
    query: 'What is the 2026 CPF Ordinary Wage ceiling and monthly contribution rates by employee age?',
    tag: 'CPF Mandates'
  },
  {
    id: 'mom-leave-ot',
    title: 'MOM Annual/Sick Leave & Overtime Pay',
    standard: 'Employment Act 1968',
    query: 'What are MOM statutory annual leave and outpatient sick leave entitlements, and overtime calculation rules?',
    tag: 'MOM Employment'
  },
  {
    id: 'car-purchase-blocked',
    title: 'Passenger Car: Blocked GST & Non-Deductible Depreciation',
    standard: 'IRAS Reg 26 & S15(1)(k)',
    query: 'I bought an S-plate passenger company car for SGD 120k with bank. How to record double entries and can I claim 9% GST under IRAS?',
    tag: 'Blocked GST & Tax'
  },
  {
    id: 'apple-shares-fx',
    title: 'Apple Shares (USD 300k to 400k, SGD functional)',
    standard: 'SFRS(I) 9 & 1-21',
    query: 'A company primary currency is SGD, it invested USD300k into 300 apple shares on 13/11/2026, subsequently the company sold 300 shares for USD400k on 15/12/2026. What are the double entries and FX gain?',
    tag: 'FX Gain & Shares'
  },
  {
    id: 'machinery-loan-tradein',
    title: 'Machinery 100k, Trade-in & Loan',
    standard: 'SFRS(I) 1-16 & 9',
    query: 'I bought a new machine for 100k, trade in old machine for 20k, paid cash 30k, balance financed by 2-year equipment loan with 5% annual interest. How to record double entries?',
    tag: 'PPE & Loan'
  }
];
