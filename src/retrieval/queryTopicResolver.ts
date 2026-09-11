export interface QueryTopic {
  id: string;
  name: string;
  keywords: string[];
  actOrStandard?: string;
  sectionMatch?: string;
}

export interface TopicDecompositionResult {
  isMultiTopic: boolean;
  topics: QueryTopic[];
  unresolvedTopics: string[];
}

export class QueryTopicResolver {
  public static readonly CANONICAL_TOPICS: QueryTopic[] = [
    {
      id: 'mom_annual_leave',
      name: 'Paid Annual Leave',
      keywords: ['annual leave', 'leave entitlement', 'vacation days', 'paid leave', 'section 88a'],
      actOrStandard: 'Employment Act 1968',
      sectionMatch: '88a'
    },
    {
      id: 'mom_sick_leave',
      name: 'Outpatient Sick & Hospitalisation Leave',
      keywords: ['sick leave', 'medical leave', 'hospitalisation leave', 'hospitalization', 'mc', 'section 89'],
      actOrStandard: 'Employment Act 1968',
      sectionMatch: '89'
    },
    {
      id: 'mom_overtime',
      name: 'Overtime & Working Hours (Part IV)',
      keywords: ['overtime', 'part iv', 'working hours', 'rest day', '1.5 times', 'section 38'],
      actOrStandard: 'Employment Act 1968',
      sectionMatch: '38'
    },
    {
      id: 'cpf_wage_ceiling',
      name: 'CPF Ordinary Wage Ceiling',
      keywords: ['cpf ceiling', 'ordinary wage ceiling', 'ow ceiling', 'cpf limit', 'monthly ceiling'],
      actOrStandard: 'Central Provident Fund Act 1953',
      sectionMatch: 'first schedule'
    },
    {
      id: 'cpf_contribution_rates',
      name: 'CPF Tiered Contribution Rates by Age',
      keywords: ['cpf rate', 'cpf contribution', 'employee contribution', 'employer contribution', 'age 55'],
      actOrStandard: 'Central Provident Fund Act 1953',
      sectionMatch: 'rates'
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
      sectionMatch: '82'
    },
    {
      id: 'cit_section_14',
      name: 'Section 14 Tax Deductibility',
      keywords: ['section 14', 'wholly and exclusively', 'business expense tax deduction', 'deductible expense'],
      actOrStandard: 'Income Tax Act 1947',
      sectionMatch: '14'
    },
    {
      id: 'cit_loss_relief',
      name: 'Tax Loss Carry-Forward & Carry-Back',
      keywords: ['loss carry forward', 'loss carry back', 'unabsorbed losses', 'section 37', 'section 37e'],
      actOrStandard: 'Income Tax Act 1947',
      sectionMatch: '37'
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
      sectionMatch: '57'
    },
    {
      id: 'sfrsi_leases',
      name: 'SFRS(I) 16 Lease Capitalisation',
      keywords: ['right of use', 'rou asset', 'lease liability', 'incremental borrowing rate', 'sfrs(i) 16', 'ifrs 16'],
      actOrStandard: 'SFRS(I) 16',
      sectionMatch: '22'
    },
    {
      id: 'sfrsi_ppe',
      name: 'SFRS(I) 1-16 PPE & Depreciation',
      keywords: ['ppe', 'catch up depreciation', 'derecognition', 'trade in machinery', 'carrying amount', 'sfrs(i) 1-16'],
      actOrStandard: 'SFRS(I) 1-16',
      sectionMatch: '55'
    }
  ];

  /**
   * Decomposes user query into identified statutory and accounting topics.
   */
  public decomposeQuery(query: string): TopicDecompositionResult {
    if (!query || typeof query !== 'string') {
      return { isMultiTopic: false, topics: [], unresolvedTopics: [] };
    }

    const qLower = query.toLowerCase();
    const matchedTopics: QueryTopic[] = [];

    for (const topic of QueryTopicResolver.CANONICAL_TOPICS) {
      const hasMatch = topic.keywords.some((kw) => qLower.includes(kw));
      if (hasMatch) {
        matchedTopics.push(topic);
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
