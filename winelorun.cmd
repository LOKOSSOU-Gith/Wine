@echo off
rem Winlator PC Edition - CLI : lance une application directement depuis le terminal
rem Usage : winelorun.cmd <nom-de-l-app> [--wine]
cd /d "%~dp0"
node cli.js %*
