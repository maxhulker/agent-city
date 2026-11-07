; The Windows installer: Crosswalk for someone else's machine, in one file.
; Made by `npm run build:installer` (scripts/build-installer.mjs), which
; builds dist/Crosswalk first and passes its path and the version:
;
;   ISCC /DSource=<dist/Crosswalk> /DAppVersion=<x.y.z> /O<dist> installer\crosswalk.iss
;
; Installs for the current user only (no admin prompt) under
; %LOCALAPPDATA%\Programs\Crosswalk, with a Start menu entry, an optional
; desktop shortcut, and an entry in Settings > Apps. Uninstalling takes
; Crosswalk's hooks out of Claude Code's settings and leaves the cities
; (%USERPROFILE%\.agent-city) where they are. A newer installer upgrades in place.

#ifndef Source
  #error Pass /DSource=<the dist/Crosswalk folder>
#endif
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{9E4D6DF2-8D10-419A-9050-89BF3D80C311}
AppName=Crosswalk
AppVersion={#AppVersion}
AppVerName=Crosswalk {#AppVersion}
DefaultDirName={autopf}\Crosswalk
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputBaseFilename=Crosswalk-Setup-{#AppVersion}
SetupIconFile={#Source}\app\assets\agent-city.ico
UninstallDisplayIcon={app}\app\assets\agent-city.ico
UninstallDisplayName=Crosswalk
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
; Crosswalk.exe is closed (and its server with it) before files are replaced.
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Put a Crosswalk shortcut on the desktop"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#Source}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Crosswalk"; Filename: "{app}\Crosswalk.exe"; Parameters: "app\src\app.ts"; WorkingDir: "{app}"; IconFilename: "{app}\app\assets\agent-city.ico"; Comment: "Every Claude Code session on this machine, drawn as a city"
Name: "{autoprograms}\Crosswalk demo city"; Filename: "{app}\Crosswalk.exe"; Parameters: "app\src\app.ts --demo"; WorkingDir: "{app}"; IconFilename: "{app}\app\assets\agent-city.ico"; Comment: "Crosswalk with a scripted demo city, no Claude Code needed"
Name: "{autodesktop}\Crosswalk"; Filename: "{app}\Crosswalk.exe"; Parameters: "app\src\app.ts"; WorkingDir: "{app}"; IconFilename: "{app}\app\assets\agent-city.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\Crosswalk.exe"; Parameters: "app\src\app.ts"; WorkingDir: "{app}"; Description: "Open Crosswalk"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Claude Code's sessions stop reporting to a Crosswalk that's gone.
Filename: "{app}\Crosswalk.exe"; Parameters: "app\src\install.ts --uninstall"; WorkingDir: "{app}"; RunOnceId: "Disconnect"; Flags: runhidden waituntilterminated

[Code]
// Crosswalk.exe has no window of its own (its window is Edge's), so Windows
// can't ask it to close: it is stopped before files are replaced or removed.
// Its cities were saved as they went, so nothing is lost.
procedure StopCrosswalk();
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM Crosswalk.exe /F', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopCrosswalk();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopCrosswalk();
  Result := True;
end;
