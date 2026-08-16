@echo off
rem ============================================================
rem  DeepSeek Harness autostart script (dependency checks + self-repair)
rem  Starts "dsh web" on http://127.0.0.1:3080
rem  Depends on: MedAi backend MCP gateway (127.0.0.1:8081) + MEDAI_MCP_TOKEN
rem  dsh web has failOnStartupError=true: if the gateway is not ready, startup
rem  exits immediately (historical "flash exit" root cause). This script makes
rem  sure the gateway is ready first, and keeps the window open on any failure.
rem ============================================================
setlocal enabledelayedexpansion

set "PROJECT_DIR=C:\Users\Administrator\Documents\Qoder\2026-08-13\chat-1\deepseek-harness"
set "BACKEND_BAT=D:\MedAiAssistant 1.0 BS\med_ai_assistant_1.0_bs_backend\start-backend-dev.bat"
set "GATEWAY_PORT=8081"

rem ---- 0) skip when dsh web is already running (avoid double start) ----
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',3080);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 (
  echo [OK] dsh web is already running on 3080, skip.
  exit /b 0
)

rem ---- 1) check pnpm availability ----
where pnpm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] pnpm not found in PATH. Install Node.js with pnpm first.
  pause
  exit /b 1
)

rem ---- 2) per-machine token (dev placeholder fallback, dev machines only) ----
if not defined MEDAI_MCP_TOKEN (
  set "MEDAI_MCP_TOKEN=medai-dev-token"
  echo [WARN] MEDAI_MCP_TOKEN not set, fallback to dev placeholder token.
  echo        Production machines MUST set MEDAI_MCP_TOKEN via System env vars.
)

rem ---- 3) ensure the backend MCP gateway (8081) is ready; launch and poll if not ----
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%GATEWAY_PORT%);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 (
  echo [OK] backend MCP gateway is up on port %GATEWAY_PORT%.
  goto gateway_ok
)

if not exist "%BACKEND_BAT%" (
  echo [ERROR] backend start script not found: %BACKEND_BAT%
  pause
  exit /b 1
)

echo [INFO] backend MCP gateway is down, launching backend...
start "MedAi Backend 8081" cmd /c call "%BACKEND_BAT%"

set /a tries=0
:wait_gateway
set /a tries+=1
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%GATEWAY_PORT%);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto gateway_ok
if !tries! geq 30 (
  echo [ERROR] backend gateway not ready after ~90s.
  echo         Check the backend window or logs\dev-start.log under the backend dir.
  pause
  exit /b 1
)
timeout /t 3 /nobreak >nul
goto wait_gateway

:gateway_ok
echo [OK] backend MCP gateway is ready.
timeout /t 3 /nobreak >nul

rem ---- 4) start dsh web (foreground; window stays for logs) ----
cd /d "%PROJECT_DIR%"
echo [INFO] starting dsh web on http://127.0.0.1:3080 ...
call pnpm dsh web
set "RC=%errorlevel%"
if not "%RC%"=="0" (
  echo.
  echo [ERROR] dsh web exited with code %RC%. See messages above.
  echo         Typical causes: gateway 8081 down or MEDAI_MCP_TOKEN mismatch.
  pause
)
exit /b %RC%
