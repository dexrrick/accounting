import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const testSuites = [
  { name: 'AI Semantic Extraction & Schema Validation Gate', file: 'test_ai_semantic_extraction.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'Semantic Understanding & Routing', file: 'test_sidequest2_semantic_understanding.mjs', layer: 'input-understanding', tier: 'full' },
  { name: 'Multi-Turn Accounting State & Follow-Ups', file: 'test_followup_accounting_state.mjs', layer: 'conversation-state', tier: 'smoke' },
  { name: 'Phase 5 Integration & Semantics', file: 'test_sidequest2_phase5_integration.mjs', layer: 'retrieval-evidence', tier: 'full' },
  { name: 'Topic Resolver Semantics & Provenance Separation', file: 'test_topic_resolver_and_provenance.mjs', layer: 'retrieval-evidence', tier: 'full' },
  { name: 'Projection Builder No-Fabrication Invariants', file: 'test_projection_builder_invariants.mjs', layer: 'accounting-invariants', tier: 'smoke' },
  { name: 'Payroll Amount Correction & CPF Journal', file: 'test_payroll_followup_correction.mjs', layer: 'conversation-state', tier: 'full' },
  { name: 'Conversational Payroll and Chat Presentation', file: 'test_conversational_payroll_and_chat.mjs', layer: 'ux-resilience', tier: 'smoke' },
  { name: 'Generic Fact Amendment Resolution', file: 'test_fact_amendment_service.mjs', layer: 'conversation-state', tier: 'full' },
  { name: 'Own-Equity versus Payroll Routing', file: 'test_own_equity_routing.mjs', layer: 'accounting-invariants', tier: 'full' },
  { name: 'Semantic Routing Priority', file: 'test_semantic_routing_priority.mjs', layer: 'input-understanding', tier: 'full' },
  { name: 'Share Capital Consideration & Settlement', file: 'test_share_capital_payment_followup.mjs', layer: 'conversation-state', tier: 'full' },
  { name: 'Phase 5 Advanced Hybrid Retrieval & Vector Index', file: 'test_phase5_advanced_retrieval.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'Labelled Retrieval Quality Evaluation', file: 'test_retrieval_quality_evaluation.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'Provider Boundary Safety', file: 'test_provider_boundary_safety.mjs', layer: 'provider-resilience', tier: 'smoke' },
  { name: 'Official Source Failure Safety', file: 'test_official_source_failure_safety.mjs', layer: 'provider-resilience', tier: 'smoke' },
  { name: 'Phase 7 Coverage Registry', file: 'test_phase7_coverage_registry.mjs', layer: 'coverage-governance', tier: 'full' },
  { name: 'Phase 4 Live Retrieval & Source Versioning', file: 'test_phase4_live_retrieval.mjs', layer: 'regulatory-updates', tier: 'full' },
  { name: 'Coverage & Temporal Invariants', file: 'test_phase3_coverage.mjs', layer: 'retrieval-evidence', tier: 'full' },
  { name: 'Sidequest Correction Pass', file: 'test_sidequest_correction.mjs', layer: 'accounting-invariants', tier: 'full' },
  { name: 'Fast-Path Grounding', file: 'test_sidequest_1_1.mjs', layer: 'retrieval-evidence', tier: 'full' },
  { name: 'Performance Architecture & Telemetry', file: 'test_performance_architecture.mjs', layer: 'ux-resilience', tier: 'full' },
  { name: 'Grounded Reasoning & Citations', file: 'test_grounded_reasoning.mjs', layer: 'retrieval-evidence', tier: 'full' },
  { name: 'Source-Backed Foundation', file: 'test_source_backed_architecture.mjs', layer: 'retrieval-evidence', tier: 'full' },
  { name: 'Singapore Statutory Engine', file: 'test_statutory_engine.mjs', layer: 'accounting-invariants', tier: 'full' },
  { name: 'Universal Accounting Engine & FX', file: 'test_universal.mjs', layer: 'accounting-invariants', tier: 'full' }
];

function runCommand(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: false
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });

    child.on('error', (err) => {
      console.error(`Failed to execute ${cmd}:`, err);
      resolve(false);
    });
  });
}

async function main() {
  const tierArgument = process.argv.find(arg => arg.startsWith('--tier='));
  const requestedTier = tierArgument?.split('=')[1] || 'full';
  if (!['smoke', 'full'].includes(requestedTier)) {
    console.error(`Unknown test tier '${requestedTier}'. Use --tier=smoke or --tier=full.`);
    process.exit(2);
  }
  const suitesToRun = requestedTier === 'smoke'
    ? testSuites.filter(suite => suite.tier === 'smoke')
    : testSuites;

  console.log('================================================================');
  console.log(`🚀 RUNNING ${requestedTier.toUpperCase()} ACCOUNTING & STATUTORY REGRESSION SUITE`);
  console.log('================================================================\n');

  const startTime = Date.now();
  const results = [];

  for (const suite of suitesToRun) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`▶ Running: [${suite.layer}] ${suite.name} (${suite.file})`);
    console.log(`----------------------------------------------------------------`);

    const suiteStart = Date.now();
    const passed = await runCommand(process.execPath, [tsxCli, suite.file], projectRoot);
    const duration = ((Date.now() - suiteStart) / 1000).toFixed(2);

    results.push({
      ...suite,
      passed,
      duration: `${duration}s`
    });

    if (!passed) {
      console.error(`\n❌ FAILED: ${suite.name} (${suite.file})`);
    } else {
      console.log(`\n✅ PASSED: ${suite.name} [${duration}s]`);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  const allPassed = results.every(r => r.passed);

  console.log('\n================================================================');
  console.log('📊 REGRESSION SUITE EXECUTION SUMMARY');
  console.log('================================================================');
  for (const r of results) {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} | ${r.layer.padEnd(22)} | ${r.name.padEnd(42)} | ${r.duration.padStart(6)}`);
  }
  console.log('----------------------------------------------------------------');
  console.log(`Total Duration: ${totalDuration}s`);
  console.log(`Final Status: ${allPassed ? 'ALL SUITES PASSED (100% GREEN) 🎉' : 'FAILURES DETECTED ❌'}`);
  console.log('================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
