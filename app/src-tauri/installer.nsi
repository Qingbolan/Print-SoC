; EasyPaper NSIS Installer Template
; Custom installer with detection and launch functionality

!include MUI2.nsh
!include FileFunc.nsh
!include LogicLib.nsh
!include x64.nsh

; Definitions will be injected by Tauri
; !define PRODUCTNAME "EasyPaper"
; !define VERSION "0.1.0"

; App name and installation directory
Name "${PRODUCTNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${PRODUCTNAME}"
InstallDirRegKey HKLM "Software\${PRODUCTNAME}" "InstallLocation"
RequestExecutionLevel admin

; Modern UI configuration
!define MUI_ABORTWARNING
!define MUI_ICON "${INSTALLERICON}"
!define MUI_UNICON "${INSTALLERICON}"

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSEFILE}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Languages
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

; Custom initialization function to check if app is already installed
Function .onInit
    SetShellVarContext all

    ; Check if running on 64-bit Windows
    ${If} ${RunningX64}
        ; Running on 64-bit Windows
        SetRegView 64
    ${EndIf}

    ; Read install location from registry
    ReadRegStr $0 HKLM "Software\${PRODUCTNAME}" "InstallLocation"
    ReadRegStr $1 HKLM "Software\${PRODUCTNAME}" "Version"

    ; Check if the installation path exists and has the executable
    ${If} $0 != ""
        IfFileExists "$0\${PRODUCTNAME}.exe" AppInstalled AppNotInstalled

        AppInstalled:
            ; Application is already installed
            MessageBox MB_YESNOCANCEL|MB_ICONQUESTION \
                "${PRODUCTNAME} (v$1) is already installed.$\n$\nClick YES to launch the existing application.$\nClick NO to reinstall.$\nClick CANCEL to exit." \
                /SD IDNO \
                IDYES LaunchExisting \
                IDNO ContinueInstall

            ; User clicked Cancel
            Abort

        LaunchExisting:
            ; Launch the existing application
            ExecShell "open" "$0\${PRODUCTNAME}.exe"
            Abort

        ContinueInstall:
            ; Continue with installation (will overwrite)
            Goto CheckComplete

        AppNotInstalled:
            ; Registry entry exists but file doesn't - clean install
            Goto CheckComplete
    ${EndIf}

    CheckComplete:
FunctionEnd

; Installation section
Section "Install"
    SetOutPath "$INSTDIR"

    ; Copy application files
    ; Files will be inserted by Tauri build process
    ${INSTALLFILES}

    ; Write registry keys
    WriteRegStr HKLM "Software\${PRODUCTNAME}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKLM "Software\${PRODUCTNAME}" "Version" "${VERSION}"
    WriteRegStr HKLM "Software\${PRODUCTNAME}" "Publisher" "${PUBLISHER}"

    ; Create uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"

    ; Add to Windows Programs and Features
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
                     "DisplayName" "${PRODUCTNAME}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
                     "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
                     "DisplayIcon" "$\"$INSTDIR\${PRODUCTNAME}.exe$\""
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
                     "Publisher" "${PUBLISHER}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
                     "DisplayVersion" "${VERSION}"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
                       "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
                       "NoRepair" 1

    ; Get installation size
    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
                       "EstimatedSize" "$0"

    ; Create Start Menu shortcuts
    CreateDirectory "$SMPROGRAMS\${PRODUCTNAME}"
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk" \
                   "$INSTDIR\${PRODUCTNAME}.exe" \
                   "" \
                   "$INSTDIR\${PRODUCTNAME}.exe" \
                   0
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}\Uninstall.lnk" \
                   "$INSTDIR\Uninstall.exe" \
                   "" \
                   "$INSTDIR\Uninstall.exe" \
                   0

    ; Create Desktop shortcut (optional)
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" \
                   "$INSTDIR\${PRODUCTNAME}.exe" \
                   "" \
                   "$INSTDIR\${PRODUCTNAME}.exe" \
                   0
SectionEnd

; Uninstaller section
Section "Uninstall"
    SetShellVarContext all

    ; Check if running on 64-bit Windows
    ${If} ${RunningX64}
        SetRegView 64
    ${EndIf}

    ; Remove files
    Delete "$INSTDIR\${PRODUCTNAME}.exe"
    Delete "$INSTDIR\Uninstall.exe"
    RMDir /r "$INSTDIR"

    ; Remove shortcuts
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCTNAME}\Uninstall.lnk"
    RMDir "$SMPROGRAMS\${PRODUCTNAME}"

    ; Remove registry keys
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
    DeleteRegKey HKLM "Software\${PRODUCTNAME}"

    ; Remove application data (optional - uncomment if needed)
    ; RMDir /r "$APPDATA\${PRODUCTNAME}"
    ; RMDir /r "$LOCALAPPDATA\${PRODUCTNAME}"
SectionEnd
