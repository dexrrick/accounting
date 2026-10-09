import { getCoverageTopicById, getCoverageTopicsByIds } from '../standards/coverageRegistry';

export type RequestedScopeOperation = 'EXPLAIN_RULE' | 'CHECK_ELIGIBILITY' | 'CALCULATE';

export interface RequestedScopeSpan {
  start: number;
  end: number;
  kind: 'FACT_CONTEXT' | 'REQUEST' | 'SEPARATOR' | 'UNMATCHED';
  topicId?: string;
  operation?: RequestedScopeOperation;
}

export interface RequestedScopeAnalysis {
  complete: boolean;
  spans: RequestedScopeSpan[];
  requestAtoms: Array<RequestedScopeSpan & { kind: 'REQUEST'; topicId: string; operation: RequestedScopeOperation }>;
}

export interface RequestedScopeIssue {
  mappedTopicIds: readonly string[];
  domain: string;
  population: string;
  governingAuthorities: readonly string[];
  operation: string;
}

export interface RequestedScopeOwnershipResult {
  complete: boolean;
  analysis: RequestedScopeAnalysis;
  routingTopicIdsByIssue: ReadonlyMap<number, readonly string[]>;
  failure?: 'INCOMPLETE_SCOPE_PARTITION' | 'UNOWNED_REQUEST_ATOM';
}

const RELIEF_PARENT_ID = 'iras-individual-reliefs';
const INDIVIDUAL_TAX_DOMAIN = 'IRAS_INCOME_TAX';

function hasCompatibleParentChildRelationship(parentId: string, childId: string): boolean {
  const parent = getCoverageTopicById(parentId);
  const child = getCoverageTopicById(childId);
  return Boolean(parent?.routingOnly && parent.domainId === child?.domainId &&
    parent.routingChildTopicIds?.includes(childId) && child?.routingParentTopicIds?.includes(parentId) &&
    parent.authorities.some(authority => child.authorities.includes(authority)));
}

/** Returns only validated, reciprocal registry relationships for a directly matched child topic. */
export function getRoutingParentIdsForChild(childId: string): string[] {
  const child = getCoverageTopicById(childId);
  if (!child) return [];
  return (child.routingParentTopicIds || []).filter(parentId => hasCompatibleParentChildRelationship(parentId, childId)).sort();
}

function wholeTopicPattern(topicId: string): string[] {
  const topic = getCoverageTopicById(topicId);
  if (!topic || getRoutingParentIdsForChild(topicId).length === 0) return [];
  return topic.routingRequestPatterns || [];
}

/** Recognizes only finite registry-declared child noun phrases in an issue subject. */
export function getRoutingChildTopicIdsMentionedInSubject(subject: string): string[] {
  const parent = getCoverageTopicById(RELIEF_PARENT_ID);
  const childTopics = getCoverageTopicsByIds(parent?.routingChildTopicIds || []);
  return childTopics.filter(topic => getRoutingParentIdsForChild(topic.id).length > 0 &&
    (topic.routingRequestPatterns || []).some(pattern =>
      new RegExp(`(?:^|[^A-Za-z0-9])(?:${pattern})(?=$|[^A-Za-z0-9])`, 'i').test(subject)))
    .map(topic => topic.id)
    .sort();
}

interface AtomPattern {
  source: string;
  topicId: string;
  operation: RequestedScopeOperation;
}

function requestPatterns(): AtomPattern[] {
  const patterns: AtomPattern[] = [];
  const wrappers: Array<{ prefix: string; operation: RequestedScopeOperation }> = [
    { prefix: String.raw`explain\s+`, operation: 'EXPLAIN_RULE' },
    { prefix: String.raw`(?:can|could|may)\s+(?:i|we|they)\s+claim\s+(?:for\s+)?`, operation: 'CHECK_ELIGIBILITY' },
    { prefix: String.raw`what\s+can\s+(?:i|we|they)\s+claim\s+for\s+`, operation: 'CHECK_ELIGIBILITY' },
    { prefix: String.raw`(?:how\s+much\s+can\s+(?:i|we|they)\s+claim\s+for|calculate)\s+`, operation: 'CALCULATE' }
  ];
  const childTopics = getCoverageTopicsByIds(
    getCoverageTopicsByIds([RELIEF_PARENT_ID])[0]?.routingChildTopicIds || []
  );
  for (const topic of childTopics) {
    for (const nounPhrase of wholeTopicPattern(topic.id)) {
      for (const wrapper of wrappers) {
        patterns.push({ source: `(?:${wrapper.prefix})(?:${nounPhrase})`, topicId: topic.id, operation: wrapper.operation });
      }
    }
  }

  // This finite form places the amount operation inside the CPF noun phrase.
  // It remains an exact CPF relief request and cannot consume arbitrary text.
  patterns.push({
    source: String.raw`how\s+much\s+(?:personal|individual)\s+(?:income\s+)?tax\s+relief\s+can\s+i\s+claim\s+for\s+(?:my\s+)?(?:compulsory|mandatory)\s+cpf(?:\s+contributions?)?`,
    topicId: 'iras-individual-cpf-relief',
    operation: 'CALCULATE'
  });

  const broadParentPatterns = [
    String.raw`(?:what\s+(?:individual|personal)\s+tax\s+relief\s+categories?\s+are\s+available|explain\s+(?:the\s+)?(?:individual|personal)\s+tax\s+relief\s+categories?|(?:i\s+need|give\s+me)\s+an?\s+overview\s+of\s+(?:individual|personal)\s+tax\s+relief\s+categories?)`
  ];
  for (const source of broadParentPatterns) {
    patterns.push({ source, topicId: RELIEF_PARENT_ID, operation: 'EXPLAIN_RULE' });
  }

  // The retained compound query asks this separate CPF payroll calculation.
  patterns.push({
    source: String.raw`what\s+does\s+the\s+employer\s+have\s+to\s+pay\s+into\s+cpf`,
    topicId: 'cpf_contribution_rates',
    operation: 'CALCULATE'
  });

  return patterns.sort((left, right) => right.source.length - left.source.length);
}

const ATOM_PATTERNS = requestPatterns();
const SALARY_CONTEXT = /for someone earning sgd (?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})? a month,\s*/iy;
const WHITESPACE = /\s+/y;

function matchAt(pattern: RegExp, input: string, start: number): RegExpExecArray | null {
  pattern.lastIndex = start;
  return pattern.exec(input);
}

function atomAt(input: string, start: number): RequestedScopeSpan | undefined {
  for (const candidate of ATOM_PATTERNS) {
    const expression = new RegExp(`(?:${candidate.source})(?=$|[\\s,;.!?])`, 'iy');
    const match = matchAt(expression, input, start);
    if (match) {
      return {
        start,
        end: start + match[0].length,
        kind: 'REQUEST',
        topicId: candidate.topicId,
        operation: candidate.operation
      };
    }
  }
  return undefined;
}

function separatorAfter(input: string, start: number): { end: number; terminal: boolean } | undefined {
  const rest = input.slice(start);
  const ending = /^\s*[?!.]?\s*$/.exec(rest);
  if (ending && ending[0].length === rest.length) return { end: input.length, terminal: true };

  const forms = [
    /(?:,\s*(?:(?:and|then|plus)\b\s*)?|;\s*(?:(?:and|then)\b\s*)?)/iy,
    /\s+(?:and|then|plus)\s+/iy
  ];
  for (const form of forms) {
    const match = matchAt(form, input, start);
    if (match && match[0].length > 0) return { end: start + match[0].length, terminal: false };
  }
  return undefined;
}

/**
 * Parses only a finite relief/employer request grammar and partitions the exact
 * original string. Any unsupported remainder is preserved as an UNMATCHED span.
 */
export function analyzeRequestedTopicScope(query: string): RequestedScopeAnalysis {
  const spans: RequestedScopeSpan[] = [];
  const append = (span: RequestedScopeSpan) => {
    if (span.end > span.start) spans.push(span);
  };
  let cursor = 0;
  let complete = true;

  const leadingSpace = matchAt(WHITESPACE, query, cursor);
  if (leadingSpace) {
    append({ start: cursor, end: cursor + leadingSpace[0].length, kind: 'SEPARATOR' });
    cursor += leadingSpace[0].length;
  }

  const salaryContext = matchAt(SALARY_CONTEXT, query, cursor);
  if (salaryContext) {
    append({ start: cursor, end: cursor + salaryContext[0].length, kind: 'FACT_CONTEXT' });
    cursor += salaryContext[0].length;
  }

  let hasRequest = false;
  while (cursor < query.length) {
    const atom = atomAt(query, cursor);
    if (!atom) {
      append({ start: cursor, end: query.length, kind: 'UNMATCHED' });
      complete = false;
      cursor = query.length;
      break;
    }
    append(atom);
    hasRequest = true;
    cursor = atom.end;
    if (cursor === query.length) break;

    const separator = separatorAfter(query, cursor);
    if (!separator) {
      append({ start: cursor, end: query.length, kind: 'UNMATCHED' });
      complete = false;
      cursor = query.length;
      break;
    }
    append({ start: cursor, end: separator.end, kind: 'SEPARATOR' });
    cursor = separator.end;
    if (separator.terminal) break;
    if (cursor === query.length) {
      complete = false;
      break;
    }
  }

  if (!hasRequest) complete = false;
  if (cursor < query.length) {
    append({ start: cursor, end: query.length, kind: 'UNMATCHED' });
    complete = false;
  }

  return {
    complete,
    spans,
    requestAtoms: spans.filter((span): span is RequestedScopeSpan & { kind: 'REQUEST'; topicId: string; operation: RequestedScopeOperation } =>
      span.kind === 'REQUEST' && Boolean(span.topicId && span.operation))
  };
}

function issueOwnsAtom(issue: RequestedScopeIssue, atom: RequestedScopeSpan, rawTopicIds: ReadonlySet<string>): boolean {
  const topic = atom.topicId ? getCoverageTopicById(atom.topicId) : undefined;
  if (!topic || !atom.operation || !rawTopicIds.has(topic.id) || !issue.mappedTopicIds.includes(topic.id)) return false;
  if (issue.operation !== atom.operation) return false;

  const expectedDomain = topic.domainId === 'CPF_CONTRIBUTIONS' ? 'CPF_PAYROLL' : INDIVIDUAL_TAX_DOMAIN;
  if (issue.domain !== expectedDomain) return false;
  const expectedPopulations = atom.topicId === 'cpf_contribution_rates'
    ? ['EMPLOYER'] : atom.topicId === RELIEF_PARENT_ID ? ['INDIVIDUAL'] : ['INDIVIDUAL', 'EMPLOYEE'];
  if (!expectedPopulations.includes(issue.population)) return false;
  return topic.authorities.some(authority => issue.governingAuthorities.includes(authority));
}

/** Proves each parsed request atom against one real, subject-mapped issue and raw inventory. */
export function proveRequestedTopicOwnership(
  query: string,
  issues: readonly RequestedScopeIssue[],
  rawTopicIds: ReadonlySet<string>,
  childTopicIds: readonly string[]
): RequestedScopeOwnershipResult {
  const analysis = analyzeRequestedTopicScope(query);
  if (!analysis.complete) {
    return { complete: false, analysis, routingTopicIdsByIssue: new Map(), failure: 'INCOMPLETE_SCOPE_PARTITION' };
  }

  for (const atom of analysis.requestAtoms) {
    if (!issues.some(issue => issueOwnsAtom(issue, atom, rawTopicIds))) {
      return { complete: false, analysis, routingTopicIdsByIssue: new Map(), failure: 'UNOWNED_REQUEST_ATOM' };
    }
  }

  const routingTopicIdsByIssue = new Map<number, readonly string[]>();
  for (const childTopicId of childTopicIds) {
    if (!rawTopicIds.has(childTopicId)) return { complete: false, analysis, routingTopicIdsByIssue: new Map(), failure: 'UNOWNED_REQUEST_ATOM' };
    const childAtoms = analysis.requestAtoms.filter(atom => atom.topicId === childTopicId);
    if (childAtoms.length === 0) return { complete: false, analysis, routingTopicIdsByIssue: new Map(), failure: 'UNOWNED_REQUEST_ATOM' };
    const issueIndexes = [...new Set(childAtoms.flatMap(atom => issues.flatMap((issue, index) =>
      issueOwnsAtom(issue, atom, rawTopicIds) ? [index] : [])))];
    if (issueIndexes.length === 0) return { complete: false, analysis, routingTopicIdsByIssue: new Map(), failure: 'UNOWNED_REQUEST_ATOM' };
    const parents = getRoutingParentIdsForChild(childTopicId).filter(parentId => rawTopicIds.has(parentId));
    if (parents.length === 0) continue;
    for (const issueIndex of issueIndexes) {
      routingTopicIdsByIssue.set(issueIndex, [...new Set([...(routingTopicIdsByIssue.get(issueIndex) || []), ...parents])].sort());
    }
  }
  return { complete: true, analysis, routingTopicIdsByIssue };
}
