@echo off
rem Restart the DEV dsh web instance (port 3081) after the randomUUID fix.
rem Kills ONLY the 3081 process tree (PIDs recorded at write time), waits for
rem the port to free, then boots a fresh `pnpm dsh web` from this checkout.
rem The 3080 MedAI instance is deliberately untouched.
setlocal

rem Wait a moment so the calling turn can finish before we kill the process
rem that hosts it.
timeout /t 5 /nobreak >nul

echo [restart-3081] killing 3081 process tree (45856 41612)...
taskkill /PID 45856 /T /F >nul 2>&1
taskkill /PID 41612 /T /F >nul 2>&1

:waitfree
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',3081);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto waitfree
)

echo [restart-3081] port 3081 free; starting dev dsh web (rc.1.2 + randomUUID fix)...
cd /d "C:\Users\Administrator\Documents\Qoder\2026-08-13\chat-1\deepseek-harness-dev"
call pnpm dsh web --port 3081 --trusted-host 100.66.1.3 --allow-remote-privileged-methods
set "RC=%errorlevel%"
echo [restart-3081] dsh web exited with code %RC%
exit /b %RC%
