param(
  [switch]$AuthorizeLive,
  [string]$ExpectedHead = ((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'expected-head.txt') -Raw).Trim())
)
$ErrorActionPreference = 'Stop'
if (-not $AuthorizeLive) { throw 'Live run not authorized. Re-run with -AuthorizeLive only after separate authorization.' }
if ($ExpectedHead -notmatch '^[0-9a-fA-F]{40}$') { throw 'ExpectedHead must be a 40-character commit hash.' }
if (-not $env:GEMINI_API_KEY) { throw 'Set GEMINI_API_KEY in the process environment; this script does not load credential files.' }

$repo = 'D:\Accounting'
$node = 'D:\Accounting\.tmp\canonical-node22\node.exe'
$tsx = 'D:\Accounting\node_modules\tsx\dist\cli.mjs'
$git = (Get-Command 'git.exe' -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot 'run-live.mjs'
$answers = Join-Path $PSScriptRoot 'answers'
$ledgerPath = Join-Path $PSScriptRoot 'batch-ledger.json'
$logDirectory = Join-Path $PSScriptRoot 'logs'
$budget = 24
$perCaseCap = 4
function Invoke-RepoGit {
  param([Parameter(Mandatory)][string[]]$GitArguments)
  $nativeOutput = & $git -c 'safe.directory=D:/Accounting' -C $repo @GitArguments 2>&1
  $nativeExitCode = $LASTEXITCODE
  if ($nativeExitCode -ne 0) { throw "Git validation failed (exit $nativeExitCode): $($GitArguments -join ' ')" }
  return (($nativeOutput | Out-String).Trim())
}
$caseOrder = @(
  'mom-salary-overtime', 'mixed-first-employee', 'iras-private-car',
  'mas-fund-management-startup', 'mom-contextual-followup',
  'cpf-employer-responsibility', 'acra-sole-director-secretary',
  'accounting-accrual', 'accounting-asset-register'
)
if (Test-Path -LiteralPath $ledgerPath) { throw 'Batch ledger exists; inspect it rather than repeating or resuming requests.' }
if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath $tsx)) { throw 'Canonical Node 22 or tsx is unavailable.' }
foreach ($caseId in $caseOrder) {
  if (Test-Path -LiteralPath (Join-Path $answers ($caseId + '.json'))) { throw "Capture already exists for $caseId; refusing overwrite or implicit retry." }
}
$preflightHead = Invoke-RepoGit @('rev-parse', 'HEAD')
$preflightDirty = Invoke-RepoGit @('status', '--porcelain', '--untracked-files=no')
$preflightUntrackedSource = Invoke-RepoGit @('ls-files', '--others', '--exclude-standard', '--', 'src')
if ($preflightHead -ne $ExpectedHead -or $preflightDirty -or $preflightUntrackedSource) { throw 'Preflight requires the expected clean source revision before any case launch.' }
New-Item -ItemType Directory -Path $answers -Force | Out-Null
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$env:NODE_OPTIONS = '--require=D:/Accounting/.tmp/canonical-node22/userinfo-shim.cjs'
$used = 0
$rows = @()
$ledger = [ordered]@{
  status = 'RUNNING'; expectedHead = $ExpectedHead; batchCap = $budget; perCaseCap = $perCaseCap
  usedAttempts = 0; reservedAttempts = 0; currentCase = $null; cases = $rows
}

foreach ($caseId in $caseOrder) {
  if ($used -ge $budget) {
    $ledger.status = 'AUTHORIZATION_REQUIRED_BUDGET_EXHAUSTED'
    $ledger.currentCase = $caseId
    $ledger | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
    Write-Output "Stopped at $used/$budget attempts; authorization is required before any further case."
    exit 2
  }
  $cap = [Math]::Min($perCaseCap, $budget - $used)
  $capture = Join-Path $answers ($caseId + '.json')
  $ledger.currentCase = $caseId
  $ledger.reservedAttempts = $cap
  $ledger.usedAttempts = $used
  $ledger | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
  $log = Join-Path $logDirectory ($caseId + '.log')
  Push-Location -LiteralPath $repo
  try {
    & $node $tsx $runner ("--case=$caseId") ("--out=$capture") ("--max-model-requests=$cap") '--authorize-live' ("--expected-head=$ExpectedHead") *> $log
    $exitCode = $LASTEXITCODE
  } finally { Pop-Location }
  if (-not (Test-Path -LiteralPath $capture)) {
    $ledger.status = 'INTERRUPTED_RESERVED_ATTEMPTS'
    $ledger | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
    throw "No capture for $caseId. Its $cap reserved attempts remain consumed; inspect before authorization."
  }
  $result = Get-Content -LiteralPath $capture -Raw | ConvertFrom-Json -Depth 100
  $countValue = $result.modelRequestCount
  $validCount = $null -ne $countValue -and $countValue -is [ValueType] -and $countValue -isnot [bool]
  if ($validCount) {
    $numericCount = [double]$countValue
    $validCount = -not [double]::IsNaN($numericCount) -and -not [double]::IsInfinity($numericCount) -and $numericCount -eq [Math]::Truncate($numericCount) -and $numericCount -ge 0 -and $numericCount -le $cap
  }
  if (-not $validCount) {
    $ledger.status = 'INVALID_CAPTURE_RESERVED_ATTEMPTS'
    $ledger | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
    throw "Invalid or missing numeric modelRequestCount in $caseId capture; its reservation remains consumed."
  }
  $actual = [int]$countValue
  $used += $actual
  $rows += [ordered]@{ caseId=$caseId; status=$result.status; attempts=$actual; capture=$capture; expectedHead=$result.expectedHead }
  $ledger.cases = $rows
  $ledger.usedAttempts = $used
  $ledger.reservedAttempts = 0
  $ledger | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
  try {
    $liveHead = Invoke-RepoGit @('rev-parse', 'HEAD')
    $dirtyTracked = Invoke-RepoGit @('status', '--porcelain', '--untracked-files=no')
    $untrackedSource = Invoke-RepoGit @('ls-files', '--others', '--exclude-standard', '--', 'src')
  } catch {
    $ledger.status = 'STOPPED_REVISION_CHECK_FAILED'
    $ledger | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
    throw
  }
  if ($liveHead -ne $ExpectedHead -or $dirtyTracked -or $untrackedSource) {
    $ledger.status = 'STOPPED_REVISION_CHANGED'
    $ledger | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
    throw "Source revision or clean-tree check changed after $caseId; inspect before proceeding."
  }
  if ($exitCode -ne 0 -or $result.stopRemainingCases -or $result.expectedHead -ne $ExpectedHead -or $result.sourceRevision.dirty -or $result.finalResponse.advisoryFailureStatus -or -not $result.noJournalCheck.noJournalProduced) {
    $ledger.status = 'STOPPED_REVIEW_REQUIRED'
    $ledger | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
    Write-Output "Stopped after $caseId with $used/$budget attempts; review the capture before proceeding."
    exit 2
  }
  if ($caseId -ne $caseOrder[-1] -and $used -lt $budget) { Start-Sleep -Seconds 65 }
}

$ledger.status = 'CAPTURES_REVIEW_PENDING'
$ledger | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8
Write-Output "Captured all $($caseOrder.Count) cases with $used/$budget attempts; answer review remains pending."
