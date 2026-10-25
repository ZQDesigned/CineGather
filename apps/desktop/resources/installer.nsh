!macro customInstall
  RMDir /r "$INSTDIR\resources\capture\obs\source"
  Push $0
  FileOpen $0 "$INSTDIR\resources\install-mode" w
  FileWrite $0 "nsis"
  FileClose $0
  Pop $0
!macroend
