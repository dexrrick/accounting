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
  { name: 'MAS / IRAS Multi-authority Fund Incentive Routing', file: 'test_mas_funds_routing.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'Share Capital Consideration & Settlement', file: 'test_share_capital_payment_followup.mjs', layer: 'conversation-state', tier: 'full' },
  { name: 'Phase 5 Advanced Hybrid Retrieval & Vector Index', file: 'test_phase5_advanced_retrieval.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'Authority and Domain Conjunctive Retrieval', file: 'test_retrieval_authority_domain_conjunction.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'Labelled Retrieval Quality Evaluation', file: 'test_retrieval_quality_evaluation.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'Provider Boundary Safety', file: 'test_provider_boundary_safety.mjs', layer: 'provider-resilience', tier: 'smoke' },
  { name: 'Official Source Failure Safety', file: 'test_official_source_failure_safety.mjs', layer: 'provider-resilience', tier: 'smoke' },
  { name: 'Phase 7 Coverage Registry', file: 'test_phase7_coverage_registry.mjs', layer: 'coverage-governance', tier: 'full' },
  { name: 'Singapore Knowledge Routing Benchmark', file: 'test_singapore_knowledge_benchmark.mjs', layer: 'coverage-governance', tier: 'smoke' },
  { name: 'Singapore Knowledge Foundation Registry and Routing', file: 'test_singapore_knowledge_foundation.mjs', layer: 'coverage-governance', tier: 'smoke' },
  { name: 'Singapore Consolidation Source Map and Local Routing', file: 'test_singapore_consolidation_source_map.mjs', layer: 'coverage-governance', tier: 'smoke' },
  { name: 'Verified Official Citation and Source-Map Fallback', file: 'test_verified_official_citation_fallback.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'SFRS(I) 9 Reviewed Knowledge Pack', file: 'test_sfrsi9_knowledge_pack.mjs', layer: 'accounting-invariants', tier: 'smoke' },
  { name: 'Corporate Tax Treatment Pack', file: 'test_corporate_tax_treatment.mjs', layer: 'corporate-tax', tier: 'smoke' },
  { name: 'Phase 7 Remaining Topic Packs', file: 'test_phase7_remaining_packs.mjs', layer: 'coverage-governance', tier: 'full' },
  { name: 'Regulatory Update Scheduler', file: 'test_regulatory_update_scheduler.mjs', layer: 'regulatory-updates', tier: 'smoke' },
  { name: 'Personal Fine Conversation Boundary', file: 'test_conversation_boundary_personal_fine.mjs', layer: 'conversation-state', tier: 'smoke' },
  { name: 'Personal Fine Clarification & Journal Follow-Ups', file: 'test_director_personal_fine_followup.mjs', layer: 'conversation-state', tier: 'smoke' },
  { name: 'Conversation Relation Failsafe', file: 'test_conversation_relation_failsafe.mjs', layer: 'conversation-state', tier: 'smoke' },
  { name: 'GST Registration Measurement-Basis Follow-Up', file: 'test_gst_registration_measurement_basis.mjs', layer: 'conversation-state', tier: 'smoke' },
  { name: 'Deferred Tax Standards Boundary', file: 'test_deferred_tax_boundary.mjs', layer: 'conversation-state', tier: 'smoke' },
  { name: 'Official Tax Source Links', file: 'test_official_tax_source_links.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'Business Equipment Acquisition', file: 'test_business_equipment_acquisition.mjs', layer: 'accounting-invariants', tier: 'smoke' },
  { name: 'Inventory Event Sequence', file: 'test_event_sequence_inventory.mjs', layer: 'accounting-invariants', tier: 'smoke' },
  { name: 'Sale and Leaseback Event Sequence', file: 'test_sale_leaseback_sequence.mjs', layer: 'accounting-invariants', tier: 'smoke' },
  { name: 'Mixed-Domain Event Sequence', file: 'test_mixed_event_sequence.mjs', layer: 'accounting-invariants', tier: 'smoke' },
  { name: 'Investment Event Sequence', file: 'test_investment_event_sequence.mjs', layer: 'accounting-invariants', tier: 'smoke' },
  { name: 'Dated Investment Event Sequence', file: 'test_dated_investment_sequence.mjs', layer: 'accounting-invariants', tier: 'smoke' },
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
    const passed = await runCommand(process.execPath, [tsxCli, path.join('tests', 'regression', suite.file)], projectRoot);
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
