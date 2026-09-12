import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const testSuites = [
  { name: '0A. AI Semantic Extraction & Schema Validation Gate', file: 'test_ai_semantic_extraction.mjs' },
  { name: '0B. Side Quest 2 Semantic Understanding & Routing', file: 'test_sidequest2_semantic_understanding.mjs' },
  { name: '0C. Side Quest 3 Multi-Turn Accounting State & Follow-Ups', file: 'test_followup_accounting_state.mjs' },
  { name: '0D. Side Quest 2 → Phase 5 Integration & Semantics', file: 'test_sidequest2_phase5_integration.mjs' },
  { name: '0E. Topic Resolver Semantics & Provenance Separation', file: 'test_topic_resolver_and_provenance.mjs' },
  { name: '0F. Projection Builder No-Fabrication Invariants', file: 'test_projection_builder_invariants.mjs' },
  { name: '0G. Payroll Amount Correction & CPF Journal', file: 'test_payroll_followup_correction.mjs' },
  { name: '1. Phase 5 Advanced Hybrid Retrieval & Vector Index', file: 'test_phase5_advanced_retrieval.mjs' },
  { name: '2. Phase 4 Live Retrieval & Source Versioning', file: 'test_phase4_live_retrieval.mjs' },
  { name: '3. Phase 3 Coverage & Temporal Invariants', file: 'test_phase3_coverage.mjs' },
  { name: '4. Sidequest Correction Pass', file: 'test_sidequest_correction.mjs' },
  { name: '5. Sidequest 1.1 Fast-Path Grounding', file: 'test_sidequest_1_1.mjs' },
  { name: '6. Performance Architecture & Telemetry', file: 'test_performance_architecture.mjs' },
  { name: '7. Phase 2 Grounded Reasoning & Citations', file: 'test_grounded_reasoning.mjs' },
  { name: '8. Phase 1 Source-Backed Foundation', file: 'test_source_backed_architecture.mjs' },
  { name: '9. Singapore Statutory Engine', file: 'test_statutory_engine.mjs' },
  { name: '10. Universal Accounting Engine & FX', file: 'test_universal.mjs' }
];

function runCommand(cmd, args, cwd) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const child = spawn(isWindows ? `${cmd}.cmd` : cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: isWindows
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
  console.log('================================================================');
  console.log('🚀 RUNNING COMPLETE ACCOUNTING & STATUTORY REGRESSION TEST SUITE');
  console.log('================================================================\n');

  const startTime = Date.now();
  const results = [];

  for (const suite of testSuites) {
    console.log(`\n----------------------------------------------------------------`);
    console.log(`▶ Running: ${suite.name} (${suite.file})`);
    console.log(`----------------------------------------------------------------`);

    const suiteStart = Date.now();
    const passed = await runCommand('npx', ['tsx', suite.file], projectRoot);
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
    console.log(`${status} | ${r.name.padEnd(46)} | ${r.duration.padStart(6)}`);
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
