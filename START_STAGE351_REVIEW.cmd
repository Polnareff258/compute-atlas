@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install the project runtime, then try again.
  pause
  exit /b 1
)

node "%~dp0scripts\stage351-review-launcher.mjs"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" echo.
if not "%RESULT%"=="0" echo The review launcher stopped safely. Read the message above for details.
echo.
pause
exit /b %RESULT%
