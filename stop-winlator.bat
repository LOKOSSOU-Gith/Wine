@echo off
rem Winlator PC Edition - arrete le serveur proprement
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Arrete: pid ' + $_.ProcessId) }"
echo Termine.
