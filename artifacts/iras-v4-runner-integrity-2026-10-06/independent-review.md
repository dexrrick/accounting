# Independent runner review — 06/10/2026

Reviewer `/root/v4_runner_review` reviewed the initial completed runner and regression read-only. Initial freeze was held pending corrections and independent re-review. Final focused signoff closes all seven findings; the bounded safeguards are ready for supervisor commit, binding verification and runner-configuration freeze. The reviewer verified the supplied source/log hashes and used network-free targeted probes rather than repeating the passing regression.

Reviewed runner SHA-256: `fa1f859deeeb3b68b709dc633ecee90f2954f3fd71bee56484a0674e9159b86f`.
Reviewed regression SHA-256: `7566e0e2de338f8c64bb08e2ce2e96c7a621dd82b8b68ac1350099195db48bbe`.
Execution log SHA-256: `769bcb00c2554bd52c4a3696410187ae5bea465d8ab40d064fbbd9606b6e7713`.

## Findings sent to builder

1. **P1:** Initial concurrent live capture checks budgets before awaited preflight, then updates counters using stale values. Reserve counters atomically after preflight and test actual dispatch counts.
2. **P1:** Overflow cleanup awaits an unbounded stream cancellation promise. A case-loop probe remained pending after 100 ms despite a 15 ms deadline. Cleanup must not delay bounded rejection for capture or semantic responses.
3. **P1:** The runner blocks global fetch but leaves Node HTTP/TCP/TLS APIs reachable. A mocked HTTPS request was reached nine times inside the guarded loop; no actual network was used. The test preload masks this missing runner boundary. Guard Node network APIs and test the runner's own boundary.
4. **P2:** Semantic response bytes are decoded and reencoded before hashing. A one-byte `ff` response became three bytes with a different hash. Keep original bounded bytes and preserve received-prefix diagnostics on timeout/size failures.
5. **P2:** HTTP 4xx/5xx identities are treated as successful, allowing another deliberate dispatch. Prevent retries of unsuccessful terminal HTTP responses while retaining successful reuse and redirects.
6. **P2:** Extension-filtered design inventories omit other executable inputs and committed ownership of protected-history paths. Bind the complete relevant tracked inventory and history paths to both commits and raw bytes.
7. **P2:** Evidence-lock construction reads an inventory digest absent from the configuration schema. Derive the digest consistently with its validator.

The reviewer also requested controls for exact full-configuration verification, appended activation fields, live HOLD entries before reservation/dispatch, symlink containment and concurrent capture preflight. The existing regression meaningfully covers controlled retrieval, redirects, replay misses, budgets, pacing and exclusive reservation. Its passing result does not close the findings above.

The supervisor delegated these corrections to the original builder. Supported concurrent production issue evaluation must be preserved. The network guard will use a private transport capability around explicit dispatch, with no permission granted to general per-case execution. Current missing live acquisition prerequisites must continue to fail closed.

## Final disposition

The builder corrected the seven findings and passed focused blocked regression, syntax checks and clean targeted lint. Corrected runner hash: `12d0f94fdfdb39165ec78773226d7bd7858beae994d93c1457fbd1b07eec763a`; regression hash: `c28f4fd40cd68f6741015f798d9a4732544ff34230fc07dbe9178d91fd3de33d`.

Focused independent re-review closed findings 1–5 and 7. Finding 6 remains partly open: the 389 V9 plan rows are bound, but subsequent immutable files from the complete evaluator protected-history inventory still need HEAD/reviewed-commit blob ownership. The supervisor returned this single correction to the builder. Freeze stays HOLD.

The new live HOLD control proves missing-permit and invalid-profile rejection before outputs/reservation. It does not prove a valid fully frozen configuration with absent inventory/adapter; verify that path after commit/freeze before declaring full gate coverage. The process-wide overlap guard is sound by review, but this pass did not add an overlap probe.

No official capture or live acceptance follows from either review. Final signoff awaits the remaining history-binding correction and narrow validation.

## Final focused signoff

The final correction unions the 389 V9 historical paths with `protectedHistorySnapshot().immutableEvaluationArtifactRows`, preserving the evaluator's exclusions. Raw-byte hashes and both HEAD/reviewed-commit blob checks apply to the union. A narrow later-artifact assertion was added. Syntax checks, targeted lint and the blocked regression pass after this edit.

Final runner SHA-256: `87cddbb06816bd22078b657c8460d8402d82bd4245fa347800711dd844217778`.
Final regression SHA-256: `f7ce5a7d1fea2488a0d24e7f5c64d9fbfd7795ac491bf35f249bcc0927fe0a68`.
The saved regression-log digest remains `769bcb00c2554bd52c4a3696410187ae5bea465d8ab40d064fbbd9606b6e7713`.

The reviewer verified these hashes and reports **no remaining material findings**. All seven findings are closed. This approves only the bounded runner safeguards for supervisor commit/final binding verification/configuration freeze. Full preregistration, official capture and live acceptance remain HOLD. The valid-frozen-configuration HOLD probe remains a supervisor final-verification item; earlier invalid-profile tests do not prove that case.
