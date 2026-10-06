# Independent launcher review — 06/10/2026

## Initial disposition: HOLD for two P2 findings

The independent read-only reviewer inspected the completed launcher and controls, the supervisor plan and reserve projection, and the directly relevant frozen runner/evaluator interfaces. The inspected launcher raw SHA-256 was `3d4c2dd0edd4f060acadedac6f75f61834d9da5a51858215b6efea98ffe073d2`; controls raw SHA-256 was `f5eec17836ecbbeb28dc11e724e877fcf4335a1d245ac59f26a12aa8c3707b5e`.

1. **P2: consumption attribution.** Preparation and top-level error handlers report all errors as `HOLD_UNCONSUMED` with retry permitted, including an already used semantic namespace. Execution also conditions consumption on runner invocation. Observe canonical outputs on every execution failure path, preserve their available hashes, and treat existing or uncertain consumption conservatively as no retry.
2. **P2: actual CLI controls.** The controls test pure authorization helpers and then print constant zero-edge counters. They do not prove stdin CLI safety. Add synthetic actual-entrypoint controls with observed capability loading, credential access, writes and requests for invalid arguments and absent authorization; cover consumed-state failure reporting.

No other material findings. The reviewer considered the proposed 80 / 15 percentage-point reserve estimate suitably conservative against the documented larger 78 / 12 cycle. Preserve its required 88% five-hour / 19% weekly remaining at reservation; HOLD if unavailable. Provider quota context correctly separates user-reported limits from unconfirmed headroom.

The review performed no file edits, credentials, source/provider requests, live reservations or full frozen checkout check. The builder has been assigned only these two corrections and affected focused validation. Independent re-review and supervisor actual `--check` remain required before preparation can be considered ready. This record does not authorize nine calls.

## Final independent disposition: no remaining material findings

The builder corrected both P2 findings. Independent read-only re-review verified the final launcher SHA-256 `3c4ae3ce2e8fc995cc88272015d9af6224f0cac2a5967f29ecc52e8aa44411ad` and controls SHA-256 `2def37d0741331e4507276f5093a231422e572b1abd563b92f273a020eb8b26c`.

Consumption reporting now observes the canonical outputs on execution failures and disallows retries for present, unreadable, partial or uncertain states, while retaining available hashes. The controls exercise the actual stdin CLI in an isolated temporary root and observe runner imports, capability loads, credential reads, launcher writes and requests. No new live escape was found. Both original findings are closed.

The builder reports passing Node 22 syntax checks for both files, focused controls, targeted oxlint with no warnings and `git diff --check`. The invalid-argument and missing-authorization CLI cases each measured zero for all five observed edges. The harness created one temporary directory and no files; it removed its empty test directory. The reviewer did not repeat passing controls or the actual frozen checkout check. Supervisor actual `--check` remains the final preparation validation. Nine-call authorization, fresh allowance and current quota/headroom remain separate live prerequisites.
