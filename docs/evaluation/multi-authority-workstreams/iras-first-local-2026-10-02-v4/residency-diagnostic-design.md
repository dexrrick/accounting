# Prospective residency subject diagnosis — 02/10/2026

This design precedes live calls and matcher changes. V3 established correct dimensions/specificity, but its 1/6 subject score cannot establish whether the model omitted a concept or used equivalent language because raw subjects were not retained.

## Fixed diagnostic

Reuse the three fixed synthetic question IDs from `semantic-residency-diagnostic-v3`: original general rule, general paraphrase, applied control-and-management case. Two replicates each, at most six calls, existing model, temperature zero, 8,000 ms timeout, no retries, and existing 15,250 ms minimum start gap. Record schedule and configuration fingerprints before calls. Do not rerun V3 or overwrite V1/V2/V3. This is diagnostic evidence, not acceptance.

## Safe subject features

Derive only these allowlisted booleans/concept IDs in memory from each subject:

- `COMPANY`: company/companies, corporate/corporation, business entity.
- `TAX`: explicit tax/taxation.
- `RESIDENCE`: resident/residency/residence (preserve a separate non-resident flag).
- `SINGAPORE`: Singapore or the explicit abbreviation SG.
- `CONTROL_MANAGEMENT`: both control and management, or an explicit strategic decision/board management phrase. This is supporting diagnostic context, not a substitute for tax residence.
- `CERTIFICATE_RESIDENCE`: certificate of residence, with COR only when residence context is independently present.

No arbitrary token, token substring, raw subject length, raw question, prompt, model response, fact text or URL is saved. The normalized fingerprint is a hash of the ordered **allowlisted concept bit vector**, not a hash of raw text. This deliberately groups equivalent features; it cannot reconstruct wording or identify private entities.

Persist exact-matcher pass/fail and only finite reason codes: `EXACT_ANCHOR_HIT`, `NO_EXACT_ANCHOR`, `COMPANY_MISSING`, `TAX_MISSING`, `RESIDENCE_MISSING`, `JURISDICTION_MISSING`, `CONCEPT_EQUIVALENT_CANDIDATE`, `MATERIAL_CONCEPT_MISSING`. Predicted dimensions remain separately scored. Subject concepts must be derived from subject text alone; correct dimensions must not supply missing words.

## Decision rule

If an exact-anchor miss contains company, tax and residence concepts, with Singapore present or jurisdiction demonstrably fixed by the preregistered question, record an equivalence candidate. Review that evidence before proposing a bounded synonym matcher. A material concept missing remains a failure. Control/management or certificate wording alone never replaces the tax-residence subject. Do not tune Gemini prompts or fixture subjects after observation.

## Privacy validation before live use

Inject synthetic private-name, query, subject, fact, URL and credential sentinels into model envelopes. Serialize output JSON/Markdown and prove none persist, even on invalid/error responses. Feature values and reason codes must come from fixed allowlists. Check timeout, pacing, no retries, output collision refusal and immutable historical hashes. The live runner must release raw response references after deriving safe fields.
