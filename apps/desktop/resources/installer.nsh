; This runs in the NEW installer before the OLD uninstaller. Updating only
; customUnInstall cannot repair upgrades from already-released installers.
!macro customCheckAppRunning
  Push $0
  Push $1
  InitPluginsDir
  File /oname=$PLUGINSDIR\cg-installer-processes.ps1 "${BUILD_RESOURCES_DIR}\installer-processes.ps1"
  nsExec::ExecToStack /TIMEOUT=30000 '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cg-installer-processes.ps1" -InstallDirectory "$INSTDIR" -CheckOnly'
  Pop $0
  Pop $1
  ${If} $0 == 10
    ${IfNot} ${Silent}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
      Quit
    ${EndIf}
    nsExec::ExecToStack /TIMEOUT=60000 '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cg-installer-processes.ps1" -InstallDirectory "$INSTDIR"'
    Pop $0
    Pop $1
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Unable to close CineGather capture processes. Please exit CineGather and retry. Installer log: %LOCALAPPDATA%\CineGather\installer-logs" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro customInstall
  RMDir /r "$INSTDIR\resources\capture\obs\source"
  Push $0
  FileOpen $0 "$INSTDIR\resources\install-mode" w
  FileWrite $0 "nsis"
  FileClose $0
  Pop $0
!macroend
