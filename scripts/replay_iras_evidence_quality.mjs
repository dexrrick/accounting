// Offline admission audit against the original real-provider/source captures.
// No network, provider, or credential access. This is not a new live E2E pass.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { evaluateEvidenceQuality } from '../src/retrieval/evidenceQualityGate.ts';
import { UNIFIED_SOURCE_REGISTRY } from '../src/standards/unifiedSourceModel.ts';
import { verifyEvidenceClaims } from '../src/verification/claimEvidenceVerifier.ts';

globalThis.fetch=async()=>{throw new Error('Network is forbidden in captured-evidence admission audit');};
const root='docs/evaluation/iras-live-2026-09-26';
const readRows=async file=>(await readFile(`${root}/${file}`,'utf8')).trim().split(/\r?\n/).map(JSON.parse).filter(row=>row.recordType==='case');
const attempts=[...await readRows('iras-e2e-captures.jsonl'),...await readRows('isolated-provider-check.jsonl'),...await readRows('bounded-retries.jsonl')];
const original=JSON.parse(await readFile(`${root}/assessment.json`,'utf8'));
const latest=new Map(attempts.map(row=>[row.caseId,row]));
const identity=url=>{const u=new URL(url);u.hash='';u.pathname=u.pathname.replace(/%28/gi,'(').replace(/%29/gi,')');return u.href;};
const cases=original.cases.map(review=>{
  const capture=latest.get(review.caseId);
  const context=capture.groundingContextSupplied;
  const records=context.evidence.map(record=>{
    const local=UNIFIED_SOURCE_REGISTRY[record.id];
    if(local){
      if(local.sourceText!==record.sourceText||local.sourceStatus!==record.sourceStatus)throw new Error(`Captured local record changed: ${record.id}`);
      return {...local,...record};
    }
    const fetch=capture.actualSourceFetches.find(row=>row.httpStatus===200&&row.canonicalMatchesResponseUrl===true&&identity(row.responseUrl)===identity(record.canonicalSourceUrl||record.officialSourceUrl));
    if(!fetch)return record;
    // Compact old captures omitted these mechanical provenance fields. Restore
    // them only from the recorded successful fetch and its recorded content hash.
    return {...record,sourceAuthority:record.authority,verificationMethod:'LIVE_OFFICIAL_TOPIC_VERIFIED',urlVerificationStatus:'VERIFIED',urlVerifiedDate:record.retrievedAt?.slice(0,10),documentHash:fetch.contentSha256};
  });
  const gate=evaluateEvidenceQuality({query:capture.question,topicIds:capture.topicIds,records,missingFacts:capture.classification.missingFacts||[],sourceMapFallbackTrace:context.sourceMapFallbackTrace});
  const labels=new Map(review.selectedEvidence.map(row=>[row.recordId,row.relevance]));
  const claims=verifyEvidenceClaims(gate.eligibleRecords.map(record=>({text:record.sourceText,quote:record.sourceText,recordId:record.id,kind:'RULE'})),gate.eligibleRecords,{missingFacts:gate.missingFacts,targetDate:gate.targetDate});
  return {caseId:capture.caseId,gateStatus:gate.status,coveredTopicIds:gate.coveredTopicIds,uncoveredTopicIds:gate.uncoveredTopicIds,missingFacts:gate.missingFacts,
    baselineRecords:records.map(record=>({recordId:record.id,relevance:labels.get(record.id)})),
    admittedRecords:gate.eligibleRecords.map(record=>({recordId:record.id,relevance:labels.get(record.id),sourceStatus:record.sourceStatus,provenance:record.provenance})),
    rejectedRecords:gate.rejectedRecords,
    exactQuoteCheck:{acceptedRecordIds:claims.accepted.map(claim=>claim.recordId),rejected:claims.rejected.map(claim=>({reason:claim.reason}))},
    conclusion:'OFFLINE_ADMISSION_AUDIT_ONLY; no new Gemini answer or live retrieval was generated.'};
});
const tally=(rows,key)=>rows.reduce((result,row)=>{const value=key(row);result[value]=(result[value]||0)+1;return result;},{});
const summary={cases:cases.length,before:tally(cases.flatMap(row=>row.baselineRecords),row=>row.relevance),after:tally(cases.flatMap(row=>row.admittedRecords),row=>row.relevance),gateStatuses:tally(cases,row=>row.gateStatus)};
const output={kind:'OFFLINE_REPLAY_OF_CAPTURED_REAL_EVIDENCE',newLiveProviderRun:false,newLiveRetrieval:false,originalLivePhaseComplete:false,limitations:['Measures admission of previously selected records, not a new retrieval ranking run.','Old human relevance labels are reused only where evidence text is unchanged.','Mechanical candidate provenance is reconstructed from original successful fetch/canonical/hash traces.','A verified exact quotation is not a verified application conclusion.'],summary,cases};
await mkdir('docs/evaluation/iras-evidence-hardening-2026-09-26',{recursive:true});
await writeFile('docs/evaluation/iras-evidence-hardening-2026-09-26/captured-evidence-admission.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(summary));
