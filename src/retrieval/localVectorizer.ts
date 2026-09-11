export interface VectorDocument {
  id: string;
  vector: number[];
  dimensions: number;
  sourceRecordId: string;
  textHash: string;
  vectorizerVersion: string;
}

/**
 * Deterministic Semantic-Lexical Local Embedding Service.
 *
 * Architecture & Invariants:
 * 1. Byte-for-byte reproducibility: Same text + same vectorizerVersion -> identical vector.
 * 2. 100% offline, zero network / external API dependency, zero model downloads.
 * 3. 128-dimensional dense vector space with L2 unit normalization (||v||_2 = 1.0).
 * 4. Tagged with explicit vectorizerVersion ('1.0.0-semlex') to detect version skew.
 * 5. Domain concept expansion: Maps Singapore accounting, SFRS(I), IRAS, ACRA, MOM, and CPF
 *    statutory terms into dedicated semantic feature clusters.
 */
export class DeterministicLocalEmbeddingService {
  public static readonly VECTORIZER_VERSION: string = '1.0.0-semlex';
  public readonly dimensions: number = 128;
  public readonly providerName: string = 'DeterministicLocalSemanticLexicalVectorizer';

  public get vectorizerVersion(): string {
    return DeterministicLocalEmbeddingService.VECTORIZER_VERSION;
  }

  // Pre-compiled domain concepts mapping key terms to dense semantic buckets
  private static readonly DOMAIN_CONCEPTS: Array<{ keywords: string[]; cluster: number; weight: number }> = [
    // GST / Tax supply
    { keywords: ['gst', 'goods and services tax', 'input tax', 'output tax', 'reverse charge', 'de minimis', 'bad debt relief', 'time of supply', 'taxable turnover'], cluster: 8, weight: 3.5 },
    // Corporate Income Tax (CIT) / ITA 1947
    { keywords: ['income tax', 'corporate income tax', 'cit', 'section 14', 'wholly and exclusively', 'enterprise innovation scheme', 'eis', 'loss carry forward', 'loss carry back', 'withholding tax', 'section 37', 'section 37e'], cluster: 16, weight: 3.5 },
    // ACRA / Companies Act / Financial Reporting
    { keywords: ['companies act', 'acra', 'small company', 'audit exemption', 'section 199', 'retention of records', 'accounting records', 'section 201', 'financial statements', 'directors disclosure', 'company secretary'], cluster: 24, weight: 3.5 },
    // MOM Employment / Leave / Hours
    { keywords: ['employment act', 'annual leave', 'section 88a', 'sick leave', 'hospitalisation leave', 'section 89', 'overtime', 'part iv', 'working hours', 'rest day', 'retrenchment notification'], cluster: 32, weight: 3.5 },
    // CPF Board / Wage Ceilings / Contributions
    { keywords: ['cpf', 'central provident fund', 'ordinary wage', 'ow ceiling', 'additional wage', 'cpf allocation', 'medisave', 'special account', 'ordinary account', 'contribution rate'], cluster: 40, weight: 3.5 },
    // PPE & Depreciation (IAS 16 / SFRS(I) 1-16)
    { keywords: ['property plant equipment', 'ppe', 'depreciation', 'catch up depreciation', 'derecognition', 'carrying amount', 'residual value', 'disposal of asset'], cluster: 48, weight: 3.5 },
    // Intangible Assets & R&D (IAS 38 / SFRS(I) 1-38)
    { keywords: ['intangible assets', 'research stage', 'development stage', 'capitalisation', 'technical feasibility', 'future economic benefits', 'amortisation'], cluster: 56, weight: 3.5 },
    // Leases & ROU Assets (IFRS 16 / SFRS(I) 16)
    { keywords: ['leases', 'right of use', 'rou asset', 'lease liability', 'incremental borrowing rate', 'present value of lease payments', 'rental agreement'], cluster: 64, weight: 3.5 },
    // Financial Instruments (IFRS 9 / SFRS(I) 9)
    { keywords: ['financial instruments', 'fvtpl', 'fvtoci', 'amortised cost', 'loan payable', 'unexpired interest', 'contra liability', 'equity investment'], cluster: 72, weight: 3.5 },
    // Foreign Currency (IAS 21 / SFRS(I) 1-21)
    { keywords: ['foreign currency', 'spot rate', 'exchange rate', 'realized fx gain', 'currency variance', 'foreign exchange', 'usd sgd', 'functional currency'], cluster: 80, weight: 3.5 },
    // Commercial Transactions / Trade Discounts
    { keywords: ['trade discount', 'supplier discount', 'purchase invoice', 'payment terms', 'accounts payable', 'cash at bank', 'cost consideration'], cluster: 88, weight: 3.0 }
  ];

  /**
   * Deterministically maps any arbitrary string token into a 32-bit integer via FNV-1a.
   */
  private fnv1a(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  /**
   * Generates a 128-dimensional dense vector representation for the given text.
   */
  public embed(text: string): number[] {
    const vector = new Float64Array(this.dimensions);
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return Array.from(vector);
    }

    const normalized = text.toLowerCase()
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[^\w\s§()./-]/g, ' ')
      .trim();

    // 1. Concept Layer: Detect domain concept matches
    for (const concept of DeterministicLocalEmbeddingService.DOMAIN_CONCEPTS) {
      for (const kw of concept.keywords) {
        if (normalized.includes(kw)) {
          const idx1 = concept.cluster % this.dimensions;
          const idx2 = (concept.cluster + 3) % this.dimensions;
          const idx3 = (concept.cluster + 7) % this.dimensions;

          vector[idx1] += concept.weight * 1.0;
          vector[idx2] += concept.weight * 0.6;
          vector[idx3] += concept.weight * 0.3;
        }
      }
    }

    // 2. Token Layer: Unigrams
    const tokens = normalized.split(/[\s,.;:!?/()]+/).filter((t) => t.length >= 2);
    for (const token of tokens) {
      const hash = this.fnv1a(token);
      const dim = hash % this.dimensions;
      vector[dim] += 1.2;

      // 3. Subword Layer: 3-grams for morphological resilience
      if (token.length >= 4) {
        for (let i = 0; i <= token.length - 3; i++) {
          const tri = token.substring(i, i + 3);
          const triHash = this.fnv1a(tri);
          const triDim = triHash % this.dimensions;
          vector[triDim] += 0.35;
        }
      }
    }

    // 4. L2 Normalization (unit vector: ||v||_2 = 1.0)
    let sumSquares = 0;
    for (let i = 0; i < this.dimensions; i++) {
      sumSquares += vector[i] * vector[i];
    }

    if (sumSquares > 0) {
      const norm = Math.sqrt(sumSquares);
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] = Math.round((vector[i] / norm) * 1e8) / 1e8;
      }
    }

    return Array.from(vector);
  }

  /**
   * Embeds multiple texts in batch.
   */
  public embedBatch(texts: string[]): number[][] {
    return texts.map((t) => this.embed(t));
  }

  /**
   * Computes exact cosine similarity between two unit vectors.
   */
  public similarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return Math.max(-1, Math.min(1, Math.round(dot * 1e8) / 1e8));
  }
}

export const defaultEmbeddingService = new DeterministicLocalEmbeddingService();
