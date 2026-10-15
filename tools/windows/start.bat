@echo off
rem Yoonsiljang - show the app on this PC at http://localhost:8766 (only this PC can open it: --bind 127.0.0.1).
rem A server window opens; close it (or run stop.bat) to stop the app and free port 8766.
rem Keep this file ASCII-only: cmd.exe reads .bat files in the console code page, not UTF-8.
cd /d "%~dp0..\.."
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8766 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 goto inuse
start "yoonsiljang app - close this window to stop" python -m http.server 8766 --bind 127.0.0.1 --directory app
timeout /t 2 /nobreak >nul
start "" http://localhost:8766/
exit /b 0
:inuse
rem keep this message on screen: it explains why the browser may show an old copy (a server from another folder)
echo Port 8766 is already in use, so no new server was started.
echo If the app shows an old copy, close this window, run stop.bat, then start.bat again.
pause
start "" http://localhost:8766/
