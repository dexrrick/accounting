import type {
  OwnershipContext,
  CounterpartyRole,
  TransactionNatureType,
  InstrumentType
} from '../types/conversationState';
import type { TransactionUnderstanding } from '../services/transactionUnderstandingService';
import {
  type TopicSemanticCriteria,
  CANONICAL_TOPIC_SEMANTIC_CRITERIA
} from '../standards/semanticAccountingRules';

export type { TopicSemanticCriteria };

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

export interface DecomposeQueryOptions {
  allowLexicalExpansion?: boolean;
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
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.mom_annual_leave
    },
    {
      id: 'mom_sick_leave',
      name: 'Outpatient Sick & Hospitalisation Leave',
      keywords: ['sick leave', 'medical leave', 'hospitalisation leave', 'hospitalization', 'mc', 'section 89'],
      actOrStandard: 'Employment Act 1968',
      sectionMatch: '89',
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.mom_sick_leave
    },
    {
      id: 'mom_overtime',
      name: 'Overtime & Working Hours (Part IV)',
      keywords: ['overtime', 'part iv', 'working hours', 'rest day', '1.5 times', 'section 38'],
      actOrStandard: 'Employment Act 1968',
      sectionMatch: '38',
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.mom_overtime
    },
    {
      id: 'cpf_wage_ceiling',
      name: 'CPF Ordinary Wage Ceiling',
      keywords: ['cpf ceiling', 'ordinary wage ceiling', 'ow ceiling', 'cpf limit', 'monthly ceiling'],
      actOrStandard: 'Central Provident Fund Act 1953',
      sectionMatch: 'first schedule',
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.cpf_wage_ceiling
    },
    {
      id: 'cpf_contribution_rates',
      name: 'CPF Tiered Contribution Rates by Age',
      keywords: ['cpf rate', 'cpf contribution', 'employee contribution', 'employer contribution', 'age 55'],
      actOrStandard: 'Central Provident Fund Act 1953',
      sectionMatch: 'rates',
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.cpf_contribution_rates
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
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.gst_bad_debt_relief
    },
    {
      id: 'cit_section_14',
      name: 'Section 14 Tax Deductibility',
      keywords: ['section 14', 'wholly and exclusively', 'business expense tax deduction', 'deductible expense'],
      actOrStandard: 'Income Tax Act 1947',
      sectionMatch: '14',
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.cit_section_14
    },
    {
      id: 'cit_loss_relief',
      name: 'Tax Loss Carry-Forward & Carry-Back',
      keywords: ['loss carry forward', 'loss carry back', 'unabsorbed losses', 'section 37', 'section 37e'],
      actOrStandard: 'Income Tax Act 1947',
      sectionMatch: '37',
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.cit_loss_relief
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
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.sfrsi_intangibles_cap
    },
    {
      id: 'sfrsi_leases',
      name: 'SFRS(I) 16 Lease Capitalisation',
      keywords: ['right of use', 'rou asset', 'lease liability', 'incremental borrowing rate', 'sfrs(i) 16', 'ifrs 16'],
      actOrStandard: 'SFRS(I) 16',
      sectionMatch: '22',
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.sfrsi_leases
    },
    {
      id: 'sfrsi_ppe',
      name: 'SFRS(I) 1-16 PPE & Depreciation',
      keywords: ['ppe', 'catch up depreciation', 'derecognition', 'trade in machinery', 'carrying amount', 'sfrs(i) 1-16'],
      actOrStandard: 'SFRS(I) 1-16',
      sectionMatch: '55',
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.sfrsi_ppe
    },
    {
      id: 'acra_share_capital',
      name: 'Companies Act 1967 Section 68 / 63 Share Capital & Allotment',
      keywords: ['share capital', 'allotment', 'no par value', 'unpaid shares', 'section 68', 'section 63', 'own company share'],
      actOrStandard: 'Companies Act 1967',
      sectionMatch: '68',
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.acra_share_capital
    },
    {
      id: 'sfrsi_own_equity',
      name: 'SFRS(I) 1-32 Own Equity Presentation vs Financial Assets',
      keywords: ['equity instrument', 'own shares', 'sfrs(i) 1-32', 'ias 32', 'share capital equity'],
      actOrStandard: 'SFRS(I) 1-32',
      sectionMatch: '33',
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.sfrsi_own_equity
    },
    {
      id: 'sfrsi_financial_instruments',
      name: 'SFRS(I) 9 Financial Assets & Investments',
      keywords: ['financial asset', 'financial instrument', 'marketable securities', 'shares in other company', 'fvtoci', 'fvtpl', 'amortised cost', 'sfrs(i) 9'],
      actOrStandard: 'SFRS(I) 9',
      sectionMatch: '4.1',
      semanticCriteria: CANONICAL_TOPIC_SEMANTIC_CRITERIA.sfrsi_financial_instruments
    }
  ];

  /**
   * Decomposes user query into identified statutory and accounting topics.
   *
   * Semantic Architecture & Rules:
   * 1. Semantic criteria act as the PRIMARY topic signal.
   * 2. 'semantic_corroborated' is defined as lexical evidence consistent with the topic's specific semantic classification.
   * 3. When a usable semantic context exists, uncorroborated 'lexical_only' matches are prevented from expanding the topic list.
   * 4. If no semantic topics match, 'lexical_only' activates as a controlled fallback.
   * 5. 'unknown' attributes are strictly neutral.
   */
  public decomposeQuery(
    query: string,
    semanticContext?: TransactionUnderstanding | { ownershipContext?: string },
    options?: DecomposeQueryOptions
  ): TopicDecompositionResult {
    if (!query || typeof query !== 'string') {
      return { isMultiTopic: false, topics: [], unresolvedTopics: [] };
    }

    const qLower = query.toLowerCase();

    // Extract structured semantics if provided, ensuring strict neutrality for 'unknown'
    const sem = semanticContext as (TransactionUnderstanding & { ownershipContext?: string }) | undefined;
    const hasSem = Boolean(sem);

    const semOwnContext: OwnershipContext | undefined = (sem?.ownershipContext && sem.ownershipContext !== 'unknown' && sem.ownershipContext !== 'not_applicable')
      ? (sem.ownershipContext as OwnershipContext)
      : undefined;

    const semTxType: TransactionNatureType | undefined = (sem?.transactionType && sem.transactionType !== 'unclassified_transaction' && (sem.transactionType as string) !== 'unknown')
      ? sem.transactionType
      : undefined;

    const semInstrument: InstrumentType | undefined = (sem?.instrument && (sem.instrument as string) !== 'unknown')
      ? sem.instrument
      : undefined;

    const semCounterpartyRole: CounterpartyRole | undefined = (sem?.counterparty?.role && (sem.counterparty.role as string) !== 'unknown' && (sem.counterparty.role as string) !== 'unclassified')
      ? sem.counterparty.role
      : undefined;

    // Usable semantic context: identifiable transaction type or ownership context with >= 0.50 confidence
    const hasUsableSemanticContext = hasSem && (semTxType !== undefined || semOwnContext !== undefined) && (sem?.confidence ?? 0) >= 0.50;

    const semMatchedTopics: ResolvedTopic[] = [];
    const lexicalOnlyTopics: ResolvedTopic[] = [];

    for (const topic of QueryTopicResolver.CANONICAL_TOPICS) {
      const criteria = topic.semanticCriteria;

      // 1. Primary-topic pruning filter
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
        // True semantic corroboration: semantic classification matched AND lexical keywords directly corroborate this topic
        semMatchedTopics.push({
          ...topic,
          matchSource: 'semantic_corroborated',
          primarySignalScore: 1.0
        });
      } else if (hasSemanticMatch) {
        // Primary semantic topic without explicit topic keywords in query
        semMatchedTopics.push({
          ...topic,
          matchSource: 'semantic_primary',
          primarySignalScore: sem?.confidence ?? 0.9
        });
      } else if (hasLexicalMatch) {
        // Lexical keyword hit without semantic backing
        lexicalOnlyTopics.push({
          ...topic,
          matchSource: 'lexical_only',
          primarySignalScore: 0.5
        });
      }
    }

    let matchedTopics: ResolvedTopic[] = [];

    // Controlled Lexical Expansion Logic:
    // When a usable semantic context exists, suppress lexical_only topics to avoid false expansion from incidental words.
    // However, if 0 semantic topics matched, activate lexical_only as a controlled fallback so the query is not left empty.
    if (hasUsableSemanticContext && !options?.allowLexicalExpansion) {
      if (semMatchedTopics.length > 0) {
        matchedTopics = semMatchedTopics;
      } else {
        matchedTopics = lexicalOnlyTopics;
      }
    } else {
      matchedTopics = [...semMatchedTopics, ...lexicalOnlyTopics];
    }

    const isMultiTopic = matchedTopics.length > 1;

    // Detect if query asked about multiple questions via conjunctions (e.g. "and", "as well as", "plus")
    const unresolvedTopics: string[] = [];
    if (qLower.includes(' and ') || qLower.includes(' as well as ') || qLower.includes(' also ')) {
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
