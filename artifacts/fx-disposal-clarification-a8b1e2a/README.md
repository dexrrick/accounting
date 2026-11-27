# Targeted live replay of the missing disposal date

**PASS for the targeted turn.** The published application review branch resolves to the exact replay commit, `a8b1e2aebb01d8b24c7549e8ec473fee547a2d95`. [Application commit](https://github.com/dexrrick/accounting/commit/a8b1e2aebb01d8b24c7549e8ec473fee547a2d95)

On `b304f73`, the journal-only prompt correctly withheld the disposal journal but led with an unrelated statutory compliance section. The replay used the same prompt and an offline reconstruction of the previously committed acquisition, checked against the original capture. [Original finding and capture](https://github.com/dexrrick/accounting/blob/e1a5902b90304d561b820f4c9c43ca1d0ef2fdd5/artifacts/fx-gemini-acceptance-b304f73/README.md)

The reply opened with “What was the disposal date (DD/MM/YYYY)?” and then asked whether SGD 1.31 per USD applied to the actual disposal. It omitted the statutory section. The disposal date and rate remained unset, no new journal was created, and the prior committed acquisition was preserved. That journal debits the FVTPL asset and credits cash for SGD 1,300 each, dated 13/11/2025 at the user-supplied rate of SGD 1.30 per USD.

| Gemini stage | HTTP status | Provider time |
| --- | ---: | ---: |
| Semantic interpretation | 200 | 2,164 ms |
| Event extraction | 200 | 960 ms |

The application returned its deterministic clarification in 6,153 ms, including provider pacing and application processing. The replay used two Gemini attempts and zero retries, bringing cumulative usage to 19 of 24. The capture contains the exact prompt, service reply, journal state, checks and attempt timings. [Replay capture](live-results.json)

The fix passed independent review, lint, build, 168 smoke suites and 191 full offline suites. The live replay covered the public application service and existing journal commitment logic for this single turn. [Application diff](https://github.com/dexrrick/accounting/compare/b304f73e28cdc2b93348b7dc4bae10d1235ccf51...a8b1e2aebb01d8b24c7549e8ec473fee547a2d95)
