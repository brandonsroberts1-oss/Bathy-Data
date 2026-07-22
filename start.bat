@echo off
REM Bathy-Data one-click launcher for Windows. Double-click this file.
cd /d "%~dp0"

echo ======================================
echo    Bathy-Data - starting up
echo ======================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run only, ~30s^)...
  call npm install || (echo npm install failed. & pause & exit /b 1)
)

echo Building the app...
call npm run build || (echo Build failed. & pause & exit /b 1)

echo.
echo Opening http://localhost:8787 in your browser...
echo Leave this window open while you use the app. Close it to stop.
start "" http://localhost:8787
call npm start
