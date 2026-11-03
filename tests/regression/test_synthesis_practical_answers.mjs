import assert from 'node:assert/strict';
import { UNIFIED_SOURCE_REGISTRY } from '../../src/standards/unifiedSourceModel.ts';
import { tryGenerateGroundedSynthesis } from '../../src/services/evidenceGroundedSynthesis.ts';

// Independently worded client questions and practical answers, not model output.
// Tests synthesis acceptance after upstream admission, not retrieval or legal/model quality.
const cases = [
  {
    authority: 'IRAS', domain: 'IRAS_GST', population: 'COMPANY', record: 'GST_REG26_BLOCKED_INPUT_TAX',
    query: 'Our purchase falls within a blocked input tax category and no exception applies, but we used it for business. Can business use override that block?',
    answer: 'Business purpose alone does not make this blocked claim recoverable. Check for an applicable exception before treating the input tax as recoverable.'
  },
  {
    authority: 'CPF', domain: 'CPF_PAYROLL', population: 'EMPLOYEE', record: 'CPFA_SEC7_FIRST_SCHEDULE',
    query: 'We employ a covered employee in Singapore. Does the employee have to deal with the monthly CPF payment, or is the employer responsible?',
    answer: 'The employer is responsible for paying monthly contributions to the Fund for the employee. Payroll should distinguish the employee share from the total contribution payable.'
  },
  {
    authority: 'MOM', domain: 'MOM_EMPLOYMENT', population: 'EMPLOYEE', record: 'MOM_SEC21_SALARY_TIMELINES',
    query: 'Our covered employee worked overtime in the salary period. Should payroll treat ordinary salary and overtime as separate payment deadlines?',
    answer: 'Payroll should track ordinary salary and overtime separately because their payment deadlines differ. Check both deadlines for the salary period before arranging payment.'
  },
  {
    authority: 'ACRA', domain: 'ACRA_CORPORATE', population: 'COMPANY', record: 'ACRA_SEC171_COMPANY_SECRETARY',
    query: 'She is the sole director of our Singapore company and wants to act as its secretary too. Can the company appoint her?',
    answer: 'The sole director cannot also be the company secretary. Appoint a different eligible secretary who satisfies the Singapore residency requirement.'
  },
  {
    authority: 'MAS', domain: 'MAS_FUNDS', population: 'COMPANY', record: 'MAS_FMC_CMS_LICENSING',
    query: 'Our Singapore business plans to conduct regulated fund management. What should we establish before starting the activity?',
    answer: 'Before starting regulated fund management in Singapore, establish whether a Capital Markets Services licence, registration, or an applicable statutory or MAS exemption is needed.'
  }
];

for (const [index, example] of cases.entries()) {
  const record = UNIFIED_SOURCE_REGISTRY[example.record];
  assert.ok(record?.sourceText, `${example.authority} uses an existing authoritative record`);
  const issueId = `practical-${example.authority.toLowerCase()}`;
  const issue = {
    issueId, subject: example.query, domain: example.domain, population: example.population,
    operation: 'CHECK_ELIGIBILITY', evidenceRequirement: 'AUTHORITATIVE_SOURCE_AND_CASE_FACTS',
    governingAuthority: example.authority, sourceSections: [], lifecycle: {},
    evidenceStatus: 'VERIFIED', applicationStatus: 'VERIFIED', gaps: [], sources: [record],
    verifiedClaims: [{recordId: record.id, quote: record.sourceText, text: record.sourceText,
      supportKind: 'EXACT_SOURCE_QUOTE', canonicalUrl: record.canonicalSourceUrl}]
  };
  let reviewCount = 0;
  const result = await tryGenerateGroundedSynthesis({
    query: example.query, standard: 'SFRS_I', history: [],
    provider: {activeProvider:'openai',openai:{apiKey:'mock-practical-acceptance',model:'mock'},gemini:{},azure:{}},
    response: {scenarioState: {scenarioType:'UNRECOGNIZED',rawQuery:example.query,
      functionalCurrency:'SGD',transactionCurrency:'SGD',directGroups:[],missingFields:[],missingFacts:[],isComplete:true}},
    workstreams: {query:example.query,issuePlan:{issues:[{id:issueId,subject:issue.subject,domain:issue.domain,
      operation:issue.operation,evidenceRequirement:issue.evidenceRequirement}]},requestCompletenessContext:{},
      workstreams:[{id:`practical-stream-${index}`,authority:example.authority,domain:example.domain,
        populations:[example.population],issues:[issue],sources:[record],verifiedClaims:issue.verifiedClaims,
        sourceSections:[],evidenceStatus:'VERIFIED',applicationStatus:'VERIFIED',gaps:[]}],
      evidenceStatus:'VERIFIED',applicationStatus:'VERIFIED',status:'VERIFIED',gaps:[]}
  }, {call: async (prompt, system) => {
    const packet = JSON.parse(prompt);
    if (system.includes('TARGETED_REVISION')) assert.fail('a supported practical answer needs no repair');
    if (system.includes('EVIDENCE_GROUNDED_REVIEW')) {
      reviewCount += 1;
      return JSON.stringify({verdicts:packet.claims.map(claim => ({claimId:claim.id,verdict:'SUPPORTED',
        supportingEvidenceIds:claim.supportIds,supportingFactRefs:claim.factRefs,
        reason:'The practical application follows the supplied issue facts and source.'}))});
    }
    assert.match(system, /State verified conclusions confidently/);
    assert.match(system, /practical next steps/);
    assert.equal(packet.requestedIssues[0].id, issueId);
    return JSON.stringify({claims:[{id:`answer-${index}`,kind:'APPLICATION',text:example.answer,
      supportIds:[packet.evidencePassages[0].id],factRefs:['fact-current-question'],issueId}]});
  }});
  assert.ok(result, `${example.authority} yields an answer`);
  assert.ok(result.messageText.includes(example.answer), `${example.authority} retains a complete practical application`);
  assert.equal(reviewCount, 1, 'every practical answer receives independent model assessment');
  assert.equal(result.verification.withheldClaimIds.length, 0);
  assert.doesNotMatch(result.messageText, /remains unresolved|could not be supported|still needed/i,
    'a fully supported answer avoids unnecessary generic warnings');
}

console.log('Practical synthesis acceptance passed for IRAS, CPF, MOM, ACRA and MAS (scripted providers; not real-model quality).');
