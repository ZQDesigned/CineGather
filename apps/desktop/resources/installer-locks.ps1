param(
    [Parameter(Mandatory = $true)][string]$InstallDirectory,
    [Parameter(Mandatory = $true)][string]$ReportPath,
    [string]$AttemptId = ''
)
# Read-only probing. This helper must never stop, restart, or close any process.
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
if ($AttemptId -notmatch '^(?:[a-fA-F0-9-]{36}|nsis-\d+-\d+)$') {
    $AttemptId = [guid]::NewGuid().ToString()
}
$report = @{v =1
    at        =[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    phase     ='external-file-lock-check'
    attempt   =$AttemptId
    pid       =$PID
    path      =$root
    complete  =$false
    files     =@()
    issues    =@()
}
function SafePath([string]$Path) {
    if ($env:USERPROFILE) {
        return $Path.Replace($env:USERPROFILE, '<USERPROFILE>')
    }
    return $Path
}
function Finish([int]$ResultCode, [string]$Message) {
    try {
        # One line without a BOM: NSIS reads it with FileReadUTF16LE, independent of
        # console code pages. Keep well below even NSIS's 1024-character string limit.
        [IO.File]::WriteAllText($ReportPath, $Message, (New-Object Text.UnicodeEncoding($false, $false)))
        if ($ResultCode -ne 0) {
            $report.path = SafePath $root
            $report.code = $ResultCode
            $report.complete = ($report.complete -and $report.issues.Count -eq 0)
            $report.issues = @($report.issues | Select-Object -First 100)
            $logs = Join-Path $env:LOCALAPPDATA 'CGInstallDiagnostics\installer-logs'
            New-Item -ItemType Directory -Force $logs | Out-Null
            # Bounded per-attempt evidence, without growing a file on every Retry click.
            $file = Join-Path $logs ('snapshot-' + $AttemptId + '-file-locks.json')
            $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ($file + '.tmp') -Encoding UTF8
            Move-Item -LiteralPath ($file + '.tmp') -Destination $file -Force
        }
    }
    catch {
        exit 20
    }
    exit $ResultCode
}
$native = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class CGInstallLockProbe {
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
try {
    Add-Type -TypeDefinition $native -Language CSharp
    if (!(Test-Path -LiteralPath $root -PathType Container)) {
        Finish 0 ''
    }
    if ($root.Length -lt 4 -or ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'invalid-installation-root'
    }
    $pending = New-Object 'System.Collections.Generic.Queue[string]'
    $pending.Enqueue($root)
    $blocked = New-Object 'System.Collections.Generic.List[string]'
    $visited = 0
    $files = 0
    # Probe priority files first, then the rest of the installation. Never follow
    # junctions, recurse outside the installation, or scan arbitrary user folders.
    $seen = @{}
    $errorsByPath = @{}
    foreach ($name in @('CineGather.exe', 'resources\app.asar')) {
        $path = Join-Path $root $name
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            $item = Get-Item -LiteralPath $path
            if (!($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                $seen[$path] = $true
                $files++
                $probeError = [CGInstallLockProbe]::CheckDeleteAccess($path).Error
                if ($probeError -in @(32, 33)) {
                    $blocked.Add($path)
                    $errorsByPath[$path] = $probeError
                }
            }
        }
    }
    while ($pending.Count -gt 0 -and $visited -lt 512 -and $files -lt 6000 -and $blocked.Count -lt 64) {
        $directory = $pending.Dequeue()
        $visited++
        try {
            $entries = @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)
        }
        catch {
            $report.issues += @{stage ='directory-read'
                code                  =$_.Exception.HResult
            }
            continue
        }
        foreach ($item in $entries) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                continue
            }
            if ($item.PSIsContainer) {
                if ($pending.Count -lt 512) {
                    $pending.Enqueue($item.FullName)
                }
                continue
            }
            if ($files -ge 6000 -or $blocked.Count -ge 64) {
                break
            }
            if ($seen.ContainsKey($item.FullName)) {
                continue
            }
            $seen[$item.FullName] = $true
            $files++
            $probeError = [CGInstallLockProbe]::CheckDeleteAccess($item.FullName).Error
            if ($probeError -in @(32, 33)) {
                $blocked.Add($item.FullName)
                $errorsByPath[$item.FullName] = $probeError
            }
        }
    }
    if ($pending.Count -gt 0 -or $files -ge 6000 -or $blocked.Count -ge 64) {
        $report.issues += @{stage ='file-inventory'
            code                  ='count-limit'
        }
    }
    $report.complete = ($report.issues.Count -eq 0)
    if (!$blocked.Count) {
        Finish 0 ''
    }
    # Register related resources together, rather than starting a registry-backed
    # Restart Manager session per file. No shutdown/restart APIs are imported.
    $users = [CGInstallLockProbe]::Query([string[]]$blocked.ToArray())
    $owners = @()
    $labels = @()
    if ($users.Error -eq 0) {
        foreach ($owner in @($users.Processes | Select-Object -First 32)) {
            $targetPid = [int]$owner.Process.ProcessId
            $name = [string]$owner.AppName
            try {
                $process = Get-Process -Id $targetPid -ErrorAction Stop
                $started = ([int64]$owner.Process.Started.dwHighDateTime -shl 32) -bor ($owner.Process.Started.dwLowDateTime -band 4294967295L)
                if ($process.StartTime.ToUniversalTime().ToFileTimeUtc() -eq $started) {
                    $name = $process.ProcessName + '.exe'
                }
            }
            catch {
            }
            $name = ($name -replace '[\p{Cc}\p{Cf}]', ' ').Trim()
            if (!$name) {
                $name = '未能识别名称的程序'
            }
            if ($name.Length -gt 90) {
                $name = $name.Substring(0, 90) + '…'
            }
            $owners += @{pid =$targetPid
                name         =$name
            }
            if ($labels.Count -lt 6) {
                $labels += ($name + '（进程 ' + $targetPid + '）')
            }
        }
    }
    else {
        $report.issues += @{stage ='resource-users'
            code                  =$users.Error
        }
    }
    $report.phase = 'external-file-lock-detected'
    $report.processes = $owners
    $report.files = @($blocked | Select-Object -First 32 | ForEach-Object { @{path =(SafePath $_)
                code                                                               =$errorsByPath[$_]
                queryCode                                                          =$users.Error
            } })
    $detail = if ($labels.Count) {
        $labels -join '；'
    }
    else {
        '其他程序（暂时无法获取程序名称）'
    }
    if ($owners.Count -gt 6) {
        $detail += '；以及其他程序'
    }
    Finish 10 ('以下程序正在占用映聚文件：' + $detail + '。请自行关闭这些程序，然后点击“重试”继续安装；也可以点击“取消”稍后更新。安装器不会关闭其他程序。')
}
catch {
    $report.issues += @{stage ='lock-query'
        code                  =$_.Exception.HResult
    }
    Finish 20 '暂时无法查询占用程序。请关闭可能正在使用映聚文件的程序后重试；若仍失败，请联系开发者并提供安装诊断日志。'
}
