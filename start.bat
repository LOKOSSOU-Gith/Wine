@echo off
rem Winlator PC Edition - lanceur principal
cd /d "%~dp0"
start "" http://localhost:8799
node server.js
