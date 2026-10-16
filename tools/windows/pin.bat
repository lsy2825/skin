@echo off
rem Yoonsiljang - change the PIN screen number. Runs pin.ps1 next to this file (keep both files together).
rem The new number is typed into a hidden prompt and never saved; only its hash goes into app/gate.js. Guide: docs/LOCAL_SETUP_WINDOWS.md
rem Keep this file ASCII-only: cmd.exe reads .bat files in the console code page, not UTF-8.
if exist "%~dp0pin.ps1" goto run
echo pin.ps1 is missing. Keep pin.bat and pin.ps1 in the same folder (tools\windows in the repository).
pause
exit /b 1
:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pin.ps1" %*
pause
