// One explicitly dispatched development verification; never part of normal builds.
import { processAccountingQuery } from './src/services/geminiService.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const cases = [{"id":"acra","question":"Under ACRA guidance, must Singapore-incorporated companies file annual returns? Explain the general filing duty using official ACRA guidance. Do not calculate a deadline or create journal entries.","authorities":["ACRA"]},{"id":"cpf","question":"Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Explain the general definition using official CPF Board guidance. Do not calculate contribution rates or amounts and do not create journal entries.","authorities":["CPF_BOARD"]},{"id":"mom","question":"Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance. Do not calculate pay or create journal entries.","authorities":["MOM"]},{"id":"mas","question":"Under MAS guidance, what is a Capital Markets Services Licence and when is it generally required? Explain the general licensing requirement using official MAS guidance. Do not assess a particular business or create journal entries.","authorities":["MAS"]},{"id":"iras-residency","question":"For Singapore corporate income tax, is incorporation in Singapore alone enough to make a company tax resident? Explain the general control-and-management test using IRAS guidance. Do not calculate tax or create journal entries.","authorities":["IRAS"]},{"id":"iras-relief","question":"Under IRAS rules, can cash top-ups to my own CPF Special Account or Retirement Account qualify for tax relief? Explain the general eligibility conditions and relief limits using official IRAS guidance. This is a general rules question; do not calculate my personal tax or create journal entries.","authorities":["IRAS"]},{"id":"iras-gst","question":"A Singapore GST-registered business purchases a private passenger motor car for business use. Is the GST on the purchase generally claimable as input tax? Explain the general IRAS restriction and relevant exceptions. Do not calculate amounts or create journal entries.","authorities":["IRAS"]},{"id":"mixed-acra-cpf","question":"Under ACRA guidance, must Singapore-incorporated companies file annual returns? Explain the general filing duty using official ACRA guidance. Do not calculate a deadline or create journal entries. Separately, Under CPF Board guidance, what makes a payment ordinary wages for CPF contributions? Explain the general definition using official CPF Board guidance. Do not calculate contribution rates or amounts and do not create journal entries.","authorities":["ACRA","CPF_BOARD"]},{"id":"mixed-mom-mas","question":"Under MOM guidance, which employees are covered by Part IV of the Employment Act for working hours and overtime? Explain the general coverage using official MOM guidance. Do not calculate pay or create journal entries. Separately, Under MAS guidance, what is a Capital Markets Services Licence and when is it generally required? Explain the general licensing requirement using official MAS guidance. Do not assess a particular business or create journal entries.","authorities":["MOM","MAS"]},{"id":"mixed-iras-three","question":"For Singapore corporate income tax, is incorporation in Singapore alone enough to make a company tax resident? Explain the general control-and-management test using IRAS guidance. Do not calculate tax or create journal entries. Separately, Under IRAS rules, can cash top-ups to my own CPF Special Account or Retirement Account qualify for tax relief? Explain the general eligibility conditions and relief limits using official IRAS guidance. This is a general rules question; do not calculate my personal tax or create journal entries. Separately, A Singapore GST-registered business purchases a private passenger motor car for business use. Is the GST on the purchase generally claimable as input tax? Explain the general IRAS restriction and relevant exceptions. Do not calculate amounts or create journal entries.","authorities":["IRAS"]}];
const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw new Error('Cloudflare development build has no configured model credential.');
const model = 'gemini-3.5-flash-lite';
const executionEnvironment = 'CLOUDFLARE_BUILD_NODE';
const sourceTransport = 'NODE_DIRECT_OFFICIAL_SOURCE';
const appSourceSha = '803fedee1634016cc1fcb59eccb4a7b20469eadc';
const verificationCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const commitMetadata = execFileSync('git', ['cat-file', '-p', 'HEAD'], { encoding: 'utf8' });
const parentShas = [...commitMetadata.matchAll(/^parent ([0-9a-f]{40})$/gm)].map(match => match[1]);
if (parentShas.length !== 1 || parentShas[0] !== appSourceSha) throw new Error('Verification commit must have the reviewed app source as its sole parent.');
const expectedAppTreeSha256 = 'e936544aee4d0d070e05813c3d6d5d73addd6a4f0c38d89d96f1250ea3956776';
const trackedEntries = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD'], { encoding: 'utf8' })
  .split('\0').filter(Boolean)
  .filter(entry => {
    const path = entry.slice(entry.indexOf('\t') + 1);
    return path !== 'package.json' && path !== '.verify-final-build-live.mjs';
  }).sort();
const actualAppTreeSha256 = createHash('sha256').update(trackedEntries.join('\n')).digest('hex');
if (actualAppTreeSha256 !== expectedAppTreeSha256) throw new Error('Tracked application source tree differs from the reviewed app source revision.');
const output = console.log.bind(console);
const scrub = value => String(value).replaceAll(key, '[REDACTED]');
function emitCase(receipt) {
  const encoded = Buffer.from(scrub(JSON.stringify(receipt))).toString('base64');
  const parts = Math.ceil(encoded.length / 3000);
  output('SHARED_FINAL_BUILD_CASE ' + scrub(JSON.stringify({ id: receipt.id, appSourceSha: receipt.appSourceSha, verificationCommitSha: receipt.verificationCommitSha, executionEnvironment: receipt.executionEnvironment, sourceTransport: receipt.sourceTransport, status: receipt.status,
    dispatches: receipt.dispatches, modelResponses: receipt.modelResponses, error: receipt.error, parts })));
  for (let part = 0; part < parts; part += 1) {
    output('SHARED_FINAL_BUILD_PART ' + JSON.stringify({ id: receipt.id, part, parts, data: encoded.slice(part * 3000, (part + 1) * 3000) }));
  }
}
const nativeFetch = globalThis.fetch;
let counts = { model: 0, source: 0, other: 0 };
let modelResponses = [];
globalThis.fetch = async (input, init) => {
  const caseModelResponses = modelResponses;
  const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const modelRequest = target.hostname === 'generativelanguage.googleapis.com';
  if (modelRequest) counts.model += 1;
  else if (/(?:gov\.sg|iras\.gov\.sg)$/.test(target.hostname)) counts.source += 1;
  else counts.other += 1;
  const response = await nativeFetch(input, init);
  if (modelRequest) {
    const observation = { httpStatus: response.status };
    if (target.pathname.endsWith(':generateContent')) {
      const payload = await response.clone().json().catch(() => undefined);
      observation.returnedText = payload?.candidates?.[0]?.content?.parts?.some(part => typeof part.text === 'string' && part.text.trim().length > 0) || false;
    }
    caseModelResponses.push(observation);
  }
  return response;
};
for (const method of ['log', 'info', 'debug', 'warn', 'error']) console[method] = () => {};
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
output('SHARED_FINAL_BUILD_BEGIN ' + JSON.stringify({ appSourceSha, verificationCommitSha, executionEnvironment, sourceTransport, model, cases: cases.length, scope: 'New development live answers; not canonical acceptance, source activation or production deployment', runtimeHash: await hash('src/services/geminiService.ts'), resolverHash: await hash('src/retrieval/queryTopicResolver.ts'), authorityHash: await hash('src/services/authorityWorkstreams.ts') }));
for (const testCase of cases) {
  const startedAtUTC = new Date().toISOString();
  counts = { model: 0, source: 0, other: 0 };
  modelResponses = [];
  let observed;
  let grounded;
  try {
    const response = await processAccountingQuery(testCase.question, null, 'SFRS_I', key, model, [], undefined, {
      onAuthorityWorkstreams(result) { observed = result; },
      onGroundedContext(context) { grounded = context; }
    });
    const presentation = response.scenarioState?.authorityEvidencePresentation;
    const streams = observed?.workstreams || presentation?.workstreams || [];
    emitCase({ id: testCase.id, authorities: testCase.authorities, question: testCase.question,
      appSourceSha, verificationCommitSha, executionEnvironment, sourceTransport, startedAtUTC, observedAtUTC: new Date().toISOString(), dispatches: counts, modelResponses,
      providerStatus: response.providerStatus ?? 'NOT_EXPOSED', answerPath: response.answerPath,
      semanticPlanSource: observed?.issuePlan?.source || 'NOT_EXPOSED',
      semanticPlanAccepted: observed?.issuePlan?.source === 'SEMANTIC_ISSUES',
      status: observed?.status || presentation?.status || response.evidenceQuality?.status || 'UNEXPOSED',
      issuePlan: observed?.issuePlan, gaps: observed?.gaps || presentation?.gaps || [],
      workstreams: streams.map(stream => ({ authority: stream.authority, domain: stream.domain,
        evidenceStatus: stream.evidenceStatus, applicationStatus: stream.applicationStatus,
        issues: stream.issues?.map(issue => ({ subject: issue.subject, lifecycle: issue.lifecycle, gaps: issue.gaps })),
        claims: stream.verifiedClaims?.map(claim => ({ quote: claim.quote, recordId: claim.recordId })),
        sources: stream.sources?.map(source => ({ id: source.id, url: source.officialSourceUrl, documentHash: source.documentHash })) })),
      completeness: response.scenarioState?.requestCompletenessContext?.evaluation,
      grounding: grounded ? { understandingMode: grounded.questionUnderstanding?.mode,
        semanticFailure: grounded.questionUnderstanding?.failure,
        evidenceStatus: grounded.evidenceQuality?.status,
        uncoveredTopics: grounded.evidenceQuality?.uncoveredTopicIds,
        uncoveredConcepts: grounded.evidenceQuality?.uncoveredConcepts,
        sourceTrace: grounded.sourceMapFallbackTrace } : undefined,
      journalGroups: response.scenarioState?.directGroups?.length || 0,
      messageText: response.messageText
    });
  } catch (error) {
    emitCase({ id: testCase.id, appSourceSha, verificationCommitSha, executionEnvironment, sourceTransport, startedAtUTC,
      observedAtUTC: new Date().toISOString(), dispatches: counts, modelResponses, error: scrub(error) });
  }
}
globalThis.fetch = nativeFetch;
output('SHARED_FINAL_BUILD_END ' + JSON.stringify({ appSourceSha, verificationCommitSha, executionEnvironment, sourceTransport, completedAtUTC: new Date().toISOString(), noManualRetries: true }));
