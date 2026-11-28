$ErrorActionPreference = 'Continue'
$taskRoot = 'D:\Accounting'
$taskNode = Join-Path $taskRoot '.tmp\canonical-node22\node.exe'
$taskOut = Join-Path $taskRoot 'artifacts\statutory-review-wht-expansion-20261102'
$env:PATH = (Split-Path $taskNode) + ';' + $env:PATH
$env:NODE_OPTIONS = '--require=D:/Accounting/.tmp/canonical-node22/userinfo-shim.cjs --import=file:///D:/Accounting/.tmp/canonical-node22/external-fetch-guard.mjs'
$taskChecks = @(
  @{name='preflight';args=@('scripts/preflight.mjs')},
  @{name='maintained-lint';args=@('node_modules/oxlint/bin/oxlint','src','scripts','tests')},
  @{name='typecheck';args=@('node_modules/typescript/bin/tsc','-b')},
  @{name='iras-mas-source-regression';args=@('node_modules/tsx/dist/cli.mjs','tests/regression/test_iras_mas_knowledge_20261027b.mjs')},
  @{name='wht-production-regression';args=@('node_modules/tsx/dist/cli.mjs','tests/regression/test_iras_wht_filing_treaty_production.mjs')},
  @{name='cpf-application-regression';args=@('node_modules/tsx/dist/cli.mjs','tests/regression/test_statutory_cpf_expansion_20261101.mjs')},
  @{name='vite-build';args=@('node_modules/vite/bin/vite.js','build')},
  @{name='worker-build';args=@('scripts/build_cloudflare_worker.mjs')}
)
$taskResults = @()
foreach ($taskCheck in $taskChecks) {
  $taskStarted = [DateTime]::UtcNow.ToString('o')
  & $taskNode @($taskCheck.args) *> (Join-Path $taskOut ($taskCheck.name+'.log'))
  $taskCode = $LASTEXITCODE
  $taskResults += [ordered]@{check=$taskCheck.name;exitCode=$taskCode;startedUTC=$taskStarted;completedUTC=[DateTime]::UtcNow.ToString('o')}
  $taskResults | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskOut 'validation-results.json') -Encoding utf8
  Write-Output ($taskCheck.name+' exit='+$taskCode)
  if ($taskCode -ne 0) { exit $taskCode }
}
