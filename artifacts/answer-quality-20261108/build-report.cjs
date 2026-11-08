const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const cases = read('cases.json');
const rubric = read('rubric.json');
const details = {
  'accounting-accrual': ['FAIL', 'No explanation of accrual, cash timing or unpaid liabilities; only a statutory-evidence fallback.', 'accounting-accrual.json'],
  'accounting-asset-register': ['FAIL', 'No explanation of the asset register, ledger or reconciliation; repeated internal mapping diagnostics instead.', 'accounting-asset-register.json'],
  'iras-private-car': ['FAIL', 'Successful retry retrieves the relevant official page but omits the basic business-use restriction and shows an off-scenario connected-person passage.', 'iras-private-car-retry1.json'],
  'cpf-employer-responsibility': ['FAIL', 'No direct employer-remittance answer or useful payroll checklist. Rate-topic admission and mapping gaps replace non-calculation advice.', 'cpf-employer-responsibility.json'],
  'mom-salary-overtime': ['FAIL', 'Neither the ordinary-salary nor overtime deadline is delivered, and practical steps are absent. A generated overtime rule is withheld despite an official overtime quotation in the workstream.', 'mom-salary-overtime.json'],
  'acra-sole-director-secretary': ['PARTIAL', 'Correct sole-director restriction and basic candidate eligibility. Practical appointment timing/process is missing; the unresolved-applicability footer conflicts with the direct answer.', 'acra-sole-director-secretary.json'],
  'mas-fund-management-startup': ['FAIL', 'No licensing perimeter, conditional exemption guidance, relevant missing facts or official links; a generic fallback only. No source requests were observed for this case.', 'mas-fund-management-startup.json'],
  'mixed-first-employee': ['FAIL', 'The model identifies CPF and MOM, but the final output contains only CPF rate/parser diagnostics and omits MOM salary duties.', 'mixed-first-employee.json']
};
const rows = Object.entries(details).map(([id, [grade, finding, filename]]) => {
  const capture = read(`answers/${filename}`);
  return { id, grade, finding, question: cases.find(c => c.id === id).question, capture: `answers/${filename}`,
    durationMs: capture.durationMs, modelRequests: capture.modelRequestCount, sourceRequests: capture.sourceCount,
    noJournalProduced: capture.noJournalCheck?.noJournalProduced,
    answerPath: capture.finalResponse?.answerPath, answer: capture.finalResponse?.messageText || '',
    sources: rubric.cases[id]?.sources || [] };
});
const attempts = fs.readdirSync(path.join(root, 'answers')).filter(f => f.endsWith('.json')).map(f => read(`answers/${f}`));
const calls = attempts.flatMap(a => a.modelRequests || []);
const usage = calls.filter(c => c.usageMetadata);
const sum = (items, pick) => items.reduce((n, item) => n + (Number(pick(item)) || 0), 0);
const times = rows.map(r => r.durationMs).sort((a, b) => a - b);
const controlCapture = read('answers/accounting-accrual-control.json');
const control = { id: 'accounting-accrual-control', grade: 'USEFUL_WITH_CAVEATS',
  question: controlCapture.question, answer: controlCapture.finalResponse.messageText,
  capture: 'answers/accounting-accrual-control.json', modelRequests: controlCapture.modelRequestCount,
  durationMs: controlCapture.durationMs,
  finding: 'Core timing and unpaid-liability explanation delivered via AI-first. Broad wording treats supplier invoices as immediate expenses even though some purchases create assets; the uncited SFRS(I) mandatory-basis assertion sits awkwardly with the verification note. Excluded from the original eight-case score.' };
const findings = [
  { priority: 1, title: 'Reuse existing negative-journal intent handling before advisory routing',
    observation: 'Both accounting prompts set journalEntryRequired=true and aiFirstEligible=false when they explicitly say no journal is wanted. Removing only the negative directive flips both flags. The paired live accrual control then delivers a useful answer in one model call versus four calls and a fallback for the original wording.',
    nextAction: 'Trace and correct the mismatch between existing negated-journal handling and advisory eligibility. Preserve the exact requests as end-to-end acceptance cases. This is a demonstrated routing issue, not a request for new statutory keywords.',
    evidence: ['routing-diagnostic.json', 'answers/accounting-accrual.json', control.capture],
    code: ['D:/Accounting/src/services/aiFirstAdvisory.ts:145', 'D:/Accounting/src/services/geminiService.ts:994', 'D:/Accounting/src/services/geminiService.ts:997'],
    confidence: 'Confirmed eligibility inconsistency; this does not explain every subsequent fallback.' },
  { priority: 2, title: 'Preserve non-calculation questions and every requested authority',
    observation: 'CPF remittance responsibility and the mixed first-employee question are diverted into contribution-rate admission/parser gaps. The mixed model interpretation explicitly identifies CPF and MOM; the final response omits MOM.',
    nextAction: 'Trace semantic validation, reconciliation and workstream selection. Distinguish explaining duties from calculating rates; keep requested issue coverage without bypassing source admission.',
    evidence: ['answers/cpf-employer-responsibility.json', 'answers/mixed-first-employee.json'], confidence: 'Observed output and trace gap; precise implementation cause not yet assigned.' },
  { priority: 3, title: 'Trace relevant evidence and core claims through final validation',
    observation: 'IRAS fetches the relevant motor-vehicle page but displays a connected-person passage without the corresponding facts. MOM has an official fourteen-day overtime quotation and a matching generated rule, but c1 is withheld from the final answer. ACRA generates a six-month appointment rule that does not reach the displayed answer.',
    nextAction: 'Inspect issue/passage association, evidence selection and numerical/claim checks for these actual claims. Establish the exact cause before changing validation; retain unsupported-claim protections.',
    evidence: ['answers/iras-private-car-retry1.json', 'answers/mom-salary-overtime.json', 'answers/acra-sole-director-secretary.json'], confidence: 'Omissions observed. MOM quote/generation/withheld trace is explicit; exact validation cause and ACRA passage eligibility remain unresolved.' },
  { priority: 4, title: 'Deliver useful limitations instead of internal coverage diagnostics',
    observation: 'Several answers expose topic mapping, parser and admission diagnostics instead of known general rules, relevant missing facts and next steps. MAS returns no useful perimeter or source guidance in this tested path.',
    nextAction: 'Assess user-facing responses against directness and issue completeness, with primary-source grounding. Investigate MAS retrieval/routing coverage from this exact question rather than assuming the repository has no MAS sources.',
    evidence: ['answers/accounting-asset-register.json', 'answers/mas-fund-management-startup.json'], confidence: 'Confirmed user-facing gap; no claim of complete registry/source absence.' }
];
const assessment = {
  dateSingapore: '2026-11-08', commit: '2a282cef56a42e99b7f057de22e863258fddb972',
  repository: 'https://github.com/dexrrick/accounting', branch: 'codex/project-charter-simplification-20261103',
  model: 'gemini-3.5-flash-lite', mode: 'Real processAccountingQuery with real Gemini and native source fetches; headless source checkout.',
  originalSample: { cases: 8, fullyAdequate: 0, partial: 1, failedCoreUsefulness: 7, noJournalProduced: rows.every(r => r.noJournalProduced) },
  review: { kind: 'INDEPENDENT_AGENT_AND_SUPERVISOR', basis: 'Current official-source rubric and saved displayed outputs; no fixtures injected into the application path.',
    safety: 'No fabricated journals in the nine assessed outputs. The original eight displayed no unsupported affirmative statutory entitlement. This limited observation does not establish comprehensive safety; the paired control has the qualifications noted below.' },
  execution: { attempts: attempts.length, totalModelRequests: calls.length, modelRequestBudget: 40,
    sourceFetchRequests: sum(attempts, a => a.sourceCount), originalMedianMs: (times[3] + times[4]) / 2,
    originalMinMs: times[0], originalMaxMs: times.at(-1), responsesWithUsageMetadata: usage.length,
    recordedPromptTokens: sum(usage, c => c.usageMetadata.promptTokenCount),
    recordedCandidateTokens: sum(usage, c => c.usageMetadata.candidatesTokenCount),
    recordedTotalTokens: sum(usage, c => c.usageMetadata.totalTokenCount),
    usageLimit: 'Partial measured usage: two SSE responses lack captured usage and one HTTP503 response has none. Not a billing/cost total.',
    providerIncident: 'Initial IRAS interpretation returned HTTP503 high demand. Batch stopped; one bounded later retry succeeded. Failed attempt retained in answers/iras-private-car.json.' },
  cases: rows, exploratoryPairedControl: control, prioritizedFindings: findings,
  limitations: [
    'Eight deliberately selected practical questions, one model/provider, one run per original case after a single IRAS transient retry; not a statistically representative failure rate or a before/after regression result.',
    'Headless evaluation only. Browser UI, deployed Worker transport, CI and production/release acceptance were not tested.',
    'Capture uses native responses and real retrieval but enforces request limits, a 150-second case timeout and provider fail-fast behavior. These boundaries do not measure normal automatic recovery from an unavailable provider.',
    'Raw streaming generation is unavailable for accrual and MAS because the capture parser expected JSON. Displayed final answers remain captured and reviewable.',
    'Zero observed source fetches in a case does not prove authority inaccessibility or absence of repository coverage.',
    'No production code, source activation, deployment or Git publication was performed for this assessment.'
  ]
};
fs.writeFileSync(path.join(root, 'assessment.json'), JSON.stringify(assessment, null, 2) + '\n');
const captureIndex = read('capture-summary.json');
captureIndex.originalSampleModelRequests = sum(attempts.filter(a => a.caseId !== control.id), a => a.modelRequestCount);
captureIndex.totalModelRequests = calls.length;
captureIndex.qualityAssessment = 'REVIEWED_INDEPENDENT_AGENT_AND_SUPERVISOR';
captureIndex.assessment = 'assessment.json';
captureIndex.supplementalControl = { caseId: control.id, capture: control.capture, modelRequests: control.modelRequests, originalSample: false };
fs.writeFileSync(path.join(root, 'capture-summary.json'), JSON.stringify(captureIndex, null, 2) + '\n');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const link = (href, label) => `<a href="${escape(href)}">${escape(label)}</a>`;
const seconds = ms => `${(ms / 1000).toFixed(2)}s`;
const body = `<h1>Live answer-quality assessment</h1>
<p>8 November 2026 (Singapore) · <code>${assessment.commit}</code> · ${escape(assessment.model)}</p>
<p><strong>Eight original cases: seven fail core usefulness, one is partial, none fully answers the request.</strong> All preserve the no-journal boundary. This small exploratory sample is not a production failure-rate estimate.</p>
<p>Real application entry point, model responses and source retrieval were used. No production code changed.</p>
<table><thead><tr><th>Case</th><th>Core usefulness</th><th>Time</th><th>Model requests</th><th>Source requests</th><th>Material gap</th></tr></thead><tbody>${rows.map(r => `<tr><td>${link('#' + r.id, r.id)}</td><td class="${r.grade.toLowerCase()}">${escape(r.grade)}</td><td>${seconds(r.durationMs)}</td><td>${r.modelRequests}</td><td>${r.sourceRequests}</td><td>${escape(r.finding)}</td></tr>`).join('')}</tbody></table>
<h2>Prioritized next work</h2>${findings.map(f => `<section><h3>${f.priority}. ${escape(f.title)}</h3><p>${escape(f.observation)}</p><p><strong>Next action:</strong> ${escape(f.nextAction)}</p><p class="muted">${escape(f.confidence)}</p><p>${f.evidence.map(e => link(e, e)).join(' · ')}</p>${f.code ? `<p><code>${f.code.map(escape).join('<br>')}</code></p>` : ''}</section>`).join('')}
<h2>Paired exploratory control</h2><p>Excluded from the original eight-case score. ${escape(control.finding)}</p><p>Without the negative journal directive: ${seconds(control.durationMs)}, ${control.modelRequests} model request. The direct-function diagnostic changes journal-required/AI-first-eligible from true/false to false/true for both original accounting prompts.</p><p>${link('routing-diagnostic.json', 'Routing diagnostic')} · ${link(control.capture, 'Control capture')}</p><pre>${escape(control.answer)}</pre>
<h2>Execution and limits</h2><p>${assessment.execution.totalModelRequests} model requests over ${attempts.length} attempts, within the40-request budget; ${assessment.execution.sourceFetchRequests} source fetch requests. Median original-case latency ${seconds(assessment.execution.originalMedianMs)}; range ${seconds(times[0])}–${seconds(times.at(-1))}. ${usage.length} responses contain token usage, totaling ${assessment.execution.recordedTotalTokens.toLocaleString('en-US')} recorded tokens. This omits two streaming responses and is not a billing total.</p><p>${escape(assessment.execution.providerIncident)}</p><ul>${assessment.limitations.map(v => `<li>${escape(v)}</li>`).join('')}</ul>
<h2>Reviewed displayed answers</h2>${rows.map(r => `<section id="${r.id}"><h3>${escape(r.id)} — ${escape(r.grade)}</h3><p>${escape(r.question)}</p><p>${escape(r.finding)}</p><p>${link(r.capture, 'Raw redacted capture')}${r.sources.length ? ' · Official rubric: ' + r.sources.map((s, i) => link(s, 'Source ' + (i + 1))).join(' · ') : ''}</p><pre>${escape(r.answer)}</pre></section>`).join('')}
<p>${link('assessment.json', 'Machine-readable assessment')} · ${link('rubric.json', 'Independent official-source rubric')} · ${link('capture-summary.json', 'Capture index')}</p>`;
fs.writeFileSync(path.join(root, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accounting live answer quality —8 November2026</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:1200px;margin:36px auto;padding:0 24px;color:#172033;background:#fafbfc}h1,h2,h3{line-height:1.25}h2{margin-top:2.2em}section{scroll-margin-top:24px;margin:28px 0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ccd4de;padding:10px;text-align:left;vertical-align:top}th{background:#eaf0f6}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;border:1px solid #d8dee7;padding:16px;font:14px/1.55 ui-monospace,monospace}a{color:#1858a7}code{font-size:13px;overflow-wrap:anywhere}.fail{color:#a22925}.partial{color:#835400}.muted{color:#586577}</style><body>${body}</body></html>`);
console.log(JSON.stringify({ report: path.join(root, 'report.html'), originalCases: rows.length, modelRequests: calls.length, noJournalProduced: assessment.originalSample.noJournalProduced }));
