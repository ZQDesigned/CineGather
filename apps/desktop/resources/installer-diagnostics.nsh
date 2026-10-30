; Native logging remains available when PowerShell or WMI is blocked.
; Keep this journal outside $INSTDIR so old uninstallers cannot delete it.
!ifdef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_UNABORT un.cgUserAbort
!else
  !define MUI_CUSTOMFUNCTION_ABORT cgUserAbort
!endif
Var cgLogFile
Var cgStage
Var cgDetail
Var cgCode
Var cgWin32
Var cgUpdateId
Var cgSavedError
Var cgLogFailures
Var cgFailedTarget
Var cgFailedPath

!macro cgRecord PREFIX STAGE DETAIL CODE WIN32
  StrCpy $cgStage "${STAGE}"
  StrCpy $cgDetail "${DETAIL}"
  StrCpy $cgCode "${CODE}"
  StrCpy $cgWin32 "${WIN32}"
  Call ${PREFIX}cgLog
!macroend

!macro cgFunctions PREFIX
Function ${PREFIX}cgLog
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $cgSavedError 0
  IfErrors 0 +2
    StrCpy $cgSavedError 1
  System::Call 'kernel32::GetSystemTimeAsFileTime(*l .r2)'
  System::Call 'kernel32::GetCurrentProcessId() i .r3'
  ${If} $cgLogFile == ""
    CreateDirectory "$LOCALAPPDATA\CGInstallDiagnostics\installer-logs"
    StrCpy $cgLogFile "$LOCALAPPDATA\CGInstallDiagnostics\installer-logs\nsis-$3-$2.tsv"
    ${If} $cgUpdateId == ""
      ReadEnvStr $cgUpdateId "CG_UPDATE_ATTEMPT"
    ${EndIf}
    ${If} $cgUpdateId == ""
      StrCpy $cgUpdateId "nsis-$3-$2"
    ${EndIf}
  ${EndIf}
  ClearErrors
  FileOpen $0 "$cgLogFile" a
  ${IfNot} ${Errors}
    FileSeek $0 0 END $1
    ${If} $1 < 1040000
      FileWriteUTF16LE $0 "v1$\t$2$\t$3$\t$cgUpdateId$\t${VERSION}$\t$cgStage$\t$cgDetail$\t$cgCode$\t$cgWin32$\r$\n"
    ${ElseIf} $1 < 1041000
      FileWriteUTF16LE $0 "v1$\t$2$\t$3$\t$cgUpdateId$\t${VERSION}$\tnative-log-truncated$\tbyte-limit$\t$\t$\r$\n"
    ${EndIf}
    FileClose $0
  ${Else}
    IntOp $cgLogFailures $cgLogFailures + 1
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  ${If} $cgSavedError == 1
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
FunctionEnd

Function ${PREFIX}cgFailureSnapshot
  Push $0
  Push $1
  ; Execute the embedded helper from NSIS's private extraction directory.
  ; No additional user-facing support entry is installed.
  InitPluginsDir
  File /oname=$PLUGINSDIR\cg-installer-diagnostics.ps1 "${BUILD_RESOURCES_DIR}\installer-diagnostics.ps1"
  nsExec::ExecToStack /TIMEOUT=20000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cg-installer-diagnostics.ps1" -Action Snapshot -InstallDirectory "$INSTDIR" -AttemptId "$cgUpdateId" -InstallerVersion "${VERSION}" -Phase "$cgStage" -ExitCode 2 -FailedPath "$cgFailedPath" -TargetPath "$cgFailedTarget"'
  Pop $0
  Pop $1
  ; nsExec can return the literal "timeout" or "error". Store in detail;
  ; the native exit-code field must remain numeric when present.
  !insertmacro cgRecord "${PREFIX}" "snapshot-result" "$0" "" ""
  Pop $1
  Pop $0
FunctionEnd
!macroend

!macro customHeader
!ifdef BUILD_UNINSTALLER
  !insertmacro cgFunctions "un."
  Function un.onUninstSuccess
    !insertmacro cgRecord "un." "uninstall-success" "$INSTDIR" "0" ""
  FunctionEnd
  Function un.onUninstFailed
    !insertmacro cgRecord "un." "uninstall-failed" "$INSTDIR" "2" ""
  FunctionEnd
  Function un.cgUserAbort
    !insertmacro cgRecord "un." "uninstall-aborted" "$INSTDIR" "" ""
  FunctionEnd
!else
  !insertmacro cgFunctions ""
  Function .onInstSuccess
    !insertmacro cgRecord "" "install-success" "$INSTDIR" "0" ""
  FunctionEnd
  Function .onInstFailed
    !insertmacro cgRecord "" "install-failed" "$INSTDIR" "2" ""
    Call cgFailureSnapshot
    MessageBox MB_OK|MB_ICONEXCLAMATION "安装未能完成，请完全退出映聚后重试。$\r$\n如果问题持续发生，请联系开发者并提供诊断日志。$\r$\n日志位置：$LOCALAPPDATA\CGInstallDiagnostics\installer-logs"
  FunctionEnd
  Function cgUserAbort
    !insertmacro cgRecord "" "install-aborted" "$INSTDIR" "" ""
  FunctionEnd
!endif

  !insertmacro cgAtomicFunctions
!macroend

!macro customInit
  ; Legacy uninstallers cannot report a first failed file to this process.
  StrCpy $cgFailedPath ""
  StrCpy $cgFailedTarget ""
  Push $0
  Push $1
  ${GetParameters} $0
  ${GetOptions} $0 "/CGUPDATEID=" $cgUpdateId
  ClearErrors
  Pop $1
  Pop $0
  !insertmacro cgRecord "" "installer-init" "$INSTDIR" "" ""
  System::Call 'kernel32::SetEnvironmentVariableW(w "CG_UPDATE_ATTEMPT", w "$cgUpdateId")'
!macroend

!macro customUnInit
  !insertmacro cgRecord "un." "uninstaller-init" "$INSTDIR" "" ""
!macroend

; Same control flow as app-builder-lib 26.15.3 handleUninstallResult.
; Record both old and new uninstaller results, including a legacy binary which
; cannot supply its original first failed file. Do not claim that a snapshot
; after the fact proves a transient historical file lock.
!macro cgUninstallResult PHASE
  ${If} ${Errors}
    !insertmacro cgRecord "" "uninstaller-launch-failed" "$INSTDIR" "" ""
    Call cgFailureSnapshot
    Return
  ${EndIf}
  !insertmacro cgRecord "" "${PHASE}" "$INSTDIR" "$R0" ""
  ${If} $R0 != 0
    Call cgFailureSnapshot
    MessageBox MB_OK|MB_ICONEXCLAMATION "安装未能完成，请完全退出映聚后重试。$\r$\n如果问题持续发生，请联系开发者并提供诊断日志。$\r$\n日志位置：$LOCALAPPDATA\CGInstallDiagnostics\installer-logs"
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
!macro customUnInstallCheck
  !insertmacro cgUninstallResult "old-uninstall-result"
!macroend
!macro customUnInstallCheckCurrentUser
  !insertmacro cgUninstallResult "old-uninstall-currentuser-result"
!macroend

; Based on the pinned vendor atomicRMDir. Retain its traversal, self-uninstaller
; exception and rollback behavior; capture the first failed path before it is
; discarded by Abort. win32Code is GetLastError immediately after NSIS Rename,
; not a later Delete-access probe, and must be interpreted with the NSIS stage.
!macro cgAtomicFunctions
!ifdef BUILD_UNINSTALLER
Function un.cgAtomicRMDir
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  Push $9
  StrCpy $R3 "$INSTDIR$R0\*.*"
  FindFirst $R1 $R2 $R3
  cgLoop:
    StrCmp $R2 "" cgBreak
    StrCmp $R2 "." cgContinue
    StrCmp $R2 ".." cgContinue
    IfFileExists "$INSTDIR$R0\$R2\*.*" cgDirectory cgFile
    cgDirectory:
      CreateDirectory "$PLUGINSDIR\old-install$R0\$R2"
      Push "$R0\$R2"
      Call un.cgAtomicRMDir
      Pop $R3
      ${If} $R3 != 0
        Goto cgDone
      ${EndIf}
      Goto cgContinue
    cgFile:
      ClearErrors
      Rename "$INSTDIR$R0\$R2" "$PLUGINSDIR\old-install$R0\$R2"
      IfErrors cgRenameFailed cgContinue
    cgRenameFailed:
      System::Call 'kernel32::GetLastError() i .r9'
      StrCmp "$R0\$R2" "${UNINSTALL_FILENAME}" cgIgnoreSelf
      StrCpy $R3 "$INSTDIR$R0\$R2"
      StrCpy $cgFailedPath "$R3"
      StrCpy $cgFailedTarget "$PLUGINSDIR\old-install$R0\$R2"
      !insertmacro cgRecord "un." "atomic-rename-target" "$cgFailedTarget" "2" ""
      !insertmacro cgRecord "un." "atomic-rename-failed" "$R3" "2" "$9"
      Goto cgDone
    cgIgnoreSelf:
      ClearErrors
    cgContinue:
      FindNext $R1 $R2
      Goto cgLoop
    cgBreak:
      StrCpy $R3 0
    cgDone:
      FindClose $R1
      StrCpy $R0 $R3
      Pop $9
      Pop $R3
      Pop $R2
      Pop $R1
      Exch $R0
FunctionEnd
!endif

!macroend

!macro customRemoveFiles
  ${If} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"
    Push ""
    Call un.cgAtomicRMDir
    Pop $R0
    ${If} $R0 != 0
      !insertmacro cgRecord "un." "rollback-started" "$R0" "2" ""
      Push ""
      Call un.restoreFiles
      Pop $R0
      !insertmacro cgRecord "un." "rollback-attempted" "$cgFailedPath" "2" ""
      Call un.cgFailureSnapshot
      Abort 'Cannot move an installed file. Diagnostic logs: $LOCALAPPDATA\CGInstallDiagnostics\installer-logs'
    ${EndIf}
  ${EndIf}
  SetOutPath $TEMP
  ClearErrors
  RMDir /r $INSTDIR
  ${If} ${Errors}
    !insertmacro cgRecord "un." "remove-directory-failed" "$INSTDIR" "" ""
  ${Else}
    !insertmacro cgRecord "un." "remove-directory-complete" "$INSTDIR" "0" ""
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Delete "$SMPROGRAMS\CineGather 升级诊断.lnk"
  ${EndIf}
!macroend
