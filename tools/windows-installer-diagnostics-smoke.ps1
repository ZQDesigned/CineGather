param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference='Stop'
$installer=(Resolve-Path $Installer).Path
$root='D:\CGPlat\CineGather Diagnostics'
$evidence=Join-Path $PSScriptRoot '../.local/installer-diagnostics-windows'
New-Item -ItemType Directory -Force $evidence | Out-Null
$evidence=(Resolve-Path $evidence).Path
$logs=Join-Path $env:LOCALAPPDATA 'CGInstallDiagnostics\installer-logs'
function RunInstaller([string[]]$Flags){
 $p=Start-Process $installer -ArgumentList $Flags -PassThru
 if(!$p.WaitForExit(120000)){throw 'installer-timeout'}
 if($p.ExitCode -ne 0){throw ('installer-exit-'+$p.ExitCode)}
}
RunInstaller @('/S',('/D='+$root))
$asar=Join-Path $root 'resources\app.asar'
$before=(Get-FileHash $asar -Algorithm SHA256).Hash
$lockedFile=Join-Path $root 'zz-diagnostic-lock.data'
'diagnostic lock fixture' | Set-Content $lockedFile
for($n=0;$n -lt 300;$n++){'filler' | Set-Content (Join-Path $root ('diagnostic-filler-'+$n+'.data'))}
$helper=Join-Path $evidence 'CGForeignLock.exe'
$marker=Join-Path $evidence 'lock-ready'
$cs=Join-Path $evidence 'lock.cs'
@'
using System.IO;
using System.Threading;
public class ForeignLock { public static void Main(string[] args) { using(var file=new FileStream(args[0],FileMode.Open,FileAccess.Read,FileShare.Read)){ File.WriteAllText(args[1],"ready"); Thread.Sleep(300000); } } }
'@ | Set-Content $cs
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe "/out:$helper" $cs
if($LASTEXITCODE -ne 0){throw 'fixture-compilation-failed'}
$held=Start-Process $helper -ArgumentList @(('"'+$lockedFile+'"'),('"'+$marker+'"')) -PassThru
$failure=$null
try{
 for($i=0;$i -lt 100 -and !(Test-Path $marker);$i++){Start-Sleep -Milliseconds 100}
 if(!(Test-Path $marker)){throw 'lock-not-ready'}
 $since=[DateTime]::UtcNow
 # Match the production updater: resolve its installation through registry, no /D.
 $failure=Start-Process $installer -ArgumentList @('/S','--updated') -PassThru
 $found=$false
 for($i=0;$i -lt 180;$i++){
  $rows=@(Get-ChildItem $logs -Filter 'nsis-*.tsv' | Where-Object {$_.LastWriteTimeUtc -gt $since} | ForEach-Object {Get-Content $_.FullName -Encoding Unicode})
  if($rows -match 'old-uninstall-result.*\t2\t'){$found=$true;break}
  if($failure.HasExited){throw ('failed-install-exited-without-evidence-'+$failure.ExitCode)}
  Start-Sleep -Seconds 1
 }
 if(!$found){throw 'missing-failed-uninstall-result'}
 $rowsText=$rows -join "`n"
 if($rowsText -notmatch 'atomic-rename-failed' -or $rowsText -notmatch 'zz-diagnostic-lock.data'){throw 'missing-first-failed-file'}
 $snapshots=@(Get-ChildItem $logs -Filter 'snapshot-*.json' | Where-Object {$_.LastWriteTimeUtc -gt $since} | ForEach-Object {Get-Content $_.FullName -Raw | ConvertFrom-Json})
 $owners=@($snapshots | ForEach-Object {$_.files} | ForEach-Object {$_.owners} | ForEach-Object {$_.pid})
 if($owners -notcontains $held.Id){throw 'foreign-file-owner-not-reported'}
 if(!@($snapshots | ForEach-Object {$_.issues} | Where-Object {$_.code -eq 'file-count-limit'}).Count){throw 'file-inventory-truncation-not-reported'}
 if($held.HasExited){throw 'unrelated-process-was-killed'}
 if((Get-FileHash $asar -Algorithm SHA256).Hash -ne $before){throw 'rollback-did-not-preserve-app'}
 $version=(Get-Content (Join-Path $PSScriptRoot '../apps/desktop/package.json') -Raw | ConvertFrom-Json).version
 $support=Join-Path $env:LOCALAPPDATA ('CGInstallDiagnostics\support\'+$version+'\installer-diagnostics.ps1')
 if(!(Test-Path $support)){throw 'independent-support-missing'}
 $menu=Join-Path ([Environment]::GetFolderPath('Programs')) 'CineGather 升级诊断.lnk'
 if(!(Test-Path $menu)){throw 'diagnostic-menu-missing'}
 $shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($menu)
 if(!$shortcut.Arguments.Contains($support)){throw 'diagnostic-menu-depends-on-install-directory'}
 & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $support -Action Export -InstallDirectory $root -OutputDirectory $evidence
 if($LASTEXITCODE -ne 0 -or !(Get-ChildItem $evidence -Filter 'CineGather-upgrade-diagnostics-*.zip')){throw 'standalone-export-failed'}
 # The error message intentionally remains modal, including in silent mode.
 # Its recorded uninstaller exit=2 is already asserted above. Headless workers
 # cannot reliably click another process's dialog; end only this test-owned
 # failed installer after collecting all evidence, before testing a retry.
 Stop-Process -Id $failure.Id -Force
 $failure.WaitForExit()
 Stop-Process -Id $held.Id -Force
 $held.WaitForExit()
 RunInstaller @('/S','--updated')
 $afterRows=@(Get-ChildItem $logs -Filter 'nsis-*.tsv' | ForEach-Object {Get-Content $_.FullName -Encoding Unicode}) -join "`n"
 if($afterRows -notmatch 'install-success'){throw 'success-stage-missing'}
 @{registryOnlyUpgrade=$true;recordedUninstallerExit=2;fixtureDialogClosedByHarness=$true;firstFailedFile=$true;foreignOwnerRecorded=$true;foreignProcessPreserved=$true;rollbackBytesPreserved=$true;independentExport=$true;retryAfterLockReleaseSucceeded=$true} | ConvertTo-Json | Set-Content (Join-Path $evidence 'result.json')
 Copy-Item $logs (Join-Path $evidence 'logs') -Recurse
}finally{
 if($failure -and !$failure.HasExited){Stop-Process -Id $failure.Id -Force}
 if(!$held.HasExited){Stop-Process -Id $held.Id -Force}
}
