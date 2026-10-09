# IRAS-first v2 architecture decision

Baseline: `4bd3abc9c22619401f22aa8abba73af61b5d6217`. The supervisor and independent reviewer approved options C+D before production implementation: omit `requiresUserSpecificFacts` from new V2 provider responses and derive applicability in the application. A supplied older value is non-authoritative compatibility metadata.

New V2 responses have twelve root keys. The exact preceding V2 shape with a Boolean flag and the existing unversioned shape remain accepted for compatibility. Unexpected keys, malformed compatibility values, impossible authority/domain combinations, invalid populations/operations/issues, and inconsistent legacy calculation flags remain rejectable. This decision permits repair of derived applicability metadata only; it does not authorize repairing provider-authored semantic dimensions or issue decomposition.

Strict decoding and query-aware normalization must remain distinct and idempotent for internal callers. Both provider interpretation and direct public reconciliation derive specificity through the same generic function. Per-requested-issue decisions determine their evidence requirements. Aggregate applicability is their OR, with a mandatory CALCULATE/DETERMINE_TREATMENT/PREPARE_JOURNAL root lower bound; that aggregate cannot become another issue's fallback. Mapping outcomes and taxonomy residuals do not determine requested applicability.

Clear general/class questions resolve false; demonstrated case applications resolve true. Uncertain specificity resolves true conservatively, including ambiguous owned-case language and unsuccessful compound clause alignment. This may request extra facts for an ambiguous conceptual issue but avoids stripping case evidence. Provider supplied-facts counts and evidence hints do not override this contract. Compatibility disagreements produce safe Boolean/enum telemetry, never rejection violation codes. Absence of the field in the new wire shape is expected.

The reviewer explicitly approved this architecture and the supervisor selected the conservative unknown fallback. Implementation remains subject to regression-first coverage, independent code review and final validation. Production timeout and source-admission rules are separate decisions.

The v2 historical manifest protects 118 prior JSON/Markdown files, including all v1 observations and its frozen profile. Prior benchmark questions and observation bytes cannot be rewritten during this cycle.
