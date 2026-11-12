@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 exit /b 1
where node.exe >nul 2>&1
if errorlevel 1 goto missing_node
node.exe "%~dp0backup.mjs" %*
set "GTT_BACKUP_EXIT=%ERRORLEVEL%"
goto pause_args

:missing_node
if not exist "%~dp0logs" mkdir "%~dp0logs"
echo ERROR: Install Node.js 22 or newer, then run backup.bat again.
echo ERROR: Node.js 22 or newer is required.>>"%~dp0logs\launcher-error.log"
set "GTT_BACKUP_EXIT=1"

:pause_args
if "%~1"=="" goto pause_end
if /i "%~1"=="--no-pause" goto finish
shift
goto pause_args

:pause_end
pause

:finish
popd
exit /b %GTT_BACKUP_EXIT%
