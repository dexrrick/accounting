# Windows inventory verification continuation — 06/10/2026

Resume from checkpoint commit `c5ae411` and reviewed runner commit `187cdcda556a69703245197446376c8a7c9d2f2c`. The previous actual configuration freeze failed before file creation with `spawn ENAMETOOLONG`. Its single Git-status command contained the complete relevant executable and protected-history inventories. The earlier small-fixture review did not establish full-inventory Windows operability.

The supervisor owns design, final verification, commits and freeze. Builder ownership is limited to `scripts/iras_v4_capture_replay_runner.mjs` and its isolated regression. An independent reviewer must inspect the correction before commit/freeze. Production code, the existing evaluator, the V4 contract and consumed historical artifacts remain unchanged.

Bound Git-status command arguments using a conservative UTF-16 estimate covering the explicit executable, root, fixed options and argument escaping. Retain every requested directory and canonical file path. Use literal pathspecs so filenames cannot expand into patterns. Reject an individually oversized pathspec before dispatch. Execute batches sequentially, combine their complete porcelain entries and reject conflicting status observations. Preserve dirty tracked input and untracked executable rejection, symlink containment, raw-byte hashes and HEAD/reviewed-commit ownership checks.

The scale control must exceed the former Windows command limit, include a dirty bound file in a late batch outside any directory covered by an earlier batch, and exercise an untracked executable in a monitored directory. Validate a clean full actual checkout after independent review and commit, exclusively create the runner configuration, reverify that configuration, and prove that its missing acquisition inventory keeps live work on HOLD before reservation or dispatch.

A runner-only configuration deliberately contains null acquisition inventory, adapter and preregistration bindings. Freezing it does not freeze the acceptance prerequisites or permit official capture. Official pages must not be captured until the separately reviewed acquisition inventory, production observation adapter and acceptance prerequisites are ready; their evidence expires after 24 hours.

At continuation start the shared allowance reported 100% five-hour and 91% weekly remaining. Check usage through the session; start checkpoint closure at 10% five-hour or 5% weekly and finish above 5% five-hour and 2% weekly. Do not spend reset credits.
