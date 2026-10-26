param(
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
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
function Record([string]$action, [string]$image = '') {
  try {
    New-Item -ItemType Directory -Force $logDirectory | Out-Null
    @{ time = [DateTime]::UtcNow.ToString('o'); action = $action; image = $image } |
      ConvertTo-Json -Compress | Add-Content (Join-Path $logDirectory 'process-cleanup.jsonl')
  } catch { }
}
try {
  $targets = @(Get-CimInstance Win32_Process -Filter "Name='CineGather.exe' OR Name='CGScreenCaptureHost.exe' OR Name='CGProcessAudioHost.exe'" | Where-Object {
    $image = $_.ExecutablePath
    $image -and @($expected | Where-Object { [string]::Equals($_, $image, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
  })
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
    Record 'stopping' $target.Name
    Stop-Process -InputObject $process -Force -ErrorAction Stop
    if (-not $process.WaitForExit(15000)) { throw 'process-exit-timeout' }
    Record 'stopped' $target.Name
  }
  Record 'ready'
  exit 0
} catch {
  Record 'cleanup-failed'
  exit 20
}
