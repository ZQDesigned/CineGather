param([Parameter(Mandatory = $true)][string]$Baseline, [Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$baseline = (Resolve-Path $Baseline).Path
$installer = (Resolve-Path $Installer).Path
$evidence = Join-Path $PSScriptRoot '../../../.local/installer-lock-retry-windows'
New-Item -ItemType Directory -Force $evidence | Out-Null
$evidence = (Resolve-Path $evidence).Path
$native = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class CGRetryDialog {
 delegate bool Visitor(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(Visitor v,IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h,Visitor v,IntPtr p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr h,int id);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 public class Dialog { public IntPtr Handle; public string Text; public bool Retry; }
 public static Dialog[] Find(int[] pids) {
  var found=new List<Dialog>();
  EnumWindows((h,p)=>{uint pid;GetWindowThreadProcessId(h,out pid);if(Array.IndexOf(pids,(int)pid)<0||!IsWindowVisible(h))return true;
   var text=new StringBuilder();EnumChildWindows(h,(c,q)=>{var s=new StringBuilder(4096);GetWindowText(c,s,s.Capacity);text.AppendLine(s.ToString());return true;},IntPtr.Zero);
   found.Add(new Dialog{Handle=h,Text=text.ToString(),Retry=GetDlgItem(h,4)!=IntPtr.Zero});return true;},IntPtr.Zero);
  return found.ToArray();
 }
 public static void Click(IntPtr h,int id){if(GetDlgItem(h,id)==IntPtr.Zero)throw new Exception("button-missing");PostMessage(h,0x111,new IntPtr(id),IntPtr.Zero);}
}
'@
Add-Type -TypeDefinition $native
$locker = Join-Path $evidence 'CineGatherLockFixture.exe'
$cs = Join-Path $evidence 'locker.cs'
@'
using System.IO;using System.Threading;
public class LockFixture { public static void Main(string[] a) {using(var f=new FileStream(a[0],FileMode.Open,FileAccess.Read,FileShare.Read)){File.WriteAllText(a[1],"ready");while(!File.Exists(a[2]))Thread.Sleep(50);}}}
'@ | Set-Content $cs
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe "/out:$locker" $cs
if ($LASTEXITCODE -ne 0) {
    throw 'locker-compile-failed'
}
function Install([string]$File, [string[]]$Flags) {
    $p = Start-Process $File -ArgumentList $Flags -PassThru
    if (!$p.WaitForExit(120000)) {
        throw 'install-timeout'
    }
    if ($p.ExitCode -ne 0) {
        throw ('install-failed-' + $p.ExitCode)
    }
}
function Dialog {
    $ids = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $installer } | ForEach-Object { [int]$_.ProcessId })
    if (!$ids.Count) {
        return $null
    }
    return @([CGRetryDialog]::Find([int[]]$ids) | Where-Object { $_.Text -match '安装未能完成|占用映聚|占用.*文件' } | Select-Object -First 1)[0]
}
function AwaitDialog {
    for ($i = 0; $i -lt 180; $i++) {
        $d = Dialog
        if ($d) {
            return $d
        }
        Start-Sleep -Milliseconds 500
    }
    throw 'lock-dialog-timeout'
}
$results = @()
$drive = if (Test-Path 'D:\') {
    'D:'
}
else {
    'C:'
}
foreach ($mode in @('currentuser', 'allusers')) {
    $root = Join-Path $drive ('CGPlat\Installer Lock Retry ' + $mode)
    $running = $null
    $held = $null
    Install $baseline @('/S', ('/' + $mode), ('/D=' + $root))
    $before = (Get-FileHash (Join-Path $root 'CineGather.exe') -Algorithm SHA256).Hash
    $beforeAsar = (Get-FileHash (Join-Path $root 'resources\app.asar') -Algorithm SHA256).Hash
    try {
        foreach ($cancel in @($false, $true)) {
            $marker = Join-Path $evidence ($mode + '-' + $cancel + '-ready')
            $release = Join-Path $evidence ($mode + '-' + $cancel + '-release')
            $held = Start-Process $locker -ArgumentList @(('"' + (Join-Path $root 'CineGather.exe') + '"'), ('"' + $marker + '"'), ('"' + $release + '"')) -PassThru
            for ($i = 0; $i -lt 100 -and !(Test-Path $marker); $i++) {
                Start-Sleep -Milliseconds 100
            }
            if (!(Test-Path $marker)) {
                throw 'locker-not-ready'
            }
            $attempt = [guid]::NewGuid().ToString()
            $running = Start-Process $installer -ArgumentList @('/S', '--updated', ('/' + $mode), ('/CGUPDATEID=' + $attempt)) -PassThru
            $d = AwaitDialog
            @{mode       =$mode
                cancel   =$cancel
                text     =$d.Text
                hasRetry =$d.Retry
            } | ConvertTo-Json | Set-Content (Join-Path $evidence ($mode + '-' + $cancel + '-dialog.json'))
            if (!$d.Retry -or $d.Text -notmatch 'CineGatherLockFixture') {
                throw ('External owner and Retry/Cancel not shown: ' + $d.Text)
            }
            $reportPath = Join-Path $env:LOCALAPPDATA ('CGInstallDiagnostics\installer-logs\snapshot-' + $attempt + '-file-locks.json')
            $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
            if ($report.processes.pid -notcontains $held.Id -or $report.processes.name -notcontains 'CineGatherLockFixture.exe' -or $report.files.code -notcontains 32) {
                throw 'lock-diagnostic-owner-or-error-missing'
            }
            Copy-Item $reportPath (Join-Path $evidence ($mode + '-' + $cancel + '-snapshot.json'))
            if ($held.HasExited) {
                throw 'foreign-process-killed'
            }
            if ($cancel) {
                [CGRetryDialog]::Click($d.Handle, 2)
                if (!$running.WaitForExit(30000) -or $running.ExitCode -eq 0) {
                    throw 'cancel-did-not-abort'
                }
                if ($held.HasExited) {
                    throw 'cancel-killed-foreign-process'
                }
                if ((Get-FileHash (Join-Path $root 'CineGather.exe') -Algorithm SHA256).Hash -ne $before -or (Get-FileHash (Join-Path $root 'resources\app.asar') -Algorithm SHA256).Hash -ne $beforeAsar) {
                    throw 'cancel-modified-application'
                }
            }
            else {
                # Retry while the fixture still holds the file: remain blocked, without
                # destroying it or reporting a successful install.
                [CGRetryDialog]::Click($d.Handle, 4)
                Start-Sleep -Seconds 2
                if ($held.HasExited -or $running.HasExited) {
                    throw 'retry-did-not-preserve-lock-owner-and-installer'
                }
                $d = AwaitDialog
                if ($d.Text -notmatch 'CineGatherLockFixture') {
                    throw 'retry-lost-owner-name'
                }
                New-Item -ItemType File $release | Out-Null
                $held.WaitForExit()
                [CGRetryDialog]::Click($d.Handle, 4)
                if (!$running.WaitForExit(120000) -or $running.ExitCode -ne 0) {
                    throw 'release-and-retry-did-not-complete'
                }
                if (!(Test-Path (Join-Path $root 'resources\install-mode'))) {
                    throw 'installed-payload-missing'
                }
                # Current application payload was reused intentionally; only installer
                # resources changed. Preserve the expected hashes for cancellation below.
                if ((Get-FileHash (Join-Path $root 'CineGather.exe') -Algorithm SHA256).Hash -ne $before) {
                    throw 'unexpected-payload-change'
                }
            }
            $results += @{mode          =$mode
                cancel                  =$cancel
                ownerShown              =$true
                foreignProcessPreserved =$true
                retryOrCancelVerified   =$true
            }
            if (!$held.HasExited) {
                New-Item -ItemType File $release -Force | Out-Null
                $held.WaitForExit()
            }
        }
    }
    finally {
        if ($running -and !$running.HasExited) {
            Stop-Process -Id $running.Id -Force
        }
        if ($held -and !$held.HasExited) {
            New-Item -ItemType File $release -Force | Out-Null
            $held.WaitForExit()
        }
    }
    Install (Join-Path $root 'Uninstall CineGather.exe') @('/S', ('/' + $mode))
}
$results | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $evidence 'result.json')
Write-Host 'External owner, retry while locked, retry after release, and cancellation passed for user/machine installs.'
