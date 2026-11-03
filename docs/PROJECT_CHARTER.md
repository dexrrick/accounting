# Project charter

This is the permanent mission and governing architecture of the accounting assistant. Implementation may improve; the three primary objectives may change only with explicit user approval.

## 1. AI understands questions and provides advice

AI is the primary mechanism for understanding natural-language accounting and Singapore statutory questions, relevant conversation context, complex scenarios and multiple related issues. It reasons from the available facts and evidence and gives direct, practical explanations. It identifies missing material information when it could change the answer.

Do not duplicate natural-language reasoning with growing regex collections, hardcoded question templates or special-case classifications. Deterministic routing needs a clear, necessary benefit, such as preserving transaction boundaries, selecting evidence or protecting journal state. A topic map is a retrieval aid, not the boundary of what the assistant may understand.

## 2. Singapore official authorities supply statutory evidence

Reuse the authoritative-source registries and retrieval infrastructure. Priority authorities are IRAS, CPF Board, MOM, ACRA and MAS, with other relevant Singapore government authorities where applicable.

Relevant, verified official sources may support an answer even when no predefined question template exists. Preserve source authenticity, provenance, dates, applicability periods, qualifications and exceptions. Material statutory claims need supporting official citations. AI may interpret and paraphrase faithfully; exact sentence copying is unnecessary. Never manufacture requirements, rates, deadlines, provisions or citations.

Remove retrieval restrictions only after checking their purpose. A broader retrieval path must still distinguish verified official evidence from untrusted websites, model-supplied links and fabricated references. Source identity alone does not establish that a conclusion is supported.

## 3. The accounting engine independently handles double entry

Preserve the existing accounting engine for journals, debit and credit calculations, transactions, monetary calculations and deterministic accounting validation. AI may assist with interpreting a transaction description; the engine remains responsible for validated calculations and journal state.

Keep statutory advisory validation separate from journal validation. A statutory question with no journal must not pass through journal generation or journal checks. Mixed questions may use relevant engine results without permitting advisory prose to create or amend them. Accounting treatment and statutory/tax treatment remain distinct.

## Keep it simple

Every additional mandatory processing stage needs a clear purpose and demonstrable benefit. Prefer fewer stages and API calls, smaller relevant prompts, existing functions, removal of duplicate logic and meaningful validation. Do not replace one complicated framework with another.

The preferred statutory flow is:

`Question and relevant context → AI understanding → official-source retrieval → AI answer → essential source/response checks → answer with citations`

Combine understanding and generation where practical. Aim for one primary generation call per question. A separate understanding call may be necessary to identify relevant evidence before generation. Additional calls must be justified; ordinary questions must not require separate AI review and repair calls.

The independent accounting flow is:

`Transaction request → AI-assisted interpretation where useful → existing accounting engine → journal/calculation validation → accounting result`

Retain useful statutory knowledge, multi-authority answers, contextual follow-ups, separation of unrelated transactions, user facts, effective-date handling, Gemini/OpenAI/Azure OpenAI compatibility, provider failure handling, source security and accounting correctness. Review each safeguard before removing it. Retain protection against real correctness, security and accounting-integrity risks; remove duplicated reasoning and unnecessary formatting restrictions.

## Change discipline

Before planning a change, read this charter and identify the objective it supports. Check whether existing functionality solves the problem. Prefer improving or simplifying it over adding layers. Evaluate answer quality, complexity, latency and API usage together. Avoid unrelated features, speculative safeguards and unnecessary refactoring.

Flag a proposal that conflicts with this charter before implementing it. Do not silently redefine the mission. Do not add rigid architectural tests that block legitimate future improvements.

Use practical scenarios and relevant regressions to assess change. Distinguish source admission, deterministic validation, scripted provider behavior, real-model answer quality, CI and production verification. Offline tests alone cannot establish improved real-model correctness, usefulness, latency or cost.
