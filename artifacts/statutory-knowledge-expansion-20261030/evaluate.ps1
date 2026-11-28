$ErrorActionPreference = 'Stop'
$taskRoot = 'D:\Accounting'
$taskNode = Join-Path $taskRoot '.tmp\canonical-node22\node.exe'
$taskOut = Join-Path $taskRoot 'artifacts\statutory-knowledge-expansion-20261030'
$taskSources = Join-Path $taskRoot '.tmp\statutory20261030-sources'
$env:PATH = (Join-Path $taskRoot '.tmp\canonical-node22') + ';C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd;' + $env:PATH
$env:NODE_OPTIONS = '--import=file:///D:/Accounting/.tmp/canonical-node22/external-fetch-guard.mjs'
$taskRuns = @(
  @{ name='final75'; corpus='tests/evaluation/statutory_independent_75_20261030.json' },
  @{ name='acceptance'; corpus='artifacts/statutory-knowledge-expansion-20261030/expansion-acceptance.json' },
  @{ name='p2-after'; corpus='artifacts/statutory-knowledge-expansion-20261030/p2-reproduction-corpus.json' },
  @{ name='review30'; corpus='artifacts/statutory-corrections-expansion-20261030/corpora/review30.json' },
  @{ name='fresh10'; corpus='artifacts/statutory-corrections-expansion-20261030/corpora/fresh10.json' },
  @{ name='workflows10'; corpus='artifacts/statutory-corrections-expansion-20261030/corpora/workflows10.json' },
  @{ name='novel10'; corpus='artifacts/statutory-review-edge-corrections-20261030/novel10.json' }
)
foreach ($taskRun in $taskRuns) {
  $taskRaw = Join-Path $taskRoot ('.tmp\statutory20261030-' + $taskRun.name + '.json')
  & $taskNode node_modules/tsx/dist/cli.mjs scripts/evaluate_statutory_natural_20261027.mjs --entry=application --understanding=rules-only ('--corpus=' + $taskRun.corpus) ('--source-manifests=' + $taskSources) ('--out=' + $taskRaw) *> (Join-Path $taskOut ($taskRun.name + '.log'))
  if ($LASTEXITCODE -ne 0) { throw ($taskRun.name + ' failed; see log') }
  $taskReport = Get-Content -LiteralPath $taskRaw -Raw | ConvertFrom-Json
  $taskCompact = [ordered]@{ scope=$taskReport.scope; appRoot=$taskReport.appRoot; corpusSha256=$taskReport.corpusSha256; networkRequests=$taskReport.networkRequests; modelRequests=$taskReport.modelRequests; blockedModelEndpoints=$taskReport.blockedModelEndpoints; addedSourceFixtures=$taskReport.addedSourceFixtures; limitation=$taskReport.limitation; outcomes=@($taskReport.outcomes | ForEach-Object { [ordered]@{ id=$_.id; question=$_.question; answer=$_.answer; evidenceStatuses=$_.evidenceStatuses } }) }
  $taskCompact | ConvertTo-Json -Depth 18 | Set-Content -LiteralPath (Join-Path $taskOut ($taskRun.name + '.json')) -Encoding utf8
  Write-Output ($taskRun.name + ': ' + $taskReport.outcomes.Count + ' captured answers')
}
