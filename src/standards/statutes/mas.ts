import type { SingaporeStatuteRule } from './types';export const MAS_STATUTE_RULES: Record<string, SingaporeStatuteRule> = {  // -------------------------------------------------------------
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
    canonicalUrl: 'https://sso.agc.gov.sg/Act/MASA1970',
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
  },

  // -------------------------------------------------------------
};
