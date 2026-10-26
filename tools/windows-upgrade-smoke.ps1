$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$evidence = Join-Path $PSScriptRoot '../.local/windows-upgrade'
New-Item -ItemType Directory -Force $evidence | Out-Null
$evidence = (Resolve-Path $evidence).Path
$installer = Join-Path $evidence 'CineGather-0.1.14-setup.exe'
Invoke-WebRequest 'https://cgplat.zqdesigned.city/downloads/CineGather-0.1.14-win-x64-setup.exe' -OutFile $installer

# Exercise the released installer itself, with TEMP and the installation on
# different volumes, before attributing the failure to a process/file lock.
$install = 'D:\CGPlat\CineGather'
$env:TEMP = 'C:\CGUpgradeTemp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
$results = @()
foreach ($phase in @('install', 'upgrade')) {
  $arguments = @('/S')
  if ($phase -eq 'upgrade') { $arguments += '--updated' }
  $arguments += "/D=$install"
  $process = Start-Process -FilePath $installer -ArgumentList $arguments -PassThru
  if (-not $process.WaitForExit(120000)) {
    Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath | ConvertTo-Json | Set-Content (Join-Path $evidence "$phase-processes.json")
    & taskkill /F /T /PID $process.Id
    throw "$phase timed out"
  }
  $results += @{ phase = $phase; exitCode = $process.ExitCode; installed = (Test-Path "$install\CineGather.exe"); install = $install; temp = $env:TEMP }
  $results | ConvertTo-Json | Set-Content (Join-Path $evidence 'result.json')
  if ($process.ExitCode -ne 0) { throw "$phase failed: $($process.ExitCode)" }
}

# An orphaned capture process is not named CineGather.exe. When PowerShell's
# normal execution policy is Restricted, the released NSIS script falls back
# to matching only the main process name and leaves this helper behind.
$helper = Join-Path $install 'resources/capture/CGProcessAudioHost.exe'
$originalHelper = "$helper.saved"
Move-Item $helper $originalHelper
$compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$fixture = Join-Path $evidence 'LockedHelper.cs'
@'
using System;
using System.Threading;
class LockedHelper { static void Main() { Thread.Sleep(180000); } }
'@ | Set-Content $fixture
& $compiler /nologo /target:winexe "/out:$helper" $fixture
if ($LASTEXITCODE -ne 0) { throw 'Cannot build lock fixture' }
$lock = Start-Process $helper -PassThru
$previousPolicy = Get-ExecutionPolicy -Scope CurrentUser
try {
  Set-ExecutionPolicy -Scope CurrentUser Restricted -Force
  $process = Start-Process -FilePath $installer -ArgumentList @('/S', '--updated', "/D=$install") -PassThru
  if (-not $process.WaitForExit(45000)) {
    & taskkill /F /T /PID $process.Id
    $exitCode = 'timeout-with-uninstall-error-dialog'
  } else { $exitCode = $process.ExitCode }
  $results += @{ phase = 'orphan-helper-upgrade'; exitCode = $exitCode; helperStillRunning = (-not $lock.HasExited); policy = 'Restricted' }
  $results | ConvertTo-Json | Set-Content (Join-Path $evidence 'result.json')
  if ($exitCode -ne 0) { throw "Upgrade left a capture helper running: $exitCode" }
} finally {
  Set-ExecutionPolicy -Scope CurrentUser $previousPolicy -Force
  if (-not $lock.HasExited) { Stop-Process -Id $lock.Id -Force }
}
