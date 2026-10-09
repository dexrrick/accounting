import {
  inventoryRawRequest,
  describeRawRequestSubject,
  rawRequestMatchesIssue,
  effectiveRawRequestSubjectFacets,
  type RawRequestFacet,
  type RawRequestInventory,
  type RawRequestOutcome,
  type RawRequestSubjectDescriptor,
  type RawRequestSpan
} from './rawRequestInventory';
import {
  SEMANTIC_QUESTION_MIN_CONFIDENCE,
  SEMANTIC_QUESTION_SCHEMA_VERSION,
  validateSemanticQuestionInterpretation
} from './semanticQuestionUnderstanding';

export const REQUEST_COMPLETENESS_CONTRACT_VERSION = 1 as const;

export type RequestRepresentationStatus = 'COMPLETE' | 'INCOMPLETE' | 'UNCERTAIN';

export interface RequestCompletenessFinding {
  stage: 'BRIDGE' | 'CONTEXT';
  code: string;
  issueIndex?: number;
  requestIndex?: number;
  candidateOutcomes?: number[];
  facets?: RawRequestFacet[];
  participant?: string;
  expected?: string[];
  observed?: string;
  allowed?: string[];
  subject?: string;
}

export interface RequestCompletenessMatch {
  issueIndex: number;
  requestIndex: number;
  span: RawRequestSpan;
  productionId: string;
  missingFacets: RawRequestFacet[];
  extraFacets: RawRequestFacet[];
}

export interface RequestCompletenessObservedIssue {
  subject: string;
  population: string;
  operation: string;
}

export interface RequestCompletenessEvaluation {
  status: RequestRepresentationStatus;
  structuralAcceptance: 'ACCEPTED' | 'REJECTED' | 'ABSENT';
  confidenceAcceptance: 'ACCEPTED' | 'REJECTED' | 'NOT_EVALUATED';
  observedConfidence?: number;
  minimumConfidence: number;
  observationFormat: 'RAW_VERSIONED_V2' | 'STORED_NORMALIZED_OR_LEGACY' | 'ABSENT';
  findings: RequestCompletenessFinding[];
  matches: RequestCompletenessMatch[];
  issues: RequestCompletenessObservedIssue[];
}

export interface RequestCompletenessObservationSnapshot {
  /** Only validated normalized observation data is retained, never a raw provider body. */
  hasWrapper: boolean;
  mode?: string;
  rejectionCode?: string;
  format: Exclude<RequestCompletenessEvaluation['observationFormat'], 'ABSENT'>;
  normalizedInterpretation?: unknown;
  structuralAcceptance: 'ACCEPTED' | 'REJECTED';
  confidenceAcceptance: 'ACCEPTED' | 'REJECTED' | 'NOT_EVALUATED';
  observedConfidence?: number;
}

/**
 * Immutable exact-query diagnostics. Statuses describe representation only;
 * they never establish evidence sufficiency, truth, or case application.
 */
export interface RequestCompletenessContext {
  readonly contractVersion: typeof REQUEST_COMPLETENESS_CONTRACT_VERSION;
  /** JSON.stringify([contractVersion, rawQuery]); preserves exact JS string units. */
  readonly identity: string;
  readonly rawQuery: string;
  /** JavaScript string length is measured in UTF-16 code units. */
  readonly inputLength: number;
  readonly inventory: Readonly<RawRequestInventory>;
  readonly declaredFacts: RawRequestInventory['facts'];
  readonly excludedSpans: readonly RawRequestSpan[];
  readonly observationSnapshot?: Readonly<RequestCompletenessObservationSnapshot>;
  readonly evaluation: Readonly<RequestCompletenessEvaluation>;
}

interface BridgeInterpretation {
  confidence: number;
  issues?: Array<{
    subject: string;
    population: string;
    operation: string;
  }>;
}

const trustedContexts = new WeakSet<object>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneOwned(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value !== 'object') throw new TypeError('Request completeness snapshots must contain plain data.');
  if (seen.has(value)) throw new TypeError('Cyclic request completeness snapshots are not supported.');
  seen.add(value);
  if (Array.isArray(value)) {
    const copied = value.map(item => cloneOwned(item, seen));
    seen.delete(value);
    return copied;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Request completeness snapshots must contain plain objects.');
  const copied: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(copied, key, {
      value: cloneOwned((value as Record<string, unknown>)[key], seen),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  seen.delete(value);
  return copied;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function ownedFreeze<T>(value: T): T {
  return deepFreeze(cloneOwned(value) as T);
}

function identityFor(rawQuery: string): string {
  return JSON.stringify([REQUEST_COMPLETENESS_CONTRACT_VERSION, rawQuery]);
}

function snapshotCompatibleInterpretation(value: unknown, format: RequestCompletenessEvaluation['observationFormat']): unknown {
  const snapshot = cloneOwned(value);
  // The shared validator adds this derived convenience flag to its normalized
  // result. It is not part of either V2 wire contract, so omit it from the
  // owned snapshot that may later be passed back through that validator.
  if (isRecord(snapshot) && format === 'RAW_VERSIONED_V2') {
    delete snapshot.calculationRequested;
    snapshot.schemaVersion = SEMANTIC_QUESTION_SCHEMA_VERSION;
  }
  return snapshot;
}

function observationParts(rawObservation: unknown): { rawInterpretation: unknown; mode?: string; wrapped: boolean; failurePresent: boolean } {
  if (isRecord(rawObservation) && Object.hasOwn(rawObservation, 'mode')) {
    return {
      rawInterpretation: Object.hasOwn(rawObservation, 'interpretation') ? rawObservation.interpretation : undefined,
      mode: typeof rawObservation.mode === 'string' ? rawObservation.mode : undefined,
      wrapped: true,
      failurePresent: Object.hasOwn(rawObservation, 'failure') && rawObservation.failure !== undefined
    };
  }
  return { rawInterpretation: rawObservation, wrapped: false, failurePresent: false };
}


function exactDimensionsMatch(
  request: RawRequestOutcome,
  descriptor: RawRequestSubjectDescriptor,
  population: string,
  operation: string,
  inventory: RawRequestInventory
): boolean {
  // The raw bridge keeps ambiguous operation distinct even though the routing
  // helper accepts either allowed operation for conservative ownership.
  return request.operation !== 'AMBIGUOUS' && rawRequestMatchesIssue(request, descriptor, population, operation, inventory);
}

function hasAllowedOperation(request: RawRequestOutcome, operation: string): boolean {
  return request.allowedOperations?.some(candidate => candidate === operation) || false;
}

function evaluationFor(
  inventory: RawRequestInventory,
  normalized: BridgeInterpretation | undefined,
  structuralAcceptance: RequestCompletenessEvaluation['structuralAcceptance'],
  confidenceAcceptance: RequestCompletenessEvaluation['confidenceAcceptance'],
  observationFormat: RequestCompletenessEvaluation['observationFormat'],
  minimumConfidence: number,
  extraFinding?: RequestCompletenessFinding
): RequestCompletenessEvaluation {
  const findings: RequestCompletenessFinding[] = extraFinding ? [extraFinding] : [];
  const observedConfidence = normalized && Number.isFinite(normalized.confidence) ? normalized.confidence : undefined;
  const initialStatus: RequestRepresentationStatus = structuralAcceptance === 'ACCEPTED' && confidenceAcceptance === 'ACCEPTED'
    ? 'COMPLETE' : 'UNCERTAIN';
  if (structuralAcceptance !== 'ACCEPTED') {
    if (!extraFinding) findings.push({ stage: 'BRIDGE', code: structuralAcceptance === 'ABSENT' ? 'OBSERVATION_ABSENT' : 'VALIDATOR_REJECTED' });
    return {
      status: 'UNCERTAIN', structuralAcceptance, confidenceAcceptance, minimumConfidence, observationFormat,
      findings, matches: [], issues: []
    };
  }
  if (confidenceAcceptance !== 'ACCEPTED') {
    findings.push({ stage: 'BRIDGE', code: 'LOW_CONFIDENCE', ...(observedConfidence === undefined ? {} : { observed: String(observedConfidence) }), expected: [String(minimumConfidence)] });
  }
  if (!normalized || !Array.isArray(normalized.issues)) {
    findings.push({ stage: 'BRIDGE', code: 'ISSUES_ABSENT' });
    return {
      status: 'UNCERTAIN', structuralAcceptance, confidenceAcceptance, minimumConfidence, observationFormat,
      ...(observedConfidence === undefined ? {} : { observedConfidence }), findings, matches: [], issues: []
    };
  }

  const requests = inventory.outcomes;
  const claimed = new Set<number>();
  const matches: RequestCompletenessMatch[] = [];
  const issues = normalized.issues.map(issue => ({ subject: issue.subject, population: issue.population, operation: issue.operation }));
  let uncertain = inventory.state !== 'COMPLETE' || confidenceAcceptance !== 'ACCEPTED';
  let incomplete = false;
  for (const [issueIndex, observed] of normalized.issues.entries()) {
    const descriptor = describeRawRequestSubject(observed.subject);
    if (!descriptor) {
      uncertain = true;
      findings.push({ stage: 'BRIDGE', code: 'UNKNOWN_SUBJECT_DESCRIPTOR', issueIndex, subject: observed.subject });
      continue;
    }
    const exact = requests.map((request, requestIndex) => ({ request, requestIndex }))
      .filter(({ request }) => exactDimensionsMatch(request, descriptor, observed.population, observed.operation, inventory));
    if (exact.length > 1) {
      uncertain = true;
      findings.push({ stage: 'BRIDGE', code: 'AMBIGUOUS_REQUEST_MATCH', issueIndex, candidateOutcomes: exact.map(item => item.requestIndex) });
      continue;
    }
    if (exact.length === 1) {
      const { request, requestIndex } = exact[0];
      if (claimed.has(requestIndex)) {
        incomplete = true;
        findings.push({ stage: 'BRIDGE', code: 'DUPLICATE_ISSUE', issueIndex, requestIndex });
        continue;
      }
      claimed.add(requestIndex);
      const effectiveSubjectFacets = effectiveRawRequestSubjectFacets(
        request, descriptor, observed.population, observed.operation, inventory
      ) || descriptor.facets;
      const missingFacets = request.facets.filter(facet => !effectiveSubjectFacets.includes(facet));
      const extraFacets = effectiveSubjectFacets.filter(facet => !request.facets.includes(facet));
      matches.push({ issueIndex, requestIndex, span: request.span, productionId: request.productionId, missingFacets, extraFacets });
      if (missingFacets.length) {
        incomplete = true;
        findings.push({ stage: 'BRIDGE', code: 'MISSING_REQUESTED_FACET', issueIndex, requestIndex, facets: missingFacets });
      }
      if (extraFacets.length) {
        incomplete = true;
        findings.push({ stage: 'BRIDGE', code: 'EXTRA_OBSERVED_FACET', issueIndex, requestIndex, facets: extraFacets });
      }
      continue;
    }

    const sameDimensions = requests.map((request, requestIndex) => ({ request, requestIndex }))
      .filter(({ request }) => request.identity === descriptor.identity && request.population === observed.population &&
        request.operation === observed.operation && request.scope === descriptor.scope);
    if (sameDimensions.length) {
      const needsEmployeeParticipant = sameDimensions.some(({ request }) => request.beneficiary === 'EMPLOYEE') && descriptor.beneficiary !== 'EMPLOYEE';
      const participantConflict = sameDimensions.some(({ request }) => request.beneficiary === 'INDIVIDUAL' &&
        descriptor.beneficiary !== undefined && descriptor.beneficiary !== 'INDIVIDUAL');
      if (needsEmployeeParticipant || participantConflict) {
        incomplete = true;
        findings.push({ stage: 'BRIDGE', code: needsEmployeeParticipant ? 'MISSING_REQUESTED_PARTICIPANT' : 'PARTICIPANT_MISMATCH', issueIndex, participant: 'EMPLOYEE' });
        continue;
      }
    }

    const sameIdentity = requests.map((request, requestIndex) => ({ request, requestIndex }))
      .filter(({ request }) => request.identity === descriptor.identity);
    const operationCandidates = sameIdentity.filter(({ request }) => request.population === observed.population && request.scope === descriptor.scope);
    if (operationCandidates.length && !operationCandidates.some(({ request }) => request.operation === observed.operation ||
        hasAllowedOperation(request, observed.operation))) {
      incomplete = true;
      findings.push({ stage: 'BRIDGE', code: 'OPERATION_MISMATCH', issueIndex,
        expected: [...new Set(operationCandidates.map(item => item.request.operation))], observed: observed.operation });
      continue;
    }
    const ambiguousOperationCandidates = requests.filter(request => request.operation === 'AMBIGUOUS' &&
      request.identity === descriptor.identity && request.scope === descriptor.scope &&
      hasAllowedOperation(request, observed.operation) &&
      rawRequestMatchesIssue(request, descriptor, observed.population, observed.operation, inventory) &&
      (() => {
        const facets = effectiveRawRequestSubjectFacets(request, descriptor, observed.population, observed.operation, inventory);
        return Boolean(facets && facets.length === request.facets.length &&
          facets.every((facet, index) => facet === request.facets[index]));
      })());
    if (ambiguousOperationCandidates.length) {
      uncertain = true;
      findings.push({ stage: 'BRIDGE', code: 'AMBIGUOUS_REQUEST_OPERATION', issueIndex,
        allowed: ['CHECK_ELIGIBILITY', 'CALCULATE'], observed: observed.operation });
      continue;
    }
    const scopeCandidates = sameIdentity.filter(({ request }) => request.population === observed.population && request.operation === observed.operation);
    if (scopeCandidates.length) {
      incomplete = true;
      findings.push({ stage: 'BRIDGE', code: 'SCOPE_MISMATCH', issueIndex,
        expected: [...new Set(scopeCandidates.map(item => item.request.scope))], observed: descriptor.scope });
      continue;
    }
    const actorConflict = Boolean(descriptor.population && descriptor.population !== observed.population) ||
      Boolean(descriptor.actors && (observed.population === 'EMPLOYER' ? !descriptor.actors.includes('EMPLOYER')
        : observed.population === 'EMPLOYEE' ? !descriptor.actors.includes('EMPLOYEE') : true));
    if (actorConflict || sameIdentity.some(({ request }) => request.operation === observed.operation &&
        request.scope === descriptor.scope && request.population !== observed.population)) {
      incomplete = true;
      findings.push({ stage: 'BRIDGE', code: 'POPULATION_OR_ACTOR_MISMATCH', issueIndex, observed: observed.population });
      continue;
    }
    if (inventory.state === 'COMPLETE') {
      incomplete = true;
      findings.push({ stage: 'BRIDGE', code: 'EXTRA_UNREQUESTED_ISSUE', issueIndex });
    } else {
      uncertain = true;
      findings.push({ stage: 'BRIDGE', code: 'UNBOUND_ISSUE', issueIndex });
    }
  }
  for (const [requestIndex, request] of requests.entries()) {
    if (claimed.has(requestIndex)) continue;
    if (request.operation === 'AMBIGUOUS') {
      uncertain = true;
      findings.push({ stage: 'BRIDGE', code: 'AMBIGUOUS_REQUEST_UNMATCHED', requestIndex });
    } else {
      incomplete = true;
      findings.push({ stage: 'BRIDGE', code: 'MISSING_REQUESTED_OUTCOME', requestIndex, observed: request.productionId });
    }
  }
  return {
    status: uncertain ? 'UNCERTAIN' : incomplete ? 'INCOMPLETE' : initialStatus,
    structuralAcceptance, confidenceAcceptance, minimumConfidence, observationFormat,
    ...(observedConfidence === undefined ? {} : { observedConfidence }), findings, matches, issues
  };
}

function buildContext(
  rawQuery: string,
  rawObservation: unknown,
  contextFinding?: RequestCompletenessFinding
): RequestCompletenessContext {
  const inventory = inventoryRawRequest(rawQuery);
  let observationSnapshot: RequestCompletenessObservationSnapshot | undefined;
  let normalized: BridgeInterpretation | undefined;
  let structuralAcceptance: RequestCompletenessEvaluation['structuralAcceptance'] = 'ABSENT';
  let confidenceAcceptance: RequestCompletenessEvaluation['confidenceAcceptance'] = 'NOT_EVALUATED';
  let observationFormat: RequestCompletenessEvaluation['observationFormat'] = 'ABSENT';
  let finding = contextFinding;

  if (rawObservation !== undefined) {
    let ownedObservation: unknown;
    try {
      ownedObservation = cloneOwned(rawObservation);
    } catch {
      structuralAcceptance = 'REJECTED';
      observationFormat = 'STORED_NORMALIZED_OR_LEGACY';
      finding = { stage: 'BRIDGE', code: 'OBSERVATION_SNAPSHOT_REJECTED' };
      observationSnapshot = {
        hasWrapper: false,
        format: observationFormat,
        rejectionCode: finding.code,
        structuralAcceptance: 'REJECTED',
        confidenceAcceptance: 'NOT_EVALUATED'
      };
    }
    if (ownedObservation !== undefined) {
      let parts: ReturnType<typeof observationParts> | undefined;
      try { parts = observationParts(ownedObservation); } catch { parts = undefined; }
      if (!parts) {
        structuralAcceptance = 'REJECTED';
        observationFormat = 'STORED_NORMALIZED_OR_LEGACY';
        finding = { stage: 'BRIDGE', code: 'OBSERVATION_SNAPSHOT_REJECTED' };
        observationSnapshot = {
          hasWrapper: false,
          format: observationFormat,
          rejectionCode: finding.code,
          structuralAcceptance: 'REJECTED',
          confidenceAcceptance: 'NOT_EVALUATED'
        };
      } else {
        observationFormat = isRecord(parts.rawInterpretation) && Object.hasOwn(parts.rawInterpretation, 'schemaVersion')
          ? 'RAW_VERSIONED_V2' : 'STORED_NORMALIZED_OR_LEGACY';
        let normalizedValue: unknown;
        if (parts.rawInterpretation !== undefined) {
          try { normalizedValue = validateSemanticQuestionInterpretation(cloneOwned(parts.rawInterpretation), rawQuery); } catch { normalizedValue = undefined; }
        }
        const acceptedMode = !parts.wrapped || parts.mode === 'SEMANTIC_INTERPRETATION' || parts.mode === 'SEMANTIC_PLUS_RULES';
        const acceptedFailure = !parts.failurePresent;
        if (normalizedValue && isRecord(normalizedValue) && typeof normalizedValue.confidence === 'number' && acceptedMode && acceptedFailure) {
          structuralAcceptance = 'ACCEPTED';
          normalized = cloneOwned(normalizedValue) as BridgeInterpretation;
          confidenceAcceptance = Number.isFinite(normalized.confidence) && normalized.confidence >= SEMANTIC_QUESTION_MIN_CONFIDENCE
            ? 'ACCEPTED' : 'REJECTED';
        } else {
          structuralAcceptance = 'REJECTED';
          confidenceAcceptance = 'NOT_EVALUATED';
          if (parts.failurePresent) finding = { stage: 'BRIDGE', code: 'OBSERVATION_WRAPPER_FAILED' };
          else if (!acceptedMode) finding = { stage: 'BRIDGE', code: 'OBSERVATION_MODE_REJECTED' };
          else if (parts.rawInterpretation === undefined) finding = { stage: 'BRIDGE', code: 'INTERPRETATION_ABSENT' };
        }
        observationSnapshot = {
          hasWrapper: parts.wrapped,
          ...(parts.mode ? { mode: parts.mode } : {}),
          format: observationFormat,
          ...(finding?.stage === 'BRIDGE' ? { rejectionCode: finding.code } : {}),
          ...(normalized ? { normalizedInterpretation: snapshotCompatibleInterpretation(normalized, observationFormat) } : {}),
          structuralAcceptance: structuralAcceptance === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED',
          confidenceAcceptance,
          ...(normalized ? { observedConfidence: normalized.confidence } : {})
        };
      }
    }
  }

  const evaluation = evaluationFor(inventory, normalized, structuralAcceptance, confidenceAcceptance,
    observationFormat, SEMANTIC_QUESTION_MIN_CONFIDENCE, finding);
  const context: RequestCompletenessContext = {
    contractVersion: REQUEST_COMPLETENESS_CONTRACT_VERSION,
    identity: identityFor(rawQuery),
    rawQuery,
    inputLength: rawQuery.length,
    inventory,
    declaredFacts: inventory.facts,
    excludedSpans: [],
    ...(observationSnapshot ? { observationSnapshot } : {}),
    evaluation
  };
  const frozen = ownedFreeze(context);
  trustedContexts.add(frozen as object);
  return frozen;
}

function contextFromRejectedSnapshot(rawQuery: string, snapshot: RequestCompletenessObservationSnapshot): RequestCompletenessContext {
  const inventory = inventoryRawRequest(rawQuery);
  const evaluation = evaluationFor(inventory, undefined, 'REJECTED', snapshot.confidenceAcceptance,
    snapshot.format, SEMANTIC_QUESTION_MIN_CONFIDENCE,
    snapshot.rejectionCode ? { stage: 'BRIDGE', code: snapshot.rejectionCode } : undefined);
  const frozen = ownedFreeze({
    contractVersion: REQUEST_COMPLETENESS_CONTRACT_VERSION,
    identity: identityFor(rawQuery),
    rawQuery,
    inputLength: rawQuery.length,
    inventory,
    declaredFacts: inventory.facts,
    excludedSpans: [],
    observationSnapshot: snapshot,
    evaluation
  } satisfies RequestCompletenessContext);
  trustedContexts.add(frozen as object);
  return frozen;
}

function contextFromStoredSnapshot(
  rawQuery: string,
  snapshot: RequestCompletenessObservationSnapshot,
  priorEvaluation: RequestCompletenessEvaluation
): RequestCompletenessContext {
  if (snapshot.structuralAcceptance !== 'ACCEPTED' || snapshot.normalizedInterpretation === undefined) {
    return contextFromRejectedSnapshot(rawQuery, snapshot);
  }
  const observation = snapshot.hasWrapper
    ? { mode: snapshot.mode, interpretation: cloneOwned(snapshot.normalizedInterpretation) }
    : cloneOwned(snapshot.normalizedInterpretation);
  const contextFinding = priorEvaluation.findings.find(item => item.stage === 'CONTEXT');
  const rebuilt = buildContext(rawQuery, observation, contextFinding);
  if (rebuilt.evaluation.structuralAcceptance !== 'ACCEPTED' || !rebuilt.observationSnapshot) {
    return buildContext(rawQuery, undefined, { stage: 'CONTEXT', code: 'NORMALIZED_SNAPSHOT_REJECTED' });
  }
  if (rebuilt.observationSnapshot.format === snapshot.format) return rebuilt;
  const rebuiltWithOriginalFormat = ownedFreeze({
    ...rebuilt,
    observationSnapshot: { ...rebuilt.observationSnapshot, format: snapshot.format },
    evaluation: { ...rebuilt.evaluation, observationFormat: snapshot.format }
  } satisfies RequestCompletenessContext);
  trustedContexts.add(rebuiltWithOriginalFormat as object);
  return rebuiltWithOriginalFormat;
}

function isUsableContext(candidate: unknown, rawQuery: string): candidate is RequestCompletenessContext {
  return Boolean(candidate && typeof candidate === 'object' && trustedContexts.has(candidate as object) &&
    (candidate as RequestCompletenessContext).contractVersion === REQUEST_COMPLETENESS_CONTRACT_VERSION &&
    (candidate as RequestCompletenessContext).rawQuery === rawQuery &&
    (candidate as RequestCompletenessContext).identity === identityFor(rawQuery));
}

/** Creates the immutable inventory before an existing semantic interpretation call. */
export function createRequestCompletenessContext(rawQuery: string): RequestCompletenessContext {
  return buildContext(rawQuery, undefined);
}

/**
 * Rebuilds or revalidates an exact-query context. A valid stored observation wins
 * over later projected interpretations; mismatched/forged contexts are rebuilt
 * from the current observation only and otherwise remain uncertain.
 */
export function ensureRequestCompletenessContext(
  rawQuery: string,
  candidate: unknown,
  currentObservation?: unknown
): RequestCompletenessContext {
  if (isUsableContext(candidate, rawQuery)) {
    const rebuilt = candidate.observationSnapshot
      ? contextFromStoredSnapshot(rawQuery, candidate.observationSnapshot, candidate.evaluation)
      : buildContext(rawQuery, currentObservation);
    if (JSON.stringify(rebuilt.inventory) === JSON.stringify(candidate.inventory) &&
        JSON.stringify(rebuilt.evaluation) === JSON.stringify(candidate.evaluation) &&
        JSON.stringify(rebuilt.observationSnapshot) === JSON.stringify(candidate.observationSnapshot)) return candidate;
    return rebuilt;
  }
  const rejectedCandidate = candidate !== undefined;
  return buildContext(rawQuery, currentObservation,
    rejectedCandidate ? { stage: 'CONTEXT', code: 'CONTEXT_REJECTED_OR_STALE' } : undefined);
}

/** Returns a copy of a bound stored interpretation after full context revalidation. */
export function readRequestCompletenessObservation(
  context: unknown,
  rawQuery: string
): unknown | undefined {
  if (!isUsableContext(context, rawQuery)) return undefined;
  const validated = ensureRequestCompletenessContext(rawQuery, context);
  if (validated.evaluation.structuralAcceptance !== 'ACCEPTED' || !validated.observationSnapshot) return undefined;
  const snapshot = validated.observationSnapshot;
  const normalized = cloneOwned(snapshot.normalizedInterpretation);
  return {
    mode: snapshot.hasWrapper ? snapshot.mode : 'SEMANTIC_INTERPRETATION',
    interpretation: normalized
  };
}

/** Exact-query cache check; diagnostics are never accepted from caller-built aggregate objects. */
export function isCurrentRequestCompletenessContext(
  context: unknown,
  rawQuery: string
): context is RequestCompletenessContext {
  if (!isUsableContext(context, rawQuery)) return false;
  const checked = ensureRequestCompletenessContext(rawQuery, context);
  return checked === context;
}
