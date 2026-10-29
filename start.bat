@echo off
rem Starts Pulse Player on http://localhost:8080 (needed for install-as-app and offline mode)
cd /d "%~dp0"
start "" http://localhost:8080
python -m http.server 8080 --bind 127.0.0.1 2>nul || npx --yes serve -l 8080 .
