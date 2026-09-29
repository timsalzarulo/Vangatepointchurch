@echo off
REM Double-click to start the Leadership Pipeline app on Windows.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Download the LTS version from https://nodejs.org, install it, then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing ^(this takes a minute^)...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
  )
)

REM Open the browser once the server has had a moment to start.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:3000"
call npm start
pause
