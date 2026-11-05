param([string]$InstallDirectory = 'E:\CGPlat\CineGather', [string]$OutputDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6)
$destination = Join-Path $OutputDirectory ('CineGather-Update-Diagnostics-' + $stamp)
New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
$script:issues = New-Object 'System.Collections.Generic.List[object]'
function Mask-Text([string]$Text) {
 foreach($p in @($env:LOCALAPPDATA,$env:APPDATA,$env:USERPROFILE) | Where-Object {$_ -and $_.Length -gt 4} | Sort-Object Length -Descending){foreach($form in @($p,(ConvertTo-Json -InputObject $p -Compress).Trim('"'))){$Text=[regex]::Replace($Text,[regex]::Escape($form),'<USER_DIRECTORY>','IgnoreCase')}}
 $Text=[regex]::Replace($Text,'(?i)([a-z]:\\Users\\)[^\\\r\n]+','$1<USER>')
 $Text=[regex]::Replace($Text,'(?i)(Bearer\s+|(?:token|password|secret)=)[^\s,;"\r\n]+','<REDACTED>')
 return $Text
}
function Save-Json([string]$Name,$Value) {
 $json=ConvertTo-Json -InputObject $Value -Depth 16
 foreach($p in @($env:LOCALAPPDATA,$env:APPDATA,$env:USERPROFILE) | Where-Object {$_ -and $_.Length -gt 4} | Sort-Object Length -Descending){$encoded=(ConvertTo-Json -InputObject $p -Compress).Trim('"');$json=[regex]::Replace($json,[regex]::Escape($encoded),'<USER_DIRECTORY>','IgnoreCase')}
 [IO.File]::WriteAllText((Join-Path $destination ($Name+'.json')),$json,(New-Object Text.UTF8Encoding($true)))
}
function Collect([string]$Name,[scriptblock]$Action) {
 Write-Host ('Collecting: '+$Name)
 try{$began=[DateTime]::UtcNow.ToString('o');$value=& $Action;Save-Json $Name @{startedUtc=$began;finishedUtc=[DateTime]::UtcNow.ToString('o');data=$value}}
 catch{$script:issues.Add(@{section=$Name;error=(Mask-Text $_.Exception.Message);hresult=$_.Exception.HResult;timeUtc=[DateTime]::UtcNow.ToString('o')})}
}
$root=[IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$roots=New-Object 'System.Collections.Generic.List[string]';$roots.Add($root)
function Add-Root([string]$Path){if(!$Path){return};try{$p=[IO.Path]::GetFullPath($Path).TrimEnd('\');if($p.Length -gt 3 -and !$roots.Contains($p) -and $roots.Count -lt 12){$roots.Add($p)}}catch{}}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($identity)
Save-Json 'capture' @{startedLocal=(Get-Date).ToString('o');startedUtc=[DateTime]::UtcNow.ToString('o');installDirectory=$root;elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);powershell=$PSVersionTable.PSVersion.ToString();collector='20261106-2';collectorPid=$PID;operations='Read-only inspection. No installer execution, process termination, file deletion, registry/ACL changes, cache clearing, or network upload.';limitations='Current locks do not prove earlier causes. Native queries may be unavailable without elevation. No credentials, browser storage, audio, chat, application binaries or memory dumps are collected.'}
$all=@()
function Process-Info($p){@{pid=[int]$p.ProcessId;ppid=[int]$p.ParentProcessId;name=[string]$p.Name;path=[string]$p.ExecutablePath;started=[string]$p.CreationDate;session=[int]$p.SessionId}}
function Is-Related($p){return $p.Name -match '(?i)CineGather|CGScreenCaptureHost|CGProcessAudioHost|cinegather-game-link|old-uninstaller' -or ($p.ExecutablePath -and $p.ExecutablePath.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase))}
Collect 'processes-before' {
 $script:all=@(Get-CimInstance Win32_Process)
 @($all | Where-Object {Is-Related $_} | Select-Object -First 128 | ForEach-Object {if($_.Name -eq 'CineGather.exe' -and $_.ExecutablePath){Add-Root (Split-Path $_.ExecutablePath -Parent)};Process-Info $_})
}
Collect 'related-windows' {@(Get-Process | Where-Object {$_.ProcessName -match 'CineGather|CGScreenCaptureHost|CGProcessAudioHost|old-uninstaller'} | Select-Object Id,ProcessName,Path,MainWindowTitle)}
Collect 'os' {Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime,LocalDateTime}
Collect 'disks' {@(Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,FileSystem,Size,FreeSpace)}
Save-Json 'collector-environment' @{temp=$env:TEMP;tmp=$env:TMP;is64BitProcess=[Environment]::Is64BitProcess;portableHintPresent=!!($env:PORTABLE_EXECUTABLE_DIR -or $env:PORTABLE_EXECUTABLE_FILE);note='Environment belongs to this collector, not necessarily the running app.'}
Collect 'registry' {
 $result=@()
 foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)){
  foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)){
   $base=$null;$uninstall=$null
   try{$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view);$uninstall=$base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall');if(!$uninstall){continue}
    foreach($key in $uninstall.GetSubKeyNames()){$entry=$null;$meta=$null
     try{$entry=$uninstall.OpenSubKey($key);if(!$entry -or [string]$entry.GetValue('DisplayName') -notmatch 'CineGather|映聚'){continue}
      $location=[string]$entry.GetValue('InstallLocation');if($key -match '^[a-fA-F0-9-]{36}$'){$meta=$base.OpenSubKey('Software\'+$key);if($meta -and $meta.GetValue('InstallLocation')){$location=[string]$meta.GetValue('InstallLocation')}}
      $command=[string]$entry.GetValue('UninstallString');$uninstallerPath='';if($command -match '^"([^"]+\.exe)"'){$uninstallerPath=$matches[1];if(!$location){$location=Split-Path $uninstallerPath -Parent}}
      Add-Root $location;$result+=@{hive=[string]$hive;view=[string]$view;key=$key;displayName=[string]$entry.GetValue('DisplayName');version=[string]$entry.GetValue('DisplayVersion');installLocation=$location;uninstallerPath=$uninstallerPath}
     }finally{if($meta){$meta.Dispose()};if($entry){$entry.Dispose()}}
    }
   }finally{if($uninstall){$uninstall.Dispose()};if($base){$base.Dispose()}}
  }
 };$result
}
# Bounded traversal explicitly skips junctions before descending into a directory.
function Get-OwnedFiles([string]$Directory,[int]$Limit=6000){
 $pending=New-Object 'System.Collections.Generic.Queue[string]';$pending.Enqueue($Directory);$found=New-Object 'System.Collections.Generic.List[object]';$walked=0
 while($pending.Count -gt 0 -and $found.Count -lt $Limit -and $walked -lt 256){$current=$pending.Dequeue();$item=Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue;if(!$item -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){continue};$walked++
  foreach($f in @(Get-ChildItem -LiteralPath $current -Force -ErrorAction SilentlyContinue)){if($f.Attributes -band [IO.FileAttributes]::ReparsePoint){continue};if($f.PSIsContainer){if($pending.Count -lt 256){$pending.Enqueue($f.FullName)}}elseif($found.Count -lt $Limit){$found.Add($f)}}
 };return $found.ToArray()
}
$files=@()
Collect 'installation-files' {
 $script:files=@(Get-OwnedFiles $root);@{requestedRoot=$root;exists=(Test-Path -LiteralPath $root);count=$files.Count;limit=6000;entries=@($files | Select-Object FullName,Length,Attributes,CreationTimeUtc,LastWriteTimeUtc)}
}
Collect 'installation-acl' {@(@($root,(Split-Path $root -Parent),(Join-Path $root 'resources'),(Join-Path $root 'CineGather.exe'),(Join-Path $root 'Uninstall CineGather.exe')) | Where-Object {Test-Path -LiteralPath $_} | ForEach-Object {$a=Get-Acl -LiteralPath $_;@{path=$_;owner=$a.Owner;sddl=$a.Sddl}})}

$native = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class CGUpgradeScene {
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
Collect 'file-access-and-locks' {
 Add-Type -TypeDefinition $native -Language CSharp
 $candidates=@($files | Sort-Object @{Expression={if($_.Extension -in @('.exe','.dll','.asar')){0}else{1}}},FullName | Select-Object -First 512)
 $probes=@($candidates | ForEach-Object {[CGUpgradeScene]::CheckDeleteAccess($_.FullName)})
 $failed=@($probes | Where-Object {$_.Error -ne 0});$groups=@()
 for($n=0;$n -lt $candidates.Count;$n+=128){[string[]]$batch=@($candidates | Select-Object -Skip $n -First 128 | ForEach-Object {$_.FullName});$groups+=@{paths=$batch;users=[CGUpgradeScene]::Query($batch)}}
 $individual=@($failed | Select-Object -First 32 | ForEach-Object {@{path=$_.Path;accessError=$_.Error;users=[CGUpgradeScene]::Query([string[]]@($_.Path))}})
 @{checked=$probes.Count;inventory=$files.Count;limit=512;failedAccess=$failed;resourceGroups=$groups;individualFailures=$individual;limitations='A successful DELETE-access open does not prove a rename will succeed. No file is deleted or renamed. Historical failures must be correlated with the installer journal.'}
}
function Read-AsarPackage([string]$Path){
 $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
 try{$reader=New-Object IO.BinaryReader($stream);$prefix=$reader.ReadBytes(16);if($prefix.Length -ne 16){throw 'asar-prefix-truncated'};$headerSize=[BitConverter]::ToUInt32($prefix,4);$jsonSize=[BitConverter]::ToUInt32($prefix,12);if($jsonSize -lt 2 -or $jsonSize -gt 8388608){throw 'asar-header-size'}
  $header=[Text.Encoding]::UTF8.GetString($reader.ReadBytes([int]$jsonSize)) | ConvertFrom-Json;$entry=$header.files.'package.json';if(!$entry -or $entry.unpacked -or [long]$entry.size -gt 131072){throw 'asar-package-entry'}
  $offset=8+[long]$headerSize+[long]$entry.offset;if($offset -lt 16 -or $offset+[long]$entry.size -gt $stream.Length){throw 'asar-entry-range'};$stream.Position=$offset
  $package=[Text.Encoding]::UTF8.GetString($reader.ReadBytes([int]$entry.size)) | ConvertFrom-Json
  return @{name=[string]$package.name;version=[string]$package.version}
 }finally{$stream.Dispose()}
}
Collect 'install-identities' {
 $result=@();foreach($installRoot in $roots){$r=@{path=$installRoot;exists=(Test-Path -LiteralPath $installRoot);files=@()}
  foreach($relative in @('CineGather.exe','Uninstall CineGather.exe','resources\app.asar','resources\install-mode')){$p=Join-Path $installRoot $relative;if(!(Test-Path -LiteralPath $p -PathType Leaf)){continue};$f=Get-Item -LiteralPath $p;if($f.Attributes -band [IO.FileAttributes]::ReparsePoint){continue};$row=@{path=$p;bytes=$f.Length;modifiedUtc=$f.LastWriteTimeUtc}
   try{if($relative -eq 'resources\install-mode'){$row.marker=(Get-Content -LiteralPath $p -Raw).Trim()}elseif($relative -eq 'resources\app.asar'){$row.package=Read-AsarPackage $p;$row.sha256=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash}else{$row.fileVersion=$f.VersionInfo.FileVersion;$row.productVersion=$f.VersionInfo.ProductVersion;$row.sha256=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash}}catch{$row.error=$_.Exception.HResult};$r.files+=$row
  };$result+=$r
 };$result
}
# Only the updater record is parsed. Never copy Local Storage, Preferences, cookies or credentials.
Collect 'pending-update' {
 $result=@();foreach($name in @('CineGather','cinegather')){$p=Join-Path $env:APPDATA ($name+'\pending-update.json');if(!(Test-Path -LiteralPath $p)){continue};$f=Get-Item -LiteralPath $p;if($f.Length -gt 140000 -or ($f.Attributes -band [IO.FileAttributes]::ReparsePoint)){continue}
  $value=Get-Content -LiteralPath $p -Raw | ConvertFrom-Json;$row=@{path=$p;modifiedUtc=$f.LastWriteTimeUtc;installerPath=[string]$value.file;signatureVerified=$false}
  try{$envelope=$value.envelope | ConvertFrom-Json;$payload=$envelope.payload | ConvertFrom-Json;$row.targetVersion=[string]$payload.version;$row.expectedBytes=$payload.artifact.size;$row.expectedSHA512=[string]$payload.artifact.sha512;$row.note='Metadata parsed for comparison only; this collector does not authenticate or execute installers.'}catch{$row.parseError=$_.Exception.HResult};$result+=$row
 };$result
}
Collect 'update-cache' {
 $cache=Join-Path $env:LOCALAPPDATA 'cinegather-updater';$result=@()
 foreach($f in @(Get-OwnedFiles $cache 100)){$row=@{path=$f.FullName;bytes=$f.Length;modifiedUtc=$f.LastWriteTimeUtc}
  if($f.Name -eq 'update-info.json' -and $f.Length -lt 65536){try{$v=Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json;$row.cacheInfo=@{fileName=[string]$v.fileName;sha512=[string]$v.sha512;isAdminRightsRequired=$v.isAdminRightsRequired}}catch{$row.parseError=$_.Exception.HResult}}
  if($f.Extension -eq '.exe' -and $f.Length -le 1073741824){try{$row.sha256=(Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash;$row.sha512Base64=[Convert]::ToBase64String([byte[]]([regex]::Matches((Get-FileHash -LiteralPath $f.FullName -Algorithm SHA512).Hash,'..') | ForEach-Object {[Convert]::ToByte($_.Value,16)}));$row.productVersion=$f.VersionInfo.ProductVersion}catch{$row.hashError=$_.Exception.HResult}}
  $result+=$row
 };@{path=$cache;exists=(Test-Path -LiteralPath $cache);limit=100;files=$result}
}
function Read-JournalText([string]$Path){
 # FileWriteUTF16LE journals have no BOM. Explicit decoding preserves paths and error text.
 if([IO.Path]::GetExtension($Path) -eq '.tsv'){$text=[IO.File]::ReadAllText($Path,[Text.Encoding]::Unicode)}else{$text=[IO.File]::ReadAllText($Path)}
 return (Mask-Text $text)
}
Collect 'installer-journals' {
 $target=Join-Path $destination 'installer-journals';New-Item -ItemType Directory -Path $target | Out-Null
 $sources=@((Join-Path $env:LOCALAPPDATA 'CGInstallDiagnostics\installer-logs'),(Join-Path $env:LOCALAPPDATA 'CineGather\installer-logs'))
 $owned='^(app-[a-f0-9-]+\.jsonl|nsis-\d+-\d+\.tsv|snapshot-[a-z0-9-]+\.json|process-cleanup(\.previous|\.legacy)?\.jsonl)$';$result=@();$total=0;$count=0
 foreach($source in $sources){if(!(Test-Path -LiteralPath $source)){continue};$dir=Get-Item -LiteralPath $source;if($dir.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
  foreach($f in @(Get-ChildItem -LiteralPath $source -File | Where-Object {$_.Name -match $owned -and !($_.Attributes -band [IO.FileAttributes]::ReparsePoint)} | Sort-Object LastWriteTimeUtc -Descending)){
   $row=@{source=$f.FullName;bytes=$f.Length;modifiedUtc=$f.LastWriteTimeUtc};if($count -ge 128 -or $f.Length -gt 2097152 -or $total+$f.Length -gt 33554432){$row.skipped='size-or-count-limit';$result+=$row;continue}
   try{$content=Read-JournalText $f.FullName;$out=('{0:D3}-' -f $count)+$f.Name;[IO.File]::WriteAllText((Join-Path $target $out),$content,(New-Object Text.UTF8Encoding($true)));$row.exported=$out;$total+=$f.Length;$count++}catch{$row.error=$_.Exception.HResult};$result+=$row
  }
 };@{copied=$count;totalSourceBytes=$total;entries=$result;note='No pruning, truncation or writes to original journals.'}
}
Collect 'security-products' {@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct -ErrorAction Stop | Select-Object displayName,productState)}
Collect 'related-system-events' {
 $since=(Get-Date).AddHours(-24);$result=@()
 foreach($name in @('Application','Microsoft-Windows-Windows Defender/Operational','Microsoft-Windows-CodeIntegrity/Operational','Microsoft-Windows-AppLocker/EXE and DLL','Microsoft-Windows-AppLocker/MSI and Script')){
  try{$result+=@(Get-WinEvent -FilterHashtable @{LogName=$name;StartTime=$since} -MaxEvents 1000 -ErrorAction Stop | Where-Object {$_.Message -match 'CineGather|CGScreenCaptureHost|CGProcessAudioHost|old-uninstaller' -or $_.Message -like ('*'+$root+'*')} | Select-Object -First 100 TimeCreated,Id,ProviderName,LevelDisplayName,Message)}catch{$script:issues.Add(@{section=$name;error=(Mask-Text $_.Exception.Message);hresult=$_.Exception.HResult})}
 };$result
}
Collect 'processes-after' {@(Get-CimInstance Win32_Process | Where-Object {Is-Related $_} | Select-Object -First 128 | ForEach-Object {Process-Info $_})}
Save-Json 'collection-issues' @($script:issues.ToArray())
Save-Json 'finished' @{local=(Get-Date).ToString('o');utc=[DateTime]::UtcNow.ToString('o')}
$zip=$destination+'.zip';Compress-Archive -LiteralPath $destination -DestinationPath $zip -CompressionLevel Optimal
Write-Host '';Write-Host ('READY: '+$zip) -ForegroundColor Green
Write-Host 'Send this ZIP and the complete installer error text or screenshot to the developer.'
