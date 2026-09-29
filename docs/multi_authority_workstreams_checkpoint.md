# Multi-authority architecture checkpoint

## Starting point

- `main` commit: `67511a886402c2f3746e713e2e3227d5ec406828`.
- Working branch: `codex/multi-authority-workstreams`.
- Scope: the user-supplied multi-authority architecture brief in the chat attachment.
- Do not undo the existing IRAS routing, retrieval, and concept-coverage fixes.

## State at this checkpoint

- Architecture mapped and implementation plan saved in
  `docs/multi_authority_workstreams_plan.md`.
- Baseline `npm run test:smoke` passed on Node 22.23.1 before implementation.
- Phase 1 is an additive per-issue semantic/reconciliation contract in
  `src/services/semanticQuestionUnderstanding.ts`, with focused regression in
  `tests/regression/test_material_issue_decomposition.mjs`.
- Initial focused test, legacy semantic regression, and TypeScript build passed.
- Independent review found gaps in omitted-issue detection, original-query
  corroboration, model-controlled evidence requirement, and fallback completeness.
  These guards were fixed and the reviewer confirmed them. A final fix now maps
  hint-free issues only when both issue wording and the original query resolve
  to the same topic, and checks CPF populations.
- After the main guard fixes, the focused regression, `npm run lint`, and
  `npm run build` passed on Node 22.23.1. Lint reported pre-existing warnings
  and one new unused variable warning; the latter was corrected. After the
  final hint/population fix, the focused regression, `tsc -b`, and
  `git diff --check` passed. The production build also passed after the final
  source edit, with Vite warnings about existing config imports and bundle size.
- Automatic approval review rejected a rerun of the existing semantic regression
  because it can send test queries to Gemini. The earlier baseline passed; no
  later rerun was made. Do not claim that final regression passed.
- No multi-authority retrieval, synthesis, response, or UI wiring is complete.
  Existing answer paths remain in use.
- Exact held-out case C remains unmapped because the independent query taxonomy
  does not recognize its housing-benefit topic. A-D tests are oracle/fixture
  contract checks, not live model evaluation.
- Per-issue interaction case specificity is not yet modeled; the current
  contract uses the validated question-level flag and can be conservative.

## Next safe steps

1. Review the final hint/population diff and re-run final validation as allowed.
   The semantic regression rerun requires resolution of the automatic approval
   block. Consider a per-issue case-specificity field in the next contract
   change if mixed case/general interactions need accurate status.
2. Add workstream/issue-coverage contracts and adapt IRAS without bypassing its
   existing evidence gate. A non-IRAS provider must fail closed; the current
   non-IRAS branch of `evaluateEvidenceQuality` is not an adequate coverage gate.
3. Integrate per-authority retrieval, whole-question status, verified synthesis,
   and presentation through `AccountingScenarioState`, `App`, chat preview,
   `InputHandlerPanel`, and `ComplianceRationale`.
4. Run the 36-case and 8-case evaluations, new A-D architecture evaluation,
   and the requested final validation. Report oracle and live-model results
   separately; `GEMINI_API_KEY` was absent in this session.

## Runtime

- Working Git: `C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe`.
- Required Node: `C:\Users\Admin\AppData\Local\node-v22.23.1-win-x64\node.exe`.
- Required npm: `C:\Users\Admin\AppData\Local\node-v22.23.1-win-x64\npm.cmd`.
- On this host, these executables may require sandbox escalation. Prefix PATH
  with the Node 22 directory before invoking npm scripts.
