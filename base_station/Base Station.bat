@echo off
setlocal

rem Ensure we run from the directory that contains this script so uv finds the project files.
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

where uv >nul 2>&1
if errorlevel 1 (
  echo uv is not installed or not on PATH. Install it from https://docs.astral.sh/uv/getting-started/installation/
  pause
  exit /b 1
)

rem Keep a local environment so dependencies (like pandas) persist between runs.
set "UV_PROJECT_ENVIRONMENT=%SCRIPT_DIR%\.venv"
echo Ensuring dependencies are installed (first run may take a minute)...

uv run main.py
set "STATUS=%ERRORLEVEL%"

if not "%STATUS%"=="0" (
  echo Base Station exited with status %STATUS%
)

pause
exit /b %STATUS%
