import type {
  OwnershipContext,
  CounterpartyRole,
  TransactionNatureType,
  InstrumentType
} from '../types/conversationState';
import { RETRIEVAL_CONFIG } from '../retrieval/retrievalConfig';

export type SemanticRuleDimension =
  | 'ownership'
  | 'transactionType'
  | 'instrument'
  | 'counterpartyRole'
  | 'paymentStatus';

export interface StandardProvisionTarget {
  actOrStandard: string;
  sections?: string[]; // Specific sections, normalized without spaces, symbols, or 'section' prefix
  tags?: string[];
  boost?: number;
  penalty?: number;
  description: string;
}

export interface SemanticAccountingRule {
  id: string;
  name: string;
  dimension: SemanticRuleDimension;
  description: string;
  transactionTypes?: TransactionNatureType[];
  ownershipContexts?: OwnershipContext[];
  instruments?: InstrumentType[];
  counterpartyRoles?: CounterpartyRole[];
  paymentStatuses?: ('paid' | 'unpaid' | 'partially_paid')[];
  blockedByTransactionTypes?: TransactionNatureType[];
  positiveAlignments: StandardProvisionTarget[];
  conflicts: StandardProvisionTarget[];
}

export interface TopicSemanticCriteria {
  ownershipContexts?: OwnershipContext[];
  transactionTypes?: TransactionNatureType[];
  instruments?: InstrumentType[];
  counterpartyRoles?: CounterpartyRole[];
  /**
   * Primary-topic pruning filter: If the primary understood transaction type matches one of these,
   * this topic is suppressed from being falsely expanded by incidental query keywords.
   * Note: This represents primary-topic query pruning, not absolute real-world impossibility.
   */
  blockedByTransactionTypes?: TransactionNatureType[];
}

/**
 * Authoritative Declarative Semantic Accounting Rules Registry.
 *
 * Serves as the single source of truth consumed directly by:
 * 1. QueryTopicResolver (for primary semantic topic decomposition and negative pruning)
 * 2. DeterministicSemanticAlignmentEvaluator (for structured metadata boost and conflict evaluation)
 * 3. AccountingGuardrails (for structural accounting invariants)
 */
export const SEMANTIC_ACCOUNTING_RULES: SemanticAccountingRule[] = [
  // -------------------------------------------------------------------------
  // 1. OWNERSHIP CONTEXT RULES
  // -------------------------------------------------------------------------
  {
    id: 'own_equity_ownership',
    name: 'Own Share Capital Ownership Context',
    dimension: 'ownership',
    description: 'Ownership context is reporting entity own ordinary share capital',
    ownershipContexts: ['own_equity'],
    blockedByTransactionTypes: ['expense_payment', 'inventory_purchase', 'customer_invoice', 'lease_contract', 'lease_payment'],
    positiveAlignments: [
      {
        actOrStandard: 'Companies Act 1967',
        sections: ['68', '63', '78b'],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'own_equity:Companies Act 1967'
      },
      {
        actOrStandard: 'SFRS(I) 1-32',
        sections: ['33'],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'own_equity:SFRS(I) 1-32 §33'
      }
    ],
    conflicts: [
      {
        actOrStandard: 'SFRS(I) 9',
        tags: ['fvtpl', 'fvtoci', 'financial asset', 'trading'],
        penalty: RETRIEVAL_CONFIG.semanticConflictPenalty,
        description: 'own_equity:SFRS(I) 9 Financial Asset Conflict'
      },
      {
        actOrStandard: 'IFRS 9',
        tags: ['fvtpl', 'fvtoci', 'financial asset', 'trading'],
        penalty: RETRIEVAL_CONFIG.semanticConflictPenalty,
        description: 'own_equity:IFRS 9 Financial Asset Conflict'
      },
      {
        actOrStandard: 'IAS 21',
        penalty: -0.10,
        description: 'own_equity:Foreign Exchange Conflict'
      },
      {
        actOrStandard: 'SFRS(I) 1-21',
        penalty: -0.10,
        description: 'own_equity:Foreign Exchange Conflict'
      }
    ]
  },
  {
    id: 'external_investment_ownership',
    name: 'External Entity Investment Ownership Context',
    dimension: 'ownership',
    description: 'Acquisition or holding of securities/instruments issued by external entities',
    ownershipContexts: ['external_investment'],
    blockedByTransactionTypes: ['lease_contract', 'lease_payment', 'payroll_payment', 'share_capital_issuance'],
    positiveAlignments: [
      {
        actOrStandard: 'SFRS(I) 9',
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'external_investment:SFRS(I) 9'
      },
      {
        actOrStandard: 'IFRS 9',
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'external_investment:IFRS 9'
      },
      {
        actOrStandard: 'IAS 21',
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'external_investment:IAS 21'
      },
      {
        actOrStandard: 'SFRS(I) 1-21',
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'external_investment:SFRS(I) 1-21'
      }
    ],
    conflicts: [
      // NARROWED CONFLICT: Only own-equity specific provisions of Companies Act conflict with external investments!
      // General corporate provisions (§199 records, §201 statements, 13th Schedule audit) DO NOT conflict.
      {
        actOrStandard: 'Companies Act 1967',
        sections: ['68', '63', '78b'],
        penalty: RETRIEVAL_CONFIG.semanticConflictPenalty,
        description: 'external_investment:Companies Act 1967 §68 Conflict'
      }
    ]
  },

  // -------------------------------------------------------------------------
  // 2. TRANSACTION TYPE RULES
  // -------------------------------------------------------------------------
  {
    id: 'equity_issuance_tx',
    name: 'Share Capital Issuance Transaction',
    dimension: 'transactionType',
    description: 'Issuance or subscription of reporting entity share capital',
    transactionTypes: ['share_capital_issuance', 'capital_reduction'],
    positiveAlignments: [
      {
        actOrStandard: 'Companies Act 1967',
        sections: ['68', '63', '78b'],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'transactionType:share_capital:Companies Act 1967'
      }
    ],
    conflicts: []
  },
  {
    id: 'commercial_lease_inception',
    name: 'SFRS(I) 16 Commercial Lease Capitalisation',
    dimension: 'transactionType',
    description: 'Inception and initial recognition of right-of-use asset and lease liability under SFRS(I) 16 §22',
    transactionTypes: ['lease_contract'],
    blockedByTransactionTypes: ['expense_payment', 'inventory_purchase', 'share_capital_issuance', 'capital_reduction', 'payroll_payment'],
    positiveAlignments: [
      {
        actOrStandard: 'SFRS(I) 16',
        sections: ['22', '23', '26'],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'transactionType:lease:SFRS(I) 16'
      },
      {
        actOrStandard: 'IFRS 16',
        sections: ['22', '23', '26'],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'transactionType:lease:IFRS 16'
      }
    ],
    conflicts: [
      {
        actOrStandard: 'Companies Act 1967',
        sections: ['68', '63', '78b'],
        penalty: RETRIEVAL_CONFIG.semanticConflictPenalty,
        description: 'transactionType:lease:Companies Act §68 Conflict'
      }
    ]
  },
  {
    id: 'lease_settlement',
    name: 'SFRS(I) 16 Lease Settlement',
    dimension: 'transactionType',
    description: 'Subsequent periodic lease liability reduction and interest accretion under SFRS(I) 16 §36',
    transactionTypes: ['lease_payment'],
    blockedByTransactionTypes: ['share_capital_issuance', 'capital_reduction'],
    positiveAlignments: [
      {
        actOrStandard: 'SFRS(I) 16',
        sections: ['36', '37', '38'],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'transactionType:lease_payment:SFRS(I) 16 §36'
      },
      {
        actOrStandard: 'IFRS 16',
        sections: ['36', '37', '38'],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'transactionType:lease_payment:IFRS 16 §36'
      }
    ],
    conflicts: []
  },
  {
    id: 'rd_capitalization_tx',
    name: 'SFRS(I) 1-38 Development Cost Capitalisation',
    dimension: 'transactionType',
    description: 'Capitalisation of qualifying internal development costs meeting 6 cumulative criteria',
    transactionTypes: ['rd_capitalization'],
    blockedByTransactionTypes: ['lease_contract', 'lease_payment', 'payroll_payment', 'dividend_payment'],
    positiveAlignments: [
      {
        actOrStandard: 'SFRS(I) 1-38',
        sections: ['57'],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'transactionType:rd_capitalization:SFRS(I) 1-38 §57'
      }
    ],
    conflicts: []
  },
  {
    id: 'ppe_trade_discount_tx',
    name: 'SFRS(I) 1-16 PPE Acquisition & Trade Discount Deduction',
    dimension: 'transactionType',
    description: 'Property, plant & equipment purchase with statutory deduction of trade discounts',
    transactionTypes: ['trade_discount_purchase', 'asset_purchase', 'depreciation_expense'],
    blockedByTransactionTypes: ['lease_contract', 'payroll_payment', 'share_capital_issuance'],
    positiveAlignments: [
      {
        actOrStandard: 'SFRS(I) 1-16',
        sections: ['16', '55'],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'transactionType:ppe:SFRS(I) 1-16'
      }
    ],
    conflicts: []
  },
  {
    id: 'payroll_tx',
    name: 'Employment Act 1968 & Central Provident Fund Act 1953',
    dimension: 'transactionType',
    description: 'Statutory employment leave, overtime limits, and CPF wage ceilings/contribution rates',
    transactionTypes: ['payroll_payment', 'director_fee_payment'],
    blockedByTransactionTypes: ['lease_contract', 'asset_purchase', 'share_capital_issuance', 'capital_reduction'],
    positiveAlignments: [
      {
        actOrStandard: 'Employment Act 1968',
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'transactionType:payroll:Employment Act 1968'
      },
      {
        actOrStandard: 'Central Provident Fund Act 1953',
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'transactionType:payroll:Central Provident Fund Act 1953'
      }
    ],
    conflicts: []
  },
  {
    id: 'tax_tx',
    name: 'Singapore Income Tax Act 1947',
    dimension: 'transactionType',
    description: 'Section 14 general tax deductibility and loss relief provisions',
    transactionTypes: ['expense_payment', 'tax_payment', 'tax_provision'],
    positiveAlignments: [
      {
        actOrStandard: 'Income Tax Act 1947',
        sections: ['14', '37', '37e'],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'transactionType:tax:Income Tax Act 1947'
      }
    ],
    conflicts: []
  },

  // -------------------------------------------------------------------------
  // 3. INSTRUMENT RULES
  // -------------------------------------------------------------------------
  {
    id: 'intangible_asset_instrument',
    name: 'Intangible Asset Instrument',
    dimension: 'instrument',
    description: 'Intangible asset recognition under SFRS(I) 1-38',
    instruments: ['intangible_asset'],
    positiveAlignments: [
      {
        actOrStandard: 'SFRS(I) 1-38',
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'instrument:intangible_asset:SFRS(I) 1-38'
      }
    ],
    conflicts: []
  },
  {
    id: 'fixed_asset_instrument',
    name: 'PPE / Fixed Asset Instrument',
    dimension: 'instrument',
    description: 'PPE and fixed asset measurement under SFRS(I) 1-16',
    instruments: ['property_plant_equipment'],
    positiveAlignments: [
      {
        actOrStandard: 'SFRS(I) 1-16',
        sections: ['16', '55'],
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'instrument:property_plant_equipment:SFRS(I) 1-16'
      }
    ],
    conflicts: []
  },
  {
    id: 'financial_asset_instrument',
    name: 'Financial Asset / Debt Instrument',
    dimension: 'instrument',
    description: 'Financial asset classification and measurement under SFRS(I) 9',
    instruments: ['debt_instrument', 'marketable_securities', 'derivative', 'financial_asset_equity'],
    positiveAlignments: [
      {
        actOrStandard: 'SFRS(I) 9',
        boost: RETRIEVAL_CONFIG.semanticAlignmentBoost,
        description: 'instrument:financial_asset:SFRS(I) 9'
      }
    ],
    conflicts: []
  },

  // -------------------------------------------------------------------------
  // 4. COUNTERPARTY ROLE RULES
  // -------------------------------------------------------------------------
  {
    id: 'shareholder_role',
    name: 'Shareholder Counterparty Role',
    dimension: 'counterpartyRole',
    description: 'Counterparty is existing or prospective shareholder',
    counterpartyRoles: ['shareholder', 'director'],
    positiveAlignments: [
      {
        actOrStandard: 'Companies Act 1967',
        sections: ['68', '63', '78b', '142'],
        boost: 0.05,
        description: 'counterparty:shareholder:Companies Act'
      }
    ],
    conflicts: []
  },
  {
    id: 'director_role',
    name: 'Director Counterparty Role',
    dimension: 'counterpartyRole',
    description: 'Counterparty is company director subject to conflict disclosure',
    counterpartyRoles: ['director'],
    positiveAlignments: [
      {
        actOrStandard: 'Companies Act 1967',
        sections: ['156'],
        boost: 0.10,
        description: 'counterparty:director:Section 156 Conflict Disclosure'
      }
    ],
    conflicts: []
  },
  {
    id: 'customer_role',
    name: 'Customer Counterparty Role',
    dimension: 'counterpartyRole',
    description: 'Counterparty is customer under GST and revenue recognition',
    counterpartyRoles: ['customer'],
    positiveAlignments: [
      {
        actOrStandard: 'Goods and Services Tax Act 1993',
        sections: ['82', '14'],
        boost: 0.10,
        description: 'counterparty:customer:GST Bad Debt / Reverse Charge'
      }
    ],
    conflicts: []
  },
  {
    id: 'supplier_role',
    name: 'Supplier Counterparty Role',
    dimension: 'counterpartyRole',
    description: 'Counterparty is trade vendor/supplier providing discounts',
    counterpartyRoles: ['supplier'],
    positiveAlignments: [
      {
        actOrStandard: 'SFRS(I) 1-16',
        sections: ['16'],
        boost: 0.10,
        description: 'counterparty:supplier:Trade Discount Deduction'
      }
    ],
    conflicts: []
  },
  {
    id: 'employee_role',
    name: 'Employee Counterparty Role',
    dimension: 'counterpartyRole',
    description: 'Counterparty is employee governed by Employment Act 1968',
    counterpartyRoles: ['employee'],
    positiveAlignments: [
      {
        actOrStandard: 'Employment Act 1968',
        boost: 0.10,
        description: 'counterparty:employee:Employment Act'
      }
    ],
    conflicts: []
  },

  // -------------------------------------------------------------------------
  // 5. PAYMENT STATUS RULES
  // -------------------------------------------------------------------------
  {
    id: 'unpaid_payment_status',
    name: 'Unpaid Payment Status',
    dimension: 'paymentStatus',
    description: 'Transaction amount remains unpaid creating receivable / allotment receivable',
    paymentStatuses: ['unpaid'],
    positiveAlignments: [
      {
        actOrStandard: 'Companies Act 1967',
        sections: ['63'],
        boost: 0.05,
        description: 'paymentStatus:unpaid:Companies Act §63(1) Allotment Receivable'
      }
    ],
    conflicts: []
  }
];

/**
 * Canonical Topic Semantic Criteria Registry consumed by QueryTopicResolver.
 */
export const CANONICAL_TOPIC_SEMANTIC_CRITERIA: Record<string, TopicSemanticCriteria> = {
  mom_annual_leave: {
    transactionTypes: ['payroll_payment'],
    counterpartyRoles: ['employee'],
    blockedByTransactionTypes: ['lease_contract', 'lease_payment', 'asset_purchase', 'share_capital_issuance', 'capital_reduction']
  },
  mom_sick_leave: {
    transactionTypes: ['payroll_payment'],
    counterpartyRoles: ['employee'],
    blockedByTransactionTypes: ['lease_contract', 'lease_payment', 'asset_purchase', 'share_capital_issuance', 'capital_reduction']
  },
  mom_overtime: {
    transactionTypes: ['payroll_payment'],
    counterpartyRoles: ['employee'],
    blockedByTransactionTypes: ['lease_contract', 'lease_payment', 'asset_purchase', 'share_capital_issuance', 'capital_reduction']
  },
  cpf_wage_ceiling: {
    transactionTypes: ['payroll_payment', 'director_fee_payment'],
    counterpartyRoles: ['employee', 'director'],
    blockedByTransactionTypes: ['lease_contract', 'lease_payment', 'asset_purchase', 'share_capital_issuance', 'capital_reduction']
  },
  cpf_contribution_rates: {
    transactionTypes: ['payroll_payment', 'director_fee_payment'],
    counterpartyRoles: ['employee', 'director'],
    blockedByTransactionTypes: ['lease_contract', 'lease_payment', 'asset_purchase', 'share_capital_issuance', 'capital_reduction']
  },
  gst_bad_debt_relief: {
    counterpartyRoles: ['customer']
  },
  cit_section_14: {
    transactionTypes: ['expense_payment', 'tax_payment', 'tax_provision']
  },
  cit_loss_relief: {
    transactionTypes: ['tax_payment', 'tax_provision']
  },
  sfrsi_intangibles_cap: {
    transactionTypes: ['rd_capitalization'],
    instruments: ['intangible_asset'],
    blockedByTransactionTypes: ['lease_contract', 'lease_payment', 'payroll_payment', 'dividend_payment']
  },
  sfrsi_leases: {
    transactionTypes: ['lease_contract'],
    instruments: ['right_of_use_asset', 'lease_liability'],
    blockedByTransactionTypes: ['expense_payment', 'inventory_purchase', 'share_capital_issuance', 'capital_reduction']
  },
  sfrsi_ppe: {
    transactionTypes: ['asset_purchase', 'trade_discount_purchase', 'depreciation_expense'],
    instruments: ['property_plant_equipment'],
    blockedByTransactionTypes: ['lease_contract', 'payroll_payment', 'share_capital_issuance']
  },
  acra_share_capital: {
    ownershipContexts: ['own_equity'],
    transactionTypes: ['share_capital_issuance', 'capital_reduction'],
    counterpartyRoles: ['shareholder', 'director'],
    blockedByTransactionTypes: ['expense_payment', 'inventory_purchase', 'customer_invoice', 'lease_contract']
  },
  sfrsi_own_equity: {
    ownershipContexts: ['own_equity'],
    counterpartyRoles: ['shareholder', 'director'],
    blockedByTransactionTypes: ['expense_payment', 'inventory_purchase', 'customer_invoice', 'lease_contract']
  },
  sfrsi_financial_instruments: {
    ownershipContexts: ['external_investment'],
    transactionTypes: ['equity_investment_acquisition'],
    instruments: ['financial_asset_equity', 'debt_instrument', 'marketable_securities', 'derivative'],
    blockedByTransactionTypes: ['lease_contract', 'lease_payment', 'payroll_payment', 'share_capital_issuance']
  }
};
