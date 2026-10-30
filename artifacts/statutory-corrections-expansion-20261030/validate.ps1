$ErrorActionPreference = 'Continue'
$taskNode = 'D:\Accounting\.tmp\canonical-node22\node.exe'
$taskOut = 'D:\Accounting\artifacts\statutory-corrections-expansion-20261030'
$env:PATH = 'D:\Accounting\.tmp\canonical-node22;C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd;' + $env:PATH
$env:TASK_GIT_EXE = 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
$env:NODE_OPTIONS = '--import=file:///D:/Accounting/.tmp/canonical-node22/external-fetch-guard.mjs'
$taskChecks = @(
  @{name='lint';args=@('node_modules/oxlint/bin/oxlint','src','scripts','tests')},
  @{name='typecheck';args=@('node_modules/typescript/bin/tsc','-b')},
  @{name='vite-build';args=@('node_modules/vite/bin/vite.js','build')},
  @{name='worker-build';args=@('scripts/build_cloudflare_worker.mjs')},
  @{name='smoke';args=@('scripts/run_all_tests.mjs','--tier=smoke')},
  @{name='full';args=@('scripts/run_all_tests.mjs','--tier=full')},
  @{name='fixed100-original';args=@('node_modules/tsx/dist/cli.mjs','scripts/replay_statutory_coverage.mjs',('--out='+$taskOut+'\fixed100-original.json'))},
  @{name='fixed100-enriched';args=@('node_modules/tsx/dist/cli.mjs','scripts/replay_statutory_coverage.mjs','--source-manifests=tests/fixtures/statutoryKnowledge20261027b',('--out='+$taskOut+'\fixed100-enriched.json'))},
  @{name='natural30-original';args=@('node_modules/tsx/dist/cli.mjs','scripts/evaluate_statutory_natural_20261027.mjs',('--out='+$taskOut+'\natural30-original.json'))},
  @{name='natural30-enriched';args=@('node_modules/tsx/dist/cli.mjs','scripts/evaluate_statutory_natural_20261027.mjs','--source-manifests=tests/fixtures/statutoryKnowledge20261027b',('--out='+$taskOut+'\natural30-enriched.json'))}
)
$taskResults = @()
foreach ($taskCheck in $taskChecks) {
  $taskStarted = [DateTime]::UtcNow.ToString('o')
  & $taskNode @($taskCheck.args) *> (Join-Path $taskOut ($taskCheck.name+'.log'))
  $taskExit = $LASTEXITCODE
  $taskResults += @{check=$taskCheck.name;exitCode=$taskExit;startedUTC=$taskStarted;completedUTC=[DateTime]::UtcNow.ToString('o')}
  $taskResults | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $taskOut 'validation-results.json')
  Write-Output ($taskCheck.name+' exit='+$taskExit)

}






