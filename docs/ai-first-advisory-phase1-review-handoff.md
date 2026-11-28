# Phase 1 review handoff — 03/11/2026

## Goal and status

Deliver the AI-first advisory foundation on a dedicated branch, preserving specialist accounting and evidence workflows. Phase 1 is implemented and locally verified. This is a bounded conceptual/explanatory path, not completion of the full strategic pivot or production acceptance. No merge, deployment, source activation or live-provider evaluation was performed.

## Exact review target

- Repository: https://github.com/dexrrick/accounting
- Feature branch: `codex/ai-first-advisory-phase1-20261103`
- Implementation commit: `712bc0450f0707e4511b4114ce47d05907837684`
- Base: `863daf4299540ed0a50d808b07c1ee0e617b284b` on `codex/statutory-knowledge-expansion-20261030`, verified against the remote before development.
- Diff: https://github.com/dexrrick/accounting/compare/863daf4299540ed0a50d808b07c1ee0e617b284b...712bc0450f0707e4511b4114ce47d05907837684
- No PR. A subsequent documentation-only commit adds this handoff; inspect the implementation SHA above for the tested code.

## Changes and decisions

`aiFirstAdvisory.ts` provides a provider-neutral substantial explanation contract through the existing Gemini/OpenAI/Azure transport. Eligible questions enter before legacy advisory early returns. The complete question, recent full answers, extractive older context, active facts and bounded local source records reach one generation call. Context is token-estimated and bounded; the current question is never silently sliced.

`geminiService.ts` integrates routing and an offline fallback without repeating provider generation after failure. Advisory output cannot introduce journal state. Exact calculations, journal/state changes, definitive statutory applications, material deadlines and certain source-governed rule requests retain existing workflows. Numeric/provision/posting and categorical applicability assertions are withheld from conceptual output.

`App.tsx`, `ChatPanel.tsx`, `SafeChatAnswer.tsx` and shared message types display full advisory answers. The renderer uses escaped React text and a limited Markdown subset, with links bound to admitted canonical source URLs. Source IDs establish related guidance, not independent proof of model assertions. Existing panels remain available. No engine, source registry, dependency, transport security or deployment configuration was changed.

## Verification

- Node 22 preflight, maintained-code lint, TypeScript, Vite and Worker builds: passed.
- Final exact-tree full regression: **185/185 passed**, including all **162 smoke suites**.
- Focused mocked Gemini, Azure and OpenAI production-path tests, source-ID/link tests, unsafe-markup rendering, history, malformed output and fallback tests: passed.
- Interim smoke: 160/162; the two routing regressions were investigated, corrected and passed individually and in the final full run. Existing expectations were preserved.
- Independent reviewer reproduced two routing/applicability blockers plus Unicode/history issues. Targeted fixes and re-review resolved the reported probes. Supervisor reviewed integration and captured identical-question examples.
- Root lint was run and failed with **34 pre-existing errors** in archived/local artifact copies. Maintained-code lint passed; unrelated files were not repaired.
- Commands used the Node 22 executables directly because npm was unavailable in this shell. Normal Windows access was necessary for Node user-profile access; no user-profile shim was used.
- No live model, browser acceptance, frozen-corpus answer-quality grading, live integration, CI dispatch or production verification. CI's push trigger excludes this feature branch.

## Examples, context and evidence

All examples are **mocked routing/rendering evidence**, not live answer-quality or cost measurements. For the identical accrual-versus-cash question, the old compact directive becomes a full explanation/application response; mocked provider calls decrease from three to one. For the identical GST input/output-tax question, the old evidence-insufficiency response becomes a conceptual explanation with conditions; the injected exact rate/deadline is withheld. Captured requests contain the current question once and the earlier full answer. Input bodies measured 2,977 and 2,995 characters; these are not billed token counts.

- [Architecture assessment](ai-first-advisory-phase1-assessment.md)
- [Identical-question examples and context assertions](../artifacts/ai-first-advisory-phase1-20261103/before-after-examples.json)
- [Baseline capture](../artifacts/ai-first-advisory-phase1-20261103/baseline-examples.json)
- [Final validation results](../artifacts/ai-first-advisory-phase1-20261103/final/validation-results.json)
- [Reproduction script](../artifacts/ai-first-advisory-phase1-20261103/validate.ps1)

## Limitations and Phase 2

Risk filtering is heuristic: it does not independently verify arbitrary qualitative claims or semantic contradictions. Keep the bounded eligibility policy until claim-level grounding, contradiction checks and historical applicability verification are integrated. Local-only retrieval can leave gaps. Exact numeric assertions are withheld rather than independently certified by this new path. Older extractive context can omit material details; oversized total contexts fall back offline. Live answer completeness, factual accuracy, latency, token usage and cost remain unmeasured; existing telemetry zeros must not be read as zero model cost. Full legacy chat/panel redesign, journal-table Markdown and streaming remain later work.

Next: connect issue/claim-level evidence to coherent synthesis, then independently evaluate real multi-authority and multi-turn answers against substantive frozen-corpus outcomes. Do not weaken preserved safeguards to broaden eligibility.

No implementation changes remain uncommitted. Unrelated pre-existing untracked artifacts and ignored local validation logs remain outside GitHub; no secrets or credentials were committed. Review should focus on advisory eligibility, state preservation, contextual omissions, source relevance versus identity, heuristic false negatives and safe rendering.

## Ready-to-copy review prompt

Independently review the changes identified above in https://github.com/dexrrick/accounting on `codex/ai-first-advisory-phase1-20261103`, implementation commit `712bc0450f0707e4511b4114ce47d05907837684`, relative to `863daf4299540ed0a50d808b07c1ee0e617b284b`, using your GitHub access. Confirm the exact commit you inspected. Use the handoff as context and verify its claims against the code, diff, tests, and available CI evidence. Report actionable findings with severity, file and line references, impact, and suggested fixes. State any access or verification limitations. Keep the review read-only.
