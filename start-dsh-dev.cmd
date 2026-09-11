@echo off
rem ============================================================
rem  DeepSeek Harness DEV instance - plugin development sandbox
rem  - Completely independent from the MedAiAssistant use instance [3080]:
rem      code: deepseek-harness-dev [official baseline dsh-v0.1.5-rc.2]
rem      home: DSH_HOME=C:\Users\Administrator\.dsh-dev [isolated profiles]
rem      port: 3083
rem  - 3081 belongs to the dsh-remote-proxy reverse proxy [remote-proxy.js],
rem    which forwards to this instance and injects a matching browser-auth
rem    cookie, so http://100.66.1.3:3081/ opens with no login on any device.
rem    Keep this instance on 3083 -- binding 3081 here would fight the proxy.
rem  - Zero MedAI dependency: NO 8081 gateway readiness check, NO backend
rem    launch, NO MEDAI_MCP_TOKEN - this instance boots and runs even when
rem    the whole MedAi backend is down.
rem
rem  BOOT SAFETY LADDER - the instance must come up in every situation, even if
rem  that means dropping the plugin that was just installed:
rem    attempt  plain pnpm      the normal boot for this source checkout
rem    optional dsh-safe        opt-in via DSH_BOOT_USE_DSH_SAFE=1: it quarantines
rem                             a single bad plugin row and retries. Off by
rem                             default because on this Windows source checkout
rem                             it intermittently made dsh exit SILENTLY with an
rem                             empty stderr [3 of 5 restarts on 2026-09-11]
rem    step 1   rollback        restore the last configuration PROVEN to boot
rem    step 2   safe-mode       official bundles only - drops every third-party
rem                             bundle, including the one just installed
rem    step 3   safe-minimal    also empty the profile's user patch layer
rem    step 4   home-patch      also empty the machine-wide %DSH_HOME%\cordis.patch.yml,
rem                             which outranks every profile layer
rem    triage                   offline-compose the bundle layers [no user patch] and
rem                             report whether the failure is a build/environment one
rem  Each step that changes the profile is followed by one more boot attempt.
rem  Everything a step overwrites is backed up under
rem  %DSH_HOME%\dsh-safe-state\ ; bring the third-party plugins back with:
rem    powershell -NoProfile -ExecutionPolicy Bypass -File
rem      "%DSH_HOME%\dsh-safe-state\profile-snapshot.ps1" restore-safe-mode
rem      -ProfileName web -DshHome "%DSH_HOME%"
rem  Inspect the current state with the same script, action "status".
rem ============================================================
setlocal enabledelayedexpansion

set "PROJECT_DIR=C:\Users\Administrator\Documents\Qoder\2026-08-13\chat-1\deepseek-harness-dev"
set "DSH_HOME=C:\Users\Administrator\.dsh-dev"
set "SNAPSHOT=%DSH_HOME%\dsh-safe-state\profile-snapshot.ps1"

rem ---- 0] skip when dev dsh web is already running [avoid double start] ----
rem Probe this instance's own port [3083], never 3081: 3081 is the proxy, and
rem mistaking the proxy for a live dsh web would suppress the real launch.
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',3083);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 (
  echo [OK] dev dsh web is already running on 3083, skip.
  exit /b 0
)

rem ---- 1] check pnpm availability ----
where pnpm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] pnpm not found in PATH. Install Node.js with pnpm first.
  pause
  exit /b 1
)

rem ---- 2] boot, then walk the safety ladder when it fails -----------------
cd /d "%PROJECT_DIR%"
echo [INFO] starting DEV dsh web on http://127.0.0.1:3083 (DSH_HOME=%DSH_HOME%) ...
rem --trusted-host 100.66.1.3: allow remote browsers through the /api
rem    browser-trust fence [dev box virtual IP], same as the use instance.
rem    DSH 0.1.5 accepts trusted-host authorities at the /api fence directly,
rem    so the 0.1.1-era --allow-remote-privileged-methods flag is gone.
set "DSH_SAFE_NO_UPDATE_CHECK=1"
set "PATH=%DSH_HOME%\bin;%PATH%"

rem Record the boot time. The watchdog promotes the on-disk configuration to
rem "known good" once this instance has been observed healthy.
call :snapshot capture

call :boot
set "RC=!errorlevel!"
call :port_up
if "!PORTUP!"=="1" set "RC=0"

rem A planned restart kills this instance on purpose. Without this check the
rem launcher reads its own termination as a startup failure and starts
rem downgrading the profile - which is exactly what happened on 2026-09-11 11:39,
rem when safe-mode dropped dsh-hot-installer during a manual restart.
if not "!RC!"=="0" (
  call :check_intent
  if "!INTENT!"=="1" (
    echo [INFO] a planned restart is in progress - this exit is expected, not a startup failure.
    set "RC=0"
  )
)

if not "!RC!"=="0" (
  call :recover
  if "!RECOVERED!"=="1" (
    rem A recovery step rewrote the profile: record it, then boot once more.
    call :snapshot capture
    echo [RECOVER] booting again with the recovered configuration ...
    call :boot quick
    set "RC=!errorlevel!"
    call :port_up
    if "!PORTUP!"=="1" set "RC=0"
  )
)

if not "!RC!"=="0" (
  echo.
  echo [ERROR] dev dsh web exited with code !RC! and 3083 is still silent.
  call :snapshot diagnose
  echo [INFO] classifying the failure with the offline composition probe ...
  call :snapshot triage
  echo [ERROR] backups and evidence live under %DSH_HOME%\dsh-safe-state\
  where dsh-fix >nul 2>&1
  if not errorlevel 1 (
    echo [INFO] running "dsh-fix doctor" for an offline diagnosis ...
    call dsh-fix doctor
  )
  rem "nopause" is passed by the watchdog: unattended launches never wait.
  if /i not "%~1"=="nopause" pause
) else (
  echo [OK] dev dsh web is up on http://127.0.0.1:3083
)
exit /b !RC!

rem ============================= subroutines =============================

:boot
rem Boot once. %1 = "quick" skips dsh-safe's own quarantine retry ladder, which
rem is what the recovery attempts want: the profile was just rewritten, so
rem letting dsh-safe retry on top would only multiply the attempts.
rem dsh-safe is OPT-IN here - see the header. It never left the instance down
rem [the plain fallback always caught it] but it tripped by itself, and a fuse
rem that trips by itself is not a fuse. Set DSH_BOOT_USE_DSH_SAFE=1 to re-enable.
set "BOOTQUICK="
if /i "%~1"=="quick" set "BOOTQUICK=1"
if not "%DSH_BOOT_USE_DSH_SAFE%"=="1" (
  call pnpm dsh web --port 3083 --trusted-host 100.66.1.3
  exit /b !errorlevel!
)
where dsh-safe >nul 2>&1
if errorlevel 1 (
  echo [WARN] dsh-safe not found on PATH; booting with plain "pnpm dsh web".
  call pnpm dsh web --port 3083 --trusted-host 100.66.1.3
  exit /b !errorlevel!
)
if defined BOOTQUICK (
  echo [INFO] booting via dsh-safe ^(fast mode: no internal retry^) ...
  call dsh-safe --max-retries 0 web --port 3083 --trusted-host 100.66.1.3
) else (
  echo [INFO] booting via dsh-safe ^(auto-quarantine on startup failure^) ...
  call dsh-safe web --port 3083 --trusted-host 100.66.1.3
)
set "RCB=!errorlevel!"
if not "!RCB!"=="0" (
  rem A wrapper failure must never be the end of it: prove the port state first,
  rem then fall back to the plain boot exactly once.
  call :port_up
  if "!PORTUP!"=="1" exit /b 0
  if not defined BOOTQUICK (
    echo [WARN] dsh-safe exited with code !RCB! and 3083 is silent; retrying once with plain "pnpm dsh web".
    call pnpm dsh web --port 3083 --trusted-host 100.66.1.3
    exit /b !errorlevel!
  )
)
exit /b !RCB!

:port_up
set "PORTUP=0"
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',3083);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 set "PORTUP=1"
exit /b 0

:check_intent
rem INTENT=1 when a fresh restart-intent flag exists [written by
rem restart-dsh-dev.ps1 just before it kills this tree]. The flag expires after
rem 3 minutes, so a stale one can never mask a genuine startup failure.
set "INTENT=0"
if not exist "%DSH_HOME%\restart-intent.flag" exit /b 0
powershell -NoProfile -Command "try{ if(((Get-Date)-(Get-Item -LiteralPath '%DSH_HOME%\restart-intent.flag').LastWriteTime).TotalMinutes -lt 3){exit 0}else{exit 1} }catch{exit 1}" >nul 2>&1
if not errorlevel 1 set "INTENT=1"
exit /b 0

:snapshot
rem Snapshot helper. %1 = capture, diagnose or triage. Never fails the boot.
if not exist "%SNAPSHOT%" exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SNAPSHOT%" %1 -ProfileName web -DshHome "%DSH_HOME%"
exit /b 0

:try_step
rem Run one recovery step. Its exit code decides whether to retry:
rem   0  the profile was changed  - arm the retry
rem   10 nothing to do            - try the next, harsher step
rem   1  the step itself errored  - same
echo [RECOVER] trying: %1
powershell -NoProfile -ExecutionPolicy Bypass -File "%SNAPSHOT%" %1 -ProfileName web -DshHome "%DSH_HOME%"
if not errorlevel 1 set "RECOVERED=1"
exit /b 0

:recover
set "RECOVERED=0"
echo.
echo [RECOVER] boot failed and nothing is listening on 3083 - walking the recovery ladder.
if not exist "%SNAPSHOT%" (
  echo [RECOVER] recovery script missing at %SNAPSHOT% ; skipping the ladder.
  exit /b 0
)
call :try_step rollback
if "!RECOVERED!"=="1" exit /b 0
call :try_step safe-mode
if "!RECOVERED!"=="1" exit /b 0
call :try_step safe-minimal
if "!RECOVERED!"=="1" exit /b 0
call :try_step home-patch
if "!RECOVERED!"=="1" exit /b 0
echo [RECOVER] every recovery step reported nothing to do.
exit /b 0
