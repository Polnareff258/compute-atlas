@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

rem One-click local launcher for POLNAREFF SYSTEM.
rem Double-click to start package.json's dev server and open localhost:3000.

set "LOCAL_URL=http://localhost:3000"
set "OPEN_PAGE=1"

if /i "%~1"=="--no-open" set "OPEN_PAGE=0"
if not "%~1"=="" if /i not "%~1"=="--no-open" goto :usage

where node >nul 2>&1
if errorlevel 1 goto :missing_node

where npm >nul 2>&1
if errorlevel 1 goto :missing_npm

if not exist "%~dp0package.json" goto :missing_project

if not exist "%~dp0node_modules\next\package.json" (
  echo Project dependencies are missing. Installing them now...
  if exist "%~dp0package-lock.json" (
    call npm ci
  ) else (
    call npm install
  )
  if errorlevel 1 goto :install_failed
  echo.
)

call :probe_project
if "!PROBE_RESULT!"=="0" goto :open_page
if not "!PROBE_RESULT!"=="1" goto :port_occupied

echo Starting the local development server...
start "POLNAREFF SYSTEM dev server" /d "%~dp0" cmd /k "npm run dev"
if errorlevel 1 goto :server_start_failed

echo Waiting for %LOCAL_URL% ...
for /l %%I in (1,1,90) do (
  call :probe_project
  if "!PROBE_RESULT!"=="0" goto :open_page
  if "!PROBE_RESULT!"=="2" goto :port_occupied
  timeout /t 1 /nobreak >nul
)
goto :startup_timeout

:open_page
if "!OPEN_PAGE!"=="1" (
  start "" "%LOCAL_URL%"
  if errorlevel 1 echo The server is ready, but Windows could not open the browser automatically.
)
echo.
echo POLNAREFF SYSTEM is ready at %LOCAL_URL%
echo The development server stays in its own window. Close that window to stop it.
pause
exit /b 0

:probe_project
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/' -TimeoutSec 3; if ($r.StatusCode -eq 200 -and $r.Content -match '<title[^>]*>\s*POLNAREFF SYSTEM\s*</title>') { exit 0 }; exit 2 } catch { $inner=$_.Exception.InnerException; if ($inner -is [System.Net.Sockets.SocketException] -and $inner.SocketErrorCode -eq [System.Net.Sockets.SocketError]::ConnectionRefused) { exit 1 }; exit 2 }"
set "PROBE_RESULT=%ERRORLEVEL%"
exit /b %PROBE_RESULT%

:usage
echo Usage: START_POLNAREFF.cmd [--no-open]
echo   Double-click or run without arguments to start the development server and open localhost:3000.
echo   --no-open  Start or reuse the server without opening a browser.
pause
exit /b 2

:missing_node
echo Node.js was not found. Install Node.js, then try again.
pause
exit /b 1

:missing_npm
echo npm was not found. Install npm with Node.js, then try again.
pause
exit /b 1

:missing_project
echo package.json was not found beside this launcher.
pause
exit /b 1

:install_failed
echo Dependency installation failed. The launcher did not start a server.
pause
exit /b 1

:port_occupied
echo Port 3000 is already in use by another service. No process was stopped.
echo Close that service or choose another port in the project configuration, then try again.
pause
exit /b 1

:server_start_failed
echo Windows could not start the development server window.
pause
exit /b 1

:startup_timeout
echo The development server did not become ready within 90 seconds.
echo Check the server window for the original error. No process was stopped.
pause
exit /b 1
