import { parseAccountingQuery } from './src/engine/scenarioParser.ts';
import { buildGroundedReasoningContext } from './src/services/groundingContextBuilder.ts';
import {
  evaluateFastPathEligibility,
  processAccountingQuery,
  callGeminiAPI
} from './src/services/geminiService.ts';
import { RequestProfiler } from './src/services/telemetry.ts';

const REPRESENTATIVE_QUESTIONS = [
  {
    id: 'Q1',
    category: 'Fast-path statutory',
    expectedPath: 'FAST_PATH',
    title: 'MOM Statutory Annual Leave & Outpatient Sick Leave',
    query: 'What are MOM statutory annual leave and outpatient sick leave entitlements?'
  },
  {
    id: 'Q2',
    category: 'Fast-path statutory',
    expectedPath: 'FAST_PATH',
    title: 'MOM Part IV Overtime Pay Calculation Rules',
    query: 'What are the MOM Part IV overtime pay calculation rules and maximum overtime hours?'
  },
  {
    id: 'Q3',
    category: 'Fast-path statutory',
    expectedPath: 'FAST_PATH',
    title: 'CPF 2026 Ordinary & Additional Wage Ceilings',
    query: 'What are the 2026 CPF Ordinary Wage monthly ceiling and Additional Wage ceiling limits?'
  },
  {
    id: 'Q4',
    category: 'Statutory (NEEDS_REVIEW source -> Gemini)',
    expectedPath: 'GEMINI',
    title: 'ACRA Small Company Audit Exemption Criteria',
    query: 'What are the ACRA Section 205C criteria for small company audit exemption?'
  },
  {
    id: 'Q5',
    category: 'Fast-path statutory',
    expectedPath: 'FAST_PATH',
    title: 'IRAS GST Compulsory Registration Thresholds',
    query: 'What are the compulsory GST registration turnover thresholds under the retrospective and prospective tests?'
  },
  {
    id: 'Q6',
    category: 'Fast-path statutory',
    expectedPath: 'FAST_PATH',
    title: 'IRAS Section 14(1) Entertainment Expense Deductibility',
    query: 'Is business entertainment expense tax deductible under Section 14(1) of the Income Tax Act?'
  },
  {
    id: 'Q7',
    category: 'Gemini interpretation -> deterministic calculation',
    expectedPath: 'GEMINI',
    title: 'SFRS(I) 1-38 Software Capitalization vs Section 14C EIS',
    query: 'A company incurs software development expenditure. When can costs be capitalised under SFRS(I) 1-38 vs claiming the 400% EIS deduction under Section 14C?'
  },
  {
    id: 'Q8',
    category: 'Gemini interpretation -> deterministic calculation',
    expectedPath: 'GEMINI',
    title: 'Office Equipment Purchase with 10% Trade Discount & GST',
    query: 'Purchase of office equipment list price SGD 20,000 with 10% trade discount, 9% GST, paid 5,000 cash and balance on 30-day credit.'
  },
  {
    id: 'Q9',
    category: 'Gemini interpretation -> deterministic calculation',
    expectedPath: 'GEMINI',
    title: 'USD Shares Acquisition & Disposal with Realized FX Gain',
    query: 'A company primary currency is SGD, it invested USD 300k into shares on 13/11/2026, subsequently sold them for USD 400k on 15/12/2026.'
  },
  {
    id: 'Q10',
    category: 'Gemini interpretation -> missing valuation facts (no placeholders)',
    expectedPath: 'GEMINI',
    title: 'Unrecognized Barter Exchange of Assets',
    query: 'We exchanged a delivery truck for specialized machinery with another company. How do we account for this barter trade?'
  }
];

const ITERATIONS = 3;
const API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';

async function benchmarkQuery(qItem) {
  const iterations = [];

  for (let iter = 1; iter <= ITERATIONS; iter++) {
    const profiler = new RequestProfiler(qItem.query, 'gemini-2.5-flash');
    const t0 = performance.now();

    // 1. Deterministic scenario parse
    const tDet0 = performance.now();
    const deterministic = await parseAccountingQuery(qItem.query);
    profiler.recordStage('deterministic_engine', performance.now() - tDet0);

    // 2. Grounded reasoning context
    const tGround0 = performance.now();
    const context = await buildGroundedReasoningContext(qItem.query);
    profiler.recordStage('grounding', performance.now() - tGround0);

    // 3. Fast-path check
    const fastPath = evaluateFastPathEligibility(qItem.query, deterministic, context);

    let pathTaken = 'FAST_PATH';
    let tokens = { in: 0, out: 0, think: 0 };
    let ttfvr = 0;
    let totalMs = 0;

    if (fastPath.canBypass) {
      pathTaken = 'FAST_PATH';
      ttfvr = performance.now() - t0;
      totalMs = performance.now() - t0;
      profiler.recordFirstVisibleResponse();
      profiler.setTokenCounts(0, 0, 0);
    } else {
      pathTaken = 'GEMINI';
      if (API_KEY && API_KEY.length > 10) {
        try {
          const res = await callGeminiAPI(
            qItem.query,
            null,
            'SFRS_I',
            API_KEY,
            'gemini-2.5-flash',
            [],
            context,
            deterministic,
            profiler
          );
          totalMs = performance.now() - t0;
          ttfvr = profiler.metrics.time_to_first_visible_ms || totalMs;
          tokens = {
            in: profiler.metrics.gemini_input_tokens || 0,
            out: profiler.metrics.gemini_output_tokens || 0,
            think: profiler.metrics.thinking_tokens || 0
          };
        } catch (err) {
          totalMs = performance.now() - t0;
          ttfvr = totalMs;
          tokens = { in: 0, out: 0, think: 0 };
        }
      } else {
        // Mocking / Offline fallback when API key not set in terminal
        totalMs = performance.now() - t0;
        ttfvr = totalMs;
        tokens = { in: 0, out: 0, think: 0 };
      }
    }

    iterations.push({
      iteration: iter,
      pathTaken,
      ttfvr: Math.round(ttfvr * 100) / 100,
      totalMs: Math.round(totalMs * 100) / 100,
      tokens
    });
  }

  const ttfvrValues = iterations.map(i => i.ttfvr);
  const totalValues = iterations.map(i => i.totalMs);

  return {
    qItem,
    pathTaken: iterations[0].pathTaken,
    iterations,
    ttfvrP50: RequestProfiler.calculatePercentiles(ttfvrValues).p50,
    ttfvrP95: RequestProfiler.calculatePercentiles(ttfvrValues).p95,
    totalP50: RequestProfiler.calculatePercentiles(totalValues).p50,
    totalP95: RequestProfiler.calculatePercentiles(totalValues).p95,
    tokens: iterations[0].tokens
  };
}

async function runBenchmark() {
  console.log('================================================================');
  console.log('SIDE QUEST 1.1: REAL LATENCY & WORKLOAD BENCHMARK');
  console.log(`Model Target: gemini-2.5-flash | Iterations per question: ${ITERATIONS}`);
  console.log(`Live API Key configured: ${API_KEY ? 'YES (Live Gemini API Calls)' : 'NO (Fast-Path Real / LLM Offline Path)'}`);
  console.log('================================================================\n');

  const benchmarkResults = [];

  for (const q of REPRESENTATIVE_QUESTIONS) {
    process.stdout.write(`Benchmarking [${q.id}] ${q.title.slice(0, 45)}... `);
    const result = await benchmarkQuery(q);
    benchmarkResults.push(result);
    console.log(`Path: ${result.pathTaken} | TTFVR p50: ${result.ttfvrP50}ms | Total p50: ${result.totalP50}ms | Tokens (In/Out/Think): ${result.tokens.in}/${result.tokens.out}/${result.tokens.think}`);
  }

  console.log('\n========================================================================================================================');
  console.log('| ID  | Title                                    | Path      | TTFVR p50 | TTFVR p95 | Total p50 | Total p95 | Tokens (I/O/T)  |');
  console.log('========================================================================================================================');

  for (const r of benchmarkResults) {
    const id = r.qItem.id.padEnd(3);
    const title = r.qItem.title.slice(0, 40).padEnd(40);
    const path = r.pathTaken.padEnd(9);
    const ttfvrP50 = `${r.ttfvrP50}ms`.padStart(9);
    const ttfvrP95 = `${r.ttfvrP95}ms`.padStart(9);
    const totalP50 = `${r.totalP50}ms`.padStart(9);
    const totalP95 = `${r.totalP95}ms`.padStart(9);
    const tokStr = `${r.tokens.in}/${r.tokens.out}/${r.tokens.think}`.padStart(15);
    console.log(`| ${id} | ${title} | ${path} | ${ttfvrP50} | ${ttfvrP95} | ${totalP50} | ${totalP95} | ${tokStr} |`);
  }

  console.log('========================================================================================================================\n');

  // Overall Statistics
  const allTtfvr = benchmarkResults.map(r => r.ttfvrP50);
  const allTotal = benchmarkResults.map(r => r.totalP50);
  const fastPathCount = benchmarkResults.filter(r => r.pathTaken === 'FAST_PATH').length;
  const geminiCount = benchmarkResults.filter(r => r.pathTaken === 'GEMINI').length;

  console.log('--- WORKLOAD REDUCTION SUMMARY ---');
  console.log(`Total Questions Benchmarked:    ${benchmarkResults.length}`);
  console.log(`Zero-LLM Fast-Path Questions:   ${fastPathCount} (${Math.round(fastPathCount / benchmarkResults.length * 100)}% workload bypassed with 0 tokens)`);
  console.log(`Gemini Reasoning Questions:     ${geminiCount} (routes to LLM for interpretation / proposal)`);
  console.log(`Overall Fast-Path TTFVR p50:    ${RequestProfiler.calculatePercentiles(benchmarkResults.filter(r => r.pathTaken === 'FAST_PATH').map(r => r.ttfvrP50)).p50}ms`);
  console.log(`Overall Benchmark Latency p50:  ${RequestProfiler.calculatePercentiles(allTotal).p50}ms`);
  console.log(`Overall Benchmark Latency p95:  ${RequestProfiler.calculatePercentiles(allTotal).p95}ms\n`);
}

runBenchmark().catch(err => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
