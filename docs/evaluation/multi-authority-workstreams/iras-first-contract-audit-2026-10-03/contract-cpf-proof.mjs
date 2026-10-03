import { classifyQuestion } from '../../../../src/classification/questionClassifier.ts';
import { reconcileQuestionUnderstanding, interpretSemanticQuestion, getRequestedQuestionConcepts } from '../../../../src/services/semanticQuestionUnderstanding.ts';
import { defaultQueryTopicResolver } from '../../../../src/retrieval/queryTopicResolver.ts';
const questions = [
  ['Can I claim personal tax relief on my compulsory CPF contributions?', 'CHECK_ELIGIBILITY', 'IRAS', 'IRAS_INCOME_TAX', 'INDIVIDUAL', 'personal tax relief for compulsory CPF contributions'],
  ['How much personal tax relief can I claim for my compulsory CPF contributions?', 'CALCULATE', 'IRAS', 'IRAS_INCOME_TAX', 'INDIVIDUAL', 'personal tax relief amount for compulsory CPF contributions'],
  ['What must the employer pay into CPF for an employee earning SGD 6,000 a month?', 'CALCULATE', 'CPF', 'CPF_PAYROLL', 'EMPLOYER', 'employer CPF contribution amount'],
];
for (const [query, operation, authority, domain, population, subject] of questions) {
 const payload = {schemaVersion:2,jurisdiction:['Singapore'],authorityCandidates:[authority],contextualAuthorities:authority === 'IRAS' ? ['CPF'] : [],domain,population,primarySubject:subject,concepts:[{concept:subject,role:'PRIMARY'}],requestedOperation:operation,factsExplicitlyProvided:[],confidence:0.96,issues:[{subject,population,domain,governingAuthorities:[authority],contextualAuthorities:authority === 'IRAS' ? ['CPF'] : [],operation,mappedTopicIds:[],evidenceRequirement:'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',confidence:0.96}]};
 const understanding = await interpretSemanticQuestion(query, 'offline-mock', async()=>JSON.stringify(payload));
 const r = reconcileQuestionUnderstanding(query,classifyQuestion(query),understanding);
 console.log(JSON.stringify({query,mode:understanding.mode,inventory:defaultQueryTopicResolver.decomposeQuery(query).topics.map(t=>t.id),concepts:getRequestedQuestionConcepts(query,understanding),issues:r.issuePlan.issues.map(i=>({subject:i.subject,topics:i.mappedTopicIds,reason:i.unresolvedReason})),complete:r.issuePlan.coverageEstablished}));
}
