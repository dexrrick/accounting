export const RETRIEVAL_CONFIG = {
  lexicalTopK: 20,
  denseTopK: 20,
  candidatePoolSize: 40,

  rrfK: 60,
  rrfWeight: 0.10,

  lexicalWeight: 0.55,
  semanticWeight: 0.45,
  minSemanticSimilarity: 0.30,

  tierWeights: {
    PRIMARY_SOURCE: 0.15,
    OFFICIAL_GUIDANCE: 0.05,
    CURATED_SUMMARY: 0.00,
    APPLICATION_RULE: -0.05
  },

  topicMatchWeight: 0.10,
  semanticAlignmentBoost: 0.15,
  semanticConflictPenalty: -0.20,
  minTopicCoverageScore: 0.35,
  finalTopK: 10
} as const;
