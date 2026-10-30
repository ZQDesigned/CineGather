param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference='Stop'
$installer=(Resolve-Path $Installer).Path
$root='D:\CGPlat\CineGather Diagnostics'
$evidence=Join-Path $PSScriptRoot '../.local/installer-diagnostics-windows'
New-Item -ItemType Directory -Force $evidence | Out-Null
$evidence=(Resolve-Path $evidence).Path
$logs=Join-Path $env:LOCALAPPDATA 'CineGather\installer-logs'
function RunInstaller([string[]]$Flags){
 $p=Start-Process $installer -ArgumentList $Flags -PassThru
 if(!$p.WaitForExit(120000)){throw 'installer-timeout'}
 if($p.ExitCode -ne 0){throw ('installer-exit-'+$p.ExitCode)}
}
RunInstaller @('/S',('/D='+$root))
$asar=Join-Path $root 'resources\app.asar'
$before=(Get-FileHash $asar -Algorithm SHA256).Hash
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
$held=Start-Process $helper -ArgumentList @(('"'+$asar+'"'),('"'+$marker+'"')) -PassThru
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
 if($rowsText -notmatch 'atomic-rename-failed' -or $rowsText -notmatch 'app.asar'){throw 'missing-first-failed-file'}
 $snapshots=@(Get-ChildItem $logs -Filter 'snapshot-*.json' | Where-Object {$_.LastWriteTimeUtc -gt $since} | ForEach-Object {Get-Content $_.FullName -Raw | ConvertFrom-Json})
 $owners=@($snapshots | ForEach-Object {$_.files} | ForEach-Object {$_.owners} | ForEach-Object {$_.pid})
 if($owners -notcontains $held.Id){throw 'foreign-file-owner-not-reported'}
 if($held.HasExited){throw 'unrelated-process-was-killed'}
 if((Get-FileHash $asar -Algorithm SHA256).Hash -ne $before){throw 'rollback-did-not-preserve-app'}
 $version=(Get-Content (Join-Path $PSScriptRoot '../apps/desktop/package.json') -Raw | ConvertFrom-Json).version
 $support=Join-Path $env:LOCALAPPDATA ('CineGather\support\'+$version+'\installer-diagnostics.ps1')
 if(!(Test-Path $support)){throw 'independent-support-missing'}
 & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $support -Action Export -InstallDirectory $root -OutputDirectory $evidence
 if($LASTEXITCODE -ne 0 -or !(Get-ChildItem $evidence -Filter 'CineGather-upgrade-diagnostics-*.zip')){throw 'standalone-export-failed'}
 # Dismiss only this fixture installer's error box, without foreground/focus.
 Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CGDiagnosticDialog {
 delegate bool Each(IntPtr w,IntPtr x);
 [DllImport("user32.dll")] static extern bool EnumWindows(Each cb,IntPtr arg);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr w,Each cb,IntPtr arg);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr w,StringBuilder s,int n);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr w,uint m,IntPtr p,IntPtr l);
 public static void Dismiss(int[] processes) { EnumWindows((w,x)=>{uint p;GetWindowThreadProcessId(w,out p);if(Array.IndexOf(processes,(int)p)<0)return true;bool match=false;EnumChildWindows(w,(c,y)=>{var s=new StringBuilder(4096);GetWindowText(c,s,4096);if(s.ToString().Contains("installer-logs"))match=true;return true;},IntPtr.Zero);if(match)PostMessage(w,0x111,(IntPtr)1,IntPtr.Zero);return true;},IntPtr.Zero); }
}
'@
 for($i=0;$i -lt 30 -and !$failure.HasExited;$i++){
  $known=@(Get-CimInstance Win32_Process)
  $ids=New-Object 'System.Collections.Generic.HashSet[int]';[void]$ids.Add($failure.Id)
  for($pass=0;$pass -lt 4;$pass++){foreach($p in $known){if($ids.Contains([int]$p.ParentProcessId) -and $p.ExecutablePath -eq $installer){[void]$ids.Add([int]$p.ProcessId)}}}
  [CGDiagnosticDialog]::Dismiss([int[]]@($ids));Start-Sleep -Milliseconds 500
 }
 if(!$failure.WaitForExit(5000)){throw 'failure-dialog-did-not-close'}
 if($failure.ExitCode -ne 2){throw ('unexpected-failure-exit-'+$failure.ExitCode)}
 Stop-Process -Id $held.Id -Force
 $held.WaitForExit()
 RunInstaller @('/S','--updated')
 $afterRows=@(Get-ChildItem $logs -Filter 'nsis-*.tsv' | ForEach-Object {Get-Content $_.FullName -Encoding Unicode}) -join "`n"
 if($afterRows -notmatch 'install-success'){throw 'success-stage-missing'}
 @{registryOnlyUpgrade=$true;failedExit=2;firstFailedFile=$true;foreignOwnerRecorded=$true;foreignProcessPreserved=$true;rollbackBytesPreserved=$true;independentExport=$true;retryAfterLockReleaseSucceeded=$true} | ConvertTo-Json | Set-Content (Join-Path $evidence 'result.json')
 Copy-Item $logs (Join-Path $evidence 'logs') -Recurse
}finally{
 if($failure -and !$failure.HasExited){Stop-Process -Id $failure.Id -Force}
 if(!$held.HasExited){Stop-Process -Id $held.Id -Force}
}
