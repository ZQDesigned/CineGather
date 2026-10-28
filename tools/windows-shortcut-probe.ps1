param([Parameter(Mandatory=$true)][string]$InstallDirectory, [switch]$RemoveDesktop)
$ErrorActionPreference = 'Stop'
$executable = [IO.Path]::GetFullPath((Join-Path $InstallDirectory 'CineGather.exe'))
$locations = @(
  @{ kind = 'start-menu'; path = [Environment]::GetFolderPath('Programs') },
  @{ kind = 'start-menu'; path = [Environment]::GetFolderPath('CommonPrograms') },
  @{ kind = 'desktop'; path = [Environment]::GetFolderPath('DesktopDirectory') },
  @{ kind = 'desktop'; path = [Environment]::GetFolderPath('CommonDesktopDirectory') },
  @{ kind = 'taskbar'; path = (Join-Path $env:APPDATA 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar') }
)
$wsh = New-Object -ComObject WScript.Shell
$shell = New-Object -ComObject Shell.Application
$items = @()
foreach ($location in $locations) {
  if (-not $location.path -or -not (Test-Path -LiteralPath $location.path)) { continue }
  foreach ($file in @(Get-ChildItem -LiteralPath $location.path -Filter '*.lnk' -File)) {
    $link = $wsh.CreateShortcut($file.FullName)
    if (-not [String]::Equals($link.TargetPath, $executable, [StringComparison]::OrdinalIgnoreCase)) { continue }
    if ($RemoveDesktop -and $location.kind -eq 'desktop') {
      Remove-Item -LiteralPath $file.FullName -Force
      continue
    }
    $item = $shell.Namespace($file.DirectoryName).ParseName($file.Name)
    $items += @{
      kind = $location.kind
      path = $file.FullName
      target = $link.TargetPath
      appId = $item.ExtendedProperty('System.AppUserModel.ID')
      sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
      created = $file.CreationTimeUtc.ToString('o')
    }
  }
}
ConvertTo-Json -InputObject $items -Depth 4 -Compress
