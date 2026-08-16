@echo off
rem ============================================================
rem  DeepSeek Harness DEV instance - plugin development sandbox
rem  - Completely independent from the MedAiAssistant use instance (3080):
rem      code: deepseek-harness-dev (official baseline 47f943859b, plugin-dev)
rem      home: DSH_HOME=C:\Users\Administrator\.dsh-dev (isolated profiles)
rem      port: 3081
rem  - Zero MedAI dependency: NO 8081 gateway readiness check, NO backend
rem    launch, NO MEDAI_MCP_TOKEN - this instance boots and runs even when
rem    the whole MedAi backend is down.
rem  ============================================================
setlocal enabledelayedexpansion

set "PROJECT_DIR=C:\Users\Administrator\Documents\Qoder\2026-08-13\chat-1\deepseek-harness-dev"
set "DSH_HOME=C:\Users\Administrator\.dsh-dev"

rem ---- 0) skip when dev dsh web is already running (avoid double start) ----
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',3081);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 (
  echo [OK] dev dsh web is already running on 3081, skip.
  exit /b 0
)

rem ---- 1) check pnpm availability ----
where pnpm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] pnpm not found in PATH. Install Node.js with pnpm first.
  pause
  exit /b 1
)

rem ---- 2) start dev dsh web (foreground; window stays for logs) ----
cd /d "%PROJECT_DIR%"
echo [INFO] starting DEV dsh web on http://127.0.0.1:3081 (DSH_HOME=%DSH_HOME%) ...
rem --trusted-host 100.66.1.3: allow remote browsers through the /api
rem    browser-trust fence (dev box virtual IP), same as the use instance.
call pnpm dsh web --port 3081 --trusted-host 100.66.1.3 --allow-remote-privileged-methods
set "RC=%errorlevel%"
if not "%RC%"=="0" (
  echo.
  echo [ERROR] dev dsh web exited with code %RC%. See messages above.
  pause
)
exit /b %RC%
