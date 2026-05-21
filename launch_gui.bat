@echo off
setlocal
cd /d "%~dp0"

where powershell >nul 2>nul
if %errorlevel% neq 0 (
    echo PowerShell was not found.
    echo Windows PowerShell 5.1 or later is required for the first launch.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch_gui.ps1"
exit /b %errorlevel%
