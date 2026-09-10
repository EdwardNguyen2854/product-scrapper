@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js was not found. Install Node.js LTS first.
  pause
  exit /b 1
)
call npm run doctor || exit /b 1
if not exist node_modules (
  echo Installing dependencies...
  call npm install --ignore-scripts=false || exit /b 1
)
call npm run ensure:electron || exit /b 1
call npm run dev
