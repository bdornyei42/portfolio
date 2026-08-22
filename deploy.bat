@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo   Deploying personal website to Cloudflare Worker
echo   (worker: bdornyei42)
echo ==================================================
echo.

REM --- Rebuild ./site with ONLY the intended files, from two sources: ---
REM   public/         -> served with no auth (portfolio, demo dashboard)
REM   private/admin/  -> served behind Basic Auth (src/worker.js enforces this)
REM Nothing else in private/ (credentials.json, categorized-transactions.json,
REM sync.js, claim.js) is ever copied, so it can never end up on the live site.
if exist site rmdir /s /q site
mkdir site
mkdir site\admin
copy /y public\index.html      site\ >nul
copy /y public\dashboard.html  site\ >nul
copy /y public\connections.html site\ >nul
copy /y public\planner-demo.html site\ >nul
REM Whole admin/ folder (hub + budget + rejections + planner) goes
REM behind Basic Auth. Only .html is copied, so no stray files leak.
copy /y private\admin\*.html   site\admin\ >nul

echo Staged for deploy:
dir /s /b site
echo.

REM --- Deploy. Uses npx so no global wrangler install is required. ---
call npx --yes wrangler deploy
if errorlevel 1 (
  echo.
  echo -------------------------------------------------------------
  echo Deploy FAILED.
  echo If this is an auth error, log in once with:
  echo     npx wrangler login
  echo then run deploy.bat again.
  echo -------------------------------------------------------------
  exit /b 1
)

echo.
echo Done - your site is live on the bdornyei42 worker.
echo   /        -^> public site
echo   /admin/* -^> password-protected (ADMIN_USER / ADMIN_PASSWORD)

REM --- Reminder only (not blocking): the Worker fails CLOSED if these are
REM unset, so /admin just stays inaccessible rather than exposed. ---
call npx --yes wrangler secret list >"%TEMP%\wrangler-secrets.txt" 2>&1
findstr /c:"ADMIN_USER" "%TEMP%\wrangler-secrets.txt" >nul
set "HAS_USER=%errorlevel%"
findstr /c:"ADMIN_PASSWORD" "%TEMP%\wrangler-secrets.txt" >nul
set "HAS_PASS=%errorlevel%"
del "%TEMP%\wrangler-secrets.txt" >nul 2>&1
if not "%HAS_USER%"=="0" goto needsecrets
if not "%HAS_PASS%"=="0" goto needsecrets
goto end

:needsecrets
echo.
echo -------------------------------------------------------------
echo NOTE: ADMIN_USER / ADMIN_PASSWORD are not set yet, so /admin
echo will reject every login until you run this once:
echo     npx wrangler secret put ADMIN_USER
echo     npx wrangler secret put ADMIN_PASSWORD
echo -------------------------------------------------------------

:end
endlocal
