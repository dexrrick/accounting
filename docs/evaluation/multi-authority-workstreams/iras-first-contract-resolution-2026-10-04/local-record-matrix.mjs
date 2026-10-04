import { readFile, writeFile } from 'node:fs/promises';
import { loadIrasFirstV2TargetedCases } from '../../../../tests/evaluation/singapore/semantic-contract-followup-evaluation.mjs';
import { getCoverageTopicsByIds } from '../../../../src/standards/coverageRegistry.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../../../../src/standards/unifiedSourceModel.ts';
import { getRequestedQuestionConcepts, validateSemanticQuestionInterpretation } from '../../../../src/services/semanticQuestionUnderstanding.ts';
import { findRecordEligibilityRejection } from '../../../../src/verification/claimEvidenceVerifier.ts';
const capture = JSON.parse(await readFile(new URL('../iras-first-targeted-acceptance-2026-10-03-v3/acceptance-v3.json', import.meta.url), 'utf8'));
const templates = await loadIrasFirstV2TargetedCases();
const cases = templates.map(testCase => {
  const observed = capture.cases.find(item=>item.caseId===testCase.id);
  const first = testCase.expected.find(item=>item.governingAuthorities.includes('IRAS')) || testCase.expected[0];
  const issues = testCase.expected.map(item=>({subject:item.subject,population:item.population[0],domain:item.domain[0],governingAuthorities:item.governingAuthorities,contextualAuthorities:item.contextualAuthoritiesAnyOf[0],operation:item.operation[0],mappedTopicIds:[],evidenceRequirement:'AUTHORITATIVE_SOURCE',confidence:0.96}));
  const interpretation = validateSemanticQuestionInterpretation({schemaVersion:2,jurisdiction:['Singapore'],authorityCandidates:first.governingAuthorities,contextualAuthorities:first.contextualAuthoritiesAnyOf[0],domain:first.domain[0],population:first.population[0],primarySubject:first.subject,concepts:issues.map(issue=>({concept:issue.subject,role:'PRIMARY'})),requestedOperation:first.operation[0],factsExplicitlyProvided:[],confidence:0.96,issues},testCase.question);
  if (!interpretation) throw new Error(`Invalid controlled scope mock: ${testCase.id}`);
  const topicIds = observed.additionalGates.independentInventory.topicIds;
  return {
    caseId:testCase.id,
    independentInventoryTopicIds:topicIds,
    explicitlyRetainedTopicRows:observed.additionalGates.topicRows,
    historicalRequestedConceptIds:null,
    historicalRawCandidateRecordIds:null,
    historicalRawClaimQuotes:null,
    reason:'Those fields were intentionally not retained. The following requested concepts are from validated deterministic expected-scope mocks, not reconstructed Gemini output.',
    controlledMockRequestedConcepts:getRequestedQuestionConcepts(testCase.question,interpretation),
    localRegistryTopics:getCoverageTopicsByIds(topicIds).map(topic=>({
      topicId:topic.id,routingOnly:topic.routingOnly===true,
      sourceRecordIds:topic.sourceRecordIds,
      records:topic.sourceRecordIds.map(id=>{
        const record=UNIFIED_SOURCE_REGISTRY[id];
        return record ? {id,sourceStatus:record.sourceStatus,recordRole:record.recordRole||null,sourceType:record.sourceType,evidenceTier:record.evidenceTier,groundingEligible:record.groundingEligible!==false,eligibilityRejection:findRecordEligibilityRejection(record,undefined,'2026-10-03')||null,sourceText:record.sourceText} : {id,missing:true};
      })
    }))
  };
});
const result={protocol:'API_FREE_LOCAL_INVENTORY_WITH_EXPLICIT_MOCK_CONCEPTS',historicalCaptureUnmodified:true,sourceMode:'CURRENT_REVIEWED_LOCAL_REGISTRY_NO_EXTERNAL_FETCH',cases};
await writeFile(new URL('./local-record-matrix.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{encoding:'utf8',flag:'wx'});
console.log(`Saved ${cases.length}-case local-record matrix; historical subjects/concepts/quotes remain unretained.`);
