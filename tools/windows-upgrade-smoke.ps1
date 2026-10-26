$ErrorActionPreference = 'Stop'
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
