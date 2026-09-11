import type {
  OwnershipContext,
  CounterpartyRole,
  TransactionNatureType,
  InstrumentType
} from '../types/conversationState';
import type { TransactionUnderstanding } from '../services/transactionUnderstandingService';

export interface TopicSemanticCriteria {
  ownershipContexts?: (OwnershipContext | string)[];
  transactionTypes?: (TransactionNatureType | string)[];
  instruments?: (InstrumentType | string)[];
  counterpartyRoles?: (CounterpartyRole | string)[];
  /**
   * Primary-topic pruning filter: If the primary understood transaction type matches one of these,
   * this topic is suppressed from being falsely expanded by incidental query keywords.
   * Note: This represents primary-topic query pruning, not absolute real-world impossibility.
   */
  blockedByTransactionTypes?: (TransactionNatureType | string)[];
}

export interface QueryTopic {
  id: string;
  name: string;
  keywords: string[];
  actOrStandard?: string;
  sectionMatch?: string;
  semanticCriteria?: TopicSemanticCriteria;
}

export interface ResolvedTopic extends QueryTopic {
  matchSource?: 'semantic_primary' | 'semantic_corroborated' | 'lexical_only';
  primarySignalScore?: number;
}

export interface TopicDecompositionResult {
  isMultiTopic: boolean;
  topics: ResolvedTopic[];
  unresolvedTopics: string[];
}

export class QueryTopicResolver {
  public static readonly CANONICAL_TOPICS: QueryTopic[] = [
    {
      id: 'mom_annual_leave',
      name: 'Paid Annual Leave',
      keywords: ['annual leave', 'leave entitlement', 'vacation days', 'paid leave', 'section 88a'],
      actOrStandard: 'Employment Act 1968',
      sectionMatch: '88a',
      semanticCriteria: {
        transactionTypes: ['payroll_payment'],
        counterpartyRoles: ['employee'],
        blockedByTransactionTypes: ['lease_payment', 'asset_purchase', 'share_capital_issuance', 'capital_reduction']
      }
    },
    {
      id: 'mom_sick_leave',
      name: 'Outpatient Sick & Hospitalisation Leave',
      keywords: ['sick leave', 'medical leave', 'hospitalisation leave', 'hospitalization', 'mc', 'section 89'],
      actOrStandard: 'Employment Act 1968',
      sectionMatch: '89',
      semanticCriteria: {
        transactionTypes: ['payroll_payment'],
        counterpartyRoles: ['employee'],
        blockedByTransactionTypes: ['lease_payment', 'asset_purchase', 'share_capital_issuance', 'capital_reduction']
      }
    },
    {
      id: 'mom_overtime',
      name: 'Overtime & Working Hours (Part IV)',
      keywords: ['overtime', 'part iv', 'working hours', 'rest day', '1.5 times', 'section 38'],
      actOrStandard: 'Employment Act 1968',
      sectionMatch: '38',
      semanticCriteria: {
        transactionTypes: ['payroll_payment'],
        counterpartyRoles: ['employee'],
        blockedByTransactionTypes: ['lease_payment', 'asset_purchase', 'share_capital_issuance', 'capital_reduction']
      }
    },
    {
      id: 'cpf_wage_ceiling',
      name: 'CPF Ordinary Wage Ceiling',
      keywords: ['cpf ceiling', 'ordinary wage ceiling', 'ow ceiling', 'cpf limit', 'monthly ceiling'],
      actOrStandard: 'Central Provident Fund Act 1953',
      sectionMatch: 'first schedule',
      semanticCriteria: {
        transactionTypes: ['payroll_payment', 'director_fee_payment'],
        counterpartyRoles: ['employee', 'director'],
        blockedByTransactionTypes: ['lease_payment', 'asset_purchase', 'share_capital_issuance', 'capital_reduction']
      }
    },
    {
      id: 'cpf_contribution_rates',
      name: 'CPF Tiered Contribution Rates by Age',
      keywords: ['cpf rate', 'cpf contribution', 'employee contribution', 'employer contribution', 'age 55'],
      actOrStandard: 'Central Provident Fund Act 1953',
      sectionMatch: 'rates',
      semanticCriteria: {
        transactionTypes: ['payroll_payment', 'director_fee_payment'],
        counterpartyRoles: ['employee', 'director'],
        blockedByTransactionTypes: ['lease_payment', 'asset_purchase', 'share_capital_issuance', 'capital_reduction']
      }
    },
    {
      id: 'gst_compulsory_registration',
      name: 'GST Compulsory Registration Threshold',
      keywords: ['gst registration', 'compulsory registration', '1 million turnover', '1m turnover', 'gst threshold'],
      actOrStandard: 'Goods and Services Tax Act 1993',
      sectionMatch: 'first schedule'
    },
    {
      id: 'gst_reverse_charge',
      name: 'GST Reverse Charge on Imported Services',
      keywords: ['reverse charge', 'imported services', 'b2b imported', 'section 14'],
      actOrStandard: 'Goods and Services Tax Act 1993',
      sectionMatch: '14'
    },
    {
      id: 'gst_bad_debt_relief',
      name: 'GST Bad Debt Relief',
      keywords: ['bad debt relief', 'bad debt', 'insolvent customer', 'regulations 82', 'reg 82'],
      actOrStandard: 'Goods and Services Tax (General) Regulations',
      sectionMatch: '82',
      semanticCriteria: {
        counterpartyRoles: ['customer']
      }
    },
    {
      id: 'cit_section_14',
      name: 'Section 14 Tax Deductibility',
      keywords: ['section 14', 'wholly and exclusively', 'business expense tax deduction', 'deductible expense'],
      actOrStandard: 'Income Tax Act 1947',
      sectionMatch: '14',
      semanticCriteria: {
        transactionTypes: ['expense_payment', 'tax_payment', 'tax_provision']
      }
    },
    {
      id: 'cit_loss_relief',
      name: 'Tax Loss Carry-Forward & Carry-Back',
      keywords: ['loss carry forward', 'loss carry back', 'unabsorbed losses', 'section 37', 'section 37e'],
      actOrStandard: 'Income Tax Act 1947',
      sectionMatch: '37',
      semanticCriteria: {
        transactionTypes: ['tax_payment', 'tax_provision']
      }
    },
    {
      id: 'acra_small_company',
      name: 'Small Company Audit Exemption Criteria',
      keywords: ['small company', 'audit exemption', 'audit exempt', '13th schedule', 'revenue 10m', 'assets 10m'],
      actOrStandard: 'Companies Act 1967',
      sectionMatch: 'thirteenth schedule'
    },
    {
      id: 'acra_record_retention',
      name: 'Accounting Records Retention Period',
      keywords: ['retention of records', 'keep records', '5 years', 'five years', 'accounting records', 'section 199'],
      actOrStandard: 'Companies Act 1967',
      sectionMatch: '199'
    },
    {
      id: 'acra_financial_statements',
      name: 'Financial Statements Presentation',
      keywords: ['financial statements', 'presentation of accounts', 'section 201', 'true and fair view'],
      actOrStandard: 'Companies Act 1967',
      sectionMatch: '201'
    },
    {
      id: 'sfrsi_intangibles_cap',
      name: 'SFRS(I) 1-38 Development Cost Capitalisation',
      keywords: ['development cost', 'capitalisation', 'intangible asset', 'research vs development', 'technical feasibility', 'paragraph 57', '§57'],
      actOrStandard: 'SFRS(I) 1-38',
      sectionMatch: '57',
      semanticCriteria: {
        transactionTypes: ['rd_capitalization', 'asset_purchase'],
        instruments: ['intangible_asset'],
        blockedByTransactionTypes: ['lease_payment', 'payroll_payment', 'dividend_payment']
      }
    },
    {
      id: 'sfrsi_leases',
      name: 'SFRS(I) 16 Lease Capitalisation',
      keywords: ['right of use', 'rou asset', 'lease liability', 'incremental borrowing rate', 'sfrs(i) 16', 'ifrs 16'],
      actOrStandard: 'SFRS(I) 16',
      sectionMatch: '22',
      semanticCriteria: {
        transactionTypes: ['lease_payment', 'lease_liability_accrual'],
        blockedByTransactionTypes: ['expense_payment', 'inventory_purchase', 'share_capital_issuance', 'capital_reduction']
      }
    },
    {
      id: 'sfrsi_ppe',
      name: 'SFRS(I) 1-16 PPE & Depreciation',
      keywords: ['ppe', 'catch up depreciation', 'derecognition', 'trade in machinery', 'carrying amount', 'sfrs(i) 1-16'],
      actOrStandard: 'SFRS(I) 1-16',
      sectionMatch: '55',
      semanticCriteria: {
        transactionTypes: ['asset_purchase', 'depreciation_expense'],
        instruments: ['fixed_asset', 'property_plant_equipment'],
        blockedByTransactionTypes: ['lease_payment', 'payroll_payment', 'share_capital_issuance']
      }
    },
    {
      id: 'acra_share_capital',
      name: 'Companies Act 1967 Section 68 / 63 Share Capital & Allotment',
      keywords: ['share capital', 'allotment', 'no par value', 'unpaid shares', 'section 68', 'section 63', 'own company share'],
      actOrStandard: 'Companies Act 1967',
      sectionMatch: '68',
      semanticCriteria: {
        ownershipContexts: ['own_company_equity', 'own_equity'],
        transactionTypes: ['share_capital_issuance', 'share_subscription', 'capital_reduction'],
        counterpartyRoles: ['shareholder', 'director_shareholder'],
        blockedByTransactionTypes: ['expense_payment', 'inventory_purchase', 'customer_invoice']
      }
    },
    {
      id: 'sfrsi_own_equity',
      name: 'SFRS(I) 1-32 Own Equity Presentation vs Financial Assets',
      keywords: ['equity instrument', 'own shares', 'sfrs(i) 1-32', 'ias 32', 'share capital equity'],
      actOrStandard: 'SFRS(I) 1-32',
      sectionMatch: '33',
      semanticCriteria: {
        ownershipContexts: ['own_company_equity', 'own_equity'],
        counterpartyRoles: ['shareholder', 'director_shareholder'],
        blockedByTransactionTypes: ['expense_payment', 'inventory_purchase', 'customer_invoice']
      }
    },
    {
      id: 'sfrsi_financial_instruments',
      name: 'SFRS(I) 9 Financial Assets & Investments',
      keywords: ['financial asset', 'financial instrument', 'marketable securities', 'shares in other company', 'fvtoci', 'fvtpl', 'amortised cost', 'sfrs(i) 9'],
      actOrStandard: 'SFRS(I) 9',
      sectionMatch: '4.1',
      semanticCriteria: {
        ownershipContexts: ['external_entity_equity', 'unrelated_third_party', 'external_investment'],
        instruments: ['debt_instrument', 'marketable_securities', 'derivative', 'equity_instrument'],
        blockedByTransactionTypes: ['lease_payment', 'payroll_payment', 'share_capital_issuance']
      }
    }
  ];

  /**
   * Decomposes user query into identified statutory and accounting topics.
   * Semantic criteria act as the PRIMARY topic signal; lexical matching provides supporting evidence.
   * When semantic context indicates a transaction type, topics blocked by that type are pruned to avoid false topic expansion.
   * 'unknown' / 'unclassified' attributes are strictly neutral and never produce positive semantic matches.
   */
  public decomposeQuery(
    query: string,
    semanticContext?: TransactionUnderstanding | { ownershipContext?: string }
  ): TopicDecompositionResult {
    if (!query || typeof query !== 'string') {
      return { isMultiTopic: false, topics: [], unresolvedTopics: [] };
    }

    const qLower = query.toLowerCase();
    const matchedTopics: ResolvedTopic[] = [];

    // Extract structured semantics if provided, ensuring strict neutrality for 'unknown'
    const sem = semanticContext as (TransactionUnderstanding & { ownershipContext?: string }) | undefined;
    const hasSem = Boolean(sem);

    const semOwnContext = (sem?.ownershipContext && sem.ownershipContext !== 'unknown' && sem.ownershipContext !== 'not_applicable')
      ? sem.ownershipContext
      : undefined;

    const semTxType = (sem?.transactionType && sem.transactionType !== 'unclassified_transaction' && (sem.transactionType as string) !== 'unknown')
      ? sem.transactionType
      : undefined;

    const semInstrument = (sem?.instrument && (sem.instrument as string) !== 'unknown')
      ? sem.instrument
      : undefined;

    const semCounterpartyRole = (sem?.counterparty?.role && (sem.counterparty.role as string) !== 'unknown' && (sem.counterparty.role as string) !== 'unclassified')
      ? sem.counterparty.role
      : undefined;

    for (const topic of QueryTopicResolver.CANONICAL_TOPICS) {
      const criteria = topic.semanticCriteria;

      // 1. Primary-topic pruning filter
      // If primary transaction type is known and blocked for this topic, prune it from both semantic and lexical consideration
      if (semTxType && criteria?.blockedByTransactionTypes?.includes(semTxType)) {
        continue;
      }

      // 2. Primary Semantic Evaluation
      let hasSemanticMatch = false;
      if (criteria && hasSem) {
        if (semOwnContext && criteria.ownershipContexts?.includes(semOwnContext)) {
          hasSemanticMatch = true;
        }
        if (semTxType && criteria.transactionTypes?.includes(semTxType)) {
          hasSemanticMatch = true;
        }
        if (semInstrument && criteria.instruments?.includes(semInstrument)) {
          hasSemanticMatch = true;
        }
        if (semCounterpartyRole && criteria.counterpartyRoles?.includes(semCounterpartyRole)) {
          hasSemanticMatch = true;
        }
      }

      // 3. Supporting Lexical Matching
      const hasLexicalMatch = topic.keywords.some((kw) => qLower.includes(kw));

      // 4. Topic Resolution & Attribution
      if (hasSemanticMatch && hasLexicalMatch) {
        matchedTopics.push({
          ...topic,
          matchSource: 'semantic_corroborated',
          primarySignalScore: 1.0
        });
      } else if (hasSemanticMatch) {
        matchedTopics.push({
          ...topic,
          matchSource: 'semantic_primary',
          primarySignalScore: sem?.confidence ?? 0.9
        });
      } else if (hasLexicalMatch) {
        matchedTopics.push({
          ...topic,
          matchSource: 'lexical_only',
          primarySignalScore: 0.5
        });
      }
    }

    const isMultiTopic = matchedTopics.length > 1;

    // Detect if query asked about multiple questions via conjunctions (e.g. "and", "as well as", "plus")
    const unresolvedTopics: string[] = [];
    if (qLower.includes(' and ') || qLower.includes(' as well as ') || qLower.includes(' also ')) {
      // Check if there are unrecognized clauses
      const parts = qLower.split(/\band\b|\bas well as\b|\balso\b/);
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 5) {
          const partMatched = matchedTopics.some((t) =>
            t.keywords.some((kw) => trimmed.includes(kw))
          );
          if (!partMatched) {
            unresolvedTopics.push(trimmed);
          }
        }
      }
    }

    return {
      isMultiTopic,
      topics: matchedTopics,
      unresolvedTopics
    };
  }

  /**
   * Checks whether a chunk satisfies an identified topic.
   */
  public chunkMatchesTopic(chunkText: string, topic: QueryTopic): boolean {
    const textLower = chunkText.toLowerCase();
    return topic.keywords.some((kw) => textLower.includes(kw));
  }
}

export const defaultQueryTopicResolver = new QueryTopicResolver();
