# Multi-authority architecture checkpoint

## Repository and scope

- Baseline: `main` at `67511a886402c2f3746e713e2e3227d5ec406828`.
- Branch: `codex/multi-authority-workstreams`.
- Earlier semantic issue checkpoint: `df46501`.
- The latest commit on this branch contains the reviewed runtime, retrieval,
  coverage, presentation, and evaluation implementation described below.
- Preserve the existing IRAS routing, source, and requested-concept safeguards.
- The user requested a safe wrap-up around 7% remaining in either usage window.
  This implementation cycle finished above that threshold; stop when complete,
  and do not spend remaining usage on optional authority expansion.

## Completed

1. Validated semantic material issues and deterministic original-query mapping,
   with explicit unknown/omitted residuals and safe taxonomy fallback.
2. Authority/domain workstream planning with governing vs contextual authorities,
   population vs source section, and publisher vs governor kept separate.
3. Independent issue retrieval, evidence admission, verified claims, lifecycle
   flags, and whole-question coverage/application statuses.
4. IRAS adapter uses the existing scoped grounding and discovery pipeline.
   Non-IRAS adapters admit eligible canonical reviewed local evidence only.
5. Runtime integration preserves deterministic accounting and balanced journals;
   standalone statutory plans do not invent payroll journals.
6. Fresh whole-question projection shared by chat, input preview, and the
   Statutory Compliance & Legal Authority panel, with sources and explicit gaps.
7. Regression and four-case architecture evaluation; detailed implementation
   report: `docs/multi_authority_workstreams_report.md`.

## Verification

All final code checks used Node 22.23.1:

- Preflight, lint, TypeScript build, production build: passed.
- Focused core and presentation/runtime regressions: passed.
- Smoke: 45/45 suites passed.
- Full regression: 65/65 suites passed.
- Existing 36-case oracle: 36/36 authority/domain/scope/missing-fact checks.
- Existing eight-case adversarial oracle: 8/8 routing plus presentation checks.
- New four-case oracle: all expected workstream sets passed; all whole questions
  correctly remained incomplete with current mapping/evidence coverage.
- Public official-source case A: IRAS CPF Relief verified through a fetched
  official page; CPF contribution evidence incomplete; overall incomplete.
- Independent reviewer: no remaining material production findings.
- No live Gemini evaluation: `GEMINI_API_KEY` unavailable. Oracle input does not
  measure live-model understanding.

The earlier semantic rerun approval blocker is resolved. Final regression runs
used an imported fetch guard, with mocked requests in the test suites. No model
requests were made during offline validation. Build/lint retain existing warnings.

## Limitations to preserve honestly

- No new statutory rates or authoritative source records were added/promoted.
- CPF rate record `CPF_RATES_BY_AGE_2026` remains `NEEDS_REVIEW` and is rejected.
- CPF/MOM/ACRA/MAS/accounting evidence coverage remains limited; their initial
  adapters do not implement live discovery.
- Exact C/D questions remain unmapped by the independent taxonomy.
- Exact B without a model resolves only CPF; runtime shows the known scope and
  whole-question residual, without inventing missing MOM/IRAS issues.
- Case facts/application policy remains conservative and partly question-level.
- Single-area IRAS and image requests retain their established migration paths.
- Relationship explanations from an answer model are not enabled; responses
  combine verified passages and gaps deterministically.
- Explicit simulation-reference-date parity with the shared claim verifier is
  incomplete. Production defaults use the current date.

## Next continuation

Read this checkpoint and the report first; inspect `git status` and the latest
commit. Do not repeat the finished implementation or unaffected passing checks.
No unfinished builder work remains.

Possible subsequent phases require a new scoped plan: improve independently
supported mappings for unresolved questions, add reviewed authority coverage or
bounded non-IRAS discovery, and evaluate live semantic understanding when a
provider key is available. Apply supervisor -> builder -> reviewer -> supervisor
workflow, preserving current gates and marking gaps honestly.

## Host runtime / offline reproduction

- Git: `C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe`.
- Node: `C:\Users\Admin\AppData\Local\node-v22.23.1-win-x64\node.exe`.
- npm: `C:\Users\Admin\AppData\Local\node-v22.23.1-win-x64\npm.cmd`.
- Prefix PATH with the Node directory. These executables may need sandbox
  escalation on this host; `.git` mutations also require escalation.
- Offline guard in TEMP: `accounting-offline-fetch-guard.mjs`, containing:

```js
globalThis.fetch = async () => { throw new Error('Network disabled for offline regression validation'); };
```

Use its absolute **file URI**, not a raw Windows path, in Node's `--import`.
Set process `NODE_OPTIONS=--import=<file URI>` for smoke/full runners so spawned
test children inherit it. Recreate the temporary guard if absent. Do not apply
the guard to a deliberately requested live-source probe.

Evaluation artifacts: `docs/evaluation/multi-authority-workstreams/`,
`docs/evaluation/semantic-question-understanding/oracle-evaluation.json`, and
`docs/evaluation/semantic-question-adversarial/oracle-evaluation.json`.
Ignored `.workstreams-*.log` files contain validation output on this checkout.
