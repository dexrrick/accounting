import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const here=new URL('./',import.meta.url);
const previous=new URL('../statutory-review-edge-corrections-20261030/continued/',import.meta.url);
const read=async(name,root=here)=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const hash=text=>createHash('sha256').update(text).digest('hex');
const priorReview=await read('independent-final-review.json',previous);
const priorDeltas=await read('answer-deltas.json',previous);
const overrides=new Map(priorReview.changedAnswerGrades.map(row=>[row.id,row.grade]));
const report={scope:'Offline answer-text preservation and fixed-corpus evidence paths; neither is production acceptance.',cohorts:{},fixedCorpus:{}};
const packet={scope:'Only changed previous60 complete answers require new independent adjudication. Byte-identical answers retain historical grades subject to source-knowledge errata.',changed:[]};
for(const name of ['review30','fresh10','workflows10','novel10']){
 const before=await read(name+'.json',previous), after=await read(name+'.json');
 if(before.corpusSha256!==after.corpusSha256)throw Error('Corpus changed: '+name);
 report.cohorts[name]={total:after.outcomes.length,byteIdentical:0,changed:0,previousCorrect:0,unchangedCorrect:0,rows:[]};
 for(const row of after.outcomes){
  const old=before.outcomes.find(old=>old.id===row.id);
  const oldDelta=priorDeltas[name].find(old=>old.id===row.id);
  if(!old||!oldDelta)throw Error('Missing previous case: '+row.id);
  const priorGrade=overrides.get(row.id)||oldDelta.priorGrade;
  const same=old.answer===row.answer;
  const c=report.cohorts[name];c[same?'byteIdentical':'changed']++;
  if(priorGrade==='CORRECT'){c.previousCorrect++;if(same)c.unchangedCorrect++;}
  c.rows.push({id:row.id,priorGrade,byteIdentical:same,beforeSha256:hash(old.answer),afterSha256:hash(row.answer)});
  if(!same)packet.changed.push({cohort:name,id:row.id,question:row.question,priorGrade,before:old.answer,after:row.answer});
 }
}
if(process.argv.includes('--answers-only')){
 await writeFile(new URL('previous60-changed-review.json',here),JSON.stringify(packet,null,2)+'\n');
 console.log(JSON.stringify({changedAnswers:packet.changed.length,byteIdentical:60-packet.changed.length}));
 process.exit(0);
}
for(const name of ['fixed100-original','fixed100-enriched']){
 const before=await read(name+'.json',previous),after=await read(name+'.json');
 const losses=[];
 for(const old of before.outcomes){const row=after.outcomes.find(row=>row.id===old.id);
  if(!row)losses.push({id:old.id,kind:'MISSING_ROW'});
  else{
   if(old.pipelineStatus==='VERIFIED'&&row.pipelineStatus!=='VERIFIED')losses.push({id:old.id,kind:'VERIFIED_PATH_LOSS'});
   if(old.explanation&&!row.explanation)losses.push({id:old.id,kind:'EXPLANATION_LOSS'});
   if(old.expectedTopicIdResolved&&!row.expectedTopicIdResolved)losses.push({id:old.id,kind:'TOPIC_RESOLUTION_LOSS'});
  }
 }
 report.fixedCorpus[name]={corpusSize:after.corpusSize,corpusUnchanged:before.integrity.before.corpus.sha256===after.integrity.before.corpus.sha256,
  stableDuringReplay:after.integrity.stableDuringReplay,countsBefore:before.countsByStatus,countsAfter:after.countsByStatus,
  networkRequests:after.networkRequests,modelRequests:after.modelRequests,losses};
}
report.fixedCorpusPassed=Object.values(report.fixedCorpus).every(run=>run.corpusUnchanged&&run.stableDuringReplay&&!run.losses.length&&run.networkRequests===0&&run.modelRequests===0);
await writeFile(new URL('preservation-report.json',here),JSON.stringify(report,null,2)+'\n');
await writeFile(new URL('previous60-changed-review.json',here),JSON.stringify(packet,null,2)+'\n');
console.log(JSON.stringify({fixedCorpusPassed:report.fixedCorpusPassed,cohorts:Object.fromEntries(Object.entries(report.cohorts).map(([k,v])=>[k,{total:v.total,byteIdentical:v.byteIdentical,changed:v.changed,previousCorrect:v.previousCorrect}]))}));
if(!report.fixedCorpusPassed)process.exitCode=1;
