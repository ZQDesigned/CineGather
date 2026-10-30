param(
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [string]$AttemptId = "",
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$expected = @(
  "$root\CineGather.exe",
  "$root\resources\capture\CGProcessAudioHost.exe",
  "$root\resources\capture\obs\bin\64bit\CGScreenCaptureHost.exe"
)
$logDirectory = Join-Path $env:LOCALAPPDATA 'CineGather\installer-logs'
function Record([string]$action, [string]$image = '', [int]$TargetProcessId=0) {
  try {
    New-Item -ItemType Directory -Force $logDirectory | Out-Null
    $logFile = Join-Path $logDirectory 'process-cleanup.jsonl'
    if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1048576) { Move-Item $logFile (Join-Path $logDirectory 'process-cleanup.previous.jsonl') -Force }
    @{ v=1;pid=$PID;attempt=$AttemptId;root=$root;code=$script:lastCode;targetPid=$TargetProcessId;matchedCount=$script:matchedCount;inaccessibleCount=$script:inaccessibleCount;scope=$(if($CheckOnly){"check"}else{"cleanup"}); time = [DateTime]::UtcNow.ToString('o'); action = $action; image = $image } |
      ConvertTo-Json -Compress | Add-Content (Join-Path $logDirectory 'process-cleanup.jsonl')
  } catch { }
}
try {
  $script:matchedCount=0
  $script:inaccessibleCount=0
  $script:lastCode = "process-query"
  Record 'query-started'
  $known = @(Get-CimInstance Win32_Process -Filter "Name='CineGather.exe' OR Name='CGScreenCaptureHost.exe' OR Name='CGProcessAudioHost.exe'")
  $script:inaccessibleCount=@($known | Where-Object {!$_.ExecutablePath}).Count
  $targets = @($known | Where-Object {
    $image = $_.ExecutablePath
    $image -and @($expected | Where-Object { [string]::Equals($_, $image, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
  })
  $script:matchedCount=$targets.Count
  $script:lastCode = "ok"
  Record 'query-complete'
  if ($CheckOnly) {
    if ($targets.Count -gt 0) { exit 10 }
    exit 0
  }
  foreach ($target in $targets) {
    # Recheck identity before terminating: never kill another installation, or
    # an unrelated process that happened to reuse an exited process's PID.
    $live = Get-CimInstance Win32_Process -Filter "ProcessId=$($target.ProcessId)"
    if (-not $live -or $live.CreationDate -ne $target.CreationDate -or $live.ExecutablePath -ne $target.ExecutablePath) { continue }
    $process = Get-Process -Id $target.ProcessId -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    Record 'stopping' $target.Name $target.ProcessId
    Stop-Process -InputObject $process -Force -ErrorAction Stop
    if (-not $process.WaitForExit(15000)) { throw 'process-exit-timeout' }
    Record 'stopped' $target.Name $target.ProcessId
  }
  Record 'ready'
  exit 0
} catch {
  $script:lastCode = $_.Exception.HResult
  Record 'cleanup-failed'
  exit 20
}
