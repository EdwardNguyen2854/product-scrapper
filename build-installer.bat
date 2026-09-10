@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js was not found. Install Node.js LTS first.
  pause
  exit /b 1
)
call npm run doctor || exit /b 1
if exist package-lock.json (
  call npm ci --ignore-scripts=false || exit /b 1
) else (
  call npm install --ignore-scripts=false || exit /b 1
)
call npm run ensure:electron || exit /b 1
call npm run dist
if errorlevel 1 exit /b 1
echo.
echo Installer created under .\release
pause
