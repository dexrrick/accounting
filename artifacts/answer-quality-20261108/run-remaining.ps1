$ErrorActionPreference = 'Stop'
$taskNode = 'D:\Accounting\.tmp\canonical-node22\node.exe'
$taskRunner = Join-Path $PSScriptRoot 'run-live.mjs'
$taskCases = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'cases.json') -Raw | ConvertFrom-Json
$taskRows = @()
$taskModelCount = 0
$taskStop = $null
Set-Location -LiteralPath 'D:\Accounting'
foreach ($taskCase in $taskCases) {
  $taskOutput = Join-Path "$PSScriptRoot\answers" ($taskCase.id + '.json')
  $taskPriorOutput = $null
  $taskRetryOutput = Join-Path "$PSScriptRoot\answers" ($taskCase.id + '-retry1.json')
  if (Test-Path -LiteralPath $taskRetryOutput) {
    $taskPriorOutput = $taskOutput
    $taskPriorCapture = Get-Content -LiteralPath $taskPriorOutput -Raw | ConvertFrom-Json -Depth 100
    $taskModelCount += $taskPriorCapture.modelRequestCount
    $taskOutput = $taskRetryOutput
  }
  if (-not (Test-Path -LiteralPath $taskOutput)) {
    $taskCap = [Math]::Min(8, 40 - $taskModelCount)
    if ($taskCap -lt 1) { $taskStop = 'Total model request budget exhausted'; break }
    $taskArgs = @('--env-file=D:\Accounting\.env.local','D:\Accounting\node_modules\tsx\dist\cli.mjs',$taskRunner,('--case=' + $taskCase.id),('--out=' + $taskOutput),('--max-model-requests=' + $taskCap))
    & $taskNode @taskArgs
    $taskExit = $LASTEXITCODE
    if (-not (Test-Path -LiteralPath $taskOutput)) { throw ('Missing capture for ' + $taskCase.id) }
  } else { $taskExit = 0 }
  $taskCapture = Get-Content -LiteralPath $taskOutput -Raw | ConvertFrom-Json -Depth 100
  if ($taskCapture.expectedHead -ne '2a282cef56a42e99b7f057de22e863258fddb972') { throw 'Unexpected capture head' }
  $taskModelCount += $taskCapture.modelRequestCount
  $taskRows += [pscustomobject]@{
    caseId=$taskCase.id; status=$taskCapture.status; modelRequests=$taskCapture.modelRequestCount
    sourceRequests=$taskCapture.sourceCount; durationMs=$taskCapture.durationMs
    answerPath=$taskCapture.finalResponse.answerPath; advisoryFailureStatus=$taskCapture.finalResponse.advisoryFailureStatus
    capture=$taskOutput; priorAttemptCapture=$taskPriorOutput
  }
  [pscustomobject]@{
    commit='2a282cef56a42e99b7f057de22e863258fddb972'; totalModelRequests=$taskModelCount
    modelRequestBudget=40; qualityAssessment='PENDING_REVIEW'; cases=$taskRows
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'capture-summary.json')
  if ($taskCapture.stopRemainingCases -or $taskExit -ne 0) { $taskStop = 'Stopped after ' + $taskCase.id + ': ' + $taskCapture.status; break }
}
if ($taskStop) { Write-Output $taskStop }
Write-Output ('Captured cases=' + $taskRows.Count + '; modelRequests=' + $taskModelCount + '/40')
