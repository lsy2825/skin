@echo off
rem Yoonsiljang - Windows PC setup (run once; running it again is safe). Double-click this file.
rem It runs setup.ps1 next to it: Git, GitHub CLI, Python 3.12, the repository, Node.js 22, Playwright, Chromium, axe-core.
rem Guide (Korean): docs\LOCAL_SETUP_WINDOWS.md . Result: C:\yoonsiljang-tools\INSTALLED.md
rem Keep this file ASCII-only: cmd.exe reads .bat files in the console code page, not UTF-8.
rem goto instead of ( ) blocks: a ")" in the folder path would break a block.
if exist "%~dp0setup.ps1" goto run
echo setup.ps1 is missing. Put setup.bat and setup.ps1 in the same folder (copy both files together).
pause
exit /b 1
:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
rem keep the window open if PowerShell could not even start the script (its own error is shown above)
if not "%errorlevel%"=="0" pause
