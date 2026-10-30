param(
 [ValidateSet('Snapshot','Export')][string]$Action='Export',
 [string]$InstallDirectory='', [string]$AttemptId='', [string]$InstallerVersion='',
 [string]$Phase='manual-export', [int]$ExitCode=0, [string]$FailedPath='', [string]$TargetPath='',
 [string]$LogDirectory=(Join-Path $env:LOCALAPPDATA 'CGInstallDiagnostics\installer-logs'),
 [string]$OutputDirectory=[Environment]::GetFolderPath('Desktop')
)
$ErrorActionPreference='Stop'
if($Action -eq 'Export'){Write-Host 'Collecting upgrade diagnostics...'}
if($InstallDirectory){$InstallDirectory=[IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')}
if($AttemptId -notmatch '^(?:[a-fA-F0-9-]{36}|nsis-\d+-\d+)$'){$AttemptId=[guid]::NewGuid().ToString()}
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
function SafePath([string]$Path){if($env:USERPROFILE){return $Path.Replace($env:USERPROFILE,'<USERPROFILE>')};return $Path}
# Import only the old cleanup journal, never application data or credentials.
$legacyIssue=$null
$legacy=Join-Path $env:LOCALAPPDATA 'CineGather\installer-logs\process-cleanup.jsonl'
try{
 if(Test-Path -LiteralPath $legacy){
  $cutoff=[DateTime]::UtcNow.AddDays(-30)
  @(Get-Content -LiteralPath $legacy -Tail 5000 | Where-Object {try{([DateTime](ConvertFrom-Json $_).time) -gt $cutoff}catch{$false}}) | Set-Content -LiteralPath (Join-Path $LogDirectory 'process-cleanup.legacy.jsonl') -Encoding UTF8
 }
}catch{$legacyIssue=@{stage='legacy-journal-read';code=$_.Exception.HResult}}
$report=@{v=1;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();phase=$Phase;attempt=$AttemptId;version=$InstallerVersion;pid=$PID;path=(SafePath $InstallDirectory);code=$ExitCode;failedPath=(SafePath $FailedPath);targetPath=(SafePath $TargetPath);complete=$false;processes=@();files=@();registry=@();volumes=@();access=@();issues=@()}
if($legacyIssue){$report.issues+= $legacyIssue}
$snapshot=Join-Path $LogDirectory ('snapshot-'+$AttemptId+'-'+$PID+'-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+'.json')
function SaveSnapshot {
 $json=ConvertTo-Json -InputObject $report -Depth 10
 if([Text.Encoding]::UTF8.GetByteCount($json) -gt 1048576){throw 'snapshot-size-limit'}
 $json | Set-Content -LiteralPath ($snapshot+'.tmp') -Encoding UTF8
 Move-Item -LiteralPath ($snapshot+'.tmp') -Destination $snapshot -Force
}
function Section([string]$Name,[scriptblock]$Work){try{& $Work}catch{$report.issues+=@{stage=$Name;code=$_.Exception.HResult}};SaveSnapshot}
SaveSnapshot
Section 'environment' {
 $who=[Security.Principal.WindowsIdentity]::GetCurrent()
 $principal=New-Object Security.Principal.WindowsPrincipal($who)
 $report.environment=@{temp=(SafePath $env:TEMP);osVersion=[Environment]::OSVersion.Version.ToString();elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);userSid=$who.User.Value}
 $report.volumes=@(Get-CimInstance Win32_LogicalDisk | Select-Object -First 32 | ForEach-Object {@{drive=$_.DeviceID;filesystem=[string]$_.FileSystem;free=[double]$_.FreeSpace}})
}
$all=@()
function ProcessInfo($p){@{pid=[int]$p.ProcessId;ppid=[int]$p.ParentProcessId;name=[string]$p.Name;path=(SafePath ([string]$p.ExecutablePath));started=([string]$p.CreationDate);session=[int]$p.SessionId}}
Section 'processes' {
 $script:all=@(Get-CimInstance Win32_Process)
 $report.processes=@($all | Where-Object {$_.Name -match 'CineGather|CGScreenCaptureHost|CGProcessAudioHost|old-uninstaller' -or ($InstallDirectory -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDirectory,[StringComparison]::OrdinalIgnoreCase))} | Select-Object -First 128 | ForEach-Object {ProcessInfo $_})
}
Section 'registry' {
 # Use explicit views: an NSIS-launched 32-bit PowerShell must still see a
 # 64-bit installation, and a stale per-machine entry must remain visible.
 foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)){
  foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){
   $baseKey=$null;$uninstall=$null
   try{
    $baseKey=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
    $uninstall=$baseKey.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall')
    if(!$uninstall){continue}
    foreach($name in $uninstall.GetSubKeyNames()){
     $entry=$null;$meta=$null
     try{
      $entry=$uninstall.OpenSubKey($name)
      if(!$entry -or [string]$entry.GetValue('DisplayName') -notlike '*CineGather*'){continue}
      $location=[string]$entry.GetValue('InstallLocation')
      # electron-builder stores the authoritative location in Software/APP_GUID.
      if($name -match '^[a-fA-F0-9-]{36}$'){$meta=$baseKey.OpenSubKey('Software\'+$name);if($meta){$location=[string]$meta.GetValue('InstallLocation')}}
      if(!$location){$command=[string]$entry.GetValue('UninstallString');if($command -match '^"([^"]+Uninstall CineGather\.exe)"'){$location=Split-Path $matches[1] -Parent}}
      $report.registry+=@{hive=([string]$hive+':'+[string]$view+'\'+$name);version=[string]$entry.GetValue('DisplayVersion');path=(SafePath $location)}
      if(!$InstallDirectory -and $location -and (Test-Path -LiteralPath $location)){$script:InstallDirectory=$location}
     }catch{if($report.issues.Count -lt 100){$report.issues+=@{stage='registry-entry';code=$_.Exception.HResult}}}
     finally{if($meta){$meta.Dispose()};if($entry){$entry.Dispose()}}
    }
   }finally{if($uninstall){$uninstall.Dispose()};if($baseKey){$baseKey.Dispose()}}
  }
 }
 $report.registry=@($report.registry | Select-Object -First 16)
 $report.path=SafePath $InstallDirectory
}

Section 'permissions' {
 foreach($p in @($InstallDirectory,$FailedPath,$TargetPath,$(if($TargetPath){Split-Path $TargetPath -Parent})) | Select-Object -Unique){
  if(!$p -or !(Test-Path -LiteralPath $p)){continue}
  $a=Get-Acl -LiteralPath $p
  $report.access+=@{path=(SafePath $p);owner=[string]$a.Owner;sddl=[string]$a.Sddl}
 }
}
$native=@'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class CGInstallProbe {
 [StructLayout(LayoutKind.Sequential)] public struct UniqueProcess { public uint ProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME Started; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct ProcessInfo {
  public UniqueProcess Process;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string AppName;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string ServiceName;
  public uint ApplicationType; public uint AppStatus; public uint SessionId;
  [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
 }
 [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint handle, uint flags, StringBuilder key);
 [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint handle, uint files, string[] paths, uint apps, IntPtr appList, uint services, IntPtr serviceList);
 [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint handle, out uint needed, ref uint count, [In,Out] ProcessInfo[] list, ref uint reasons);
 [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint handle);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint sharing,IntPtr security,uint disposition,uint flags,IntPtr template);
 public class Probe { public string Path; public int Error; }
 public class ResourceUsers { public int Error; public uint RebootReasons; public ProcessInfo[] Processes; }
 public static Probe CheckDeleteAccess(string path) {
  using(var h=CreateFile(path,0x10000,7,IntPtr.Zero,3,0x80,IntPtr.Zero)) {
   return new Probe { Path=path, Error=h.IsInvalid ? Marshal.GetLastWin32Error() : 0 };
  }
 }
 public static ResourceUsers Query(string[] paths) {
  uint session; int error=RmStartSession(out session,0,new StringBuilder(33));
  if(error!=0) return new ResourceUsers { Error=error };
  try {
   error=RmRegisterResources(session,(uint)paths.Length,paths,0,IntPtr.Zero,0,IntPtr.Zero);
   if(error!=0) return new ResourceUsers { Error=error };
   uint needed=0,count=0,reasons=0; ProcessInfo[] list=null;
   for(int attempt=0;attempt<4;attempt++) {
    error=RmGetList(session,out needed,ref count,list,ref reasons);
    if(error!=234) break;
    count=needed; list=new ProcessInfo[count];
   }
   if(error==0 && list!=null && count<list.Length) Array.Resize(ref list,(int)count);
   return new ResourceUsers { Error=error, RebootReasons=reasons, Processes=list ?? new ProcessInfo[0] };
  } finally { RmEndSession(session); }
 }
}
'@
Section 'file-resource-users' {
 Add-Type -TypeDefinition $native -Language CSharp
 $files=@()
 if($FailedPath -and (Test-Path -LiteralPath $FailedPath -PathType Leaf)){$files+=Get-Item -LiteralPath $FailedPath}
 if($TargetPath -and (Test-Path -LiteralPath $TargetPath -PathType Leaf)){$files+=Get-Item -LiteralPath $TargetPath}
 if($InstallDirectory -and (Test-Path -LiteralPath $InstallDirectory)){$files+=@(Get-ChildItem -LiteralPath $InstallDirectory -File -Recurse -ErrorAction SilentlyContinue | Where-Object {!($_.Attributes -band [IO.FileAttributes]::ReparsePoint)} | Select-Object -First 255)}
 $queries=0
 foreach($f in $files | Sort-Object FullName -Unique | Select-Object -First 256){
  $probe=[CGInstallProbe]::CheckDeleteAccess($f.FullName)
  $row=@{path=(SafePath $f.FullName);size=[double]$f.Length;code=$probe.Error;owners=@()}
  if(($probe.Error -ne 0 -or $f.FullName -eq $FailedPath) -and $queries -lt 16){
   $users=[CGInstallProbe]::Query([string[]]@($f.FullName));$queries++;$row.queryCode=$users.Error
   foreach($owner in $users.Processes | Select-Object -First 32){
    $ownerProcess=$all | Where-Object {$_.ProcessId -eq $owner.Process.ProcessId} | Select-Object -First 1
    if($ownerProcess){$row.owners+=ProcessInfo $ownerProcess}else{$row.owners+=@{pid=[int]$owner.Process.ProcessId;name=[string]$owner.AppName}}
   }
  }
  if($f.FullName -eq $FailedPath -or $f.FullName -eq $TargetPath){
   if($f.Length -le 104857600){try{$row.sha256=(Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash}catch{$row.hashError=$_.Exception.HResult}}
   else{$row.hashError='size-limit'}
  }
  $report.files+=$row
 }
 if($files.Count -gt 256){$report.issues+=@{stage='file-resource-users';code='file-count-limit'}}
}
$report.complete=$true
SaveSnapshot
# Never follow links while pruning, and only delete this feature's own logs.
$owned='^(app-[a-f0-9-]+\.jsonl|nsis-\d+-\d+\.tsv|snapshot-[a-z0-9-]+\.json|process-cleanup(\.previous|\.legacy)?\.jsonl)$'
$history=@(Get-ChildItem -LiteralPath $LogDirectory -File | Where-Object {$_.Name -match $owned -and !($_.Attributes -band [IO.FileAttributes]::ReparsePoint)} | Sort-Object LastWriteTimeUtc -Descending)
$count=0;$bytes=0
foreach($f in $history){$count++;$bytes+=$f.Length;if($f.FullName -eq $snapshot){continue};if($count -gt 64 -or $bytes -gt 33554432 -or $f.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddDays(-30)){Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue}}
if($Action -eq 'Export'){
 if(!$OutputDirectory){$OutputDirectory=$PSScriptRoot}
 New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
 $stage=Join-Path $env:TEMP ('cg-upgrade-export-'+[guid]::NewGuid().ToString())
 New-Item -ItemType Directory -Path $stage | Out-Null
 $exportIssues=@();$exportBytes=0;$exportCount=0
 try{
  foreach($f in Get-ChildItem -LiteralPath $LogDirectory -File | Where-Object {$_.Name -match $owned -and !($_.Attributes -band [IO.FileAttributes]::ReparsePoint)} | Sort-Object LastWriteTimeUtc -Descending){
   $exportBytes+=$f.Length;$exportCount++
   if($f.Length -gt 1048576 -or $exportBytes -gt 33554432 -or $exportCount -gt 64){$exportIssues+=($f.Name+':size-limit');continue}
   try{Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $stage $f.Name)}catch{$exportIssues+=($f.Name+':copy-failed')}
  }
  @{format='cinegather-installer-diagnostics';createdAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();issues=$exportIssues;containsLocalPaths=$true;limitations='Current resource users cannot prove historical causes. Legacy uninstallers may not record their first failed file. No audio, credentials, or automatic upload.'} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $stage 'manifest.json') -Encoding UTF8
  $zip=Join-Path $OutputDirectory ('CineGather-upgrade-diagnostics-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.zip')
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
  Write-Host ('READY: '+$zip)
 }finally{Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue}
}
