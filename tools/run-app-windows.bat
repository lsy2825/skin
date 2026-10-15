@echo off
rem Double-click to open the app on this PC: a local web server on port 8766 for the app folder, then the browser.
rem Stop it by closing this window (or Ctrl+C). What is installed where: docs\LOCAL_SETUP.md
rem Messages are in English on purpose: the Windows console can garble Korean text in .bat files.
setlocal
cd /d "%~dp0.."
if not exist "app\index.html" (
  echo Cannot find the app folder next to this file. Keep this file in the project's tools folder.
  pause
  exit /b 1
)
set "PY="
py -3.12 -c "import sys" >nul 2>nul && set "PY=py -3.12"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""
if not defined PY if exist "%ProgramFiles%\Python312\python.exe" set "PY="%ProgramFiles%\Python312\python.exe""
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python was not found. Run tools\setup-windows.ps1 first - see docs\LOCAL_SETUP.md
  pause
  exit /b 1
)
echo.
echo   App:  http://localhost:8766
echo   Stop: close this window (or press Ctrl+C)
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8766/'"
%PY% -m http.server 8766 --bind 127.0.0.1 --directory app
pause
