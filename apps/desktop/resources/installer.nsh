!include "installer-diagnostics.nsh"
!ifdef BUILD_UNINSTALLER
  !define CG_CONTEXT "un."
!else
  !define CG_CONTEXT ""
!endif
; This runs in the NEW installer before the OLD uninstaller. Updating only
; customUnInstall cannot repair upgrades from already-released installers.
!macro customCheckAppRunning
  !insertmacro cgRecord "${CG_CONTEXT}" "process-check-started" "$INSTDIR" "" ""
  Push $0
  Push $1
  InitPluginsDir
  File /oname=$PLUGINSDIR\cg-installer-processes.ps1 "${BUILD_RESOURCES_DIR}\installer-processes.ps1"
  nsExec::ExecToStack /TIMEOUT=30000 '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cg-installer-processes.ps1" -InstallDirectory "$INSTDIR" -AttemptId "$cgUpdateId" -CheckOnly'
  Pop $0
  Pop $1
  ${If} $0 == 10
    ${IfNot} ${Silent}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
      Quit
    ${EndIf}
    nsExec::ExecToStack /TIMEOUT=60000 '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cg-installer-processes.ps1" -InstallDirectory "$INSTDIR" -AttemptId "$cgUpdateId"'
    Pop $0
    Pop $1
  ${EndIf}
  ${If} $0 != 0
    !insertmacro cgRecord "${CG_CONTEXT}" "process-cleanup-failed" "$0" "2" ""
    Call ${CG_CONTEXT}cgFailureSnapshot
    MessageBox MB_OK|MB_ICONEXCLAMATION "Unable to close CineGather capture processes. Please exit CineGather and retry. Installer log: %LOCALAPPDATA%\CineGather\installer-logs" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  !insertmacro cgRecord "${CG_CONTEXT}" "process-cleanup-complete" "$INSTDIR" "0" ""
  Pop $1
  Pop $0
!macroend

!macro customInstall
  !insertmacro cgRecord "" "payload-installed" "$INSTDIR" "0" ""
  CreateShortCut "$SMPROGRAMS\CineGather 升级诊断.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoLogo -NoProfile -NoExit -ExecutionPolicy Bypass -File "$INSTDIR\resources\support\installer-diagnostics.ps1" -InstallDirectory "$INSTDIR"'
  RMDir /r "$INSTDIR\resources\capture\obs\source"
  Push $0
  FileOpen $0 "$INSTDIR\resources\install-mode" w
  FileWrite $0 "nsis"
  FileClose $0
  Pop $0
!macroend
