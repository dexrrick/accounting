param([switch]$FinalAfterReview, [switch]$FinalOutput)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'D:\Accounting'
$taskNode = 'D:\Accounting\.tmp\canonical-node22\node.exe'
$taskLogs = 'D:\Accounting\artifacts\ai-first-advisory-phase1-20261103'
if ($FinalOutput) {
  $taskLogs = Join-Path $taskLogs 'final'
  New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
}
$env:PATH = 'D:\Accounting\.tmp\canonical-node22;C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd;' + $env:PATH
$taskResults = @()
function Invoke-Phase1Check([string]$Name, [string[]]$Arguments) {
  $started = Get-Date
  & $taskNode @Arguments *> (Join-Path $taskLogs ($Name + '.log'))
  $taskExit = $LASTEXITCODE
  $script:taskResults += [pscustomobject]@{ name=$Name; exitCode=$taskExit; elapsedSeconds=[math]::Round(((Get-Date)-$started).TotalSeconds,2); arguments=$Arguments }
  $script:taskResults | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskLogs 'validation-results.json')
  Write-Output "$Name exit=$taskExit"
  if ($taskExit -ne 0) { Get-Content (Join-Path $taskLogs ($Name + '.log')) -Tail 25 }
}
Invoke-Phase1Check 'preflight' @('scripts/preflight.mjs')
Invoke-Phase1Check 'maintained-lint' @('node_modules/oxlint/bin/oxlint','src','scripts','tests','vite.config.ts','tailwind.config.js','postcss.config.js')
Invoke-Phase1Check 'typecheck' @('node_modules/typescript/bin/tsc','-b')
Invoke-Phase1Check 'vite-build' @('node_modules/vite/bin/vite.js','build')
Invoke-Phase1Check 'worker-build' @('scripts/build_cloudflare_worker.mjs')
if (-not $FinalAfterReview) {
  Invoke-Phase1Check 'smoke' @('scripts/run_all_tests.mjs','--tier=smoke')
}
if (($taskResults | Where-Object exitCode -ne 0).Count -eq 0) {
  Invoke-Phase1Check 'full-regression' @('scripts/run_all_tests.mjs','--tier=full')
}
if (($taskResults | Where-Object exitCode -ne 0).Count -gt 0) { exit 1 }
