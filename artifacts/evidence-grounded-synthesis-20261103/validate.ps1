param([ValidateSet('checks', 'final-checks', 'smoke', 'full')][string]$Stage = 'checks')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'D:\Accounting'
$taskNode = 'D:\Accounting\.tmp\canonical-node22\node.exe'
$taskLogs = 'D:\Accounting\artifacts\evidence-grounded-synthesis-20261103'
$env:PATH = 'D:\Accounting\.tmp\canonical-node22;C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd;' + $env:PATH
$taskResults = @()
function Invoke-SynthesisCheck([string]$Name, [string[]]$Arguments) {
  $started = Get-Date
  & $taskNode @Arguments *> (Join-Path $taskLogs ($Name + '.log'))
  $taskExit = $LASTEXITCODE
  $script:taskResults += [pscustomobject]@{ name=$Name; exitCode=$taskExit; elapsedSeconds=[math]::Round(((Get-Date)-$started).TotalSeconds,2); arguments=$Arguments }
  $script:taskResults | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskLogs ($Stage + '-results.json'))
  Write-Output "$Name exit=$taskExit"
  if ($Name -eq 'root-lint' -and $taskExit -ne 0) {
    Write-Output ('root lint error count: ' + (Select-String -LiteralPath (Join-Path $taskLogs 'root-lint.log') -Pattern ': error: ').Count)
  } elseif ($taskExit -ne 0) { Get-Content (Join-Path $taskLogs ($Name + '.log')) -Tail 20 }
}
if ($Stage -in @('checks', 'final-checks')) {
  if ($Stage -eq 'checks') { Invoke-SynthesisCheck 'root-lint' @('node_modules/oxlint/bin/oxlint') }
  Invoke-SynthesisCheck 'maintained-lint' @('node_modules/oxlint/bin/oxlint','src','scripts','tests','vite.config.ts','tailwind.config.js','postcss.config.js')
  Invoke-SynthesisCheck 'typecheck' @('node_modules/typescript/bin/tsc','-b')
  Invoke-SynthesisCheck 'vite-build' @('node_modules/vite/bin/vite.js','build')
  Invoke-SynthesisCheck 'worker-build' @('scripts/build_cloudflare_worker.mjs')
} elseif ($Stage -eq 'smoke') {
  Invoke-SynthesisCheck 'smoke' @('scripts/run_all_tests.mjs','--tier=smoke')
} else {
  Invoke-SynthesisCheck 'full-regression' @('scripts/run_all_tests.mjs','--tier=full')
}
if (($taskResults | Where-Object { $_.exitCode -ne 0 -and $_.name -ne 'root-lint' }).Count -gt 0) { exit 1 }
