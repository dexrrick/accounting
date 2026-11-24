import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = 'artifacts/statutory-next-expansion-20261031/';
const read = p => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const walk = dir => readdirSync(dir).flatMap(name => {const p=dir+'/'+name; return statSync(p).isDirectory()?walk(p):[p];});
if (process.argv.includes('--freeze')) {
  const paths = ['tests/evaluation/statutory_independent_75_20261030.json', 'tests/evaluation/statutory_coverage_wave_2026-10-25.json',
    'artifacts/statutory-review-followup-20261030/prior60-corpus.json', root+'fresh-independent-corpus.json',
    ...['statutoryKnowledge20261027b','statutoryKnowledge20261030','statutoryDevelopment20261027','statutoryExpansionSources','statutoryCoverageSources'].flatMap(d=>walk('tests/fixtures/'+d))];
  writeFileSync(root+'frozen-input-hashes.json',JSON.stringify(Object.fromEntries(paths.map(p=>[p,hash(p)])),null,2)+'\n');
  console.log('Frozen '+paths.length+' input hashes.');
} else {
  const hashes=read(root+'frozen-input-hashes.json');
  const changedInputs=Object.keys(hashes).filter(p=>hash(p)!==hashes[p]);
  const grades=read(root+'baseline-grades.json').grades;
  const comparison={frozenInputCount:Object.keys(hashes).length,changedInputs,answers:{},evidencePaths:{}};
  const sourceDir='tests/fixtures/statutoryKnowledge20261031/';
  comparison.newSources=readdirSync(sourceDir).filter(p=>p.endsWith('source-manifest.json')).flatMap(p=>read(sourceDir+p).sources.map(s=>({
    authority:s.authority,url:s.url,fixture:s.fixture,sha256:hash(sourceDir+s.fixture),
    hashMatches:hash(sourceDir+s.fixture)===(s.fixtureSha256||s.sha256),byteLengthMatches:statSync(sourceDir+s.fixture).size===s.byteLength,
    httpStatus:s.httpStatus,fixtureKind:s.fixtureKind
  })));
  for (const [label,beforeFile,afterFile] of [
    ['Frozen75',root+'baseline-current75.json',root+'final75.json'],
    ['Earlier60',root+'baseline60.json',root+'final60.json']
  ]) {
    if(!existsSync(afterFile)) continue;
    const before=read(beforeFile),after=read(afterFile),old=new Map(before.outcomes.map(a=>[a.id,a]));
    const changed=after.outcomes.filter(a=>a.answer!==old.get(a.id)?.answer);
    const correct=label==='Frozen75'?grades.filter(a=>a.grade==='CORRECT').map(a=>a.id):[];
    comparison.answers[label]={cases:after.outcomes.length,corpusSha256:after.corpusSha256,corpusHashUnchanged:before.corpusSha256===after.corpusSha256,
      unchangedAnswers:after.outcomes.length-changed.length,changedIds:changed.map(a=>a.id),
      previouslyCorrectTotal:label==='Frozen75'?correct.length:'See independent baseline grade inventory',
      correctUnchanged:correct.filter(id=>!changed.some(a=>a.id===id)),correctChangedForIndependentReview:correct.filter(id=>changed.some(a=>a.id===id)),
      networkRequests:after.networkRequests,modelRequests:after.modelRequests};
    writeFileSync(root+label+'-changed-answers.json',JSON.stringify(changed.map(a=>({id:a.id,question:a.question,before:old.get(a.id)?.answer,after:a.answer,
      previousGrade:label==='Frozen75'?grades.find(g=>g.id===a.id):undefined})),null,2)+'\n');
  }
  for(const label of ['fixed100-original','fixed100-enriched']) {
    const afterFile=root+label+'.json'; if(!existsSync(afterFile))continue;
    const before=read('artifacts/statutory-review-followup-20261030/'+label+'.json'),after=read(afterFile),old=new Map(before.outcomes.map(a=>[a.id,a]));
    comparison.evidencePaths[label]={cases:after.outcomes.length,questionsUnchanged:after.outcomes.every(a=>a.question===old.get(a.id)?.question),
      before:before.countsByStatus,after:after.countsByStatus,
      verifiedLosses:after.outcomes.filter(a=>old.get(a.id)?.pipelineStatus==='VERIFIED'&&a.pipelineStatus!=='VERIFIED').map(a=>a.id),
      eciHold:after.outcomes.find(a=>a.id==='iras-eci-03')?.pipelineStatus,
      networkRequests:after.networkRequests,modelRequests:after.modelRequests};
    const changed=after.outcomes.filter(a=>a.response!==old.get(a.id)?.response);
    writeFileSync(root+label+'-changed-answers.json',JSON.stringify(changed.map(a=>({id:a.id,question:a.question,before:old.get(a.id)?.response,after:a.response})),null,2)+'\n');
  }
  comparison.limitation='Evidence-path status is not whole-answer correctness. Changed answers require independent review. Unchanged answers inherit only recorded prior grades. Offline capture is not live-model/browser, CI or production acceptance.';
  writeFileSync(root+'preservation-report.json',JSON.stringify(comparison,null,2)+'\n');
  console.log(JSON.stringify(comparison,null,2));
}
