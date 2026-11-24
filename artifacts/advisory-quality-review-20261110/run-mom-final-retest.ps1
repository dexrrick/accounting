$ErrorActionPreference = 'Stop'
$taskDirectory = Join-Path $PSScriptRoot 'mom-final-retest'
$taskCapturePath = Join-Path $taskDirectory 'mom-salary-overtime.json'
if (Test-Path -LiteralPath $taskCapturePath) { throw 'Capture already exists; do not repeat live requests.' }
New-Item -ItemType Directory -Force -Path $taskDirectory | Out-Null
$taskLedger = [ordered]@{approvedTotal=87;usedBeforeAttempt=84;maximumThisAttempt=3;status='STARTING';scope='Fresh understanding, official-source retrieval, generation and selective support verification.'}
$taskLedger | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDirectory 'request-ledger.json')
$env:NODE_OPTIONS = '--require=D:/Accounting/.tmp/canonical-node22/userinfo-shim.cjs'
Set-Location -LiteralPath 'D:\Accounting'
& 'D:\Accounting\.tmp\canonical-node22\node.exe' '--env-file=D:\Accounting\.env.local' 'D:\Accounting\node_modules\tsx\dist\cli.mjs' (Join-Path $PSScriptRoot 'run-live.mjs') '--case=mom-salary-overtime' ('--out=' + $taskCapturePath) '--max-model-requests=3'
$taskCode=$LASTEXITCODE
$taskCapture=Get-Content -LiteralPath $taskCapturePath -Raw | ConvertFrom-Json -Depth 100
$taskLedger.status=$taskCapture.status
$taskLedger.requestsThisAttempt=$taskCapture.modelRequestCount
$taskLedger.usedTotal=84+$taskCapture.modelRequestCount
$taskLedger.remaining=87-$taskLedger.usedTotal
$taskLedger.sourceRevision=$taskCapture.sourceRevision
$taskLedger | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskDirectory 'request-ledger.json')
Write-Output ('Gemini request ledger: '+$taskLedger.usedTotal+'/87; remaining='+$taskLedger.remaining)
exit $taskCode
