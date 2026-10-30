$ErrorActionPreference = 'Continue'
$taskRoot = 'D:\Accounting'
$taskNode = Join-Path $taskRoot '.tmp\canonical-node22\node.exe'
$taskOut = Join-Path $taskRoot 'artifacts\statutory-knowledge-expansion-20261030'
$env:PATH = (Join-Path $taskRoot '.tmp\canonical-node22') + ';C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd;' + $env:PATH
$env:TASK_GIT_EXE = 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
$env:NODE_OPTIONS = '--import=file:///D:/Accounting/.tmp/canonical-node22/external-fetch-guard.mjs'
# Direct equivalents of package.json scripts; npm is unavailable in this host.
$taskChecks = @(
  @{name='preflight';args=@('scripts/preflight.mjs')},
  @{name='lint';args=@('node_modules/oxlint/bin/oxlint')},
  @{name='maintained-code-lint';args=@('node_modules/oxlint/bin/oxlint','src','scripts','tests')},
  @{name='typecheck';args=@('node_modules/typescript/bin/tsc','-b')},
  @{name='vite-build';args=@('node_modules/vite/bin/vite.js','build')},
  @{name='worker-build';args=@('scripts/build_cloudflare_worker.mjs')},
  @{name='smoke';args=@('scripts/run_all_tests.mjs','--tier=smoke')},
  @{name='full';args=@('scripts/run_all_tests.mjs','--tier=full')},
  @{name='fixed100-original';args=@('node_modules/tsx/dist/cli.mjs','scripts/replay_statutory_coverage.mjs',('--out='+$taskOut+'\fixed100-original.json'))},
  @{name='fixed100-enriched';args=@('node_modules/tsx/dist/cli.mjs','scripts/replay_statutory_coverage.mjs','--source-manifests=tests/fixtures/statutoryKnowledge20261027b',('--out='+$taskOut+'\fixed100-enriched.json'))}
)
$taskResults = @()
foreach ($taskCheck in $taskChecks) {
  $taskStarted = [DateTime]::UtcNow.ToString('o')
  & $taskNode @($taskCheck.args) *> (Join-Path $taskOut ($taskCheck.name+'.log'))
  $taskResults += @{check=$taskCheck.name;exitCode=$LASTEXITCODE;startedUTC=$taskStarted;completedUTC=[DateTime]::UtcNow.ToString('o')}
  $taskResults | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskOut 'validation-results.json')
  Write-Output ($taskCheck.name+' exit='+$LASTEXITCODE)
}
