param([string]$CleanupScript = (Join-Path $PSScriptRoot '../../../apps/desktop/resources/installer-processes.ps1'))
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('CGProbeCleanup-' + [guid]::NewGuid().ToString('N'))
$foreign = $root + '-other'
$names = @('obs-amf-test.exe', 'obs-nvenc-test.exe', 'obs-qsv-test.exe')
$inside = @(); $outside = @()
try {
  foreach ($directory in @($root,$foreign)) { New-Item -ItemType Directory -Force (Join-Path $directory 'resources/capture/obs/bin/64bit') | Out-Null }
  $source = Join-Path $root 'HoldFile.cs'
@'
using System.IO;
using System.Threading;
class HoldFile { static void Main(string[] args) { using(var held=new FileStream(args[0],FileMode.Open,FileAccess.Read,FileShare.Read)){ File.WriteAllText(args[1],"ready");Thread.Sleep(120000); } } }
'@ | Set-Content $source
  $template = Join-Path $root 'template.exe'
  & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe "/out:$template" $source
  if ($LASTEXITCODE -ne 0) { throw 'Probe cleanup fixture compilation failed' }
  $markers = @()
  foreach ($directory in @($root,$foreign)) {
    $data = Join-Path $directory 'runtime.dll'
    'probe fixture' | Set-Content $data
    foreach ($name in $names) {
      $image = Join-Path $directory ('resources/capture/obs/bin/64bit/' + $name)
      $marker = $image + '.ready'; $markers += $marker
      Copy-Item $template $image
      $p=Start-Process $image -ArgumentList @(('"'+$data+'"'),('"'+$marker+'"')) -PassThru
      if ($directory -eq $root) { $inside += $p } else { $outside += $p }
    }
  }
  for($i=0;$i -lt 100 -and @($markers | Where-Object { !(Test-Path $_) }).Count;$i++) { Start-Sleep -Milliseconds 100 }
  if (@($markers | Where-Object { !(Test-Path $_) }).Count) { throw 'Probe fixtures did not become ready' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CleanupScript -InstallDirectory $root -CheckOnly
  $before=$LASTEXITCODE
  if ($before -ne 10) {
    Write-Output "Fixture root: $root"
    Get-CimInstance Win32_Process -Filter "Name='obs-amf-test.exe' OR Name='obs-nvenc-test.exe' OR Name='obs-qsv-test.exe'" | Select-Object Name,ExecutablePath,ProcessId | Format-List
    Get-Content (Join-Path $env:LOCALAPPDATA 'CGInstallDiagnostics/installer-logs/process-cleanup.jsonl') -Tail 3
    throw "Probe processes were not detected: $before"
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CleanupScript -InstallDirectory $root
  if ($LASTEXITCODE -ne 0) { throw 'Probe process cleanup failed' }
  foreach($p in $inside) { if(!$p.WaitForExit(10000)) { throw 'An installed probe was left running' } }
  foreach($p in $outside) { $p.Refresh(); if($p.HasExited) { throw 'A probe from another installation was stopped' } }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CleanupScript -InstallDirectory $root -CheckOnly
  if ($LASTEXITCODE -ne 0) { throw 'Check-only still reports installed probe processes' }
  $evidence = Join-Path $PSScriptRoot '../../../.local/probe-cleanup-verification'
  New-Item -ItemType Directory -Force $evidence | Out-Null
  @{probeNames=$names;installedProbesStopped=$inside.Count;unrelatedProbesPreserved=$outside.Count;productionDataCreated=$false} | ConvertTo-Json | Set-Content (Join-Path $evidence 'win32.json')
  Write-Output 'Installed encoder probes stopped; unrelated installations preserved.'
} finally {
  foreach($p in @($inside)+@($outside)){if(!$p.HasExited){$p.Kill();$p.WaitForExit(5000) | Out-Null};$p.Dispose()}
  Remove-Item $root,$foreign -Recurse -Force -ErrorAction SilentlyContinue
}
