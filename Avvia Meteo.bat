@echo off
rem Avvia il server locale e apre l'app nel browser.
cd /d "%~dp0"
set "PY=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not exist "%PY%" set "PY=py"
start "" http://localhost:8765
"%PY%" server.py
pause
