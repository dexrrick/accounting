import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const tsxCli = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const testSuites = [
  { name: 'AI Semantic Extraction & Schema Validation Gate', file: 'test_ai_semantic_extraction.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'Semantic Question Understanding & Guarded Routing', file: 'test_semantic_question_understanding.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'Per-Issue Semantic Operation Contracts', file: 'test_semantic_operations.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'Semantic Operation Intent Boundaries', file: 'test_semantic_intent_boundaries.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'Semantic Intent Follow-Up Runner', file: 'test_semantic_intent_followup_runner.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'Semantic Authority & Relief Evaluation Safety', file: 'test_semantic_authority_relief_evaluation.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'IRAS-First Release Gate', file: 'test_iras_first_release_gate.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'IRAS-First Runner Safety', file: 'test_iras_first_runner_safety.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'Semantic Authority & Relief Contract', file: 'test_semantic_authority_relief_contract.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'IRAS-First Semantic Contract', file: 'test_iras_first_semantic_contract.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'Application-Derived Semantic Specificity', file: 'test_derived_semantic_specificity.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'IRAS Natural-Language Topic Resolution', file: 'test_iras_natural_language_resolution.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS V2 Measurement and Timeout Safety', file: 'test_iras_v2_measurement_safety.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'Versioned Semantic Question Wire Contract', file: 'test_semantic_wire_contract.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'Semantic Provider JSON Schema & Wire Contract', file: 'test_semantic_provider_schema.mjs', layer: 'provider-resilience', tier: 'smoke' },
  { name: 'Semantic Wire-Format Evaluation Profile Safety', file: 'test_semantic_wire_format_evaluation.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'Semantic Contract Follow-Up Runner', file: 'test_semantic_contract_followup_runner.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'Material Issue Decomposition & Authority Ownership', file: 'test_material_issue_decomposition.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'Authority Workstream Evidence Isolation & Coverage', file: 'test_authority_workstreams.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Multi-authority Local Evidence Stages V4', file: 'test_iras_multi_authority_evidence_v4.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'Semantic Residency Subject Diagnostic V4', file: 'test_semantic_residency_subject_diagnostic_v4.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'IRAS Mapped Evidence Diagnostic V4', file: 'test_iras_mapped_evidence_diagnostic_v4.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'IRAS Mapped Evidence Diagnostic V5', file: 'test_iras_mapped_evidence_diagnostic_v5.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'IRAS Mapped Evidence Diagnostic V8', file: 'test_iras_mapped_evidence_diagnostic_v8.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'IRAS Public GST Selection V3', file: 'test_iras_public_gst_selection_v3.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'IRAS Source Term Compatibility', file: 'test_iras_source_term_compatibility.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS General Rule Concept Support', file: 'test_iras_rule_concept_support.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Public Rule Forms', file: 'test_iras_public_rule_forms.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Defined Foreign-income Rule', file: 'test_iras_foreign_defined_income_rule.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Supported Rule Quote Priority', file: 'test_iras_rule_quote_priority.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS WHT Overview Topic Binding', file: 'test_iras_wht_overview_topic_binding.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Scoped Concept Coverage', file: 'test_iras_scoped_concept_coverage.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Requested Concept Fallback', file: 'test_iras_requested_concept_fallback.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Shared Page Claim Bindings', file: 'test_iras_shared_page_claim_bindings.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'Multi-authority Issue Scoring', file: 'test_multi_authority_issue_scoring.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'Multi-authority Evaluation Runner Output Safety', file: 'test_multi_authority_runner_safety.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'Semantic Reliability Experiment Harness', file: 'test_semantic_reliability_experiment.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'Semantic Residency Diagnostic V3 Safety', file: 'test_semantic_residency_diagnostic.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'Semantic Contract Diagnostics & Capture Runner Safety', file: 'test_semantic_contract_diagnostics.mjs', layer: 'evaluation-safety', tier: 'smoke' },
  { name: 'Resolver Coverage Contract & Compound Issue Isolation', file: 'test_resolver_coverage_contract.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'Whole-Question Authority Evidence Presentation', file: 'test_authority_evidence_presentation.mjs', layer: 'ux-resilience', tier: 'smoke' },
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
  { name: 'Gemini Provider Diagnostics Safety', file: 'test_gemini_provider_diagnostics.mjs', layer: 'provider-resilience', tier: 'smoke' },
  { name: 'Feedback Build Metadata', file: 'test_feedback_build_metadata.mjs', layer: 'ux-resilience', tier: 'smoke' },
  { name: 'Official Source Failure Safety', file: 'test_official_source_failure_safety.mjs', layer: 'provider-resilience', tier: 'smoke' },
  { name: 'Official Source Same-Origin Proxy & Feedback Diagnostics', file: 'test_official_source_proxy.mjs', layer: 'provider-resilience', tier: 'smoke' },
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
  { name: 'IRAS Missing Fact Guards', file: 'test_iras_missing_fact_guards.mjs', layer: 'input-understanding', tier: 'smoke' },
  { name: 'IRAS Verified Source Map and Fallback', file: 'test_iras_source_map.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Mapped Source Diagnostic V3 Safety', file: 'test_iras_mapped_source_diagnostic.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Authority-level Discovery Progression', file: 'test_iras_authority_discovery.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS End-to-End Routing and Retrieval', file: 'test_iras_e2e_routing.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Evidence Quality Gate and Ranking', file: 'test_iras_evidence_quality_gate.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Claim-to-Evidence Verification', file: 'test_iras_claim_evidence_verifier.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS HTML Evidence Boundaries', file: 'test_iras_html_evidence_boundaries.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Evidence Policy Pipeline', file: 'test_iras_evidence_pipeline.mjs', layer: 'retrieval-evidence', tier: 'smoke' },
  { name: 'IRAS Deterministic Applications', file: 'test_iras_application_evaluator.mjs', layer: 'corporate-tax', tier: 'smoke' },
  { name: 'Verified Source-Driven GST Calculation', file: 'test_verified_gst_calculation.mjs', layer: 'accounting-invariants', tier: 'smoke' },
  { name: 'IRAS Provisional Answer Pipeline', file: 'test_iras_end_to_end_provisional.mjs', layer: 'retrieval-evidence', tier: 'full' },
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
