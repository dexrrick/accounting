/**
 * Small, conservative raw-request inventory for the CPF language bridge.
 * Its productions are intentionally limited to the independently reviewed pilot.
 */

const MAX_INPUT_UNITS = 6000;
const MAX_OUTCOMES = 12;

export type RawRequestIdentity = 'CPF_RELIEF' | 'CPF_CONTRIBUTIONS' |
  'INDIVIDUAL_RELIEF_CATEGORIES' | 'EMPLOYER_CPF_AFFECTS_INDIVIDUAL_RELIEF';
export type RawRequestPopulation = 'INDIVIDUAL' | 'EMPLOYEE' | 'EMPLOYER' | 'UNKNOWN';
export type RawRequestOperation = 'CHECK_ELIGIBILITY' | 'CALCULATE' | 'EXPLAIN_RULE' |
  'EXPLAIN_INTERACTION' | 'AMBIGUOUS';
export type RawRequestScope = 'SPECIFIC' | 'OVERVIEW' | 'INTERACTION';
export type RawRequestFacet = 'COMPULSORY' | 'OBLIGATION' | 'OVERVIEW' | 'CPF_EXAMPLE' | 'DIRECTED_RELATION';
export type RawRequestActor = 'EMPLOYEE' | 'EMPLOYER';
export type RawRequestBeneficiary = 'INDIVIDUAL' | 'EMPLOYEE';

export interface RawRequestSpan {
  start: number;
  end: number;
}

export interface RawRequestOutcome {
  identity: RawRequestIdentity;
  population: RawRequestPopulation;
  operation: RawRequestOperation;
  scope: RawRequestScope;
  facets: RawRequestFacet[];
  productionId: string;
  span: RawRequestSpan;
  allowedOperations?: Array<'CHECK_ELIGIBILITY' | 'CALCULATE'>;
  beneficiary?: RawRequestBeneficiary;
  actors?: RawRequestActor[];
}

export interface RawRequestFact {
  type: 'SALARY_PER_MONTH';
  currency: 'SGD';
  amountText: string;
  span: RawRequestSpan;
}

export type RawRequestFindingCode = 'NONSTRING_INPUT' | 'INPUT_TOO_LONG' | 'EMPTY_INPUT' |
  'UNKNOWN_PREFIX_OR_REQUEST' | 'UNKNOWN_SUFFIX_OR_REQUEST' | 'TRAILING_CONJUNCTION' |
  'OUTCOME_LIMIT_EXCEEDED' | 'AMBIGUOUS_CLAIMABILITY_OR_AMOUNT' | 'UNRESOLVED_PRONOUN';

export interface RawRequestFinding {
  stage: 'INVENTORY';
  code: RawRequestFindingCode;
  span?: RawRequestSpan;
}

export interface RawRequestInventory {
  /**
   * State includes operation ambiguity. `fullyConsumed` describes syntax/scope
   * consumption independently so an ambiguous operation cannot hide raw scope.
   */
  state: 'COMPLETE' | 'UNCERTAIN';
  fullyConsumed: boolean;
  outcomes: RawRequestOutcome[];
  facts: RawRequestFact[];
  findings: RawRequestFinding[];
  inputLength: number;
}

export interface RawRequestSubjectDescriptor {
  phrase: string;
  identity: RawRequestIdentity;
  scope: RawRequestScope;
  facets: RawRequestFacet[];
  population?: RawRequestPopulation;
  allowedPopulations?: RawRequestPopulation[];
  beneficiary?: RawRequestBeneficiary;
  actors?: RawRequestActor[];
  allowedOperations?: RawRequestOperation[];
}

interface RequestProduction {
  id: string;
  pattern: RegExp;
  outcomes: () => Array<Omit<RawRequestOutcome, 'productionId' | 'span'>>;
}

function outcome(
  identity: RawRequestIdentity,
  population: RawRequestPopulation,
  operation: RawRequestOperation,
  scope: RawRequestScope,
  facets: RawRequestFacet[],
  constraints: Pick<RawRequestOutcome, 'beneficiary' | 'actors' | 'allowedOperations'> = {}
): Omit<RawRequestOutcome, 'productionId' | 'span'> {
  return { identity, population, operation, scope, facets, ...constraints };
}

function overviewOutcome(facets: RawRequestFacet[], constraints: Pick<RawRequestOutcome, 'beneficiary'> = {}) {
  return outcome('INDIVIDUAL_RELIEF_CATEGORIES', 'INDIVIDUAL', 'EXPLAIN_RULE', 'OVERVIEW', facets, constraints);
}

const requestProductions: RequestProduction[] = [
  { id: 'claim-compulsory-relief', pattern: /^Can I claim personal tax relief (?:on|for) my compulsory CPF contributions$/iu,
    outcomes: () => [outcome('CPF_RELIEF', 'INDIVIDUAL', 'CHECK_ELIGIBILITY', 'SPECIFIC', ['COMPULSORY'], { beneficiary: 'INDIVIDUAL' })] },
  { id: 'claim-employee-cpf-relief', pattern: /^Can I claim CPF relief for employees$/iu,
    outcomes: () => [outcome('CPF_RELIEF', 'INDIVIDUAL', 'CHECK_ELIGIBILITY', 'SPECIFIC', [], { beneficiary: 'EMPLOYEE' })] },
  { id: 'calculate-compulsory-relief', pattern: /^How much personal tax relief can I claim for compulsory CPF(?: contributions)?\??$/iu,
    outcomes: () => [outcome('CPF_RELIEF', 'INDIVIDUAL', 'CALCULATE', 'SPECIFIC', ['COMPULSORY'], { beneficiary: 'INDIVIDUAL' })] },
  { id: 'explain-employee-cpf-relief', pattern: /^Explain CPF relief for employees\.?$/iu,
    outcomes: () => [outcome('CPF_RELIEF', 'EMPLOYEE', 'EXPLAIN_RULE', 'SPECIFIC', [], { beneficiary: 'EMPLOYEE' })] },
  { id: 'explain-compulsory-individual-cpf-relief', pattern: /^Explain personal tax relief (?:on|for) compulsory CPF(?: contributions)?\.?$/iu,
    outcomes: () => [outcome('CPF_RELIEF', 'INDIVIDUAL', 'EXPLAIN_RULE', 'SPECIFIC', ['COMPULSORY'], { beneficiary: 'INDIVIDUAL' })] },
  { id: 'explain-cpf-relief-unknown-claimant', pattern: /^Explain CPF relief\.?$/iu,
    outcomes: () => [outcome('CPF_RELIEF', 'UNKNOWN', 'EXPLAIN_RULE', 'SPECIFIC', [])] },
  { id: 'calculate-employer-cpf', pattern: /^(?:How much CPF must the employer contribute|What does the employer have to pay into CPF)\??$/iu,
    outcomes: () => [outcome('CPF_CONTRIBUTIONS', 'EMPLOYER', 'CALCULATE', 'SPECIFIC', [], { actors: ['EMPLOYER'] })] },
  { id: 'calculate-employee-and-employer-cpf', pattern: /^How much CPF do the employee and employer contribute\??$/iu,
    outcomes: () => [
      outcome('CPF_CONTRIBUTIONS', 'EMPLOYEE', 'CALCULATE', 'SPECIFIC', [], { actors: ['EMPLOYEE'] }),
      outcome('CPF_CONTRIBUTIONS', 'EMPLOYER', 'CALCULATE', 'SPECIFIC', [], { actors: ['EMPLOYER'] })
    ] },
  { id: 'explain-employer-cpf-contributions', pattern: /^Explain employer CPF contributions\.?$/iu,
    outcomes: () => [outcome('CPF_CONTRIBUTIONS', 'EMPLOYER', 'EXPLAIN_RULE', 'SPECIFIC', [], { actors: ['EMPLOYER'] })] },
  { id: 'explain-employee-cpf-contributions', pattern: /^Explain employee CPF contributions\.?$/iu,
    outcomes: () => [outcome('CPF_CONTRIBUTIONS', 'EMPLOYEE', 'EXPLAIN_RULE', 'SPECIFIC', [], { actors: ['EMPLOYEE'] })] },
  { id: 'explain-employer-cpf-obligations', pattern: /^Explain employer CPF contribution obligations?\.?$/iu,
    outcomes: () => [outcome('CPF_CONTRIBUTIONS', 'EMPLOYER', 'EXPLAIN_RULE', 'SPECIFIC', ['OBLIGATION'], { actors: ['EMPLOYER'] })] },
  { id: 'explain-employee-cpf-obligations', pattern: /^Explain employee CPF contribution obligations?\.?$/iu,
    outcomes: () => [outcome('CPF_CONTRIBUTIONS', 'EMPLOYEE', 'EXPLAIN_RULE', 'SPECIFIC', ['OBLIGATION'], { actors: ['EMPLOYEE'] })] },
  { id: 'overview-tax-relief-categories-question', pattern: /^What individual tax relief categories are available\??$/iu,
    outcomes: () => [overviewOutcome(['OVERVIEW'])] },
  { id: 'overview-tax-relief-categories-statement', pattern: /^I need an overview of individual tax relief categories\.?$/iu,
    outcomes: () => [overviewOutcome(['OVERVIEW'])] },
  { id: 'overview-personal-tax-reliefs', pattern: /^Explain personal tax reliefs\.?$/iu,
    outcomes: () => [overviewOutcome(['OVERVIEW'])] },
  { id: 'overview-individual-tax-relief-categories', pattern: /^Explain individual tax relief categories\.?$/iu,
    outcomes: () => [overviewOutcome(['OVERVIEW'])] },
  { id: 'overview-including-cpf-example', pattern: /^Explain individual tax relief categories, including CPF relief for employees\.?$/iu,
    outcomes: () => [overviewOutcome(['OVERVIEW', 'CPF_EXAMPLE'], { beneficiary: 'EMPLOYEE' })] },
  { id: 'explain-cpf-interaction', pattern: /^Explain how (?:employer CPF contributions|CPF employer contributions) affect personal CPF tax relief\.?$/iu,
    outcomes: () => [outcome('EMPLOYER_CPF_AFFECTS_INDIVIDUAL_RELIEF', 'INDIVIDUAL', 'EXPLAIN_INTERACTION', 'INTERACTION', ['DIRECTED_RELATION'], { actors: ['EMPLOYER'], beneficiary: 'INDIVIDUAL' })] },
  { id: 'ambiguous-claimability-or-amount', pattern: /^What can they claim for personal tax relief (?:on|for) compulsory CPF(?: contributions)?\??$/iu,
    outcomes: () => [outcome('CPF_RELIEF', 'INDIVIDUAL', 'AMBIGUOUS', 'SPECIFIC', ['COMPULSORY'], {
      beneficiary: 'INDIVIDUAL', allowedOperations: ['CHECK_ELIGIBILITY', 'CALCULATE']
    })] },
];

const descriptorRows: RawRequestSubjectDescriptor[] = [
  { phrase: 'CPF relief', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: [] },
  { phrase: 'CPF relief for employees', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: [],
    allowedPopulations: ['EMPLOYEE', 'INDIVIDUAL'], beneficiary: 'EMPLOYEE' },
  { phrase: 'personal CPF tax relief', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: [],
    population: 'INDIVIDUAL', beneficiary: 'INDIVIDUAL' },
  { phrase: 'personal tax relief on compulsory CPF contributions', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: ['COMPULSORY'],
    population: 'INDIVIDUAL', beneficiary: 'INDIVIDUAL' },
  { phrase: 'personal tax relief for compulsory CPF contributions', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: ['COMPULSORY'],
    population: 'INDIVIDUAL', beneficiary: 'INDIVIDUAL' },
  { phrase: 'personal tax relief on compulsory CPF', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: ['COMPULSORY'],
    population: 'INDIVIDUAL', beneficiary: 'INDIVIDUAL' },
  { phrase: 'personal tax relief for compulsory CPF', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: ['COMPULSORY'],
    population: 'INDIVIDUAL', beneficiary: 'INDIVIDUAL' },
  { phrase: 'individual income tax relief for compulsory CPF', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: ['COMPULSORY'],
    population: 'INDIVIDUAL', beneficiary: 'INDIVIDUAL' },
  { phrase: 'individual personal tax relief claim for compulsory CPF contributions', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: ['COMPULSORY'],
    population: 'INDIVIDUAL', beneficiary: 'INDIVIDUAL' },
  { phrase: 'individual personal tax relief on compulsory CPF contributions', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: ['COMPULSORY'],
    population: 'INDIVIDUAL', beneficiary: 'INDIVIDUAL' },
  { phrase: 'individual entitlement to personal tax relief for compulsory CPF contributions', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: ['COMPULSORY'],
    population: 'INDIVIDUAL', beneficiary: 'INDIVIDUAL' },
  { phrase: 'employee personal tax relief on compulsory CPF', identity: 'CPF_RELIEF', scope: 'SPECIFIC', facets: ['COMPULSORY'],
    population: 'INDIVIDUAL', beneficiary: 'EMPLOYEE' },
  { phrase: 'employer CPF contributions', identity: 'CPF_CONTRIBUTIONS', scope: 'SPECIFIC', facets: [],
    population: 'EMPLOYER', actors: ['EMPLOYER'] },
  { phrase: 'employer CPF contribution amount', identity: 'CPF_CONTRIBUTIONS', scope: 'SPECIFIC', facets: [],
    population: 'EMPLOYER', actors: ['EMPLOYER'], allowedOperations: ['CALCULATE'] },
  { phrase: 'employee CPF contribution amount', identity: 'CPF_CONTRIBUTIONS', scope: 'SPECIFIC', facets: [],
    population: 'EMPLOYEE', actors: ['EMPLOYEE'], allowedOperations: ['CALCULATE'] },
  { phrase: 'employer CPF contribution', identity: 'CPF_CONTRIBUTIONS', scope: 'SPECIFIC', facets: [],
    population: 'EMPLOYER', actors: ['EMPLOYER'] },
  { phrase: 'employer CPF contribution obligation', identity: 'CPF_CONTRIBUTIONS', scope: 'SPECIFIC', facets: ['OBLIGATION'],
    population: 'EMPLOYER', actors: ['EMPLOYER'] },
  { phrase: 'employer CPF contribution obligations', identity: 'CPF_CONTRIBUTIONS', scope: 'SPECIFIC', facets: ['OBLIGATION'],
    population: 'EMPLOYER', actors: ['EMPLOYER'] },
  { phrase: 'employee CPF contributions', identity: 'CPF_CONTRIBUTIONS', scope: 'SPECIFIC', facets: [],
    population: 'EMPLOYEE', actors: ['EMPLOYEE'] },
  { phrase: 'employee CPF contribution', identity: 'CPF_CONTRIBUTIONS', scope: 'SPECIFIC', facets: [],
    population: 'EMPLOYEE', actors: ['EMPLOYEE'] },
  { phrase: 'employee CPF contribution obligation', identity: 'CPF_CONTRIBUTIONS', scope: 'SPECIFIC', facets: ['OBLIGATION'],
    population: 'EMPLOYEE', actors: ['EMPLOYEE'] },
  { phrase: 'employee CPF contribution obligations', identity: 'CPF_CONTRIBUTIONS', scope: 'SPECIFIC', facets: ['OBLIGATION'],
    population: 'EMPLOYEE', actors: ['EMPLOYEE'] },
  { phrase: 'CPF contributions', identity: 'CPF_CONTRIBUTIONS', scope: 'SPECIFIC', facets: [] },
  { phrase: 'individual tax relief categories', identity: 'INDIVIDUAL_RELIEF_CATEGORIES', scope: 'OVERVIEW', facets: ['OVERVIEW'], population: 'INDIVIDUAL' },
  { phrase: 'personal tax reliefs', identity: 'INDIVIDUAL_RELIEF_CATEGORIES', scope: 'OVERVIEW', facets: ['OVERVIEW'], population: 'INDIVIDUAL' },
  { phrase: 'overview of individual tax relief categories', identity: 'INDIVIDUAL_RELIEF_CATEGORIES', scope: 'OVERVIEW', facets: ['OVERVIEW'], population: 'INDIVIDUAL' },
  { phrase: 'individual tax relief categories including CPF relief for employees', identity: 'INDIVIDUAL_RELIEF_CATEGORIES', scope: 'OVERVIEW', facets: ['OVERVIEW', 'CPF_EXAMPLE'],
    population: 'INDIVIDUAL', beneficiary: 'EMPLOYEE' },
  { phrase: 'employer CPF contributions affect personal CPF tax relief', identity: 'EMPLOYER_CPF_AFFECTS_INDIVIDUAL_RELIEF', scope: 'INTERACTION', facets: ['DIRECTED_RELATION'],
    population: 'INDIVIDUAL', actors: ['EMPLOYER'], beneficiary: 'INDIVIDUAL' },
  { phrase: 'CPF employer contributions affecting personal CPF tax relief', identity: 'EMPLOYER_CPF_AFFECTS_INDIVIDUAL_RELIEF', scope: 'INTERACTION', facets: ['DIRECTED_RELATION'],
    population: 'INDIVIDUAL', actors: ['EMPLOYER'], beneficiary: 'INDIVIDUAL' },
];

const subjectDescriptors = new Map(descriptorRows.map(descriptor => [normalizePhrase(descriptor.phrase), descriptor]));

function normalizePhrase(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en');
}

function parseProduction(text: string): { production: RequestProduction; outcomes: Array<Omit<RawRequestOutcome, 'productionId' | 'span'>> } | undefined {
  for (const production of requestProductions) {
    const pattern = new RegExp(production.pattern.source.replaceAll(' ', '\\s+'), production.pattern.flags);
    if (pattern.test(text)) return { production, outcomes: production.outcomes() };
  }
  return undefined;
}

function findSeparators(text: string): Array<{ start: number; end: number; kind: 'conjunction' | 'punctuation' }> {
  const separators: Array<{ start: number; end: number; kind: 'conjunction' | 'punctuation' }> = [];
  const pattern = /,?\s+(?:and|plus)(?=\s|$)|[.?]/giu;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start === undefined) continue;
    separators.push({ start, end: start + match[0].length, kind: /(?:and|plus)/iu.test(match[0]) ? 'conjunction' : 'punctuation' });
  }
  return separators;
}

function addParsed(
  parsed: NonNullable<ReturnType<typeof parseProduction>>,
  start: number,
  end: number,
  outcomes: RawRequestOutcome[]
): boolean {
  let complete = true;
  for (const item of parsed.outcomes) {
    if (outcomes.length >= MAX_OUTCOMES) { complete = false; break; }
    outcomes.push({ ...item, productionId: parsed.production.id, span: { start, end } });
  }
  return complete;
}

function splitRecognized(text: string, baseOffset: number): {
  outcomes: RawRequestOutcome[];
  findings: RawRequestFinding[];
  fullyConsumed: boolean;
} {
  const outcomes: RawRequestOutcome[] = [];
  const findings: RawRequestFinding[] = [];
  let cursor = 0;
  let fullyConsumed = true;
  let outcomeLimitExceeded = false;
  let steps = 0;

  while (cursor < text.length && steps++ < MAX_OUTCOMES + 4) {
    const remainder = text.slice(cursor);
    const separators = findSeparators(remainder);
    let accepted: { candidate: string; parsed: NonNullable<ReturnType<typeof parseProduction>>; separator: { start: number; end: number; kind: 'conjunction' | 'punctuation' }; leadingTrim: number } | undefined;
    for (const separator of separators) {
      const untrimmed = remainder.slice(0, separator.start);
      const candidate = untrimmed.trim();
      const parsed = parseProduction(candidate);
      if (parsed) {
        accepted = { candidate, parsed, separator, leadingTrim: untrimmed.length - untrimmed.trimStart().length };
        break;
      }
    }
    if (!accepted) {
      const terminal = remainder.trim();
      const parsed = parseProduction(terminal);
      if (parsed) {
        const leadingTrim = remainder.length - remainder.trimStart().length;
        outcomeLimitExceeded = !addParsed(parsed, baseOffset + cursor + leadingTrim, baseOffset + cursor + leadingTrim + terminal.length, outcomes) || outcomeLimitExceeded;
        break;
      }
      fullyConsumed = false;
      findings.push({ stage: 'INVENTORY', code: outcomes.length ? 'UNKNOWN_SUFFIX_OR_REQUEST' : 'UNKNOWN_PREFIX_OR_REQUEST',
        span: { start: baseOffset + cursor, end: baseOffset + text.length } });
      break;
    }

    const rawStart = baseOffset + cursor + accepted.leadingTrim;
    const rawEnd = rawStart + accepted.candidate.length;
    outcomeLimitExceeded = !addParsed(accepted.parsed, rawStart, rawEnd, outcomes) || outcomeLimitExceeded;
    cursor += accepted.separator.end;
    let consumedFollowingConjunction = false;
    if (accepted.separator.kind === 'punctuation') {
      const followingConjunction = /^\s*,?\s+(?:and|plus)(?=\s|$)/iu.exec(text.slice(cursor));
      if (followingConjunction) {
        cursor += followingConjunction[0].length;
        consumedFollowingConjunction = true;
      }
    }
    if (!text.slice(cursor).trim()) {
      if (accepted.separator.kind === 'conjunction' || consumedFollowingConjunction) {
        fullyConsumed = false;
        findings.push({ stage: 'INVENTORY', code: 'TRAILING_CONJUNCTION', span: { start: baseOffset + cursor, end: baseOffset + text.length } });
      }
      break;
    }
  }

  if (outcomeLimitExceeded || steps >= MAX_OUTCOMES + 4) {
    fullyConsumed = false;
    findings.push({ stage: 'INVENTORY', code: 'OUTCOME_LIMIT_EXCEEDED' });
  }
  return { outcomes, findings, fullyConsumed };
}

function parseSalaryFrame(input: string): { length: number; fact: RawRequestFact } | undefined {
  const match = /^\s*For\s+someone\s+earning\s+SGD\s+((?:0|[1-9]\d{0,2}(?:,\d{3})*)(?:\.\d+)?)\s+a\s+month,\s+/iu.exec(input);
  if (!match) return undefined;
  return { length: match[0].length, fact: { type: 'SALARY_PER_MONTH', currency: 'SGD', amountText: match[1], span: { start: match.index, end: match.index + match[0].length } } };
}

function uncertain(code: RawRequestFindingCode, inputLength: number): RawRequestInventory {
  return { state: 'UNCERTAIN', fullyConsumed: false, outcomes: [], facts: [], findings: [{ stage: 'INVENTORY', code }], inputLength };
}

/** Parse only known pilot productions; any unconsumed text keeps routing ownership closed. */
export function inventoryRawRequest(input: unknown): RawRequestInventory {
  if (typeof input !== 'string') return uncertain('NONSTRING_INPUT', 0);
  if (input.length > MAX_INPUT_UNITS) return uncertain('INPUT_TOO_LONG', input.length);
  if (!input.trim()) return uncertain('EMPTY_INPUT', input.length);

  const frame = parseSalaryFrame(input);
  const requestText = frame ? input.slice(frame.length) : input;
  const parsed = splitRecognized(requestText, frame?.length ?? 0);
  const facts = frame ? [frame.fact] : [];
  const operationAmbiguous = parsed.outcomes.some(item => item.operation === 'AMBIGUOUS');
  if (operationAmbiguous) {
    parsed.findings.push({ stage: 'INVENTORY', code: 'AMBIGUOUS_CLAIMABILITY_OR_AMOUNT' });
    if (!frame) parsed.findings.push({ stage: 'INVENTORY', code: 'UNRESOLVED_PRONOUN' });
  }
  return {
    state: parsed.fullyConsumed && !operationAmbiguous ? 'COMPLETE' : 'UNCERTAIN',
    fullyConsumed: parsed.fullyConsumed,
    outcomes: parsed.outcomes.slice(0, MAX_OUTCOMES),
    facts,
    findings: parsed.findings,
    inputLength: input.length
  };
}

/** Exact subject descriptors keep broad examples from masquerading as child requests. */
export function describeRawRequestSubject(subject: string): RawRequestSubjectDescriptor | undefined {
  if (!subject.trim()) return undefined;
  const descriptor = subjectDescriptors.get(normalizePhrase(subject));
  return descriptor ? {
    ...descriptor,
    facets: [...descriptor.facets],
    ...(descriptor.actors ? { actors: [...descriptor.actors] } : {}),
    ...(descriptor.allowedPopulations ? { allowedPopulations: [...descriptor.allowedPopulations] } : {})
  } : undefined;
}

/** Validate a semantic issue against independently inventoried raw request dimensions. */
export function rawRequestMatchesIssue(
  request: RawRequestOutcome,
  descriptor: RawRequestSubjectDescriptor,
  population: string,
  operation: string
): boolean {
  if (request.identity !== descriptor.identity || request.scope !== descriptor.scope || request.population !== population) return false;
  if (request.operation !== operation && !(request.operation === 'AMBIGUOUS' && request.allowedOperations?.some(allowed => allowed === operation))) return false;
  if (descriptor.allowedOperations?.length && !descriptor.allowedOperations.some(allowed => allowed === operation)) return false;
  const allowedPopulations = descriptor.allowedPopulations ?? (descriptor.population ? [descriptor.population] : []);
  if (allowedPopulations.length && !allowedPopulations.some(allowed => allowed === population)) return false;
  if (descriptor.actors?.some(actor => {
    if (actor === 'EMPLOYER') return population !== 'EMPLOYER' && !(population === 'INDIVIDUAL' && descriptor.beneficiary === 'INDIVIDUAL');
    if (actor === 'EMPLOYEE') return population !== 'EMPLOYEE' && !(population === 'INDIVIDUAL' && descriptor.beneficiary === 'EMPLOYEE');
    return true;
  })) return false;
  if (request.beneficiary === 'EMPLOYEE' && descriptor.beneficiary !== 'EMPLOYEE') return false;
  if (request.beneficiary === 'INDIVIDUAL' && descriptor.beneficiary && descriptor.beneficiary !== 'INDIVIDUAL') return false;
  return true;
}

export const RAW_REQUEST_INVENTORY_LIMITS = Object.freeze({ maxInputUnits: MAX_INPUT_UNITS, maxOutcomes: MAX_OUTCOMES });
