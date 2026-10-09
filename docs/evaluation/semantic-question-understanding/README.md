# Question understanding evaluation

The supervisor authored 36 questions separately from the builder's implementation and focused regression suite. The labels describe the requested authority, taxpayer population, operation, and need for case-specific facts. They do not state tax rules or conclusions.

`deterministic-baseline.json` was captured from the original classifier before its implementation changed. Under the final scoring rule its authority score is 25/36 and domain score is 27/36. An unknown taxpayer population must remain unresolved. Four misleading-substring cases produced vehicle missing facts.

Run with Node 22 from the repository root:

```powershell
node --import tsx tests/evaluation/singapore/semantic-question-evaluation.mjs
node --env-file=.env.local --import tsx tests/evaluation/singapore/semantic-question-evaluation.mjs --live --pace-ms=4500
node --import tsx tests/evaluation/singapore/semantic-question-evaluation.mjs --replay-from=docs/evaluation/semantic-question-understanding/live-evaluation.json
```

The default run injects independently labelled intent through the interpreter's structured transport seam. It evaluates schema admission, reconciliation, population-aware routing, missing facts, local retrieval, and the production evidence gate. It reports model extraction accuracy as **not measured**. Improved results in this mode prove that a correct interpretation can improve downstream routing; they do not prove that the configured model produces that interpretation.

`--live` requires `GEMINI_API_KEY` in the local environment. It measures actual interpreter output separately. Exact concept-label differences are flagged for manual synonym review rather than automatically declared incorrect. No credential values, hidden reasoning, model conclusions, or synthetic statutory evidence are written to the reports.

The live report saves validated intent objects and actual failure modes. Replay applies those same outputs, including deterministic fallback after timeouts, to the final routing code without another model call. Reports record runtime, source hashes and model identity; live timing excludes the evaluation's pacing delay. The replay does not measure fresh model reliability.

Both modes use existing local reviewed sources with external discovery unavailable. Final evidence coverage is therefore a separate reported outcome, including insufficient coverage. Successful intent routing must never imply that a statutory answer is supported. The Worker/browser-path validation is run separately for official-source transport.

The dimensions reported per case are semantic interpretation, authority, population, concepts, requested operation, missing-fact appropriateness, retrieval routing, and final evidence coverage. The model-dependent dimensions remain explicitly unmeasured in oracle mode.

Missing-fact scoring checks both directions: the independently labelled case-specific questions must retain a fact requirement, while conceptual questions must have no missing-fact requests. It also rejects irrelevant vehicle prompts. This measures the dependency policy rather than whether every individual fact is genuinely absent. Focused regressions separately cover a fully supplied GST meal case and an incomplete counterpart.

The captured live run used `gemini-3.5-flash-lite`: 34/36 valid interpretations, two timeouts with deterministic fallback, 26/36 strict composite intent matches, 33/36 population matches, and 32/36 operation matches. Authority routing was 36/36; domain/routing was 34/36 before the last guard corrections. Median interpreter latency was 1,152 ms and the 95th percentile reached the 8-second timeout. Provider success is therefore not assumed.

Replay through the final guards improves domain/routing to 35/36 while preserving all 36 authority decisions and the two captured failures. The remaining domain miss is the employer-clearance timeout. Raw intent scores remain unchanged. With independently labelled oracle intent, authority, domain, retrieval policy and fact-dependency scores are all 36/36; model understanding is explicitly not measured in that run.

`concept-review.json` supplements exact-label scoring with the supervisor's review: 26 questions have their subject meaning covered, eight have partial or conservative labels, and two have no model output. Conservative labels sometimes avoid naming a relief product that the question itself never explicitly identifies. Other partial outputs omit qualifiers such as standard-rated supply or transfer between accounts; the complete original question remains in retrieval and evidence validation. The inferred “blocked expenses” label on a car query is a retrieval term only and cannot establish a statutory conclusion.

Strict case-dependency scoring in the live snapshot was 30/36. Five questions describe their own circumstances but ask for conditions or filing obligations; the model treated them as general explanations. The remaining failure was an employer-tax-clearance timeout whose deterministic route lacks a specific domain. These labels remain visible rather than being rewritten to inflate the score. Intent accuracy does not authorize deciding those cases without verified evidence and applicable facts.

The live Worker/browser-path run successfully fetched and admitted official IRAS employment passages through the same-origin proxy. Its final assertion failed because those passages did not cover the entire overseas-income, treaty, credit and residency question. The application returned an insufficient-evidence response. The gate and source coverage were preserved; successful transport is not reported as successful answer coverage.

The implementation lives in `src/services/semanticQuestionUnderstanding.ts`, with integration in `geminiService.ts`, `groundingContextBuilder.ts`, `questionClassifier.ts`, and `sourceRetriever.ts`. Telemetry stores the allowlisted interpretation projection and redacts recognizable credential patterns, company names with legal suffixes, currency amounts, and dates. This is a bounded diagnostic sanitizer, not comprehensive personal-data anonymization. Original interpretation labels remain available to retrieval; they are never evidence.

## Final verification

On the final code, Node 22 lint, build, the focused semantic regression, smoke suite, full regression suite, and both evaluation modes pass. The last CPF refinement distinguishes a conceptual relationship involving contribution amounts payable from a separate request asking what the employer must pay; independent review found no actionable issue. Existing lint and bundle warnings remain.

The live Worker answer-coverage failure described above remains. Although official IRAS passages were fetched and admitted, they did not cover every aspect of the tested cross-border tax question. The response stayed within the insufficient-evidence gate. This evaluation verifies the semantic layer's behavior and preserved safeguards; it does not establish full live source coverage or production readiness for that question.
