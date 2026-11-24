# Statutory review evidence package

This package records the locally validated statutory expansion for external code and answer review. The reviewed source commit is `4129caa5f611073aeecf87d3ac95b5d32a79f274`, directly based on `24102c38d1b081f786cf22a643bc16747986eb3d`; it contains the 19 frozen source and test files bound in `source-publication-hashes.json`.

The original before-answer capture records code commit `847fdad2cfeea3e2d222ea4c4e1ce22ce7d46323`. Its only difference from base `24102c38d1b081f786cf22a643bc16747986eb3d` is the CI workflow's full-history checkout fix; product and test sources are identical. The verifier checks this lineage explicitly.

## Review contents

- `*-answer-strings.json` provides exact before and after questions, answers, hashes, and prior-correct grades for 350 cases: 150 natural-language application answers and 200 statutory fixture-plan answers.
- `preservation.json` records 347 unchanged answers, 3 changed answers, and all 213 prior-correct answers unchanged. `wht-current-preservation.json` records the preceding WHT stage at 350/350 unchanged against the same original baseline.
- `final-acceptance.json`, `acceptance-cases.json`, and `independent-review-final.json` contain the ten final application answers, their cases, and independent answer-hash grades. Two IRAS cases are present, including the identified pre-existing control.
- `changed-answers.json` contains the full three changed answer strings and their review. The WHT-prefixed files retain the WHT scope review cases, application snapshots, preservation, summary, and independent review.
- The remaining JSON files and `.txt` logs contain the validation and source-binding records listed by their filenames. The selected checks record full regression 184/184, smoke 161/161, maintained lint, typecheck, Vite build, and Worker build as passed. Root lint retained 34 pre-existing parsing errors in an archived artifact script, as recorded in `summary.json`.

All guidance is conditional. The ten reviewed answers do not establish whole-question coverage or individual applicability. The captured runs recorded zero network requests and zero model requests; they do not represent live source refresh, CI, browser/model acceptance, or deployment.

## Reproduction and verification

From a checkout of the published branch with its Git history, run `node artifacts/statutory-review-publication-20261103/verify.mjs` to check package hashes, exact answer strings, preservation counts, review-grade hashes, and the committed source blobs. This verification uses only the published package and repository history. Set `TASK_GIT_EXE` to a usable Git executable if Git is not available as `git` on `PATH`.

`prepare.mjs` records how the package was assembled. Rebuilding it requires the original balanced, WHT, and baseline capture directories, which remain local and are not fully published. Do not run preparation before standalone verification in a fresh checkout. Both scripts use Node.js built-ins only.

The original capture used machine-local source-manifest paths and an external-fetch guard; those paths and the original capture script are not included. The corpus and source-fixture identity hashes are in `starting-input-hashes.json`, and source fixtures remain in the repository. `capture-method.txt` records the replay entry points and this reproduction boundary.

`evidence-hashes.json` binds every package file except itself. If a root handoff is added to this directory later, rerun `prepare.mjs` and `verify.mjs` so the handoff is included in the package manifest.
