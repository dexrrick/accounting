/*
 * Bounded request-language v0 feasibility prototype.
 *
 * This module intentionally has no imports and no provider, network, routing,
 * evidence, fixture-ID, or expected-answer path. The grammar below is the
 * complete accepted language for this prototype; unconsumed material is kept
 * visible as an inventory finding.
 *
 * Lexical rules: case-insensitive matching, whitespace runs between words,
 * and declared hyphenated aliases may use either a hyphen or whitespace.
 * Offsets are JavaScript string offsets (UTF-16 code units) into the original
 * input. Maximum input is 2,000 UTF-16 code units and maximum outcomes is 12.
 *
 * Document productions:
 *   document := [context] request (connector request)* [terminal]
 *   connector := '.' | '?' | ',' 'and' | 'and' | ',' 'plus' | 'plus'
 *   terminal := '.' | '?'
 *   request := interaction | alternative-decision | coordinated-calculation
 *            | ordinary-production | context-reference-treatment
 *   ordinary-production := one complete literal head + one complete declared
 *                          subject phrase from PRODUCTIONS below
 *
 * Specific declared heads and subject phrases are in PRODUCTIONS. They are
 * finite alternatives, never substring matches. `including CPF relief for
 * employees` is a modifier on the relief overview production. The `and`/`or`
 * inside coordinated-calculation and alternative-decision productions is
 * owned by those productions. Context frames are anchored at input offset 0.
 */

const MAX_INPUT_UNITS = 2000;
const MAX_OUTCOMES = 12;

const OPERATIONS = new Set([
  'EXPLAIN', 'ELIGIBLE', 'CALCULATE', 'TREATMENT', 'FILING', 'MEASURE',
  'APPLICABILITY', 'CLASSIFY',
]);
const POPULATIONS = new Set([
  'INDIVIDUAL', 'EMPLOYEE', 'EMPLOYER', 'COMPANY', 'NONRESIDENT_COMPANY',
  'FUND_MANAGER', 'INVESTMENT', 'COMPANY_EXPENSE', 'UNKNOWN',
]);
const SCOPES = new Set([
  'SPECIFIC', 'OVERVIEW', 'INTERACTION', 'ALTERNATIVE_DECISION',
]);
const FACETS = new Set([
  'COMPULSORY', 'GENERAL', 'PRIVATE', 'FOREIGN', 'OVERVIEW', 'CPF_EXAMPLE',
  'EXPLORATION', 'EVALUATION', 'ELIGIBILITY', 'QUOTA', 'DEADLINE',
  'OBLIGATION', 'CMS_LICENCE', 'EXEMPTION', 'FVPL', 'FVOCI',
  'DECISION_RELATION', 'SUBSEQUENT_MEASUREMENT', 'ACCOUNTING',
  'TAX_DEDUCTIBILITY', 'EMPLOYER_CONTRIBUTIONS_AFFECT_PERSONAL_RELIEF',
  'PERSONAL_RELIEF_AFFECTS_EMPLOYER_CONTRIBUTIONS',
  'ROYALTY', 'INPUT_RECOVERY', 'NONRESIDENT', 'SINGAPORE',
]);

const rx = (source) => new RegExp(source, 'iy');
const phrase = (text) => text
  .split(/(\s+|-)/)
  .map((part) => part === '-' ? '(?:-|\\s+)' : /^\s+$/.test(part) ? '\\s+' : escapeRegex(part))
  .join('');
const alternatives = (phrases) => `(?:${phrases.map(phrase).join('|')})`;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function outcome(operation, identity, population, scope = 'SPECIFIC', facets = [], participants = []) {
  return { operation, subject: { identity }, population, scope, facets, participants };
}

function fixed(value) {
  return () => value;
}

/*
 * Declarative request productions. Each pattern is sticky at the current
 * cursor and ends at a complete phrase. No trailing wildcard is permitted.
 */
const PRODUCTIONS = [
  {
    name: 'interaction',
    pattern: rx(`explain\\s+how\\s+${alternatives(['employer CPF contributions', 'CPF employer contributions'])}\\s+affect\\s+${alternatives(['personal CPF tax relief', 'personal tax relief on compulsory CPF contributions'])}`),
    make: fixed([outcome('EXPLAIN', 'employer_contributions_affect_personal_relief', 'INDIVIDUAL', 'INTERACTION', ['EMPLOYER_CONTRIBUTIONS_AFFECT_PERSONAL_RELIEF'], ['EMPLOYER', 'INDIVIDUAL'])]),
  },
  {
    name: 'cms-alternative-decision',
    pattern: rx(phrase('Does this fund manager need a CMS licence or qualify for an exemption')),
    make: fixed([outcome('APPLICABILITY', 'cms_licence_or_exemption', 'UNKNOWN', 'ALTERNATIVE_DECISION', ['CMS_LICENCE', 'EXEMPTION', 'DECISION_RELATION'])]),
  },
  {
    name: 'investment-alternative-decision',
    pattern: rx(phrase('Should this investment be FVPL or FVOCI')),
    make: fixed([outcome('CLASSIFY', 'investment_fvpl_fvoci', 'UNKNOWN', 'ALTERNATIVE_DECISION', ['FVPL', 'FVOCI', 'DECISION_RELATION'])]),
  },
  {
    name: 'coordinated-cpf-calculation',
    pattern: rx(phrase('How much CPF do the employee and employer contribute')),
    make: fixed([
      outcome('CALCULATE', 'cpf_contributions', 'EMPLOYEE'),
      outcome('CALCULATE', 'cpf_contributions', 'EMPLOYER'),
    ]),
  },
  {
    name: 'overview-including-cpf-example',
    pattern: rx(`${phrase('Explain individual tax relief categories')}(?:,)?\\s+${phrase('including CPF relief for employees')}`),
    make: fixed([outcome('EXPLAIN', 'individual_tax_relief_overview', 'INDIVIDUAL', 'OVERVIEW', ['OVERVIEW', 'CPF_EXAMPLE'])]),
  },
  {
    name: 'overview-request',
    pattern: rx(`(?:${phrase('I need an overview of individual tax relief categories')}|${phrase('What individual tax relief categories are available')})`),
    make: fixed([outcome('EXPLAIN', 'individual_tax_relief_overview', 'INDIVIDUAL', 'OVERVIEW', ['OVERVIEW'])]),
  },
  {
    name: 'cpf-relief-eligible',
    pattern: rx(`(?:${phrase('Can I claim personal tax relief on my compulsory CPF contributions')}|${phrase('Can I claim personal tax relief for my compulsory CPF contributions')}|${phrase('Can I claim CPF relief for employees')})`),
    make: (match) => [outcome('ELIGIBLE', 'cpf_relief', 'INDIVIDUAL', 'SPECIFIC', /compulsory/i.test(match[0]) ? ['COMPULSORY'] : [])],
  },
  {
    name: 'cpf-relief-claimability-with-contextual-pronoun',
    pattern: rx(`what\\s+can\\s+they\\s+claim\\s+for\\s+${alternatives(['personal tax relief on compulsory CPF contributions', 'personal tax relief for compulsory CPF contributions', 'personal tax relief on compulsory CPF', 'personal tax relief for compulsory CPF', 'individual income tax relief for compulsory CPF', 'individual personal tax relief claim for compulsory CPF contributions'])}`),
    make: fixed([outcome('ELIGIBLE', 'cpf_relief', 'INDIVIDUAL', 'SPECIFIC', ['COMPULSORY'])]),
  },
  {
    name: 'cpf-relief-calculation',
    pattern: rx(`how\\s+much\\s+personal\\s+tax\\s+relief\\s+can\\s+i\\s+claim\\s+for\\s+${alternatives(['compulsory CPF contributions', 'compulsory CPF'])}`),
    make: fixed([outcome('CALCULATE', 'cpf_relief', 'INDIVIDUAL', 'SPECIFIC', ['COMPULSORY'])]),
  },
  {
    name: 'cpf-relief-explain',
    pattern: rx(`explain\\s+${alternatives(['CPF relief for employees', 'personal tax relief on compulsory CPF contributions', 'personal tax relief for compulsory CPF contributions', 'personal tax relief on compulsory CPF', 'personal tax relief for compulsory CPF', 'individual income tax relief for compulsory CPF', 'individual personal tax relief claim for compulsory CPF contributions', 'CPF relief'])}`),
    make: (match) => {
      const isEmployeePhrase = /CPF\s+relief\s+for\s+employees/i.test(match[0]);
      const population = isEmployeePhrase ? 'EMPLOYEE' : /personal|individual/i.test(match[0]) ? 'INDIVIDUAL' : 'UNKNOWN';
      return [outcome('EXPLAIN', 'cpf_relief', population, 'SPECIFIC', /compulsory/i.test(match[0]) ? ['COMPULSORY'] : [])];
    },
  },
  {
    name: 'employer-cpf-calculation',
    pattern: rx(`(?:${phrase('How much CPF must the employer contribute')}|${phrase('What does the employer have to pay into CPF')})`),
    make: fixed([outcome('CALCULATE', 'cpf_contributions', 'EMPLOYER')]),
  },
  {
    name: 'general-tax-residency-rule',
    pattern: rx(phrase('How do Singapore tax rules determine whether a company is tax resident here')),
    make: fixed([outcome('EXPLAIN', 'company_tax_residency', 'COMPANY', 'SPECIFIC', ['GENERAL', 'SINGAPORE'])]),
  },
  {
    name: 'general-nonresident-royalty-withholding-rule',
    pattern: rx(`${phrase('What are the general Singapore withholding-tax rules when a company pays royalties to a')}\\s+${alternatives(['non-resident company', 'nonresident company'])}`),
    make: fixed([outcome('EXPLAIN', 'royalty_withholding_tax', 'COMPANY', 'SPECIFIC', ['GENERAL', 'ROYALTY', 'NONRESIDENT', 'SINGAPORE'])]),
  },
  {
    name: 'general-gst-input-recovery-rule',
    pattern: rx(phrase('What are the general Singapore GST rules for claiming input tax on business purchases by a GST-registered company')),
    make: fixed([outcome('EXPLAIN', 'gst_input_recovery', 'COMPANY', 'SPECIFIC', ['GENERAL', 'INPUT_RECOVERY', 'SINGAPORE'])]),
  },
  {
    name: 'general-rule-short-head',
    pattern: rx(`explain\\s+the\\s+general\\s+${alternatives(['GST input tax rule', 'royalty withholding tax rule'])}`),
    make: (match) => /GST/i.test(match[0])
      ? [outcome('EXPLAIN', 'gst_input_recovery', 'UNKNOWN', 'SPECIFIC', ['GENERAL', 'INPUT_RECOVERY'])]
      : [outcome('EXPLAIN', 'royalty_withholding_tax', 'UNKNOWN', 'SPECIFIC', ['GENERAL', 'ROYALTY'])],
  },
  {
    name: 'exploration-evaluation-treatment',
    pattern: rx(phrase('Explain the accounting treatment of exploration and evaluation under SFRS(I) 6')),
    make: fixed([outcome('EXPLAIN', 'sfrsi6_exploration_evaluation', 'UNKNOWN', 'SPECIFIC', ['EXPLORATION', 'EVALUATION'])]),
  },
  {
    name: 'employment-pass-eligibility',
    pattern: rx(phrase('Can this person obtain an Employment Pass')),
    make: fixed([outcome('ELIGIBLE', 'employment_pass', 'INDIVIDUAL', 'SPECIFIC', ['ELIGIBILITY'])]),
  },
  {
    name: 'employment-quota-applicability',
    pattern: rx(phrase('Is the company subject to an employment quota')),
    make: fixed([outcome('ELIGIBLE', 'employment_quota', 'COMPANY', 'SPECIFIC', ['QUOTA'])]),
  },
  {
    name: 'annual-return-deadline',
    pattern: rx(phrase('When is the annual return due')),
    make: fixed([outcome('FILING', 'annual_return', 'COMPANY', 'SPECIFIC', ['DEADLINE'])]),
  },
  {
    name: 'financial-statements-filing-obligation',
    pattern: rx(phrase('Must financial statements be filed')),
    make: fixed([outcome('FILING', 'financial_statements', 'COMPANY', 'SPECIFIC', ['OBLIGATION'])]),
  },
  {
    name: 'expense-accounting-treatment',
    pattern: rx(phrase('How should this expense be accounted for')),
    make: fixed([outcome('TREATMENT', 'expense_accounting', 'UNKNOWN', 'SPECIFIC', ['ACCOUNTING'])]),
  },
  {
    name: 'expense-tax-deductibility-anaphora',
    pattern: rx(phrase('Is it tax deductible')),
    make: (_match, previous) => previous?.some((o) => o.subject.identity === 'expense_accounting')
      ? [outcome('ELIGIBLE', 'expense_tax_deductibility', 'UNKNOWN', 'SPECIFIC', ['TAX_DEDUCTIBILITY'])]
      : { unresolved: 'ANAPHORA_WITHOUT_IMMEDIATE_EXPENSE_REQUEST' },
  },
  {
    name: 'overview-explain',
    pattern: rx(phrase('Explain personal tax reliefs')),
    make: fixed([outcome('EXPLAIN', 'individual_tax_relief_overview', 'INDIVIDUAL', 'OVERVIEW', ['OVERVIEW'])]),
  },
  {
    name: 'general-rules-explain',
    pattern: rx(`what\\s+are\\s+the\\s+general\\s+singapore\\s+${alternatives(['GST input tax rules', 'royalty withholding-tax rules'])}`),
    make: (match) => /GST/i.test(match[0])
      ? [outcome('EXPLAIN', 'gst_input_recovery', 'UNKNOWN', 'SPECIFIC', ['GENERAL', 'INPUT_RECOVERY', 'SINGAPORE'])]
      : [outcome('EXPLAIN', 'royalty_withholding_tax', 'UNKNOWN', 'SPECIFIC', ['GENERAL', 'ROYALTY', 'SINGAPORE'])],
  },
  {
    name: 'investment-subsequent-measurement-anaphora',
    pattern: rx(phrase('How should subsequent changes be measured')),
    make: (_match, previous) => previous?.some((o) => o.subject.identity === 'investment_fvpl_fvoci')
      ? [outcome('MEASURE', 'investment_subsequent_changes', 'UNKNOWN', 'SPECIFIC', ['SUBSEQUENT_MEASUREMENT'])]
      : { unresolved: 'ANAPHORA_WITHOUT_IMMEDIATE_INVESTMENT_DECISION' },
  },
  {
    name: 'private-expense-context-reference',
    pattern: rx(phrase('What is its corporate income-tax treatment')),
    make: (_match, _previous, context) => context?.kind === 'private_expense'
      ? [outcome('TREATMENT', 'private_director_expense_tax_treatment', 'COMPANY', 'SPECIFIC', ['PRIVATE'])]
      : { unresolved: 'PRIVATE_EXPENSE_CONTEXT_REQUIRED' },
  },
  {
    name: 'foreign-dividend-context-reference',
    pattern: rx(phrase("Explain the company's Singapore corporate income-tax treatment for this receipt")),
    make: (_match, _previous, context) => context?.kind === 'foreign_dividend'
      ? [outcome('TREATMENT', 'foreign_dividend_tax_treatment', 'COMPANY', 'SPECIFIC', ['FOREIGN', 'SINGAPORE'])]
      : { unresolved: 'FOREIGN_DIVIDEND_CONTEXT_REQUIRED' },
  },
];

const CONTEXT_PRODUCTIONS = [
  {
    kind: 'salary',
    pattern: rx('For\\s+someone\\s+earning\\s+SGD\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)\\s+a\\s+month,'),
    data: (match) => ({ amount: match[1], currency: 'SGD', period: 'MONTH' }),
  },
  {
    kind: 'private_expense',
    pattern: rx('Our\\s+Singapore\\s+company\\s+paid\\s+SGD\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)\\s+for\\s+the\\s+director\'s\\s+private\\s+holiday\\s+and\\s+recorded\\s+it\\s+as\\s+travel\\s+expense\\.'),
    data: (match) => ({ amount: match[1], currency: 'SGD', factType: 'DIRECTOR_PRIVATE_HOLIDAY_RECORDED_TRAVEL_EXPENSE', qualifier: 'PRIVATE' }),
  },
  {
    kind: 'foreign_dividend',
    pattern: rx('Our\\s+Singapore\\s+company\\s+received\\s+a\\s+dividend\\s+from\\s+its\\s+(Thai|Thailand)\\s+subsidiary\\s+in\\s+the\\s+current\\s+year\\.'),
    data: (match) => ({ country: match[1].toLowerCase(), factType: 'SUBSIDIARY_DIVIDEND', qualifier: 'FOREIGN' }),
  },
];

const NEGATION = /\b(?:do\s+not|don't|never)\b/i;

function findContext(raw) {
  for (const production of CONTEXT_PRODUCTIONS) {
    production.pattern.lastIndex = 0;
    const match = production.pattern.exec(raw);
    if (match) {
      return {
        kind: production.kind,
        fact: {
          id: 'f1',
          kind: production.kind,
          span: { start: match.index, end: match.index + match[0].length },
          data: production.data(match),
        },
      };
    }
  }
  return null;
}

function matchRequest(raw, start, previous, context) {
  for (const production of PRODUCTIONS) {
    production.pattern.lastIndex = start;
    const match = production.pattern.exec(raw);
    if (!match) continue;
    const made = production.make(match, previous, context);
    if (made?.unresolved) {
      return {
        production: production.name,
        end: production.pattern.lastIndex,
        unresolved: made.unresolved,
        outcomes: [],
      };
    }
    return {
      production: production.name,
      end: production.pattern.lastIndex,
      outcomes: made.map((o) => ({
        ...o,
        subject: { ...o.subject },
        facets: [...o.facets],
        participants: [...o.participants],
        requestSpans: [{ start, end: production.pattern.lastIndex }],
      })),
    };
  }
  return null;
}

function addFinding(findings, code, message, details = {}) {
  findings.push({ stage: 'INVENTORY', code, message, ...details });
}

function nextRecoveryBoundary(raw, start) {
  const match = /[;:!?]|\.(?=\s+[A-Za-z])|,\s+(?:and|plus)\b|\b(?:and|plus)\b/ig;
  match.lastIndex = start;
  const found = match.exec(raw);
  return found ? { start: found.index, end: match.lastIndex } : null;
}

function skipSpace(raw, index) {
  while (index < raw.length && /\s/u.test(raw[index])) index += 1;
  return index;
}

function readConnector(raw, index) {
  const tokenStart = skipSpace(raw, index);
  const candidates = [
    { pattern: rx(',\\s+and\\b'), endIsConnector: true },
    { pattern: rx(',\\s+plus\\b'), endIsConnector: true },
    { pattern: rx('and\\b'), endIsConnector: true },
    { pattern: rx('plus\\b'), endIsConnector: true },
  ];
  for (const item of candidates) {
    item.pattern.lastIndex = tokenStart;
    const match = item.pattern.exec(raw);
    if (match && (match[0][0] === ',' || tokenStart > index || tokenStart === 0 || !/[\p{L}\p{N}_]/u.test(raw[tokenStart - 1]))) {
      return { end: item.pattern.lastIndex, kind: 'word' };
    }
  }
  if (raw[tokenStart] === '.' || raw[tokenStart] === '?') {
    const next = skipSpace(raw, tokenStart + 1);
    if (next < raw.length) return { end: next, kind: 'punctuation' };
  }
  return null;
}

function recoverAfterUnknown(raw, start, outcomes, context, findings) {
  let cursor = start;
  while (cursor < raw.length) {
    const boundary = nextRecoveryBoundary(raw, cursor);
    if (!boundary) return raw.length;
    cursor = skipSpace(raw, boundary.end);
    if (cursor >= raw.length) return raw.length;
    const recovered = matchRequest(raw, cursor, outcomes, context);
    if (recovered) {
      if (recovered.unresolved) {
        addFinding(findings, recovered.unresolved, 'A context-dependent request lacks its required preceding request or fact.', { span: { start: cursor, end: recovered.end } });
      } else {
        outcomes.push(...recovered.outcomes);
      }
      return recovered.end;
    }
  }
  return raw.length;
}

/** Parse the bounded request language from raw user text. */
export function parseQuestion(raw) {
  const findings = [];
  const outcomes = [];
  const facts = [];
  if (typeof raw !== 'string') {
    return { state: 'UNCERTAIN', outcomes, facts, findings: [{ stage: 'INVENTORY', code: 'INVALID_RAW_INPUT', message: 'The raw question must be a string.' }] };
  }
  if (raw.length > MAX_INPUT_UNITS) {
    return { state: 'UNCERTAIN', outcomes, facts, findings: [{ stage: 'INVENTORY', code: 'INPUT_LIMIT', message: `Input exceeds ${MAX_INPUT_UNITS} UTF-16 code units.` }] };
  }

  let cursor = 0;
  const contextMatch = findContext(raw);
  let context = null;
  if (contextMatch && contextMatch.fact.span.start === 0) {
    context = contextMatch;
    facts.push(context.fact);
    cursor = context.fact.span.end;
  }

  if (NEGATION.test(raw)) {
    addFinding(findings, 'NEGATED_INSTRUCTION', 'Negated instructions are outside the bounded request grammar.', { span: { start: 0, end: raw.length } });
  }

  cursor = skipSpace(raw, cursor);
  let previousRequestOutcomes = null;
  let expectedRequest = true;
  while (cursor < raw.length) {
    cursor = skipSpace(raw, cursor);
    if (cursor >= raw.length) break;

    if (expectedRequest) {
      const parsed = matchRequest(raw, cursor, previousRequestOutcomes, context);
      if (!parsed) {
        const code = outcomes.length === 0 ? 'UNKNOWN_PREFIX_OR_REQUEST' : 'UNKNOWN_REQUEST';
        addFinding(findings, code, 'The remaining clause does not match a declared request production.', { span: { start: cursor, end: raw.length } });
        // In the single negation counterexample, retain only a later explicitly
        // positive request after a hard clause boundary. The inventory remains
        // UNCERTAIN and no negative request is inferred.
        const recoveredEnd = recoverAfterUnknown(raw, cursor, outcomes, context, findings);
        if (recoveredEnd <= cursor || recoveredEnd >= raw.length) break;
        cursor = recoveredEnd;
        expectedRequest = false;
        previousRequestOutcomes = outcomes.length ? outcomes.slice() : null;
        continue;
      }
      if (parsed.unresolved) {
        addFinding(findings, parsed.unresolved, 'A context-dependent request lacks its required preceding request or fact.', { span: { start: cursor, end: parsed.end } });
      } else {
        outcomes.push(...parsed.outcomes);
      }
      if (outcomes.length > MAX_OUTCOMES) {
        addFinding(findings, 'OUTCOME_LIMIT', `Input exceeds ${MAX_OUTCOMES} bounded requests.`, { span: { start: cursor, end: parsed.end } });
        outcomes.length = MAX_OUTCOMES;
      }
      previousRequestOutcomes = parsed.outcomes.length ? parsed.outcomes : null;
      cursor = parsed.end;
      expectedRequest = false;
      continue;
    }

    const connector = readConnector(raw, cursor);
    if (connector) {
      cursor = connector.end;
      if (skipSpace(raw, cursor) >= raw.length) {
        addFinding(findings, 'DANGLING_CONNECTOR', 'A connector must be followed by a recognized request.', { span: { start: cursor, end: raw.length } });
        break;
      }
      expectedRequest = true;
      continue;
    }
    const punctuationStart = skipSpace(raw, cursor);
    if (raw[punctuationStart] === '.' || raw[punctuationStart] === '?') {
      cursor = skipSpace(raw, punctuationStart + 1);
      if (cursor >= raw.length) {
        for (const completed of previousRequestOutcomes ?? []) {
          const lastSpan = completed.requestSpans.at(-1);
          if (lastSpan && lastSpan.end <= punctuationStart) lastSpan.end = punctuationStart + 1;
        }
        break;
      }
      // A punctuation boundary only joins another request if the next token is
      // itself a declared request head; otherwise the trailing material is unknown.
      const next = matchRequest(raw, cursor, previousRequestOutcomes, context);
      if (next) {
        expectedRequest = true;
        continue;
      }
    }
    if (raw[punctuationStart] === ';' || raw[punctuationStart] === ':') {
      const boundaryEnd = punctuationStart + 1;
      addFinding(findings, 'UNSUPPORTED_CONNECTOR', 'Semicolon and colon separators are outside the declared document grammar.', { span: { start: punctuationStart, end: boundaryEnd } });
      cursor = skipSpace(raw, boundaryEnd);
      expectedRequest = true;
      continue;
    }
    addFinding(findings, 'UNKNOWN_SUFFIX_OR_MODIFIER', 'Unconsumed text after a recognized request may change its meaning.', { span: { start: cursor, end: raw.length } });
    const recoveredEnd = recoverAfterUnknown(raw, cursor, outcomes, context, findings);
    if (recoveredEnd <= cursor || recoveredEnd >= raw.length) break;
    cursor = recoveredEnd;
    expectedRequest = false;
  }

  if (outcomes.length === 0 && findings.length === 0) {
    addFinding(findings, 'EMPTY_INVENTORY', 'No declared request was found.');
  }
  return {
    state: findings.length === 0 ? 'COMPLETE' : 'UNCERTAIN',
    outcomes: outcomes.map((o, i) => ({ id: `o${i + 1}`, ...o })),
    facts,
    findings,
  };
}

/*
 * Bounded semantic subject aliases. Descriptor subject text is interpreted
 * independently from any claimed outcome ID. Values are whole normalized
 * noun phrases; unknown or missing qualifiers do not inherit an identity.
 */
const SUBJECT_ALIASES = new Map([
  ['cpf_relief', [
    'CPF relief', 'CPF relief for employees', 'personal CPF tax relief', 'personal tax relief on compulsory CPF contributions',
    'personal tax relief on compulsory CPF', 'personal tax relief for compulsory CPF contributions',
    'personal tax relief for compulsory CPF', 'individual income tax relief for compulsory CPF',
    'individual personal tax relief claim for compulsory CPF contributions',
  ]],
  ['individual_tax_relief_overview', ['personal tax reliefs', 'individual tax relief categories', 'individual personal tax relief categories']],
  ['cpf_contributions', ['CPF contributions', 'employee CPF contributions', 'employer CPF contributions']],
  ['private_director_expense_tax_treatment', ['private director holiday expense', 'director private holiday recorded as travel expense', 'private director expense tax treatment']],
  ['foreign_dividend_tax_treatment', ['Thai subsidiary dividend', 'Thailand subsidiary dividend', 'foreign dividend from Thai subsidiary', 'foreign dividend company tax treatment']],
  ['company_tax_residency', ['company tax residency', 'company tax resident under Singapore tax rules']],
  ['royalty_withholding_tax', ['royalty withholding tax', 'company royalty withholding tax paid to a non-resident company', 'non-resident royalty withholding tax', 'nonresident royalty withholding tax']],
  ['gst_input_recovery', ['GST input tax recovery', 'company input tax recovery on business purchases', 'GST input recovery']],
  ['sfrsi6_exploration_evaluation', ['exploration and evaluation under SFRS(I) 6', 'SFRS(I) 6 exploration and evaluation']],
  ['employment_pass', ['Employment Pass eligibility', 'Employment Pass']],
  ['employment_quota', ['company employment quota', 'employment quota']],
  ['annual_return', ['company annual return']],
  ['financial_statements', ['company financial statements', 'financial statements filing']],
  ['cms_licence_or_exemption', ['fund manager CMS licence or exemption', 'CMS licence or exemption']],
  ['investment_fvpl_fvoci', ['investment FVPL or FVOCI classification', 'FVPL or FVOCI investment classification']],
  ['investment_subsequent_changes', ['investment subsequent changes', 'subsequent measurement of investment changes']],
  ['expense_accounting', ['expense accounting treatment']],
  ['expense_tax_deductibility', ['expense tax deductibility']],
  ['employer_contributions_affect_personal_relief', ['employer CPF contributions affecting personal CPF tax relief', 'employer contributions affect personal CPF relief']],
]);

function normalizeSubjectText(text) {
  return text.trim().toLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ');
}

const SUBJECT_CONSTRAINTS = new Map([
  [normalizeSubjectText('employee CPF contributions'), { population: 'EMPLOYEE' }],
  [normalizeSubjectText('employer CPF contributions'), { population: 'EMPLOYER' }],
  [normalizeSubjectText('CPF relief for employees'), { populations: ['EMPLOYEE', 'INDIVIDUAL'] }],
  [normalizeSubjectText('personal tax relief on compulsory CPF contributions'), { population: 'INDIVIDUAL', facets: ['COMPULSORY'] }],
  [normalizeSubjectText('personal tax relief on compulsory CPF'), { population: 'INDIVIDUAL', facets: ['COMPULSORY'] }],
  [normalizeSubjectText('personal tax relief for compulsory CPF contributions'), { population: 'INDIVIDUAL', facets: ['COMPULSORY'] }],
  [normalizeSubjectText('personal tax relief for compulsory CPF'), { population: 'INDIVIDUAL', facets: ['COMPULSORY'] }],
  [normalizeSubjectText('individual income tax relief for compulsory CPF'), { population: 'INDIVIDUAL', facets: ['COMPULSORY'] }],
  [normalizeSubjectText('individual personal tax relief claim for compulsory CPF contributions'), { population: 'INDIVIDUAL', facets: ['COMPULSORY'] }],
  [normalizeSubjectText('private director holiday expense'), { facets: ['PRIVATE'] }],
  [normalizeSubjectText('director private holiday recorded as travel expense'), { facets: ['PRIVATE'] }],
  [normalizeSubjectText('private director expense tax treatment'), { facets: ['PRIVATE'] }],
  [normalizeSubjectText('Thai subsidiary dividend'), { facets: ['FOREIGN'] }],
  [normalizeSubjectText('Thailand subsidiary dividend'), { facets: ['FOREIGN'] }],
  [normalizeSubjectText('foreign dividend from Thai subsidiary'), { facets: ['FOREIGN'] }],
  [normalizeSubjectText('foreign dividend company tax treatment'), { population: 'COMPANY', facets: ['FOREIGN'] }],
  [normalizeSubjectText('company royalty withholding tax paid to a non-resident company'), { population: 'COMPANY', facets: ['NONRESIDENT'] }],
  [normalizeSubjectText('non-resident royalty withholding tax'), { facets: ['NONRESIDENT'] }],
  [normalizeSubjectText('nonresident royalty withholding tax'), { facets: ['NONRESIDENT'] }],
  [normalizeSubjectText('GST input tax recovery'), { facets: ['INPUT_RECOVERY'] }],
  [normalizeSubjectText('GST input recovery'), { facets: ['INPUT_RECOVERY'] }],
  [normalizeSubjectText('company input tax recovery on business purchases'), { population: 'COMPANY', facets: ['INPUT_RECOVERY'] }],
  [normalizeSubjectText('company annual return'), { population: 'COMPANY' }],
  [normalizeSubjectText('company financial statements'), { population: 'COMPANY' }],
  [normalizeSubjectText('company employment quota'), { population: 'COMPANY' }],
  [normalizeSubjectText('Employment Pass eligibility'), { population: 'INDIVIDUAL' }],
  [normalizeSubjectText('SFRS(I) 6 exploration and evaluation'), { facets: ['EXPLORATION', 'EVALUATION'] }],
  [normalizeSubjectText('exploration and evaluation under SFRS(I) 6'), { facets: ['EXPLORATION', 'EVALUATION'] }],
  [normalizeSubjectText('company tax resident under Singapore tax rules'), { population: 'COMPANY', facets: ['GENERAL', 'SINGAPORE'] }],
  [normalizeSubjectText('company tax residency'), { population: 'COMPANY' }],
]);

function identifySubject(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 160) return null;
  const normalized = normalizeSubjectText(text);
  for (const [identity, aliases] of SUBJECT_ALIASES) {
    if (aliases.some((alias) => normalizeSubjectText(alias) === normalized)) {
      return { identity, ...(SUBJECT_CONSTRAINTS.get(normalized) ?? {}) };
    }
  }
  return null;
}

const STAGE_ORDER = new Map([
  ['INVENTORY', 0], ['STRUCTURE', 1], ['BINDING', 2], ['COVERAGE', 3], ['PRECISION', 4],
]);

function semanticFinding(findings, stage, code, message, details = {}) {
  findings.push({ stage, code, message, ...details });
}

function validateSemanticShape(raw, semantic, findings) {
  if (semantic === undefined || semantic === null) {
    semanticFinding(findings, 'STRUCTURE', 'SEMANTIC_OUTPUT_ABSENT', 'No semantic observations were supplied.');
    return null;
  }
  if (semantic?.providerFailure === true || semantic?.status === 'provider_failure') {
    semanticFinding(findings, 'STRUCTURE', 'PROVIDER_FAILURE', 'The semantic provider failed before producing request bindings.');
    return null;
  }
  if (typeof semantic !== 'object' || Array.isArray(semantic) || !Array.isArray(semantic.issues)) {
    const legacy = typeof semantic === 'object' && semantic !== null
      && ('coverageEstablished' in semantic || 'topics' in semantic || semantic.schemaVersion === 'V2');
    semanticFinding(findings, 'STRUCTURE', legacy ? 'LEGACY_SCHEMA_INSUFFICIENT' : 'MALFORMED_SEMANTIC_OUTPUT', legacy
      ? 'Legacy coverage/topic fields do not contain binding descriptors, scope, and facets.'
      : 'Semantic output must have an issues array of binding observations.');
    return null;
  }

  let malformed = false;
  const ids = new Set();
  for (const issue of semantic.issues) {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)
      || typeof issue.id !== 'string' || issue.id.trim() === ''
      || !Array.isArray(issue.bindings)) {
      semanticFinding(findings, 'STRUCTURE', 'MALFORMED_ISSUE', 'Each issue needs a nonempty ID and a bindings array.');
      malformed = true;
      continue;
    }
    if (ids.has(issue.id)) {
      semanticFinding(findings, 'STRUCTURE', 'DUPLICATE_ISSUE_ID', `Issue ID ${issue.id} is duplicated.`, { issueId: issue.id });
      malformed = true;
    }
    ids.add(issue.id);
    for (const binding of issue.bindings) {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)
        || typeof binding.outcomeId !== 'string'
        || !binding.span || typeof binding.span !== 'object' || Array.isArray(binding.span)
        || !Number.isInteger(binding.span.start) || !Number.isInteger(binding.span.end)
        || typeof binding.subjectText !== 'string'
        || typeof binding.population !== 'string'
        || typeof binding.operation !== 'string'
        || typeof binding.scope !== 'string'
        || !Array.isArray(binding.facets)) {
        semanticFinding(findings, 'STRUCTURE', 'MALFORMED_BINDING', `Issue ${issue.id} has a binding with missing or invalid fields.`, { issueId: issue.id });
        malformed = true;
        continue;
      }
      if (binding.span.start < 0 || binding.span.end <= binding.span.start || binding.span.end > raw.length) {
        semanticFinding(findings, 'STRUCTURE', 'INVALID_SPAN', `Issue ${issue.id} has an out-of-range half-open span.`, { issueId: issue.id, span: binding.span });
        malformed = true;
      }
      if (binding.subjectText.length > 160 || normalizeSubjectText(binding.subjectText) === normalizeSubjectText(raw)) {
        semanticFinding(findings, 'STRUCTURE', 'INVALID_SUBJECT_TEXT', `Issue ${issue.id} must use bounded subject text, not the whole question.`, { issueId: issue.id });
        malformed = true;
      }
      if (!OPERATIONS.has(binding.operation) || !POPULATIONS.has(binding.population) || !SCOPES.has(binding.scope)) {
        semanticFinding(findings, 'STRUCTURE', 'INVALID_DIMENSION_VALUE', `Issue ${issue.id} has an unsupported operation, population, or scope value.`, { issueId: issue.id });
        malformed = true;
      }
      if (binding.facets.some((facet) => typeof facet !== 'string' || !FACETS.has(facet))) {
        semanticFinding(findings, 'STRUCTURE', 'INVALID_FACET_VALUE', `Issue ${issue.id} has an unsupported facet value.`, { issueId: issue.id });
        malformed = true;
      }
    }
  }
  return malformed ? null : semantic.issues;
}

function isSpanContained(span, outcomeDescriptor) {
  return outcomeDescriptor.requestSpans.some((requestSpan) => span.start >= requestSpan.start && span.end <= requestSpan.end);
}

function compareRepresentation(raw, inventory, issues, findings) {
  if (!issues) return;
  const covered = new Map(inventory.outcomes.map((o) => [o.id, new Map()]));
  const represented = new Map(inventory.outcomes.map((o) => [o.id, new Set()]));
  const seenDescriptors = new Set();
  const seenCoreOutcomes = new Set();
  let boundIssueCount = 0;

  for (const issue of issues) {
    if (issue.bindings.length > 0) boundIssueCount += 1;
    for (const binding of issue.bindings) {
      const requested = inventory.outcomes.find((o) => o.id === binding.outcomeId);
      if (!requested) {
        semanticFinding(findings, 'BINDING', 'UNKNOWN_OUTCOME_BINDING', `Issue ${issue.id} claims unknown outcome ${binding.outcomeId}.`, { issueId: issue.id, outcomeId: binding.outcomeId });
        continue;
      }
      if (!isSpanContained(binding.span, requested)) {
        semanticFinding(findings, 'BINDING', 'SPAN_OUTSIDE_REQUEST', `Issue ${issue.id} binding span is not contained in outcome ${requested.id}'s request span.`, { issueId: issue.id, outcomeId: requested.id, span: binding.span });
      }
      const observedSubject = identifySubject(binding.subjectText);
      const dimensionMismatches = [];
      if (observedSubject?.identity !== requested.subject.identity) dimensionMismatches.push('subject');
      if (binding.operation !== requested.operation) dimensionMismatches.push('operation');
      if (binding.population !== requested.population) dimensionMismatches.push('population');
      if (binding.scope !== requested.scope) dimensionMismatches.push('scope');
      if (observedSubject?.population && observedSubject.population !== binding.population) dimensionMismatches.push('subject_population');
      if (observedSubject?.populations && !observedSubject.populations.includes(binding.population)) dimensionMismatches.push('subject_population');
      if (observedSubject?.facets?.some((facet) => !binding.facets.includes(facet))) dimensionMismatches.push('subject_qualification');
      if (dimensionMismatches.length) {
        semanticFinding(findings, 'BINDING', 'DIMENSION_MISMATCH', `Issue ${issue.id} does not match ${requested.id} on ${dimensionMismatches.join(', ')}.`, { issueId: issue.id, outcomeId: requested.id, dimensions: dimensionMismatches, observedIdentity: observedSubject?.identity ?? null });
      }

      const spanContained = isSpanContained(binding.span, requested);
      const dimensionallyValid = dimensionMismatches.length === 0 && spanContained;
      if (dimensionallyValid && requested.facets.length === 0 && binding.facets.length === 0) {
        if (seenCoreOutcomes.has(requested.id)) {
          semanticFinding(findings, 'PRECISION', 'DUPLICATE_CORE_BINDING', `Outcome ${requested.id} is represented by redundant core bindings.`, { issueId: issue.id, outcomeId: requested.id });
        } else {
          seenCoreOutcomes.add(requested.id);
          represented.get(requested.id).add(issue.id);
        }
      }

      const outcomeCoverage = covered.get(requested.id);
      for (const facet of binding.facets) {
        if (!requested.facets.includes(facet)) {
          semanticFinding(findings, 'PRECISION', 'UNREQUESTED_FACET', `Issue ${issue.id} represents ${facet}, which outcome ${requested.id} did not request.`, { issueId: issue.id, outcomeId: requested.id, facet });
          continue;
        }
        if (!dimensionallyValid) continue;
        const descriptorKey = `${requested.id}\u0000${facet}`;
        if (seenDescriptors.has(descriptorKey)) {
          semanticFinding(findings, 'PRECISION', 'DUPLICATE_FACET_REPRESENTATION', `Outcome ${requested.id} facet ${facet} is represented more than once.`, { issueId: issue.id, outcomeId: requested.id, facet });
          continue;
        }
        seenDescriptors.add(descriptorKey);
        outcomeCoverage.set(facet, issue.id);
      }
      if (binding.facets.length === 0 && requested.facets.length > 0) {
        semanticFinding(findings, 'COVERAGE', 'EMPTY_FACET_BINDING', `Issue ${issue.id} binds ${requested.id} without representing a required facet.`, { issueId: issue.id, outcomeId: requested.id });
      }
    }
  }

  for (const requested of inventory.outcomes) {
    const facets = covered.get(requested.id);
    for (const facet of requested.facets) {
      if (!facets.has(facet)) {
        semanticFinding(findings, 'COVERAGE', 'MISSING_FACET', `Outcome ${requested.id} is missing required facet ${facet}.`, { outcomeId: requested.id, facet });
      }
    }
    if ((requested.facets.length > 0 && facets.size === 0)
      || (requested.facets.length === 0 && represented.get(requested.id).size === 0)) {
      semanticFinding(findings, 'COVERAGE', 'MISSING_OUTCOME', `Outcome ${requested.id} has no validly represented facets.`, { outcomeId: requested.id });
    }
  }

  const emptyIssues = issues.filter((issue) => issue.bindings.length === 0);
  for (const issue of emptyIssues) {
    semanticFinding(findings, 'COVERAGE', 'EMPTY_ISSUE_BINDINGS', `Issue ${issue.id} has no outcome binding.`, { issueId: issue.id });
  }
  // Any descriptor with no validated facet coverage is an extra semantic issue.
  for (const issue of issues) {
    const contributes = issue.bindings.some((binding) => {
      const target = covered.get(binding.outcomeId);
      return (target && [...target.values()].includes(issue.id))
        || represented.get(binding.outcomeId)?.has(issue.id);
    });
    if (issue.bindings.length > 0 && !contributes) {
      semanticFinding(findings, 'PRECISION', 'UNSUPPORTED_EXTRA_ISSUE', `Issue ${issue.id} does not contribute a valid requested facet.`, { issueId: issue.id });
    }
  }
}

/**
 * Evaluate request representation independently from support, application,
 * source authority, confidence, or routing metadata. The optional third
 * argument is deliberately ignored so routing changes cannot affect results.
 */
export function evaluateRepresentation(raw, semantic, _routingMetadata = undefined) {
  const inventory = parseQuestion(raw);
  const findings = [...inventory.findings];
  const safeRaw = typeof raw === 'string' ? raw : '';
  const issues = validateSemanticShape(safeRaw, semantic, findings);
  compareRepresentation(safeRaw, inventory, issues, findings);
  findings.sort((a, b) => (STAGE_ORDER.get(a.stage) ?? 99) - (STAGE_ORDER.get(b.stage) ?? 99));

  let status = 'COMPLETE';
  if (inventory.state === 'UNCERTAIN' || findings.some((f) => f.stage === 'STRUCTURE')) {
    status = 'UNCERTAIN';
  } else if (findings.length > 0) {
    status = 'INCOMPLETE';
  }
  return {
    status,
    inventory,
    findings,
    primaryFinding: findings[0] ?? null,
  };
}

export const boundedGrammar = Object.freeze({
  maxInputUnits: MAX_INPUT_UNITS,
  maxOutcomes: MAX_OUTCOMES,
  operations: [...OPERATIONS],
  populations: [...POPULATIONS],
  scopes: [...SCOPES],
  facets: [...FACETS],
  requestProductions: PRODUCTIONS.map(({ name }) => name),
  contextProductions: CONTEXT_PRODUCTIONS.map(({ kind }) => kind),
});
