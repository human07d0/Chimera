@echo off
setlocal

cd /d "%~dp0"

if not exist .env (
  echo Error: .env not found. Copy .env.example to .env and configure it:
  echo   copy .env.example .env
  exit /b 1
)

where bun >nul 2>nul
if %errorlevel% neq 0 (
  echo Bun is not installed. Installing...
  powershell -Command "irm bun.sh/install | iex"
  if %errorlevel% neq 0 (
    echo Error: Bun installation failed. Please install manually: https://bun.sh
    exit /b 1
  )
  echo Bun installed successfully.
  call refreshenv >nul 2>nul
)

if not exist index.js (
  echo Error: index.js not found. Please ensure the release archive was extracted correctly.
  exit /b 1
)

bun run index.js %*
