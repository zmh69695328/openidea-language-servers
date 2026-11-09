@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cli.ps1" -All -Force %*
echo.
pause
