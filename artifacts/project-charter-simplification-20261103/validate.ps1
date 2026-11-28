param([ValidateSet('baseline','checks','smoke','full','focused')][string]$Stage)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'D:\Accounting'
$taskNode = 'D:\Accounting\.tmp\canonical-node22\node.exe'
$taskOutput = 'D:\Accounting\artifacts\project-charter-simplification-20261103'
$env:PATH = (Split-Path $taskNode) + ';C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd;' + $env:PATH
$taskResults = @()
function Invoke-TaskCheck([string]$Name, [string[]]$Arguments) {
  $taskStarted = [DateTime]::UtcNow
  & $taskNode @Arguments *> (Join-Path $taskOutput ($Name + '.log'))
  $taskExit = $LASTEXITCODE
  $script:taskResults += [ordered]@{name=$Name;exitCode=$taskExit;startedUTC=$taskStarted.ToString('o');elapsedSeconds=[math]::Round(([DateTime]::UtcNow-$taskStarted).TotalSeconds,2);arguments=$Arguments}
  $script:taskResults | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskOutput ($Stage + '-results.json')) -Encoding utf8
  Write-Output "$Name exit=$taskExit"
  if ($taskExit -ne 0) { Get-Content -LiteralPath (Join-Path $taskOutput ($Name + '.log')) -Tail 15 }
}
switch ($Stage) {
  'baseline' {
    Invoke-TaskCheck 'baseline-preflight' @('scripts/preflight.mjs')
    Invoke-TaskCheck 'baseline-root-lint' @('node_modules/oxlint/bin/oxlint')
    Invoke-TaskCheck 'advisory-preservation' @('--import','tsx','tests/regression/test_ai_first_advisory_phase1.mjs')
  }
  'checks' {
    Invoke-TaskCheck 'root-lint' @('node_modules/oxlint/bin/oxlint')
    Invoke-TaskCheck 'maintained-lint' @('node_modules/oxlint/bin/oxlint','src','scripts','tests','vite.config.ts','tailwind.config.js','postcss.config.js')
    Invoke-TaskCheck 'typecheck' @('node_modules/typescript/bin/tsc','-b')
    Invoke-TaskCheck 'vite-build' @('node_modules/vite/bin/vite.js','build')
    Invoke-TaskCheck 'worker-build' @('scripts/build_cloudflare_worker.mjs')
  }
  'smoke' {
    Invoke-TaskCheck 'preflight' @('scripts/preflight.mjs')
    Invoke-TaskCheck 'smoke' @('scripts/run_all_tests.mjs','--tier=smoke')
  }
  'full' {
    Invoke-TaskCheck 'full' @('scripts/run_all_tests.mjs','--tier=full')
  }
  'focused' {
    foreach ($taskSuite in @('test_evidence_grounded_synthesis','test_evidence_grounded_synthesis_pipeline','test_synthesis_numeric_provenance','test_synthesis_practical_answers')) {
      Invoke-TaskCheck $taskSuite @('--import','tsx',('tests/regression/' + $taskSuite + '.mjs'))
    }
  }
}
if (@($taskResults | Where-Object { $_.exitCode -ne 0 -and $_.name -notin @('root-lint','baseline-root-lint') }).Count) { exit 1 }
