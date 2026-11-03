# AI-first advisory foundation — architecture assessment

Baseline: `863daf4299540ed0a50d808b07c1ee0e617b284b`, verified against the remote reference branch on 03/11/2026. Scope: Phase 1 only.

## Current workflow

`App.processMessage` sends the current question, active scenario and chat history to `processAccountingQuery`. Semantic interpretation classifies and decomposes the current question without history. Reconciled issues guide authority workstreams and grounding. Specialist engines parse transactions and calculate journals. Some advisory paths return before answer generation; other paths call Gemini, Azure or OpenAI with compact JSON instructions. Grounding post-processing and the deterministic response assembler can replace generated prose. App retains the full response but stores a short chat preview as the displayed text; ChatPanel renders plain text, with journals and evidence in adjacent panels.

## Limitations

- Authority-only questions return evidence projections before synthesis. IRAS local-sufficient and insufficient-evidence paths also bypass answer generation.
- The amendment/provenance wrapper replaces response text when authority evidence exists.
- Gemini keeps four messages, truncates earlier answers to 400 characters and removes journal tables; Azure/OpenAI keep eight messages. Both can duplicate the current question. Prior assistant fullText is not used.
- Compact output instructions discourage substantial explanations. IRAS post-processing substitutes admitted evidence for professional prose.
- Chat previews hide most reasoning and links. Registry coverage can become an answer boundary rather than a retrieval hint.

## Proposed Phase 1 workflow and reuse

Complete question + bounded, token-estimated conversation context + active transaction facts → existing relevant-source retrieval → one provider-neutral advisory generation call → targeted output checks → full advisory answer in chat. Reuse `aiTransport`, grounding/source governance, canonical source records, existing deterministic calculations, journal integrity checks and specialist panels. Keep the original question separate from retrieval hints and prior untrusted conversation text.

## Implementation boundaries

Add a modular advisory contract and context builder, then route eligible conceptual and explanatory questions before the legacy advisory early returns. Retain the legacy no-provider/failure path and all posting/settlement/ownership/calculation workflows. Definitive statutory applicability and material deadline requests retain their existing evidence-governed route until claim-level verification is connected. Explain safe general principles even when a secondary question is unresolved. Never accept model-proposed journal state through the advisory contract. Resolve source IDs against eligible retrieved records, never model URLs; related-reading links do not certify a model claim. Display the full advisory response through a small safe renderer; defer the broader panel redesign, streaming and full claim-level source synthesis.

## Correctness and security risks

Model prose is not independent verification. Exact rates, material deadlines, historical applicability, calculations and journal state must retain strict controls; Phase 1 must withhold unsupported high-risk assertions while preserving safe explanation. Source identity is distinct from claim support. Conversation summaries must be extractive and labelled incomplete when over budget, never invent facts. Current questions must never be silently truncated. Retrieved text and history are untrusted data, not instructions. Keep provider credentials out of context and logs, reuse existing timeout/request/security controls, render no raw HTML, and allow only safe canonical links.

## Acceptance cases

1. A conceptual accounting question reaches a configured answer provider even without a deterministic topic rule.
2. A multipart statutory explanation reaches synthesis with the complete original question and selected evidence; one evidence gap does not erase safe explanation.
3. A follow-up receives relevant prior full answers and active transaction facts without duplicating the current turn.
4. Exact calculations and journal/settlement requests keep the existing deterministic validation path; advisory output cannot create postings.
5. Invalid output, fabricated source IDs/URLs and unsafe markup are rejected or removed without exposing secrets.
6. No configured provider preserves existing offline behaviour.

## Review-driven boundary

Independent review reproduced unsupported categorical statutory conclusions, interrogative state-change misrouting, Unicode-number filter bypass and omitted-history notice loss. The Phase 1 correction keeps definitive statutory applications and deadline questions on the existing governed route, rejects categorical applicability assertions from conceptual output, excludes actual state changes regardless of polite wording, normalizes numeral representations and accounts for assembled conversation context. This is a bounded educational/advisory foundation, not a claim that arbitrary professional prose has been independently fact-checked. Claim-level contradiction checking and verified application synthesis remain Phase 2 prerequisites for expanding that boundary.

Validation: mocked provider end-to-end scenarios, context and security cases, maintained lint, TypeScript, application/Worker builds, smoke and full regression. Mocked answers establish routing and context behaviour, not live answer quality, model factual accuracy, API cost or production acceptance.
