$ErrorActionPreference = 'Stop'
$taskNode = 'D:\Accounting\.tmp\canonical-node22\node.exe'
$taskBase = $PSScriptRoot
$taskOut = 'D:\Accounting\artifacts\statutory-corrections-expansion-20261030'
$env:NODE_OPTIONS = '--import=file:///D:/Accounting/.tmp/canonical-node22/external-fetch-guard.mjs'
$taskRuns = @(
  @{name='review30';corpus='corpora/review30.json';sources='tests/fixtures/statutoryKnowledge20261027b'},
  @{name='fresh10';corpus='corpora/fresh10.json';sources='tests/fixtures/statutoryKnowledge20261027b'},
  @{name='workflows10';corpus='corpora/workflows10.json';sources='tests/fixtures/statutoryWorkflows20261029'}
)
foreach ($taskRun in $taskRuns) {
  & $taskNode node_modules/tsx/dist/cli.mjs scripts/evaluate_statutory_natural_20261027.mjs --entry=application --understanding=rules-only ('--corpus='+$taskBase+'/'+$taskRun.corpus) ('--source-manifests='+$taskRun.sources) ('--out='+$taskOut+'/'+$taskRun.name+'.json') *> ($taskOut+'/'+$taskRun.name+'.log')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Output ($taskRun.name+' evaluation complete')
}
