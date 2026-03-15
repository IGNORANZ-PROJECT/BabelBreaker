@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    py -m babel_breaker_app --gui
    set STATUS=%errorlevel%
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        python -m babel_breaker_app --gui
        set STATUS=%errorlevel%
    ) else (
        echo Python 3 was not found.
        echo Install Python and try again.
        pause
        exit /b 1
    )
)

if not "%STATUS%"=="0" (
    echo.
    echo Babel Breaker GUI failed to start.
    pause
)

exit /b %STATUS%
