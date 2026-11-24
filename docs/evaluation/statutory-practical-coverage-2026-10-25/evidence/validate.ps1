$ErrorActionPreference = 'Stop'
$taskNode = 'D:\Accounting\.tmp\canonical-node22\node.exe'
$taskWorkspace = 'D:\Accounting\.worktrees\review-corrections-20261025'
$taskLogs = 'D:\Accounting\artifacts\practical-question-wave-2026-10-25\post-mom-scope-fix'
$env:PATH = 'D:\Accounting\.tmp\canonical-node22;C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd;' + $env:PATH
$env:NODE_OPTIONS = '--import=file:///D:/Accounting/.tmp/canonical-node22/external-fetch-guard.mjs'
Set-Location -LiteralPath $taskWorkspace
$taskResults = @()
function Invoke-CoverageCheck([string]$Name, [string[]]$Arguments) {
  $taskStarted = [DateTime]::UtcNow.ToString('o')
  & $taskNode @Arguments *> (Join-Path $taskLogs ($Name + '.log'))
  $taskExit = $LASTEXITCODE
  $script:taskResults += [ordered]@{check=$Name;exitCode=$taskExit;startedAtUTC=$taskStarted;completedAtUTC=[DateTime]::UtcNow.ToString('o');log=(Join-Path $taskLogs ($Name + '.log'))}
  $script:taskResults | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskLogs 'validation-results.json')
  Write-Output "$Name exit=$taskExit"
  if ($taskExit -ne 0) { Get-Content -LiteralPath (Join-Path $taskLogs ($Name + '.log')) -Tail 30; exit $taskExit }
}
Invoke-CoverageCheck 'preflight' @('scripts/preflight.mjs')
Invoke-CoverageCheck 'lint' @('node_modules/oxlint/bin/oxlint')
Invoke-CoverageCheck 'typecheck' @('node_modules/typescript/bin/tsc', '-b')
Invoke-CoverageCheck 'vite-build' @('node_modules/vite/bin/vite.js', 'build')
Invoke-CoverageCheck 'worker-build' @('scripts/build_cloudflare_worker.mjs')
Invoke-CoverageCheck 'smoke' @('scripts/run_all_tests.mjs', '--tier=smoke')
Invoke-CoverageCheck 'full' @('scripts/run_all_tests.mjs', '--tier=full')
Write-Output 'ALL_REQUIRED_CHECKS_PASSED'


