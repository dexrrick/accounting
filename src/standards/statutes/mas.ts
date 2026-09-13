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

  MAS_SFO_LICENSING_EXEMPTION_2026: {
    id: 'MAS_SFO_LICENSING_EXEMPTION_2026',
    authority: 'MAS',
    authorityName: 'Monetary Authority of Singapore (MAS)',
    sourcePublisher: 'MAS via Ask.gov.sg',
    legalOrStandardInstrument: 'MAS Single Family Office Licensing Exemption Framework',
    actTitle: 'Securities and Futures Act 2001 — Single Family Office Licensing Exemption',
    actCode: 'SFA2001',
    sectionOrSchedule: 'MAS FAQ — SFO licensing exemption (effective 15 June 2026)',
    ruleTitle: 'Single Family Office Fund Management Licensing Exemption',
    category: 'MAS_FINANCE',
    principle: 'An SFO that manages assets of one family and does not serve third-party customers or manage third-party monies may rely on the MAS licensing exemption framework, subject to the framework conditions.',
    application: 'Use before concluding whether a family investment office needs a CMS licence for fund management.',
    practicalRules: [
      'Confirm the managed assets and funding are limited to permitted family persons or entities; do not assume the exemption applies to third-party capital.',
      'File the required Notice of Commencement of Business with MAS and maintain the required accounts with an MAS-licensed bank.',
      'Treat the FAQ as official guidance and obtain specialist advice for an exemption or licensing conclusion.'
    ],
    canonicalUrl: 'https://ask.gov.sg/mas/questions/clx8ktis900dbryozeeumiiux?from=relatedquestions',
    supplementaryOfficialSources: [{ title: 'Securities and Futures Act 2001', url: 'https://sso.agc.gov.sg/Act/SFA2001', authority: 'AGC' }],
    tags: ['single family office', 'sfo', 'family office', 'cms licence', 'fund management', 'licensing exemption'],
    sourceStatus: 'VERIFIED', sourceType: 'CURATED_SUMMARY', evidenceTier: 'OFFICIAL_GUIDANCE', isVerbatimText: false,
    effectiveDate: '2026-06-15', validFrom: '2026-06-15', lastVerifiedDate: '2026-09-13', reviewAuditCycleDays: 90
  },

  MAS_SFO_13O_13U_MATERIAL_CHANGES: {
    id: 'MAS_SFO_13O_13U_MATERIAL_CHANGES',
    authority: 'MAS', authorityName: 'Monetary Authority of Singapore (MAS)',
    sourcePublisher: 'MAS via Ask.gov.sg', legalOrStandardInstrument: 'MAS Schemes for Single Family Offices FAQ',
    actTitle: 'Income Tax Act 1947 — Sections 13O and 13U fund-tax incentive administration', actCode: 'ITA1947',
    sectionOrSchedule: 'MAS FAQ — material changes to 13O/13U awardee',
    ruleTitle: 'Notification of Material Changes for 13O/13U Family Office Awardees', category: 'MAS_FINANCE',
    principle: 'MAS asks an approved 13O/13U awardee to notify it of additions or replacements of relevant persons and entities because they are material changes from the application information.',
    application: 'Use as a post-approval compliance checklist when ownership, beneficiaries, senior personnel, investment professionals, or intermediary entities change.',
    practicalRules: ['Identify the changed individual or entity and the revised ownership structure.', 'Escalate the change to the MAS officer-in-charge and covering officer using the current MAS process.', 'This is MAS official FAQ guidance; incentive eligibility requires the approval letter and current conditions to be reviewed.'],
    canonicalUrl: 'https://ask.gov.sg/mas/questions/cm1syf4ir000ds9rhalte1md9',
    supplementaryOfficialSources: [{ title: 'Income Tax Act 1947', url: 'https://sso.agc.gov.sg/Act/ITA1947', authority: 'AGC' }],
    tags: ['13o', '13u', 'family office tax incentive', 'material change', 'beneficial owner', 'investment professional'],
    sourceStatus: 'VERIFIED', sourceType: 'CURATED_SUMMARY', evidenceTier: 'OFFICIAL_GUIDANCE', isVerbatimText: false,
    lastVerifiedDate: '2026-09-13', reviewAuditCycleDays: 90
  },

  MAS_FMC_CMS_LICENSING: {
    id: 'MAS_FMC_CMS_LICENSING', authority: 'MAS', authorityName: 'Monetary Authority of Singapore (MAS)',
    sourcePublisher: 'Singapore Statutes Online / AGC', legalOrStandardInstrument: 'Securities and Futures Act 2001',
    actTitle: 'Securities and Futures Act 2001', actCode: 'SFA2001', sectionOrSchedule: 'Part IV — Capital Markets Services licensing',
    ruleTitle: 'Fund Management Activity and CMS Licensing Perimeter', category: 'MAS_FINANCE',
    principle: 'A person carrying on a regulated activity in Singapore must assess whether a Capital Markets Services licence, registration, or a statutory or MAS exemption applies before conducting fund management.',
    application: 'Classify a proposed manager structure before accepting third-party mandates, marketing a fund, or delegating investment discretion.',
    practicalRules: ['Do not apply an SFO exemption to a multi-family or third-party fund-manager arrangement without a fresh licensing analysis.', 'Use MAS licensing and conduct guidance to assess LFMC, RFMC or VCFM treatment and ongoing obligations.', 'Verify the entity and activity in the MAS Financial Institutions Directory where relevant.'],
    canonicalUrl: 'https://sso.agc.gov.sg/Act/SFA2001',
    supplementaryOfficialSources: [{ title: 'MAS Financial Institutions Directory', url: 'https://eservices.mas.gov.sg/fid', authority: 'MAS' }],
    tags: ['fund manager', 'fmc', 'lfmc', 'rfmc', 'vcfm', 'cms licence', 'fund management'],
    sourceStatus: 'NEEDS_REVIEW', sourceType: 'CURATED_SUMMARY', evidenceTier: 'CURATED_SUMMARY', isVerbatimText: false,
    lastVerifiedDate: '2026-09-13', reviewAuditCycleDays: 90
  },

  MAS_FUND_ADMIN_OUTSOURCING: {
    id: 'MAS_FUND_ADMIN_OUTSOURCING', authority: 'MAS', authorityName: 'Monetary Authority of Singapore (MAS)',
    sourcePublisher: 'Monetary Authority of Singapore', legalOrStandardInstrument: 'MAS Guidelines on Outsourcing',
    actTitle: 'MAS Guidelines on Outsourcing', actCode: 'MAS_OUTSOURCING', sectionOrSchedule: 'Outsourced fund-administration arrangements',
    ruleTitle: 'Fund Administration Outsourcing Governance and Oversight', category: 'MAS_FINANCE',
    principle: 'Delegating fund administration does not remove the regulated financial institution’s responsibility for governance, risk assessment, oversight, confidentiality, business continuity, and audit access.',
    application: 'Use when documenting NAV, valuation, investor-register, reporting, accounting, or middle-office administration outsourced to a service provider.',
    practicalRules: ['Document service scope, valuation/NAV controls, escalation, records ownership, security and business-continuity responsibilities.', 'Retain manager oversight, periodic performance review and rights to information or audit.', 'This record is operational regulatory guidance, not an accounting standard for a specific NAV calculation.'],
    canonicalUrl: 'https://www.mas.gov.sg/regulation/guidelines/guidelines-on-outsourcing',
    tags: ['fund administration', 'fund admin', 'nav', 'valuation', 'outsourcing', 'administrator'],
    sourceStatus: 'NEEDS_REVIEW', sourceType: 'CURATED_SUMMARY', evidenceTier: 'CURATED_SUMMARY', isVerbatimText: false,
    lastVerifiedDate: '2026-09-13', reviewAuditCycleDays: 90
  },

  // -------------------------------------------------------------
};
