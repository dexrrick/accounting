# Resume checkpoint — semantic wire contract V2

30/09/2026, `D:\Accounting`, branch `codex/multi-authority-workstreams`. Git HEAD remains `9450e98`; this cycle's reviewed implementation, tests and reports are saved as uncommitted working-tree changes. Resume from this working tree. Do not reset/replay the base commit over the changes. No merge, push, deployment, automation or further live work is active or scheduled.

**HOLD MERGE.** Two known operation-intent errors and one timed-out conceptual case remain, despite reviewed contract fixes and passing local checks.

## Read first

1. `semantic-contract-v2-audit.md` — implementation boundary, review resolutions, file list, historical comparison, final denominators and remaining failures.
2. `semantic-contract-followup-v2-live.md` and `.json` — immutable once-only ten-case results with safe field diagnostics.
3. `contract-followup-comparable-baseline.json` — fixed five-case historical comparison.
4. `src/services/semanticQuestionUnderstanding.ts` and the new `test_semantic_wire_contract.mjs`.

Earlier contract/operation audits, checkpoints, frozen fixtures, diagnostic reports and protected manifests remain unchanged.

## Completed and verified

- Exact V2 wire contract (`schemaVersion: 2`) omits `calculationRequested`, requires 1–12 issues and derives the internal top flag solely from top-level CALCULATE.
- Valid legacy/unversioned responses remain supported; malformed keys/concepts and contradictory legacy flags remain rejected. Existing internal callers retain their shape.
- Explicit concept keys/nonempty safe examples and generic operation-intent guidance; no keyword replacement or fixture-specific phrase patch.
- Independent builder implementation and reviewer clearance. Reviewer findings about diagnostic codes, application/evidence separation, grouped denominators and missing regression cases were resolved before live calls.
- Node.js 22.23.1 targeted semantic/contract/privacy/routing checks, lint, production build, smoke 52/52, full 72/72 and `git diff --check` pass. Existing warnings remain. No semantic code changed after final tests/live measurement.
- Exactly ten Gemini requests, one per fixed case, no retries. Model `gemini-3.5-flash-lite`, unchanged 8,000 ms timeout, minimum observed start gap 17,013 ms. Nine valid V2 responses; one timeout; no invalid schema responses, low-confidence results, provider errors or 429s. No pre-change diagnostics were repeated.
- Safe outputs contain no prompts, provider bodies, submitted facts, labels, unknown property names, credentials or arbitrary errors. All source/fixture fingerprints remained stable during capture. Historical manifests match 12/12 and 7/7.

## Final metrics

| Measure | Five known failures | Five independent controls | Combined ten |
| --- | ---: | ---: | ---: |
| Valid interpretations | 4/5 | 5/5 | 9/10 |
| Issue recall (valid / all expected) | 7/7 / 7/8 | 6/6 / 6/6 | 13/13 / 13/14 |
| Issue precision | 7/7 | 6/6 | 13/13 |
| Matched-issue operation accuracy | 5/7 | 6/6 | 11/13 |
| Complete question issue coverage | 4/5 | 5/5 | 9/10 |
| Routing (valid / all cases) | 4/4 / 4/5 | 5/5 / 5/5 | 9/9 / 9/10 |
| Invalid responses | 0/5 | 0/5 | 0/10 |
| Timeouts | 1/5 | 0/5 | 1/10 |

All 72 runtime guard checks pass on the nine valid cases; the timeout is unassessed. All nine valid cases retain INSUFFICIENT evidence. Complete coverage is issue presence, not correct operations or substantive accounting answers. The independent reviewer verified final report integrity/privacy and also recommends HOLD MERGE. Historical known-failure results were 2/5 valid, 1/3 operation accuracy, 3/8 all-case issue recall, 2/5 complete coverage and 3/5 invalid responses. The controls have no comparable historical baseline. Different valid/matched denominators and the small selected sample prevent broad causal improvement claims.

## Remaining work and boundaries

- `A-paraphrase-2`: employer payable contribution still selects DETERMINE_TREATMENT instead of a numeric/accepted eligibility operation; personal relief selects DETERMINE_TREATMENT. The employer case-fact gate remains active, but numerical intent is missed.
- `adversarial-C-employee-benefit`: applied employee-benefit tax still selects EXPLAIN_RULE with source-only evidence and no case-specific flag. Routing is correct but does not correct the operation.
- `control-general-recognition`: new eight-second TIMEOUT, without a response body; the old concept-shape failure is unassessed after the fix.
- General interaction and mixed contribution/relief validate in this observation; the latter preserves two CALCULATE issues while top OTHER projects calculationRequested=false.
- All five independent controls pass, including illustrative amounts and mixed journal/calculation.

Do not rerun, overwrite, relabel or hide these once-only observations. Further generic semantic-intent reliability work needs a new scoped design and independent development controls, preserving routing, UNKNOWN population, fact gates and evidence safeguards. Do not broaden statutory/source coverage or insert deterministic keyword operation replacements. Retain eight seconds; the new timeout alone does not demonstrate that increasing the deadline fixes the semantic errors. Any deadline experiment is separate authorized work.

## Fingerprints, runtime and usage

- Interpreter SHA-256: `c152ecf2360ebc68fc4d6c5043e73e8dc2668cb5f342b983e07361549671de9a`.
- Final live JSON SHA-256: `58787adb4f69d4db922714154b1a4448fd55e2ee9186f03dff4bbb3f44337850`.
- Final live Markdown SHA-256: `cf0ea2da3f89006bf16570c7be90e35690a4bea075a26e745cd91ec2f59d3640`.
- Node: `C:\Users\Admin\AppData\Local\node-v22.23.1-win-x64\node.exe`, adjacent `npm.cmd`; put this directory first in PATH. It needs approved escalated execution in this sandbox. Run `.mjs` TypeScript-import tests through `node_modules/tsx/dist/cli.mjs`.
- Git: `C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe`; the default Git shim fails to locate GitHub Desktop Git.
- Validation logs: ignored `.tmp-ci/semantic-contract-v2-*.log`. Do not print ignored credentials; the live CLI uses `--env-file=.env.local`.
- Latest usage snapshot: 64% five-hour and 94% weekly remaining. Check current usage on resumption and stop before either remaining window falls below 7%. No reset credit was consumed.
