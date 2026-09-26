#!/usr/bin/env node
/**
 * Opt-in live IRAS answer validation. Run with:
 *   node --import tsx scripts/run_iras_live_validation.mjs
 *   node --import tsx scripts/run_iras_live_validation.mjs --case=gst-customer-supplier-meals
 *
 * This runner uses the production processAccountingQuery pipeline and real fetch.
 * It never stores request headers, and refuses to persist credential-shaped text.
 */
import { access, appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { processAccountingQuery } from '../src/services/geminiService.ts';
import { classifyQuestion } from '../src/classification/questionClassifier.ts';
import { defaultExternalSourceValidator } from '../src/retrieval/externalSourceValidator.ts';

const MODEL = 'gemini-3.5-flash-lite';
const FIXTURE_PATH = path.resolve('tests/evaluation/singapore/iras-answer-e2e.json');
const DEFAULT_OUTPUT = path.resolve('docs/evaluation/iras-live-2026-09-26/iras-e2e-captures.jsonl');
const MIXED_MEAL_CASE = {
  id: 'mixed-customer-meal-journal',
  question: 'We paid SGD 200 for a customer lunch. What is the accounting entry, and can we claim the GST?',
  workflow: 'Accounting journal plus GST input tax',
  // Match the normal UI request preferences; the question itself requests the
  // accounting entry and GST advice without forcing optional output sections.
  outputPreference: { journal: false, statutory: false }
};
const CREDENTIAL_SHAPED_TEXT = /\bAIza[0-9A-Za-z_-]{15,}\b/g;

function parseArgs(argv) {
  const options = {};
  for (const argument of argv) {
    if (argument === '--resume') options.resume = true;
    else if (argument.startsWith('--case=')) options.caseId = argument.slice('--case='.length);
    else if (argument.startsWith('--out=')) options.outputPath = path.resolve(argument.slice('--out='.length));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function safeText(value, secret) {
  let text = String(value ?? '');
  if (secret) text = text.split(secret).join('[REDACTED]');
  return text.replace(CREDENTIAL_SHAPED_TEXT, '[REDACTED_CREDENTIAL]');
}

function classifyTransportFailure(error) {
  const name = String(error?.name || '');
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');
  if (/AbortError/i.test(name) || /ABORT_ERR/i.test(code) || /\b(?:abort(?:ed|ing)?|timed?\s*out|timeout)\b/i.test(message)) {
    return 'TIMEOUT';
  }
  return 'NETWORK_ERROR';
}

function safeValue(value, secret) {
  if (typeof value === 'string') return safeText(value, secret);
  if (Array.isArray(value)) return value.map(item => safeValue(item, secret));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeValue(item, secret)]));
  }
  return value;
}

function assertNoCredentialLikeText(value) {
  if (typeof value === 'string') {
    if (CREDENTIAL_SHAPED_TEXT.test(value)) throw new Error('Refusing to persist credential-shaped text.');
    CREDENTIAL_SHAPED_TEXT.lastIndex = 0;
    return;
  }
  if (Array.isArray(value)) return value.forEach(assertNoCredentialLikeText);
  if (value && typeof value === 'object') Object.values(value).forEach(assertNoCredentialLikeText);
}

function htmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)));
}

function describePage(html) {
  const title = decodeHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const canonicalTag = html.match(/<link\b[^>]*\brel\s*=\s*(?:"canonical"|'canonical'|canonical)[^>]*>/i)?.[0]
    || html.match(/<link\b[^>]*\bhref\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>]+)[^>]*\brel\s*=\s*(?:"canonical"|'canonical'|canonical)[^>]*>/i)?.[0];
  const canonicalHref = canonicalTag ? htmlAttribute(canonicalTag, 'href') : undefined;
  const visibleHtml = html
    .replace(/<(script|style|noscript|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const substantiveText = decodeHtml(visibleHtml).replace(/\s+/g, ' ').trim();
  return {
    pageTitle: title || undefined,
    canonicalHref: canonicalHref || undefined,
    bodyExcerpt: substantiveText.slice(0, 6000),
    contentSha256: createHash('sha256').update(html).digest('hex')
  };
}

function parseGeminiOutput(rawText, contentType) {
  const parts = [];
  const usage = [];
  if (contentType?.includes('text/event-stream') || rawText.includes('data: ')) {
    for (const line of rawText.split(/\r?\n/)) {
      if (!line.trim().startsWith('data:')) continue;
      const payload = line.trim().slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload);
        const text = chunk?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('');
        if (text) parts.push(text);
        if (chunk?.usageMetadata) usage.push(chunk.usageMetadata);
      } catch {
        // Preserve parse failure in the raw response status without logging response bodies.
      }
    }
  } else {
    try {
      const body = JSON.parse(rawText);
      const text = body?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('');
      if (text) parts.push(text);
      if (body?.usageMetadata) usage.push(body.usageMetadata);
    } catch {
      return { rawCandidateText: '', responseJsonValid: false, usageMetadata: [] };
    }
  }
  const rawCandidateText = parts.join('');
  let candidateJsonValid = false;
  if (rawCandidateText) {
    try { JSON.parse(rawCandidateText); candidateJsonValid = true; } catch { /* The app may repair JSON; leave semantic evaluation to the application. */ }
  }
  return {
    rawCandidateText,
    responseJsonValid: true,
    rawCandidateJsonValid: candidateJsonValid,
    candidateJsonValid,
    usageMetadata: usage
  };
}

function compactEvidence(record) {
  return {
    id: record.id,
    authority: record.authority,
    sourcePublisher: record.sourcePublisher,
    documentTitle: record.documentTitle,
    standardOrActCode: record.standardOrActCode,
    paragraphOrSection: record.paragraphOrSection,
    sourceText: record.sourceText,
    principleSummary: record.principleSummary,
    effectiveDate: record.effectiveDate,
    validFrom: record.validFrom,
    validTo: record.validTo,
    officialSourceUrl: record.officialSourceUrl,
    canonicalSourceUrl: record.canonicalSourceUrl,
    domain: record.domain,
    tags: record.tags,
    sourceStatus: record.sourceStatus,
    sourceType: record.sourceType,
    evidenceTier: record.evidenceTier,
    freshnessStatus: record.freshnessStatus,
    lifecycleState: record.lifecycleState,
    provenance: record.provenance,
    recordRole: record.recordRole,
    groundingEligible: record.groundingEligible,
    sourceMapTopicIds: record.sourceMapTopicIds,
    retrievalHints: record.retrievalHints,
    retrievedAt: record.retrievedAt
  };
}

function collectContext(context) {
  const evidence = [
    ...(context.primaryEvidence || []),
    ...(context.officialGuidance || []),
    ...(context.curatedSummaries || [])
  ];
  const localEvidence = evidence.filter(record => record.provenance === 'LOCAL_STATIC' || record.provenance === 'LIVE_PATCH');
  return {
    classification: context.classification,
    authority: context.classification?.authorities || [],
    topicIds: context.classification?.topicIds || [],
    userFacts: context.userFacts || [],
    missingFacts: context.missingFacts || [],
    assumptions: context.assumptions || [],
    applicationRules: context.applicationRules || [],
    currentInformationRequired: context.currentInformationRequired,
    semanticUnderstanding: context.semanticUnderstanding,
    sourceMapFallbackTrace: context.sourceMapFallbackTrace,
    evidenceQuality: context.evidenceQuality ? {
      ...context.evidenceQuality,
      eligibleRecords: context.evidenceQuality.eligibleRecords.map(compactEvidence)
    } : undefined,
    sourceMapIdsSelected: context.sourceMapFallbackTrace?.sourceMapIds || [],
    selectedRecordIds: context.sourceMapFallbackTrace?.selectedRecordIds || [],
    finalVerifiedUrls: context.sourceMapFallbackTrace?.finalVerifiedUrls || [],
    evidence: evidence.map(compactEvidence),
    localKnowledge: {
      suppliedToProvider: localEvidence.length > 0,
      recordIds: localEvidence.map(record => record.id),
      records: localEvidence.map(compactEvidence)
    }
  };
}

function extractMarkdownCitations(text) {
  const citations = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('](', cursor);
    if (start < 0) break;
    let urlStart = start + 2;
    const angleWrapped = text[urlStart] === '<';
    if (angleWrapped) urlStart += 1;
    let depth = 0;
    let end = urlStart;
    for (; end < text.length; end += 1) {
      const char = text[end];
      if (char === '(') depth += 1;
      else if (char === ')') {
        if (depth === 0) break;
        depth -= 1;
      } else if (angleWrapped && char === '>' && depth === 0) break;
      else if (!angleWrapped && /\s/.test(char)) break;
    }
    const candidate = text.slice(urlStart, end).replace(/[.,;]+$/, '');
    if (/^https?:\/\//i.test(candidate)) citations.push(candidate);
    cursor = end + 1;
  }
  return citations;
}

function captureFinalCitations(response) {
  const responseText = response?.messageText || '';
  const state = response?.scenarioState || {};
  const structured = [
    ...(state.directGroups || []).flatMap(group => group.citations || []),
    ...(state.statutoryAdvisory || []).flatMap(advisory => advisory.citations || [])
  ];
  return {
    markdownUrls: extractMarkdownCitations(responseText),
    structured: structured.map(citation => ({
      standard: citation.standard,
      paragraph: citation.paragraph,
      authority: citation.authority,
      title: citation.title,
      officialSourceUrl: citation.officialSourceUrl,
      verificationStatus: citation.verificationStatus
    }))
  };
}

function extractCalculatedResult(response) {
  const groups = response?.scenarioState?.directGroups || [];
  return {
    keyParameters: response?.scenarioState?.keyParameters || [],
    journalGroups: groups.map(group => ({
      id: group.id,
      title: group.title,
      eventDate: group.eventDate,
      totalDebit: group.totalDebit,
      totalCredit: group.totalCredit,
      isBalanced: group.isBalanced,
      lines: (group.lines || []).map(line => ({
        accountName: line.accountName,
        debit: line.debit,
        credit: line.credit,
        lineExplanation: line.lineExplanation
      }))
    }))
  };
}

function extractClarificationRequests(response) {
  const scenarioFields = response?.scenarioState?.missingFields || [];
  const clarificationFields = response?.clarifications || [];
  const deduped = new Map();
  for (const field of [...scenarioFields, ...clarificationFields]) {
    if (!field || typeof field !== 'object') continue;
    const key = [field.fieldKey, field.fieldName, field.prompt].filter(Boolean).join('|');
    if (!key || deduped.has(key)) continue;
    deduped.set(key, {
      fieldKey: field.fieldKey,
      fieldName: field.fieldName,
      prompt: field.prompt,
      whyNeeded: field.whyNeeded
    });
  }
  return [...deduped.values()];
}

function localEvidenceWasSuppliedToAnswerCall(localRecords, answerCalls) {
  const generationCalls = (answerCalls || []).filter(call => call.stage === 'answer-generation');
  if (!localRecords?.length || generationCalls.length === 0) return false;
  return generationCalls.some(call => {
    const systemInstruction = call.request?.systemInstruction?.parts
      ?.map(part => part?.text || '')
      .join('\n') || '';
    return localRecords.some(record => {
      const title = record.documentTitle || record.title;
      const sourceText = record.sourceText;
      return Boolean(
        (title && systemInstruction.includes(title)) ||
        (sourceText && sourceText.length >= 40 && systemInstruction.includes(sourceText))
      );
    });
  });
}

function classifyFinalAnswerPath(response, answerCalls, providerResultStatus, applicationFailure) {
  if (applicationFailure) return 'APPLICATION_FAILURE';
  if (response?.clarifications?.length || response?.scenarioState?.missingFields?.length) {
    return answerCalls?.length ? 'PROVIDER_STAGE_CLARIFICATION' : 'DETERMINISTIC_CLARIFICATION';
  }
  if (answerCalls?.some(call => call.rawCandidateText) && providerResultStatus === 'LIVE_PASS') return 'GEMINI_POST_PROCESSED';
  if (answerCalls?.length) return 'DETERMINISTIC_FALLBACK_AFTER_PROVIDER_ATTEMPT';
  if (response) return 'DETERMINISTIC_SHORT_CIRCUIT_OR_FALLBACK';
  return 'NO_FINAL_RESPONSE';
}

function createFetchObserver(secret) {
  const originalFetch = globalThis.fetch;
  const sourceFetches = [];
  const modelCalls = [];
  const pendingCaptures = [];
  globalThis.fetch = async (input, init = {}) => {
    const requestUrl = typeof input === 'string' ? input : input?.url || String(input);
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    let url;
    try { url = new URL(requestUrl); } catch { url = undefined; }
    const isGemini = url?.hostname === 'generativelanguage.googleapis.com';
    const sourceSecurity = isGemini || !url ? undefined : defaultExternalSourceValidator.validateUrlSecurity(requestUrl);
    const isSource = url?.protocol === 'https:' && sourceSecurity?.isValid === true && method === 'GET';
    let modelCall;
    if (isGemini) {
      let requestBody;
      try { requestBody = typeof init.body === 'string' ? JSON.parse(init.body) : undefined; } catch { requestBody = undefined; }
      modelCall = {
        model: url.pathname.match(/\/models\/([^/:]+)/)?.[1],
        endpoint: url.pathname.includes(':streamGenerateContent') ? 'streamGenerateContent' : 'generateContent',
        requestUrl,
        httpStatus: undefined,
        transportError: undefined,
        request: requestBody ? safeValue(requestBody, secret) : undefined,
        stage: requestBody?.systemInstruction?.parts?.some(part =>
          typeof part?.text === 'string' && (part.text.includes('[4. AUTHORITATIVE PRIMARY SOURCE EVIDENCE') || part.text.includes('[IRAS_EVIDENCE_BOUND_ANSWER]'))
        ) ? 'answer-generation' : 'semantic-extraction-or-other',
        rawCandidateText: '',
        responseJsonValid: undefined,
        candidateJsonValid: undefined,
        usageMetadata: []
      };
      modelCalls.push(modelCall);
    }
    let response;
    try {
      response = await originalFetch(input, init);
    } catch (error) {
      const failure = safeText(error?.message || 'Fetch failed.', secret);
      if (modelCall) {
        modelCall.transportError = failure;
        modelCall.transportErrorName = String(error?.name || 'Error');
        modelCall.transportErrorCode = error?.code ? String(error.code) : undefined;
        modelCall.transportFailureKind = classifyTransportFailure(error);
      }
      if (isSource) sourceFetches.push({
        requestedUrl: requestUrl,
        method,
        status: 'NETWORK_ERROR',
        transportError: failure,
        transportErrorName: String(error?.name || 'Error'),
        transportErrorCode: error?.code ? String(error.code) : undefined,
        transportFailureKind: classifyTransportFailure(error),
        redirect: init.redirect || 'follow'
      });
      throw error;
    }
    if (modelCall) {
      modelCall.httpStatus = response.status;
      const clone = response.clone();
      pendingCaptures.push((async () => {
        const raw = await clone.text();
        const parsed = parseGeminiOutput(raw, response.headers.get('content-type') || '');
        Object.assign(modelCall, safeValue(parsed, secret));
        if (!response.ok) modelCall.providerErrorStatus = response.status;
      })());
    }
    if (isSource) {
      const sourceRecord = {
        requestedUrl: requestUrl,
        method,
        requestProtocol: url.protocol,
        requestedHostname: url.hostname,
        approvedHostname: true,
        urlSecurityReason: sourceSecurity?.reason,
        httpStatus: response.status,
        status: response.status >= 300 && response.status < 400 ? 'REDIRECT' : response.ok ? 'HTTP_SUCCESS' : 'HTTP_ERROR',
        redirectMode: init.redirect || 'follow',
        redirectLocation: (() => {
          const location = response.headers.get('location');
          if (!location) return undefined;
          try { return new URL(location, requestUrl).toString(); } catch { return safeText(location, secret); }
        })(),
        responseUrl: response.url || requestUrl,
        responseHostname: (() => { try { return new URL(response.url || requestUrl).hostname; } catch { return undefined; } })(),
        pageTitle: undefined,
        canonicalUrl: undefined,
        contentSha256: undefined,
        bodyExcerptIsUnreviewed: true
      };
      sourceFetches.push(sourceRecord);
      const clone = response.clone();
      pendingCaptures.push((async () => {
        const rawHtml = await clone.text();
        const page = describePage(rawHtml);
        Object.assign(sourceRecord, safeValue(page, secret));
        if (page.canonicalHref) {
          try { sourceRecord.canonicalUrl = new URL(page.canonicalHref, requestUrl).toString(); } catch { /* Invalid canonical retained as raw href below. */ sourceRecord.canonicalUrl = page.canonicalHref; }
        }
        const responseUrl = sourceRecord.responseUrl;
        const canonicalUrl = sourceRecord.canonicalUrl;
        sourceRecord.finalHostname = (() => { try { return new URL(responseUrl).hostname; } catch { return undefined; } })();
        sourceRecord.canonicalMatchesResponseUrl = canonicalUrl ? canonicalUrl === responseUrl : undefined;
        sourceRecord.pathChangedByCanonical = canonicalUrl
          ? (() => { try { return new URL(canonicalUrl).pathname !== new URL(requestUrl).pathname; } catch { return undefined; } })()
          : undefined;
        delete sourceRecord.canonicalHref;
      })());
    }
    return response;
  };
  return {
    sourceFetches,
    modelCalls,
    async finish() {
      await Promise.allSettled(pendingCaptures);
      globalThis.fetch = originalFetch;
    },
    restore() { globalThis.fetch = originalFetch; }
  };
}

function classifyRetrieval(context, sourceFetches) {
  const attempts = context?.sourceMapFallbackTrace?.attempts || [];
  const successfulHttpFetches = sourceFetches.filter(fetch => fetch.httpStatus >= 200 && fetch.httpStatus < 300).length;
  const transportFailures = sourceFetches.filter(fetch => fetch.status === 'NETWORK_ERROR' || fetch.httpStatus >= 500).length;
  const httpFailures = sourceFetches.filter(fetch => fetch.status === 'HTTP_ERROR' || (fetch.httpStatus >= 400 && fetch.httpStatus < 500)).length;
  const hasValidatorFailure = attempts.some(attempt => attempt.fetchStatus !== 'SUCCESS');
  let retrievalTransportStatus = 'NOT_ATTEMPTED';
  if (transportFailures > 0) retrievalTransportStatus = successfulHttpFetches > 0 ? 'PARTIAL' : 'BLOCKED_BY_NETWORK';
  else if (httpFailures > 0) retrievalTransportStatus = successfulHttpFetches > 0 ? 'PARTIAL' : 'BLOCKED_BY_SOURCE';
  else if (successfulHttpFetches > 0) retrievalTransportStatus = 'SUCCESS';
  else if (sourceFetches.length > 0) retrievalTransportStatus = 'PARTIAL';
  else if (attempts.length > 0 && attempts.every(attempt => attempt.fetchStatus === 'SUCCESS')) retrievalTransportStatus = 'NOT_OBSERVED';

  // Fetch success is only transport evidence. Relevance and claim support remain for independent review.
  let retrievalStatus = 'NOT_EVALUATED';
  if (transportFailures > 0) retrievalStatus = 'BLOCKED_BY_NETWORK';
  else if (retrievalTransportStatus === 'BLOCKED_BY_SOURCE' || hasValidatorFailure) retrievalStatus = 'BLOCKED_BY_SOURCE';
  else if (retrievalTransportStatus === 'PARTIAL') retrievalStatus = 'BLOCKED_BY_SOURCE';
  return { retrievalStatus, retrievalTransportStatus };
}

function providerStatus(modelCalls, applicationFailure, finalMessage = '') {
  const answerCalls = modelCalls.filter(call => call.stage === 'answer-generation');
  const semanticCalls = modelCalls.filter(call => call.stage !== 'answer-generation');
  const allCalls = [...answerCalls, ...semanticCalls];
  const applicationUsedProviderFallback = /Gemini API Call Notice|Gemini API request failed|Gemini request timed out|AI Event Extraction Required/i.test(finalMessage);
  const answerResponseSucceeded = answerCalls.some(call => call.rawCandidateText && call.httpStatus >= 200 && call.httpStatus < 300);
  if (answerResponseSucceeded && !applicationFailure && !applicationUsedProviderFallback) return 'LIVE_PASS';
  if (answerCalls.some(call => call.rawCandidateText) && applicationUsedProviderFallback) return 'LIVE_FAIL';
  if (allCalls.some(call => call.transportFailureKind === 'TIMEOUT')) return 'BLOCKED_BY_PROVIDER';
  if (allCalls.some(call => call.transportFailureKind === 'NETWORK_ERROR' || (call.transportError && !call.transportFailureKind))) return 'BLOCKED_BY_NETWORK';
  if (allCalls.some(call => call.httpStatus >= 400)) return 'BLOCKED_BY_PROVIDER';
  if (!answerCalls.length && /AI Event Extraction Required/i.test(finalMessage)) return 'LIVE_FAIL';
  if (!answerCalls.length) return applicationFailure ? 'LIVE_FAIL' : 'NOT_EVALUATED';
  if (answerCalls.some(call => call.httpStatus >= 200 && call.httpStatus < 300)) return 'LIVE_FAIL';
  if (applicationFailure) return 'LIVE_FAIL';
  if (!modelCalls.length) return 'NOT_EVALUATED';
  return 'BLOCKED_BY_PROVIDER';
}

export {
  classifyFinalAnswerPath,
  classifyRetrieval,
  classifyTransportFailure,
  extractClarificationRequests,
  extractMarkdownCitations,
  localEvidenceWasSuppliedToAnswerCall,
  providerStatus,
  safeText
};

function parseJsonLines(text) {
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey?.trim()) {
    console.error('GEMINI_API_KEY is missing. Live validation did not start.');
    process.exitCode = 2;
    return;
  }
  const apiKey = geminiKey.trim();
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
  const reviewedCases = fixture.cases || [];
  if (reviewedCases.length !== 19) throw new Error(`Expected 19 benchmark cases; found ${reviewedCases.length}.`);
  let cases = reviewedCases.map(testCase => ({
    id: testCase.id,
    question: testCase.question,
    workflow: testCase.workflow,
    expected: testCase.provisionalOracle
  }));
  cases.push(MIXED_MEAL_CASE);
  if (options.caseId) cases = cases.filter(testCase => testCase.id === options.caseId);
  if (options.caseId && cases.length === 0) throw new Error(`Unknown benchmark case ID: ${options.caseId}`);

  const outputPath = options.outputPath || DEFAULT_OUTPUT;
  await mkdir(path.dirname(outputPath), { recursive: true });
  let completedIds = new Set();
  let hasMetadata = false;
  if (!options.resume) {
    try {
      await access(outputPath);
      throw new Error(`Output already exists; choose --resume or a new --out path: ${path.relative(process.cwd(), outputPath)}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (options.resume) {
    try {
      const previous = parseJsonLines(await readFile(outputPath, 'utf8'));
      completedIds = new Set(previous.filter(record => record.recordType === 'case').map(record => record.caseId));
      hasMetadata = previous.some(record => record.recordType === 'run-metadata');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const metadata = {
    recordType: 'run-metadata',
    schemaVersion: 2,
    startedAt: new Date().toISOString(),
    fixture: path.relative(process.cwd(), FIXTURE_PATH),
    benchmarkCaseCount: 19,
    includedMixedMealCase: cases.some(testCase => testCase.id === MIXED_MEAL_CASE.id),
    provider: 'Gemini',
    model: MODEL,
    apiKeyPresent: true,
    captureMethod: 'Production processAccountingQuery; real fetch; request headers omitted.',
    semanticAssessment: 'NOT_EVALUATED'
  };
  if (!hasMetadata) await appendFile(outputPath, `${JSON.stringify(metadata)}\n`, 'utf8');

  const originalWarn = console.warn;
  const originalError = console.error;
  const originalLog = console.log;
  // The application logs provider exceptions. Suppress them during this sensitive run;
  // structured, sanitized failures are recorded in the checkpoint instead.
  console.warn = () => {};
  console.error = () => {};
  console.log = () => {};
  try {
    for (const testCase of cases) {
      if (options.resume && completedIds.has(testCase.id)) continue;
      const observer = createFetchObserver(apiKey);
      let groundedContext;
      let response;
      let applicationFailure;
      const startedAt = new Date().toISOString();
      const preferences = testCase.outputPreference || { journal: false, statutory: false };
      try {
        response = await processAccountingQuery(
          testCase.question,
          null,
          'SFRS_I',
          { activeProvider: 'gemini', gemini: { apiKey, model: MODEL } },
          MODEL,
          [],
          preferences,
          { onGroundedContext(context) { groundedContext = collectContext(context); } }
        );
      } catch (error) {
        applicationFailure = safeText(error?.message || 'Application pipeline failed.', apiKey);
      } finally {
        await observer.finish();
      }

      const classification = groundedContext?.classification || classifyQuestion(testCase.question);
      const finalResponse = response || {};
      const finalMessage = finalResponse.messageText || '';
      const modelCallStatus = providerStatus(observer.modelCalls, applicationFailure, finalMessage);
      const { retrievalStatus, retrievalTransportStatus } = classifyRetrieval(groundedContext, observer.sourceFetches);
      const generatedAnswerCall = observer.modelCalls.find(call => call.stage === 'answer-generation' && call.rawCandidateText);
      const answerCalls = observer.modelCalls.filter(call => call.stage === 'answer-generation');
      const localRecordsAvailable = groundedContext?.localKnowledge?.records || [];
      const localKnowledgeSuppliedToGemini = localEvidenceWasSuppliedToAnswerCall(localRecordsAvailable, answerCalls);
      const finalAnswerPath = classifyFinalAnswerPath(finalResponse, answerCalls, modelCallStatus, applicationFailure);
      const caseRecord = {
        recordType: 'case',
        schemaVersion: 2,
        caseId: testCase.id,
        question: testCase.question,
        workflow: testCase.workflow,
        startedAt,
        completedAt: new Date().toISOString(),
        classification: {
          primaryDomain: classification?.primaryDomain,
          authorities: classification?.authorities || [],
          authority: classification?.authorities?.[0],
          topicIds: classification?.topicIds || [],
          intent: classification?.intent,
          confidence: classification?.confidence
        },
        authority: classification?.authorities || [],
        topicIds: classification?.topicIds || [],
        localKnowledgeAvailable: localRecordsAvailable.length > 0,
        localKnowledgeSuppliedToGemini,
        localKnowledgeAnswered: 'NOT_EVALUATED',
        finalAnswerPath,
        sourceMapIdsSelected: groundedContext?.sourceMapIdsSelected || [],
        sourceMapIdsExpected: testCase.expected?.sourceMapIds || [],
        actualSourceFetches: observer.sourceFetches,
        redirectsEncountered: observer.sourceFetches.filter(fetch => fetch.status === 'REDIRECT').map(fetch => ({
          requestedUrl: fetch.requestedUrl,
          httpStatus: fetch.httpStatus,
          redirectLocation: fetch.redirectLocation
        })),
        finalValidatedUrls: groundedContext?.finalVerifiedUrls || [],
        retrievalStatus,
        retrievalTransportStatus,
        retrievedEvidenceAndExcerpts: groundedContext?.evidence || [],
        groundingContextSupplied: groundedContext || null,
        gemini: {
          status: modelCallStatus,
          model: MODEL,
          outputPreference: preferences,
          semanticCalls: observer.modelCalls.filter(call => call.stage !== 'answer-generation'),
          answerCalls: observer.modelCalls.filter(call => call.stage === 'answer-generation'),
          calls: observer.modelCalls,
          answerCandidateText: generatedAnswerCall?.rawCandidateText || null,
          finalAnswer: finalMessage || null
        },
        finalCitations: captureFinalCitations(finalResponse),
        missingFactsAvailableInGroundingContext: groundedContext?.missingFacts || [],
        missingFactsRequested: {
          structuredRequests: extractClarificationRequests(finalResponse),
          responseText: finalMessage
        },
        effectiveDateUsed: {
          response: finalResponse.scenarioState?.effectiveDateOrTiming,
          evidence: (groundedContext?.evidence || []).map(record => ({
            id: record.id,
            effectiveDate: record.effectiveDate,
            validFrom: record.validFrom,
            validTo: record.validTo
          }))
        },
        calculatedResult: extractCalculatedResult(finalResponse),
        finalResponse,
        expected: testCase.expected || null,
        dimensions: {
          classification: 'NOT_EVALUATED',
          topicRouting: 'NOT_EVALUATED',
          sourceSelection: 'NOT_EVALUATED',
          retrieval: 'NOT_EVALUATED',
          grounding: 'NOT_EVALUATED',
          substantiveConclusion: 'NOT_EVALUATED',
          missingFactHandling: 'NOT_EVALUATED',
          effectiveDateHandling: 'NOT_EVALUATED',
          calculationCorrectness: 'NOT_EVALUATED',
          citationCorrectness: 'NOT_EVALUATED'
        },
        pipeline: {
          responseReturned: Boolean(response),
          providerStatus: modelCallStatus,
          retrievalStatus,
          retrievalTransportStatus,
          applicationFailure: applicationFailure || undefined,
          finalAuthorityStatus: finalResponse.scenarioState?.authorityStatus,
          finalScenarioType: finalResponse.scenarioState?.scenarioType
        }
      };
      const safeRecord = safeValue(caseRecord, apiKey);
      assertNoCredentialLikeText(safeRecord);
      await appendFile(outputPath, `${JSON.stringify(safeRecord)}\n`, 'utf8');
      completedIds.add(testCase.id);
      originalLog(`[${testCase.id}] provider=${modelCallStatus}; retrieval=${retrievalStatus}; checkpoint saved`);
    }
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
    console.log = originalLog;
  }
  process.stdout.write(`Live validation checkpoints written to ${path.relative(process.cwd(), outputPath)}. API key present: yes.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    // Keep runner failures concise; never dump values sourced from provider headers or credentials.
    process.stderr.write(`${safeText(error?.message || 'Live validation runner failed.', process.env.GEMINI_API_KEY)}\n`);
    process.exitCode = 1;
  });
}
