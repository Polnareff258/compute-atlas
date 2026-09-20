@echo off
setlocal
cd /d "%~dp0"

rem One-click review launcher for POLNAREFF SYSTEM.
rem
rem Double-click with no arguments to serve the dev build and open the page.
rem Optional arguments are passed straight through:
rem   START_REVIEW.cmd --prod      build and serve the production bundle
rem   START_REVIEW.cmd --capture   also write the review frames to artifacts\
rem   START_REVIEW.cmd --help      list every option

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install the project runtime, then try again.
  pause
  exit /b 1
)

node "%~dp0scripts\review-launcher.mjs" %*
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo The review launcher stopped safely. Read the message above for details.
pause
exit /b %RESULT%
