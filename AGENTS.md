# AGENTS.md

## Project purpose

This repository is an IFRS and Singapore SFRS(I) accounting assistant.

Its primary responsibility is to convert natural-language accounting scenarios into:
- technically correct accounting treatment;
- balanced double-entry journal entries;
- appropriate Singapore statutory and accounting-standard references;
- clear explanations suitable for accountants and business users.

Accounting correctness, source reliability, and preservation of existing working behaviour take priority over cosmetic refactoring.

---

## Working approach

When handling a task:

1. Read the files explicitly named in the task first.
2. Inspect only directly related imports, callers, tests, and types as necessary.
3. Do not recursively read the entire repository unless the task genuinely requires it.
4. Prefer the smallest change that correctly solves the problem.
5. Do not refactor unrelated code while fixing a specific issue.
6. Preserve existing architecture and conventions unless there is a clear reason to change them.
7. Before modifying a shared function, check its callers and relevant regression tests.
8. Reuse existing utilities, types, registries, and accounting rules before creating new abstractions.
9. Do not duplicate accounting or statutory rules that already exist elsewhere in the repository.

For narrow tasks, remain narrow.

---

## Repository map

Use this map to decide what context is relevant.

### Core accounting logic

`src/engine/`

Contains accounting calculations, scenario parsing, journal generation, guardrails, projections, response assembly, and specialist accounting logic.

Important files include:

- `accountingEngine.ts`
  - core journal-entry and accounting calculations;
- `accountingGuardrails.ts`
  - accounting validation and safety checks;
- `scenarioParser.ts`
  - natural-language transaction interpretation;
- `projectionBuilder.ts`
  - derived accounting/projected information;
- `responseAssembler.ts`
  - final accounting response construction;
- `shareTransferEngine.ts`
  - share-transfer calculations;
- `shareTransferQuery.ts`
  - share-transfer query handling.

Do not modify `scenarioParser.ts` casually. It is large and affects many transaction types.

When changing parsing behaviour, first determine whether the issue belongs in:
- parsing;
- classification;
- accounting rules;
- accounting calculation;
- response assembly;
- verification.

Avoid solving every issue by adding another parser special case.

### Accounting standards and statutory sources

`src/standards/`

This is the source-governance and accounting-rules layer.

Relevant files include:

- `approvedSourceRegistry.ts`
- `coverageRegistry.ts`
- `semanticAccountingRules.ts`
- `singaporeStatutesKnowledge.ts`
- `sourceFreshnessManager.ts`
- `sourceVersioning.ts`
- `standardsKnowledge.ts`
- `unifiedSourceModel.ts`
- `statutes/`

Use this layer for authoritative accounting, tax, and regulatory knowledge.

Do not hard-code statutory guidance inside UI components.

Do not invent paragraph numbers, regulatory requirements, tax rates, filing rules, or accounting citations.

When adding or changing a statutory rule, first check whether an existing registry or statute module is the correct location.

### Classification

`src/classification/`

Use for determining what type of accounting or regulatory question/transaction is being handled.

Keep classification separate from accounting measurement where practical.

### Retrieval

`src/retrieval/`

Use for retrieving relevant standards, statutory materials, and supporting knowledge.

Do not bypass the established retrieval/source-governance system by embedding large reference texts directly into prompts or components.

### Verification

`src/verification/`

Use for independent checks and validation.

Accounting outputs should be verified rather than merely assumed correct.

### Services

`src/services/`

Contains external API/service integrations, including AI/model and foreign-exchange services.

Keep external API concerns separate from deterministic accounting logic.

Do not move core accounting calculations into model prompts when they can be calculated deterministically.

### Components

`src/components/`

React UI components.

UI components should primarily present state and results.

Avoid embedding accounting rules, statutory rules, substantial parsing logic, or calculation logic directly in components.

### Types

`src/types/`

Shared TypeScript contracts.

Prefer existing accounting types before introducing overlapping interfaces.

### Utilities

`src/utils/`

General reusable helpers.

Do not place accounting-policy decisions in generic utility modules.

---

## Accounting correctness

Accounting functionality is high-risk functionality.

For any change affecting accounting output:

- preserve double-entry balance;
- verify total debits equal total credits;
- distinguish recognition, measurement, presentation, and disclosure issues;
- distinguish accounting treatment from tax treatment;
- distinguish IFRS/SFRS(I) requirements from Singapore statutory or tax requirements;
- do not silently assume missing material facts;
- do not manufacture accounting-standard citations;
- preserve appropriate debit/credit direction;
- preserve dates, currencies, tax treatment, and measurement bases;
- consider whether the change affects prior supported scenarios.

Where a transaction is ambiguous, prefer identifying the missing assumption rather than fabricating one.

Never alter accounting logic merely to make a test pass if doing so makes the accounting treatment incorrect.

---

## Singapore conventions

This application is Singapore-focused.

Unless the scenario explicitly requires something else:

- functional/presentation currency assumptions should remain consistent with the application's existing SGD behaviour;
- user-facing dates should follow `DD/MM/YYYY`;
- Singapore GST handling must follow the project's existing IRAS/statutory rules;
- SFRS(I) treatment should remain aligned with the corresponding IFRS framework where applicable.

Do not assume that every transaction is subject to GST.

Do not apply a GST rate merely because an amount is Singapore-based. Determine whether the transaction is taxable, exempt, zero-rated, out-of-scope, or otherwise treated under the relevant rules.

Do not change statutory rates or regulatory logic without corresponding authoritative-source changes and tests.

---

## Monetary calculations

Avoid introducing floating-point inaccuracies into accounting calculations.

Follow the repository's existing rounding and monetary-calculation conventions.

For monetary changes, explicitly consider:

- currency precision;
- rounding;
- tax rounding;
- foreign-exchange conversion;
- present-value calculations;
- depreciation/amortisation;
- gain/loss calculations;
- accumulated balances;
- debit/credit equality.

Do not apply arbitrary rounding merely to force journals to balance.

If a rounding adjustment is required, make the treatment explicit and consistent.

---

## Accounting standards and citations

Supported accounting frameworks include IFRS and Singapore SFRS(I).

Relevant topics already include areas such as:

- IAS 1 / SFRS(I) 1-1;
- IAS 16 / SFRS(I) 1-16;
- IAS 21 / SFRS(I) 1-21;
- IFRS 9 / SFRS(I) 9;
- IFRS 16 / SFRS(I) 16;
- Singapore GST and other Singapore statutory sources.

Before adding a new accounting citation:

1. check the existing standards knowledgebase;
2. check the approved-source registry;
3. use the existing source model where possible;
4. avoid duplicating the same rule in multiple locations.

Treat a citation as factual data, not decorative text.

If the authoritative source does not support a paragraph reference, do not invent one.

---

## Deterministic logic vs AI

Prefer deterministic code for:

- arithmetic;
- double-entry construction;
- balance validation;
- depreciation;
- amortisation;
- present-value calculations;
- FX arithmetic;
- GST calculations;
- classification rules that can be expressed reliably;
- validation.

Use AI/model calls primarily where natural-language interpretation or explanation genuinely benefits from them.

Do not rely on the model to perform calculations already implemented by the accounting engine.

Model output must not override deterministic accounting guardrails without explicit validation.

---

## Source reliability

For accounting, statutory, regulatory, or tax information:

Prefer authoritative sources already recognised by the repository, such as:
- ACRA / Accounting and Corporate Regulatory Authority;
- Singapore accounting-standard authorities;
- IRAS;
- MAS;
- CPF Board;
- MOM;
- IFRS Foundation / IASB;
- other first-party government or standard-setting sources represented in the repository.

Do not introduce blogs, SEO articles, forum posts, or AI-generated material as authoritative accounting rules when first-party guidance is available.

Where the project tracks source freshness/versioning, preserve that mechanism.

---

## Existing supported behaviour

The application already supports multiple accounting scenarios, including:

- asset purchases;
- trade discounts;
- machinery/equipment disposals and trade-ins;
- financing;
- leases and ROU accounting;
- foreign-currency transactions;
- investments;
- operating expenses;
- Singapore GST;
- share transfers and related queries.

When modifying shared accounting/parser code, assume that apparently unrelated scenarios may be affected.

Prefer regression coverage over broad rewrites.

---

## Tests

Tests are organised under:

- `tests/regression/`
- `tests/integration/`
- `tests/fixtures/`

### During development

Run the smallest relevant test first.

For normal accounting changes, use:

```bash
npm run test:smoke
```

before running the complete suite.

### Before considering a substantive accounting change complete

Run:

```bash
npm run lint
npm run build
npm run test:smoke
```

For broad accounting-engine, parser, standards, source, or retrieval changes, also run:

```bash
npm test
```

Use:

```bash
npm run test:integration
```

only when the change concerns live external-source/service behaviour or when specifically relevant.

Do not repeatedly run the full test suite while making a small localized change when a targeted/smoke test is sufficient.

---

## Regression tests

When fixing a bug:

1. understand the incorrect behaviour;
2. identify the correct accounting treatment;
3. add or update a regression test where practical;
4. make the smallest implementation change;
5. run the relevant test;
6. run the smoke suite;
7. check for regressions in adjacent scenarios.

A regression test should represent the accounting requirement, not merely mirror the current implementation.

---

## TypeScript and React

The project uses:
- React 19;
- TypeScript;
- Vite;
- Tailwind CSS;
- Node.js 22.

Preserve strict TypeScript compatibility.

Prefer:
- typed data structures;
- existing shared interfaces;
- pure functions for accounting calculations;
- small focused helpers;
- explicit return types where useful for accounting-domain logic.

Avoid:
- `any` unless genuinely unavoidable;
- unnecessary type assertions;
- duplicated state;
- large new dependencies for problems that can be solved locally;
- moving deterministic accounting logic into React components.

---

## UI changes

For UI-only tasks:

Start with the explicitly named component and its immediate dependencies.

Do not inspect or modify accounting-engine code unless the UI behaviour requires it.

Preserve:
- existing responsive behaviour;
- accessibility;
- font scaling;
- established Tailwind conventions;
- existing accounting terminology.

Do not simplify accounting labels merely for aesthetic reasons if doing so changes their meaning.

---

## External services

Changes to external APIs must account for:

- failure;
- timeout;
- malformed responses;
- unavailable services;
- quota limits;
- missing environment variables.

Never hard-code API keys, tokens, secrets, private endpoints, or credentials.

Do not expose secrets through `VITE_*` environment variables unless they are intentionally public client-side configuration.

Keep `.env.example` safe for version control.

---

## Foreign exchange

The application uses external FX data.

When changing FX functionality:

- distinguish transaction-date rates from closing rates and other required rates;
- preserve currency direction carefully;
- do not silently invert a rate;
- keep external-rate retrieval separate from accounting treatment;
- account for API failure;
- test conversion arithmetic.

Do not assume that an available current spot rate is appropriate for a historical accounting transaction.

---

## Performance and context efficiency

Codex should minimise unnecessary context usage.

For each task:

- start from named files;
- use targeted searches;
- inspect imports/callers only as needed;
- avoid opening generated files, dependency trees, lockfiles, large fixtures, or unrelated modules unless required;
- do not reread files already understood unless they changed;
- avoid dumping large files into context when a targeted section/search is sufficient.

Large files such as `src/engine/scenarioParser.ts` should be searched for relevant functions/terms before reading broad sections.

Do not traverse `node_modules`, build output, or generated artifacts.

---

## Dependencies

Do not add a dependency unless it provides clear value that cannot reasonably be achieved with existing dependencies or platform APIs.

If a dependency is added:
- explain why;
- use a maintained package;
- avoid unnecessary runtime dependencies;
- update the lockfile consistently.

Do not manually edit `package-lock.json` except as the result of normal npm dependency operations.

---

## Scope control

Unless specifically requested, do not:

- redesign the entire application;
- rename large numbers of files;
- reformat unrelated files;
- replace the accounting architecture;
- change supported accounting treatment;
- change regulatory/statutory content;
- change AI providers;
- introduce a database;
- introduce a backend;
- alter deployment configuration;
- remove existing tests;
- weaken validation or accounting guardrails.

When a task reveals a larger architectural issue, solve the requested problem first and mention the broader issue separately.

---

## Changes to accounting rules

Before modifying an accounting rule, determine which layer owns the behaviour:

- interpretation → parser/classification;
- accounting principle → standards/rules;
- numerical measurement → engine;
- statutory authority/source → standards/statutes;
- supporting evidence retrieval → retrieval;
- validation → verification/guardrails;
- presentation → response assembler/components.

Put the fix at the lowest correct layer.

Do not compensate for an upstream accounting error by patching the displayed output downstream.

---

## Response expectations when completing a task

After making changes, report concisely:

- what was changed;
- why;
- files changed;
- tests/checks run;
- any unresolved accounting or technical assumptions.

Do not provide a long walkthrough unless requested.

If tests fail for reasons unrelated to the change, identify that separately rather than silently modifying unrelated code.

---

## Definition of done

A change is complete when:

- the requested behaviour works;
- accounting treatment remains correct;
- debits and credits remain balanced where applicable;
- TypeScript builds;
- relevant tests pass;
- no unrelated behaviour was intentionally changed;
- source/citation integrity is preserved;
- no secrets or sensitive configuration were introduced;
- the implementation remains consistent with the existing architecture.

For accounting-domain changes, correctness takes precedence over cleverness.