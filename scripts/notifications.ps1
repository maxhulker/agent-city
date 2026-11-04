# Gives Crosswalk's desktop notifications their own name and icon: Windows
# shows a notification only for an app it knows, and without this they go out
# as Windows PowerShell. It registers the app id AgentCity.App for your user
# (HKCU\Software\Classes\AppUserModelId), which also gives Crosswalk its own
# entry under Settings > System > Notifications.
#   npm run notifications              registers it
#   npm run notifications -- -Remove   takes it away
param([switch]$Remove)
$root = Split-Path -Parent $PSScriptRoot
$key = 'HKCU:\Software\Classes\AppUserModelId\AgentCity.App'
if ($Remove) {
  if (Test-Path $key) { Remove-Item $key -Recurse; Write-Output 'Crosswalk notifications go out as Windows PowerShell again.' }
  exit 0
}
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name DisplayName -Value 'Crosswalk' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name IconUri -Value (Join-Path $root 'assets\icon-192.png') -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name IconBackgroundColor -Value 'FF0B1224' -PropertyType String -Force | Out-Null
Write-Output 'Crosswalk notifications now come from "Crosswalk", with its icon.'
