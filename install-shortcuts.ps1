#requires -Version 5.1
<#
  Winlator PC Edition - installation des raccourcis
  Usage :
    powershell -NoProfile -ExecutionPolicy Bypass -File install-shortcuts.ps1            # bureau + demarrage auto
    powershell -NoProfile -ExecutionPolicy Bypass -File install-shortcuts.ps1 -NoAutostart   # bureau seul
    powershell -NoProfile -ExecutionPolicy Bypass -File install-shortcuts.ps1 -Remove        # tout retirer
#>
param(
  [switch]$NoAutostart,
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$base    = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
$vbs     = Join-Path $base 'launch-silent.vbs'
$ico     = Join-Path $base 'assets\winlator-pc.ico'

$lnkDesktop = Join-Path $desktop 'Winlator PC.lnk'
$lnkStartup = Join-Path $startup 'Winlator PC (auto).lnk'

$ws = New-Object -ComObject WScript.Shell

if ($Remove) {
  foreach ($l in @($lnkDesktop, $lnkStartup)) {
    if (Test-Path $l) { Remove-Item $l -Force; Write-Host "Retire : $l" }
  }
  Write-Host 'Raccourcis supprimes.'
  exit 0
}

if (-not (Test-Path $vbs)) { throw "Introuvable : $vbs" }

# 1) Racourci bureau
$sc = $ws.CreateShortcut($lnkDesktop)
$sc.TargetPath    = 'wscript.exe'
$sc.Arguments     = '"' + $vbs + '"'
$sc.WorkingDirectory = $base
$sc.IconLocation  = if (Test-Path $ico) { $ico } else { 'shell32.dll,44' }
$sc.Description   = 'Winlator PC Edition - interface de lancement d applications'
$sc.WindowStyle   = 7   # minimise (aucune fenetre)
$sc.Save()
Write-Host "Raccourci bureau cree : $lnkDesktop"

# 2) Demarrage automatique de session
if (-not $NoAutostart) {
  $sc2 = $ws.CreateShortcut($lnkStartup)
  $sc2.TargetPath       = 'wscript.exe'
  $sc2.Arguments        = '"' + $vbs + '"'
  $sc2.WorkingDirectory = $base
  $sc2.IconLocation     = if (Test-Path $ico) { $ico } else { 'shell32.dll,44' }
  $sc2.Description      = 'Winlator PC Edition - demarrage automatique (serveur seul)'
  $sc2.Arguments       = '"' + $vbs + '" /serveronly'
  $sc2.WindowStyle      = 7
  $sc2.Save()
  Write-Host "Demarrage automatique active : $lnkStartup"
}
