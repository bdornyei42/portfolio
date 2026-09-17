@echo off
setlocal
cd /d "%~dp0"

REM =====================================================================
REM  site-mode.bat  -  switch the live site between "coming soon" and
REM                    the full "live" homepage, then deploy.
REM
REM  Usage:
REM     site-mode.bat soon     put the site into COMING SOON mode + deploy
REM     site-mode.bat live     put the site back into LIVE mode + deploy
REM     site-mode.bat          just show which mode is set right now
REM
REM  How it works: this writes one word ("soon" or "live") into the
REM  .site-mode marker file, then calls deploy.bat. deploy.bat reads that
REM  marker and serves either public\coming-soon.html or the real
REM  public\index.html at "/". The marker persists, so a plain deploy.bat
REM  later keeps whatever mode you last chose.
REM =====================================================================

set "ARG=%~1"

REM --- No argument: report current mode and exit (no deploy) ---
if "%ARG%"=="" (
  set "CUR=live"
  if exist ".site-mode" set /p CUR=<.site-mode
  echo Current site mode: %CUR%
  echo.
  echo   site-mode.bat soon   ^-^> coming-soon page, then deploy
  echo   site-mode.bat live   ^-^> full site, then deploy
  goto end
)

REM --- Normalize the argument ---
if /i "%ARG%"=="soon" goto set_soon
if /i "%ARG%"=="coming" goto set_soon
if /i "%ARG%"=="coming-soon" goto set_soon
if /i "%ARG%"=="live" goto set_live
if /i "%ARG%"=="on" goto set_live
if /i "%ARG%"=="full" goto set_live

echo Unknown mode "%ARG%".
echo Use:  site-mode.bat soon   or   site-mode.bat live
exit /b 1

:set_soon
>.site-mode echo soon
echo ==================================================
echo   Switching site to COMING SOON mode, then deploying...
echo ==================================================
echo.
goto deploy

:set_live
>.site-mode echo live
echo ==================================================
echo   Switching site to LIVE mode, then deploying...
echo ==================================================
echo.
goto deploy

:deploy
call "%~dp0deploy.bat"
if errorlevel 1 (
  echo.
  echo Deploy failed - see the error above. The mode marker is set, so you
  echo can just run deploy.bat again once the problem is fixed.
  exit /b 1
)

:end
endlocal
